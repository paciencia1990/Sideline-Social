import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { onSnapshot, orderBy, query } from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import { useTranslation } from 'react-i18next';

import { rtdb } from '@/config/firebase';
import { useAuth } from '@/context/AuthContext';
import { useSquad } from '@/context/SquadContext';
import {
  closeGameLobby,
  getGameJoinCodeForSession,
  leaveGameLobby,
  readGameJoinCodeFailureReason,
  setRealtimeGamePlayerReady,
  type GameJoinCodeFailureReason,
  type GameJoinCodeType,
} from '@/services/gameJoinCodeService';
import {
  prepareSynchronizedGameStart,
  subscribeToSynchronizedGameStart,
} from '@/services/gameStartSynchronizationService';
import { togglePlayerReady } from '@/src/game/triviaBlitz/gameState';
import { getTriviaParentSessionRef, getTriviaPlayersRef } from '@/src/game/triviaBlitz/firebaseUtils';

type LobbyGameId = 'bomb-defusal' | 'trivia-blitz' | 'spot-the-difference';

type LobbyPlayer = {
  id: string;
  name: string;
  ready: boolean;
  joinOrder?: number;
  teamId?: 'A' | 'B';
  previousTeamId?: 'A' | 'B';
  teamReassignedAt?: number;
  teamAssignmentNoticeId?: string;
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
  lobbyId: string;
  minPlayers: number;
  players: LobbyPlayers;
  codeState: GameCodeState;
  codeError: GameJoinCodeFailureReason | null;
  isLocal: boolean;
  retryCode: () => void;
  leaveGame: () => Promise<void>;
  closeLobby: () => Promise<void>;
  retryLifecycleAction: () => void;
  lifecycleAction: 'leaving' | 'closing' | null;
  lifecycleError: GameJoinCodeFailureReason | null;
  toggleReady: () => void;
  startGame: () => void;
  startPending: boolean;
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
    joinOrder?: number;
    teamId?: string;
    previousTeamId?: string;
    teamReassignedAt?: number;
    teamAssignmentNoticeId?: string;
  }>;
};

const COUNTDOWN_DURATION_MS = 3000;

export function useGameLobby(gameId: LobbyGameId): GameLobbyState {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { selectedSquadId } = useSquad();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    lobbyId?: string | string[];
    local?: string | string[];
  }>();
  const routeSessionId = normalizeParam(params.sessionId);
  const routeLobbyId = normalizeParam(params.lobbyId);
  const isLocal = __DEV__ && normalizeParam(params.local) === '1';
  const gameType = joinCodeGameType(gameId);
  const minPlayers = minimumPlayersForGame(gameId);
  const currentUserId = user?.uid ?? '';
  const fallbackPlayerName = t('games.playerFallback');
  const currentUserName = getUserName(user?.displayName, user?.email, fallbackPlayerName);

  const [sessionId, setSessionId] = useState(routeSessionId);
  const [lobbyId, setLobbyId] = useState(routeLobbyId);
  const [joinCode, setJoinCode] = useState('');
  const [codeState, setCodeState] = useState<GameCodeState>(isLocal ? 'local' : 'loading');
  const [codeError, setCodeError] = useState<GameJoinCodeFailureReason | null>(null);
  const [playerList, setPlayerList] = useState<LobbyPlayer[]>([]);
  const [hostUserId, setHostUserId] = useState('');
  const [showCountdown, setShowCountdown] = useState(false);
  const [startPending, setStartPending] = useState(false);
  const [lifecycleAction, setLifecycleAction] = useState<'leaving' | 'closing' | null>(null);
  const [lifecycleError, setLifecycleError] = useState<GameJoinCodeFailureReason | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [localPlayers, setLocalPlayers] = useState<LobbyPlayer[]>(() =>
    createLocalPlayers(currentUserId || 'local-player', currentUserName, gameId),
  );
  const setupInFlightRef = useRef(false);
  const suppressLobbyEventsRef = useRef(false);
  const departureCompletedRef = useRef(false);
  const remoteClosureHandledRef = useRef(false);
  const lastLifecycleActionRef = useRef<'leaving' | 'closing'>('leaving');
  const lifecycleInFlightRef = useRef(false);
  const navigatedStartAttemptRef = useRef('');

  const clearLocalLobbyState = useCallback(() => {
    setSessionId('');
    setLobbyId('');
    setJoinCode('');
    setPlayerList([]);
    setHostUserId('');
    setShowCountdown(false);
  }, []);

  const openLobbyDirectory = useCallback((notice?: 'lobbyClosed') => {
    if (selectedSquadId) {
      router.replace({
        pathname: '/(games)/lobbies',
        params: { gameType, squadId: selectedSquadId, ...(notice ? { notice } : {}) },
      } as never);
    } else {
      router.replace('/(tabs)/games');
    }
  }, [gameType, selectedSquadId]);

  const handleRemoteClosure = useCallback(() => {
    if (suppressLobbyEventsRef.current || remoteClosureHandledRef.current) return;
    remoteClosureHandledRef.current = true;
    departureCompletedRef.current = true;
    suppressLobbyEventsRef.current = true;
    clearLocalLobbyState();
    openLobbyDirectory('lobbyClosed');
  }, [clearLocalLobbyState, openLobbyDirectory]);

  useEffect(() => {
    if (suppressLobbyEventsRef.current || departureCompletedRef.current) return;
    if (!routeSessionId || routeSessionId === sessionId) return;
    setSessionId(routeSessionId);
  }, [routeSessionId, sessionId]);

  useEffect(() => {
    if (suppressLobbyEventsRef.current || departureCompletedRef.current) return;
    if (routeLobbyId && routeLobbyId !== lobbyId) setLobbyId(routeLobbyId);
  }, [lobbyId, routeLobbyId]);

  useEffect(() => {
    if (!isLocal) return;
    setCodeState('local');
    setLocalPlayers((players) => {
      const nextId = currentUserId || 'local-player';
      const [self, ...rest] = players;
      if (self?.id === nextId && self.name === currentUserName) return players;
      return [{
        id: nextId,
        name: currentUserName,
        ready: self?.ready ?? false,
        teamId: gameId === 'spot-the-difference' ? 'A' : undefined,
      }, ...rest];
    });
  }, [currentUserId, currentUserName, gameId, isLocal]);

  useEffect(() => {
    if (
      suppressLobbyEventsRef.current ||
      departureCompletedRef.current ||
      isLocal ||
      authLoading ||
      !currentUserId ||
      setupInFlightRef.current ||
      codeState === 'ready'
    ) return;
    if (!sessionId) {
      setCodeError('game_not_found');
      setCodeState('error');
      return;
    }
    let active = true;
    setupInFlightRef.current = true;
    setCodeState('loading');
    setCodeError(null);

    async function prepareLobby() {
      try {
        const result = await getGameJoinCodeForSession({ gameType, sessionId });

        if (!active || suppressLobbyEventsRef.current || departureCompletedRef.current) return;
        setJoinCode(result.joinCode);
        setLobbyId(result.lobbyId);
        setCodeState('ready');
        setCodeError(null);
      } catch (error) {
        if (!active || suppressLobbyEventsRef.current || departureCompletedRef.current) return;
        setCodeError(readGameJoinCodeFailureReason(error));
        setCodeState('error');
      } finally {
        setupInFlightRef.current = false;
      }
    }

    void prepareLobby();
    return () => {
      active = false;
      setupInFlightRef.current = false;
    };
  }, [authLoading, codeState, currentUserId, gameType, isLocal, sessionId, setupAttempt]);

  useEffect(() => {
    if (isLocal || !sessionId) return;
    if (gameType === 'triviaBlitz') {
      const unsubscribeParent = onSnapshot(getTriviaParentSessionRef(sessionId), (snapshot) => {
        if (suppressLobbyEventsRef.current || departureCompletedRef.current) return;
        const data = snapshot.data();
        if (data?.completionReason === 'closedByHost') {
          handleRemoteClosure();
          return;
        }
        setHostUserId(typeof data?.hostPlayerId === 'string' ? data.hostPlayerId : '');
      });
      const playersQuery = query(getTriviaPlayersRef(sessionId), orderBy('playerIndex', 'asc'));
      const unsubscribePlayers = onSnapshot(playersQuery, (snapshot) => {
        if (suppressLobbyEventsRef.current || departureCompletedRef.current) return;
        setPlayerList(snapshot.docs.map((document) => ({
          id: document.id,
          name: String(document.data().name ?? fallbackPlayerName),
          ready: Boolean(document.data().ready),
        })));
      });
      return () => {
        unsubscribeParent();
        unsubscribePlayers();
      };
    }

    return onValue(ref(rtdb, `/gameSessions/${sessionId}`), (snapshot) => {
      if (suppressLobbyEventsRef.current || departureCompletedRef.current) return;
      const session = snapshot.val() as RealtimeLobbyRecord | null;
      if (session?.status === 'canceled' || session?.status === 'expired') {
        handleRemoteClosure();
        return;
      }
      setHostUserId(session?.hostUserId ?? '');
      setPlayerList(normalizeRealtimePlayers(session?.players, fallbackPlayerName));
    });
  }, [fallbackPlayerName, gameType, handleRemoteClosure, isLocal, sessionId]);

  useEffect(() => {
    if (isLocal || !sessionId) return;
    return subscribeToSynchronizedGameStart(gameType, sessionId, (state) => {
      if (
        !state ||
        state.sessionId !== sessionId ||
        navigatedStartAttemptRef.current === state.startAttemptId
      ) return;
      navigatedStartAttemptRef.current = state.startAttemptId;
      setStartPending(true);
      router.replace({
        pathname: playPathForGame(gameId),
        params: {
          sessionId,
          startAttemptId: state.startAttemptId,
          ...(lobbyId ? { lobbyId } : {}),
        },
      } as never);
    });
  }, [gameId, gameType, isLocal, lobbyId, sessionId]);

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
    void setRealtimeGamePlayerReady({ sessionId, ready: !self.ready });
  }, [currentUserId, effectiveUserId, gameType, isLocal, self.ready, sessionId]);

  const startGame = useCallback(() => {
    if (!players.isHost || startPending) return;
    if (isLocal) {
      setShowCountdown(true);
      return;
    }
    if (!sessionId) return;
    setStartPending(true);
    void prepareSynchronizedGameStart({ gameType, sessionId })
      .catch(() => setStartPending(false));
  }, [gameType, isLocal, players.isHost, sessionId, startPending]);

  const performLifecycleAction = useCallback(async (action: 'leaving' | 'closing') => {
    if (lifecycleInFlightRef.current) return;
    if (!isLocal && !lobbyId) {
      lastLifecycleActionRef.current = action;
      setLifecycleError('game_not_found');
      return;
    }
    lifecycleInFlightRef.current = true;
    lastLifecycleActionRef.current = action;
    suppressLobbyEventsRef.current = true;
    setLifecycleAction(action);
    setLifecycleError(null);
    try {
      if (!isLocal) {
        if (action === 'closing') await closeGameLobby({ lobbyId });
        else await leaveGameLobby({ lobbyId });
      }
      departureCompletedRef.current = true;
      clearLocalLobbyState();
      openLobbyDirectory();
    } catch (error) {
      suppressLobbyEventsRef.current = false;
      setLifecycleError(readGameJoinCodeFailureReason(error));
    } finally {
      lifecycleInFlightRef.current = false;
      setLifecycleAction(null);
    }
  }, [clearLocalLobbyState, isLocal, lobbyId, openLobbyDirectory]);

  const leaveGame = useCallback(() => performLifecycleAction('leaving'), [performLifecycleAction]);
  const closeLobby = useCallback(() => performLifecycleAction('closing'), [performLifecycleAction]);
  const retryLifecycleAction = useCallback(() => {
    void performLifecycleAction(lastLifecycleActionRef.current);
  }, [performLifecycleAction]);

  return {
    sessionId,
    lobbyId,
    minPlayers,
    players,
    codeState,
    codeError,
    isLocal,
    retryCode,
    leaveGame,
    closeLobby,
    retryLifecycleAction,
    lifecycleAction,
    lifecycleError,
    toggleReady,
    startGame,
    startPending,
    showCountdown,
    setShowCountdown,
  };
}

function playPathForGame(gameId: LobbyGameId) {
  if (gameId === 'bomb-defusal') return '/games/bomb-defusal/play' as const;
  if (gameId === 'spot-the-difference') return '/games/spot-the-difference/play' as const;
  return '/games/trivia-blitz/play' as const;
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

function minimumPlayersForGame(gameId: LobbyGameId) {
  if (gameId === 'spot-the-difference') return 4;
  return 2;
}

function createLocalPlayers(currentUserId: string, currentUserName: string, gameId: LobbyGameId): LobbyPlayer[] {
  return [{
    id: currentUserId,
    name: currentUserName,
    ready: false,
    teamId: gameId === 'spot-the-difference' ? 'A' : undefined,
  }];
}

function normalizeRealtimePlayers(
  players: RealtimeLobbyRecord['players'],
  fallbackPlayerName: string,
): LobbyPlayer[] {
  if (!players) return [];
  return Object.entries(players).map(([id, player]) => {
    const teamId = readLobbyTeamId(player.teamId);
    const previousTeamId = readLobbyTeamId(player.previousTeamId);
    return {
      id,
      name: player.displayName ?? player.name ?? fallbackPlayerName,
      ready: Boolean(player.isReady ?? player.ready),
      joinOrder: typeof player.joinOrder === 'number' && Number.isFinite(player.joinOrder)
        ? player.joinOrder
        : undefined,
      teamId,
      previousTeamId,
      teamReassignedAt: typeof player.teamReassignedAt === 'number' && Number.isFinite(player.teamReassignedAt)
        ? player.teamReassignedAt
        : undefined,
      teamAssignmentNoticeId: typeof player.teamAssignmentNoticeId === 'string'
        ? player.teamAssignmentNoticeId
        : undefined,
    };
  }).sort((left, right) => {
    const leftOrder = left.joinOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.joinOrder ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.name.localeCompare(right.name);
  });
}

function readLobbyTeamId(value: unknown): 'A' | 'B' | undefined {
  return value === 'A' || value === 'B' ? value : undefined;
}

function getUserName(
  displayName: string | null | undefined,
  email: string | null | undefined,
  fallbackPlayerName: string,
) {
  if (displayName?.trim()) return displayName.trim();
  if (email?.trim()) return email.split('@')[0] || fallbackPlayerName;
  return fallbackPlayerName;
}

export { COUNTDOWN_DURATION_MS };
