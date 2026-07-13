import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { OutlineButton } from "@/components/OutlineButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { EMAIL_SIGN_IN_ROUTE, SIGN_UP_ROUTE } from "@/constants/routes";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function SignInScreen() {
  const router = useRouter();

  const handleEmailSignIn = useCallback(() => {
    if (__DEV__) console.log("[AuthWelcome] Sign in with Email pressed");
    router.push(EMAIL_SIGN_IN_ROUTE as never);
  }, [router]);

  const handleCreateAccount = useCallback(() => {
    if (__DEV__) console.log("[AuthWelcome] Create Account pressed");
    router.push(SIGN_UP_ROUTE as never);
  }, [router]);

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.body}>Sign in to find your Sideline Social circle.</Text>
        <PrimaryButton title="Sign in with Email" onPress={handleEmailSignIn} />
        <OutlineButton title="Create Account" onPress={handleCreateAccount} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 34, color: Colors.textHeading, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, fontSize: 16, color: Colors.textPrimary, textAlign: "center", marginBottom: Spacing.md },
});