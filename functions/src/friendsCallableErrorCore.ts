export type FriendsCallableUnexpectedErrorCode =
  | 'failed-precondition'
  | 'permission-denied'
  | 'resource-exhausted'
  | 'internal';

export type FriendsCallableUnexpectedErrorClassification = {
  code: FriendsCallableUnexpectedErrorCode;
  reason:
    | 'firestore_index_required'
    | 'backend_permission_denied'
    | 'backend_resource_exhausted'
    | 'unexpected_failure';
};

export type SafeFriendsCallableError = {
  originalCode: string | number | null;
  originalMessage: string;
  originalStack: string | null;
};

function readErrorProperty(error: unknown, property: 'code' | 'message' | 'stack'): unknown {
  if (!error || typeof error !== 'object' || !(property in error)) return undefined;
  return (error as Record<string, unknown>)[property];
}

function boundedText(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, limit) : null;
}

export function classifyFriendsCallableUnexpectedError(
  error: unknown,
): FriendsCallableUnexpectedErrorClassification {
  const originalCode = readErrorProperty(error, 'code');
  const normalizedCode = String(originalCode ?? '').toLocaleLowerCase();
  const normalizedMessage = String(readErrorProperty(error, 'message') ?? '').toLocaleLowerCase();

  if (
    originalCode === 9 ||
    normalizedCode === '9' ||
    normalizedCode === 'failed-precondition' ||
    normalizedCode === 'failed_precondition' ||
    normalizedMessage.includes('query requires a collection_group_asc index') ||
    normalizedMessage.includes('query requires an index')
  ) {
    return {
      code: 'failed-precondition',
      reason: 'firestore_index_required',
    };
  }
  if (
    originalCode === 7 ||
    normalizedCode === '7' ||
    normalizedCode === 'permission-denied' ||
    normalizedCode === 'permission_denied'
  ) {
    return {
      code: 'permission-denied',
      reason: 'backend_permission_denied',
    };
  }
  if (
    originalCode === 8 ||
    normalizedCode === '8' ||
    normalizedCode === 'resource-exhausted' ||
    normalizedCode === 'resource_exhausted'
  ) {
    return {
      code: 'resource-exhausted',
      reason: 'backend_resource_exhausted',
    };
  }
  return {
    code: 'internal',
    reason: 'unexpected_failure',
  };
}

export function toSafeFriendsCallableError(error: unknown): SafeFriendsCallableError {
  const code = readErrorProperty(error, 'code');
  return {
    originalCode: typeof code === 'string' || typeof code === 'number' ? code : null,
    originalMessage: boundedText(readErrorProperty(error, 'message'), 1_000) ?? 'Unknown error',
    originalStack: boundedText(readErrorProperty(error, 'stack'), 4_000),
  };
}
