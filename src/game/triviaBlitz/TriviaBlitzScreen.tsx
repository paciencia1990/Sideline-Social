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
import { useSquad } from "@/context/SquadContext";
import { Colors, Spacing, Typography } from "@/constants/theme";
import {
  advanceTriviaGameSession,
  forceEndGameSession,
  joinGameSession,
  startGameSession,
  submitTriviaAnswer,
  togglePlayerReady,
} from "./gameState";
import {
  createTriviaSessionId,
  getFirebaseErrorCode,
  getTriviaPlayersPath,
  getTriviaPlayersRef,
  getTriviaSessionPath,
  getTriviaSessionRef,
  logTriviaFirebaseError,
} from "./firebaseUtils";
import { finalizeGameReward, type GameRewardResult } from "@/services/sidelineStarsService";
import { startGameLobbyRematch, updateGameJoinCodeStatus } from "@/services/gameJoinCodeService";
import { resolveClientGameAuthority } from "@/utils/authIdentity";
import {
  createTriviaQuestionKey,
  getTriviaAnswerAccessibilityLabel,
  getTriviaAnswerFeedbackIcon,
  resolveTriviaAnswerVisualState,
  type TriviaAnswerAccessibilityLabels,
} from "./answerFeedback";
import type { ScoreResult, TriviaPlayer, TriviaSession } from "./types";

const QUESTION_SECONDS = 15;
const TRIVIA_MIN_PLAYERS = 2;

type TriviaErrorKey =
  | "trivia.errors.signInRequired"
  | "trivia.errors.sessionUnavailable"
  | "trivia.errors.sessionClosed"
  | "trivia.errors.questionUnavailable"
  | "trivia.errors.createFailed"
  | "trivia.errors.permissionDenied"
  | "trivia.errors.networkUnavailable"
  | "trivia.errors.generic";

const TRIVIA_CATEGORY_KEYS: Record<string, string> = {
  Sports: "trivia.categories.sports",
  "Parenting & Family": "trivia.categories.parentingFamily",
  "Pop Culture": "trivia.categories.popCulture",
};

type QuestionScoreResult = ScoreResult & {
  questionKey: string;
};

export default function TriviaBlitzScreen() {
  const { i18n, t } = useTranslation();
  const { user, firebaseUser, loading: authLoading } = useAuth();
  const { selectedSquadId } = useSquad();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    joinCode?: string | string[];
    code?: string | string[];
    lobbyId?: string | string[];
  }>();
  const requestedSessionId = useMemo(
    () => normalizeParam(params.sessionId) || normalizeParam(params.joinCode) || normalizeParam(params.code),
    [params.code, params.joinCode, params.sessionId],
  );
  const lobbyId = normalizeParam(params.lobbyId);
  const [sessionId, setSessionId] = useState(requestedSessionId);
  const [playerId, setPlayerId] = useState("");
  const [session, setSession] = useState<TriviaSession | null>(null);
  const [players, setPlayers] = useState<TriviaPlayer[]>([]);
  const [secondsRemaining, setSecondsRemaining] = useState(QUESTION_SECONDS);
  const [lastResult, setLastResult] = useState<QuestionScoreResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [setupError, setSetupError] = useState<TriviaErrorKey | null>(null);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [rewardResult, setRewardResult] = useState<GameRewardResult | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const setupInFlightRef = useRef(false);
  const advanceInFlightRef = useRef(false);
  const advancedQuestionRef = useRef<string | null>(null);
  const announcedFeedbackRef = useRef<string | null>(null);
  const rewardRequestKeyRef = useRef("");
  const lifecycleEndedRef = useRef("");
  const rematchInFlightRef = useRef(false);
  const fallbackPlayerName = t("games.playerFallback");

  const resolvedPlayerName = useMemo(
    () =>
      resolvePlayerName(
        user?.displayName,
        firebaseUser?.displayName,
        user?.email ?? firebaseUser?.email,
        fallbackPlayerName,
      ),
    [
      fallbackPlayerName,
      firebaseUser?.displayName,
      firebaseUser?.email,
      user?.displayName,
      user?.email,
    ],
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
      setSetupError("trivia.errors.signInRequired");
      return;
    }

    let isMounted = true;
    const targetSessionId = requestedSessionId || sessionId;

    setupInFlightRef.current = true;
    setSettingUp(true);
    if (!targetSessionId) {
      setupInFlightRef.current = false;
      setSettingUp(false);
      setSetupError("trivia.errors.sessionUnavailable");
      return;
    }

    async function setupTriviaSession() {
      try {
        const result = await joinGameSession(targetSessionId, resolvedPlayerName);

        if (!isMounted) {
          return;
        }

        setSessionId(result.sessionId);
        setPlayerId(result.playerId);
        setSetupError(null);
      } catch (error) {
        if (isMounted) {
          setSetupError(getTriviaErrorTranslationKey(error));
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
  }, [authLoading, firebaseUser, playerId, requestedSessionId, resolvedPlayerName, sessionId, setupAttempt, setupError]);

  const self = useMemo(
    () => players.find((player) => player.id === playerId) ?? null,
    [playerId, players],
  );
  const activePlayer = useMemo(
    () => players.find((player) => player.playerIndex === session?.turnIndex) ?? null,
    [players, session?.turnIndex],
  );
  const currentQuestion = session?.currentQuestion ?? null;
  const currentQuestionKey = currentQuestion
    ? createTriviaQuestionKey(session?.questionIndex ?? -1, currentQuestion.id)
    : "";
  const synchronizedResult =
    session?.answerResult &&
    session.answerResult.questionIndex === session.questionIndex
      ? session.answerResult
      : null;
  const currentResult =
    synchronizedResult ??
    (lastResult?.questionKey === currentQuestionKey ? lastResult : null);
  const selectedAnswerIndex = session?.currentSelection?.answerIndex ?? null;
  const feedbackQuestionKey = currentResult ? currentQuestionKey : null;
  const answerResultKnown = Boolean(currentQuestion && feedbackQuestionKey && currentResult);
  const correctAnswerIndex = currentResult?.correctAnswerIndex ?? -1;
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
    ? currentAnswerOptions[correctAnswerIndex] ?? ""
    : "";
  const selectionBelongsToSelf = Boolean(
    self && session?.currentSelection?.playerId === self.id,
  );
  const selectedAnswerWasCorrect = Boolean(answerResultKnown && currentResult?.correct);
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
  const gameAuthority = resolveClientGameAuthority({
    hostUserId: session?.hostPlayerId,
    participantUserIds: players.map((player) => player.id),
    user: firebaseUser,
  });
  const isHost = Boolean(self && gameAuthority.isHost);
  const isActiveTurn = Boolean(self && activePlayer?.id === self.id);
  const canStartGame = players.length >= TRIVIA_MIN_PLAYERS;

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
          setSetupError(getTriviaErrorTranslationKey(error));
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
          setSetupError(getTriviaErrorTranslationKey(error));
        },
      ),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sessionId]);

  useEffect(() => {
    if (session?.status !== "playing") {
      return;
    }

    const questionEndsAtMs = readTimestampMillis(session.questionEndsAt);
    setSecondsRemaining(
      questionEndsAtMs
        ? Math.max(Math.ceil((questionEndsAtMs - Date.now()) / 1000), 0)
        : QUESTION_SECONDS,
    );
    setLastResult(null);
    advancedQuestionRef.current = null;
    announcedFeedbackRef.current = null;
  }, [session?.questionEndsAt, session?.questionIndex, session?.status]);

  useEffect(() => {
    if (session?.status !== "playing") {
      return;
    }

    const updateRemainingTime = () => {
      const questionEndsAtMs = readTimestampMillis(session.questionEndsAt);
      setSecondsRemaining(
        questionEndsAtMs
          ? Math.max(Math.ceil((questionEndsAtMs - Date.now()) / 1000), 0)
          : 0,
      );
    };
    updateRemainingTime();
    const timer = setInterval(() => {
      updateRemainingTime();
    }, 250);

    return () => clearInterval(timer);
  }, [session?.questionEndsAt, session?.status]);

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
    if (
      !isHost ||
      !sessionId ||
      !currentQuestionKey ||
      session?.status !== "playing"
    ) {
      return;
    }

    const questionAdvanceKey = `${sessionId}:${session.questionIndex}`;
    const questionEndsAtMs = readTimestampMillis(session.questionEndsAt);
    const delayMs = currentResult
      ? 1400
      : Math.max((questionEndsAtMs || Date.now()) - Date.now() + 100, 0);
    const timer = setTimeout(() => {
      if (
        advanceInFlightRef.current ||
        advancedQuestionRef.current === questionAdvanceKey
      ) {
        return;
      }

      advanceInFlightRef.current = true;
      void advanceTriviaGameSession({
        sessionId,
        questionIndex: session.questionIndex,
      })
        .then(() => {
          advancedQuestionRef.current = questionAdvanceKey;
        })
        .catch((error) => {
          logTriviaFirebaseError("advanceQuestion", {}, error);
          Alert.alert(
            t("games.triviaBlitz.title"),
            t(getTriviaErrorTranslationKey(error)),
          );
        })
        .finally(() => {
          advanceInFlightRef.current = false;
        });
    }, delayMs);

    return () => clearTimeout(timer);
  }, [
    currentQuestionKey,
    currentResult,
    isHost,
    session?.questionEndsAt,
    session?.questionIndex,
    session?.status,
    sessionId,
    t,
  ]);

  const handleRetrySetup = useCallback(() => {
    setSetupError(null);
    setPlayerId("");
    setSessionId(requestedSessionId);
    setSession(null);
    setPlayers([]);
    setSetupAttempt((value) => value + 1);
  }, [requestedSessionId]);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert(
        t("games.triviaBlitz.title"),
        t(getTriviaErrorTranslationKey(error)),
      );
    } finally {
      setBusy(false);
    }
  }, [t]);

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
      Alert.alert(
        t("games.triviaBlitz.title"),
        t("trivia.minimumPlayers", { count: TRIVIA_MIN_PLAYERS }),
      );
      return;
    }

    runAction(() => startGameSession(sessionId));
  }, [canStartGame, runAction, sessionId, t]);

  const handleSelectAnswer = useCallback(
    (answerIndex: number) => {
      const hasAlreadyAnswered = Boolean(session?.currentSelection || session?.answerResult);

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
        Alert.alert(
          t("games.triviaBlitz.title"),
          t("trivia.anotherPlayersTurn"),
        );
        return;
      }

      const questionIndex = session.questionIndex;
      const questionKey = currentQuestionKey;
      const submissionId = createTriviaSessionId();
      runAction(async () => {
        const result = await submitTriviaAnswer({
          sessionId,
          questionIndex,
          answerIndex,
          submissionId,
        });
        setLastResult({ ...result, questionKey });
      });
    },
    [
      currentQuestion,
      currentQuestionKey,
      isActiveTurn,
      runAction,
      self,
      session?.answerResult,
      session?.currentSelection,
      session?.questionIndex,
      session?.status,
      sessionId,
      t,
    ],
  );
  const openLobbyDirectory = useCallback(() => {
    if (selectedSquadId) {
      router.replace({
        pathname: "/(games)/lobbies",
        params: { gameType: "triviaBlitz", squadId: selectedSquadId },
      } as never);
      return;
    }
    router.replace("/(tabs)/games" as never);
  }, [selectedSquadId]);

  const handleReset = useCallback(async () => {
    if (requestedSessionId) {
      if (!lobbyId || !gameAuthority.isHost || rematchInFlightRef.current) {
        openLobbyDirectory();
        return;
      }
      rematchInFlightRef.current = true;
      try {
        const rematch = await startGameLobbyRematch({ lobbyId });
        router.replace({
          pathname: "/(games)/trivia-blitz/Lobby",
          params: { lobbyId: rematch.lobbyId, sessionId: rematch.sessionId },
        } as never);
      } catch {
        openLobbyDirectory();
      } finally {
        rematchInFlightRef.current = false;
      }
      return;
    }
    router.replace("/(tabs)/games" as never);
  }, [gameAuthority.isHost, lobbyId, openLobbyDirectory, requestedSessionId]);

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
          <Text style={styles.title}>{t("games.triviaBlitz.title")}</Text>
          <Text style={styles.subtitle}>{t("trivia.subtitle")}</Text>
        </View>

        {setupError ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>{t("trivia.setupErrorTitle")}</Text>
            <Text style={styles.metaText}>{t("trivia.setupErrorBody")}</Text>
            <Text style={styles.errorText}>{t(setupError)}</Text>
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
            <Text style={styles.sectionTitle}>{t("games.lobby.title")}</Text>
            {players.map((player) => (
              <View key={player.id} style={styles.playerRow}>
                <Text style={styles.playerName}>{player.name}</Text>
                <Text style={player.ready ? styles.readyText : styles.notReadyText}>
                  {player.ready
                    ? t("games.joinCode.ready")
                    : t("games.joinCode.notReady")}
                </Text>
              </View>
            ))}
            {!canStartGame ? (
              <Text style={styles.metaText}>
                {t("trivia.minimumPlayers", { count: TRIVIA_MIN_PLAYERS })}
              </Text>
            ) : null}
            <View style={styles.actionsRow}>
              <Pressable style={styles.secondaryButton} onPress={handleToggleReady} disabled={busy || !self}>
                <Text style={styles.secondaryButtonText}>
                  {self?.ready
                    ? t("games.joinCode.unready")
                    : t("games.joinCode.ready")}
                </Text>
              </Pressable>
              {isHost ? (
                <Pressable style={[styles.primaryButton, !canStartGame && styles.disabledButton]} onPress={handleStart} disabled={busy || !canStartGame}>
                  <Text style={styles.primaryButtonText}>
                    {t("games.joinCode.startGame")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {session?.status === "playing" && currentQuestion ? (
          <View style={styles.panel}>
            <Text style={styles.metaText}>
              {t("trivia.questionProgress", {
                current: session.questionIndex + 1,
                total: session.questionCount,
              })}
            </Text>
            <Text style={styles.metaText}>
              {t("trivia.turn", {
                player: activePlayer?.name ?? fallbackPlayerName,
              })}
            </Text>
            <Text
              style={styles.timer}
              accessibilityLabel={t("trivia.secondsRemaining", {
                count: secondsRemaining,
              })}
            >
              {t("trivia.secondsShort", { count: secondsRemaining })}
            </Text>
            <Text style={styles.category}>
              {t(
                TRIVIA_CATEGORY_KEYS[currentQuestion.category] ??
                  "trivia.categories.other",
              )}
            </Text>
            <Text style={styles.question}>{currentQuestionText}</Text>
            {currentAnswerOptions.map((option, index) => {
              const selected = session.currentSelection?.answerIndex === index;
              const visualState = resolveTriviaAnswerVisualState({
                answerIndex: index,
                selectedAnswerIndex,
                correctAnswerIndex,
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
                <Text style={styles.dangerButtonText}>{t("trivia.endGame")}</Text>
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
            <GameEndActions onBackToLobby={openLobbyDirectory} onPlayAgain={handleReset} lobbyRoute="/(games)/trivia-blitz/Lobby" />
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
  appDisplayName: string | null | undefined,
  firebaseDisplayName: string | null | undefined,
  email: string | null | undefined,
  fallbackName: string,
) {
  const displayName = appDisplayName?.trim() || firebaseDisplayName?.trim();
  if (displayName) {
    return displayName;
  }

  const emailPrefix = email?.split("@")[0]?.trim();
  if (emailPrefix) {
    return emailPrefix;
  }

  return fallbackName;
}

function getTriviaErrorTranslationKey(error: unknown): TriviaErrorKey {
  const code = getFirebaseErrorCode(error)
    .toLowerCase()
    .replace(/^functions\//, "")
    .replace(/^firestore\//, "");

  if (code === "unauthenticated") {
    return "trivia.errors.signInRequired";
  }
  if (code === "permission-denied") {
    return "trivia.errors.permissionDenied";
  }
  if (code === "not-found") {
    return "trivia.errors.sessionUnavailable";
  }
  if (code === "failed-precondition" || code === "already-exists") {
    return "trivia.errors.sessionClosed";
  }
  if (code === "invalid-argument" || code === "out-of-range") {
    return "trivia.errors.questionUnavailable";
  }
  if (
    code === "unavailable" ||
    code === "deadline-exceeded" ||
    code === "network-request-failed"
  ) {
    return "trivia.errors.networkUnavailable";
  }

  return "trivia.errors.generic";
}

function readTimestampMillis(value: unknown): number | null {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    const millis = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(millis) && millis > 0 ? millis : null;
  }

  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const seconds = (value as { seconds: number }).seconds;
    const nanoseconds =
      "nanoseconds" in value &&
      typeof (value as { nanoseconds?: unknown }).nanoseconds === "number"
        ? (value as { nanoseconds: number }).nanoseconds
        : 0;
    const millis = seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
    return Number.isFinite(millis) && millis > 0 ? millis : null;
  }

  return null;
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
