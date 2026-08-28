export const COACH_AI_RESULT_RETURN_ROUTE = "/coach/resources/help/result" as const;
export const COACH_AI_RESULT_RETURN_TTL_MS = 10 * 60 * 1000;
export const COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT = 144;
export const COACH_AI_MULTILINE_INPUT_MIN_HEIGHT = 64;

const COACH_AI_MULTILINE_FIELD_VERTICAL_RESERVE = 44;
const COACH_AI_MULTILINE_INPUT_VERTICAL_PADDING = 32;
const COACH_AI_MULTILINE_INPUT_LINE_HEIGHT = 22;

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type CoachAiResultReturnIntent = Readonly<{
  createdAt: number;
  expiresAt: number;
  requestId: string;
  route: typeof COACH_AI_RESULT_RETURN_ROUTE;
  userId: string;
}>;

export function toggleCoachAiSavedExpanded(expanded: boolean) {
  return !expanded;
}

export function resolveKeyboardRevealOffset(
  platform: "android" | "ios" | "web" | string,
  safeAreaBottom: number,
) {
  const safeBottom = Number.isFinite(safeAreaBottom) ? Math.max(0, safeAreaBottom) : 0;
  return platform === "android" ? Math.max(32, safeBottom + 16) : 16;
}

export function resolveKeyboardResponderOffset(revealOffset: number, safeAreaTop: number) {
  const safeRevealOffset = Number.isFinite(revealOffset) ? Math.max(0, revealOffset) : 0;
  const safeTop = Number.isFinite(safeAreaTop) ? Math.max(0, safeAreaTop) : 0;
  return safeRevealOffset + safeTop;
}

export function resolveCoachAiFocusedInputScrollDelta(
  inputScreenY: number,
  inputHeight: number,
  keyboardScreenY: number,
  revealOffset: number,
) {
  if (
    !Number.isFinite(inputScreenY)
    || !Number.isFinite(inputHeight)
    || !Number.isFinite(keyboardScreenY)
  ) return 0;
  const safeInputHeight = Math.max(0, inputHeight);
  const safeKeyboardScreenY = Math.max(0, keyboardScreenY);
  const safeRevealOffset = Number.isFinite(revealOffset) ? Math.max(0, revealOffset) : 0;
  return Math.max(
    0,
    Math.ceil(inputScreenY + safeInputHeight + safeRevealOffset - safeKeyboardScreenY),
  );
}

export function resolveCoachAiVisibleKeyboardViewportBottom(
  keyboardScreenY: number,
  scrollViewportScreenY: number,
  scrollViewportHeight: number,
) {
  const viewportBottom = Number.isFinite(scrollViewportScreenY) && Number.isFinite(scrollViewportHeight)
    ? Math.max(0, scrollViewportScreenY + Math.max(0, scrollViewportHeight))
    : Number.POSITIVE_INFINITY;
  const keyboardTop = Number.isFinite(keyboardScreenY) && keyboardScreenY > 0
    ? keyboardScreenY
    : Number.POSITIVE_INFINITY;
  const visibleBottom = Math.min(viewportBottom, keyboardTop);
  return Number.isFinite(visibleBottom) ? visibleBottom : 0;
}

export function resolveCoachAiKeyboardViewportSupplement(
  scrollViewportScreenY: number,
  scrollViewportHeight: number,
  visibleViewportBottom: number,
) {
  if (
    !Number.isFinite(scrollViewportScreenY)
    || !Number.isFinite(scrollViewportHeight)
    || !Number.isFinite(visibleViewportBottom)
  ) return 0;
  const scrollViewportBottom = Math.max(
    0,
    scrollViewportScreenY + Math.max(0, scrollViewportHeight),
  );
  return Math.max(0, Math.ceil(scrollViewportBottom - Math.max(0, visibleViewportBottom)));
}

export function resolveCoachAiMultilineInputHeight(
  visibleKeyboardViewportHeight: number,
  revealOffset: number,
  fontScale = 1,
) {
  if (!Number.isFinite(visibleKeyboardViewportHeight)) {
    return COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT;
  }
  const safeRevealOffset = Number.isFinite(revealOffset) ? Math.max(0, revealOffset) : 0;
  const safeFontScale = Number.isFinite(fontScale) ? Math.max(1, fontScale) : 1;
  const accessibleMinimumHeight = Math.min(
    COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT,
    Math.ceil(COACH_AI_MULTILINE_INPUT_VERTICAL_PADDING + (COACH_AI_MULTILINE_INPUT_LINE_HEIGHT * safeFontScale) + 2),
  );
  const availableHeight = Math.floor(
    Math.max(0, visibleKeyboardViewportHeight)
      - safeRevealOffset
      - COACH_AI_MULTILINE_FIELD_VERTICAL_RESERVE,
  );
  return Math.max(
    COACH_AI_MULTILINE_INPUT_MIN_HEIGHT,
    accessibleMinimumHeight,
    Math.min(COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT, availableHeight),
  );
}

export function resolveCoachAiKeyboardFrameSupplement(
  shownKeyboardScreenY: number,
  currentKeyboardScreenY: number,
) {
  if (!Number.isFinite(shownKeyboardScreenY) || !Number.isFinite(currentKeyboardScreenY)) return 0;
  return Math.max(0, Math.ceil(shownKeyboardScreenY - currentKeyboardScreenY));
}

export function resolveCoachAiShareAppStateTransition(
  wasBackgrounded: boolean,
  nextAppState: string,
) {
  if (nextAppState !== "active") {
    return { backgrounded: true, shouldClearReturn: false } as const;
  }
  return { backgrounded: false, shouldClearReturn: wasBackgrounded } as const;
}

export function shouldRetainCoachAiShareReturnAfterResponse(
  platform: string,
  responseAction: string,
  sharedAction: string,
) {
  return platform === "android" && responseAction === sharedAction;
}

export async function runCoachAiResultAction<T>({
  clearReturn,
  execute,
  rememberReturn,
}: {
  clearReturn: () => Promise<void>;
  execute: () => Promise<T>;
  rememberReturn: () => Promise<void>;
}) {
  let returnRemembered = false;
  try {
    await rememberReturn();
    returnRemembered = true;
  } catch {
    // Local resume protection must never block an explicit save or share action.
  }

  try {
    return await execute();
  } finally {
    if (returnRemembered) await clearReturn().catch(() => undefined);
  }
}

export function createCoachAiResultReturnIntent({
  now = Date.now(),
  requestId,
  userId,
}: {
  now?: number;
  requestId: string;
  userId: string;
}): CoachAiResultReturnIntent {
  if (!isSafeUserId(userId) || !REQUEST_ID_PATTERN.test(requestId) || !Number.isFinite(now)) {
    throw new Error("invalid_coach_ai_return_context");
  }
  return Object.freeze({
    createdAt: now,
    expiresAt: now + COACH_AI_RESULT_RETURN_TTL_MS,
    requestId,
    route: COACH_AI_RESULT_RETURN_ROUTE,
    userId,
  });
}

export function parseCoachAiResultReturnIntent(
  raw: string,
  now = Date.now(),
): CoachAiResultReturnIntent | null {
  try {
    const value = JSON.parse(raw) as Partial<CoachAiResultReturnIntent>;
    if (
      value.route !== COACH_AI_RESULT_RETURN_ROUTE
      || !isSafeUserId(value.userId)
      || typeof value.requestId !== "string"
      || !REQUEST_ID_PATTERN.test(value.requestId)
      || typeof value.createdAt !== "number"
      || !Number.isFinite(value.createdAt)
      || typeof value.expiresAt !== "number"
      || !Number.isFinite(value.expiresAt)
      || value.expiresAt !== value.createdAt + COACH_AI_RESULT_RETURN_TTL_MS
      || value.createdAt > now
      || value.expiresAt <= now
    ) return null;
    return Object.freeze({
      createdAt: value.createdAt,
      expiresAt: value.expiresAt,
      requestId: value.requestId,
      route: value.route,
      userId: value.userId,
    });
  } catch {
    return null;
  }
}

function isSafeUserId(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 128
    && value.trim() === value
    && !/[\\/\s]/.test(value);
}
