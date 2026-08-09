type ExpoImageCacheApi = {
  Image?: {
    clearMemoryCache?: () => Promise<boolean> | boolean;
  };
};

export async function clearFriendChatImageMemoryCache() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Best-effort cleanup for protected friend-chat thumbnails already held by expo-image.
    const { Image } = require("expo-image") as ExpoImageCacheApi;
    await Promise.resolve(Image?.clearMemoryCache?.());
  } catch {
    // Image cache cleanup is best effort. Authorization is still enforced server-side.
  }
}
