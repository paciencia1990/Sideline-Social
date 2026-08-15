import { Alert, StyleSheet, Text, View } from "react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { OutlineButton } from "@/components/OutlineButton";
import { PasswordInput } from "@/components/PasswordInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import type { FederatedAuthProvider, SignInMethod } from "@/utils/federatedAuthCore";

export default function SignInMethodsScreen() {
  const { t } = useTranslation();
  const {
    linkProvider,
    reauthenticateWithPassword,
    reauthenticateWithProvider,
    signInMethods,
    unlinkProvider,
  } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hasPassword = signInMethods.includes("password");

  const run = async (key: string, operation: () => Promise<void>, successKey: string) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    setMessage(null);
    try {
      await operation();
      setMessage(t(successKey));
    } catch (nextError) {
      setError(methodErrorMessage(getErrorCode(nextError), t));
    } finally {
      setBusy(null);
    }
  };

  const connect = (provider: FederatedAuthProvider) => {
    const perform = () => void run(`link-${provider}`, () => linkProvider(provider), "settings.signInMethods.connectedSuccess");
    if (provider === "apple") {
      Alert.alert(t("settings.signInMethods.appleConsentTitle"), t("settings.signInMethods.appleConsentBody"), [
        { text: t("settings.cancel"), style: "cancel" },
        { text: t("settings.signInMethods.connect"), onPress: perform },
      ]);
    } else {
      perform();
    }
  };

  const disconnect = (provider: FederatedAuthProvider) => {
    Alert.alert(t("settings.signInMethods.disconnectTitle"), t("settings.signInMethods.disconnectBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      {
        text: t("settings.signInMethods.disconnect"),
        style: "destructive",
        onPress: () => void run(`unlink-${provider}`, () => unlinkProvider(provider), "settings.signInMethods.disconnectedSuccess"),
      },
    ]);
  };

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <Text accessibilityRole="header" style={styles.title}>{t("settings.signInMethods.title")}</Text>
        <Text style={styles.body}>{t("settings.signInMethods.body")}</Text>

        <MethodCard method="password" linked={hasPassword} />
        <MethodCard
          busy={busy}
          linked={signInMethods.includes("google")}
          method="google"
          onConnect={() => connect("google")}
          onDisconnect={() => disconnect("google")}
        />
        <MethodCard
          busy={busy}
          linked={signInMethods.includes("apple")}
          method="apple"
          onConnect={() => connect("apple")}
          onDisconnect={() => disconnect("apple")}
        />

        <Card style={styles.verifyCard}>
          <Text style={styles.sectionTitle}>{t("settings.signInMethods.verifyTitle")}</Text>
          <Text style={styles.body}>{t("settings.signInMethods.verifyBody")}</Text>
          {hasPassword ? (
            <>
              <PasswordInput
                autoComplete="current-password"
                containerStyle={styles.password}
                onChangeText={setPassword}
                placeholder={t("settings.currentPassword")}
                value={password}
              />
              <PrimaryButton
                disabled={!password || Boolean(busy)}
                loading={busy === "verify-password"}
                onPress={() => void run("verify-password", () => reauthenticateWithPassword(password), "settings.signInMethods.verifiedSuccess")}
                title={t("settings.signInMethods.verifyPassword")}
              />
            </>
          ) : null}
          {signInMethods.includes("google") ? (
            <OutlineButton
              disabled={Boolean(busy)}
              loading={busy === "verify-google"}
              onPress={() => void run("verify-google", () => reauthenticateWithProvider("google"), "settings.signInMethods.verifiedSuccess")}
              title={t("settings.signInMethods.verifyGoogle")}
            />
          ) : null}
          {signInMethods.includes("apple") ? (
            <OutlineButton
              disabled={Boolean(busy)}
              loading={busy === "verify-apple"}
              onPress={() => void run("verify-apple", () => reauthenticateWithProvider("apple"), "settings.signInMethods.verifiedSuccess")}
              title={t("settings.signInMethods.verifyApple")}
            />
          ) : null}
        </Card>
        {message ? <Text accessibilityLiveRegion="polite" style={styles.success}>{message}</Text> : null}
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function MethodCard({
  busy,
  linked,
  method,
  onConnect,
  onDisconnect,
}: {
  busy?: string | null;
  linked: boolean;
  method: SignInMethod;
  onConnect?: () => void;
  onDisconnect?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card style={styles.methodCard}>
      <View style={styles.methodHeader}>
        <Text style={styles.sectionTitle}>{t(`settings.signInMethods.methods.${method}`)}</Text>
        <Text style={[styles.status, linked && styles.linked]}>{t(linked ? "settings.signInMethods.linked" : "settings.signInMethods.notLinked")}</Text>
      </View>
      {method === "password" ? <Text style={styles.body}>{t("settings.signInMethods.passwordManaged")}</Text> : null}
      {linked && onDisconnect ? (
        <OutlineButton disabled={Boolean(busy)} loading={busy === `unlink-${method}`} onPress={onDisconnect} title={t("settings.signInMethods.disconnect")} />
      ) : null}
      {!linked && onConnect ? (
        <PrimaryButton disabled={Boolean(busy)} loading={busy === `link-${method}`} onPress={onConnect} title={t("settings.signInMethods.connect")} />
      ) : null}
    </Card>
  );
}

function methodErrorMessage(code: string, t: (key: string) => string) {
  if (code.includes("requires-recent-login")) return t("settings.signInMethods.errors.recentLogin");
  if (code.includes("cannot-unlink-last-provider")) return t("settings.signInMethods.errors.lastMethod");
  if (code.includes("credential-already-in-use") || code.includes("provider-already-linked")) return t("settings.signInMethods.errors.usedElsewhere");
  if (code.includes("cancel")) return t("settings.signInMethods.errors.cancelled");
  if (code.includes("network")) return t("settings.signInMethods.errors.network");
  if (code.includes("unsupported_platform")) return t("auth.providerErrors.appleAndroidUnavailable");
  if (code.includes("configuration")) return t("auth.providerErrors.configuration");
  return t("settings.signInMethods.errors.generic");
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21 },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xl },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  linked: { color: Colors.communicationLink },
  methodCard: { gap: Spacing.md },
  methodHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "space-between" },
  password: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, height: 48 },
  sectionTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  status: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  success: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  verifyCard: { gap: Spacing.md },
});

