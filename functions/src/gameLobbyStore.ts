import { getFirestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

import { getApp, initializeApp } from 'firebase-admin/app';
import { Timestamp } from 'firebase-admin/firestore';

import {
  normalizeGameLobbyDirectory,
  removeGameLobbyFromDirectory,
  updateGameLobbyInDirectory,
  type GameLobbyDirectoryEntry,
  type GameLobbyStatus,
} from './gameLobbyCore';
import type { GameJoinCodeType } from './gameJoinCodeCore';

export const gameLobbyDirectories = () => getFirestore().collection('gameLobbyDirectories');
export const gameLobbyCreateRequests = () => getFirestore().collection('gameLobbyCreateRequests');
export const activeGameLobbyMemberships = () => getFirestore().collection('activeGameLobbyMemberships');
export const gameLobbyCreationRateLimits = () => getFirestore().collection('gameLobbyCreationRateLimits');

export function gameLobbyDirectoryId(squadId: string, gameType: GameJoinCodeType) {
  return createHash('sha256').update(`${squadId}:${gameType}`).digest('hex');
}

export function gameLobbyDirectoryRef(squadId: string, gameType: GameJoinCodeType) {
  return gameLobbyDirectories().doc(gameLobbyDirectoryId(squadId, gameType));
}

export async function setGameLobbyLifecycleForSession(
  gameType: GameJoinCodeType,
  sessionId: string,
  status: GameLobbyStatus,
  summary: Partial<Pick<
    GameLobbyDirectoryEntry,
    'activePlayerCount' | 'queuedPlayerCount' | 'hostUserId' | 'hostDisplayName' | 'expiresAtMs'
  >> = {},
) {
  const link = await getFirestore()
    .collection('gameJoinSessionLinks')
    .doc(hashIdentifier(`${gameType}:${sessionId}`))
    .get();
  const linkData = link.data();
  const lobbyId = readIdentifier(linkData?.lobbyId);
  const squadId = readIdentifier(linkData?.squadId);
  if (!link.exists || !lobbyId || !squadId || linkData?.gameType !== gameType) return false;
  const reference = gameLobbyDirectoryRef(squadId, gameType);
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const nowMs = Date.now();
    const directory = normalizeGameLobbyDirectory(snapshot.data(), squadId, gameType, nowMs);
    const current = directory.lobbies[lobbyId];
    if (!current || current.sessionId !== sessionId) return false;
    const next = updateGameLobbyInDirectory(directory, {
      ...current,
      ...summary,
      status,
      updatedAtMs: nowMs,
    });
    transaction.set(reference, {
      ...next,
      updatedAt: Timestamp.fromMillis(nowMs),
    });
    return true;
  });
}

export async function removeGameLobbyDirectoryEntry(input: {
  gameType: GameJoinCodeType;
  lobbyId: string;
  squadId: string;
}) {
  const reference = gameLobbyDirectoryRef(input.squadId, input.gameType);
  return getFirestore().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return false;
    const nowMs = Date.now();
    const directory = normalizeGameLobbyDirectory(
      snapshot.data(),
      input.squadId,
      input.gameType,
      nowMs,
    );
    if (!directory.lobbies[input.lobbyId]) return false;
    const next = removeGameLobbyFromDirectory(directory, input.lobbyId);
    transaction.set(reference, {
      ...next,
      updatedAt: Timestamp.fromMillis(nowMs),
    });
    return true;
  });
}

function hashIdentifier(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function readIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return /^[A-Za-z0-9_-]{1,360}$/.test(normalized) ? normalized : null;
}
