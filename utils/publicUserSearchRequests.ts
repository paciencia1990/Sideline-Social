const SEARCH_WINDOW_MS = 60_000;
const SEARCH_WAIT_MS = SEARCH_WINDOW_MS + 1_000;
const MAX_SEARCHES_PER_WINDOW = 30;

export function normalizePublicUserSearchQuery(query: string) {
  return query.trim().replace(/\s+/gu, " ");
}

export function isPublicUserSearchQueryReady(query: string) {
  return query.length >= 2 && query.length <= 80 && (query.match(/\p{L}/gu)?.length ?? 0) >= 2;
}

class PublicUserSearchRateLimitError extends Error {
  readonly code = "public-search/rate-limited";
  constructor(readonly retryAtMs: number) {
    super("Please wait before searching again.");
  }
}

export function getPublicUserSearchRetryAt(error: unknown): number | null {
  return error instanceof PublicUserSearchRateLimitError ? error.retryAtMs : null;
}

function searchError(code: string) {
  return Object.assign(new Error("Parent search could not be completed."), { code });
}

function isServerSearchRateLimit(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: unknown; details?: { reason?: unknown } };
  return ["functions/resource-exhausted", "resource-exhausted"].includes(String(value.code)) &&
    value.details?.reason === "rate_limited";
}

// Share pending work only. Never cache settled profile/relationship results or
// persist search text. Session identity prevents cross-account or sign-in replay.
export function createPublicUserSearchRequests<Session extends { uid: string }, Result>(options: {
  currentSession: () => Session | null;
  load: (query: string, limit: number) => Promise<Result>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let currentSession: Session | null = null;
  let pending = new Map<string, Promise<Result>>();
  let starts: number[] = [];
  let blockedUntil = 0;

  const search = function search(query: string, limit = 20): Promise<Result> {
    const session = options.currentSession();
    if (session !== currentSession) {
      currentSession = session;
      pending = new Map();
      starts = [];
      blockedUntil = 0;
    }
    if (!session?.uid) return Promise.reject(searchError("public-search/unauthenticated"));
    const normalized = normalizePublicUserSearchQuery(query);
    if (!isPublicUserSearchQueryReady(normalized) || !Number.isInteger(limit) || limit < 1 || limit > 20) {
      return Promise.reject(searchError("public-search/invalid-query"));
    }
    const timestamp = now();
    if (timestamp < blockedUntil) return Promise.reject(new PublicUserSearchRateLimitError(blockedUntil));
    const key = JSON.stringify([normalized.toLowerCase(), limit]);
    const existing = pending.get(key);
    if (existing) return existing;

    // A sliding local budget avoids sending requests already known to exceed
    // the server's fixed-window limit. Other devices remain guarded by server.
    starts = starts.filter(start => timestamp - start < SEARCH_WINDOW_MS);
    if (starts.length >= MAX_SEARCHES_PER_WINDOW) {
      blockedUntil = starts[0] + SEARCH_WAIT_MS;
      return Promise.reject(new PublicUserSearchRateLimitError(blockedUntil));
    }
    starts.push(timestamp);
    const requests = pending;
    const requireSameSession = () => {
      if (options.currentSession() !== session) throw searchError("public-search/session-changed");
    };
    const request: Promise<Result> = Promise.resolve().then(() => {
      requireSameSession();
      return options.load(normalized, limit);
    }).then(result => {
      requireSameSession();
      return result;
    }).catch(error => {
      requireSameSession();
      if (isServerSearchRateLimit(error)) {
        blockedUntil = now() + SEARCH_WAIT_MS;
        throw new PublicUserSearchRateLimitError(blockedUntil);
      }
      throw error;
    }).finally(() => {
      if (requests.get(key) === request) requests.delete(key);
    });
    requests.set(key, request);
    return request;
  };
  // A deliberate refresh after a friendship change must not inherit a read
  // started before that change. Keep the budget and cooldown intact.
  return Object.assign(search, { invalidatePending: () => pending.clear() });
}
