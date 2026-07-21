import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { onSnapshot, orderBy, query } from 'firebase/firestore';
import { onValue, ref, update } from 'firebase/database';

import { rtdb } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { useSquad } from '@/context/SquadContext';
import {
  createGameJoinCode,
  createGameJoinIdempotencyKey,
  getGameJoinCodeForSession,
  readGameJoinCodeFailureReason,
  releaseGameJoinCode,
  updateGameJoinCodeStatus,
  type GameJoinCodeFailureReason,
  type GameJoinCodeType,
} from '@/services/gameJoinCodeService';
import { createGameSession as createTriviaSession, startGameSession as startTriviaSession, togglePlayerReady } from '@/src/game/triviaBlitz/gameState';
import { getTriviaParentSessionRef, getTriviaPlayersRef } from '@/src/game/triviaBlitz/firebaseUtils';

type LobbyGameId = 'bomb-defusal' | 'trivia-blitz' | 'spot-the-difference';

type LobbyPlayer = {
  id: string;
  name: string;
  ready: boolean;
};

type LobbyPlayers = {
  joinCode: string;
  list: LobbyPlayer[];
  self: LobbyPlayer;
  isHost: boolean;
};

type GameCodeState = 'loading' | 'ready' | 'error' | 'local';

type GameLobbyState = {
  sessionId: string;
  players: LobbyPlayers;
  codeState: GameCodeState;
  codeError: GameJoinCodeFailureReason | null;
  isLocal: boolean;
  retryCode: () => void;
  cancelGame: () => void;
  toggleReady: () => void;
  startGame: () => void;
  showCountdown: boolean;
  setShowCountdown: (value: boolean) => void;
};

type RealtimeLobbyRecord = {
  hostUserId?: string;
  status?: string;
  players?: Record<string, {
    displayName?: string;
    name?: string;
    isReady?: boolean;
    ready?: boolean;
  }>;
};

const COUNTDOWN_DURATION_MS = 3000;

export function useGameLobby(gameId: LobbyGameId): GameLobbyState {
  const { user, loading: authLoading } = useAuth();
  const { selectedSquadId } = useSquad();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    local?: string | string[];
    host?: string | string[];
  }>();
  const routeSessionId = normalizeParam(params.sessionId);
  const isLocal = normalizeParam(params.local) === '1';
  const isHostRoute = normalizeParam(params.host) === '1';
  const shouldHostSession = isHostRoute || !routeSessionId;
  const gameType = joinCodeGameType(gameId);
  const currentUserId = user?.uid ?? '';
  const currentUserName = getUserName(user?.displayName, user?.email);

  const [sessionId, setSessionId] = useState(routeSessionId);
  const [joinCode, setJoinCode] = useState('');
  const [codeState, setCodeState] = useState<GameCodeState>(isLocal ? 'local' : 'loading');
  const [codeError, setCodeError] = useState<GameJoinCodeFailureReason | null>(null);
  const [playerList, setPlayerList] = useState<LobbyPlayer[]>([]);
  const [hostUserId, setHostUserId] = useState('');
  const [showCountdown, setShowCountdown] = useState(false);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [localPlayers, setLocalPlayers] = useState<LobbyPlayer[]>(() =>
    createLocalPlayers(currentUserId || 'local-player', currentUserName),
  );
  const creationInFlightRef = useRef(false);
  const pendingSessionIdRef = useRef(routeSessionId);
  const idempotencyKeyRef = useRef(createGameJoinIdempotencyKey());

  useEffect(() => {
    if (!routeSessionId || routeSessionId === sessionId) return;
    pendingSessionIdRef.current = routeSessionId;
    setSessionId(routeSessionId);
  }, [routeSessionId, sessionId]);

  useEffect(() => {
    if (!isLocal) return;
    setCodeState('local');
    setLocalPlayers((players) => {
      const nextId = currentUserId || 'local-player';
      const [self, ...rest] = players;
      if (self?.id === nextId && self.name === currentUserName) return players;
      return [{ id: nextId, name: currentUserName, ready: self?.ready ?? false }, ...rest];
    });
  }, [currentUserId, currentUserName, isLocal]);

  useEffect(() => {
    if (isLocal || authLoading || !currentUserId || creationInFlightRef.current || codeState === 'ready') return;
    let active = true;
    creationInFlightRef.current = true;
    setCodeState('loading');
    setCodeError(null);

    async function prepareLobby() {
      try {
        let canonicalSessionId = pendingSessionIdRef.current || sessionId;
        if (!canonicalSessionId && gameType === 'triviaBlitz') {
          const created = await createTriviaSession(currentUserName);
          canonicalSessionId = created.sessionId;
          pendingSessionIdRef.current = canonicalSessionId;
          if (active) setSessionId(canonicalSessionId);
        }

        const result = canonicalSessionId && !shouldHostSession
          ? await getGameJoinCodeForSession({ gameType, sessionId: canonicalSessionId })
          : await createGameJoinCode({
              gameType,
              sessionId: canonicalSessionId || null,
              idempotencyKey: idempotencyKeyRef.current,
              squadId: selectedSquadId,
            });

        if (!active) return;
        const resolvedSessionId = 'sessionId' in result ? result.sessionId : canonicalSessionId;
        if (!resolvedSessionId) throw new Error('Missing canonical game session.');
        pendingSessionIdRef.current = resolvedSessionId;
        setSessionId(resolvedSessionId);
        setJoinCode(result.joinCode);
        setCodeState('ready');
        setCodeError(null);
        if (!routeSessionId) router.setParams({ sessionId: resolvedSessionId, host: '1' });
      } catch (error) {
        if (!active) return;
        setCodeError(readGameJoinCodeFailureReason(error));
        setCodeState('error');
      } finally {
        creationInFlightRef.current = false;
      }
    }

    void prepareLobby();
    return () => {
      active = false;
      creationInFlightRef.current = false;
    };
  }, [authLoading, codeState, currentUserId, currentUserName, gameType, isLocal, routeSessionId, selectedSquadId, sessionId, setupAttempt, shouldHostSession]);

  useEffect(() => {
    if (isLocal || !sessionId) return;
    if (gameType === 'triviaBlitz') {
      const unsubscribeParent = onSnapshot(getTriviaParentSessionRef(sessionId), (snapshot) => {
        const data = snapshot.data();
        setHostUserId(typeof data?.hostPlayerId === 'string' ? data.hostPlayerId : '');
        if (data?.status === 'playing') setShowCountdown(true);
      });
      const playersQuery = query(getTriviaPlayersRef(sessionId), orderBy('playerIndex', 'asc'));
      const unsubscribePlayers = onSnapshot(playersQuery, (snapshot) => {
        setPlayerList(snapshot.docs.map((document) => ({
          id: document.id,
          name: String(document.data().name ?? 'Player'),
          ready: Boolean(document.data().ready),
        })));
      });
      return () => {
        unsubscribeParent();
        unsubscribePlayers();
      };
    }

    return onValue(ref(rtdb, `/gameSessions/${sessionId}`), (snapshot) => {
      const session = snapshot.val() as RealtimeLobbyRecord | null;
      setHostUserId(session?.hostUserId ?? '');
      setPlayerList(normalizeRealtimePlayers(session?.players));
      if (session?.status === 'active' || session?.status === 'countdown') setShowCountdown(true);
    });
  }, [gameType, isLocal, sessionId]);

  const activePlayerList = isLocal ? localPlayers : playerList;
  const effectiveUserId = currentUserId || 'local-player';
  const self = useMemo<LobbyPlayer>(() => (
    activePlayerList.find((player) => player.id === effectiveUserId) ?? {
      id: effectiveUserId,
      name: currentUserName,
      ready: false,
    }
  ), [activePlayerList, currentUserName, effectiveUserId]);

  const players = useMemo<LobbyPlayers>(() => ({
    joinCode,
    list: activePlayerList,
    self,
    isHost: isLocal || hostUserId === effectiveUserId,
  }), [activePlayerList, effectiveUserId, hostUserId, isLocal, joinCode, self]);

  const retryCode = useCallback(() => {
    setCodeState('loading');
    setCodeError(null);
    setSetupAttempt((value) => value + 1);
  }, []);

  const toggleReady = useCallback(() => {
    if (isLocal) {
      setLocalPlayers((current) => current.map((player) => (
        player.id === effectiveUserId ? { ...player, ready: !player.ready } : player
      )));
      return;
    }
    if (!sessionId || !currentUserId) return;
    if (gameType === 'triviaBlitz') {
      void togglePlayerReady(sessionId, currentUserId, !self.ready);
      return;
    }
    void update(ref(rtdb, `/gameSessions/${sessionId}/players/${currentUserId}`), {
      displayName: self.name || currentUserName,
      isReady: !self.ready,
      isConnected: true,
    });
  }, [currentUserId, currentUserName, effectiveUserId, gameType, isLocal, self.name, self.ready, sessionId]);

  const startGame = useCallback(() => {
    if (!players.isHost) return;
    setShowCountdown(true);
    if (isLocal || !sessionId) return;
    void (async () => {
      if (gameType === 'triviaBlitz') {
        await startTriviaSession(sessionId);
      } else {
        await update(ref(rtdb, `/gameSessions/${sessionId}`), {
          status: 'active',
          startedAt: Date.now(),
        });
      }
      await updateGameJoinCodeStatus({ gameType, sessionId, status: 'started' });
    })().catch(() => setShowCountdown(false));
  }, [gameType, isLocal, players.isHost, sessionId]);

  const cancelGame = useCallback(() => {
    if (!players.isHost) return;
    void (async () => {
      if (!isLocal && sessionId) {
        await releaseGameJoinCode({ gameType, sessionId });
      }
      router.replace('/(tabs)/games');
    })().catch((error) => {
      setCodeError(readGameJoinCodeFailureReason(error));
      setCodeState('error');
    });
  }, [gameType, isLocal, players.isHost, sessionId]);

  return {
    sessionId,
    players,
    codeState,
    codeError,
    isLocal,
    retryCode,
    cancelGame,
    toggleReady,
    startGame,
    showCountdown,
    setShowCountdown,
  };
}

export type { GameCodeState, GameLobbyState, LobbyGameId, LobbyPlayer, LobbyPlayers };

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function joinCodeGameType(gameId: LobbyGameId): GameJoinCodeType {
  if (gameId === 'bomb-defusal') return 'bombDefusal';
  if (gameId === 'spot-the-difference') return 'spotTheDifferences';
  return 'triviaBlitz';
}

function createLocalPlayers(currentUserId: string, currentUserName: string): LobbyPlayer[] {
  return [{ id: currentUserId, name: currentUserName, ready: false }];
}

function normalizeRealtimePlayers(players: RealtimeLobbyRecord['players']): LobbyPlayer[] {
  if (!players) return [];
  return Object.entries(players).map(([id, player]) => ({
    id,
    name: player.displayName ?? player.name ?? 'Player',
    ready: Boolean(player.isReady ?? player.ready),
  }));
}

function getUserName(displayName?: string | null, email?: string | null) {
  if (displayName?.trim()) return displayName.trim();
  if (email?.trim()) return email.split('@')[0] || 'Player';
  return 'Player';
}

export { COUNTDOWN_DURATION_MS };
