import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

import {
  createFriendChatImageCompressionAttempts,
  FRIEND_CHAT_IMAGE_MEDIA_PROFILE_VERSION,
  FRIEND_CHAT_IMAGE_PROFILE_V2,
  FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES,
  type FriendChatImageVariantProfile,
} from "@/constants/friendChatImageProfile";
import {
  clearAllFriendChatImagePickerReturns,
  clearFriendChatImagePickerReturn,
  readFriendChatImagePickerReturn,
  rememberFriendChatImagePickerReturn,
  updateFriendChatImagePickerReturnPhase,
} from "@/services/systemRouteResumeService";
import {
  createFriendChatImagePickerHandoff,
  isFriendChatImagePickerHandoffForIntent,
  isFriendChatImagePickerReturnForContext,
  parseFriendChatImagePickerHandoff,
  type FriendChatImagePickerFailureCode,
  type FriendChatImagePickerHandoff,
  type FriendChatImagePickerHandoffDraft,
  type FriendChatImagePickerHandoffVariant,
  type FriendChatImagePickerReturnIntent,
} from "@/utils/friendChatImagePickerResumeCore";
import { measureDevelopmentPerformance } from "@/utils/performanceDiagnostics";

export { FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES } from "@/constants/friendChatImageProfile";

const FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY = "sidelineSocial.friendChatImagePickerHandoff.v1";
const SUPPORTED_SOURCE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export type FriendChatImagePickerContext = {
  conversationId: string;
  uid: string;
};

export type LocalFriendChatImageDraft = FriendChatImagePickerHandoffDraft;
export type FriendChatImageVariantDraft = FriendChatImagePickerHandoffVariant;

type FriendChatImagePickResultBase = FriendChatImagePickerContext & {
  operationId: string;
};

export type FriendChatImagePickResult =
  | (FriendChatImagePickResultBase & { status: "cancelled" })
  | (FriendChatImagePickResultBase & {
      errorCode: FriendChatImagePickerFailureCode;
      status: "failed";
    })
  | (FriendChatImagePickResultBase & { status: "stale" })
  | (FriendChatImagePickResultBase & {
      draft: LocalFriendChatImageDraft;
      status: "selected";
    });

export type FriendChatImageRecoveryResult =
  | { status: "none" }
  | FriendChatImagePickResult;

type ExpoImagePickerAsset = {
  fileName?: string | null;
  fileSize?: number | null;
  height?: number | null;
  mimeType?: string | null;
  type?: string | null;
  uri?: string | null;
  width?: number | null;
};

type ExpoImagePickerSuccessResult = {
  assets?: ExpoImagePickerAsset[];
  canceled?: boolean;
  cancelled?: boolean;
};

type ExpoImagePickerErrorResult = {
  code: string;
  exception?: string;
  message: string;
};

type ExpoImagePickerResult = ExpoImagePickerSuccessResult | ExpoImagePickerErrorResult;

type ExpoImagePickerModule = {
  getPendingResultAsync: () => Promise<ExpoImagePickerResult | null>;
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<ExpoImagePickerResult>;
};

type ExpoImageManipulatorModule = {
  SaveFormat?: { JPEG?: "jpeg" };
  manipulateAsync: (
    uri: string,
    actions: Array<{ resize: { height?: number; width?: number } }>,
    options: { compress: number; format: "jpeg" },
  ) => Promise<{ height: number; uri: string; width: number }>;
};

const activePickerOperations = new Map<string, Promise<FriendChatImagePickResult>>();
const completedPickerOperations = new Map<string, FriendChatImagePickResult>();
const claimedPickerOperations = new Set<string>();
const handoffCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

export async function pickFriendChatImageDraft(
  context: FriendChatImagePickerContext,
): Promise<FriendChatImagePickResult> {
  const imagePicker = loadImagePicker();
  const imageManipulator = loadImageManipulator();
  const previousHandoffRaw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  const intent = await rememberFriendChatImagePickerReturn({
    ...context,
    operationId: createPickerOperationId(),
  });
  await removeObsoleteHandoff(previousHandoffRaw);
  logPickerLifecycle("launched");
  return runPickerOperation(intent, () => imagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    allowsMultipleSelection: false,
    exif: false,
    mediaTypes: ["images"],
    quality: 1,
  }), imageManipulator);
}

export async function readFriendChatImagePickerNavigationReturn(uid: string) {
  const handoffRaw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  const intent = await readFriendChatImagePickerReturn(uid);
  if (!intent) {
    await removeObsoleteHandoff(handoffRaw);
    return null;
  }
  if (handoffRaw) {
    const handoff = parseFriendChatImagePickerHandoff(handoffRaw);
    if (!handoff || !isFriendChatImagePickerHandoffForIntent(handoff, intent)) {
      await removeObsoleteHandoff(handoffRaw);
    }
  }
  return intent;
}

export async function recoverFriendChatImageDraft(
  context: FriendChatImagePickerContext,
): Promise<FriendChatImageRecoveryResult> {
  const intent = await readFriendChatImagePickerNavigationReturn(context.uid);
  if (!intent || !isFriendChatImagePickerReturnForContext(intent, context)) {
    return { status: "none" };
  }

  const active = activePickerOperations.get(intent.operationId);
  if (active) {
    logPickerLifecycle("joined-active-operation");
    return active;
  }

  const completed = completedPickerOperations.get(intent.operationId);
  if (completed && resultMatchesContext(completed, context)) return completed;

  const persisted = await readPersistedPickerResult(intent);
  if (persisted) {
    completedPickerOperations.set(intent.operationId, persisted);
    scheduleHandoffCleanup(intent);
    return persisted;
  }

  if (intent.phase !== "launched") {
    return completePickerFailure(intent, new Error("image_picker_failed"));
  }

  let imagePicker: ExpoImagePickerModule;
  let imageManipulator: ExpoImageManipulatorModule;
  try {
    imagePicker = loadImagePicker();
    imageManipulator = loadImageManipulator();
  } catch (error) {
    return completePickerFailure(intent, error);
  }

  if (Platform.OS !== "android") return completePickerCancellation(intent);
  if (typeof imagePicker.getPendingResultAsync !== "function") {
    return completePickerFailure(intent, new Error("image_feature_build_required"));
  }

  logPickerLifecycle("recovering-pending-result");
  return runPickerOperation(
    intent,
    () => imagePicker.getPendingResultAsync(),
    imageManipulator,
  );
}

export async function claimFriendChatImagePickerResult(
  context: FriendChatImagePickerContext,
  operationId: string,
) {
  if (claimedPickerOperations.has(operationId)) return false;
  const intent = await readFriendChatImagePickerNavigationReturn(context.uid);
  if (
    !intent ||
    intent.operationId !== operationId ||
    !isFriendChatImagePickerReturnForContext(intent, context) ||
    claimedPickerOperations.has(operationId)
  ) return false;
  claimedPickerOperations.add(operationId);
  return true;
}

export function releaseFriendChatImagePickerResult(operationId: string) {
  claimedPickerOperations.delete(operationId);
}

export async function acknowledgeFriendChatImagePickerResult(
  context: FriendChatImagePickerContext,
  operationId: string,
) {
  if (!claimedPickerOperations.has(operationId)) return false;
  const intent = await readFriendChatImagePickerNavigationReturn(context.uid);
  if (
    !intent ||
    intent.operationId !== operationId ||
    !isFriendChatImagePickerReturnForContext(intent, context)
  ) {
    claimedPickerOperations.delete(operationId);
    return false;
  }

  const completed = completedPickerOperations.get(operationId) ??
    await readPersistedPickerResult(intent);
  await removePersistedHandoff(operationId, false);
  await clearFriendChatImagePickerReturn(operationId);
  completedPickerOperations.delete(operationId);
  claimedPickerOperations.delete(operationId);
  clearHandoffCleanupTimer(operationId);
  logPickerLifecycle(completed?.status === "selected" ? "draft-consumed" : "result-consumed");
  return true;
}

export async function discardFriendChatImagePickerOperation(
  context: FriendChatImagePickerContext,
  operationId?: string,
) {
  const intent = await readFriendChatImagePickerReturn(context.uid);
  if (
    !intent ||
    !isFriendChatImagePickerReturnForContext(intent, context) ||
    (operationId && intent.operationId !== operationId)
  ) return false;
  await discardPickerOperation(intent.operationId);
  return true;
}

export async function clearFriendChatImagePickerLocalState() {
  const raw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  if (raw) await deleteHandoffDraft(parseFriendChatImagePickerHandoff(raw, Date.now(), { allowExpired: true }));
  await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  await clearAllFriendChatImagePickerReturns();
  for (const timer of handoffCleanupTimers.values()) clearTimeout(timer);
  handoffCleanupTimers.clear();
  activePickerOperations.clear();
  completedPickerOperations.clear();
  claimedPickerOperations.clear();
}

export async function deleteFriendChatImageDraft(draft: LocalFriendChatImageDraft | null) {
  if (!draft) return;
  await Promise.allSettled([draft.full.uri, draft.thumbnail.uri].map(async (uri) => {
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
  }));
}

function runPickerOperation(
  intent: FriendChatImagePickerReturnIntent,
  loadResult: () => Promise<ExpoImagePickerResult | null>,
  imageManipulator: ExpoImageManipulatorModule,
) {
  const existing = activePickerOperations.get(intent.operationId);
  if (existing) return existing;

  const operation = (async (): Promise<FriendChatImagePickResult> => {
    try {
      const result = await loadResult();
      const currentIntent = await updateFriendChatImagePickerReturnPhase(
        intent.operationId,
        "picker-result-received",
      );
      if (!currentIntent || !isSamePickerOperation(currentIntent, intent)) {
        logPickerLifecycle("ignored-stale-result");
        return resultForIntent(intent, "stale");
      }

      if (!result || isPickerCancellation(result)) {
        return completePickerCancellation(currentIntent);
      }
      if (isPickerError(result)) return completePickerFailure(currentIntent, result);

      const processingIntent = await updateFriendChatImagePickerReturnPhase(
        intent.operationId,
        "processing",
      );
      if (!processingIntent || !isSamePickerOperation(processingIntent, intent)) {
        return resultForIntent(intent, "stale");
      }
      const draft = await processPickedImage(result, imageManipulator);
      return completePickerSelection(processingIntent, draft);
    } catch (error) {
      const currentIntent = await readFriendChatImagePickerReturn(intent.uid);
      if (!currentIntent || !isSamePickerOperation(currentIntent, intent)) {
        return resultForIntent(intent, "stale");
      }
      return completePickerFailure(currentIntent, error);
    } finally {
      activePickerOperations.delete(intent.operationId);
    }
  })();
  activePickerOperations.set(intent.operationId, operation);
  return operation;
}

async function completePickerSelection(
  intent: FriendChatImagePickerReturnIntent,
  draft: LocalFriendChatImageDraft,
): Promise<FriendChatImagePickResult> {
  const result = { ...resultForIntent(intent, "selected"), draft };
  const persisted = await persistCompletedPickerResult(intent, result);
  if (persisted.status === "stale") await deleteFriendChatImageDraft(draft);
  else logPickerLifecycle("draft-ready");
  return persisted;
}

async function completePickerCancellation(
  intent: FriendChatImagePickerReturnIntent,
): Promise<FriendChatImagePickResult> {
  const result = resultForIntent(intent, "cancelled");
  const persisted = await persistCompletedPickerResult(intent, result);
  if (persisted.status !== "stale") logPickerLifecycle("cancelled");
  return persisted;
}

async function completePickerFailure(
  intent: FriendChatImagePickerReturnIntent,
  error: unknown,
): Promise<FriendChatImagePickResult> {
  const result = {
    ...resultForIntent(intent, "failed"),
    errorCode: normalizePickerFailureCode(error),
  };
  const persisted = await persistCompletedPickerResult(intent, result);
  if (persisted.status !== "stale") logPickerLifecycle("failed");
  return persisted;
}

async function persistCompletedPickerResult(
  intent: FriendChatImagePickerReturnIntent,
  result: Exclude<FriendChatImagePickResult, { status: "stale" }>,
): Promise<FriendChatImagePickResult> {
  let handoff: FriendChatImagePickerHandoff;
  try {
    handoff = createFriendChatImagePickerHandoff(intent, result);
  } catch {
    await clearFriendChatImagePickerReturn(intent.operationId);
    return resultForIntent(intent, "stale");
  }
  await AsyncStorage.setItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY, JSON.stringify(handoff));
  const currentIntent = await readFriendChatImagePickerReturn(intent.uid);
  if (!currentIntent || !isSamePickerOperation(currentIntent, intent)) {
    await removePersistedHandoff(intent.operationId, result.status === "selected");
    return resultForIntent(intent, "stale");
  }

  const phase = result.status === "selected"
    ? "draft-ready"
    : result.status === "cancelled"
      ? "cancelled"
      : "failed";
  await updateFriendChatImagePickerReturnPhase(intent.operationId, phase);
  completedPickerOperations.set(intent.operationId, result);
  scheduleHandoffCleanup(intent);
  return result;
}

async function readPersistedPickerResult(intent: FriendChatImagePickerReturnIntent) {
  const raw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  if (!raw) return null;
  const handoff = parseFriendChatImagePickerHandoff(raw);
  if (!handoff || !isFriendChatImagePickerHandoffForIntent(handoff, intent)) {
    await removeObsoleteHandoff(raw);
    return null;
  }
  return pickerResultFromHandoff(handoff);
}

function pickerResultFromHandoff(
  handoff: FriendChatImagePickerHandoff,
): FriendChatImagePickResult {
  const base = {
    conversationId: handoff.conversationId,
    operationId: handoff.operationId,
    uid: handoff.uid,
  };
  if (handoff.status === "selected") return { ...base, draft: handoff.draft, status: "selected" };
  if (handoff.status === "failed") return { ...base, errorCode: handoff.errorCode, status: "failed" };
  return { ...base, status: "cancelled" };
}

async function discardPickerOperation(operationId: string) {
  await removePersistedHandoff(operationId, true);
  await clearFriendChatImagePickerReturn(operationId);
  activePickerOperations.delete(operationId);
  completedPickerOperations.delete(operationId);
  claimedPickerOperations.delete(operationId);
  clearHandoffCleanupTimer(operationId);
}

async function removePersistedHandoff(operationId: string, deleteDraft: boolean) {
  const raw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  if (!raw) return;
  const handoff = parseFriendChatImagePickerHandoff(raw, Date.now(), { allowExpired: true });
  if (!handoff || handoff.operationId === operationId) {
    if (deleteDraft) await deleteHandoffDraft(handoff);
    await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  }
}

async function removeObsoleteHandoff(raw: string | null) {
  if (!raw) return;
  const handoff = parseFriendChatImagePickerHandoff(raw, Date.now(), { allowExpired: true });
  await deleteHandoffDraft(handoff);
  await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_HANDOFF_KEY);
  if (handoff) {
    completedPickerOperations.delete(handoff.operationId);
    claimedPickerOperations.delete(handoff.operationId);
    clearHandoffCleanupTimer(handoff.operationId);
  }
}

async function deleteHandoffDraft(handoff: FriendChatImagePickerHandoff | null) {
  if (handoff?.status === "selected") await deleteFriendChatImageDraft(handoff.draft);
}

function scheduleHandoffCleanup(intent: FriendChatImagePickerReturnIntent) {
  clearHandoffCleanupTimer(intent.operationId);
  const delay = Math.max(0, intent.expiresAt - Date.now());
  const timer = setTimeout(() => { void discardPickerOperation(intent.operationId); }, delay);
  handoffCleanupTimers.set(intent.operationId, timer);
}

function clearHandoffCleanupTimer(operationId: string) {
  const timer = handoffCleanupTimers.get(operationId);
  if (timer) clearTimeout(timer);
  handoffCleanupTimers.delete(operationId);
}

async function processPickedImage(
  result: ExpoImagePickerSuccessResult,
  imageManipulator: ExpoImageManipulatorModule,
) {
  const asset = result.assets?.[0];
  const uri = typeof asset?.uri === "string" ? asset.uri : "";
  if (!uri) throw new Error("image_picker_failed");
  const sourceMimeType = normalizeSourceMimeType(asset?.mimeType, asset?.fileName, uri);
  if (!sourceMimeType || !SUPPORTED_SOURCE_MIME_TYPES.has(sourceMimeType)) {
    throw new Error("unsupported_image_type");
  }
  const sourceSizeBytes = await fileSize(uri, asset?.fileSize ?? undefined);
  if (sourceSizeBytes < 1 || sourceSizeBytes > FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES) {
    throw new Error("image_source_too_large");
  }
  const sourceWidth = Number(asset?.width);
  const sourceHeight = Number(asset?.height);
  if (!Number.isFinite(sourceWidth) || sourceWidth < 1 || !Number.isFinite(sourceHeight) || sourceHeight < 1) {
    throw new Error("image_picker_failed");
  }

  const full = await measureDevelopmentPerformance(
    "friend-chat.image-compression",
    () => createCompressedImageVariant(
      imageManipulator,
      uri,
      sourceWidth,
      sourceHeight,
      FRIEND_CHAT_IMAGE_PROFILE_V2.display,
      "image_processing_too_large",
    ),
  );
  try {
    const thumbnail = await measureDevelopmentPerformance(
      "friend-chat.image-thumbnail",
      () => createCompressedImageVariant(
        imageManipulator,
        uri,
        sourceWidth,
        sourceHeight,
        FRIEND_CHAT_IMAGE_PROFILE_V2.thumbnail,
        "image_thumbnail_too_large",
      ),
    );
    return {
      full,
      mediaProfileVersion: FRIEND_CHAT_IMAGE_MEDIA_PROFILE_VERSION,
      sourceMimeType,
      sourceSizeBytes,
      thumbnail,
    } satisfies LocalFriendChatImageDraft;
  } catch (error) {
    await deleteTemporaryImage(full.uri);
    throw error;
  }
}

function resultForIntent<TStatus extends FriendChatImagePickResult["status"]>(
  intent: FriendChatImagePickerReturnIntent,
  status: TStatus,
) {
  return {
    conversationId: intent.conversationId,
    operationId: intent.operationId,
    status,
    uid: intent.uid,
  };
}

function resultMatchesContext(
  result: FriendChatImagePickResult,
  context: FriendChatImagePickerContext,
) {
  return result.uid === context.uid && result.conversationId === context.conversationId;
}

function isSamePickerOperation(
  first: FriendChatImagePickerReturnIntent,
  second: FriendChatImagePickerReturnIntent,
) {
  return first.uid === second.uid &&
    first.conversationId === second.conversationId &&
    first.operationId === second.operationId;
}

function createPickerOperationId() {
  const randomPart = () => Math.random().toString(36).slice(2).padEnd(12, "0");
  return `${Date.now().toString(36)}_${randomPart()}_${randomPart()}`;
}

function isPickerCancellation(result: ExpoImagePickerResult) {
  return !isPickerError(result) && (result.canceled === true || result.cancelled === true);
}

function isPickerError(result: ExpoImagePickerResult): result is ExpoImagePickerErrorResult {
  return typeof (result as ExpoImagePickerErrorResult).code === "string" &&
    typeof (result as ExpoImagePickerErrorResult).message === "string";
}

function normalizePickerFailureCode(error: unknown): FriendChatImagePickerFailureCode {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  if (message.includes("image_feature_build_required")) return "image_feature_build_required";
  if (message.includes("image_source_too_large")) return "image_source_too_large";
  if (message.includes("unsupported_image_type")) return "unsupported_image_type";
  if (message.includes("image_processing_too_large")) return "image_processing_too_large";
  if (message.includes("image_thumbnail_too_large")) return "image_thumbnail_too_large";
  return "image_picker_failed";
}

function logPickerLifecycle(event: string) {
  if (__DEV__) console.info(`[friend-chat-image-picker] ${event}`);
}

function loadImagePicker(): ExpoImagePickerModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Optional native module is loaded only when the user selects an image.
    return require("expo-image-picker") as ExpoImagePickerModule;
  } catch {
    throw new Error("image_feature_build_required");
  }
}

function loadImageManipulator(): ExpoImageManipulatorModule {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Optional native module is loaded only when the user selects an image.
    return require("expo-image-manipulator") as ExpoImageManipulatorModule;
  } catch {
    throw new Error("image_feature_build_required");
  }
}

async function createCompressedImageVariant(
  imageManipulator: ExpoImageManipulatorModule,
  uri: string,
  sourceWidth: number,
  sourceHeight: number,
  profile: FriendChatImageVariantProfile,
  failureCode: "image_processing_too_large" | "image_thumbnail_too_large",
): Promise<FriendChatImageVariantDraft> {
  const attempts = createFriendChatImageCompressionAttempts(profile);
  for (const attempt of attempts) {
    const resize = resizeAction(sourceWidth, sourceHeight, attempt.maxEdge);
    const result = await imageManipulator.manipulateAsync(uri, resize ? [resize] : [], {
      compress: attempt.quality,
      format: imageManipulator.SaveFormat?.JPEG ?? "jpeg",
    });
    const sizeBytes = await fileSize(result.uri);
    const validDimensions = Number.isInteger(result.width) &&
      Number.isInteger(result.height) &&
      result.width > 0 &&
      result.height > 0 &&
      Math.max(result.width, result.height) <= attempt.maxEdge;
    if (sizeBytes > 0 && sizeBytes <= profile.maxBytes && validDimensions) {
      return {
        height: result.height,
        mimeType: "image/jpeg",
        sizeBytes,
        uri: result.uri,
        width: result.width,
      };
    }
    await deleteTemporaryImage(result.uri);
  }
  throw new Error(failureCode);
}

async function deleteTemporaryImage(uri: string) {
  if (!uri) return;
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

function resizeAction(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= maxEdge) return null;
  return width >= height
    ? { resize: { width: maxEdge } }
    : { resize: { height: maxEdge } };
}

async function fileSize(uri: string, preferredSize?: number | null) {
  if (Number.isInteger(preferredSize) && Number(preferredSize) > 0) return Number(preferredSize);
  const info = await FileSystem.getInfoAsync(uri);
  const size = (info as { exists?: boolean; size?: number }).size;
  return Number.isInteger(size) && Number(size) > 0 ? Number(size) : 0;
}

function normalizeSourceMimeType(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (!value) continue;
    const lower = value.toLowerCase().trim();
    if (lower.includes("/")) return lower;
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".heic")) return "image/heic";
    if (lower.endsWith(".heif")) return "image/heif";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
  }
  return null;
}
