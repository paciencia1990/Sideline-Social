/**
 * gameService.ts
 * All Firebase Realtime Database operations for the Sideline Squad mini-game engine.
 * Uses Realtime DB (not Firestore) for low-latency (<100ms) live game state.
 * Follows the same dynamic-import pattern as squadService.ts.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GameType = 'bomb_defusal' | 'spot_difference' | 'trivia_blitz';
export type SessionStatus = 'lobby' | 'countdown' | 'active' | 'completed' | 'failed';

export interface GamePlayer {
  displayName: string;
  avatarUrl: string | null;
  isReady: boolean;
  score: number;
  isConnected: boolean;
}

export interface GameSession {
  sessionId: string;
  gameType: GameType;
  squadId: string;
  hostUserId: string;
  joinCode: string;
  players: Record<string, GamePlayer>;
  status: SessionStatus;
  startedAt: number | null;
  completedAt: number | null;
  gameState: Record<string, unknown>;
  minPlayers: number;
  maxPlayers: number;
  settings: Record<string, unknown>;
}

export interface CreateSessionInput {
  gameType: GameType;
  squadId: string;
  hostUserId: string;
  hostDisplayName: string;
  hostAvatarUrl: string | null;
}

// ---------------------------------------------------------------------------
// Game Config (minPlayers, maxPlayers per game type)
// ---------------------------------------------------------------------------

export const GAME_CONFIG: Record<GameType, { minPlayers: number; maxPlayers: number; defaultSettings: Record<string, unknown> }> = {
  bomb_defusal: { minPlayers: 2, maxPlayers: 6, defaultSettings: { timerSeconds: 300 } },
  spot_difference: { minPlayers: 4, maxPlayers: 12, defaultSettings: { roundDuration: 420 } },
  trivia_blitz: { minPlayers: 3, maxPlayers: 20, defaultSettings: { questionCount: 10, timeLimitSeconds: 20 } },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O, 0, I, 1 — too ambiguous
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function getDB() {
  const database = (await import('@react-native-firebase/database')).default;
  return database();
}

// ---------------------------------------------------------------------------
// createGameSession
// Called by host when they tap [Play Now]. Creates a Realtime DB session.
// ---------------------------------------------------------------------------

export async function createGameSession(input: CreateSessionInput): Promise<GameSession> {
  try {
    const db = await getDB();
    const sessionId = generateSessionId();
    const joinCode = generateJoinCode();
    const config = GAME_CONFIG[input.gameType];

    const hostPlayer: GamePlayer = {
      displayName: input.hostDisplayName,
      avatarUrl: input.hostAvatarUrl,
      isReady: false,
      score: 0,
      isConnected: true,
    };

    const session: GameSession = {
      sessionId,
      gameType: input.gameType,
      squadId: input.squadId,
      hostUserId: input.hostUserId,
      joinCode,
      players: { [input.hostUserId]: hostPlayer },
      status: 'lobby',
      startedAt: null,
      completedAt: null,
      gameState: {},
      minPlayers: config.minPlayers,
      maxPlayers: config.maxPlayers,
      settings: config.defaultSettings,
    };

    await db.ref(`/gameSessions/${sessionId}`).set(session);
    return session;
  } catch (err) {
    console.error('[GameService] createGameSession error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// joinGameSession
// Called by squad members — adds their player record.
// ---------------------------------------------------------------------------

export async function joinGameSession(
  sessionId: string,
  userId: string,
  displayName: string,
  avatarUrl: string | null
): Promise<void> {
  try {
    const db = await getDB();
    const player: GamePlayer = {
      displayName,
      avatarUrl,
      isReady: false,
      score: 0,
      isConnected: true,
    };
    await db.ref(`/gameSessions/${sessionId}/players/${userId}`).set(player);
  } catch (err) {
    console.error('[GameService] joinGameSession error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// setPlayerReady
// Marks the player as ready in the lobby.
// ---------------------------------------------------------------------------

export async function setPlayerReady(sessionId: string, userId: string, ready: boolean): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}/players/${userId}/isReady`).set(ready);
  } catch (err) {
    console.error('[GameService] setPlayerReady error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// setPlayerConnected
// Updates connection status — called on foreground/background changes.
// ---------------------------------------------------------------------------

export async function setPlayerConnected(sessionId: string, userId: string, connected: boolean): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}/players/${userId}/isConnected`).set(connected);
  } catch (err) {
    console.error('[GameService] setPlayerConnected error:', err);
  }
}

// ---------------------------------------------------------------------------
// startCountdown
// Host triggers countdown — sets status to 'countdown'.
// ---------------------------------------------------------------------------

export async function startCountdown(sessionId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}/status`).set('countdown');
  } catch (err) {
    console.error('[GameService] startCountdown error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// startGame
// Called after countdown — sets status to 'active' and records startedAt.
// ---------------------------------------------------------------------------

export async function startGame(sessionId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}`).update({
      status: 'active',
      startedAt: Date.now(),
    });
  } catch (err) {
    console.error('[GameService] startGame error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// completeGame
// Marks session as completed and records final scores.
// Stars are processed server-side via Cloud Function trigger.
// ---------------------------------------------------------------------------

export async function completeGame(
  sessionId: string,
  outcome: 'completed' | 'failed',
  finalScores: Record<string, number>
): Promise<void> {
  try {
    const db = await getDB();

    // Update each player's score
    const scoreUpdates: Record<string, unknown> = { status: outcome, completedAt: Date.now() };
    Object.entries(finalScores).forEach(([uid, score]) => {
      scoreUpdates[`players/${uid}/score`] = score;
    });

    await db.ref(`/gameSessions/${sessionId}`).update(scoreUpdates);
  } catch (err) {
    console.error('[GameService] completeGame error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// fetchSessionByCode
// Used by the "join by code" flow.
// ---------------------------------------------------------------------------

export async function fetchSessionByCode(joinCode: string): Promise<GameSession | null> {
  try {
    const db = await getDB();
    const snap = await db
      .ref('/gameSessions')
      .orderByChild('joinCode')
      .equalTo(joinCode.toUpperCase())
      .once('value');

    if (!snap.exists()) return null;

    const data = snap.val() as Record<string, GameSession>;
    const sessions = Object.values(data);
    // Return the most recent active lobby session
    const active = sessions.find((s) => s.status === 'lobby');
    return active ?? sessions[0] ?? null;
  } catch (err) {
    console.error('[GameService] fetchSessionByCode error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// fetchActiveSquadSession
// Checks if the user's squad has an active or lobby session right now.
// ---------------------------------------------------------------------------

export async function fetchActiveSquadSession(squadId: string): Promise<GameSession | null> {
  try {
    const db = await getDB();
    const snap = await db
      .ref('/gameSessions')
      .orderByChild('squadId')
      .equalTo(squadId)
      .once('value');

    if (!snap.exists()) return null;

    const data = snap.val() as Record<string, GameSession>;
    const active = Object.values(data).find(
      (s) => s.status === 'lobby' || s.status === 'countdown' || s.status === 'active'
    );
    return active ?? null;
  } catch (err) {
    console.error('[GameService] fetchActiveSquadSession error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// subscribeToSession
// Real-time listener on a game session. Returns an unsubscribe function.
// ---------------------------------------------------------------------------

export function subscribeToSession(
  sessionId: string,
  callback: (session: GameSession | null) => void
): () => void {
  let ref: any = null;
  let mounted = true;

  (async () => {
    try {
      const db = await getDB();
      if (!mounted) return;

      ref = db.ref(`/gameSessions/${sessionId}`);
      ref.on('value', (snap: any) => {
        if (!snap.exists()) {
          callback(null);
          return;
        }
        callback(snap.val() as GameSession);
      });
    } catch (err) {
      console.error('[GameService] subscribeToSession error:', err);
      callback(null);
    }
  })();

  return () => {
    mounted = false;
    if (ref) ref.off('value');
  };
}

// ---------------------------------------------------------------------------
// removePlayer
// Removes a player from the session (e.g., 60-second disconnect timeout).
// ---------------------------------------------------------------------------

export async function removePlayer(sessionId: string, userId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}/players/${userId}`).remove();
  } catch (err) {
    console.error('[GameService] removePlayer error:', err);
  }
}

// ---------------------------------------------------------------------------
// deleteSession
// Removes the entire session (called on cleanup or host cancel).
// ---------------------------------------------------------------------------

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}`).remove();
  } catch (err) {
    console.error('[GameService] deleteSession error:', err);
  }
}

// ---------------------------------------------------------------------------
// updateGameState
// Individual games call this to write their game-specific state.
// ---------------------------------------------------------------------------

export async function updateGameState(
  sessionId: string,
  gameState: Record<string, unknown>
): Promise<void> {
  try {
    const db = await getDB();
    await db.ref(`/gameSessions/${sessionId}/gameState`).update(gameState);
  } catch (err) {
    console.error('[GameService] updateGameState error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// getGameLabel — human-readable name for a GameType
// ---------------------------------------------------------------------------

export function getGameLabel(gameType: GameType): string {
  switch (gameType) {
    case 'bomb_defusal': return 'Bomb Defusal';
    case 'spot_difference': return 'Spot the Difference';
    case 'trivia_blitz': return 'Trivia Blitz';
  }
}

export function getGameEmoji(gameType: GameType): string {
  switch (gameType) {
    case 'bomb_defusal': return '💣';
    case 'spot_difference': return '🔍';
    case 'trivia_blitz': return '⚡';
  }
}