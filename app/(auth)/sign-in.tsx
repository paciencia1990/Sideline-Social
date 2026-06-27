import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { OutlineButton } from "@/components/OutlineButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function SignInScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.body}>Sign in to find your sideline squad.</Text>
        <PrimaryButton title="Sign in with Email" onPress={() => router.push("/(auth)/email-login")} />
        <OutlineButton title="Create Account" onPress={() => router.push("/(auth)/sign-up")} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 34, color: Colors.textHeading, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, fontSize: 16, color: Colors.textPrimary, textAlign: "center", marginBottom: Spacing.md },
});