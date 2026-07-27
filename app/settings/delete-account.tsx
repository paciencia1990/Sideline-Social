import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, TextInput } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { PasswordInput } from "@/components/PasswordInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { deleteOwnAccount } from "@/services/accountService";

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = confirmation.trim().toUpperCase() === "DELETE" && password.length > 0;

  const performDeletion = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteOwnAccount(password);
      await signOut();
      router.dismissAll();
      router.replace(SIGN_IN_ROUTE as never);
    } catch (nextError) {
      const code = typeof nextError === "object" && nextError && "code" in nextError ? String(nextError.code) : "";
      setError(code.includes("failed-precondition") ? t("settings.deleteOwnershipError") : t("settings.deleteError"));
      setBusy(false);
    }
  }, [password, signOut, t]);

  const confirmDeletion = useCallback(() => {
    Alert.alert(t("settings.deleteConfirmTitle"), t("settings.deleteConfirmBody"), [
      { text: t("settings.cancel"), style: "cancel" },
      { text: t("settings.deleteAccount"), style: "destructive", onPress: () => void performDeletion() },
    ]);
  }, [performDeletion, t]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
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
          <Text style={styles.label}>{t("settings.currentPassword")}</Text>
          <PasswordInput
            autoCapitalize="none"
            autoComplete="current-password"
            containerStyle={styles.passwordContainer}
            onChangeText={setPassword}
            value={password}
          />
          <PrimaryButton disabled={!confirmed || busy} loading={busy} onPress={confirmDeletion} title={t("settings.deletePermanently")} />
          {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        </Card>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
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
  warning: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 18, lineHeight: 24 },
});
