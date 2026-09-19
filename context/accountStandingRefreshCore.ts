import type { AccountStanding } from "@/types/accountStanding";

export const APPEAL_ELIGIBILITY_REFRESH_DELAYS_MS = [1_500, 3_500, 7_000] as const;

export function needsAppealEligibilityRefresh(standing: AccountStanding | null) {
  return Boolean(
    standing &&
    standing.status !== "active" &&
    standing.appeal.status === "none" &&
    standing.appeal.available === false,
  );
}

export function standingRefreshIdentity(uid: string, standing: AccountStanding | null) {
  return standing ? `${uid}:${standing.status}:${standing.revision}` : null;
}

type RefreshCoordinatorOptions<T> = {
  fetch: (identity: string) => Promise<T>;
  currentIdentity: () => string | null;
  onStart: (identity: string) => void;
  onApply: (value: T, identity: string) => void;
  onFailure: (error: unknown, identity: string) => void;
  onSettled: (identity: string) => void;
};

export function createAccountRefreshCoordinator<T>(options: RefreshCoordinatorOptions<T>) {
  let inFlight: { identity: string; promise: Promise<T | null> } | null = null;

  const run = (identity: string) => {
    if (inFlight?.identity === identity) return inFlight.promise;
    options.onStart(identity);
    let promise!: Promise<T | null>;
    promise = (async () => {
      try {
        const value = await options.fetch(identity);
        if (options.currentIdentity() !== identity) return null;
        options.onApply(value, identity);
        return value;
      } catch (error) {
        if (options.currentIdentity() === identity) options.onFailure(error, identity);
        return null;
      } finally {
        if (inFlight?.promise === promise) inFlight = null;
        if (options.currentIdentity() === identity) options.onSettled(identity);
      }
    })();
    inFlight = { identity, promise };
    return promise;
  };

  return { run };
}

type BoundedAppealRefreshOptions = {
  identity: string;
  currentIdentity: () => string | null;
  refresh: () => Promise<AccountStanding | null>;
  delays?: readonly number[];
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelScheduled?: (handle: ReturnType<typeof setTimeout>) => void;
};

export function startBoundedAppealEligibilityRefresh(options: BoundedAppealRefreshOptions) {
  const delays = options.delays ?? APPEAL_ELIGIBILITY_REFRESH_DELAYS_MS;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelScheduled = options.cancelScheduled ?? clearTimeout;
  let canceled = false;
  let attempt = 0;
  let handle: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (canceled || attempt >= delays.length || options.currentIdentity() !== options.identity) return;
    const delay = delays[attempt];
    attempt += 1;
    handle = schedule(() => void run(), delay);
  };

  const run = async () => {
    handle = null;
    if (canceled || options.currentIdentity() !== options.identity) return;
    let standing: AccountStanding | null = null;
    try {
      standing = await options.refresh();
    } catch {
      standing = null;
    }
    if (canceled || options.currentIdentity() !== options.identity) return;
    if (standing && !needsAppealEligibilityRefresh(standing)) return;
    scheduleNext();
  };

  scheduleNext();
  return () => {
    canceled = true;
    if (handle !== null) cancelScheduled(handle);
    handle = null;
  };
}
