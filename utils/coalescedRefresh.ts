export type RefreshOptions<Input, Result> = {
  load: (input: Input) => Promise<Result>;
  merge: (previous: Input, next: Input) => Input;
  covers?: (scheduled: Input, requested: Input) => boolean;
  onStart?: () => void;
  onSuccess: (result: Result) => void;
  onError: (error: unknown) => void;
  onSettled?: () => void;
};

// One operation at a time. Changes during a read are merged into a trailing
// read, so sharing a promise never loses a newer mutation or listener event.
export function createCoalescedRefresh<Input, Result>(options: RefreshOptions<Input, Result>) {
  let pending: { input: Input } | null = null;
  let running: { input: Input } | null = null;
  let inFlight: Promise<void> | null = null;
  let inFlightLifecycle = 0;
  let disposed = false;
  let lifecycle = 0;
  return {
    activate() { disposed = false; },
    dispose() { disposed = true; pending = null; lifecycle += 1; },
    refresh(input: Input, invalidate = true): Promise<void> {
      if (disposed) return Promise.resolve();
      if (inFlight) {
        const scheduled = pending && running
          ? { input: options.merge(running.input, pending.input) }
          : pending ?? running;
        const covered = scheduled && (options.covers?.(scheduled.input, input) ?? true);
        if (invalidate || inFlightLifecycle !== lifecycle || !covered) {
          pending = { input: pending ? options.merge(pending.input, input) : input };
          inFlightLifecycle = lifecycle;
        }
        return inFlight;
      }
      pending = { input };
      inFlightLifecycle = lifecycle;
      const request = Promise.resolve().then(async () => {
        if (disposed) return;
        options.onStart?.();
        while (pending && !disposed) {
          const next = pending.input;
          const startedIn = lifecycle;
          running = { input: next };
          pending = null;
          try {
            const result = await options.load(next);
            if (!disposed && startedIn === lifecycle) options.onSuccess(result);
          } catch (error) {
            if (!disposed && startedIn === lifecycle) options.onError(error);
          }
        }
      }).finally(() => {
        if (inFlight === request) { inFlight = null; running = null; }
        if (!disposed) options.onSettled?.();
      });
      inFlight = request;
      return request;
    },
  };
}
