import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import { clearVoicePlaybackUrlCache } from "@/utils/voicePlaybackCore";
import { clearLocalUserStateWithDependencies } from "@/utils/localUserStateCore";

export async function clearSignedInUserLocalState() {
  await clearLocalUserStateWithDependencies({
    clearInMemoryState: clearVoicePlaybackUrlCache,
    clearNotificationResponse: () => Notifications.clearLastNotificationResponseAsync(),
    getAllStorageKeys: () => AsyncStorage.getAllKeys(),
    removeStorageKeys: (keys) => AsyncStorage.multiRemove([...keys]),
  });
}
