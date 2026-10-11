import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useNavigationKeyboardVisible() {
  const [visible, setVisible] = useState(() => Keyboard.isVisible());
  useEffect(() => {
    const subscriptions = [
      Keyboard.addListener("keyboardDidShow", () => setVisible(true)),
      Keyboard.addListener("keyboardDidHide", () => setVisible(false)),
    ];
    if (Platform.OS === "ios") {
      subscriptions.push(
        Keyboard.addListener("keyboardWillShow", () => setVisible(true)),
        Keyboard.addListener("keyboardWillHide", () => setVisible(false)),
      );
    }
    return () => subscriptions.forEach(subscription => subscription.remove());
  }, []);
  return visible;
}
