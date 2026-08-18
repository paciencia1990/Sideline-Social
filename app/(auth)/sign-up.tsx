import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { FederatedAuthButtons } from "@/components/FederatedAuthButtons";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { LegalAssentControls } from "@/components/LegalAssentControls";
import { PasswordInput } from "@/components/PasswordInput";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { CHOOSE_START_MODE_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import type { FederatedAuthProvider } from "@/utils/federatedAuthCore";

export default function SignUpScreen() {
  const { t } = useTranslation();
  const { signInWithApple, signInWithGoogle, signUp } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [sport, setSport] = useState("");
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [providerLoading, setProviderLoading] = useState<FederatedAuthProvider | null>(null);
  const [error, setError] = useState("");
  const busy = loading || providerLoading !== null;

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

  const handleCreate = useCallback(async () => {
    if (busy) return;
    setError("");
    if (!firstName.trim() || !lastName.trim() || !email.trim() || password.length < 8 || !policiesAccepted || !adultConfirmed) {
      setError(t("auth.errors.signupRequired"));
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password, {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        zipCode: zipCode.trim(),
        sports: sport.trim() ? [sport.trim()] : [],
        policiesAccepted,
        adultEligibilityConfirmed: adultConfirmed,
      });
      await AsyncStorage.setItem("onboardingComplete", "true");
      router.replace(CHOOSE_START_MODE_ROUTE as never);
    } catch (nextError) {
      if (__DEV__) console.warn("[SignUp] create account error:", nextError);
      setError(t("auth.errors.createFailed"));
    } finally {
      setLoading(false);
    }
  }, [adultConfirmed, busy, email, firstName, lastName, password, policiesAccepted, signUp, sport, t, zipCode]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <TouchableOpacity accessibilityLabel={t("common.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft accessibilityElementsHidden importantForAccessibility="no-hide-descendants" size={24} color={Colors.textHeading} />
        </TouchableOpacity>
        <View style={styles.headingBlock}>
          <Text accessibilityRole="header" style={styles.title}>{t("auth.createAccount")}</Text>
          <Text style={styles.subtitle}>{t("auth.signUpSubtitle")}</Text>
        </View>
        <View style={styles.form}>
          <TextInput autoComplete="given-name" style={styles.input} placeholder={t("auth.firstName")} value={firstName} onChangeText={setFirstName} />
          <TextInput autoComplete="family-name" style={styles.input} placeholder={t("auth.lastName")} value={lastName} onChangeText={setLastName} />
          <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" onChangeText={setEmail} placeholder={t("auth.email")} style={styles.input} textContentType="emailAddress" value={email} />
          <PasswordInput
            autoCapitalize="none"
            autoComplete="new-password"
            containerStyle={styles.input}
            onChangeText={setPassword}
            placeholder={t("auth.password")}
            textContentType="newPassword"
            value={password}
          />
          <TextInput autoComplete="postal-code" style={styles.input} placeholder={t("auth.zipCode")} value={zipCode} onChangeText={setZipCode} keyboardType="number-pad" />
          <TextInput style={styles.input} placeholder={t("auth.selectSportOptional")} value={sport} onChangeText={setSport} />
          <LegalAssentControls
            adultConfirmed={adultConfirmed}
            onAdultConfirmedChange={setAdultConfirmed}
            onPoliciesAcceptedChange={setPoliciesAccepted}
            policiesAccepted={policiesAccepted}
          />
        </View>
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <PrimaryButton disabled={busy} loading={loading} onPress={() => void handleCreate()} title={t("auth.createAccountButton")} />
        <FederatedAuthButtons
          disabled={loading}
          loadingProvider={providerLoading}
          onProviderPress={(provider) => void handleProvider(provider)}
        />
        <View style={styles.switchRow}>
          <Text style={styles.switchCopy}>{t("auth.alreadyHaveAccount")}</Text>
          <TouchableOpacity disabled={busy} onPress={() => router.replace(SIGN_IN_ROUTE as never)}>
            <Text style={styles.switchLink}>{t("auth.signIn")}</Text>
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
  if (code.includes("configuration")) return t("auth.providerErrors.configuration");
  if (code.includes("operation-in-progress")) return t("auth.providerErrors.inProgress");
  return t("auth.providerErrors.generic");
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  backButton: { alignItems: "center", height: 44, justifyContent: "center", left: Spacing.lg, position: "absolute", top: Spacing.lg, width: 44, zIndex: 1 },
  content: { flexGrow: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.lg, paddingVertical: Spacing.xl, paddingTop: 76 },
  error: { color: Colors.primary, fontFamily: Typography.bodyRegular, lineHeight: 20, textAlign: "center" },
  form: { gap: Spacing.sm },
  headingBlock: { gap: Spacing.xs, marginBottom: Spacing.sm },
  input: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, fontFamily: Typography.bodyRegular, height: 52, paddingHorizontal: Spacing.md, ...Shadow.card },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  switchCopy: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14 },
  switchLink: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 14 },
  switchRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, justifyContent: "center", marginTop: Spacing.sm, minHeight: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 32, textAlign: "center" },
});
