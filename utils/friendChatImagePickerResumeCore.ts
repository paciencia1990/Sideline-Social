export const FRIEND_CHAT_IMAGE_PICKER_RETURN_ROUTE = "/(social)/chat/[chatId]" as const;
export const FRIEND_CHAT_IMAGE_PICKER_RETURN_TTL_MS = 10 * 60 * 1000;

export type FriendChatImagePickerReturnIntent = {
  conversationId: string;
  createdAt: number;
  expiresAt: number;
  operation: "friend-chat-image-picker";
  operationId: string;
  phase: FriendChatImagePickerPhase;
  route: typeof FRIEND_CHAT_IMAGE_PICKER_RETURN_ROUTE;
  uid: string;
  version: 1;
};

export type FriendChatImagePickerPhase =
  | "launched"
  | "picker-result-received"
  | "processing"
  | "draft-ready"
  | "cancelled"
  | "failed";

export type FriendChatImagePickerHandoffVariant = {
  height: number;
  mimeType: "image/jpeg";
  sizeBytes: number;
  uri: string;
  width: number;
};

export type FriendChatImagePickerHandoffDraft = {
  full: FriendChatImagePickerHandoffVariant;
  mediaProfileVersion: 2;
  sourceMimeType: string | null;
  sourceSizeBytes: number;
  thumbnail: FriendChatImagePickerHandoffVariant;
};

type FriendChatImagePickerHandoffBase = {
  conversationId: string;
  createdAt: number;
  expiresAt: number;
  operationId: string;
  uid: string;
  version: 1;
};

export type FriendChatImagePickerHandoff =
  | (FriendChatImagePickerHandoffBase & { status: "cancelled" })
  | (FriendChatImagePickerHandoffBase & {
      errorCode: FriendChatImagePickerFailureCode;
      status: "failed";
    })
  | (FriendChatImagePickerHandoffBase & {
      draft: FriendChatImagePickerHandoffDraft;
      status: "selected";
    });

export type FriendChatImagePickerFailureCode =
  | "image_feature_build_required"
  | "image_picker_failed"
  | "image_processing_too_large"
  | "image_source_too_large"
  | "image_thumbnail_too_large"
  | "unsupported_image_type";

type CreateFriendChatImagePickerReturnIntentInput = {
  conversationId: string;
  now?: number;
  operationId: string;
  uid: string;
};

export function createFriendChatImagePickerReturnIntent({
  conversationId,
  now = Date.now(),
  operationId,
  uid,
}: CreateFriendChatImagePickerReturnIntentInput): FriendChatImagePickerReturnIntent {
  if (!isSafeIdentifier(uid, 128) || !isSafeIdentifier(conversationId, 256)) {
    throw new Error("image_picker_invalid_return_intent");
  }
  if (!/^[A-Za-z0-9_-]{16,128}$/u.test(operationId)) {
    throw new Error("image_picker_invalid_operation");
  }
  return {
    conversationId,
    createdAt: now,
    expiresAt: now + FRIEND_CHAT_IMAGE_PICKER_RETURN_TTL_MS,
    operation: "friend-chat-image-picker",
    operationId,
    phase: "launched",
    route: FRIEND_CHAT_IMAGE_PICKER_RETURN_ROUTE,
    uid,
    version: 1,
  };
}

export function parseFriendChatImagePickerReturnIntent(
  raw: string,
  now = Date.now(),
): FriendChatImagePickerReturnIntent | null {
  try {
    const value = JSON.parse(raw) as Partial<FriendChatImagePickerReturnIntent>;
    if (
      value.version !== 1 ||
      value.operation !== "friend-chat-image-picker" ||
      value.route !== FRIEND_CHAT_IMAGE_PICKER_RETURN_ROUTE ||
      !isFriendChatImagePickerPhase(value.phase) ||
      !isSafeIdentifier(value.uid, 128) ||
      !isSafeIdentifier(value.conversationId, 256) ||
      typeof value.operationId !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(value.operationId) ||
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.expiresAt) ||
      value.createdAt > now ||
      value.expiresAt <= now ||
      value.expiresAt - value.createdAt !== FRIEND_CHAT_IMAGE_PICKER_RETURN_TTL_MS
    ) return null;
    return value as FriendChatImagePickerReturnIntent;
  } catch {
    return null;
  }
}

export function createFriendChatImagePickerHandoff(
  intent: FriendChatImagePickerReturnIntent,
  result:
    | { status: "cancelled" }
    | { errorCode: FriendChatImagePickerFailureCode; status: "failed" }
    | { draft: FriendChatImagePickerHandoffDraft; status: "selected" },
  now = Date.now(),
): FriendChatImagePickerHandoff {
  if (now < intent.createdAt || now >= intent.expiresAt) {
    throw new Error("image_picker_handoff_expired");
  }
  return {
    conversationId: intent.conversationId,
    createdAt: now,
    expiresAt: intent.expiresAt,
    operationId: intent.operationId,
    uid: intent.uid,
    version: 1,
    ...result,
  } as FriendChatImagePickerHandoff;
}

export function parseFriendChatImagePickerHandoff(
  raw: string,
  now = Date.now(),
  options: { allowExpired?: boolean } = {},
): FriendChatImagePickerHandoff | null {
  try {
    const value = JSON.parse(raw) as Partial<FriendChatImagePickerHandoff>;
    if (
      value.version !== 1 ||
      !isSafeIdentifier(value.uid, 128) ||
      !isSafeIdentifier(value.conversationId, 256) ||
      typeof value.operationId !== "string" ||
      !/^[A-Za-z0-9_-]{16,128}$/u.test(value.operationId) ||
      typeof value.createdAt !== "number" ||
      !Number.isFinite(value.createdAt) ||
      typeof value.expiresAt !== "number" ||
      !Number.isFinite(value.expiresAt) ||
      value.createdAt > now ||
      value.expiresAt - value.createdAt > FRIEND_CHAT_IMAGE_PICKER_RETURN_TTL_MS ||
      (!options.allowExpired && value.expiresAt <= now)
    ) return null;

    if (value.status === "cancelled") return value as FriendChatImagePickerHandoff;
    if (
      value.status === "failed" &&
      isFriendChatImagePickerFailureCode(value.errorCode)
    ) return value as FriendChatImagePickerHandoff;
    if (value.status === "selected" && isHandoffDraft(value.draft)) {
      return value as FriendChatImagePickerHandoff;
    }
    return null;
  } catch {
    return null;
  }
}

export function isFriendChatImagePickerHandoffForIntent(
  handoff: FriendChatImagePickerHandoff,
  intent: FriendChatImagePickerReturnIntent,
) {
  return handoff.uid === intent.uid &&
    handoff.conversationId === intent.conversationId &&
    handoff.operationId === intent.operationId &&
    handoff.expiresAt === intent.expiresAt;
}

export function isFriendChatImagePickerReturnForContext(
  intent: FriendChatImagePickerReturnIntent,
  input: { conversationId: string; uid: string },
) {
  return intent.uid === input.uid && intent.conversationId === input.conversationId;
}

function isSafeIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001F\u007F/]/u.test(value);
}

function isFriendChatImagePickerPhase(value: unknown): value is FriendChatImagePickerPhase {
  return [
    "launched",
    "picker-result-received",
    "processing",
    "draft-ready",
    "cancelled",
    "failed",
  ].includes(String(value));
}

function isFriendChatImagePickerFailureCode(
  value: unknown,
): value is FriendChatImagePickerFailureCode {
  return [
    "image_feature_build_required",
    "image_picker_failed",
    "image_processing_too_large",
    "image_source_too_large",
    "image_thumbnail_too_large",
    "unsupported_image_type",
  ].includes(String(value));
}

function isHandoffDraft(value: unknown): value is FriendChatImagePickerHandoffDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<FriendChatImagePickerHandoffDraft>;
  return isHandoffVariant(draft.full) &&
    draft.mediaProfileVersion === 2 &&
    isHandoffVariant(draft.thumbnail) &&
    (draft.sourceMimeType === null || (
      typeof draft.sourceMimeType === "string" &&
      draft.sourceMimeType.length > 0 &&
      draft.sourceMimeType.length <= 128
    )) &&
    isPositiveInteger(draft.sourceSizeBytes, 10 * 1024 * 1024);
}

function isHandoffVariant(value: unknown): value is FriendChatImagePickerHandoffVariant {
  if (!value || typeof value !== "object") return false;
  const variant = value as Partial<FriendChatImagePickerHandoffVariant>;
  return variant.mimeType === "image/jpeg" &&
    isLocalFileUri(variant.uri) &&
    isPositiveInteger(variant.width, 50_000) &&
    isPositiveInteger(variant.height, 50_000) &&
    isPositiveInteger(variant.sizeBytes, 10 * 1024 * 1024);
}

function isPositiveInteger(value: unknown, maximum: number) {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= maximum;
}

function isLocalFileUri(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2048 &&
    /^(?:file|content):\/\//u.test(value);
}
