import { Redirect, router } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { LegalAssentControls } from "@/components/LegalAssentControls";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { CHOOSE_START_MODE_ROUTE, PARENT_HOME_ROUTE, SIGN_IN_ROUTE } from "@/constants/routes";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { completeAccountOnboarding } from "@/services/authProfileService";

export default function CompleteAccountScreen() {
  const { t } = useTranslation();
  const { loading: authLoading, refreshProfile, user } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.displayName || firstName || lastName) return;
    const nameParts = user.displayName.trim().split(/\s+/u);
    setFirstName(nameParts.shift() ?? "");
    setLastName(nameParts.join(" "));
  }, [firstName, lastName, user?.displayName]);

  const submit = async () => {
    if (saving) return;
    if (!firstName.trim() || !lastName.trim() || !policiesAccepted || !adultConfirmed) {
      setError(t("auth.errors.accountCompletionRequired"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await completeAccountOnboarding({
        adultEligibilityConfirmed: adultConfirmed,
        firstName,
        lastName,
        policiesAccepted,
      });
      await refreshProfile();
      router.replace(CHOOSE_START_MODE_ROUTE as never);
    } catch {
      setError(t("auth.errors.accountCompletionFailed"));
      setSaving(false);
    }
  };

  if (authLoading) {
    return <ScreenWrapper><View style={styles.loading}><ActivityIndicator color={Colors.primary} /></View></ScreenWrapper>;
  }
  if (!user) return <Redirect href={SIGN_IN_ROUTE as never} />;
  if (user.accountOnboardingCompleted) {
    return <Redirect href={(user.modeOnboardingCompleted ? PARENT_HOME_ROUTE : CHOOSE_START_MODE_ROUTE) as never} />;
  }

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>{t("auth.completeAccountTitle")}</Text>
        <Text style={styles.body}>{t("auth.completeAccountBody")}</Text>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel={t("auth.firstName")}
            autoComplete="given-name"
            onChangeText={setFirstName}
            placeholder={t("auth.firstName")}
            style={[styles.input, styles.half]}
            value={firstName}
          />
          <TextInput
            accessibilityLabel={t("auth.lastName")}
            autoComplete="family-name"
            onChangeText={setLastName}
            placeholder={t("auth.lastName")}
            style={[styles.input, styles.half]}
            value={lastName}
          />
        </View>
        <LegalAssentControls
          adultConfirmed={adultConfirmed}
          onAdultConfirmedChange={setAdultConfirmed}
          onPoliciesAcceptedChange={setPoliciesAccepted}
          policiesAccepted={policiesAccepted}
        />
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        <PrimaryButton disabled={saving} loading={saving} onPress={() => void submit()} title={t("auth.continueAccountSetup")} />
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 22, textAlign: "center" },
  content: { flexGrow: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.lg, paddingBottom: Spacing.xl },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  half: { flex: 1, minWidth: 0 },
  input: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 52, paddingHorizontal: Spacing.md, ...Shadow.card },
  loading: { alignItems: "center", flex: 1, justifyContent: "center" },
  row: { flexDirection: "row", gap: Spacing.sm },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 32, lineHeight: 39, textAlign: "center" },
});

