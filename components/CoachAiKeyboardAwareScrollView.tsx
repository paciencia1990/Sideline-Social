import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
  findNodeHandle,
  type ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT,
  resolveCoachAiFocusedInputScrollDelta,
  resolveCoachAiKeyboardViewportSupplement,
  resolveCoachAiVisibleKeyboardViewportBottom,
  resolveCoachAiMultilineInputHeight,
  resolveCoachAiKeyboardFrameSupplement,
  resolveKeyboardRevealOffset,
  resolveKeyboardResponderOffset,
} from "@/utils/coachAiExperienceCore";

type KeyboardAwareScrollViewProps = ScrollViewProps & {
  keepEndVisibleOnKeyboard?: boolean;
};

const KeyboardAwareInputRevealContext = createContext<(input: TextInput | null) => void>(() => undefined);
const CoachAiMultilineInputHeightContext = createContext(COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT);

export function useKeyboardAwareInputReveal() {
  return useContext(KeyboardAwareInputRevealContext);
}

export function useCoachAiMultilineInputHeight() {
  return useContext(CoachAiMultilineInputHeightContext);
}

export function KeyboardAwareScrollView({
  children,
  contentContainerStyle,
  keepEndVisibleOnKeyboard = false,
  keyboardDismissMode = Platform.OS === "ios" ? "interactive" : "on-drag",
  keyboardShouldPersistTaps = "handled",
  onContentSizeChange,
  onFocus,
  onScroll,
  scrollEventThrottle,
  showsVerticalScrollIndicator = false,
  style,
  ...scrollViewProps
}: KeyboardAwareScrollViewProps) {
  const insets = useSafeAreaInsets();
  const { fontScale, height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const keyboardVisibleRef = useRef(false);
  const shownKeyboardScreenYRef = useRef<number | null>(null);
  const pendingRevealFrameRef = useRef<number | null>(null);
  const pendingRevealTargetRef = useRef<TextInput | null>(null);
  const requestedInputRef = useRef<TextInput | null>(null);
  const scrollOffsetYRef = useRef(0);
  const revealOffset = resolveKeyboardRevealOffset(Platform.OS, insets.bottom);
  const responderRevealOffset = resolveKeyboardResponderOffset(revealOffset, insets.top);
  const [multilineInputHeight, setMultilineInputHeight] = useState(COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT);
  const [keyboardFrameSupplement, setKeyboardFrameSupplement] = useState(0);

  const updateMultilineInputHeight = useCallback((keyboardScreenY: number) => {
    const windowContentHeight = Math.max(0, windowHeight - insets.top);
    const keyboardViewportHeight = Math.min(
      windowContentHeight,
      Math.max(0, keyboardScreenY - insets.top),
    );
    setMultilineInputHeight(resolveCoachAiMultilineInputHeight(keyboardViewportHeight, revealOffset, fontScale));
  }, [fontScale, insets.top, revealOffset, windowHeight]);

  const revealFocusedInput = useCallback((input?: TextInput | null) => {
    if (keepEndVisibleOnKeyboard) {
      requestAnimationFrame(() => {
        if (keyboardVisibleRef.current) scrollRef.current?.scrollToEnd({ animated: true });
      });
      return;
    }
    const focusedInput = input ?? requestedInputRef.current ?? TextInput.State.currentlyFocusedInput();
    if (!focusedInput) return;
    pendingRevealTargetRef.current = focusedInput as TextInput;
    if (pendingRevealFrameRef.current !== null) return;
    const performReveal = () => {
      pendingRevealFrameRef.current = null;
      const revealTarget = pendingRevealTargetRef.current
        ?? requestedInputRef.current
        ?? TextInput.State.currentlyFocusedInput();
      pendingRevealTargetRef.current = null;
      const currentFocusedInput = TextInput.State.currentlyFocusedInput();
      const targetIsFocused = revealTarget === currentFocusedInput
        || (revealTarget as TextInput | null)?.isFocused?.() === true;
      if (!keyboardVisibleRef.current || !revealTarget || !targetIsFocused) return;
      if (Platform.OS === "android") {
        const keyboardScreenY = [
          Keyboard.metrics()?.screenY,
          shownKeyboardScreenYRef.current,
        ].reduce<number | null>((top, coordinate) => (
          typeof coordinate === "number" && Number.isFinite(coordinate) && coordinate > 0
            ? Math.min(top ?? coordinate, coordinate)
            : top
        ), null);
        if (keyboardScreenY === null || keyboardScreenY <= 0) return;
        const scrollNode = findNodeHandle(scrollRef.current);
        if (scrollNode === null) return;
        UIManager.measureInWindow(scrollNode, (_scrollX, scrollScreenY, _scrollWidth, scrollHeight) => {
          const visibleViewportBottom = resolveCoachAiVisibleKeyboardViewportBottom(
            keyboardScreenY,
            scrollScreenY,
            scrollHeight,
          );
          setKeyboardFrameSupplement(resolveCoachAiKeyboardViewportSupplement(
            scrollScreenY,
            scrollHeight,
            visibleViewportBottom,
          ));
          (revealTarget as TextInput).measureInWindow((_x, inputScreenY, _width, inputHeight) => {
            const targetStillFocused = revealTarget === TextInput.State.currentlyFocusedInput()
              || (revealTarget as TextInput).isFocused?.() === true;
            if (!keyboardVisibleRef.current || !targetStillFocused) return;
            const revealDelta = resolveCoachAiFocusedInputScrollDelta(
              inputScreenY,
              inputHeight,
              visibleViewportBottom,
              revealOffset,
            );
            if (revealDelta > 0) {
              scrollRef.current?.scrollTo({
                animated: true,
                y: Math.max(0, scrollOffsetYRef.current + revealDelta),
              });
            }
          });
        });
        return;
      }
      scrollRef.current?.scrollResponderScrollNativeHandleToKeyboard(
        revealTarget,
        responderRevealOffset,
        true,
      );
    };
    pendingRevealFrameRef.current = requestAnimationFrame(() => {
      if (Platform.OS === "android") {
        // Android reports keyboardDidShow while adjustResize layout is still settling.
        pendingRevealFrameRef.current = requestAnimationFrame(performReveal);
      } else {
        performReveal();
      }
    });
  }, [keepEndVisibleOnKeyboard, responderRevealOffset, revealOffset]);

  const requestInputReveal = useCallback((input: TextInput | null) => {
    requestedInputRef.current = input;
    if (keyboardVisibleRef.current) revealFocusedInput(input);
  }, [revealFocusedInput]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    if (keyboardVisibleRef.current) {
      const metrics = Keyboard.metrics();
      if (metrics) updateMultilineInputHeight(metrics.screenY);
    }
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      keyboardVisibleRef.current = true;
      shownKeyboardScreenYRef.current = event.endCoordinates.screenY;
      setKeyboardFrameSupplement(0);
      updateMultilineInputHeight(event.endCoordinates.screenY);
      revealFocusedInput(requestedInputRef.current);
    });
    const frameSubscription = Platform.OS === "ios"
      ? Keyboard.addListener("keyboardWillChangeFrame", (event) => {
        if (!keyboardVisibleRef.current) return;
        // ScrollView otherwise keeps the original keyboard frame for its reveal calculation.
        scrollRef.current?.scrollResponderKeyboardWillShow(event as never);
        setKeyboardFrameSupplement(resolveCoachAiKeyboardFrameSupplement(
          shownKeyboardScreenYRef.current ?? event.endCoordinates.screenY,
          event.endCoordinates.screenY,
        ));
        updateMultilineInputHeight(event.endCoordinates.screenY);
        revealFocusedInput();
      })
      : null;
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
      shownKeyboardScreenYRef.current = null;
      setKeyboardFrameSupplement(0);
      setMultilineInputHeight(COACH_AI_MULTILINE_INPUT_PREFERRED_HEIGHT);
      pendingRevealTargetRef.current = null;
      requestedInputRef.current = null;
      if (pendingRevealFrameRef.current !== null) {
        cancelAnimationFrame(pendingRevealFrameRef.current);
        pendingRevealFrameRef.current = null;
      }
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
      frameSubscription?.remove();
      if (pendingRevealFrameRef.current !== null) cancelAnimationFrame(pendingRevealFrameRef.current);
    };
  }, [revealFocusedInput, updateMultilineInputHeight]);

  return (
    <CoachAiMultilineInputHeightContext.Provider value={multilineInputHeight}>
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
            onScroll={(event) => {
              scrollOffsetYRef.current = event.nativeEvent.contentOffset.y;
              onScroll?.(event);
            }}
            scrollEventThrottle={scrollEventThrottle ?? 16}
            showsVerticalScrollIndicator={showsVerticalScrollIndicator}
            style={[styles.fill, style]}
          >
            {children}
            {keyboardFrameSupplement > 0
              ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ height: keyboardFrameSupplement }} />
              : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </KeyboardAwareInputRevealContext.Provider>
    </CoachAiMultilineInputHeightContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
