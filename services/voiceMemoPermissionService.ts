export type VoicePermissionResponse = {
  canAskAgain?: boolean;
  granted: boolean;
};

export type VoicePermissionApi = {
  getRecordingPermissionsAsync: () => Promise<VoicePermissionResponse>;
  requestRecordingPermissionsAsync: () => Promise<VoicePermissionResponse>;
};

export type VoicePermissionOutcome = "granted" | "denied" | "settings" | "error";

export async function ensureVoiceRecordingPermission(api: VoicePermissionApi): Promise<VoicePermissionOutcome> {
  try {
    const current = await api.getRecordingPermissionsAsync();
    if (current.granted) return "granted";
    if (current.canAskAgain === false) return "settings";

    const requested = await api.requestRecordingPermissionsAsync();
    if (requested.granted) return "granted";
    return requested.canAskAgain === false ? "settings" : "denied";
  } catch {
    return "error";
  }
}
