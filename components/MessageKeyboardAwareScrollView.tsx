import React from "react";
import type { ScrollViewProps } from "react-native";

import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";

export function MessageKeyboardAwareScrollView(props: ScrollViewProps) {
  return <KeyboardAwareScrollView {...props} keepEndVisibleOnKeyboard />;
}
