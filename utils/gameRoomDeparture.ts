export type GameRoomDepartureCoordinator = {
  depart: () => Promise<void>;
  hasDeparted: () => boolean;
  markDeparted: () => void;
};

export type GameRoomDepartureNavigationState<TError> = {
  departed: boolean;
  departing: boolean;
  error: TError | null;
  hasPendingNavigation: boolean;
};

export type GameRoomDepartureNavigationController<TError> = {
  depart: () => Promise<boolean>;
  departAndNavigate: (navigate: () => void) => Promise<boolean>;
  handlePreventedRemoval: (action: unknown, resumeNavigation: () => void) => Promise<boolean>;
  retryDeparture: () => Promise<boolean>;
  continueWithinRoom: (navigate: (params: RetainedGameRoomNavigationParams) => void) => void;
  getState: () => GameRoomDepartureNavigationState<TError>;
  hasDeparted: () => boolean;
  markDeparted: () => void;
};

export type RetainedGameRoomNavigationParams = {
  __gameRoomTransition: string;
};

type CreateGameRoomDepartureNavigationControllerOptions<TError> = {
  leaveRoom: () => Promise<unknown>;
  classifyError: (error: unknown) => TError;
  onStateChange?: (state: GameRoomDepartureNavigationState<TError>) => void;
};

export function createGameRoomDepartureCoordinator(
  leaveRoom: () => Promise<unknown>,
): GameRoomDepartureCoordinator {
  let completed = false;
  let inFlight: Promise<void> | null = null;

  return {
    depart() {
      if (completed) return Promise.resolve();
      if (inFlight) return inFlight;

      inFlight = Promise.resolve()
        .then(leaveRoom)
        .then(() => {
          completed = true;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },
    hasDeparted() {
      return completed;
    },
    markDeparted() {
      completed = true;
    },
  };
}

export function createGameRoomDepartureNavigationController<TError>({
  leaveRoom,
  classifyError,
  onStateChange,
}: CreateGameRoomDepartureNavigationControllerOptions<TError>): GameRoomDepartureNavigationController<TError> {
  const coordinator = createGameRoomDepartureCoordinator(leaveRoom);
  let navigationAttempt = 0;
  let pendingNavigation: (() => void) | null = null;
  let retainedTransitionAttempt = 0;
  let retainedTransitionToken: string | null = null;
  let state: GameRoomDepartureNavigationState<TError> = {
    departed: false,
    departing: false,
    error: null,
    hasPendingNavigation: false,
  };

  const updateState = (update: Partial<GameRoomDepartureNavigationState<TError>>) => {
    state = { ...state, ...update };
    onStateChange?.(state);
  };

  const depart = async () => {
    if (coordinator.hasDeparted()) return true;
    updateState({ departing: true, error: null });
    try {
      await coordinator.depart();
      updateState({ departed: true, departing: false, error: null });
      return true;
    } catch (error) {
      updateState({ departing: false, error: classifyError(error) });
      return false;
    }
  };

  const departAndNavigate = async (navigate: () => void) => {
    const attempt = ++navigationAttempt;
    pendingNavigation = navigate;
    updateState({ hasPendingNavigation: true });
    if (!(await depart())) return false;
    if (attempt !== navigationAttempt) return true;

    pendingNavigation = null;
    updateState({ hasPendingNavigation: false });
    navigate();
    return true;
  };

  return {
    depart,
    departAndNavigate,
    async handlePreventedRemoval(action, resumeNavigation) {
      const retainedToken = retainedTransitionToken;
      retainedTransitionToken = null;
      if (retainedToken && navigationActionHasTransitionToken(action, retainedToken)) {
        resumeNavigation();
        return true;
      }
      if (coordinator.hasDeparted()) {
        resumeNavigation();
        return true;
      }
      return departAndNavigate(resumeNavigation);
    },
    retryDeparture() {
      return pendingNavigation ? departAndNavigate(pendingNavigation) : Promise.resolve(false);
    },
    continueWithinRoom(navigate) {
      const token = String(++retainedTransitionAttempt);
      retainedTransitionToken = token;
      try {
        navigate({ __gameRoomTransition: token });
      } catch (error) {
        if (retainedTransitionToken === token) retainedTransitionToken = null;
        throw error;
      }
    },
    getState() {
      return state;
    },
    hasDeparted() {
      return coordinator.hasDeparted();
    },
    markDeparted() {
      navigationAttempt += 1;
      retainedTransitionToken = null;
      coordinator.markDeparted();
      pendingNavigation = null;
      updateState({
        departed: true,
        departing: false,
        error: null,
        hasPendingNavigation: false,
      });
    },
  };
}

function navigationActionHasTransitionToken(action: unknown, expectedToken: string) {
  const pending: unknown[] = [action];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    const record = value as Record<string, unknown>;
    if (record.__gameRoomTransition === expectedToken) return true;
    for (const nested of Object.values(record)) pending.push(nested);
  }
  return false;
}
