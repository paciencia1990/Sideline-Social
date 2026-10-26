type ProfileReadMetadata = { fromCache: boolean; hasPendingWrites: boolean };

type ProfileConfirmationOptions<TSnapshot extends { metadata: ProfileReadMetadata }> = {
  subscribe: (next: (snapshot: TSnapshot) => void, error: (error: unknown) => void) => () => void;
  assertSession: () => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  onUnconfirmed?: (metadata: ProfileReadMetadata) => void;
};

/** One bounded observation; cached/local-write snapshots never confirm access. */
export function waitForConfirmedProfile<TSnapshot extends { metadata: ProfileReadMetadata }>(
  options: ProfileConfirmationOptions<TSnapshot>,
): Promise<TSnapshot> {
  return new Promise<TSnapshot>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListening = false;
    const timeoutMs = options.timeoutMs ?? 15_000;
    const failure = (code: string, message: string) => Object.assign(new Error(message), { code });

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (abortListening) {
        options.signal?.removeEventListener("abort", abort);
        abortListening = false;
      }
      if (unsubscribe) {
        const stop = unsubscribe;
        unsubscribe = undefined;
        // Teardown cannot change a result already settled or expose SDK details.
        try { stop(); } catch { /* no repeated teardown */ }
      }
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(failure("cancelled", "Profile confirmation cancelled"));
    const next = (snapshot: TSnapshot) => {
      if (settled) return;
      try {
        options.assertSession();
        const metadata = {
          fromCache: snapshot.metadata.fromCache,
          hasPendingWrites: snapshot.metadata.hasPendingWrites,
        };
        if (metadata.fromCache !== false || metadata.hasPendingWrites !== false) {
          if (typeof metadata.fromCache === "boolean" && typeof metadata.hasPendingWrites === "boolean") {
            // Diagnostics have no authority to make a profile read fail or pass.
            try { options.onUnconfirmed?.(metadata); } catch { /* diagnostic only */ }
          }
          return;
        }
        settled = true;
        cleanup();
        resolve(snapshot);
      } catch (error) {
        fail(error);
      }
    };
    const error = (cause: unknown) => {
      if (settled) return;
      try { options.assertSession(); } catch (sessionError) { fail(sessionError); return; }
      fail(cause);
    };

    try {
      options.assertSession();
      if (options.signal?.aborted) { abort(); return; }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        fail(failure("failed-precondition", "Profile confirmation deadline is invalid"));
        return;
      }
      if (options.signal) {
        options.signal.addEventListener("abort", abort);
        abortListening = true;
        if (options.signal.aborted) { abort(); return; }
      }
      timer = setTimeout(() => fail(failure("deadline-exceeded", "Profile confirmation timed out")), timeoutMs);
      unsubscribe = options.subscribe(next, error);
      // A test adapter/observer may deliver a terminal callback synchronously.
      if (settled) cleanup();
    } catch (cause) {
      fail(cause);
    }
  });
}
