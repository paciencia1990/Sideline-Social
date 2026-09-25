export type FriendChatPhotoUploadStage =
  | "authentication"
  | "reservation"
  | "main-local-read"
  | "main-transfer"
  | "main-verification"
  | "thumbnail-local-read"
  | "thumbnail-transfer"
  | "thumbnail-verification"
  | "finalization";

export type FriendChatPhotoUploadCode =
  | "auth-missing"
  | "auth-anonymous"
  | "auth-refresh-failed"
  | "auth-account-changed"
  | "local-uri-invalid"
  | "local-read-failed"
  | "local-size-mismatch"
  | "storage-unauthenticated"
  | "storage-unauthorized"
  | "storage-canceled"
  | "storage-retry-limit-exceeded"
  | "storage-quota-exceeded"
  | "storage-invalid-checksum"
  | "transfer-failed"
  | "upload-verification-failed"
  | "callable-unauthenticated"
  | "callable-permission-denied"
  | "callable-failed-precondition"
  | "callable-unavailable"
  | "unknown";

export class FriendChatPhotoUploadDiagnosticError extends Error {
  readonly diagnosticCode: FriendChatPhotoUploadCode;
  readonly stage: FriendChatPhotoUploadStage;

  constructor(stage: FriendChatPhotoUploadStage, diagnosticCode: FriendChatPhotoUploadCode) {
    super("friend_chat_photo_upload_failed");
    this.name = "FriendChatPhotoUploadDiagnosticError";
    this.stage = stage;
    this.diagnosticCode = diagnosticCode;
  }
}

export function createFriendChatPhotoUploadDiagnostic(
  stage: FriendChatPhotoUploadStage,
  error: unknown,
) {
  if (error instanceof FriendChatPhotoUploadDiagnosticError) return error;
  return new FriendChatPhotoUploadDiagnosticError(stage, classifyFriendChatPhotoUploadCode(error));
}

export async function withFriendChatPhotoUploadDiagnostic<T>(
  stage: FriendChatPhotoUploadStage,
  operation: () => Promise<T>,
) {
  try {
    return await operation();
  } catch (error) {
    throw createFriendChatPhotoUploadDiagnostic(stage, error);
  }
}

export function recordFriendChatPhotoUploadDiagnostic(error: unknown) {
  if (!(error instanceof FriendChatPhotoUploadDiagnosticError)) return false;
  // Do not add the underlying error, path, account, conversation, reservation,
  // URL, or provider response. This line is intentionally safe for device logs.
  console.warn(`[friend-chat-photo-upload] stage=${error.stage} code=${error.diagnosticCode}`);
  return true;
}

function classifyFriendChatPhotoUploadCode(error: unknown): FriendChatPhotoUploadCode {
  const code = readCode(error);
  const message = error instanceof Error ? error.message : "";

  if (message === "photo_upload_auth_missing") return "auth-missing";
  if (message === "photo_upload_auth_anonymous") return "auth-anonymous";
  if (message === "photo_upload_auth_refresh_failed") return "auth-refresh-failed";
  if (message === "photo_upload_auth_changed") return "auth-account-changed";
  if (message === "invalid_local_media_uri") return "local-uri-invalid";
  if (message === "media_local_read_failed" || message === "media_local_read_timeout") return "local-read-failed";
  if (message === "media_upload_canceled") return "storage-canceled";
  if (message === "media_upload_size_mismatch") return "local-size-mismatch";
  if (message === "media_upload_verification_failed") return "upload-verification-failed";
  if (code.includes("storage/unauthenticated")) return "storage-unauthenticated";
  if (code.includes("storage/unauthorized")) return "storage-unauthorized";
  if (code.includes("storage/canceled")) return "storage-canceled";
  if (code.includes("storage/retry-limit-exceeded")) return "storage-retry-limit-exceeded";
  if (code.includes("storage/quota-exceeded")) return "storage-quota-exceeded";
  if (code.includes("storage/invalid-checksum")) return "storage-invalid-checksum";
  if (code.includes("functions/unauthenticated")) return "callable-unauthenticated";
  if (code.includes("functions/permission-denied")) return "callable-permission-denied";
  if (code.includes("functions/failed-precondition")) return "callable-failed-precondition";
  if (code.includes("functions/unavailable") || code.includes("functions/deadline-exceeded")) {
    return "callable-unavailable";
  }
  if (code.startsWith("storage/")) return "transfer-failed";
  return "unknown";
}

function readCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? String(error.code).trim().toLowerCase()
    : "";
}
