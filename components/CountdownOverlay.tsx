import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useTranslation } from "react-i18next";

import { Colors, Typography } from "@/constants/theme";

type CountdownOverlayProps = {
  phase?: "3" | "2" | "1" | "go";
  onComplete?: () => void;
  onCancel?: () => void;
};

function CountdownOverlay({ phase, onComplete, onCancel }: CountdownOverlayProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [count, setCount] = useState(3);
  const completedRef = useRef(false);
  const scale = useRef(new Animated.Value(1.5)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase) return;
    const timer = setInterval(() => {
      setCount((previousCount) => {
        if (previousCount <= 1) {
          clearInterval(timer);
          return 0;
        }

        return previousCount - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase || !onComplete || count > 0 || completedRef.current) {
      return;
    }

    completedRef.current = true;
    const timeout = setTimeout(onComplete, 800);

    return () => clearTimeout(timeout);
  }, [count, onComplete, phase]);

  const displayedValue = phase ?? (count <= 0 ? "go" : count.toString());

  useEffect(() => {
    scale.setValue(1.5);
    opacity.setValue(0);

    if (displayedValue === "go") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }

    Animated.parallel([
      Animated.timing(scale, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.delay(400),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [displayedValue, opacity, scale]);

  return (
    <View style={styles.overlay} pointerEvents="auto">
      {onCancel && (
        <Pressable
          accessibilityRole="button"
          style={[styles.cancelButton, { top: insets.top + 16 }]}
          onPress={onCancel}
        >
          <Text style={styles.cancelText}>{t("common.cancel")}</Text>
        </Pressable>
      )}
      <Animated.Text
        accessibilityLabel={displayedValue === "go" ? t("games.countdown.go") : displayedValue}
        accessibilityLiveRegion="assertive"
        style={[styles.countdownText, { opacity, transform: [{ scale }] }]}
      >
        {displayedValue === "go" ? t("games.countdown.go") : displayedValue}
      </Animated.Text>
    </View>
  );
}

export default CountdownOverlay;
export { CountdownOverlay };
export type { CountdownOverlayProps };

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.textHeading,
    zIndex: 9999,
    elevation: 9999,
  },
  cancelButton: {
    position: "absolute",
    right: 16,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 14,
  },
  countdownText: {
    color: Colors.primary,
    fontFamily: Typography.heading,
    fontSize: 120,
    textAlign: "center",
  },
});
