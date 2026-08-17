export type FriendChatPhotoSaveErrorCode =
  | "photo_save_build_required"
  | "photo_save_failed"
  | "photo_save_in_progress"
  | "photo_save_network"
  | "photo_save_permission_denied"
  | "photo_save_permission_permanently_denied"
  | "photo_save_unavailable";

export type FriendChatPhotoSaveInput = {
  conversationId: string;
  messageId: string;
  storagePath: string;
  uid: string;
};

type PermissionResult = {
  canAskAgain: boolean;
  granted: boolean;
};

type FriendChatPhotoSaveDependencies = {
  authorize: (input: FriendChatPhotoSaveInput) => Promise<boolean>;
  cleanup: (uri: string) => Promise<void>;
  createTemporaryUri: () => string;
  download: (url: string, temporaryUri: string) => Promise<{ status: number }>;
  getDownloadUrl: (input: FriendChatPhotoSaveInput) => Promise<string>;
  getPermission: () => Promise<PermissionResult>;
  requestPermission: () => Promise<PermissionResult>;
  save: (temporaryUri: string) => Promise<void>;
};

export class FriendChatPhotoSaveError extends Error {
  constructor(readonly code: FriendChatPhotoSaveErrorCode) {
    super(code);
    this.name = "FriendChatPhotoSaveError";
  }
}

export function createFriendChatPhotoSaver(dependencies: FriendChatPhotoSaveDependencies) {
  const inFlight = new Set<string>();

  return async function saveFriendChatPhoto(input: FriendChatPhotoSaveInput) {
    const operationKey = `${input.uid}:${input.conversationId}:${input.messageId}`;
    if (inFlight.has(operationKey)) throw new FriendChatPhotoSaveError("photo_save_in_progress");

    inFlight.add(operationKey);
    let phase: "authorization" | "download" | "permission" | "save" = "authorization";
    let temporaryUri: string | null = null;
    try {
      if (!await dependencies.authorize(input)) {
        throw new FriendChatPhotoSaveError("photo_save_unavailable");
      }

      phase = "permission";
      let permission = await dependencies.getPermission();
      if (!permission.granted && permission.canAskAgain) {
        permission = await dependencies.requestPermission();
      }
      if (!permission.granted) {
        throw new FriendChatPhotoSaveError(permission.canAskAgain
          ? "photo_save_permission_denied"
          : "photo_save_permission_permanently_denied");
      }

      phase = "download";
      const downloadUrl = await dependencies.getDownloadUrl(input);
      temporaryUri = dependencies.createTemporaryUri();
      const downloaded = await dependencies.download(downloadUrl, temporaryUri);
      if (downloaded.status === 401 || downloaded.status === 403 || downloaded.status === 404) {
        throw new FriendChatPhotoSaveError("photo_save_unavailable");
      }
      if (downloaded.status < 200 || downloaded.status >= 300) {
        throw new FriendChatPhotoSaveError("photo_save_network");
      }

      phase = "authorization";
      if (!await dependencies.authorize(input)) {
        throw new FriendChatPhotoSaveError("photo_save_unavailable");
      }
      await dependencies.getDownloadUrl(input);

      phase = "save";
      await dependencies.save(temporaryUri);
      return { status: "saved" as const };
    } catch (error) {
      if (error instanceof FriendChatPhotoSaveError) throw error;
      if (phase === "authorization" || phase === "download") {
        throw new FriendChatPhotoSaveError(isNetworkError(error)
          ? "photo_save_network"
          : "photo_save_unavailable");
      }
      throw new FriendChatPhotoSaveError("photo_save_failed");
    } finally {
      if (temporaryUri) await dependencies.cleanup(temporaryUri).catch(() => undefined);
      inFlight.delete(operationKey);
    }
  };
}

function isNetworkError(error: unknown) {
  const value = error instanceof Error
    ? `${error.name} ${error.message}`
    : typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
  return /network|functions\/unavailable|storage\/retry-limit-exceeded|timeout/i.test(value);
}
