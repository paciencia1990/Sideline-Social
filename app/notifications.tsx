import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ArrowLeft, Bell, CheckCheck, Megaphone, UserCheck, UserPlus } from "lucide-react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { AuthenticatedRouteGate } from "@/components/AuthenticatedRouteGate";
import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  markAllNotificationsRead,
  markNotificationRead,
  subscribeToNotifications,
  type AppNotification,
} from "@/services/notificationService";
import { getNotificationDestination, isUnreadActiveNotification } from "@/utils/notificationCore";

export default function ProtectedNotificationInboxScreen() {
  return (
    <AuthenticatedRouteGate>
      <NotificationInboxScreen />
    </AuthenticatedRouteGate>
  );
}

function NotificationInboxScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!user?.uid) return;
    setLoading(true);
    setFailed(false);
    return subscribeToNotifications(
      user.uid,
      (items) => {
        setNotifications(items);
        setLoading(false);
        setFailed(false);
      },
      () => {
        setLoading(false);
        setFailed(true);
      },
    );
  }, [retryKey, user?.uid]);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => isUnreadActiveNotification(notification)).length,
    [notifications],
  );

  const openNotification = useCallback(async (notification: AppNotification) => {
    if (!user?.uid || openingId) return;
    setOpeningId(notification.id);
    try {
      if (isUnreadActiveNotification(notification)) {
        await markNotificationRead(user.uid, notification.id);
      }
      const destination = getNotificationDestination(notification);
      if (!destination) {
        Alert.alert(t("notifications.unavailableTitle"), t("notifications.unavailableBody"));
        return;
      }
      router.push(destination as never);
    } catch (error) {
      logInboxIssue("openNotification", error);
      Alert.alert(t("notifications.unavailableTitle"), t("notifications.unavailableBody"));
    } finally {
      setOpeningId(null);
    }
  }, [openingId, t, user?.uid]);

  const markAllRead = useCallback(async () => {
    if (!user?.uid || markingAll) return;
    setMarkingAll(true);
    try {
      await markAllNotificationsRead(user.uid);
    } catch (error) {
      logInboxIssue("markAllRead", error);
      Alert.alert(t("notifications.unavailableTitle"), t("notifications.markAllError"));
    } finally {
      setMarkingAll(false);
    }
  }, [markingAll, t, user?.uid]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)" as never);
  };

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <TouchableOpacity
          accessibilityLabel={t("common.back")}
          accessibilityRole="button"
          activeOpacity={0.82}
          onPress={goBack}
          style={styles.headerIcon}
        >
          <ArrowLeft color={Colors.textHeading} size={22} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t("notifications.title")}</Text>
        {unreadCount > 1 ? (
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.82}
            disabled={markingAll}
            onPress={() => void markAllRead()}
            style={styles.markAllButton}
          >
            {markingAll ? <ActivityIndicator color={Colors.primary} size="small" /> : null}
            <Text style={styles.markAllText}>{t("notifications.markAllRead")}</Text>
          </TouchableOpacity>
        ) : <View style={styles.headerSpacer} />}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.stateBody}>{t("notifications.loading")}</Text>
          </View>
        ) : failed ? (
          <View style={styles.centerState}>
            <Bell color={Colors.textPrimary} size={34} />
            <Text style={styles.stateTitle}>{t("notifications.loadErrorTitle")}</Text>
            <Text style={styles.stateBody}>{t("notifications.loadErrorBody")}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.82}
              onPress={() => setRetryKey((value) => value + 1)}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </View>
        ) : notifications.length === 0 ? (
          <View style={styles.centerState}>
            <CheckCheck color={Colors.accentGreen} size={42} />
            <Text style={styles.stateTitle}>{t("notifications.allCaughtUp")}</Text>
            <Text style={styles.stateBody}>{t("notifications.emptyBody")}</Text>
          </View>
        ) : (
          notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              language={i18n.language}
              loading={openingId === notification.id}
              notification={notification}
              onPress={() => void openNotification(notification)}
            />
          ))
        )}
      </ScrollView>
    </ScreenWrapper>
  );
}

function NotificationRow({
  language,
  loading,
  notification,
  onPress,
}: {
  language: string;
  loading: boolean;
  notification: AppNotification;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const unread = isUnreadActiveNotification(notification);
  const title = t(notification.titleKey, notification.params);
  const body = t(notification.bodyKey, notification.params);
  const timestamp = formatNotificationTimestamp(notification.createdAt, language, t);
  const stateLabel = unread ? t("notifications.unread") : t("notifications.read");

  return (
    <TouchableOpacity
      accessibilityLabel={`${stateLabel}. ${title}. ${body}. ${timestamp}`}
      accessibilityRole="button"
      activeOpacity={0.86}
      disabled={loading}
      onPress={onPress}
    >
      <Card style={[styles.notificationCard, unread && styles.unreadCard]}>
        <View style={styles.typeIcon}>{getTypeIcon(notification.type)}</View>
        <View style={styles.notificationCopy}>
          <View style={styles.titleRow}>
            <Text style={[styles.notificationTitle, unread && styles.unreadTitle]}>{title}</Text>
            {unread ? <Text style={styles.unreadLabel}>{stateLabel}</Text> : null}
          </View>
          <Text style={styles.notificationBody}>{body}</Text>
          <Text style={styles.notificationTime}>{timestamp}</Text>
        </View>
        {loading ? <ActivityIndicator color={Colors.primary} size="small" /> : null}
      </Card>
    </TouchableOpacity>
  );
}

function getTypeIcon(type: AppNotification["type"]) {
  if (type === "coachAnnouncement") return <Megaphone color={Colors.primary} size={20} />;
  if (type === "friendRequestAccepted") return <UserCheck color={Colors.accentGreen} size={20} />;
  return <UserPlus color={Colors.primary} size={20} />;
}

function formatNotificationTimestamp(date: Date, language: string, t: ReturnType<typeof useTranslation>["t"]) {
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  if (elapsedMinutes < 1) return t("notifications.justNow");
  if (elapsedMinutes < 60) return t("notifications.minutesAgo", { count: elapsedMinutes });
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t("notifications.hoursAgo", { count: elapsedHours });
  if (elapsedHours < 48) return t("notifications.yesterday");
  if (elapsedHours < 168) return t("notifications.daysAgo", { count: Math.floor(elapsedHours / 24) });
  return date.toLocaleDateString(language, { day: "numeric", month: "short", year: "numeric" });
}

function logInboxIssue(operation: string, error: unknown) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.warn("[NotificationInbox] operation failed", { operation, code });
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    borderBottomColor: Colors.secondary,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: 60,
    paddingHorizontal: Spacing.md,
  },
  headerIcon: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  headerTitle: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodyBold,
    fontSize: 20,
    textAlign: "center",
  },
  headerSpacer: { width: 84 },
  markAllButton: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
    minHeight: 44,
    minWidth: 84,
  },
  markAllText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    textAlign: "right",
  },
  content: {
    flexGrow: 1,
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  centerState: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.sm,
    justifyContent: "center",
    minHeight: 320,
    paddingHorizontal: Spacing.lg,
  },
  stateTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyBold,
    fontSize: 19,
    textAlign: "center",
  },
  stateBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
  },
  retryButton: {
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  retryText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
  },
  notificationCard: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.sm,
    minHeight: 96,
  },
  unreadCard: {
    borderLeftColor: Colors.primary,
    borderLeftWidth: 4,
  },
  typeIcon: {
    alignItems: "center",
    backgroundColor: Colors.background,
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  notificationCopy: {
    flex: 1,
    gap: Spacing.xs,
    minWidth: 0,
  },
  titleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  notificationTitle: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodyMedium,
    fontSize: 15,
    lineHeight: 20,
  },
  unreadTitle: { fontFamily: Typography.bodyBold },
  unreadLabel: {
    color: Colors.primary,
    fontFamily: Typography.bodyBold,
    fontSize: 10,
    textTransform: "uppercase",
  },
  notificationBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  notificationTime: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 11,
  },
});
