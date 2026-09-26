export const APPEALABLE_ACCOUNT_ACTIONS = [
  "restrictMessaging",
  "temporarySuspend",
  "permanentBan",
] as const;

export type AppealableAccountAction = typeof APPEALABLE_ACCOUNT_ACTIONS[number];

export function isAppealableAccountAction(value: unknown): value is AppealableAccountAction {
  return typeof value === "string" &&
    APPEALABLE_ACCOUNT_ACTIONS.includes(value as AppealableAccountAction);
}

export function completedAppealableAction(data: unknown) {
  if (!data || typeof data !== "object") return false;
  const action = data as { outcome?: unknown; type?: unknown };
  return action.outcome === "completed" && isAppealableAccountAction(action.type);
}
