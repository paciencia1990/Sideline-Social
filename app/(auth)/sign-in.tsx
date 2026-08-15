import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { FederatedAuthButtons } from "@/components/FederatedAuthButtons";
import { OutlineButton } from "@/components/OutlineButton";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { EMAIL_SIGN_IN_ROUTE, SIGN_UP_ROUTE } from "@/constants/routes";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

export default function SignInScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { signInWithApple, signInWithGoogle } = useAuth();
  const [providerLoading, setProviderLoading] = useState<FederatedAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleEmailSignIn = useCallback(() => {
    router.push(EMAIL_SIGN_IN_ROUTE as never);
  }, [router]);

  const handleCreateAccount = useCallback(() => {
    router.push(SIGN_UP_ROUTE as never);
  }, [router]);

  const handleProvider = useCallback(async (provider: FederatedAuthProvider) => {
    if (providerLoading) return;
    setProviderLoading(provider);
    setError(null);
    try {
      if (provider === "google") await signInWithGoogle();
      else await signInWithApple();
      await AsyncStorage.setItem("onboardingComplete", "true").catch(() => undefined);
      router.replace("/" as never);
    } catch (nextError) {
      setError(providerErrorMessage(getErrorCode(nextError), t));
    } finally {
      setProviderLoading(null);
    }
  }, [providerLoading, router, signInWithApple, signInWithGoogle, t]);

  return (
    <ScreenWrapper>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>{t("auth.welcomeBack")}</Text>
        <Text style={styles.body}>{t("auth.signInSubtitle")}</Text>
        <FederatedAuthButtons
          loadingProvider={providerLoading}
          onProviderPress={(provider) => void handleProvider(provider)}
        />
        <PrimaryButton disabled={Boolean(providerLoading)} onPress={handleEmailSignIn} title={t("auth.continueWithEmail")} />
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <OutlineButton disabled={Boolean(providerLoading)} onPress={handleCreateAccount} title={t("auth.createAccount")} />
      </View>
    </ScreenWrapper>
  );
}

function providerErrorMessage(code: string, t: (key: string) => string) {
  if (code.includes("cancel")) return t("auth.providerErrors.cancelled");
  if (code.includes("network")) return t("auth.providerErrors.network");
  if (code.includes("linking-required")) return t("auth.providerErrors.linkingRequired");
  if (code.includes("conflict-email-mismatch")) return t("auth.providerErrors.accountMismatch");
  if (code.includes("unsupported_platform")) return t("auth.providerErrors.appleAndroidUnavailable");
  if (code.includes("configuration")) return t("auth.providerErrors.configuration");
  if (code.includes("operation-in-progress")) return t("auth.providerErrors.inProgress");
  return t("auth.providerErrors.generic");
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 16, marginBottom: Spacing.md, textAlign: "center" },
  content: { flex: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.lg },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 34, textAlign: "center" },
});
