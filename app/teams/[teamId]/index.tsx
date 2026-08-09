import React, { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ArrowLeft, ChevronRight, LockKeyhole, Mail, MoreVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ChildProfilePicker } from "@/components/ChildProfilePicker";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { VoiceMemoPlayer, VoiceMemoUnavailable } from "@/components/VoiceMemoPlayer";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getCoachUpdateRoute,
  getParentTeamSummary,
  getTeamChildNames,
  type ParentTeamSummary,
} from "@/services/parentTeamService";

import { setParentTeamChildLinks } from "@/services/childService";
import { acknowledgeNotificationAfterOpen } from "@/services/notificationService";
import { hasCoachAccess, leaveParentTeam } from "@/services/teamService";

type TeamAction = "remove-child" | "leave" | null;

export default function ParentTeamHubScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[]; notificationId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const notificationId = normalizeParam(params.notificationId);
  const acknowledgedNotificationIds = useRef(new Set<string>());
  const [summary, setSummary] = useState<ParentTeamSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [savingChild, setSavingChild] = useState(false);
  const [teamAction, setTeamAction] = useState<TeamAction>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const nextSummary = await getParentTeamSummary(teamId);
      setSummary(nextSummary);
      setSelectedChildIds(nextSummary.children.map((child) => child.id));
      if (notificationId && !acknowledgedNotificationIds.current.has(notificationId)) {
        acknowledgedNotificationIds.current.add(notificationId);
        void acknowledgeNotificationAfterOpen(notificationId);
      }
    } catch (nextError) {
      console.warn("[ParentTeamHub] load error:", getErrorCode(nextError));
      setSummary(null);
      setError(t("myTeams.teamLoadError"));
    } finally {
      setLoading(false);
    }
  }, [notificationId, t, teamId]);

  useFocusEffect(useCallback(() => {
    void loadTeam();
  }, [loadTeam]));

  const saveChildLinks = useCallback(async () => {
    setSavingChild(true);
    setError(null);
    try {
      await setParentTeamChildLinks(teamId, selectedChildIds);
      await loadTeam();
    } catch (nextError) {
      console.warn("[ParentTeamHub] child update error:", getErrorCode(nextError));
      setError(t("myTeams.childUpdateError"));
    } finally {
      setSavingChild(false);
    }
  }, [loadTeam, selectedChildIds, t, teamId]);

  const openManageChildren = useCallback(() => {
    router.push({ pathname: "/teams/[teamId]/children", params: { teamId } } as never);
  }, [teamId]);

  const removeOnlyChild = useCallback(async () => {
    if (!summary || teamAction) return;
    setTeamAction("remove-child");
    setError(null);
    setFeedback(null);
    try {
      await setParentTeamChildLinks(teamId, []);
      await loadTeam();
      setFeedback(t("myTeams.childRemovedSuccess"));
    } catch (nextError) {
      console.warn("[ParentTeamHub] remove child error:", getErrorCode(nextError));
      setError(t("myTeams.membershipUpdateError"));
    } finally {
      setTeamAction(null);
    }
  }, [loadTeam, summary, t, teamAction, teamId]);

  const confirmRemoveOnlyChild = useCallback(() => {
    const child = summary?.children[0];
    if (!summary || !child || teamAction) return;
    Alert.alert(
      t("myTeams.removeChildTitle", { childName: child.displayName, teamName: summary.team.name }),
      t("myTeams.removeChildBody", { childName: child.displayName }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("myTeams.removeChild"),
          style: "destructive",
          onPress: () => { void removeOnlyChild(); },
        },
      ],
    );
  }, [removeOnlyChild, summary, t, teamAction]);

  const performLeave = useCallback(async () => {
    if (!summary || teamAction) return;
    setTeamAction("leave");
    setError(null);
    try {
      await leaveParentTeam(teamId);
      router.dismissAll();
      router.replace("/teams" as never);
    } catch (nextError) {
      console.warn("[ParentTeamHub] leave error:", getErrorCode(nextError));
      setError(t("myTeams.leaveError"));
      setTeamAction(null);
    }
  }, [summary, t, teamAction, teamId]);

  const confirmLeave = useCallback(() => {
    if (!summary || teamAction) return;
    Alert.alert(
      t("myTeams.leaveTitle", { teamName: summary.team.name }),
      hasCoachAccess(summary.membership)
        ? t("myTeams.leaveMultiRoleBody")
        : t("myTeams.leaveParentOnlyBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("myTeams.leaveTeam"),
          style: "destructive",
          onPress: () => { void performLeave(); },
        },
      ],
    );
  }, [performLeave, summary, t, teamAction]);

  const openTeamActions = useCallback(() => {
    if (!summary || teamAction) return;
    const actions = summary.children.length === 1
      ? [{ text: t("myTeams.removeChildFromTeam", { childName: summary.children[0].displayName }), onPress: confirmRemoveOnlyChild }]
      : [{ text: t("myTeams.manageChildren"), onPress: openManageChildren }];
    Alert.alert(
      t("myTeams.teamActions"),
      undefined,
      [
        { text: t("common.cancel"), style: "cancel" },
        ...actions,
        { text: t("myTeams.leaveTeam"), style: "destructive", onPress: confirmLeave },
      ],
    );
  }, [confirmLeave, confirmRemoveOnlyChild, openManageChildren, summary, t, teamAction]);
  const details = summary
    ? [summary.team.sport, summary.team.season || summary.team.division || summary.team.ageRange].filter(Boolean).join(" · ")
    : "";

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity accessibilityLabel={t("myTeams.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{summary?.team.name ?? t("myTeams.team")}</Text>
            <Text style={styles.subtitle}>{summary ? formatTeamChildren(summary, t) : t("myTeams.childNotSpecified")}</Text>
          </View>
          {summary ? (
            <TouchableOpacity
              accessibilityLabel={teamAction === "remove-child"
                ? t("myTeams.removingChild")
                : teamAction === "leave"
                  ? t("myTeams.leaving")
                  : t("myTeams.teamActions")}
              accessibilityRole="button"
              disabled={Boolean(teamAction)}
              onPress={openTeamActions}
              style={styles.headerIcon}
            >
              {teamAction
                ? <ActivityIndicator color={Colors.primary} size="small" />
                : <MoreVertical color={Colors.primary} size={22} />}
            </TouchableOpacity>
          ) : <View style={styles.headerSpacer} />}
        </View>

        {loading && !summary ? (
          <Card style={styles.stateCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("myTeams.loadingTeam")}</Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={[styles.stateCard, styles.errorCard]}>
            <Text style={styles.stateTitle}>{t("myTeams.teamUnavailable")}</Text>
            <Text style={styles.cardText}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={loadTeam} style={styles.outlineButton}>
              <Text style={styles.outlineButtonText}>{t("myTeams.tryAgain")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {feedback ? (
          <Card style={styles.feedbackCard}>
            <Text accessibilityLiveRegion="polite" style={styles.feedbackText}>{feedback}</Text>
          </Card>
        ) : null}

        {teamAction ? (
          <Card style={styles.actionStateCard}>
            <ActivityIndicator color={Colors.primary} size="small" />
            <Text accessibilityLiveRegion="polite" style={styles.cardText}>
              {teamAction === "remove-child" ? t("myTeams.removingChild") : t("myTeams.leaving")}
            </Text>
          </Card>
        ) : null}

        {summary ? (
          <>
            <Card style={styles.teamHeaderCard}>
              <View style={styles.identityRow}>
                <Text style={styles.childLabel}>{t("myTeams.child")}</Text>
                <Text style={styles.childName}>{formatTeamChildren(summary, t)}</Text>
              </View>
              <Text style={styles.teamName}>{summary.team.name}</Text>
              {details ? <Text style={styles.teamDetails}>{details}</Text> : null}
              <View style={styles.factGrid}>
                <Fact label={t("myTeams.sport")} value={summary.team.sport} />
                {summary.team.season ? <Fact label={t("myTeams.season")} value={summary.team.season} /> : null}
                {summary.team.division ? <Fact label={t("myTeams.division")} value={summary.team.division} /> : null}
                <Fact label={t("myTeams.coach")} value={summary.coachName ?? t(summary.coachProfileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember")} />
              </View>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={Boolean(teamAction)}
                onPress={openManageChildren}
                style={styles.outlineButton}
              >
                <Text style={styles.outlineButtonText}>{t("myTeams.manageChildren")}</Text>
              </TouchableOpacity>
            </Card>

            {summary.needsChildMigration ? (
              <Card style={styles.assignChildCard}>
                <Text style={styles.stateTitle}>{t("myTeams.confirmChildrenTitle")}</Text>
                <Text style={styles.cardText}>
                  {t("myTeams.confirmChildrenBody", { legacyName: summary.legacyChildName ?? "" })}
                </Text>
                <ChildProfilePicker onChange={setSelectedChildIds} selectedIds={selectedChildIds} />
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={savingChild || selectedChildIds.length === 0}
                  onPress={saveChildLinks}
                  style={[styles.primaryButton, (savingChild || selectedChildIds.length === 0) && styles.disabledButton]}
                >
                  {savingChild
                    ? <ActivityIndicator color={Colors.surface} />
                    : <Text style={styles.primaryButtonText}>{t("myTeams.confirmChildren")}</Text>}
                </TouchableOpacity>
              </Card>
            ) : null}

            <View style={styles.sectionHeader}>
              <View>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t("teamMessages.title")}</Text>
                <Text style={styles.sectionSubtitle}>{t("teamMessages.parentSectionSubtitle")}</Text>
              </View>
              {summary.privateUnreadCount > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{summary.privateUnreadCount}</Text></View> : null}
            </View>

            {summary.privateConversations.length === 0 ? (
              <Card style={styles.stateCard}>
                <LockKeyhole color={Colors.secondary} size={28} />
                <Text style={styles.stateTitle}>{t("teamMessages.parentEmpty")}</Text>
                <Text style={styles.cardText}>{t("teamMessages.parentEmptyBody")}</Text>
              </Card>
            ) : summary.privateConversations.map((conversation) => (
              <TouchableOpacity
                accessibilityRole="button"
                key={conversation.conversationId}
                onPress={() => router.push({ pathname: "/teams/[teamId]/messages/[conversationId]", params: { teamId, conversationId: conversation.conversationId } } as never)}
              >
                <Card style={[styles.announcementCard, conversation.unreadCount > 0 && styles.announcementUnread]}>
                  <View style={styles.announcementTopRow}>
                    <LockKeyhole color={Colors.primary} size={20} />
                    <View style={styles.announcementCopy}>
                      <Text style={styles.announcementTitle}>{conversation.coachDisplayName || t(conversation.coachProfileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember")}</Text>
                      <Text numberOfLines={2} style={styles.announcementBody}>{conversation.lastMessageType === "voice" ? t("teamMessages.voicePreview") : conversation.lastMessageType === "deleted" ? t("teamMessages.messageDeleted") : conversation.lastMessagePreview || t("teamMessages.noMessagesYet")}</Text>
                    </View>
                    <ChevronRight color={Colors.textPrimary} size={20} />
                  </View>
                  {conversation.unreadCount > 0 ? <Text style={styles.announcementMeta}>{t("teamMessages.unread", { count: conversation.unreadCount })}</Text> : null}
                </Card>
              </TouchableOpacity>
            ))}

            <View style={styles.sectionHeader}>
              <View>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t("myTeams.coachUpdates")}</Text>
                <Text style={styles.sectionSubtitle}>
                  {summary.unreadCount > 0
                    ? t("myTeams.unreadUpdates", { count: summary.unreadCount })
                    : t("myTeams.caughtUp")}
                </Text>
              </View>
              {summary.unreadCount > 0 ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{summary.unreadCount}</Text>
                </View>
              ) : null}
            </View>

            {summary.announcements.length === 0 ? (
              <Card style={styles.stateCard}>
                <Mail color={Colors.secondary} size={30} />
                <Text style={styles.stateTitle}>{t("myTeams.noUpdates")}</Text>
                <Text style={styles.cardText}>{t("myTeams.noUpdatesBody")}</Text>
              </Card>
            ) : summary.announcements.map((announcement) => (
              <TouchableOpacity
                accessibilityLabel={t("myTeams.openUpdate")}
                accessibilityRole="button"
                activeOpacity={0.86}
                key={announcement.id}
                onPress={() => router.push(getCoachUpdateRoute(
                  summary.teamId,
                  announcement.id,
                  summary.childId,
                  summary.childName,
                ) as never)}
              >
                <Card style={[styles.announcementCard, !announcement.isRead && styles.announcementUnread]}>
                  <View style={styles.announcementTopRow}>
                    <View style={[styles.readDot, announcement.isRead && styles.readDotRead]} />
                    <View style={styles.announcementCopy}>
                      {announcement.isDeleted
                        ? <Text style={styles.announcementTitle}>{t("teamMessages.messageDeleted")}</Text>
                        : announcement.title
                          ? <Text style={styles.announcementTitle}>{announcement.title}</Text>
                          : null}
                      {!announcement.isDeleted && announcement.contentType === "voice" ? <Text style={styles.voiceLabel}>{t("teamMessages.voicePreview")}</Text> : null}
                      <Text numberOfLines={3} style={styles.announcementBody}>{announcement.isDeleted ? t("teamMessages.messageDeleted") : announcement.body}</Text>
                    </View>
                    <ChevronRight color={Colors.textPrimary} size={20} />
                  </View>
                  <View style={styles.announcementMetaRow}>
                    <Text style={styles.announcementMeta}>{announcement.createdByName || t(announcement.authorProfileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember")}</Text>
                    <Text style={styles.announcementMeta}>{formatUpdateTime(announcement.createdAtDate, i18n.language)}</Text>
                    <Text style={styles.announcementMeta}>
                      {announcement.allowReplies ? t("myTeams.repliesEnabled") : t("myTeams.repliesDisabledShort")}
                    </Text>
                  </View>
                  {!announcement.isDeleted && announcement.contentType === "voice" && announcement.voiceMemo ? (
                    <VoiceMemoPlayer
                      durationMilliseconds={announcement.voiceMemo.durationMilliseconds}
                      source={{
                        kind: "persisted-message",
                        messageId: announcement.id,
                        messageKind: "announcement",
                        storagePath: announcement.voiceMemo.storagePath,
                      }}
                    />
                  ) : !announcement.isDeleted && announcement.contentType === "voice" ? <VoiceMemoUnavailable /> : null}
                </Card>
              </TouchableOpacity>
            ))}
          </>
        ) : null}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function formatTeamChildren(
  summary: ParentTeamSummary,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const names = getTeamChildNames(summary);
  if (names.length === 0) return t("myTeams.childNotSpecified");
  if (names.length === 1) return names[0];
  if (names.length === 2) return t("myTeams.twoChildrenNames", { first: names[0], second: names[1] });
  return t("myTeams.childrenCount", { count: names.length });
}

function Fact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function formatUpdateTime(date: Date | null, locale: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  headerCopy: { flex: 1 },
  backButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  headerIcon: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  headerSpacer: { height: 44, width: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 28 },
  subtitle: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  errorCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4 },
  feedbackCard: { borderLeftColor: Colors.accentGreen, borderLeftWidth: 4 },
  feedbackText: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  actionStateCard: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "center" },
  stateTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  outlineButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  assignChildCard: { gap: Spacing.sm },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  disabledButton: { opacity: 0.55 },
  teamHeaderCard: { borderLeftColor: Colors.textHeading, borderLeftWidth: 4, gap: Spacing.sm },
  identityRow: { alignItems: "baseline", flexDirection: "row", gap: Spacing.sm },
  childLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  childName: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 22 },
  teamName: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 20 },
  teamDetails: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  factGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  fact: { backgroundColor: Colors.background, borderRadius: Radius.sm, minWidth: "46%", padding: Spacing.sm },
  factLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 10, textTransform: "uppercase" },
  factValue: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13 },
  sectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 23 },
  sectionSubtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  badge: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 14, minWidth: 28, paddingHorizontal: 8, paddingVertical: 4 },
  badgeText: { color: Colors.surface, fontFamily: Typography.bodyBold },
  announcementCard: { borderLeftColor: Colors.secondary, borderLeftWidth: 4, gap: Spacing.sm },
  announcementUnread: { borderLeftColor: Colors.accentGold },
  announcementTopRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  announcementCopy: { flex: 1, gap: 3 },
  readDot: { backgroundColor: Colors.accentGold, borderRadius: 5, height: 10, width: 10 },
  readDotRead: { backgroundColor: Colors.secondary },
  announcementTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 16 },
  voiceLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  announcementBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 },
  announcementMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, paddingLeft: 18 },
  announcementMeta: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 11 },
});
