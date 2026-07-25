import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
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
import { Check, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { GameEndActions } from "@/components/GameEndActions";
import { GameRewardSummary } from "@/components/GameRewardSummary";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Spacing, Typography } from "@/constants/theme";
import {
  createGameSession,
  forceEndGameSession,
  joinGameSession,
  startGameSession,
  submitSessionSelection,
  togglePlayerReady,
  updateSessionAllReady,
} from "./gameState";
import {
  getFirebaseErrorMessage,
  getTriviaPlayersPath,
  getTriviaPlayersRef,
  getTriviaSessionPath,
  getTriviaSessionRef,
  logTriviaFirebaseError,
} from "./firebaseUtils";
import { scoreSessionAnswer, type ScoreResult } from "./scoring";
import { finalizeGameReward, type GameRewardResult } from "@/services/sidelineStarsService";
import { updateGameJoinCodeStatus } from "@/services/gameJoinCodeService";
import {
  createTriviaQuestionKey,
  getTriviaAnswerAccessibilityLabel,
  getTriviaAnswerFeedbackIcon,
  resolveTriviaAnswerVisualState,
  type TriviaAnswerAccessibilityLabels,
} from "./answerFeedback";
import { advanceTurn } from "./turnManager";
import type { TriviaPlayer, TriviaQuestion, TriviaSession } from "./types";

const QUESTION_SECONDS = 15;
const TRIVIA_MIN_PLAYERS = 2;
const FALLBACK_PLAYER_NAME = "Player";

type QuestionScoreResult = ScoreResult & {
  questionKey: string;
};

export default function TriviaBlitzScreen() {
  const { i18n, t } = useTranslation();
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
  const [lastResult, setLastResult] = useState<QuestionScoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [rewardResult, setRewardResult] = useState<GameRewardResult | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const setupInFlightRef = useRef(false);
  const scoringInFlightRef = useRef(false);
  const scoredSelectionRef = useRef<string | null>(null);
  const announcedFeedbackRef = useRef<string | null>(null);
  const rewardRequestKeyRef = useRef("");
  const lifecycleEndedRef = useRef("");

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
        let result;
        if (targetSessionId) {
          try {
            result = await joinGameSession(targetSessionId, resolvedPlayerName);
          } catch (joinError) {
            if (!shouldAutoStart) throw joinError;
            try {
              result = await createGameSession(resolvedPlayerName, targetSessionId);
            } catch {
              result = await joinGameSession(targetSessionId, resolvedPlayerName);
            }
          }
        } else {
          result = await createGameSession(resolvedPlayerName);
        }

        if (!isMounted) {
          return;
        }

        if (shouldAutoStart && result.isHost) {
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
  const currentQuestionKey = currentQuestion
    ? createTriviaQuestionKey(session?.questionIndex ?? -1, currentQuestion.id)
    : "";
  const currentResult = lastResult?.questionKey === currentQuestionKey ? lastResult : null;
  const selectedAnswerIndex = session?.currentSelection?.answerIndex ?? null;
  const synchronizedResultKnown = Boolean(session?.selectionRevealed && session.currentSelection);
  const feedbackQuestionKey =
    currentResult?.questionKey ?? (synchronizedResultKnown ? currentQuestionKey : null);
  const answerResultKnown = Boolean(
    currentQuestion &&
      feedbackQuestionKey &&
      (currentResult || synchronizedResultKnown),
  );
  const isSpanish = (i18n.resolvedLanguage ?? i18n.language).toLowerCase().startsWith("es");
  const currentQuestionText = currentQuestion
    ? isSpanish
      ? currentQuestion.question_es
      : currentQuestion.question_en
    : "";
  const currentAnswerOptions = currentQuestion
    ? isSpanish
      ? currentQuestion.options_es
      : currentQuestion.options_en
    : [];
  const correctAnswerText = currentQuestion
    ? currentAnswerOptions[currentQuestion.answer] ?? ""
    : "";
  const selectionBelongsToSelf = Boolean(
    self && session?.currentSelection?.playerId === self.id,
  );
  const selectedAnswerWasCorrect = Boolean(
    answerResultKnown &&
      currentQuestion &&
      selectedAnswerIndex === currentQuestion.answer,
  );
  const answerAccessibilityLabels = useMemo<TriviaAnswerAccessibilityLabels>(
    () => ({
      correctAnswer: t("trivia.feedback.correctAnswer"),
      yourAnswerCorrect: t("trivia.feedback.yourAnswerCorrect"),
      yourAnswerIncorrect: t("trivia.feedback.yourAnswerIncorrect"),
      selectedAnswerIncorrect: t("trivia.feedback.selectedAnswerIncorrect"),
      notSelected: t("trivia.feedback.notSelected"),
    }),
    [t],
  );
  const feedbackAnnouncement = answerResultKnown
    ? selectedAnswerWasCorrect
      ? selectionBelongsToSelf
        ? t("trivia.feedback.yourAnswerCorrect")
        : t("trivia.feedback.correctAnswer")
      : selectionBelongsToSelf
        ? t("trivia.feedback.yourAnswerIncorrectWithCorrect", { answer: correctAnswerText })
        : t("trivia.feedback.selectedAnswerIncorrectWithCorrect", { answer: correctAnswerText })
    : "";
  const isHost = Boolean(self && (session?.hostPlayerId === self.id || self.playerIndex === 0));
  const isActiveTurn = Boolean(self && activePlayer?.id === self.id);
  // "Play Now" intentionally creates a legitimate authenticated solo session.
  // Joined lobbies retain the existing multiplayer minimum.
  const canStartGame = players.length >= TRIVIA_MIN_PLAYERS || (shouldAutoStart && players.length === 1);
  const lobbyPlayerSignature = players.map((player) => `${player.id}:${player.ready}`).join("|");
  const activeSelectionKey = session?.currentSelection
    ? `${currentQuestionKey}:${session.currentSelection.playerId}:${session.currentSelection.answerIndex}:${session.currentSelection.selectedAt}`
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
    announcedFeedbackRef.current = null;
  }, [session?.questionIndex, session?.status]);

  useEffect(() => {
    if (session?.status !== "playing" || currentResult) {
      return;
    }

    const timer = setInterval(() => {
      setSecondsRemaining((value) => Math.max(value - 1, 0));
    }, 1000);

    return () => clearInterval(timer);
  }, [currentResult, session?.status]);

  useEffect(() => {
    if (
      !answerResultKnown ||
      !feedbackQuestionKey ||
      !feedbackAnnouncement ||
      announcedFeedbackRef.current === feedbackQuestionKey
    ) {
      return;
    }

    announcedFeedbackRef.current = feedbackQuestionKey;
    AccessibilityInfo.announceForAccessibility(feedbackAnnouncement);
  }, [answerResultKnown, feedbackAnnouncement, feedbackQuestionKey]);

  useEffect(() => {
    const selectedAnswer = session?.currentSelection?.answerIndex;
    if (
      !isHost ||
      !sessionId ||
      !currentQuestionKey ||
      session?.status !== "playing" ||
      selectedAnswer === undefined ||
      session.selectionRevealed ||
      scoringInFlightRef.current ||
      activeSelectionKey === scoredSelectionRef.current
    ) {
      return;
    }

    const answerIndex = selectedAnswer;
    const scoringQuestionKey = currentQuestionKey;
    scoringInFlightRef.current = true;
    scoredSelectionRef.current = activeSelectionKey;
    let isMounted = true;

    async function scoreAndAdvance() {
      try {
        const result = await scoreSessionAnswer(sessionId, answerIndex, secondsRemaining);
        if (isMounted) {
          setLastResult({ ...result, questionKey: scoringQuestionKey });
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
  }, [activeSelectionKey, currentQuestionKey, isHost, secondsRemaining, session?.currentSelection?.answerIndex, session?.selectionRevealed, session?.status, sessionId]);

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
      const hasAlreadyAnswered = Boolean(session?.currentSelection);

      if (!sessionId) {
        return;
      }

      if (!self) {
        return;
      }

      if (!currentQuestion) {
        return;
      }

      if (session?.status !== "playing") {
        return;
      }

      if (hasAlreadyAnswered) {
        return;
      }

      if (!isActiveTurn) {
        Alert.alert("Trivia Blitz", "It is another player's turn.");
        return;
      }

      runAction(() => submitSessionSelection(sessionId, self.id, answerIndex));
    },
    [
      currentQuestion,
      isActiveTurn,
      runAction,
      self,
      session?.currentSelection,
      session?.status,
      sessionId,
    ],
  );
  const handleReset = useCallback(() => {
    if (requestedSessionId) {
      router.replace({ pathname: "/(games)/trivia-blitz/Lobby", params: { host: "1" } } as never);
      return;
    }
    setPlayerId("");
    setSessionId("");
    setSession(null);
    setPlayers([]);
    setLastResult(null);
    setSetupError(null);
    setRewardResult(null);
    setRewardError(null);
    rewardRequestKeyRef.current = "";
    setupInFlightRef.current = false;
    setSetupAttempt((value) => value + 1);
    router.replace({ pathname: "/games/trivia-blitz/play", params: { start: "1", replay: String(Date.now()) } } as never);
  }, [requestedSessionId]);

  const handleEnd = useCallback(() => {
    if (!sessionId) {
      return;
    }

    runAction(() => forceEndGameSession(sessionId));
  }, [runAction, sessionId]);

  const awardTriviaResult = useCallback(async () => {
    if (!sessionId || session?.status !== "results") return;
    const rewardKey = `${sessionId}:results`;
    if (rewardRequestKeyRef.current === rewardKey && rewardResult) return;
    rewardRequestKeyRef.current = rewardKey;
    setRewardLoading(true);
    setRewardError(null);
    try {
      setRewardResult(await finalizeGameReward("triviaBlitz", sessionId));
    } catch {
      rewardRequestKeyRef.current = "";
      setRewardError(t("rewards.awardError"));
    } finally {
      setRewardLoading(false);
    }
  }, [rewardResult, session?.status, sessionId, t]);

  useEffect(() => {
    if (session?.status === "results") void awardTriviaResult();
  }, [awardTriviaResult, session?.status]);

  useEffect(() => {
    if (!requestedSessionId || session?.status !== "results" || lifecycleEndedRef.current === requestedSessionId) return;
    lifecycleEndedRef.current = requestedSessionId;
    void updateGameJoinCodeStatus({
      gameType: "triviaBlitz",
      sessionId: requestedSessionId,
      status: "ended",
    }).catch(() => undefined);
  }, [requestedSessionId, session?.status]);

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
            <Text style={styles.sectionTitle}>{t("games.joinCode.localTest")}</Text>
            {players.map((player) => (
              <View key={player.id} style={styles.playerRow}>
                <Text style={styles.playerName}>{player.name}</Text>
                <Text style={player.ready ? styles.readyText : styles.notReadyText}>
                  {player.ready ? "Ready" : "Not Ready"}
                </Text>
              </View>
            ))}
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
            <Text style={styles.question}>{currentQuestionText}</Text>
            {currentAnswerOptions.map((option, index) => {
              const selected = session.currentSelection?.answerIndex === index;
              const visualState = resolveTriviaAnswerVisualState({
                answerIndex: index,
                selectedAnswerIndex,
                correctAnswerIndex: currentQuestion.answer,
                resultKnown: answerResultKnown,
                currentQuestionKey,
                feedbackQuestionKey,
              });
              const feedbackIcon = getTriviaAnswerFeedbackIcon(visualState);
              const usesSelectedStyle =
                visualState === "selected-pending" || visualState === "selected-incorrect";
              const usesCorrectStyle =
                visualState === "selected-correct" || visualState === "revealed-correct";
              const answerLocked = Boolean(session.currentSelection);

              return (
                <Pressable
                  key={`${currentQuestionKey}:${index}`}
                  style={[
                    styles.answerButton,
                    usesSelectedStyle && styles.selectedAnswer,
                    usesCorrectStyle && styles.correctAnswer,
                  ]}
                  onPress={() => handleSelectAnswer(index)}
                  disabled={busy || answerLocked}
                  accessibilityRole="button"
                  accessibilityLabel={getTriviaAnswerAccessibilityLabel(
                    option,
                    visualState,
                    answerAccessibilityLabels,
                    selectionBelongsToSelf,
                  )}
                  accessibilityState={{
                    disabled: busy || answerLocked,
                    selected,
                  }}
                >
                  <View style={styles.answerContent}>
                    <Text style={styles.answerText}>{option}</Text>
                    <View
                      style={styles.feedbackIconSlot}
                      pointerEvents="none"
                      accessible={false}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    >
                      {feedbackIcon === "check" ? (
                        <Check
                          color={Colors.textHeading}
                          size={24}
                          strokeWidth={3}
                          testID={`trivia-answer-check-${index}`}
                        />
                      ) : null}
                      {feedbackIcon === "x" ? (
                        <X
                          color={Colors.primary}
                          size={24}
                          strokeWidth={3}
                          testID={`trivia-answer-x-${index}`}
                        />
                      ) : null}
                    </View>
                  </View>
                </Pressable>
              );
            })}
            {answerResultKnown ? (
              <Text style={styles.resultText} accessibilityLabel={feedbackAnnouncement}>
                {selectedAnswerWasCorrect ? t("trivia.correct") : t("trivia.notQuite")}
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
            <Text style={styles.sectionTitle}>{t("trivia.results")}</Text>
            <GameRewardSummary
              detailLines={[
                t("rewards.correctAnswers", { count: session.correctAnswers }),
                t("rewards.completionStars", { count: 5 }),
              ]}
              error={rewardError}
              loading={rewardLoading}
              onRetry={() => void awardTriviaResult()}
              result={rewardResult}
            />
            <GameEndActions onPlayAgain={handleReset} lobbyRoute="/(games)/trivia-blitz/Lobby" />
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function normalizeParam(value?: string | string[]) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const trimmed = rawValue?.trim() ?? "";
  return /^[A-Za-z0-9]{4,6}$/.test(trimmed) ? trimmed.toUpperCase() : trimmed;
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
  answerContent: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 24,
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
    flex: 1,
    flexShrink: 1,
    textAlign: "center",
  },
  feedbackIconSlot: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    marginLeft: Spacing.sm,
    minHeight: 24,
    width: 24,
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
