import React, { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { usePathname, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";

import DeleteAccountScreen from "@/app/settings/delete-account";
import LegalScreen from "@/app/settings/legal";
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, SUPPORT_URL, TERMS_OF_USE_URL } from "@/config/legal";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAccountStanding } from "@/context/AccountStandingContext";
import { useAuth } from "@/context/AuthContext";
import { submitAccountStandingAppeal } from "@/services/accountStandingService";

export function AccountStandingBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { firebaseUser, loading: authLoading } = useAuth();
  const standingState = useAccountStanding();

  if (authLoading || (firebaseUser && standingState.loading)) {
    return <CenteredLoading />;
  }
  if (!firebaseUser) return children;
  if (standingState.error || !standingState.standing) {
    return <StandingNotice kind="refresh" />;
  }

  const status = standingState.standing.status;
  if (status === "suspended" || status === "banned") {
    if (pathname === "/settings/legal") return <LegalScreen />;
    if (pathname === "/settings/delete-account") return <DeleteAccountScreen />;
    return <StandingNotice kind={status} />;
  }
  if (
    status === "messagingRestricted" &&
    standingState.acknowledgedRevision !== standingState.standing.revision
  ) {
    return <StandingNotice kind="messagingRestricted" />;
  }
  return children;
}

function CenteredLoading() {
  return (
    <SafeAreaView style={styles.center}>
      <ActivityIndicator color={Colors.primary} size="large" />
    </SafeAreaView>
  );
}

function StandingNotice({
  kind,
}: {
  kind: "refresh" | "messagingRestricted" | "suspended" | "banned";
}) {
  const { i18n, t } = useTranslation();
  const router = useRouter();
  const { signOut } = useAuth();
  const standingState = useAccountStanding();
  const standing = standingState.standing;
  const [explanation, setExplanation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const title = t(`accountStanding.${kind}.title`);
  const body = t(`accountStanding.${kind}.body`);
  const showRestrictionDetails = kind !== "refresh" && standing !== null;
  const reason = showRestrictionDetails
    ? t(`accountStanding.reasons.${standing.publicReasonCode}`, {
        defaultValue: t("accountStanding.reasons.communityGuidelines"),
      })
    : null;
  const effective = showRestrictionDetails && standing.effectiveAt
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(standing.effectiveAt))
    : null;
  const expiration = showRestrictionDetails && standing.expiresAt
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(standing.expiresAt))
    : null;

  const submitAppeal = async () => {
    if (!standing) return;
    setSubmitting(true);
    try {
      await submitAccountStandingAppeal(explanation.trim(), standing.revision);
      setExplanation("");
      await standingState.refresh();
      Alert.alert(t("accountStanding.appeal.confirmTitle"), t("accountStanding.appeal.confirmBody"));
    } catch {
      Alert.alert(t("accountStanding.appeal.errorTitle"), t("accountStanding.appeal.errorBody"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View accessibilityRole="summary" style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {reason ? <Text style={styles.detail}>{t("accountStanding.publicReason", { reason })}</Text> : null}
          {effective ? <Text style={styles.detail}>{t("accountStanding.effective", { date: effective })}</Text> : null}
          {expiration ? <Text style={styles.detail}>{t("accountStanding.expires", { date: expiration })}</Text> : null}
        </View>

        {standing?.appeal.status === "submitted" ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {t("accountStanding.appeal.pending")}
          </Text>
        ) : null}
        {standing?.appeal.status === "resolved" ? (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {t("accountStanding.appeal.resolved")}
          </Text>
        ) : null}
        {standing?.appeal.available ? (
          <View style={styles.card}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              {t("accountStanding.appeal.title")}
            </Text>
            <TextInput
              accessibilityLabel={t("accountStanding.appeal.inputLabel")}
              multiline
              maxLength={1500}
              onChangeText={setExplanation}
              placeholder={t("accountStanding.appeal.placeholder")}
              style={styles.input}
              textAlignVertical="top"
              value={explanation}
            />
            <ActionButton
              disabled={submitting || explanation.trim().length < 20}
              label={submitting ? t("common.loading") : t("accountStanding.appeal.submit")}
              onPress={() => void submitAppeal()}
            />
          </View>
        ) : null}

        {kind === "refresh" ? (
          <ActionButton label={t("common.retry")} onPress={() => void standingState.refresh()} />
        ) : null}
        {kind === "messagingRestricted" ? (
          <ActionButton label={t("accountStanding.continue")} onPress={standingState.acknowledge} />
        ) : null}
        <ActionButton
          label={t("accountStanding.support")}
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        />
        {SUPPORT_URL ? <LinkButton label={t("settings.contactSupport")} url={SUPPORT_URL} /> : null}
        {PRIVACY_POLICY_URL ? <LinkButton label={t("settings.openFullPolicy")} url={PRIVACY_POLICY_URL} /> : null}
        {TERMS_OF_USE_URL ? <LinkButton label={t("settings.openTerms")} url={TERMS_OF_USE_URL} /> : null}
        <ActionButton label={t("accountStanding.legal")} onPress={() => router.push("/settings/legal" as never)} />
        <ActionButton label={t("accountStanding.deleteAccount")} onPress={() => router.push("/settings/delete-account" as never)} />
        <ActionButton label={t("accountStanding.signOut")} onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton({
  disabled = false,
  label,
  onPress,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function LinkButton({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={styles.link}>
      <Text style={styles.linkText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 16, lineHeight: 24 },
  button: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, minHeight: 48, justifyContent: "center", paddingHorizontal: Spacing.md },
  buttonText: { color: "#FFFFFF", fontFamily: Typography.bodySemiBold, textAlign: "center" },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, gap: Spacing.sm, padding: Spacing.lg },
  center: { alignItems: "center", backgroundColor: Colors.background, flex: 1, justifyContent: "center" },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xl },
  detail: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, lineHeight: 22 },
  disabled: { opacity: 0.5 },
  input: { borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, color: Colors.textPrimary, fontFamily: Typography.bodyRegular, minHeight: 120, padding: Spacing.md },
  link: { alignItems: "center", minHeight: 48, justifyContent: "center" },
  linkText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center", textDecorationLine: "underline" },
  safe: { backgroundColor: Colors.background, flex: 1 },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 20 },
  status: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30, lineHeight: 38 },
});
