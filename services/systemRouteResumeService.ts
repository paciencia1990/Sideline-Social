import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createFriendChatImagePickerReturnIntent,
  parseFriendChatImagePickerReturnIntent,
  type FriendChatImagePickerReturnIntent,
  type FriendChatImagePickerPhase,
} from '@/utils/friendChatImagePickerResumeCore';

const SYSTEM_ROUTE_RESUME_KEY = 'sidelineSocial.systemRouteResume';
const SYSTEM_ROUTE_RESUME_TTL_MS = 10 * 60 * 1000;
const FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY = 'sidelineSocial.friendChatImagePickerReturn.v1';

export const SQUAD_SYSTEM_RETURN_ROUTE = '/(tabs)/squad' as const;

type StoredSystemRouteResume = {
  route: typeof SQUAD_SYSTEM_RETURN_ROUTE;
  createdAt: number;
};

export async function rememberSquadSystemReturn() {
  const value: StoredSystemRouteResume = {
    route: SQUAD_SYSTEM_RETURN_ROUTE,
    createdAt: Date.now(),
  };
  await AsyncStorage.setItem(SYSTEM_ROUTE_RESUME_KEY, JSON.stringify(value));
}

export async function clearSquadSystemReturn() {
  await AsyncStorage.removeItem(SYSTEM_ROUTE_RESUME_KEY);
}

export async function consumeSystemReturnRoute(now = Date.now()) {
  const raw = await AsyncStorage.getItem(SYSTEM_ROUTE_RESUME_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(SYSTEM_ROUTE_RESUME_KEY);
  return parseSystemReturnRoute(raw, now);
}

export async function rememberFriendChatImagePickerReturn(input: {
  conversationId: string;
  operationId: string;
  uid: string;
}, now = Date.now()) {
  const existingRaw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
  const existing = existingRaw
    ? parseFriendChatImagePickerReturnIntent(existingRaw, now)
    : null;
  if (existing?.uid === input.uid) throw new Error('image_picker_in_progress');

  const intent = createFriendChatImagePickerReturnIntent({ ...input, now });
  await AsyncStorage.setItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY, JSON.stringify(intent));
  return intent;
}

export async function readFriendChatImagePickerReturn(
  uid: string,
  now = Date.now(),
): Promise<FriendChatImagePickerReturnIntent | null> {
  const raw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
  if (!raw) return null;
  const intent = parseFriendChatImagePickerReturnIntent(raw, now);
  if (intent?.uid === uid) return intent;
  await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
  return null;
}

export async function clearFriendChatImagePickerReturn(operationId: string) {
  const raw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
  if (!raw) return;
  try {
    const value = JSON.parse(raw) as { operationId?: unknown };
    if (value.operationId === operationId) {
      await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
    }
  } catch {
    await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
  }
}

export async function updateFriendChatImagePickerReturnPhase(
  operationId: string,
  phase: FriendChatImagePickerPhase,
) {
  const raw = await AsyncStorage.getItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
  if (!raw) return null;
  const intent = parseFriendChatImagePickerReturnIntent(raw);
  if (!intent || intent.operationId !== operationId) return null;
  const updated = { ...intent, phase } satisfies FriendChatImagePickerReturnIntent;
  await AsyncStorage.setItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY, JSON.stringify(updated));
  return updated;
}

export async function clearAllFriendChatImagePickerReturns() {
  await AsyncStorage.removeItem(FRIEND_CHAT_IMAGE_PICKER_RETURN_KEY);
}

export function parseSystemReturnRoute(raw: string, now = Date.now()) {
  try {
    const value = JSON.parse(raw) as Partial<StoredSystemRouteResume>;
    if (
      value.route !== SQUAD_SYSTEM_RETURN_ROUTE ||
      typeof value.createdAt !== 'number' ||
      !Number.isFinite(value.createdAt) ||
      value.createdAt > now ||
      now - value.createdAt > SYSTEM_ROUTE_RESUME_TTL_MS
    ) return null;
    return SQUAD_SYSTEM_RETURN_ROUTE;
  } catch {
    return null;
  }
}
