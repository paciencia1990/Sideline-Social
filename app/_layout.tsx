import "@/global.css";
import "@/i18n";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import "react-native-reanimated";
import { useFonts } from "expo-font";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_700Bold,
  PlayfairDisplay_400Regular_Italic,
  PlayfairDisplay_700Bold_Italic,
} from "@expo-google-fonts/playfair-display";
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
} from "@expo-google-fonts/montserrat";
import {
  Caveat_400Regular,
  Caveat_700Bold,
} from "@expo-google-fonts/caveat";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import GluestackInitializer from "@/components/GluestackInitializer";
import useColorScheme from "@/hooks/useColorScheme";
import { Stack } from "expo-router";

import { AuthProvider } from "@/context/AuthContext";
import { SquadProvider } from "@/context/SquadContext";
import { AppProvider } from "@/context/AppContext";

// Initialize CatDoes Watch for error tracking
// Set EXPO_PUBLIC_CATDOES_WATCH_KEY in your environment to enable
import { initCatDoesWatch } from "@/catdoes.watch";
initCatDoesWatch();

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [loaded] = useFonts({
    SpaceMono: require("../assets/fonts/SpaceMono-Regular.ttf"),
    PlayfairDisplay_400Regular,
    PlayfairDisplay_700Bold,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_700Bold_Italic,
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Caveat_400Regular,
    Caveat_700Bold,
  });

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  /*
   * IMPORTANT: DO NOT REMOVE GluestackInitializer OR ErrorBoundary */
  return (
    <ErrorBoundary>
      <GluestackInitializer colorScheme={colorScheme}>
        <AuthProvider>
          <SquadProvider>
            <AppProvider>
              <Stack
                screenOptions={{
                  headerShown: false,
                  contentStyle: { backgroundColor: "#F5EFE6" },
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="splash" options={{ animation: 'none' }} />
                <Stack.Screen name="(tabs)" />
                <Stack.Screen name="(auth)" />
                <Stack.Screen name="(games)" />
                <Stack.Screen name="(social)" />
                <Stack.Screen name="(future)" />
                <Stack.Screen name="leaderboard" options={{ headerShown: true, title: "Leaderboard" }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <StatusBar style="auto" />
            </AppProvider>
          </SquadProvider>
        </AuthProvider>
      </GluestackInitializer>
    </ErrorBoundary>
  );
}