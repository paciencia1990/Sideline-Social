import { createPrivateKey, sign as signJwt } from 'node:crypto';

export const APPLE_NATIVE_CLIENT_ID = 'com.sidelinesocial.app';
export const APPLE_REVOCATION_SECRET_NAMES = [
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_CLIENT_ID',
  'APPLE_PRIVATE_KEY',
] as const;

const APPLE_TOKEN_ENDPOINT = 'https://appleid.apple.com/auth/token';
const APPLE_REVOCATION_ENDPOINT = 'https://appleid.apple.com/auth/revoke';

export type AppleRevocationFailureCategory =
  | 'apple_authorization_code_invalid'
  | 'apple_credentials_unavailable'
  | 'apple_revocation_failed'
  | 'apple_subject_mismatch'
  | 'apple_token_exchange_failed';

export type AppleDeletionAuthorizationFailure =
  | 'apple_authorization_code_required'
  | 'apple_provider_not_linked';

export class AppleDeletionAuthorizationError extends Error {
  readonly category: AppleDeletionAuthorizationFailure;

  constructor(category: AppleDeletionAuthorizationFailure) {
    super(category);
    this.name = 'AppleDeletionAuthorizationError';
    this.category = category;
  }
}

export class AppleRevocationError extends Error {
  readonly category: AppleRevocationFailureCategory;

  constructor(category: AppleRevocationFailureCategory) {
    super(category);
    this.name = 'AppleRevocationError';
    this.category = category;
  }
}

export type AppleRevocationSecrets = {
  clientId: string;
  keyId: string;
  privateKey: string;
  teamId: string;
};

export type AppleHttpResponse = {
  status: number;
  text: () => Promise<string>;
};

export type AppleHttpTransport = (
  url: string,
  init: {
    body: string;
    headers: Record<string, string>;
    method: 'POST';
  },
) => Promise<AppleHttpResponse>;

export function resolveAppleDeletionAuthorization(input: {
  authorizationCode: string | null;
  providerIds: readonly string[];
}) {
  const appleLinked = input.providerIds.includes('apple.com');
  if (!appleLinked) {
    if (input.authorizationCode) {
      throw new AppleDeletionAuthorizationError('apple_provider_not_linked');
    }
    return null;
  }
  if (!input.authorizationCode) {
    throw new AppleDeletionAuthorizationError('apple_authorization_code_required');
  }
  return input.authorizationCode;
}

export async function revokeAppleAuthorizationCode(input: {
  authorizationCode: string;
  expectedAppleSubject: string;
  nowSeconds?: number;
  secrets: AppleRevocationSecrets;
  transport?: AppleHttpTransport;
}) {
  const authorizationCode = input.authorizationCode.trim();
  if (!authorizationCode || authorizationCode.length > 8192) {
    throw new AppleRevocationError('apple_authorization_code_invalid');
  }
  validateSecrets(input.secrets);

  const clientSecret = createAppleClientSecret(input.secrets, input.nowSeconds);
  const transport = input.transport ?? defaultAppleTransport;
  const tokenResponse = await safelyRequest(transport, APPLE_TOKEN_ENDPOINT, formBody({
    client_id: input.secrets.clientId,
    client_secret: clientSecret,
    code: authorizationCode,
    grant_type: 'authorization_code',
  }), 'apple_token_exchange_failed');

  if (tokenResponse.status !== 200) {
    throw new AppleRevocationError('apple_token_exchange_failed');
  }
  const tokenPayload = await readJson(tokenResponse, 'apple_token_exchange_failed');
  const tokenSubject = readIdentityTokenSubject(tokenPayload.id_token);
  if (!tokenSubject || tokenSubject !== input.expectedAppleSubject) {
    throw new AppleRevocationError('apple_subject_mismatch');
  }
  const refreshToken = stringValue(tokenPayload.refresh_token);
  const accessToken = stringValue(tokenPayload.access_token);
  const token = refreshToken || accessToken;
  if (!token) throw new AppleRevocationError('apple_token_exchange_failed');

  const tokenTypeHint = refreshToken ? 'refresh_token' : 'access_token';
  const revokeResponse = await safelyRequest(transport, APPLE_REVOCATION_ENDPOINT, formBody({
    client_id: input.secrets.clientId,
    client_secret: clientSecret,
    token,
    token_type_hint: tokenTypeHint,
  }), 'apple_revocation_failed');
  if (revokeResponse.status !== 200) {
    throw new AppleRevocationError('apple_revocation_failed');
  }

  return { revoked: true as const, tokenType: tokenTypeHint };
}

export function createAppleClientSecret(
  secrets: AppleRevocationSecrets,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  validateSecrets(secrets);
  const header = base64UrlJson({ alg: 'ES256', kid: secrets.keyId, typ: 'JWT' });
  const claims = base64UrlJson({
    aud: 'https://appleid.apple.com',
    exp: nowSeconds + 5 * 60,
    iat: nowSeconds,
    iss: secrets.teamId,
    sub: secrets.clientId,
  });
  const signingInput = `${header}.${claims}`;
  let signature: Buffer;
  try {
    signature = signJwt('sha256', Buffer.from(signingInput), {
      dsaEncoding: 'ieee-p1363',
      key: createPrivateKey(secrets.privateKey),
    });
  } catch {
    throw new AppleRevocationError('apple_credentials_unavailable');
  }
  return `${signingInput}.${signature.toString('base64url')}`;
}

export function readAppleRevocationSecrets(
  environment: NodeJS.ProcessEnv = process.env,
): AppleRevocationSecrets {
  return {
    clientId: environment.APPLE_CLIENT_ID?.trim() ?? '',
    keyId: environment.APPLE_KEY_ID?.trim() ?? '',
    privateKey: normalizePrivateKey(environment.APPLE_PRIVATE_KEY ?? ''),
    teamId: environment.APPLE_TEAM_ID?.trim() ?? '',
  };
}

async function defaultAppleTransport(
  url: string,
  init: { body: string; headers: Record<string, string>; method: 'POST' },
): Promise<AppleHttpResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    return { status: response.status, text: async () => body };
  } finally {
    clearTimeout(timeout);
  }
}

async function safelyRequest(
  transport: AppleHttpTransport,
  url: string,
  body: string,
  failure: AppleRevocationFailureCategory,
) {
  try {
    return await transport(url, {
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
  } catch {
    throw new AppleRevocationError(failure);
  }
}

async function readJson(response: AppleHttpResponse, failure: AppleRevocationFailureCategory) {
  try {
    const parsed = JSON.parse(await response.text());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // The caller receives only a sanitized category, never Apple's response.
  }
  throw new AppleRevocationError(failure);
}

function validateSecrets(secrets: AppleRevocationSecrets) {
  if (
    secrets.clientId !== APPLE_NATIVE_CLIENT_ID ||
    !/^[A-Z0-9]{10}$/.test(secrets.teamId) ||
    !/^[A-Z0-9]{10}$/.test(secrets.keyId) ||
    !secrets.privateKey.includes('BEGIN PRIVATE KEY')
  ) {
    throw new AppleRevocationError('apple_credentials_unavailable');
  }
}

function normalizePrivateKey(value: string) {
  return value.trim().replace(/\\n/g, '\n');
}

function formBody(values: Record<string, string>) {
  return new URLSearchParams(values).toString();
}

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value ? value : null;
}

function readIdentityTokenSubject(value: unknown) {
  if (typeof value !== 'string') return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return typeof payload?.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}
