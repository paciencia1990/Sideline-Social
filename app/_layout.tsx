import "@/i18n";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import {
  DefaultTheme,
  ThemeProvider,
  type Theme,
} from "expo-router/react-navigation";
import { useFonts } from "expo-font";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AccountStandingBoundary } from "@/components/AccountStandingBoundary";
import { NotificationCoordinator } from "@/components/NotificationCoordinator";
import { AppProvider } from "@/context/AppContext";
import { AccountStandingProvider } from "@/context/AccountStandingContext";
import { AuthProvider } from "@/context/AuthContext";
import { SquadProvider } from "@/context/SquadContext";
import { Colors, Typography } from "@/constants/theme";

const PlayfairDisplay_700Bold = require("@expo-google-fonts/playfair-display/PlayfairDisplay_700Bold.ttf");
const PlayfairDisplay_700Bold_Italic = require("@expo-google-fonts/playfair-display/PlayfairDisplay_700Bold_Italic.ttf");
const Montserrat_400Regular = require("@expo-google-fonts/montserrat/Montserrat_400Regular.ttf");
const Montserrat_500Medium = require("@expo-google-fonts/montserrat/Montserrat_500Medium.ttf");
const Montserrat_600SemiBold = require("@expo-google-fonts/montserrat/Montserrat_600SemiBold.ttf");
const Montserrat_700Bold = require("@expo-google-fonts/montserrat/Montserrat_700Bold.ttf");
const Caveat_400Regular = require("@expo-google-fonts/caveat/Caveat_400Regular.ttf");

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function createNavigationTheme(): Theme {
  return {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: Colors.primary,
      background: Colors.background,
      card: Colors.surface,
      text: Colors.textHeading,
      border: Colors.secondary,
      notification: Colors.accentGold,
    },
  };
}

export default function RootLayout() {
  const navigationTheme = useMemo(() => createNavigationTheme(), []);

  const [fontsLoaded, fontError] = useFonts({
    PlayfairDisplay_700Bold,
    PlayfairDisplay_700Bold_Italic,
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Caveat_400Regular,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontError, fontsLoaded]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <ThemeProvider value={navigationTheme}>
            <AuthProvider>
              <AccountStandingProvider>
                <AccountStandingBoundary>
                  <SquadProvider>
                    <AppProvider>
                  <NotificationCoordinator />
                  <Stack
                    screenOptions={{
                      headerShown: false,
                      contentStyle: styles.screenContent,
                    }}
                  >
                    <Stack.Screen name="index" />
                    <Stack.Screen name="splash" options={{ animation: "none" }} />
                    <Stack.Screen name="(auth)" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="(games)" />
                    <Stack.Screen name="(social)" />
                    <Stack.Screen name="coach" />
                    <Stack.Screen name="teams" />
                    <Stack.Screen name="notifications" />
                    <Stack.Screen name="settings" />
                    <Stack.Screen
                      name="leaderboard"
                      options={{
                        headerShown: true,
                        title: "Leaderboard",
                        headerStyle: styles.header,
                        headerTitleStyle: styles.headerTitle,
                        headerTintColor: Colors.textHeading,
                      }}
                    />
                    <Stack.Screen name="+not-found" />
                  </Stack>
                  <StatusBar style="dark" />
                    </AppProvider>
                  </SquadProvider>
                </AccountStandingBoundary>
              </AccountStandingProvider>
            </AuthProvider>
          </ThemeProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screenContent: {
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.surface,
  },
  headerTitle: {
    fontFamily: Typography.bodySemiBold,
    color: Colors.textHeading,
  },
});

