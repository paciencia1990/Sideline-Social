import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, SUPPORT_URL, TERMS_OF_USE_URL } from "@/config/legal";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

export default function LegalScreen() {
  const { t } = useTranslation();
  const privacyPolicyUrl = PRIVACY_POLICY_URL;
  const termsOfUseUrl = TERMS_OF_USE_URL;
  const openExternalLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("settings.linkErrorTitle"), t("settings.linkErrorBody"));
    }
  };

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <Text style={styles.title}>{t("settings.privacyLegal")}</Text>
        <LegalSection title={t("settings.privacyTitle")} body={t("settings.privacyBody")} onOpen={privacyPolicyUrl ? () => void openExternalLink(privacyPolicyUrl) : undefined} linkLabel={t("settings.openFullPolicy")} />
        <LegalSection title={t("settings.termsTitle")} body={t("settings.termsBody")} onOpen={termsOfUseUrl ? () => void openExternalLink(termsOfUseUrl) : undefined} linkLabel={t("settings.openTerms")} />
        <LegalSection title={t("settings.communityTitle")} body={t("settings.communityBody")} />
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings.supportTitle")}</Text>
          <Text style={styles.body}>{t("settings.supportBody")}</Text>
          <TouchableOpacity
            accessibilityLabel={t("settings.supportEmailAccessibility", { email: SUPPORT_EMAIL })}
            accessibilityRole="link"
            onPress={() => void openExternalLink(`mailto:${SUPPORT_EMAIL}`)}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>{t("settings.supportEmail", { email: SUPPORT_EMAIL })}</Text>
          </TouchableOpacity>
          {SUPPORT_URL ? (
            <TouchableOpacity
              accessibilityRole="link"
              onPress={() => {
                if (SUPPORT_URL) void openExternalLink(SUPPORT_URL);
              }}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>{t("settings.contactSupport")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function LegalSection({ body, linkLabel, onOpen, title }: { body: string; linkLabel?: string; onOpen?: () => void; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {onOpen && linkLabel ? (
        <TouchableOpacity accessibilityRole="link" onPress={onOpen} style={styles.linkButton}>
          <Text style={styles.linkText}>{linkLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 22 },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xl },
  linkButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  linkText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.card, gap: Spacing.sm, padding: Spacing.md },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
});
