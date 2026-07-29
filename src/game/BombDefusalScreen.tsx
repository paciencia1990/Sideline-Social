import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import LottieView from "lottie-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { GameEndActions } from "@/components/GameEndActions";
import { GameRewardSummary } from "@/components/GameRewardSummary";
import { useSquad } from "@/context/SquadContext";
import {
  createGameRewardSession,
  finalizeGameReward,
  recordGameSessionResult,
  type GameRewardResult,
} from "@/services/sidelineStarsService";
import {
  createGameJoinIdempotencyKey,
  submitBombDefusalStep,
  updateGameJoinCodeStatus,
} from "@/services/gameJoinCodeService";
import { subscribeToSession } from "@/services/gameService";
import {
  generateBombPattern,
  STEP_TYPES,
  validateStep,
  type BombStep,
} from "./bombLogic";

const WIRE_COLORS = ["red", "blue", "yellow", "green"] as const;
const BUTTON_LABELS = ["A", "B", "C", "D"] as const;
const STARTING_TIME = 60;
type BombMessageKey =
  | "bomb.followSequence"
  | "bomb.timeRanOut"
  | "bomb.wrongMove"
  | "bomb.defused"
  | "bomb.correctKeepGoing"
  | "bomb.actionFailed";

const wireCutAnimation = require("../../assets/animations/wireCut.json");
const explosionAnimation = require("../../assets/animations/explosion.json");

export default function BombDefusalScreen() {
  const { t } = useTranslation();
  const { currentSquad } = useSquad();
  const params = useLocalSearchParams<{ sessionId?: string | string[] }>();
  const requestedSessionId = normalizeRouteParam(params.sessionId);
  const [attemptNumber, setAttemptNumber] = useState(0);
  const [steps, setSteps] = useState<BombStep[]>(() => generateBombPattern());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(STARTING_TIME);
  const [codeInput, setCodeInput] = useState("");
  const [dialValue, setDialValue] = useState(1);
  const [status, setStatus] = useState<"playing" | "defused" | "exploded">("playing");
  const [messageKey, setMessageKey] = useState<BombMessageKey>("bomb.followSequence");
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [showWireCut, setShowWireCut] = useState(false);
  const [rewardSessionId, setRewardSessionId] = useState("");
  const [rewardSetupAttempt, setRewardSetupAttempt] = useState(0);
  const [rewardResult, setRewardResult] = useState<GameRewardResult | null>(null);
  const [rewardLoading, setRewardLoading] = useState(false);
  const [rewardError, setRewardError] = useState<string | null>(null);
  const finalizedRewardKeyRef = useRef("");
  const lifecycleEndedRef = useRef("");
  const submissionIdsRef = useRef(new Map<string, string>());
  const dialRotation = useRef(new Animated.Value(0)).current;
  const currentStep = steps[currentStepIndex];

  useEffect(() => {
    if (!requestedSessionId) return;
    return subscribeToSession(requestedSessionId, (session) => {
      if (!session) return;
      const sharedStepIndex = session.gameState?.currentStepIndex;
      const sharedStep = session.gameState?.currentStep;
      if (
        typeof sharedStepIndex === "number" &&
        Number.isInteger(sharedStepIndex) &&
        sharedStepIndex >= 0 &&
        sharedStepIndex <= 5
      ) {
        if (sharedStepIndex < 5 && isBombStep(sharedStep)) {
          setSteps((current) => current.map((step, index) => (
            index === sharedStepIndex ? sharedStep : step
          )));
        }
        setCurrentStepIndex(sharedStepIndex);
        setCodeInput("");
      }
      const sharedOutcome = session.gameState?.outcome;
      if (sharedOutcome === "defused") {
        setStatus("defused");
        setMessageKey("bomb.defused");
      } else if (sharedOutcome === "exploded") {
        setStatus("exploded");
        setMessageKey("bomb.wrongMove");
      }
      if (typeof session.startedAt === "number") {
        const remaining = Math.max(0, STARTING_TIME - Math.floor((Date.now() - session.startedAt) / 1000));
        setTimeLeft((current) => Math.min(current, remaining));
      }
    });
  }, [requestedSessionId]);

  useEffect(() => {
    let active = true;
    setRewardSessionId("");
    setRewardResult(null);
    setRewardError(null);
    finalizedRewardKeyRef.current = "";
    if (!requestedSessionId) {
      return () => { active = false; };
    }
    void createGameRewardSession({
      gameType: "bombDefusal",
      sessionId: requestedSessionId,
      sourceSquadId: currentSquad?.squadId ?? null,
    }).then((created) => {
      if (active) setRewardSessionId(created.sessionId);
    }).catch(() => {
      if (active) setRewardError(t("rewards.awardError"));
    });
    return () => { active = false; };
  }, [attemptNumber, currentSquad?.squadId, requestedSessionId, rewardSetupAttempt, t]);


  const finishGame = useCallback(
    (nextStatus: "defused" | "exploded", nextMessageKey: BombMessageKey) => {
      setStatus(nextStatus);
      setMessageKey(nextMessageKey);
    },
    [],
  );

  useEffect(() => {
    if (status !== "playing") {
      return;
    }

    if (timeLeft <= 0) {
      finishGame("exploded", "bomb.timeRanOut");
      return;
    }

    const timer = setTimeout(() => setTimeLeft((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [finishGame, status, timeLeft]);

  useEffect(() => {
    Animated.timing(dialRotation, {
      toValue: dialValue,
      duration: 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [dialRotation, dialValue]);

  const resetGame = () => {
    setAttemptNumber((value) => value + 1);
    setSteps(generateBombPattern());
    setCurrentStepIndex(0);
    setTimeLeft(STARTING_TIME);
    setCodeInput("");
    setDialValue(1);
    setStatus("playing");
    setMessageKey("bomb.followSequence");
    setShowWireCut(false);
    setActionSubmitting(false);
    submissionIdsRef.current.clear();
  };

  const awardCurrentResult = useCallback(async () => {
    if (!rewardSessionId || status === "playing") return;
    const rewardKey = `${rewardSessionId}:${status}`;
    if (finalizedRewardKeyRef.current === rewardKey && rewardResult) return;
    finalizedRewardKeyRef.current = rewardKey;
    setRewardLoading(true);
    setRewardError(null);
    try {
      await recordGameSessionResult({
        gameType: "bombDefusal",
        sessionId: rewardSessionId,
        outcome: status,
        firstAttemptCorrectStepCount: status === "defused" ? steps.length : currentStepIndex,
        totalSteps: steps.length,
      });
      setRewardResult(await finalizeGameReward("bombDefusal", rewardSessionId));
    } catch {
      finalizedRewardKeyRef.current = "";
      setRewardError(t("rewards.awardError"));
    } finally {
      setRewardLoading(false);
    }
  }, [currentStepIndex, rewardResult, rewardSessionId, status, steps.length, t]);

  useEffect(() => {
    if (rewardSessionId && status !== "playing") void awardCurrentResult();
  }, [awardCurrentResult, rewardSessionId, status]);

  useEffect(() => {
    if (!requestedSessionId || status === "playing" || lifecycleEndedRef.current === requestedSessionId) return;
    lifecycleEndedRef.current = requestedSessionId;
    void updateGameJoinCodeStatus({
      gameType: "bombDefusal",
      sessionId: requestedSessionId,
      status: "ended",
    }).catch(() => undefined);
  }, [requestedSessionId, status]);

  const handlePlayAgain = useCallback(() => {
    if (requestedSessionId) {
      router.replace({ pathname: "/(games)/bomb-defusal/Lobby", params: { host: "1" } } as never);
      return;
    }
    resetGame();
  }, [requestedSessionId]);

  const submitStep = async (input: Record<string, string | number>) => {
    if (!currentStep || status !== "playing") {
      return;
    }

    if (actionSubmitting) return;
    let correct: boolean;
    let nextIndex = currentStepIndex + 1;
    let serverOutcome: "playing" | "defused" | "exploded" | null = null;

    if (requestedSessionId) {
      const submissionKey = `${currentStepIndex}:${JSON.stringify(input)}`;
      const existingSubmissionId = submissionIdsRef.current.get(submissionKey);
      const submissionId = existingSubmissionId ?? createGameJoinIdempotencyKey();
      submissionIdsRef.current.set(submissionKey, submissionId);
      setActionSubmitting(true);
      try {
        const result = await submitBombDefusalStep({
          sessionId: requestedSessionId,
          stepIndex: currentStepIndex,
          action: input,
          submissionId,
        });
        correct = result.correct;
        nextIndex = result.nextStepIndex;
        serverOutcome = result.outcome;
        if (result.nextStep && isBombStep(result.nextStep) && nextIndex < steps.length) {
          setSteps((current) => current.map((step, index) => (
            index === nextIndex ? result.nextStep as BombStep : step
          )));
        }
        submissionIdsRef.current.delete(submissionKey);
      } catch {
        setMessageKey("bomb.actionFailed");
        setActionSubmitting(false);
        return;
      }
      setActionSubmitting(false);
    } else {
      correct = validateStep(currentStep, input, rewardSessionId).correct;
    }

    if (!correct) {
      finishGame("exploded", "bomb.wrongMove");
      return;
    }

    if (currentStep.type === STEP_TYPES.CUT_WIRE) {
      setShowWireCut(true);
      setTimeout(() => setShowWireCut(false), 1200);
    }

    if (serverOutcome === "defused" || nextIndex >= steps.length) {
      finishGame("defused", "bomb.defused");
      return;
    }

    setCurrentStepIndex(nextIndex);
    setCodeInput("");
    setMessageKey("bomb.correctKeepGoing");
  };

  const rotateDial = (direction: -1 | 1) => {
    setDialValue((value) => {
      const nextValue = value + direction;
      if (nextValue < 1) {
        return 10;
      }
      if (nextValue > 10) {
        return 1;
      }
      return nextValue;
    });
  };

  const submitCodeDigit = (digit: string) => {
    setCodeInput((value) => (value.length >= 3 ? value : `${value}${digit}`));
  };

  const renderControls = () => {
    if (!currentStep || status !== "playing") {
      return null;
    }

    switch (currentStep.type) {
      case STEP_TYPES.CUT_WIRE:
        return (
          <View style={styles.controlGrid}>
            {WIRE_COLORS.map((color) => (
              <Pressable
                accessibilityLabel={t("bomb.accessibility.cutWire", {
                  color: t(`bomb.colors.${color}`),
                })}
                accessibilityRole="button"
                key={color}
                style={[styles.wireButton, wireStyles[color]]}
                onPress={() => void submitStep({ color })}
                disabled={actionSubmitting}
              >
                <Text style={styles.wireLabel}>
                  {t(`bomb.colors.${color}`).toLocaleUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        );
      case STEP_TYPES.PRESS_BUTTON:
        return (
          <View style={styles.controlGrid}>
            {BUTTON_LABELS.map((label) => (
              <Pressable
                accessibilityLabel={t("bomb.accessibility.pressButton", { label })}
                accessibilityRole="button"
                key={label}
                style={styles.letterButton}
                onPress={() => void submitStep({ label })}
                disabled={actionSubmitting}
              >
                <Text style={styles.letterText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        );
      case STEP_TYPES.ROTATE_DIAL:
        return (
          <View style={styles.dialPanel}>
            <Animated.View
              style={[
                styles.dial,
                {
                  transform: [
                    {
                      rotate: dialRotation.interpolate({
                        inputRange: [1, 10],
                        outputRange: ["0deg", "324deg"],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles.dialPointer} />
              <Text style={styles.dialValue}>{dialValue}</Text>
            </Animated.View>
            <View style={styles.dialActions}>
              <Pressable
                accessibilityLabel={t("bomb.accessibility.decreaseDial")}
                accessibilityRole="button"
                style={styles.panelButton}
                onPress={() => rotateDial(-1)}
              >
                <Text style={styles.panelButtonText}>-</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t("bomb.accessibility.setDial", { value: dialValue })}
                accessibilityRole="button"
                style={styles.submitButton}
                onPress={() => void submitStep({ target: dialValue })}
                disabled={actionSubmitting}
              >
                <Text style={styles.submitButtonText}>{t("bomb.controls.set")}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t("bomb.accessibility.increaseDial")}
                accessibilityRole="button"
                style={styles.panelButton}
                onPress={() => rotateDial(1)}
              >
                <Text style={styles.panelButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
        );
      case STEP_TYPES.ENTER_CODE:
        return (
          <View style={styles.keypadPanel}>
            <Text style={styles.codeReadout}>{codeInput.padEnd(3, "_")}</Text>
            <View style={styles.keypad}>
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"].map((digit) => (
                <Pressable
                  accessibilityLabel={t("bomb.accessibility.digit", { digit })}
                  accessibilityRole="button"
                  key={digit}
                  style={styles.key}
                  onPress={() => submitCodeDigit(digit)}
                >
                  <Text style={styles.keyText}>{digit}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.dialActions}>
              <Pressable
                accessibilityLabel={t("bomb.accessibility.clearCode")}
                accessibilityRole="button"
                style={styles.panelButton}
                onPress={() => setCodeInput("")}
              >
                <Text style={styles.panelButtonText}>{t("bomb.controls.clear")}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={t("bomb.accessibility.enterCode")}
                accessibilityRole="button"
                style={styles.submitButton}
                onPress={() => void submitStep({ code: Number(codeInput) })}
                disabled={codeInput.length !== 3 || actionSubmitting}
              >
                <Text style={styles.submitButtonText}>{t("bomb.controls.enter")}</Text>
              </Pressable>
            </View>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("games.bombDefusal.title")}</Text>
          <Text
            accessibilityLabel={t("bomb.secondsRemaining", { count: timeLeft })}
            accessibilityLiveRegion="polite"
            style={[styles.timer, timeLeft <= 10 && styles.dangerTimer]}
          >
            {t("bomb.secondsShort", { count: timeLeft })}
          </Text>
        </View>

        <View style={styles.bombBody}>
          <View style={styles.statusLight} />
          <Text style={styles.stepCounter}>
            {t("bomb.stepProgress", {
              current: Math.min(currentStepIndex + 1, steps.length),
              total: steps.length,
            })}
          </Text>
          <Text style={styles.instruction}>{getInstruction(currentStep, t)}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.message}>
            {t(messageKey)}
          </Text>
        </View>

        {showWireCut && (
          <LottieView source={wireCutAnimation} autoPlay loop={false} style={styles.animation} />
        )}

        {status === "exploded" && (
          <LottieView source={explosionAnimation} autoPlay loop={false} style={styles.animation} />
        )}

        {status === "defused" ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("rewards.bombDefused")}</Text>
            <Text style={styles.resultText}>{t("rewards.bombDefused")}</Text>
            <GameRewardSummary
              detailLines={[
                t("rewards.bombDefused"),
                t("rewards.accuracyBonus", { count: Math.min(steps.length, 5) }),
              ]}
              error={rewardError}
              loading={rewardLoading}
              onRetry={() => rewardSessionId ? void awardCurrentResult() : setRewardSetupAttempt((value) => value + 1)}
              result={rewardResult}
            />
            <GameEndActions onPlayAgain={handlePlayAgain} lobbyRoute="/(games)/bomb-defusal/Lobby" />
          </View>
        ) : status === "exploded" ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>{t("rewards.attemptCompleted")}</Text>
            <Text style={styles.resultText}>{t("rewards.attemptCompleted")}</Text>
            <GameRewardSummary
              detailLines={[
                t("rewards.attemptCompleted"),
                t("rewards.accuracyBonus", { count: Math.min(currentStepIndex, 5) }),
              ]}
              error={rewardError}
              loading={rewardLoading}
              onRetry={() => rewardSessionId ? void awardCurrentResult() : setRewardSetupAttempt((value) => value + 1)}
              result={rewardResult}
            />
            <GameEndActions onPlayAgain={handlePlayAgain} lobbyRoute="/(games)/bomb-defusal/Lobby" />
          </View>
        ) : (
          renderControls()
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function normalizeRouteParam(value?: string | string[]) {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() ?? "";
}

function isBombStep(value: unknown): value is BombStep {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const step = value as Record<string, unknown>;
  if (step.type === STEP_TYPES.CUT_WIRE) {
    return typeof step.color === "string" &&
      WIRE_COLORS.includes(step.color as typeof WIRE_COLORS[number]);
  }
  if (step.type === STEP_TYPES.PRESS_BUTTON) {
    return typeof step.label === "string" &&
      BUTTON_LABELS.includes(step.label as typeof BUTTON_LABELS[number]);
  }
  if (step.type === STEP_TYPES.ROTATE_DIAL) {
    return Number.isInteger(step.target) && Number(step.target) >= 1 && Number(step.target) <= 10;
  }
  if (step.type === STEP_TYPES.ENTER_CODE) {
    return Number.isInteger(step.code) && Number(step.code) >= 100 && Number(step.code) <= 999;
  }
  return false;
}

function getInstruction(step: BombStep | undefined, t: TFunction) {
  if (!step) {
    return t("bomb.instructions.complete");
  }

  switch (step.type) {
    case STEP_TYPES.CUT_WIRE:
      return t("bomb.instructions.cutWire", {
        color: t(`bomb.colors.${step.color}`),
      });
    case STEP_TYPES.PRESS_BUTTON:
      return t("bomb.instructions.pressButton", { label: step.label });
    case STEP_TYPES.ROTATE_DIAL:
      return t("bomb.instructions.rotateDial", { target: step.target });
    case STEP_TYPES.ENTER_CODE:
      return t("bomb.instructions.enterCode", { code: step.code });
  }
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111827",
  },
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 18,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "800",
  },
  timer: {
    color: "#22c55e",
    fontSize: 26,
    fontWeight: "900",
  },
  dangerTimer: {
    color: "#ef4444",
  },
  bombBody: {
    backgroundColor: "#1f2937",
    borderColor: "#374151",
    borderRadius: 8,
    borderWidth: 1,
    padding: 20,
  },
  statusLight: {
    alignSelf: "flex-end",
    backgroundColor: "#facc15",
    borderRadius: 8,
    height: 16,
    width: 16,
  },
  stepCounter: {
    color: "#9ca3af",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  instruction: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 8,
  },
  message: {
    color: "#d1d5db",
    fontSize: 16,
  },
  controlGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "center",
  },
  wireButton: {
    alignItems: "center",
    borderRadius: 8,
    height: 76,
    justifyContent: "center",
    width: "47%",
  },
  redWire: {
    backgroundColor: "#dc2626",
  },
  blueWire: {
    backgroundColor: "#2563eb",
  },
  yellowWire: {
    backgroundColor: "#ca8a04",
  },
  greenWire: {
    backgroundColor: "#16a34a",
  },
  wireLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  letterButton: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderColor: "#64748b",
    borderRadius: 8,
    borderWidth: 1,
    height: 80,
    justifyContent: "center",
    width: "47%",
  },
  letterText: {
    color: "#f8fafc",
    fontSize: 28,
    fontWeight: "900",
  },
  dialPanel: {
    alignItems: "center",
    gap: 18,
  },
  dial: {
    alignItems: "center",
    backgroundColor: "#0f172a",
    borderColor: "#94a3b8",
    borderRadius: 80,
    borderWidth: 3,
    height: 160,
    justifyContent: "center",
    width: 160,
  },
  dialPointer: {
    backgroundColor: "#ef4444",
    borderRadius: 3,
    height: 52,
    position: "absolute",
    top: 12,
    width: 6,
  },
  dialValue: {
    color: "#f8fafc",
    fontSize: 36,
    fontWeight: "900",
  },
  dialActions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "center",
  },
  panelButton: {
    alignItems: "center",
    backgroundColor: "#334155",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 76,
    paddingHorizontal: 16,
  },
  panelButtonText: {
    color: "#f8fafc",
    fontSize: 18,
    fontWeight: "900",
  },
  submitButton: {
    alignItems: "center",
    backgroundColor: "#22c55e",
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 52,
    minWidth: 110,
    paddingHorizontal: 18,
  },
  submitButtonText: {
    color: "#052e16",
    fontSize: 16,
    fontWeight: "900",
  },
  keypadPanel: {
    alignItems: "center",
    gap: 16,
  },
  codeReadout: {
    backgroundColor: "#020617",
    borderColor: "#475569",
    borderRadius: 8,
    borderWidth: 1,
    color: "#22c55e",
    fontSize: 34,
    fontWeight: "900",
    letterSpacing: 0,
    minWidth: 160,
    padding: 12,
    textAlign: "center",
  },
  keypad: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    maxWidth: 260,
  },
  key: {
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 8,
    height: 58,
    justifyContent: "center",
    width: 74,
  },
  keyText: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "900",
  },
  animation: {
    alignSelf: "center",
    height: 180,
    width: 180,
  },
  resultPanel: {
    alignItems: "center",
    backgroundColor: "#1f2937",
    borderRadius: 8,
    gap: 12,
    padding: 20,
  },
  resultTitle: {
    color: "#f8fafc",
    fontSize: 26,
    fontWeight: "900",
  },
  resultText: {
    color: "#d1d5db",
    fontSize: 16,
    textAlign: "center",
  },
});

const wireStyles = {
  red: styles.redWire,
  blue: styles.blueWire,
  yellow: styles.yellowWire,
  green: styles.greenWire,
};
