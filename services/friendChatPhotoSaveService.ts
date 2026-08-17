import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

import { auth } from "@/config/firebase";
import { fetchMyAccountStanding } from "@/services/accountStandingService";
import {
  getFriendChatMediaDownloadUrl,
  getFriendConversationAccess,
} from "@/services/chatService";
import {
  createFriendChatPhotoSaver,
  FriendChatPhotoSaveError,
  type FriendChatPhotoSaveInput,
} from "@/utils/friendChatPhotoSaveCore";

type MediaLibraryPermissionResult = {
  canAskAgain: boolean;
  granted: boolean;
};

type ExpoMediaLibraryModule = {
  getPermissionsAsync: (
    writeOnly?: boolean,
    granularPermissions?: Array<"audio" | "photo" | "video">,
  ) => Promise<MediaLibraryPermissionResult>;
  requestPermissionsAsync: (
    writeOnly?: boolean,
    granularPermissions?: Array<"audio" | "photo" | "video">,
  ) => Promise<MediaLibraryPermissionResult>;
  saveToLibraryAsync: (localUri: string) => Promise<void>;
};

function loadMediaLibrary(): ExpoMediaLibraryModule {
  try {
    return require("expo-media-library/legacy") as ExpoMediaLibraryModule;
  } catch {
    throw new FriendChatPhotoSaveError("photo_save_build_required");
  }
}

const savePhoto = createFriendChatPhotoSaver({
  authorize: async (input) => {
    if (auth.currentUser?.uid !== input.uid) return false;
    const [standing, access] = await Promise.all([
      fetchMyAccountStanding(),
      getFriendConversationAccess(input.conversationId),
    ]);
    if (auth.currentUser?.uid !== input.uid || standing.status !== "active") return false;
    if (!access || access.member.status !== "active" || !access.member.joinedAt) return false;
    if (access.blockedUserIds.length > 0) return false;
    return access.conversation.conversationType !== "direct" || access.directFriendshipActive;
  },
  cleanup: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
  createTemporaryUri: () => {
    if (!FileSystem.cacheDirectory) throw new Error("photo_save_failed");
    return `${FileSystem.cacheDirectory}friend-chat-photo-${Crypto.randomUUID()}.jpg`;
  },
  download: async (url, temporaryUri) => {
    const result = await FileSystem.downloadAsync(url, temporaryUri);
    return { status: result.status };
  },
  getDownloadUrl: async (input) => {
    const result = await getFriendChatMediaDownloadUrl({
      messageId: input.messageId,
      storagePath: input.storagePath,
    });
    return result.url;
  },
  getPermission: () => loadMediaLibrary().getPermissionsAsync(true, ["photo"]),
  requestPermission: () => loadMediaLibrary().requestPermissionsAsync(true, ["photo"]),
  save: (temporaryUri) => loadMediaLibrary().saveToLibraryAsync(temporaryUri),
});

export function saveFriendChatPhoto(input: FriendChatPhotoSaveInput) {
  return savePhoto(input);
}
