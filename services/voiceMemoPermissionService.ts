export type VoicePermissionResponse = {
  canAskAgain?: boolean;
  granted: boolean;
};

export type VoicePermissionApi = {
  getRecordingPermissionsAsync: () => Promise<VoicePermissionResponse>;
  requestRecordingPermissionsAsync: () => Promise<VoicePermissionResponse>;
};

export type VoicePermissionOutcome = "granted" | "denied" | "settings" | "error";

export type VoicePermissionResult = {
  outcome: VoicePermissionOutcome;
  permissionGranted: boolean;
  canAskAgain: boolean;
};

export async function ensureVoiceRecordingPermissionDetails(
  api: VoicePermissionApi,
): Promise<VoicePermissionResult> {
  try {
    const current = await api.getRecordingPermissionsAsync();
    if (current.granted) {
      return { outcome: "granted", permissionGranted: true, canAskAgain: current.canAskAgain !== false };
    }
    if (current.canAskAgain === false) {
      return { outcome: "settings", permissionGranted: false, canAskAgain: false };
    }

    const requested = await api.requestRecordingPermissionsAsync();
    if (requested.granted) {
      return { outcome: "granted", permissionGranted: true, canAskAgain: requested.canAskAgain !== false };
    }
    return {
      outcome: requested.canAskAgain === false ? "settings" : "denied",
      permissionGranted: false,
      canAskAgain: requested.canAskAgain !== false,
    };
  } catch {
    return { outcome: "error", permissionGranted: false, canAskAgain: false };
  }
}

export async function ensureVoiceRecordingPermission(api: VoicePermissionApi): Promise<VoicePermissionOutcome> {
  return (await ensureVoiceRecordingPermissionDetails(api)).outcome;
}
