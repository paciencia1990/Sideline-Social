import { Asset } from "expo-asset";
import { doc, onSnapshot } from "firebase/firestore";
import { get, ref } from "firebase/database";
import { httpsCallable } from "firebase/functions";

import { db, functions, rtdb } from "@/config/firebase";
import { spotDifferenceScenes } from "@/src/game/spotDifference/spotDifferenceScenes";
import {
  gameStartStateId,
  normalizeGameStartState,
  type GameStartState,
} from "@/utils/gameStartSynchronization";
import type { GameJoinCodeType } from "@/services/gameJoinCodeService";

export async function prepareSynchronizedGameStart(input: {
  gameType: GameJoinCodeType;
  sessionId: string;
}) {
  const callable = httpsCallable<typeof input, GameStartState>(functions, "prepareSynchronizedGameStart");
  return normalizeGameStartState((await callable(input)).data);
}

export async function acknowledgeSynchronizedGameStart(input: {
  gameType: GameJoinCodeType;
  sessionId: string;
  startAttemptId: string;
}) {
  const callable = httpsCallable<typeof input, GameStartState>(functions, "acknowledgeSynchronizedGameStart");
  return normalizeGameStartState((await callable(input)).data);
}

export function subscribeToSynchronizedGameStart(
  gameType: GameJoinCodeType,
  sessionId: string,
  onState: (state: GameStartState | null) => void,
  onError?: (error: unknown) => void,
) {
  return onSnapshot(
    doc(db, "gameStartStates", gameStartStateId(gameType, sessionId)),
    (snapshot) => onState(snapshot.exists() ? normalizeGameStartState(snapshot.data()) : null),
    (error) => onError?.(error),
  );
}

export async function preloadSynchronizedGameRound(
  gameType: GameJoinCodeType,
  sessionId: string,
) {
  if (gameType === "bombDefusal") {
    // Metro bundles Lottie JSON as JavaScript data rather than a downloadable
    // asset module. Requiring the files is sufficient to make them available;
    // passing the resulting objects to Expo Asset can reject on Android.
    void require("../assets/animations/explosion.json");
    void require("../assets/animations/wireCut.json");
    return;
  }
  if (gameType !== "spotTheDifferences") return;

  const snapshot = await get(ref(rtdb, `/gameSessions/${sessionId}/gameState/sceneId`));
  const sceneId = typeof snapshot.val() === "string" ? snapshot.val() : "";
  const scene = spotDifferenceScenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error("game_scene_unavailable");
  await Asset.loadAsync([scene.imageA, scene.imageB]);
}
