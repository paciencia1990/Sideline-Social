export type FriendChatPhotoUploadUser = {
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
  isAnonymous: boolean;
  uid: string;
};

export async function prepareFriendChatPhotoUploadAuth(
  getCurrentUser: () => FriendChatPhotoUploadUser | null,
  expectedUserId?: string,
) {
  const before = getCurrentUser();
  if (!before) throw new Error("photo_upload_auth_missing");
  if (before.isAnonymous) throw new Error("photo_upload_auth_anonymous");
  if (expectedUserId && before.uid !== expectedUserId) throw new Error("photo_upload_auth_changed");

  let token: string;
  try {
    token = await before.getIdToken(true);
  } catch {
    throw new Error("photo_upload_auth_refresh_failed");
  }
  const after = getCurrentUser();
  if (!token || !after || after !== before || after.uid !== before.uid || after.isAnonymous) {
    throw new Error("photo_upload_auth_changed");
  }
  if (expectedUserId && after.uid !== expectedUserId) throw new Error("photo_upload_auth_changed");
}
