import React, { useCallback, useEffect, useRef } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  type ScrollViewProps,
} from "react-native";

import { Spacing } from "@/constants/theme";

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  keepEndVisibleOnKeyboard?: boolean;
};

export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  keepEndVisibleOnKeyboard = false,
  keyboardDismissMode = Platform.OS === "ios" ? "interactive" : "on-drag",
  keyboardShouldPersistTaps = "handled",
  onContentSizeChange,
  onFocus,
  showsVerticalScrollIndicator = false,
  style,
  ...scrollViewProps
}: KeyboardAwareScrollViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const keyboardVisibleRef = useRef(false);

  const revealFocusedInput = useCallback(() => {
    if (keepEndVisibleOnKeyboard) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      return;
    }
    const focusedInput = TextInput.State.currentlyFocusedInput();
    if (!focusedInput) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        focusedInput,
        Spacing.md,
        true,
      );
    });
  }, [keepEndVisibleOnKeyboard]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => {
      keyboardVisibleRef.current = true;
      revealFocusedInput();
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [revealFocusedInput]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.fill}
    >
      <ScrollView
        {...scrollViewProps}
        ref={scrollRef}
        contentContainerStyle={contentContainerStyle}
        keyboardDismissMode={keyboardDismissMode}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        onContentSizeChange={(width, height) => {
          onContentSizeChange?.(width, height);
          if (keyboardVisibleRef.current) revealFocusedInput();
        }}
        onFocus={(event) => {
          onFocus?.(event);
          revealFocusedInput();
        }}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        style={[styles.fill, style]}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
