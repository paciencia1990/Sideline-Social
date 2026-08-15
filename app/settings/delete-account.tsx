import { useCallback, useRef, useState } from "react";
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
import { useAuthProviderAvailability } from "@/hooks/useAuthProviderAvailability";
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
  const [verifiedProvider, setVerifiedProvider] = useState<FederatedAuthProvider | null>(null);
  const [busy, setBusy] = useState(false);
  const [verifyingProvider, setVerifyingProvider] = useState<FederatedAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const appleAuthorizationRef = useRef<{ code: string; createdAt: number } | null>(null);
  const hasPassword = signInMethods.includes("password");
  const hasGoogle = signInMethods.includes("google");
  const hasApple = signInMethods.includes("apple");
  const { showApple, showGoogle } = useAuthProviderAvailability();
  const hasVerification = hasApple
    ? verifiedProvider === "apple"
    : verifiedProvider !== null || (hasPassword && password.length > 0);
  const confirmed = confirmation.trim().toUpperCase() === "DELETE" && hasVerification;

  const verifyProvider = useCallback(async (provider: FederatedAuthProvider) => {
    if (busy || verifyingProvider) return;
    setVerifyingProvider(provider);
    setError(null);
    try {
      const result = await reauthenticateWithProvider(provider);
      if (provider === "apple") {
        if (!result.authorizationCode) throw codedError("auth/apple-authorization-code-required");
        appleAuthorizationRef.current = { code: result.authorizationCode, createdAt: Date.now() };
      }
      setVerifiedProvider(provider);
    } catch (nextError) {
      if (provider === "apple") appleAuthorizationRef.current = null;
      setVerifiedProvider(null);
      setError(deletionErrorMessage(nextError, t));
    } finally {
      setVerifyingProvider(null);
    }
  }, [busy, reauthenticateWithProvider, t, verifyingProvider]);

  const performDeletion = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      let appleAuthorizationCode: string | undefined;
      if (hasApple) {
        const pendingAppleAuthorization = appleAuthorizationRef.current;
        appleAuthorizationRef.current = null;
        setVerifiedProvider(null);
        if (!pendingAppleAuthorization || Date.now() - pendingAppleAuthorization.createdAt > 5 * 60 * 1000) {
          throw codedError("auth/apple-authorization-code-required");
        }
        appleAuthorizationCode = pendingAppleAuthorization.code;
      } else if (verifiedProvider === null && hasPassword) {
        await reauthenticateWithPassword(password);
      }
      const googleIdentity = firebaseUser?.email ?? firebaseUser?.uid;
      await deleteOwnAccount(appleAuthorizationCode ? { appleAuthorizationCode } : {});
      if (hasGoogle) await revokeGoogleAccessIfAvailable(googleIdentity);
      await signOut();
      router.dismissAll();
      router.replace(SIGN_IN_ROUTE as never);
    } catch (nextError) {
      setError(deletionErrorMessage(nextError, t));
      setBusy(false);
    }
  }, [firebaseUser?.email, firebaseUser?.uid, hasApple, hasGoogle, hasPassword, password, reauthenticateWithPassword, signOut, t, verifiedProvider]);

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
          {hasApple ? <Text style={styles.body}>{t("settings.deleteAppleReauthBody")}</Text> : null}
          {hasApple && !showApple ? <Text style={styles.warningDetail}>{t("settings.deleteAppleDeviceRequired")}</Text> : null}
          {!hasApple && !hasPassword && hasGoogle && !showGoogle ? (
            <Text style={styles.warningDetail}>{t("settings.deleteProviderUnavailable")}</Text>
          ) : null}
          {!hasApple && hasPassword ? (
            <PasswordInput
              autoCapitalize="none"
              autoComplete="current-password"
              containerStyle={styles.passwordContainer}
              onChangeText={(value) => {
                setPassword(value);
                setVerifiedProvider(null);
              }}
              placeholder={t("settings.currentPassword")}
              value={password}
            />
          ) : null}
          {!hasApple && hasGoogle && showGoogle ? (
            <OutlineButton
              disabled={busy || Boolean(verifyingProvider)}
              loading={verifyingProvider === "google"}
              onPress={() => void verifyProvider("google")}
              title={t("settings.verifyWithGoogle")}
            />
          ) : null}
          {hasApple && showApple ? (
            <OutlineButton
              disabled={busy || Boolean(verifyingProvider)}
              loading={verifyingProvider === "apple"}
              onPress={() => void verifyProvider("apple")}
              title={t("settings.verifyWithApple")}
            />
          ) : null}
          {verifiedProvider ? <Text accessibilityLiveRegion="polite" style={styles.verified}>{t("settings.identityVerified")}</Text> : null}
          <PrimaryButton disabled={!confirmed || busy} loading={busy} onPress={confirmDeletion} title={t("settings.deletePermanently")} />
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        </Card>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function deletionErrorMessage(error: unknown, t: (key: string) => string) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const reason = typeof error === "object" && error && "details" in error
    ? String((error as { details?: { reason?: unknown } }).details?.reason ?? "")
    : "";
  if (
    code.includes("apple-authorization-code-required") ||
    reason === "apple_authorization_code_required" ||
    reason === "apple_authorization_code_invalid"
  ) {
    return t("settings.deleteAppleReauthRequired");
  }
  if (reason === "apple_provider_not_linked") return t("settings.deleteAppleAccountMismatch");
  if (
    reason === "apple_token_exchange_failed" ||
    reason === "apple_revocation_failed" ||
    reason === "apple_credentials_unavailable" ||
    reason === "apple_subject_mismatch"
  ) {
    return t("settings.deleteAppleRevocationError");
  }
  if (reason === "account_deletion_in_progress") return t("settings.deleteInProgress");
  if (code.includes("failed-precondition")) return t("settings.deleteOwnershipError");
  if (code.includes("cancel")) return t("auth.providerErrors.cancelled");
  if (code.includes("unsupported_platform")) return t("auth.providerErrors.appleAndroidUnavailable");
  if (code.includes("configuration")) return t("auth.providerErrors.configuration");
  if (code.includes("wrong-password") || code.includes("invalid-credential")) return t("settings.deleteReauthError");
  if (code.includes("unauthenticated") || code.includes("requires-recent-login")) return t("settings.deleteRecentLoginError");
  return t("settings.deleteError");
}

function codedError(code: string) {
  const error = new Error(code);
  (error as Error & { code: string }).code = code;
  return error;
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
  warningDetail: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, lineHeight: 21 },
});
