export type TeamLifecycleStatus = "active" | "archived";

export type TeamLifecycleRequestResult = {
  inviteCode: string | null;
  reconciliationComplete: boolean;
  status: TeamLifecycleStatus;
};

export async function executeTeamLifecycleRequest(input: {
  desiredStatus: TeamLifecycleStatus;
  readPersistedState: () => Promise<{ inviteCode: string | null; status: TeamLifecycleStatus } | null>;
  request: () => Promise<{ inviteCode: string | null; status: TeamLifecycleStatus }>;
}): Promise<TeamLifecycleRequestResult> {
  try {
    const result = await input.request();
    return { ...result, reconciliationComplete: true };
  } catch (requestError) {
    try {
      const persisted = await input.readPersistedState();
      if (persisted?.status === input.desiredStatus) {
        return { ...persisted, reconciliationComplete: false };
      }
    } catch {
      // Preserve the original callable failure. A read failure is not evidence
      // that the requested lifecycle change did or did not persist.
    }
    throw requestError;
  }
}
