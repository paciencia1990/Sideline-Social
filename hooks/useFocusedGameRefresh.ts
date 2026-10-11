import { useCallback } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

export function useFocusedGameRefresh(enabled: boolean, refresh: (background: boolean) => Promise<void>) {
  useFocusEffect(useCallback(() => {
    if (!enabled) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    let previous = AppState.currentState;
    const stop = () => { if (interval !== undefined) clearInterval(interval); interval = undefined; };
    const start = (background: boolean) => {
      void refresh(background);
      stop(); interval = setInterval(() => void refresh(true), 15_000);
    };
    if (previous !== "background" && previous !== "inactive") start(false);
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") start(true);
      else if (next !== "active") stop();
      previous = next;
    });
    return () => { stop(); subscription.remove(); };
  }, [enabled, refresh]));
}
