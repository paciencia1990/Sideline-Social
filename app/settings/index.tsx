import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getNotificationPermissionStatus,
  requestNotificationPermissionAndRegister,
} from "@/services/notificationService";

export default function SettingsScreen() {
  const { t } = useTranslation();
  const [notificationStatus, setNotificationStatus] = useState<string>("undetermined");
  const [notificationBusy, setNotificationBusy] = useState(false);
  const appVersion = Constants.expoConfig?.version ?? "1.0.0";
  const buildNumber = Constants.expoConfig?.ios?.buildNumber;

  useEffect(() => {
    void getNotificationPermissionStatus().then(setNotificationStatus).catch(() => undefined);
  }, []);

  const enableNotifications = useCallback(async () => {
    if (notificationBusy) return;
    setNotificationBusy(true);
    try {
      const granted = await requestNotificationPermissionAndRegister();
      setNotificationStatus(granted ? "granted" : "denied");
    } finally {
      setNotificationBusy(false);
    }
  }, [notificationBusy]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <Text style={styles.title}>{t("settings.title")}</Text>
        <Text style={styles.subtitle}>{t("settings.subtitle")}</Text>

        <Card style={styles.card}>
          <Text style={styles.cardTitle}>{t("settings.notifications")}</Text>
          <Text style={styles.body}>{notificationStatus === "granted" ? t("settings.notificationsOn") : t("settings.notificationsOff")}</Text>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={notificationBusy}
            onPress={notificationStatus === "denied" ? () => Linking.openSettings() : enableNotifications}
            style={styles.action}
          >
            <Text style={styles.actionText}>{notificationStatus === "denied" ? t("settings.openSettings") : t("settings.enableNotifications")}</Text>
          </TouchableOpacity>
        </Card>

        <SettingsLink label={t("settings.signInMethods.title")} onPress={() => router.push("/settings/sign-in-methods" as never)} />
        <SettingsLink label={t("settings.privacyLegal")} onPress={() => router.push("/settings/legal" as never)} />
        <SettingsLink label={t("settings.blockedUsers")} onPress={() => router.push("/settings/blocked-users" as never)} />
        <SettingsLink destructive label={t("settings.deleteAccount")} onPress={() => router.push("/settings/delete-account" as never)} />
        <Text accessibilityLabel={t("settings.versionAccessibility", { version: appVersion, build: buildNumber ?? t("settings.buildPending") })} style={styles.version}>
          {t("settings.version", { version: appVersion, build: buildNumber ?? t("settings.buildPending") })}
        </Text>
      </ScrollView>
    </ScreenWrapper>
  );
}

function SettingsLink({ destructive = false, label, onPress }: { destructive?: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={onPress} style={styles.link}>
      <Text style={[styles.linkText, destructive && styles.destructive]}>{label}</Text>
      <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  action: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  actionText: { color: "#FFFFFF", fontFamily: Typography.bodySemiBold },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21 },
  card: { gap: Spacing.sm },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  chevron: { color: Colors.textPrimary, fontSize: 28 },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xl },
  destructive: { color: Colors.primary },
  link: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.card, flexDirection: "row", justifyContent: "space-between", minHeight: 56, paddingHorizontal: Spacing.md },
  linkText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  version: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, textAlign: "center" },
});
