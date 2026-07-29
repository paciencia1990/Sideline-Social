import React, { useCallback } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { OutlineButton } from "@/components/OutlineButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { EMAIL_SIGN_IN_ROUTE, SIGN_UP_ROUTE } from "@/constants/routes";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const handleEmailSignIn = useCallback(() => {
    if (__DEV__) console.info("[AuthDebug] Email login pressed");
    router.push(EMAIL_SIGN_IN_ROUTE as never);
  }, [router]);

  const handleCreateAccount = useCallback(() => {
    if (__DEV__) console.info("[AuthDebug] Sign up pressed");
    router.push(SIGN_UP_ROUTE as never);
  }, [router]);

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text style={styles.title}>{t("auth.welcomeBack")}</Text>
        <Text style={styles.body}>{t("auth.signInSubtitle")}</Text>
        <PrimaryButton title={t("auth.signInWithEmail")} onPress={handleEmailSignIn} />
        <OutlineButton title={t("auth.createAccount")} onPress={handleCreateAccount} />
      </View>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  title: { fontFamily: Typography.heading, fontSize: 34, color: Colors.textHeading, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, fontSize: 16, color: Colors.textPrimary, textAlign: "center", marginBottom: Spacing.md },
});
