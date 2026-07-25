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

type Props = Pick<
  ScrollViewProps,
  "children" | "contentContainerStyle" | "showsVerticalScrollIndicator"
>;

const INPUT_KEYBOARD_GAP = 24;

export function MessageKeyboardAwareScrollView({
  children,
  contentContainerStyle,
  showsVerticalScrollIndicator = false,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const keyboardVisibleRef = useRef(false);

  const revealFocusedInput = useCallback(() => {
    const focusedInput = TextInput.State.currentlyFocusedInput();
    if (!focusedInput) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        focusedInput,
        INPUT_KEYBOARD_GAP,
        true,
      );
    });
  }, []);

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
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.fill}
    >
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={contentContainerStyle}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (keyboardVisibleRef.current) revealFocusedInput();
        }}
        onFocus={() => {
          if (keyboardVisibleRef.current) revealFocusedInput();
        }}
        showsVerticalScrollIndicator={showsVerticalScrollIndicator}
        style={styles.fill}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
