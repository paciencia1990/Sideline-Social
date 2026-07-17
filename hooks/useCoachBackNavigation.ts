import { useCallback } from "react";
import { BackHandler } from "react-native";
import { router, useFocusEffect } from "expo-router";

const COACH_HOME_ROUTE = "/coach";

export function useCoachBackNavigation() {
  const navigateBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(COACH_HOME_ROUTE as never);
  }, []);

  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      navigateBack();
      return true;
    });
    return () => subscription.remove();
  }, [navigateBack]));

  return navigateBack;
}
