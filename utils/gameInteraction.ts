export const GAME_BUTTON_HIT_SLOP = 4;
export const TRIVIA_FEEDBACK_MS = 600;
export const TRIVIA_ACCESSIBLE_FEEDBACK_MS = 1600;

export function getTriviaAdvanceDelay(input: {
  nowMs: number;
  questionEndsAtMs: number;
  revealedAtMs: number | null;
  screenReaderEnabled: boolean;
}) {
  const deadline = input.revealedAtMs === null
    ? input.questionEndsAtMs + 100
    : input.revealedAtMs + (input.screenReaderEnabled ? TRIVIA_ACCESSIBLE_FEEDBACK_MS : TRIVIA_FEEDBACK_MS);
  return Math.max(0, deadline - input.nowMs);
}

export function bombViewMatchesPublicState(
  view: { commandId: string; defuserUserId: string; expertUserId: string; strikeCount: number; outcome: string; endsAtMs: number; lastResult: { resolvedAt: number } | null } | null,
  session: { gameState: Record<string, unknown>; endsAt?: number | null },
) {
  if (!view) return false;
  const game = session.gameState;
  const assignment = game.roleAssignment as { defuserUserId?: unknown; expertUserId?: unknown } | null;
  const result = game.lastResult as { resolvedAt?: unknown } | null;
  return view.commandId === game.currentCommandId &&
    view.defuserUserId === assignment?.defuserUserId &&
    view.expertUserId === assignment?.expertUserId &&
    view.strikeCount === game.strikeCount &&
    view.outcome === (game.outcome ?? 'playing') &&
    view.endsAtMs === session.endsAt &&
    (view.lastResult?.resolvedAt ?? null) === (result?.resolvedAt ?? null);
}

export type ReadyToggleState<E extends string> = {
  ready: boolean;
  pending: boolean;
  error: E | null;
};

export function createReadyToggleController<E extends string>(input: {
  writeReady: (ready: boolean) => Promise<unknown>;
  onChange: (state: ReadyToggleState<E>) => void;
  classifyError: (error: unknown) => E;
}) {
  let confirmed = false;
  let desired: boolean | null = null;
  let pending: Promise<void> | null = null;
  let error: E | null = null;
  let generation = 0;
  const getState = (): ReadyToggleState<E> => ({ ready: desired ?? confirmed, pending: pending !== null, error });
  const publish = () => input.onChange(getState());
  return {
    getState,
    updateConfirmed(ready: boolean) {
      confirmed = ready;
      if (!pending && desired === ready) desired = null;
      publish();
    },
    toggle() {
      if (pending) return pending;
      const requestGeneration = ++generation;
      const next = !getState().ready;
      desired = next;
      error = null;
      // Assign the promise before publishing, so even a synchronous repeat tap
      // sees the pending request and cannot toggle back.
      pending = Promise.resolve().then(() => generation === requestGeneration ? input.writeReady(next) : undefined).then(() => {
        if (generation !== requestGeneration) return;
        if (confirmed === next) desired = null;
      }).catch((failure) => {
        if (generation !== requestGeneration) return;
        desired = null;
        error = confirmed === next ? null : input.classifyError(failure);
      }).finally(() => {
        if (generation !== requestGeneration) return;
        pending = null;
        publish();
      });
      publish();
      return pending;
    },
    dispose() { generation += 1; pending = null; },
  };
}
