type ExpoFileSystemModule = typeof import("expo-file-system");

function getFileSystem() {
  return require("expo-file-system") as ExpoFileSystemModule;
}

export async function deleteLocalVoiceMemo(uri: string) {
  await getFileSystem().deleteAsync(uri, { idempotent: true });
}

export async function getLocalVoiceMemoSize(uri: string) {
  const info = await getFileSystem().getInfoAsync(uri, { size: true });
  return info.exists && "size" in info ? Number(info.size ?? 0) : 0;
}
