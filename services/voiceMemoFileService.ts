type ExpoFileSystemModule = typeof import("expo-file-system/legacy");

function getFileSystem() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Deferred loading preserves compatibility with older native clients.
  return require("expo-file-system/legacy") as ExpoFileSystemModule;
}

export async function deleteLocalVoiceMemo(uri: string) {
  await getFileSystem().deleteAsync(uri, { idempotent: true });
}

export async function getLocalVoiceMemoSize(uri: string) {
  const info = await getFileSystem().getInfoAsync(uri);
  return info.exists && "size" in info ? Number(info.size ?? 0) : 0;
}
