import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, TextInput } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { OutlineButton } from "@/components/OutlineButton";
import { PasswordInput } from "@/components/PasswordInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { deleteOwnAccount } from "@/services/accountService";
import { revokeGoogleAccessIfAvailable } from "@/services/federatedAuthService";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const {
    firebaseUser,
    reauthenticateWithPassword,
    reauthenticateWithProvider,
    signInMethods,
    signOut,
  } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifyingProvider, setVerifyingProvider] = useState<FederatedAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPassword = signInMethods.includes("password");
  const hasVerification = verified || (hasPassword && password.length > 0);
  const confirmed = confirmation.trim().toUpperCase() === "DELETE" && hasVerification;

  const verifyProvider = useCallback(async (provider: FederatedAuthProvider) => {
    if (busy || verifyingProvider) return;
    setVerifyingProvider(provider);
    setError(null);
    try {
      await reauthenticateWithProvider(provider);
      setVerified(true);
    } catch (nextError) {
      setError(deletionErrorMessage(nextError, t));
    } finally {
      setVerifyingProvider(null);
    }
  }, [busy, reauthenticateWithProvider, t, verifyingProvider]);

  const performDeletion = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (!verified && hasPassword) await reauthenticateWithPassword(password);
      const googleIdentity = firebaseUser?.email ?? firebaseUser?.uid;
      await deleteOwnAccount();
      if (signInMethods.includes("google")) await revokeGoogleAccessIfAvailable(googleIdentity);
      await signOut();
      router.dismissAll();
      router.replace(SIGN_IN_ROUTE as never);
    } catch (nextError) {
      setError(deletionErrorMessage(nextError, t));
      setBusy(false);
    }
  }, [firebaseUser?.email, firebaseUser?.uid, hasPassword, password, reauthenticateWithPassword, signInMethods, signOut, t, verified]);

  const confirmDeletion = useCallback(() => {
    Alert.alert(t("settings.deleteConfirmTitle"), t("settings.deleteConfirmBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      { text: t("settings.deleteAccount"), style: "destructive", onPress: () => void performDeletion() },
    ]);
  }, [performDeletion, t]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <Text style={styles.title}>{t("settings.deleteAccount")}</Text>
        <Card style={styles.card}>
          <Text style={styles.warning}>{t("settings.deleteWarning")}</Text>
          <Text style={styles.body}>{t("settings.deleteDetails")}</Text>
          <Text style={styles.label}>{t("settings.typeDelete")}</Text>
          <TextInput
            accessibilityLabel={t("settings.typeDelete")}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={setConfirmation}
            style={styles.input}
            value={confirmation}
          />

          <Text style={styles.label}>{t("settings.deleteVerifyTitle")}</Text>
          {hasPassword ? (
            <PasswordInput
              autoCapitalize="none"
              autoComplete="current-password"
              containerStyle={styles.passwordContainer}
              onChangeText={(value) => {
                setPassword(value);
                setVerified(false);
              }}
              placeholder={t("settings.currentPassword")}
              value={password}
            />
          ) : null}
          {signInMethods.includes("google") ? (
            <OutlineButton
              disabled={busy || Boolean(verifyingProvider)}
              loading={verifyingProvider === "google"}
              onPress={() => void verifyProvider("google")}
              title={t("settings.verifyWithGoogle")}
            />
          ) : null}
          {signInMethods.includes("apple") ? (
            <OutlineButton
              disabled={busy || Boolean(verifyingProvider)}
              loading={verifyingProvider === "apple"}
              onPress={() => void verifyProvider("apple")}
              title={t("settings.verifyWithApple")}
            />
          ) : null}
          {verified ? <Text accessibilityLiveRegion="polite" style={styles.verified}>{t("settings.identityVerified")}</Text> : null}
          <PrimaryButton disabled={!confirmed || busy} loading={busy} onPress={confirmDeletion} title={t("settings.deletePermanently")} />
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        </Card>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function deletionErrorMessage(error: unknown, t: (key: string) => string) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (code.includes("failed-precondition")) return t("settings.deleteOwnershipError");
  if (code.includes("cancel")) return t("auth.providerErrors.cancelled");
  if (code.includes("unsupported_platform")) return t("auth.providerErrors.appleAndroidUnavailable");
  if (code.includes("configuration")) return t("auth.providerErrors.configuration");
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return t("settings.deleteReauthError");
  if (code.includes("unauthenticated") || code.includes("requires-recent-login")) return t("settings.deleteRecentLoginError");
  return t("settings.deleteError");
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 22 },
  card: { gap: Spacing.md },
  content: { gap: Spacing.md, padding: Spacing.lg },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20 },
  input: { backgroundColor: Colors.surface, borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 16, minHeight: 48, paddingHorizontal: Spacing.md },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold },
  passwordContainer: { backgroundColor: Colors.surface, borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, height: 48 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  verified: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold },
  warning: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 18, lineHeight: 24 },
});
