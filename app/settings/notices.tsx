import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import noticePacket from "@/config/thirdPartyNotices.json";

export default function NoticesScreen() {
  const { t } = useTranslation();
  const [expandedNotice, setExpandedNotice] = useState<string | null>(null);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <Text accessibilityRole="header" style={styles.title}>{t("settings.noticesTitle")}</Text>
        <Text style={styles.introduction}>{t("settings.noticesOriginalLanguage")}</Text>
        {noticePacket.notices.map((notice) => {
          const expanded = expandedNotice === notice.id;
          return (
            <View key={notice.id} style={styles.section}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={notice.title + ", " + notice.license}
                accessibilityHint={t(expanded ? "settings.collapseNotice" : "settings.expandNotice")}
                accessibilityState={{ expanded }}
                onPress={() => setExpandedNotice(expanded ? null : notice.id)}
                style={styles.toggle}
              >
                <Text style={styles.sectionTitle}>{notice.title}</Text>
                <Text style={styles.license}>{notice.license}</Text>
              </TouchableOpacity>
              {expanded ? <Text selectable style={styles.noticeText}>{notice.text}</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xl },
  introduction: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 22 },
  license: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  noticeText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 22 },
  section: { backgroundColor: Colors.surface, borderRadius: Radius.card, gap: Spacing.sm, padding: Spacing.md },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  toggle: { gap: Spacing.xs, minHeight: 48, justifyContent: "center" },
});
