import * as FileSystem from "expo-file-system/legacy";

export const FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES = 5 * 1024 * 1024;
export const FRIEND_CHAT_IMAGE_PROCESSED_LIMIT_BYTES = 3 * 1024 * 1024;
export const FRIEND_CHAT_IMAGE_THUMBNAIL_LIMIT_BYTES = 512 * 1024;
export const FRIEND_CHAT_IMAGE_MAX_EDGE = 1600;
export const FRIEND_CHAT_IMAGE_THUMBNAIL_EDGE = 512;

const SUPPORTED_SOURCE_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export type LocalFriendChatImageDraft = {
  full: FriendChatImageVariantDraft;
  sourceMimeType: string | null;
  sourceSizeBytes: number;
  thumbnail: FriendChatImageVariantDraft;
};

export type FriendChatImageVariantDraft = {
  height: number;
  mimeType: "image/jpeg";
  sizeBytes: number;
  uri: string;
  width: number;
};

export type FriendChatImagePickResult =
  | { status: "cancelled" }
  | { draft: LocalFriendChatImageDraft; status: "selected" };

type ExpoImagePickerModule = {
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<{
    assets?: Array<{
      fileName?: string | null;
      fileSize?: number | null;
      height?: number | null;
      mimeType?: string | null;
      type?: string | null;
      uri?: string | null;
      width?: number | null;
    }>;
    canceled?: boolean;
    cancelled?: boolean;
  }>;
};

type ExpoImageManipulatorModule = {
  SaveFormat?: { JPEG?: "jpeg" };
  manipulateAsync: (
    uri: string,
    actions: Array<{ resize: { height?: number; width?: number } }>,
    options: { compress: number; format: "jpeg" },
  ) => Promise<{ height: number; uri: string; width: number }>;
};

export async function pickFriendChatImageDraft(): Promise<FriendChatImagePickResult> {
  const imagePicker = loadImagePicker();
  const imageManipulator = loadImageManipulator();
  const result = await imagePicker.launchImageLibraryAsync({
    allowsEditing: false,
    allowsMultipleSelection: false,
    exif: false,
    mediaTypes: ["images"],
    quality: 1,
  });
  if (result.canceled === true || result.cancelled === true) return { status: "cancelled" };
  const asset = result.assets?.[0];
  const uri = typeof asset?.uri === "string" ? asset.uri : "";
  if (!uri) throw new Error("image_picker_failed");
  const sourceMimeType = normalizeSourceMimeType(asset?.mimeType, asset?.fileName, uri);
  if (!sourceMimeType || !SUPPORTED_SOURCE_MIME_TYPES.has(sourceMimeType)) throw new Error("unsupported_image_type");
  const sourceSizeBytes = await fileSize(uri, asset?.fileSize ?? undefined);
  if (sourceSizeBytes < 1 || sourceSizeBytes > FRIEND_CHAT_IMAGE_SOURCE_LIMIT_BYTES) throw new Error("image_source_too_large");
  const sourceWidth = Number.isFinite(asset?.width) ? Number(asset?.width) : FRIEND_CHAT_IMAGE_MAX_EDGE;
  const sourceHeight = Number.isFinite(asset?.height) ? Number(asset?.height) : FRIEND_CHAT_IMAGE_MAX_EDGE;
  const full = await manipulateImageVariant(imageManipulator, uri, sourceWidth, sourceHeight, FRIEND_CHAT_IMAGE_MAX_EDGE, 0.82);
  if (full.sizeBytes > FRIEND_CHAT_IMAGE_PROCESSED_LIMIT_BYTES) throw new Error("image_processing_too_large");
  const thumbnail = await manipulateImageVariant(imageManipulator, uri, sourceWidth, sourceHeight, FRIEND_CHAT_IMAGE_THUMBNAIL_EDGE, 0.72);
  if (thumbnail.sizeBytes > FRIEND_CHAT_IMAGE_THUMBNAIL_LIMIT_BYTES) throw new Error("image_thumbnail_too_large");
  return {
    draft: {
      full,
      sourceMimeType,
      sourceSizeBytes,
      thumbnail,
    },
    status: "selected",
  };
}

export async function deleteFriendChatImageDraft(draft: LocalFriendChatImageDraft | null) {
  if (!draft) return;
  await Promise.allSettled([draft.full.uri, draft.thumbnail.uri].map(async (uri) => {
    if (uri) await FileSystem.deleteAsync(uri, { idempotent: true });
  }));
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

async function manipulateImageVariant(
  imageManipulator: ExpoImageManipulatorModule,
  uri: string,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
  compress: number,
): Promise<FriendChatImageVariantDraft> {
  const resize = resizeAction(sourceWidth, sourceHeight, maxEdge);
  const result = await imageManipulator.manipulateAsync(uri, resize ? [resize] : [], {
    compress,
    format: imageManipulator.SaveFormat?.JPEG ?? "jpeg",
  });
  const sizeBytes = await fileSize(result.uri);
  return {
    height: result.height,
    mimeType: "image/jpeg",
    sizeBytes,
    uri: result.uri,
    width: result.width,
  };
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
