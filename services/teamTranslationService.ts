import AsyncStorage from '@react-native-async-storage/async-storage';
import { httpsCallable } from 'firebase/functions';
import * as WebBrowser from 'expo-web-browser';
import { auth, firebaseAppCheckReady, functions } from '@/config/firebase';
import { GOOGLE_TRANSLATION_INFO_URL, isTranslationLanguage } from '@/utils/teamTranslation';

export type TeamTranslationSource =
  | { kind: 'announcement'; teamId: string; messageId: string }
  | { kind: 'privateMessage'; conversationId: string; messageId: string };
export type TeamTranslationResult = { originalText: string; translatedText: string; targetLanguage: string; provider: 'Google Translate' };
const preferenceKey = (uid: string) => `@sideline_translation_language:${uid}`;
export async function openTranslationInformation() {
  const result = await WebBrowser.openBrowserAsync(GOOGLE_TRANSLATION_INFO_URL);
  if (result.type === WebBrowser.WebBrowserResultType.LOCKED) throw new Error('translation_information_unavailable');
}
export async function getTranslationLanguage(uid: string) {
  try {
    const language = await AsyncStorage.getItem(preferenceKey(uid));
    return isTranslationLanguage(language) ? language : null;
  } catch { return null; }
}
export async function saveTranslationLanguage(uid: string, language: string) {
  if (auth.currentUser?.uid !== uid || !isTranslationLanguage(language)) return;
  try { await AsyncStorage.setItem(preferenceKey(uid), language); } catch { /* Preference persistence is optional. */ }
}
export async function translateTeamMessage(source: TeamTranslationSource, language: string) {
  const uid = auth.currentUser?.uid;
  if (!uid || !isTranslationLanguage(language)) throw new Error('translation_unavailable');
  await firebaseAppCheckReady;
  if (auth.currentUser?.uid !== uid) throw new Error('translation_unavailable');
  const call = httpsCallable<
    TeamTranslationSource & { targetLanguage: string; consentVersion: 1 }, TeamTranslationResult
  >(functions, 'translateTeamMessage', { timeout: 25_000 });
  const result = (await call({ ...source, targetLanguage: language, consentVersion: 1 })).data;
  if (auth.currentUser?.uid !== uid || result.provider !== 'Google Translate' || result.targetLanguage !== language ||
    typeof result.originalText !== 'string' || typeof result.translatedText !== 'string' || result.translatedText.length > 100_000) {
    throw new Error('translation_unavailable');
  }
  return result;
}
