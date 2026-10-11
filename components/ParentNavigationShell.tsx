import React, { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { router, useSegments } from "expo-router";

import { ParentNavigationBar } from "@/components/ParentNavigationBar";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { ParentNavigationContext } from "@/context/ParentNavigationContext";
import { useNavigationKeyboardVisible } from "@/hooks/useNavigationKeyboardVisible";
import { getParentDetailSection, PARENT_DESTINATIONS } from "@/utils/parentNavigation";

export function ParentNavigationShell({ children }: { children: ReactNode }) {
  const segments = useSegments();
  const { activeMode, modeHydrated } = useApp();
  const { user, loading } = useAuth();
  const keyboardVisible = useNavigationKeyboardVisible();
  const section = getParentDetailSection(segments);
  const visible = section !== null && activeMode === "parent" && modeHydrated && !loading
    && Boolean(user?.accountOnboardingCompleted && user.modeOnboardingCompleted) && !keyboardVisible;
  return (
    <ParentNavigationContext.Provider value={visible}>
      <View style={styles.container}>
        <View style={styles.content}>{children}</View>
        {visible && section !== null ? <ParentNavigationBar activeTab={section} onSelect={tab => {
          const destination = PARENT_DESTINATIONS.find(candidate => candidate.name === tab);
          if (destination) {
            // POP_TO removes the detail/room route and reuses the existing tabs.
            // The room's usePreventRemove guard performs cleanup before resuming
            // this exact action; do not separately leave or bypass that guard.
            router.dismissTo(destination.href);
          }
        }} /> : null}
      </View>
    </ParentNavigationContext.Provider>
  );
}

const styles = StyleSheet.create({ container: { flex: 1 }, content: { flex: 1 } });
