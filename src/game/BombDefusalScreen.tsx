import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ref, set } from "firebase/database";
import { rtdb } from "@/config/firebase";
import {
  generateBombPattern,
  STEP_TYPES,
  validateStep,
  type BombStep,
} from "./bombLogic";

const WIRE_COLORS = ["red", "blue", "yellow", "green"] as const;
const BUTTON_LABELS = ["A", "B", "C", "D"] as const;
const STARTING_TIME = 60;

const wireCutAnimation = require("../../assets/animations/wireCut.json");
const explosionAnimation = require("../../assets/animations/explosion.json");

export default function BombDefusalScreen() {
  const gameId = useMemo(() => `game-${Date.now()}`, []);
  const [steps, setSteps] = useState<BombStep[]>(() => generateBombPattern());
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(STARTING_TIME);
  const [codeInput, setCodeInput] = useState("");
  const [dialValue, setDialValue] = useState(1);
  const [status, setStatus] = useState<"playing" | "defused" | "exploded">("playing");
  const [message, setMessage] = useState("Follow the sequence before time runs out.");
  const [showWireCut, setShowWireCut] = useState(false);
  const dialRotation = useRef(new Animated.Value(0)).current;
  const currentStep = steps[currentStepIndex];

  useEffect(() => {
    set(ref(rtdb, `bombDefusal/${gameId}/result`), {
      status: "started",
      startedAt: Date.now(),
      pattern: steps,
    });
  }, [gameId, steps]);

  const finishGame = useCallback(
    (nextStatus: "defused" | "exploded", nextMessage: string) => {
      setStatus(nextStatus);
      setMessage(nextMessage);
      set(ref(rtdb, `bombDefusal/${gameId}/result`), {
        status: nextStatus,
        completedAt: Date.now(),
        timeLeft,
        stepsCompleted: currentStepIndex,
        totalSteps: steps.length,
      });
    },
    [currentStepIndex, gameId, steps.length, timeLeft],
  );

  useEffect(() => {
    if (status !== "playing") {
      return;
    }

    if (timeLeft <= 0) {
      finishGame("exploded", "Time ran out.");
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
    setSteps(generateBombPattern());
    setCurrentStepIndex(0);
    setTimeLeft(STARTING_TIME);
    setCodeInput("");
    setDialValue(1);
    setStatus("playing");
    setMessage("Follow the sequence before time runs out.");
    setShowWireCut(false);
  };

  const submitStep = (input: Record<string, string | number>) => {
    if (!currentStep || status !== "playing") {
      return;
    }

    const { correct } = validateStep(currentStep, input, gameId);

    if (!correct) {
      finishGame("exploded", "Wrong move. The bomb exploded.");
      return;
    }

    if (currentStep.type === STEP_TYPES.CUT_WIRE) {
      setShowWireCut(true);
      setTimeout(() => setShowWireCut(false), 1200);
    }

    const nextIndex = currentStepIndex + 1;
    if (nextIndex >= steps.length) {
      finishGame("defused", "Bomb defused. Great work.");
      return;
    }

    setCurrentStepIndex(nextIndex);
    setCodeInput("");
    setMessage("Correct. Keep going.");
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
                key={color}
                style={[styles.wireButton, wireStyles[color]]}
                onPress={() => submitStep({ color })}
              >
                <Text style={styles.wireLabel}>{color.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        );
      case STEP_TYPES.PRESS_BUTTON:
        return (
          <View style={styles.controlGrid}>
            {BUTTON_LABELS.map((label) => (
              <Pressable key={label} style={styles.letterButton} onPress={() => submitStep({ label })}>
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
              <Pressable style={styles.panelButton} onPress={() => rotateDial(-1)}>
                <Text style={styles.panelButtonText}>-</Text>
              </Pressable>
              <Pressable style={styles.submitButton} onPress={() => submitStep({ target: dialValue })}>
                <Text style={styles.submitButtonText}>SET</Text>
              </Pressable>
              <Pressable style={styles.panelButton} onPress={() => rotateDial(1)}>
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
                <Pressable key={digit} style={styles.key} onPress={() => submitCodeDigit(digit)}>
                  <Text style={styles.keyText}>{digit}</Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.dialActions}>
              <Pressable style={styles.panelButton} onPress={() => setCodeInput("")}>
                <Text style={styles.panelButtonText}>CLR</Text>
              </Pressable>
              <Pressable
                style={styles.submitButton}
                onPress={() => submitStep({ code: Number(codeInput) })}
                disabled={codeInput.length !== 3}
              >
                <Text style={styles.submitButtonText}>ENTER</Text>
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
          <Text style={styles.title}>Bomb Defusal</Text>
          <Text style={[styles.timer, timeLeft <= 10 && styles.dangerTimer]}>{timeLeft}s</Text>
        </View>

        <View style={styles.bombBody}>
          <View style={styles.statusLight} />
          <Text style={styles.stepCounter}>
            Step {Math.min(currentStepIndex + 1, steps.length)} of {steps.length}
          </Text>
          <Text style={styles.instruction}>{getInstruction(currentStep)}</Text>
          <Text style={styles.message}>{message}</Text>
        </View>

        {showWireCut && (
          <LottieView source={wireCutAnimation} autoPlay loop={false} style={styles.animation} />
        )}

        {status === "exploded" && (
          <LottieView source={explosionAnimation} autoPlay loop={false} style={styles.animation} />
        )}

        {status === "defused" ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>Defused</Text>
            <Text style={styles.resultText}>The result was saved to Realtime Database.</Text>
            <Pressable style={styles.submitButton} onPress={resetGame}>
              <Text style={styles.submitButtonText}>PLAY AGAIN</Text>
            </Pressable>
          </View>
        ) : status === "exploded" ? (
          <View style={styles.resultPanel}>
            <Text style={styles.resultTitle}>Exploded</Text>
            <Text style={styles.resultText}>The result was saved to Realtime Database.</Text>
            <Pressable style={styles.submitButton} onPress={resetGame}>
              <Text style={styles.submitButtonText}>TRY AGAIN</Text>
            </Pressable>
          </View>
        ) : (
          renderControls()
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function getInstruction(step?: BombStep) {
  if (!step) {
    return "Sequence complete.";
  }

  switch (step.type) {
    case STEP_TYPES.CUT_WIRE:
      return "Cut the correct wire.";
    case STEP_TYPES.PRESS_BUTTON:
      return "Press the matching button.";
    case STEP_TYPES.ROTATE_DIAL:
      return "Rotate the dial to the target number.";
    case STEP_TYPES.ENTER_CODE:
      return "Enter the three-digit code.";
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

