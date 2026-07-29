import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { PasswordInput } from "@/components/PasswordInput";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { FORGOT_PASSWORD_ROUTE } from "@/constants/routes";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export default function EmailLoginScreen() {
  const { t } = useTranslation();
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSignIn = async () => {
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
      if (__DEV__) console.warn("[EmailLogin] sign in error:", nextError);
      setError(t("auth.errors.signInFailed"));
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
          <Text style={styles.title}>{t("auth.signIn")}</Text>
          <TextInput style={styles.input} placeholder={t("auth.email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
          <PasswordInput
            autoCapitalize="none"
            autoComplete="current-password"
            containerStyle={styles.input}
            onChangeText={setPassword}
            placeholder={t("auth.password")}
            textContentType="password"
            value={password}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleSignIn} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.buttonText}>{t("auth.signInButton")}</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push(FORGOT_PASSWORD_ROUTE as never)}>
            <Text style={styles.link}>{t("auth.forgotPassword")}</Text>
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
  input: { height: 52, borderWidth: 1, borderColor: Colors.secondary, borderRadius: Radius.button, paddingHorizontal: Spacing.md, backgroundColor: Colors.surface, fontFamily: Typography.bodyRegular, ...Shadow.card },
  button: { height: 52, borderRadius: Radius.button, backgroundColor: Colors.primary, alignItems: "center", justifyContent: "center" },
  buttonText: { fontFamily: Typography.bodySemiBold, color: Colors.surface, fontSize: 16 },
  error: { fontFamily: Typography.bodyRegular, color: Colors.primary, textAlign: "center" },
  link: { fontFamily: Typography.bodySemiBold, color: Colors.primary, textAlign: "center" },
});
