export type TeamMessageDeletionExecutionResult = {
  backend: "confirmed";
  localCleanup: "complete" | "failed";
};

export async function executeTeamMessageDeletion(input: {
  deleteFromBackend: () => Promise<unknown>;
  cleanupLocalArtifacts: () => Promise<unknown>;
}): Promise<TeamMessageDeletionExecutionResult> {
  await input.deleteFromBackend();
  try {
    await input.cleanupLocalArtifacts();
    return { backend: "confirmed", localCleanup: "complete" };
  } catch {
    return { backend: "confirmed", localCleanup: "failed" };
  }
}
