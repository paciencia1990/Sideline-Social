import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function ForgotPasswordSuccessScreen() {
  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Check your email</Text>
        <Text style={styles.body}>If an account exists, Firebase sent a password reset link.</Text>
        <PrimaryButton title="Back to sign in" onPress={() => router.replace(SIGN_IN_ROUTE as never)} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 32, color: Colors.textHeading, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, textAlign: "center", lineHeight: 22 },
});