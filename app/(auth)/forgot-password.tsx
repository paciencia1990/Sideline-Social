import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { FORGOT_PASSWORD_SUCCESS_ROUTE } from "@/constants/routes";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleReset = async () => {
    setError("");
    if (!email.trim()) {
      setError(t("auth.errors.emailRequired"));
      return;
    }
    setLoading(true);
    try {
      await resetPassword(email);
      router.push(FORGOT_PASSWORD_SUCCESS_ROUTE as never);
    } catch (nextError) {
      if (__DEV__) console.warn("[ForgotPassword] reset error:", nextError);
      setError(t("auth.errors.resetSendFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity accessibilityLabel={t("common.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ChevronLeft accessibilityElementsHidden importantForAccessibility="no-hide-descendants" size={24} color={Colors.textHeading} />
          </TouchableOpacity>
          <Text style={styles.title}>{t("auth.resetPassword")}</Text>
          <Text style={styles.body}>{t("auth.resetPasswordSubtitle")}</Text>
          <TextInput style={styles.input} placeholder={t("auth.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleReset} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.buttonText}>{t("auth.sendResetLink")}</Text>}
          </TouchableOpacity>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: "center", padding: Spacing.lg, gap: Spacing.md },
  backButton: { position: "absolute", top: Spacing.lg, left: Spacing.lg, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: Typography.heading, fontSize: 32, color: Colors.textHeading, textAlign: "center" },
  body: { fontFamily: Typography.bodyRegular, color: Colors.textPrimary, textAlign: "center" },
  input: { height: 52, borderWidth: 1, borderColor: Colors.secondary, borderRadius: Radius.button, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, fontFamily: Typography.bodyRegular, ...Shadow.card },
  button: { height: 52, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: Typography.bodySemiBold, color: Colors.surface, fontSize: 16 },
  error: { fontFamily: Typography.bodyRegular, color: Colors.primary, textAlign: "center" },
});
