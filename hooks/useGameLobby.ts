import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { onValue, ref, update } from "firebase/database";

import { rtdb } from "@/config/firebase";
import { useAuth } from "@/context/AuthContext";

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

type GameLobbyState = {
  players: LobbyPlayers;
  toggleReady: () => void;
  startGame: () => void;
  showCountdown: boolean;
  setShowCountdown: (value: boolean) => void;
};

type LobbyPlayerRecord = {
  id?: string;
  uid?: string;
  name?: string;
  displayName?: string;
  ready?: boolean;
  isReady?: boolean;
};

type GameLobbyRecord = {
  players?: Record<string, LobbyPlayerRecord> | LobbyPlayerRecord[];
  starting?: boolean;
  countdownStartedAt?: number;
  countdownDurationMs?: number;
};

const COUNTDOWN_DURATION_MS = 3000;
const LOCAL_JOIN_CODE = "LOCAL";

export function useGameLobby(gameId: string): GameLobbyState {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const sessionId = normalizeParam(params.sessionId);
  const currentUserId = user?.uid ?? "local-player";
  const currentUserName = getUserName(user?.displayName, user?.email);

  const [joinCode, setJoinCode] = useState("");
  const [playerList, setPlayerList] = useState<LobbyPlayer[]>([]);
  const [gameState, setGameState] = useState<GameLobbyRecord | null>(null);
  const [showCountdown, setShowCountdown] = useState(false);
  const [localPlayers, setLocalPlayers] = useState<LobbyPlayer[]>(() =>
    createLocalPlayers(currentUserId, currentUserName),
  );

  useEffect(() => {
    if (sessionId) {
      return;
    }

    setLocalPlayers((players) => {
      const [self, ...rest] = players;
      if (self?.id === currentUserId && self.name === currentUserName) {
        return players;
      }

      return [
        {
          id: currentUserId,
          name: currentUserName,
          ready: self?.ready ?? false,
        },
        ...rest,
      ];
    });
  }, [currentUserId, currentUserName, sessionId]);

  const activePlayerList = sessionId ? playerList : localPlayers;
  const activeJoinCode = sessionId ? joinCode : LOCAL_JOIN_CODE;

  const self = useMemo<LobbyPlayer>(() => {
    return (
      activePlayerList.find((player) => player.id === currentUserId) ?? {
        id: currentUserId,
        name: currentUserName,
        ready: false,
      }
    );
  }, [activePlayerList, currentUserId, currentUserName]);

  const players = useMemo<LobbyPlayers>(() => {
    const hostId = activePlayerList[0]?.id;

    return {
      joinCode: activeJoinCode,
      list: activePlayerList,
      self,
      isHost: Boolean(hostId === currentUserId),
    };
  }, [activeJoinCode, activePlayerList, currentUserId, self]);

  useEffect(() => {
    if (!sessionId || !gameId) {
      setJoinCode("");
      setPlayerList([]);
      setGameState(null);
      return;
    }

    const gameRef = ref(rtdb, `/sessions/${sessionId}/games/${gameId}`);
    const joinCodeRef = ref(rtdb, `/sessions/${sessionId}/joinCode`);

    const unsubscribeGame = onValue(gameRef, (snapshot) => {
      const nextGameState = snapshot.val() as GameLobbyRecord | null;
      setGameState(nextGameState);
      setPlayerList(normalizePlayers(nextGameState?.players, currentUserId, currentUserName));

      if (nextGameState?.starting) {
        setShowCountdown(true);
      }
    });

    const unsubscribeJoinCode = onValue(joinCodeRef, (snapshot) => {
      setJoinCode(String(snapshot.val() ?? ""));
    });

    return () => {
      unsubscribeGame();
      unsubscribeJoinCode();
    };
  }, [currentUserId, currentUserName, gameId, sessionId]);

  useEffect(() => {
    if (!sessionId || !gameId || !gameState?.starting) {
      return;
    }

    const startedAt = gameState.countdownStartedAt ?? Date.now();
    const duration = gameState.countdownDurationMs ?? COUNTDOWN_DURATION_MS;
    const remaining = Math.max(startedAt + duration - Date.now(), 0);

    const timeout = setTimeout(() => {
      setShowCountdown(false);
      router.replace(`/games/${gameId}/play` as never);
    }, remaining);

    return () => clearTimeout(timeout);
  }, [gameId, gameState, sessionId]);

  const toggleReady = useCallback(() => {
    if (!gameId) {
      return;
    }

    if (!sessionId) {
      setLocalPlayers((players) =>
        players.map((player) =>
          player.id === currentUserId ? { ...player, ready: !player.ready } : player,
        ),
      );
      return;
    }

    const playerRef = ref(
      rtdb,
      `/sessions/${sessionId}/games/${gameId}/players/${currentUserId}`,
    );

    update(playerRef, {
      id: currentUserId,
      name: self.name || currentUserName,
      ready: !self.ready,
    });
  }, [currentUserId, currentUserName, gameId, self.name, self.ready, sessionId]);

  const startGame = useCallback(() => {
    if (!gameId || !players.isHost) {
      return;
    }

    const countdownStartedAt = Date.now();
    setShowCountdown(true);

    if (!sessionId) {
      return;
    }

    const gameRef = ref(rtdb, `/sessions/${sessionId}/games/${gameId}`);

    update(gameRef, {
      starting: true,
      countdownStartedAt,
      countdownDurationMs: COUNTDOWN_DURATION_MS,
      startedBy: currentUserId,
    });
  }, [currentUserId, gameId, players.isHost, sessionId]);

  return {
    players,
    toggleReady,
    startGame,
    showCountdown,
    setShowCountdown,
  };
}

export type { GameLobbyState, LobbyPlayer, LobbyPlayers };

function normalizeParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function createLocalPlayers(currentUserId: string, currentUserName: string): LobbyPlayer[] {
  return [
    {
      id: currentUserId,
      name: currentUserName,
      ready: false,
    },
    {
      id: "local-teammate",
      name: "Teammate",
      ready: true,
    },
  ];
}

function normalizePlayers(
  players: GameLobbyRecord["players"],
  currentUserId: string,
  currentUserName: string,
): LobbyPlayer[] {
  if (!players) {
    return createLocalPlayers(currentUserId, currentUserName);
  }

  const normalizedPlayers = Array.isArray(players)
    ? players
        .map((player, index) => normalizePlayer(String(player.id ?? player.uid ?? index), player))
        .filter(Boolean)
    : Object.entries(players)
        .map(([id, player]) => normalizePlayer(id, player))
        .filter(Boolean);

  if (normalizedPlayers.length === 0) {
    return createLocalPlayers(currentUserId, currentUserName);
  }

  return normalizedPlayers as LobbyPlayer[];
}

function normalizePlayer(id: string, player?: LobbyPlayerRecord): LobbyPlayer | null {
  if (!player) {
    return null;
  }

  return {
    id: player.id ?? player.uid ?? id,
    name: player.name ?? player.displayName ?? "Player",
    ready: Boolean(player.ready ?? player.isReady),
  };
}

function getUserName(displayName?: string | null, email?: string | null) {
  if (displayName?.trim()) {
    return displayName.trim();
  }

  if (email?.trim()) {
    return email.split("@")[0] || "Player";
  }

  return "Player";
}
