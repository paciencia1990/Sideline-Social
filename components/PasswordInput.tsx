import React, { useCallback, useRef, useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { Eye, EyeOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Spacing, Typography } from "@/constants/theme";

type PasswordInputProps = Omit<TextInputProps, "secureTextEntry" | "style"> & {
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
};

export function PasswordInput({
  containerStyle,
  inputStyle,
  onSelectionChange,
  ...inputProps
}: PasswordInputProps) {
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const [passwordVisible, setPasswordVisible] = useState(false);

  const togglePasswordVisibility = useCallback(() => {
    setPasswordVisible((visible) => !visible);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setNativeProps({ selection: selectionRef.current });
    });
  }, []);

  const accessibilityLabel = passwordVisible
    ? t("auth.hidePassword")
    : t("auth.showPassword");

  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        {...inputProps}
        ref={inputRef}
        onSelectionChange={(event) => {
          selectionRef.current = event.nativeEvent.selection;
          onSelectionChange?.(event);
        }}
        secureTextEntry={!passwordVisible}
        style={[styles.input, inputStyle]}
      />
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        hitSlop={4}
        onPress={togglePasswordVisibility}
        style={styles.toggle}
      >
        {passwordVisible ? (
          <EyeOff aria-hidden color={Colors.textPrimary} size={22} />
        ) : (
          <Eye aria-hidden color={Colors.textPrimary} size={22} />
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    flexDirection: "row",
  },
  input: {
    color: Colors.textPrimary,
    flex: 1,
    fontFamily: Typography.bodyRegular,
    height: "100%",
    paddingLeft: Spacing.md,
    paddingRight: 52,
  },
  toggle: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 4,
    width: 44,
  },
});
