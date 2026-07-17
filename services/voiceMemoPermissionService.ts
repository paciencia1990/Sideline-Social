export type VoicePermissionResponse = {
  canAskAgain?: boolean;
  granted: boolean;
};

export type VoicePermissionApi = {
  getPermissionsAsync: () => Promise<VoicePermissionResponse>;
  requestPermissionsAsync: () => Promise<VoicePermissionResponse>;
};

export type VoicePermissionOutcome = "granted" | "denied" | "settings" | "error";

export async function ensureVoiceRecordingPermission(api: VoicePermissionApi): Promise<VoicePermissionOutcome> {
  try {
    const current = await api.getPermissionsAsync();
    if (current.granted) return "granted";
    if (current.canAskAgain === false) return "settings";

    const requested = await api.requestPermissionsAsync();
    if (requested.granted) return "granted";
    return requested.canAskAgain === false ? "settings" : "denied";
  } catch {
    return "error";
  }
}

