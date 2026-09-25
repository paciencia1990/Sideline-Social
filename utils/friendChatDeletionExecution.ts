export type FriendChatDeletionExecutionResult = {
  backend: "confirmed";
  localCleanup: "complete" | "failed";
  localCleanupCode: FriendChatDeletionDiagnosticCode | null;
};

export type FriendChatDeletionDiagnosticCode =
  | "canceled"
  | "io"
  | "permission"
  | "unavailable"
  | "unknown";

export async function executeFriendChatDeletion(input: {
  deleteFromBackend: () => Promise<unknown>;
  cleanupLocalArtifacts: () => Promise<unknown>;
}): Promise<FriendChatDeletionExecutionResult> {
  await input.deleteFromBackend();

  try {
    await input.cleanupLocalArtifacts();
    return { backend: "confirmed", localCleanup: "complete", localCleanupCode: null };
  } catch (error) {
    return {
      backend: "confirmed",
      localCleanup: "failed",
      localCleanupCode: friendChatDeletionDiagnosticCode(error),
    };
  }
}

export function friendChatDeletionDiagnosticCode(error: unknown): FriendChatDeletionDiagnosticCode {
  const rawCode = typeof error === "object" && error && "code" in error
    ? String(error.code).toLowerCase()
    : error instanceof Error
      ? error.message.toLowerCase()
      : "";
  if (rawCode.includes("cancel")) return "canceled";
  if (rawCode.includes("permission") || rawCode.includes("unauthorized")) return "permission";
  if (rawCode.includes("unavailable") || rawCode.includes("not-found")) return "unavailable";
  if (rawCode.includes("file") || rawCode.includes("io") || rawCode.includes("cache")) return "io";
  return "unknown";
}
