import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { onSnapshot, orderBy, query, Unsubscribe } from "firebase/firestore";
import { useTranslation } from "react-i18next";

import { GameEndActions } from "@/components/GameEndActions";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, Typography } from "@/constants/theme";
import {
  createGameSession,
  forceEndGameSession,
  joinGameSession,
  resetGameSession,
  startGameSession,
  submitSessionSelection,
  togglePlayerReady,
  updateSessionAllReady,
} from "./gameState";
import {
  getFirebaseErrorCode,
  getFirebaseErrorMessage,
  getTriviaPlayersPath,
  getTriviaPlayersRef,
  getTriviaSessionPath,
  getTriviaSessionRef,
  logTriviaFirebaseError,
} from "./firebaseUtils";
import { scoreSessionAnswer, type ScoreResult } from "./scoring";
import { advanceTurn } from "./turnManager";
import type { TriviaPlayer, TriviaQuestion, TriviaSession } from "./types";

const QUESTION_SECONDS = 15;
const TRIVIA_MIN_PLAYERS = 2;
const FALLBACK_PLAYER_NAME = "Player";

export default function TriviaBlitzScreen() {
  const { t } = useTranslation();
  const { user, firebaseUser, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    joinCode?: string | string[];
    code?: string | string[];
    start?: string | string[];
  }>();
  const requestedSessionId = useMemo(
    () => normalizeParam(params.sessionId) || normalizeParam(params.joinCode) || normalizeParam(params.code),
    [params.code, params.joinCode, params.sessionId],
  );
  const shouldAutoStart = normalizeParam(params.start) === "1";
  const [sessionId, setSessionId] = useState(requestedSessionId);
  const [playerId, setPlayerId] = useState("");
  const [session, setSession] = useState<TriviaSession | null>(null);
  const [players, setPlayers] = useState<TriviaPlayer[]>([]);
  const [secondsRemaining, setSecondsRemaining] = useState(QUESTION_SECONDS);
  const [lastResult, setLastResult] = useState<ScoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [soloTestMode, setSoloTestMode] = useState(__DEV__);
  const setupInFlightRef = useRef(false);
  const scoringInFlightRef = useRef(false);
  const scoredSelectionRef = useRef<string | null>(null);

  const resolvedPlayerName = useMemo(
    () => resolvePlayerName(user?.displayName, firebaseUser?.displayName, user?.email ?? firebaseUser?.email),
    [firebaseUser?.displayName, firebaseUser?.email, user?.displayName, user?.email],
  );

  useEffect(() => {
    if (!requestedSessionId || playerId || requestedSessionId === sessionId) {
      return;
    }

    setSessionId(requestedSessionId);
    setSession(null);
    setPlayers([]);
    setSetupError(null);
  }, [playerId, requestedSessionId, sessionId]);

  useEffect(() => {
    if (authLoading || playerId || setupError || setupInFlightRef.current) {
      return;
    }

    if (!firebaseUser) {
      setSetupError("Please sign in before starting Trivia Blitz.");
      return;
    }

    let isMounted = true;
    const targetSessionId = requestedSessionId || sessionId;

    setupInFlightRef.current = true;
    setSettingUp(true);

    async function setupTriviaSession() {
      try {
        const result = targetSessionId
          ? await joinGameSession(targetSessionId, resolvedPlayerName)
          : await createGameSession(resolvedPlayerName);

        if (!isMounted) {
          return;
        }

        if (shouldAutoStart && __DEV__) {
          await startGameSession(result.sessionId);
        }

        setSessionId(result.sessionId);
        setPlayerId(result.playerId);
        setSetupError(null);
        if (!requestedSessionId) {
          router.replace({ pathname: "/games/trivia-blitz/play", params: { sessionId: result.sessionId } } as never);
        }
      } catch (error) {
        if (isMounted) {
          setSetupError(getFirebaseErrorMessage(error));
        }
      } finally {
        if (isMounted) {
          setSettingUp(false);
        }
        setupInFlightRef.current = false;
      }
    }

    void setupTriviaSession();

    return () => {
      isMounted = false;
    };
  }, [authLoading, firebaseUser, playerId, requestedSessionId, resolvedPlayerName, sessionId, setupAttempt, setupError, shouldAutoStart]);

  const self = useMemo(
    () => players.find((player) => player.id === playerId) ?? null,
    [playerId, players],
  );
  const activePlayer = useMemo(
    () => players.find((player) => player.playerIndex === session?.turnIndex) ?? null,
    [players, session?.turnIndex],
  );
  const currentQuestion = session?.selectedQuestions[session.questionIndex] as TriviaQuestion | undefined;
  const isHost = Boolean(self && (session?.hostPlayerId === self.id || self.playerIndex === 0));
  const isActiveTurn = Boolean(self && activePlayer?.id === self.id);
  const canStartGame = players.length >= TRIVIA_MIN_PLAYERS || (__DEV__ && soloTestMode);
  const lobbyPlayerSignature = players.map((player) => `${player.id}:${player.ready}`).join("|");
  const activeSelectionKey = session?.currentSelection
    ? `${session.currentSelection.playerId}:${session.currentSelection.answerIndex}:${session.currentSelection.selectedAt}`
    : null;

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setPlayers([]);
      return;
    }

    const unsubscribers: Unsubscribe[] = [];
    unsubscribers.push(
      onSnapshot(
        getTriviaSessionRef(sessionId),
        (snapshot) => {
          setSession(snapshot.exists() ? (snapshot.data() as TriviaSession) : null);
        },
        (error) => {
          logTriviaFirebaseError("subscribeSession", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
          setSetupError(getFirebaseErrorMessage(error));
        },
      ),
    );

    const playersQuery = query(getTriviaPlayersRef(sessionId), orderBy("playerIndex", "asc"));
    unsubscribers.push(
      onSnapshot(
        playersQuery,
        (snapshot) => {
          setPlayers(
            snapshot.docs.map((playerDoc) => ({
              id: playerDoc.id,
              ...(playerDoc.data() as Omit<TriviaPlayer, "id">),
            })),
          );
        },
        (error) => {
          logTriviaFirebaseError("subscribePlayers", { sessionId, path: getTriviaPlayersPath(sessionId) }, error);
          setSetupError(getFirebaseErrorMessage(error));
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sessionId]);

  useEffect(() => {
    if (!isHost || !sessionId || session?.status !== "lobby" || players.length === 0) {
      return;
    }

    const allReady = players.every((player) => player.ready);
    if (session.totalPlayers === players.length && session.allReady === allReady) {
      return;
    }

    let isMounted = true;
    updateSessionAllReady(sessionId).catch((error) => {
      if (isMounted) {
        logTriviaFirebaseError("hostSyncLobbyPlayers", { sessionId, path: getTriviaSessionPath(sessionId) }, error);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isHost, lobbyPlayerSignature, players, session?.allReady, session?.status, session?.totalPlayers, sessionId]);
  useEffect(() => {
    if (session?.status !== "playing") {
      return;
    }

    setSecondsRemaining(QUESTION_SECONDS);
    setLastResult(null);
    scoredSelectionRef.current = null;
  }, [session?.questionIndex, session?.status]);

  useEffect(() => {
    if (session?.status !== "playing" || lastResult) {
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((value) => Math.max(value - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [lastResult, session?.status]);

  useEffect(() => {
    const selectedAnswer = session?.currentSelection?.answerIndex;
    if (
      !isHost ||
      !sessionId ||
      session?.status !== "playing" ||
      selectedAnswer === undefined ||
      session.selectionRevealed ||
      scoringInFlightRef.current ||
      activeSelectionKey === scoredSelectionRef.current
    ) {
      return;
    }

    const answerIndex = selectedAnswer;
    scoringInFlightRef.current = true;
    scoredSelectionRef.current = activeSelectionKey;
    let isMounted = true;

    async function scoreAndAdvance() {
      try {
        const result = await scoreSessionAnswer(sessionId, answerIndex, secondsRemaining);
        if (isMounted) {
          setLastResult(result);
        }
        setTimeout(() => {
          advanceTurn(sessionId).catch((error) => {
            Alert.alert("Trivia Blitz", getFirebaseErrorMessage(error));
          });
        }, 1400);
      } catch (error) {
        if (isMounted) {
          Alert.alert("Trivia Blitz", getFirebaseErrorMessage(error));
        }
      } finally {
        scoringInFlightRef.current = false;
      }
    }

    void scoreAndAdvance();

    return () => {
      isMounted = false;
    };
  }, [activeSelectionKey, isHost, secondsRemaining, session?.currentSelection?.answerIndex, session?.selectionRevealed, session?.status, sessionId]);

  const handleRetrySetup = useCallback(() => {
    setSetupError(null);
    setPlayerId("");
    setSessionId(requestedSessionId);
    setSession(null);
    setPlayers([]);
    setSetupAttempt((value) => value + 1);
  }, [requestedSessionId]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert("Trivia Blitz", getFirebaseErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleToggleReady = useCallback(() => {
    if (!sessionId || !self) {
      return;
    }

    runAction(() => togglePlayerReady(sessionId, self.id, !self.ready));
  }, [runAction, self, sessionId]);

  const handleStart = useCallback(() => {
    if (!sessionId) {
      return;
    }

    if (!canStartGame) {
      Alert.alert("Trivia Blitz", `At least ${TRIVIA_MIN_PLAYERS} players are needed to start.`);
      return;
    }

    runAction(() => startGameSession(sessionId));
  }, [canStartGame, runAction, sessionId]);

  const handleSelectAnswer = useCallback(
    (answerIndex: number) => {
      const questionIndex = session?.questionIndex ?? null;
      const gameStatus = session?.status ?? null;
      const hasAlreadyAnswered = Boolean(session?.currentSelection);
      const timerExpired = secondsRemaining <= 0;
      const isPlayer = Boolean(self);

      if (__DEV__) {
        console.log("[TriviaBlitz:answerTap]", {
          sessionId,
          authUid: firebaseUser?.uid ?? null,
          playerId: (self?.id ?? playerId) || null,
          questionIndex,
          selectedOptionIndex: answerIndex,
          gameStatus,
        });
      }

      const blockAnswer = (reason: string) => {
        if (__DEV__) {
          console.warn("[TriviaBlitz:answerBlocked]", {
            reason,
            sessionId,
            authUid: firebaseUser?.uid ?? null,
            playerId: (self?.id ?? playerId) || null,
            questionIndex,
            gameStatus,
            isPlayer,
            isActiveTurn,
            hasAlreadyAnswered,
            timerExpired,
          });
        }
      };

      if (!sessionId) {
        blockAnswer("missing-session-id");
        return;
      }

      if (!self) {
        blockAnswer("missing-current-player");
        return;
      }

      if (!currentQuestion) {
        blockAnswer("missing-current-question");
        return;
      }

      if (session?.status !== "playing") {
        blockAnswer("game-not-playing");
        return;
      }

      if (hasAlreadyAnswered) {
        blockAnswer("answer-already-submitted");
        return;
      }

      if (!isActiveTurn) {
        blockAnswer("not-active-turn");
        Alert.alert("Trivia Blitz", "It is another player's turn.");
        return;
      }

      runAction(async () => {
        try {
          await submitSessionSelection(sessionId, self.id, answerIndex);
        } catch (error) {
          console.error("[TriviaBlitz:submitAnswer]", {
            path: `sessions/${sessionId}/games/triviaBlitz`,
            authUid: firebaseUser?.uid ?? null,
            playerId: self.id,
            sessionId,
            questionIndex,
            selectedOptionIndex: answerIndex,
            code: getFirebaseErrorCode(error),
            message: getFirebaseErrorMessage(error),
          });
          throw error;
        }
      });
    },
    [
      currentQuestion,
      firebaseUser?.uid,
      isActiveTurn,
      playerId,
      runAction,
      secondsRemaining,
      self,
      session?.currentSelection,
      session?.questionIndex,
      session?.status,
      sessionId,
    ],
  );
  const handleReset = useCallback(() => {
    if (!sessionId) {
      return;
    }

    runAction(() => resetGameSession(sessionId));
  }, [runAction, sessionId]);

  const handleEnd = useCallback(() => {
    if (!sessionId) {
      return;
    }

    runAction(() => forceEndGameSession(sessionId));
  }, [runAction, sessionId]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Trivia Blitz</Text>
          <Text style={styles.subtitle}>Cooperative sideline trivia with rotating turns.</Text>
        </View>

        {setupError ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{t("trivia.setupErrorTitle")}</Text>
            <Text style={styles.metaText}>{t("trivia.setupErrorBody")}</Text>
            <Text style={styles.errorText}>{setupError}</Text>
            <View style={styles.actionsRow}>
              <Pressable style={styles.primaryButton} onPress={handleRetrySetup} disabled={busy || settingUp}>
                <Text style={styles.primaryButtonText}>{t("trivia.tryAgain")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => router.replace("/(tabs)/games" as never)}>
                <Text style={styles.secondaryButtonText}>{t("trivia.backToGames")}</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => router.replace("/(tabs)" as never)}>
                <Text style={styles.secondaryButtonText}>{t("trivia.home")}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {!setupError && (settingUp || !sessionId || !playerId || !session) ? (
          <View style={styles.panel}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.sectionTitle}>{t("trivia.settingUp")}</Text>
            <Text style={styles.metaText}>{resolvedPlayerName}</Text>
          </View>
        ) : null}

        {session?.status === "lobby" ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Lobby Code: {sessionId}</Text>
            {players.map((player) => (
              <View key={player.id} style={styles.playerRow}>
                <Text style={styles.playerName}>{player.name}</Text>
                <Text style={player.ready ? styles.readyText : styles.notReadyText}>
                  {player.ready ? "Ready" : "Not Ready"}
                </Text>
              </View>
            ))}
            {__DEV__ ? (
              <Pressable style={styles.secondaryButton} onPress={() => setSoloTestMode((value) => !value)}>
                <Text style={styles.secondaryButtonText}>Solo Test Mode: {soloTestMode ? "On" : "Off"}</Text>
              </Pressable>
            ) : null}
            {!canStartGame ? (
              <Text style={styles.metaText}>At least {TRIVIA_MIN_PLAYERS} players are needed to start.</Text>
            ) : null}
            <View style={styles.actionsRow}>
              <Pressable style={styles.secondaryButton} onPress={handleToggleReady} disabled={busy || !self}>
                <Text style={styles.secondaryButtonText}>{self?.ready ? "Unready" : "Ready"}</Text>
              </Pressable>
              {isHost ? (
                <Pressable style={[styles.primaryButton, !canStartGame && styles.disabledButton]} onPress={handleStart} disabled={busy || !canStartGame}>
                  <Text style={styles.primaryButtonText}>Start Game</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {session?.status === "playing" && currentQuestion ? (
          <View style={styles.panel}>
            <Text style={styles.metaText}>
              Question {session.questionIndex + 1} of {session.selectedQuestions.length}
            </Text>
            <Text style={styles.metaText}>Turn: {activePlayer?.name ?? FALLBACK_PLAYER_NAME}</Text>
            <Text style={styles.timer}>{secondsRemaining}s</Text>
            <Text style={styles.category}>{currentQuestion.category}</Text>
            <Text style={styles.question}>{currentQuestion.question_en}</Text>
            {currentQuestion.options_en.map((option, index) => {
              const selected = session.currentSelection?.answerIndex === index;
              const correct = (lastResult?.correctAnswerIndex ?? (session.selectionRevealed ? currentQuestion.answer : -1)) === index;

              return (
                <Pressable
                  key={option}
                  style={[
                    styles.answerButton,
                    selected && styles.selectedAnswer,
                    (lastResult || session.selectionRevealed) && correct && styles.correctAnswer,
                  ]}
                  onPress={() => handleSelectAnswer(index)}
                  disabled={busy}
                >
                  <Text style={styles.answerText}>{option}</Text>
                </Pressable>
              );
            })}
            {lastResult ? (
              <Text style={styles.resultText}>
                {lastResult.correct ? "Correct" : "Not quite"} +{lastResult.pointsAwarded} points
              </Text>
            ) : null}
            {isHost ? (
              <Pressable style={styles.dangerButton} onPress={handleEnd} disabled={busy}>
                <Text style={styles.dangerButtonText}>End Game</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {session?.status === "results" ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Results</Text>
            <Text style={styles.scoreText}>Team Points: {session.totalPoints}</Text>
            <Text style={styles.metaText}>Correct Answers: {session.correctAnswers}</Text>
            {players.map((player) => (
              <View key={player.id} style={styles.playerRow}>
                <Text style={styles.playerName}>{player.name}</Text>
                <Text style={styles.scoreText}>{player.score}</Text>
              </View>
            ))}
            <GameEndActions onPlayAgain={handleReset} lobbyRoute="/(games)/trivia-blitz/Lobby" />
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function normalizeParam(value?: string | string[]) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue?.trim().toUpperCase() ?? "";
}

function resolvePlayerName(
  appDisplayName?: string | null,
  firebaseDisplayName?: string | null,
  email?: string | null,
) {
  const displayName = appDisplayName?.trim() || firebaseDisplayName?.trim();
  if (displayName) {
    return displayName;
  }

  const emailPrefix = email?.split("@")[0]?.trim();
  if (emailPrefix) {
    return emailPrefix;
  }

  return FALLBACK_PLAYER_NAME;
}

const styles = StyleSheet.create({
  content: {
    gap: Spacing.md,
    padding: Spacing.lg,
  },
  header: {
    gap: Spacing.xs,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 32,
    textAlign: "center",
  },
  subtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    lineHeight: 22,
    textAlign: "center",
  },
  panel: {
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: 8,
    borderWidth: 1,
    gap: Spacing.md,
    padding: Spacing.md,
  },
  sectionTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 20,
    textAlign: "center",
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    justifyContent: "center",
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  primaryButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodyBold,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  secondaryButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
  },
  disabledButton: {
    opacity: 0.5,
  },
  dangerButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  dangerButtonText: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
  },
  playerRow: {
    alignItems: "center",
    borderBottomColor: Colors.secondary,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
  },
  playerName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    flex: 1,
  },
  readyText: {
    color: Colors.accentGreen,
    fontFamily: Typography.bodyBold,
  },
  notReadyText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
  },
  metaText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    textAlign: "center",
  },
  errorText: {
    color: Colors.primary,
    fontFamily: Typography.bodyMedium,
    lineHeight: 20,
    textAlign: "center",
  },
  timer: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 24,
    textAlign: "center",
  },
  category: {
    color: Colors.accentGold,
    fontFamily: Typography.bodyBold,
    textAlign: "center",
    textTransform: "uppercase",
  },
  question: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 20,
    lineHeight: 28,
    textAlign: "center",
  },
  answerButton: {
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: 8,
    borderWidth: 1,
    padding: Spacing.md,
  },
  selectedAnswer: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  correctAnswer: {
    borderColor: Colors.accentGreen,
    borderWidth: 2,
  },
  answerText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    textAlign: "center",
  },
  resultText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 18,
    textAlign: "center",
  },
  scoreText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
  },
});
