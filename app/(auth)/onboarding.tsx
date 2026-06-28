import React from "react";
import { StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function OnboardingScreen() {
  const finish = async () => {
    await AsyncStorage.setItem("onboardingComplete", "true");
    router.replace("/(auth)/sign-in");
  };

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Sideline Social</Text>
        <Text style={styles.tagline}>turn wait time into game time</Text>
        <Text style={styles.body}>Find nearby parents, join a squad, and make youth sports days easier to enjoy.</Text>
        <PrimaryButton title="Get Started" onPress={finish} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 38, color: Colors.textHeading, textAlign: "center" },
  tagline: { fontFamily: Typography.accent, fontSize: 26, color: Colors.primary, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, fontSize: 16, color: Colors.textPrimary, textAlign: "center", lineHeight: 24, marginBottom: Spacing.lg },
});