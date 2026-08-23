import React, { createContext, useCallback, useContext, useEffect, useRef } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  type ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { resolveKeyboardRevealOffset } from "@/utils/coachAiExperienceCore";

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  keepEndVisibleOnKeyboard?: boolean;
};

const KeyboardAwareInputRevealContext = createContext<(input: TextInput | null) => void>(() => undefined);

export function useKeyboardAwareInputReveal() {
  return useContext(KeyboardAwareInputRevealContext);
}

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
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const keyboardVisibleRef = useRef(false);
  const pendingRevealFrameRef = useRef<number | null>(null);
  const pendingRevealTargetRef = useRef<TextInput | null>(null);
  const revealOffset = resolveKeyboardRevealOffset(Platform.OS, insets.bottom);

  const revealFocusedInput = useCallback((input?: TextInput | null) => {
    if (keepEndVisibleOnKeyboard) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
      return;
    }
    const focusedInput = input ?? TextInput.State.currentlyFocusedInput();
    if (!focusedInput) return;
    pendingRevealTargetRef.current = focusedInput as TextInput;
    if (pendingRevealFrameRef.current !== null) return;
    pendingRevealFrameRef.current = requestAnimationFrame(() => {
      pendingRevealFrameRef.current = null;
      const revealTarget = pendingRevealTargetRef.current ?? TextInput.State.currentlyFocusedInput();
      pendingRevealTargetRef.current = null;
      if (!revealTarget) return;
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        revealTarget,
        revealOffset,
        true,
      );
    });
  }, [keepEndVisibleOnKeyboard, revealOffset]);

  const requestInputReveal = useCallback((input: TextInput | null) => {
    if (keyboardVisibleRef.current) revealFocusedInput(input);
  }, [revealFocusedInput]);

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
      if (pendingRevealFrameRef.current !== null) cancelAnimationFrame(pendingRevealFrameRef.current);
    };
  }, [revealFocusedInput]);

  return (
    <KeyboardAwareInputRevealContext.Provider value={requestInputReveal}>
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
    </KeyboardAwareInputRevealContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
