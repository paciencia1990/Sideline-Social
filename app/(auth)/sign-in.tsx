import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { FederatedAuthButtons } from "@/components/FederatedAuthButtons";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { PasswordInput } from "@/components/PasswordInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { FORGOT_PASSWORD_ROUTE, SIGN_UP_ROUTE } from "@/constants/routes";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

export default function SignInScreen() {
  const { t } = useTranslation();
  const { signIn, signInWithApple, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<FederatedAuthProvider | null>(null);
  const [error, setError] = useState("");
  const busy = loading || providerLoading !== null;

  const handleEmailSignIn = useCallback(async () => {
    if (busy) return;
    setError("");
    if (!email.trim() || !password) {
      setError(t("auth.errors.credentialsRequired"));
      return;
    }
    setLoading(true);
    try {
      await signIn(email, password);
      await AsyncStorage.setItem("onboardingComplete", "true");
      router.replace("/(tabs)");
    } catch (nextError) {
      if (__DEV__) console.warn("[SignIn] sign in error:", nextError);
      setError(t("auth.errors.signInFailed"));
    } finally {
      setLoading(false);
    }
  }, [busy, email, password, signIn, t]);

  const handleProvider = useCallback(async (provider: FederatedAuthProvider) => {
    if (busy) return;
    setProviderLoading(provider);
    setError("");
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
  }, [busy, signInWithApple, signInWithGoogle, t]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <View style={styles.headingBlock}>
          <Text accessibilityRole="header" style={styles.title}>{t("auth.welcomeBack")}</Text>
          <Text style={styles.body}>{t("auth.signInSubtitle")}</Text>
        </View>
        <View style={styles.form}>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder={t("auth.email")}
            style={styles.input}
            textContentType="emailAddress"
            value={email}
          />
          <PasswordInput
            autoCapitalize="none"
            autoComplete="current-password"
            containerStyle={styles.input}
            onChangeText={setPassword}
            placeholder={t("auth.password")}
            textContentType="password"
            value={password}
          />
          <TouchableOpacity disabled={busy} onPress={() => router.push(FORGOT_PASSWORD_ROUTE as never)}>
            <Text style={styles.forgotLink}>{t("auth.forgotPassword")}</Text>
          </TouchableOpacity>
        </View>
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <PrimaryButton disabled={busy} loading={loading} onPress={() => void handleEmailSignIn()} title={t("auth.signInButton")} />
        <FederatedAuthButtons
          disabled={loading}
          loadingProvider={providerLoading}
          onProviderPress={(provider) => void handleProvider(provider)}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchCopy}>{t("auth.dontHaveAccount")}</Text>
          <TouchableOpacity disabled={busy} onPress={() => router.push(SIGN_UP_ROUTE as never)}>
            <Text style={styles.switchLink}>{t("auth.createAccount")}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
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
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  content: { flexGrow: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.lg, paddingVertical: Spacing.xl },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  forgotLink: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "right" },
  form: { gap: Spacing.sm },
  headingBlock: { gap: Spacing.xs, marginBottom: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, fontFamily: Typography.bodyRegular, height: 52, paddingHorizontal: Spacing.md, ...Shadow.card },
  switchCopy: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14 },
  switchLink: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 14 },
  switchRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, justifyContent: "center", marginTop: Spacing.sm, minHeight: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 34, textAlign: "center" },
});
