import "@/i18n/polyfills";
import "@/i18n";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo } from "react";
import { StyleSheet, useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
  type Theme,
} from "@react-navigation/native";
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
import { Caveat_400Regular, Caveat_700Bold } from "@expo-google-fonts/caveat";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppProvider } from "@/context/AppContext";
import { AuthProvider } from "@/context/AuthContext";
import { SquadProvider } from "@/context/SquadContext";
import { Colors, Typography } from "@/constants/theme";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function createNavigationTheme(colorScheme: "light" | "dark" | null | undefined): Theme {
  const baseTheme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  return {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
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
  const colorScheme = useColorScheme();
  const navigationTheme = useMemo(() => createNavigationTheme(colorScheme), [colorScheme]);

  const [fontsLoaded, fontError] = useFonts({
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
              <SquadProvider>
                <AppProvider>
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
                  <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
                </AppProvider>
              </SquadProvider>
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

