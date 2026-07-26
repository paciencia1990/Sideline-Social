export type LocalVoicePlaybackSource = {
  kind: "local-draft";
  uri: string;
};

export type PersistedVoicePlaybackSource = {
  kind: "persisted-message";
  messageId: string;
  messageKind: "announcement" | "privateMessage";
  storagePath: string;
};

export type VoicePlaybackSource = LocalVoicePlaybackSource | PersistedVoicePlaybackSource;

export type VoicePlaybackUrl = {
  expiresAtMillis: number;
  url: string;
};

export type VoicePlaybackFailureStage =
  | "normalize-message"
  | "request-playback-url"
  | "playback-url-authorization"
  | "playback-url-response"
  | "player-create"
  | "player-replace"
  | "player-load-timeout"
  | "player-load-error"
  | "player-play"
  | "remote-http"
  | "unsupported-format"
  | "expired-url"
  | "unknown";

export type VoicePlaybackResponseProbe = {
  completeObject: boolean;
  contentTypeAccepted: boolean;
  hasNonzeroBytes: boolean;
  httpStatusCategory: "success" | "authorization" | "missing" | "server" | "other";
  redirectFree: boolean;
};

type ResolveOptions = {
  forceRefresh?: boolean;
  now?: () => number;
  onSignedUrlRequest?: () => void;
  onSignedUrlResolved?: () => void;
};

const URL_EXPIRY_BUFFER_MS = 15_000;
const cachedPlaybackUrls = new Map<string, VoicePlaybackUrl>();
let authorizationContextUserId: string | null | undefined;

export function setVoicePlaybackAuthorizationContext(userId: string | null) {
  if (authorizationContextUserId === userId) return;
  authorizationContextUserId = userId;
  cachedPlaybackUrls.clear();
}

export function clearVoicePlaybackUrlCache() {
  cachedPlaybackUrls.clear();
}

export function invalidateVoicePlaybackSource(source: VoicePlaybackSource) {
  if (source.kind === "persisted-message") cachedPlaybackUrls.delete(cacheKey(source));
}

export function voicePlaybackSourceIdentity(source: VoicePlaybackSource) {
  return source.kind === "local-draft"
    ? `local\u001f${source.uri}`
    : `${source.messageKind}\u001f${source.messageId}\u001f${source.storagePath}`;
}

export function normalizeVoicePlaybackUrlResponse(
  value: unknown,
  options: { now?: number; allowLocalHttp?: boolean } = {},
): VoicePlaybackUrl {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_voice_playback_response");
  }
  const data = value as Record<string, unknown>;
  const url = typeof data.url === "string" ? data.url.trim() : "";
  const expiresAtMillis = data.expiresAtMillis;
  if (!url || typeof expiresAtMillis !== "number" || !Number.isFinite(expiresAtMillis)) {
    throw new Error("invalid_voice_playback_response");
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("invalid_voice_playback_url");
  }
  const localHttpAllowed = options.allowLocalHttp === true &&
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "10.0.2.2"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttpAllowed) throw new Error("invalid_voice_playback_url");
  const now = options.now ?? Date.now();
  if (expiresAtMillis <= now) throw new Error("expired_voice_playback_url");
  return { expiresAtMillis, url };
}

export async function probeVoicePlaybackUrl(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<VoicePlaybackResponseProbe> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers: { Range: "bytes=0-1" },
      method: "GET",
    });
  } catch {
    throw new Error("voice_remote_http_failed");
  }
  const statusCategory = response.status === 401 || response.status === 403
    ? "authorization"
    : response.status === 404
      ? "missing"
      : response.status >= 500
        ? "server"
        : response.ok
          ? "success"
          : "other";
  if (!response.ok) {
    if (statusCategory === "authorization") throw new Error("voice_remote_authorization_failed");
    if (statusCategory === "missing") throw new Error("voice_remote_missing");
    throw new Error("voice_remote_http_failed");
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  const contentTypeAccepted = ["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(contentType);
  if (!contentTypeAccepted) throw new Error("voice_remote_unsupported_format");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < 1) throw new Error("voice_remote_empty");
  return {
    completeObject: response.status === 200 ||
      (response.status === 206 && Boolean(response.headers.get("content-range"))),
    contentTypeAccepted,
    hasNonzeroBytes: true,
    httpStatusCategory: statusCategory,
    redirectFree: response.redirected !== true,
  };
}

export async function resolveVoicePlaybackUri(
  source: VoicePlaybackSource,
  requestSignedUrl: (source: PersistedVoicePlaybackSource) => Promise<VoicePlaybackUrl>,
  options: ResolveOptions = {},
) {
  if (source.kind === "local-draft") {
    if (!source.uri || !/^(?:file|content|cache):/iu.test(source.uri)) throw new Error("invalid_local_voice_uri");
    return source.uri;
  }
  if (!authorizationContextUserId) throw new Error("voice_playback_auth_required");
  if (!source.messageId.trim() || !source.storagePath.trim()) throw new Error("missing_voice_message_source");

  const now = options.now?.() ?? Date.now();
  const key = cacheKey(source);
  const cached = cachedPlaybackUrls.get(key);
  if (!options.forceRefresh && cached && cached.expiresAtMillis > now + URL_EXPIRY_BUFFER_MS) return cached.url;
  cachedPlaybackUrls.delete(key);

  options.onSignedUrlRequest?.();
  const resolved = normalizeVoicePlaybackUrlResponse(await requestSignedUrl(source), {
    allowLocalHttp: true,
    now,
  });
  cachedPlaybackUrls.set(key, resolved);
  options.onSignedUrlResolved?.();
  return resolved.url;
}

export async function playVoiceSourceWithOneRefresh(input: {
  beforeRetry?: () => Promise<void> | void;
  onSignedUrlRequest?: () => void;
  onSignedUrlResolved?: () => void;
  playUri: (uri: string) => Promise<void>;
  requestSignedUrl: (source: PersistedVoicePlaybackSource) => Promise<VoicePlaybackUrl>;
  shouldRetry?: (error: unknown) => boolean;
  source: VoicePlaybackSource;
}) {
  const maxAttempts = input.source.kind === "persisted-message" ? 2 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const uri = await resolveVoicePlaybackUri(input.source, input.requestSignedUrl, {
        forceRefresh: attempt > 0,
        onSignedUrlRequest: input.onSignedUrlRequest,
        onSignedUrlResolved: input.onSignedUrlResolved,
      });
      await input.playUri(uri);
      return;
    } catch (error) {
      lastError = error;
      invalidateVoicePlaybackSource(input.source);
      if (attempt + 1 >= maxAttempts || input.shouldRetry?.(error) === false) break;
      await input.beforeRetry?.();
    }
  }
  throw lastError;
}

function cacheKey(source: PersistedVoicePlaybackSource) {
  return `${authorizationContextUserId ?? "signed-out"}\u001f${source.messageKind}\u001f${source.messageId}\u001f${source.storagePath}`;
}
