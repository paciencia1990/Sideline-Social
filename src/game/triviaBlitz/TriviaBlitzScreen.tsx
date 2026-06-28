import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { onSnapshot, orderBy, query, Unsubscribe } from "firebase/firestore";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";
import {
  createGameSession,
  forceEndGameSession,
  joinGameSession,
  resetGameSession,
  startGameSession,
  submitSessionSelection,
  togglePlayerReady,
} from "./gameState";
import { getFirebaseErrorMessage, getTriviaPlayersRef, getTriviaSessionRef } from "./firebaseUtils";
import { scoreSessionAnswer, type ScoreResult } from "./scoring";
import { advanceTurn } from "./turnManager";
import type { TriviaPlayer, TriviaQuestion, TriviaSession } from "./types";

const QUESTION_SECONDS = 15;

export default function TriviaBlitzScreen() {
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const initialSessionId = normalizeParam(params.sessionId);
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [joinCodeInput, setJoinCodeInput] = useState(initialSessionId);
  const [playerId, setPlayerId] = useState("");
  const [playerName, setPlayerName] = useState("Player");
  const [session, setSession] = useState<TriviaSession | null>(null);
  const [players, setPlayers] = useState<TriviaPlayer[]>([]);
  const [secondsRemaining, setSecondsRemaining] = useState(QUESTION_SECONDS);
  const [lastResult, setLastResult] = useState<ScoreResult | null>(null);
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setPlayers([]);
      return;
    }

    const unsubscribers: Unsubscribe[] = [];
    unsubscribers.push(
      onSnapshot(getTriviaSessionRef(sessionId), (snapshot) => {
        setSession(snapshot.exists() ? (snapshot.data() as TriviaSession) : null);
      }),
    );

    const playersQuery = query(getTriviaPlayersRef(sessionId), orderBy("playerIndex", "asc"));
    unsubscribers.push(
      onSnapshot(playersQuery, (snapshot) => {
        setPlayers(
          snapshot.docs.map((playerDoc) => ({
            id: playerDoc.id,
            ...(playerDoc.data() as Omit<TriviaPlayer, "id">),
          })),
        );
      }),
    );

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [sessionId]);

  useEffect(() => {
    if (session?.status !== "playing") {
      return;
    }

    setSecondsRemaining(QUESTION_SECONDS);
    setLastResult(null);
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

  const handleCreate = useCallback(() => {
    runAction(async () => {
      const created = await createGameSession(playerName.trim() || "Host");
      setSessionId(created.sessionId);
      setJoinCodeInput(created.sessionId);
      setPlayerId(created.playerId);
    });
  }, [playerName, runAction]);

  const handleJoin = useCallback(() => {
    runAction(async () => {
      const joined = await joinGameSession(joinCodeInput, playerName.trim() || "Player");
      setSessionId(joined.sessionId);
      setJoinCodeInput(joined.sessionId);
      setPlayerId(joined.playerId);
    });
  }, [joinCodeInput, playerName, runAction]);

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

    runAction(() => startGameSession(sessionId));
  }, [runAction, sessionId]);

  const handleSelectAnswer = useCallback(
    (answerIndex: number) => {
      if (!sessionId || !self || !currentQuestion || session?.currentSelection) {
        return;
      }

      if (!isActiveTurn) {
        Alert.alert("Trivia Blitz", "It is another player's turn.");
        return;
      }

      runAction(async () => {
        await submitSessionSelection(sessionId, self.id, answerIndex);
        const result = await scoreSessionAnswer(sessionId, answerIndex, secondsRemaining);
        setLastResult(result);
        setTimeout(() => {
          advanceTurn(sessionId).catch((error) => {
            Alert.alert("Trivia Blitz", getFirebaseErrorMessage(error));
          });
        }, 1400);
      });
    },
    [currentQuestion, isActiveTurn, runAction, secondsRemaining, self, session?.currentSelection, sessionId],
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

        {!sessionId || !session ? (
          <View style={styles.panel}>
            <Text style={styles.sectionTitle}>Start or Join</Text>
            <TextInput
              style={styles.input}
              value={playerName}
              onChangeText={setPlayerName}
              placeholder="Your name"
              placeholderTextColor={Colors.textPrimary}
            />
            <Pressable style={styles.primaryButton} onPress={handleCreate} disabled={busy}>
              <Text style={styles.primaryButtonText}>Create Session</Text>
            </Pressable>
            <TextInput
              style={styles.input}
              value={joinCodeInput}
              onChangeText={setJoinCodeInput}
              autoCapitalize="characters"
              placeholder="Session code"
              placeholderTextColor={Colors.textPrimary}
            />
            <Pressable style={styles.secondaryButton} onPress={handleJoin} disabled={busy}>
              <Text style={styles.secondaryButtonText}>Join Session</Text>
            </Pressable>
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
            <View style={styles.actionsRow}>
              <Pressable style={styles.secondaryButton} onPress={handleToggleReady} disabled={busy || !self}>
                <Text style={styles.secondaryButtonText}>{self?.ready ? "Unready" : "Ready"}</Text>
              </Pressable>
              {isHost ? (
                <Pressable style={styles.primaryButton} onPress={handleStart} disabled={busy}>
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
            <Text style={styles.metaText}>Turn: {activePlayer?.name ?? "Player"}</Text>
            <Text style={styles.timer}>{secondsRemaining}s</Text>
            <Text style={styles.category}>{currentQuestion.category}</Text>
            <Text style={styles.question}>{currentQuestion.question_en}</Text>
            {currentQuestion.options_en.map((option, index) => {
              const selected = session.currentSelection?.answerIndex === index;
              const correct = lastResult?.correctAnswerIndex === index;

              return (
                <Pressable
                  key={option}
                  style={[
                    styles.answerButton,
                    selected && styles.selectedAnswer,
                    lastResult && correct && styles.correctAnswer,
                  ]}
                  onPress={() => handleSelectAnswer(index)}
                  disabled={busy || Boolean(lastResult)}
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
            {isHost ? (
              <Pressable style={styles.primaryButton} onPress={handleReset} disabled={busy}>
                <Text style={styles.primaryButtonText}>Reset to Lobby</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function normalizeParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
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
  input: {
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: 8,
    borderWidth: 1,
    color: Colors.textHeading,
    fontFamily: Typography.bodyRegular,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
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

