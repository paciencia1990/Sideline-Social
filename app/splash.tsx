import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { Colors, Typography } from "@/constants/theme";

export default function SplashScreen() {
  const router = useRouter();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(async () => {
      const onboardingComplete = await AsyncStorage.getItem("onboardingComplete");
      router.replace(onboardingComplete === "true" ? "/(tabs)" : "/(auth)/onboarding");
    }, 900);

    return () => clearTimeout(timer);
  }, [opacity, router]);

  return (
    <View style={styles.container}>
      <Animated.View style={{ opacity }}>
        <Text style={styles.wordmark}>Sideline Social</Text>
        <Text style={styles.tagline}>turn wait time into game time</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.textHeading,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  wordmark: {
    fontFamily: Typography.heading,
    fontSize: 36,
    color: Colors.surface,
    textAlign: "center",
  },
  tagline: {
    fontFamily: Typography.accent,
    fontSize: 20,
    color: Colors.accentGreen,
    textAlign: "center",
    marginTop: 8,
  },
});