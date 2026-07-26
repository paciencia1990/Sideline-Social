const localPlaybackFiles = new Map<string, Set<string>>();

export function registerVoicePlaybackMediaFile(sourceKey: string, uri: string) {
  if (!sourceKey || !/^(?:file|cache):/iu.test(uri)) return false;
  const files = localPlaybackFiles.get(sourceKey) ?? new Set<string>();
  files.add(uri);
  localPlaybackFiles.set(sourceKey, files);
  return true;
}

export function takeVoicePlaybackMediaFiles(sourceKey: string) {
  const files = localPlaybackFiles.get(sourceKey);
  localPlaybackFiles.delete(sourceKey);
  return files ? Array.from(files) : [];
}
