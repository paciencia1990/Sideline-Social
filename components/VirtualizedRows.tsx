import React, { useCallback, useEffect, useRef, type ReactNode } from "react";
import { FlatList, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, type FlatListProps } from "react-native";
import { Spacing } from "@/constants/theme";
import { flattenVirtualizedRows, type VirtualizedContentRow } from "@/utils/virtualizedRows";

type Props = Omit<FlatListProps<VirtualizedContentRow>, "data" | "renderItem" | "keyExtractor" | "children"> & {
  children: ReactNode;
  keyboardAware?: boolean;
};

// The factory creates the expensive row contents only inside the visible window.
export function VirtualizedRow({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

export function VirtualizedRows({
  children, keyboardAware = false, style, onFocus, onContentSizeChange,
  keyboardDismissMode = Platform.OS === "ios" ? "interactive" : "on-drag",
  keyboardShouldPersistTaps = "handled", showsVerticalScrollIndicator = false, ...props
}: Props) {
  const list = useRef<FlatList<VirtualizedContentRow>>(null);
  const frame = useRef<number | null>(null);
  const keyboardVisible = useRef(false);
  const revealFocusedInput = useCallback(() => {
    if (!keyboardAware) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const input = TextInput.State.currentlyFocusedInput();
      const responder = list.current?.getScrollResponder();
      // RN's FlatList declaration omits the runtime ScrollResponder methods.
      if (input && responder && "scrollResponderScrollNativeHandleToKeyboard" in responder &&
          typeof responder.scrollResponderScrollNativeHandleToKeyboard === "function") {
        responder.scrollResponderScrollNativeHandleToKeyboard(input, Spacing.md, true);
      }
    });
  }, [keyboardAware]);
  useEffect(() => {
    if (!keyboardAware) return;
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => {
      keyboardVisible.current = true;
      revealFocusedInput();
    });
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => {
      keyboardVisible.current = false;
    });
    return () => {
      show.remove(); hide.remove();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [keyboardAware, revealFocusedInput]);
  const content = (
    <FlatList
      {...props}
      ref={list}
      data={flattenVirtualizedRows(children)}
      keyExtractor={row => row.key}
      renderItem={({ item }) => <>{item.node}</>}
      initialNumToRender={12}
      maxToRenderPerBatch={8}
      windowSize={7}
      removeClippedSubviews={false}
      keyboardDismissMode={keyboardDismissMode}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onFocus={event => { onFocus?.(event); revealFocusedInput(); }}
      onContentSizeChange={(width, height) => {
        onContentSizeChange?.(width, height);
        if (keyboardVisible.current) revealFocusedInput();
      }}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      style={[styles.fill, style]}
    />
  );
  return keyboardAware
    ? <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.fill}>{content}</KeyboardAvoidingView>
    : content;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
