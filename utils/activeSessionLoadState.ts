export type ActiveSessionLoadState<Session> =
  | { status: "idle" }
  | { status: "loading"; session: Session | null }
  | { status: "ready"; session: Session | null }
  | { status: "permission-error"; session: Session | null }
  | { status: "network-error"; session: Session | null };

export type ActiveSessionFetchResult<Session> =
  | { status: "ready"; session: Session | null }
  | { status: "permission-error" }
  | { status: "network-error" };

export type ActiveSessionLoadContext = {
  enabled: boolean;
  squadId: string | null;
  userId: string | null;
};

export function createActiveSessionLoadCoordinator<Session>(input: {
  fetchSession: (squadId: string) => Promise<ActiveSessionFetchResult<Session>>;
  onDiagnostic?: (status: "permission-error" | "network-error") => void;
  onStateChange: (state: ActiveSessionLoadState<Session>) => void;
}) {
  let state: ActiveSessionLoadState<Session> = { status: "idle" };
  let context: { key: string; squadId: string } | null = null;
  let loadedKey: string | null = null;
  let activeToken = 0;
  let disposed = false;
  let inFlight: { key: string; promise: Promise<void>; token: number } | null = null;
  let invalidatedInFlight: Promise<void> | null = null;

  const emit = (next: ActiveSessionLoadState<Session>) => {
    state = next;
    if (!disposed) input.onStateChange(next);
  };

  const run = (force: boolean) => {
    if (disposed || !context) return Promise.resolve();
    const requestContext = context;
    if (inFlight?.key === requestContext.key) return inFlight.promise;
    if (!force && loadedKey === requestContext.key) return Promise.resolve();

    const previousSession = "session" in state ? state.session : null;
    const token = ++activeToken;
    emit({ status: "loading", session: previousSession });
    const promise = input.fetchSession(requestContext.squadId)
      .then((result) => {
        if (disposed || token !== activeToken || context?.key !== requestContext.key) return;
        loadedKey = requestContext.key;
        if (result.status === "ready") {
          emit({ status: "ready", session: result.session });
          return;
        }
        input.onDiagnostic?.(result.status);
        emit({ status: result.status, session: previousSession });
      })
      .catch(() => {
        if (disposed || token !== activeToken || context?.key !== requestContext.key) return;
        loadedKey = requestContext.key;
        input.onDiagnostic?.("network-error");
        emit({ status: "network-error", session: previousSession });
      })
      .finally(() => {
        if (inFlight?.token === token) inFlight = null;
      });
    inFlight = { key: requestContext.key, promise, token };
    return promise;
  };

  return {
    clearSession(expectedSession?: Session) {
      const currentSession = "session" in state ? state.session : null;
      if (expectedSession !== undefined && currentSession !== expectedSession) return false;
      if (inFlight) invalidatedInFlight = inFlight.promise;
      activeToken += 1;
      inFlight = null;
      emit({ status: "ready", session: null });
      return true;
    },
    dispose() {
      disposed = true;
      activeToken += 1;
      inFlight = null;
      invalidatedInFlight = null;
      context = null;
    },
    getState() {
      return state;
    },
    retry() {
      const invalidated = invalidatedInFlight;
      if (invalidated) {
        return invalidated.catch(() => undefined).then(() => {
          if (invalidatedInFlight === invalidated) invalidatedInFlight = null;
          return run(true);
        });
      }
      return run(true);
    },
    setContext(next: ActiveSessionLoadContext) {
      const squadId = next.squadId?.trim() ?? "";
      const userId = next.userId?.trim() ?? "";
      if (!next.enabled || !squadId || !userId) {
        activeToken += 1;
        inFlight = null;
        invalidatedInFlight = null;
        context = null;
        loadedKey = null;
        emit({ status: "idle" });
        return Promise.resolve();
      }
      const key = `${userId}:${squadId}`;
      if (context?.key !== key) {
        activeToken += 1;
        inFlight = null;
        invalidatedInFlight = null;
        loadedKey = null;
        emit({ status: "idle" });
      }
      context = { key, squadId };
      return run(false);
    },
  };
}
