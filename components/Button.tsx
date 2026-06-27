import React from "react";
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  TouchableOpacity,
  ViewStyle,
} from "react-native";

import { Colors, Radius, Typography } from "@/constants/theme";
import { flattenStyle } from "@/utils/flatten-style";

type ButtonVariant = "primary" | "outline" | "ghost";

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  style,
  textStyle,
  accessibilityLabel,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const indicatorColor = variant === "primary" ? Colors.surface : Colors.primary;
  const labelStyle = variant === "primary"
    ? styles.primaryLabel
    : variant === "outline"
      ? styles.outlineLabel
      : styles.ghostLabel;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      activeOpacity={0.82}
      disabled={isDisabled}
      onPress={onPress}
      style={flattenStyle([
        styles.base,
        styles[variant],
        isDisabled && styles.disabled,
        style,
      ])}
    >
      {loading ? (
        <ActivityIndicator color={indicatorColor} />
      ) : (
        <Text style={flattenStyle([styles.label, labelStyle, textStyle])}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export default Button;

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: Radius.button,
    paddingHorizontal: 18,
  },
  primary: {
    backgroundColor: Colors.primary,
  },
  outline: {
    backgroundColor: "transparent",
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  ghost: {
    backgroundColor: "transparent",
  },
  disabled: {
    opacity: 0.6,
  },
  label: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    textAlign: "center",
  },
  primaryLabel: {
    color: Colors.surface,
  },
  outlineLabel: {
    color: Colors.primary,
  },
  ghostLabel: {
    color: Colors.primary,
  },
});