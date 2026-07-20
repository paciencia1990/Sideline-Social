import { ScrollView, StyleSheet, Text, TouchableOpacity, View, Linking } from "react-native";
import { useTranslation } from "react-i18next";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, SUPPORT_URL, TERMS_OF_USE_URL } from "@/config/legal";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";

export default function LegalScreen() {
  const { t } = useTranslation();
  const openSupport = () => {
    const destination = SUPPORT_URL ?? (SUPPORT_EMAIL ? `mailto:${SUPPORT_EMAIL}` : null);
    if (destination) void Linking.openURL(destination);
  };

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("settings.privacyLegal")}</Text>
        <LegalSection title={t("settings.privacyTitle")} body={t("settings.privacyBody")} url={PRIVACY_POLICY_URL} linkLabel={t("settings.openFullPolicy")} />
        <LegalSection title={t("settings.termsTitle")} body={t("settings.termsBody")} url={TERMS_OF_USE_URL} linkLabel={t("settings.openTerms")} />
        <LegalSection title={t("settings.communityTitle")} body={t("settings.communityBody")} />
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("settings.supportTitle")}</Text>
          <Text style={styles.body}>{SUPPORT_URL || SUPPORT_EMAIL ? t("settings.supportBody") : t("settings.supportPending")}</Text>
          {SUPPORT_URL || SUPPORT_EMAIL ? (
            <TouchableOpacity accessibilityRole="link" onPress={openSupport} style={styles.linkButton}>
              <Text style={styles.linkText}>{t("settings.contactSupport")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>
    </ScreenWrapper>
  );
}

function LegalSection({ body, linkLabel, title, url }: { body: string; linkLabel?: string; title: string; url?: string | null }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {url && linkLabel ? (
        <TouchableOpacity accessibilityRole="link" onPress={() => void Linking.openURL(url)} style={styles.linkButton}>
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
