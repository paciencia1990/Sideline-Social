import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Redirect } from "expo-router";

import { CHOOSE_START_MODE_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";

export function AuthenticatedRouteGate({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!user) {
    return <Redirect href={SIGN_IN_ROUTE as never} />;
  }

  if (!user.modeOnboardingCompleted) {
    return <Redirect href={CHOOSE_START_MODE_ROUTE as never} />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  loadingScreen: {
    alignItems: "center",
    backgroundColor: Colors.background,
    flex: 1,
    justifyContent: "center",
  },
});