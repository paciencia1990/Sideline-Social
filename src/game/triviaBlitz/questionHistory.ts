import AsyncStorage from "@react-native-async-storage/async-storage";

const TRIVIA_HISTORY_KEY_PREFIX = "@sideline-social/trivia/recent-question-ids/";

export async function getRecentTriviaQuestionIds(hostPlayerId: string): Promise<string[]> {
  try {
    const stored = await AsyncStorage.getItem(getHistoryKey(hostPlayerId));
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string" && Boolean(value))
      : [];
  } catch {
    return [];
  }
}

export async function setRecentTriviaQuestionIds(hostPlayerId: string, questionIds: string[]) {
  try {
    await AsyncStorage.setItem(getHistoryKey(hostPlayerId), JSON.stringify(questionIds));
  } catch {
    // History is best-effort and must never prevent a game from starting.
  }
}

function getHistoryKey(hostPlayerId: string) {
  return `${TRIVIA_HISTORY_KEY_PREFIX}${hostPlayerId}`;
}
