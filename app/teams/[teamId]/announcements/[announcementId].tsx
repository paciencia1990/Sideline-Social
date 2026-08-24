import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Keyboard, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, MessageCircle, MoreVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { MessageActionsModal, type MessageModalAction, type MessageReportReason } from "@/components/MessageActionsModal";
import { MessageKeyboardAwareScrollView } from "@/components/MessageKeyboardAwareScrollView";
import { VoiceMemoPlayer, VoiceMemoUnavailable } from "@/components/VoiceMemoPlayer";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { auth } from "@/config/firebase";
import { QUICK_REPLY_IDS, QUICK_REPLY_TRANSLATION_KEYS, type QuickReplyId } from "@/constants/teamReplies";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getParentTeamSummary,
  markTeamAnnouncementRead,
  getTeamChildNames,
  type ParentTeamSummary,
} from "@/services/parentTeamService";
import {
  deleteAnnouncementReply,
  getOlderAnnouncementRepliesPage,
  getTeamAnnouncement,
  listenToNewestAnnouncementRepliesPage,
  listenToTeamAnnouncement,
  replyToAnnouncement,
  type AnnouncementReply,
  type TeamAnnouncement,
} from "@/services/teamMessageService";
import type { TeamHistoryCursor } from "@/constants/teamHistoryPagination";
import { acknowledgeNotificationAfterOpen } from "@/services/notificationService";
import { submitModerationReport } from "@/services/moderationReportService";

type MessageActionTarget =
  | { contentId: string; kind: "announcement"; mine: false }
  | { kind: "announcementReply"; mine: boolean; reply: AnnouncementReply };

export default function ParentAnnouncementScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{
    teamId?: string | string[];
    announcementId?: string | string[];
    notificationId?: string | string[];
  }>();
  const teamId = normalizeParam(params.teamId);
  const announcementId = normalizeParam(params.announcementId);
  const notificationId = normalizeParam(params.notificationId);
  const [summary, setSummary] = useState<ParentTeamSummary | null>(null);
  const [announcement, setAnnouncement] = useState<TeamAnnouncement | null>(null);
  const [replies, setReplies] = useState<AnnouncementReply[]>([]);
  const [replyCursor, setReplyCursor] = useState<TeamHistoryCursor | null>(null);
  const [hasOlderReplies, setHasOlderReplies] = useState(false);
  const [loadingOlderReplies, setLoadingOlderReplies] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingQuickReplyId, setSendingQuickReplyId] = useState<QuickReplyId | null>(null);
  const [actionTarget, setActionTarget] = useState<MessageActionTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const replySubmissionInFlight = useRef(false);
  const replyDeletionInFlight = useRef(false);
  const replyPageInFlight = useRef(false);
  const acknowledgedNotificationIds = useRef(new Set<string>());
  const keyboardTopRef = useRef<number | null>(null);
  const composerBoundaryRef = useRef<View>(null);
  const composerKeyboardOverlapRef = useRef(0);
  const [composerKeyboardOverlap, setComposerKeyboardOverlap] = useState(0);

  const updateComposerKeyboardOverlap = useCallback(() => {
    if (Platform.OS !== "android") return;
    const keyboardTop = keyboardTopRef.current;
    if (keyboardTop == null) return;
    requestAnimationFrame(() => {
      composerBoundaryRef.current?.measureInWindow((_x, y, _width, height) => {
        const unadjustedBottom = y + height + composerKeyboardOverlapRef.current;
        const nextOverlap = Math.max(0, unadjustedBottom - keyboardTop);
        if (Math.abs(nextOverlap - composerKeyboardOverlapRef.current) < 0.5) return;
        composerKeyboardOverlapRef.current = nextOverlap;
        setComposerKeyboardOverlap(nextOverlap);
      });
    });
  }, []);

  const loadAnnouncement = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextAnnouncement] = await Promise.all([
        getParentTeamSummary(teamId),
        getTeamAnnouncement(teamId, announcementId, { throwOnError: true }),
      ]);
      if (!nextAnnouncement) {
        setSummary(nextSummary);
        setAnnouncement(null);
        setError(t("myTeams.announcementUnavailable"));
        return;
      }
      setSummary(nextSummary);
      setAnnouncement(nextAnnouncement);
      if (notificationId && !acknowledgedNotificationIds.current.has(notificationId)) {
        acknowledgedNotificationIds.current.add(notificationId);
        void acknowledgeNotificationAfterOpen(notificationId);
      }
      try {
        await markTeamAnnouncementRead(teamId, announcementId);
      } catch (readError) {
        console.warn("[ParentAnnouncement] mark read error:", readError);
      }
    } catch (nextError) {
      console.warn("[ParentAnnouncement] load error:", nextError);
      setSummary(null);
      setAnnouncement(null);
      setError(t("myTeams.announcementLoadError"));
    } finally {
      setLoading(false);
    }
  }, [announcementId, notificationId, t, teamId]);

  useEffect(() => {
    void loadAnnouncement();
  }, [loadAnnouncement]);

  useEffect(() => {
    if (Platform.OS !== "android") return () => {};
    const showSubscription = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboardTopRef.current = event.endCoordinates.screenY;
      updateComposerKeyboardOverlap();
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      keyboardTopRef.current = null;
      composerKeyboardOverlapRef.current = 0;
      setComposerKeyboardOverlap(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [updateComposerKeyboardOverlap]);

  useEffect(() => {
    if (!teamId || !announcementId) return () => {};
    return listenToTeamAnnouncement(
      teamId,
      announcementId,
      (nextAnnouncement) => {
        setAnnouncement(nextAnnouncement);
        if (!nextAnnouncement) {
          setReplies([]);
          setError(t("myTeams.announcementUnavailable"));
        }
      },
      () => setError(t("myTeams.announcementLoadError")),
    );
  }, [announcementId, t, teamId]);

  useEffect(() => {
    if (!announcement?.id) {
      setReplies([]);
      return () => {};
    }
    if (!teamId || !announcementId) return () => {};
    setReplies([]);
    setReplyCursor(null);
    return listenToNewestAnnouncementRepliesPage(
      teamId,
      announcementId,
      "team",
      (page) => {
        setReplies((current) => mergeReplies(current, page.items));
        setReplyCursor((current) => current ?? page.nextCursor);
        setHasOlderReplies(page.hasMore);
      },
      (replyError) => {
        logOperationError("listenReplies", replyError);
        setError(t("myTeams.repliesLoadError"));
      },
    );
  }, [announcement?.id, announcementId, t, teamId]);

  const loadOlderReplies = useCallback(async () => {
    if (!replyCursor || !hasOlderReplies || replyPageInFlight.current) return;
    replyPageInFlight.current = true;
    setLoadingOlderReplies(true);
    try {
      const page = await getOlderAnnouncementRepliesPage(teamId, announcementId, "team", replyCursor);
      setReplies((current) => mergeReplies(page.items, current));
      setReplyCursor(page.nextCursor);
      setHasOlderReplies(page.hasMore);
    } catch (replyError) {
      logOperationError("loadOlderReplies", replyError);
      setError(t("myTeams.repliesLoadError"));
    } finally {
      replyPageInFlight.current = false;
      setLoadingOlderReplies(false);
    }
  }, [announcementId, hasOlderReplies, replyCursor, t, teamId]);

  const sendReply = useCallback(async () => {
    if (!replyBody.trim() || !announcement?.allowReplies || summary?.team.status !== "active" || replySubmissionInFlight.current) return;
    replySubmissionInFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const reply = await replyToAnnouncement(teamId, announcementId, replyBody.trim(), "team");
      setReplies((current) => appendReply(current, reply));
      setReplyBody("");
    } catch (nextError) {
      logOperationError("createReply", nextError);
      setError(t("myTeams.replyError"));
    } finally {
      replySubmissionInFlight.current = false;
      setSending(false);
    }
  }, [announcement?.allowReplies, announcementId, replyBody, summary?.team.status, t, teamId]);

  const sendQuickReply = useCallback(async (quickReplyId: QuickReplyId) => {
    if (!announcement?.allowReplies || summary?.team.status !== "active" || replySubmissionInFlight.current) return;
    replySubmissionInFlight.current = true;
    setSendingQuickReplyId(quickReplyId);
    setError(null);
    try {
      const reply = await replyToAnnouncement(
        teamId,
        announcementId,
        t(QUICK_REPLY_TRANSLATION_KEYS[quickReplyId]),
        "team",
      );
      setReplies((current) => appendReply(current, reply));
    } catch (nextError) {
      logOperationError("createQuickReply", nextError);
      setError(t("myTeams.replyError"));
    } finally {
      replySubmissionInFlight.current = false;
      setSendingQuickReplyId(null);
    }
  }, [announcement?.allowReplies, announcementId, summary?.team.status, t, teamId]);

  const deleteReply = useCallback(async (reply: AnnouncementReply) => {
    if (reply.isDeleted || reply.userId !== auth.currentUser?.uid || replyDeletionInFlight.current) return;
    replyDeletionInFlight.current = true;
    setError(null);
    try {
      await deleteAnnouncementReply(teamId, announcementId, reply.id);
      setReplies((current) => current.map((item) => item.id === reply.id
        ? { ...item, body: "", deletedBy: auth.currentUser?.uid ?? null, isDeleted: true }
        : item));
    } catch (nextError) {
      logOperationError("deleteReply", nextError);
      throw nextError;
    } finally {
      replyDeletionInFlight.current = false;
    }
  }, [announcementId, teamId]);

  const submitReport = useCallback(async (
    kind: "announcement" | "announcementReply",
    contentId: string,
    reason: MessageReportReason,
    explanation: string | null,
  ) => {
    return submitModerationReport({
      explanation,
      reason,
      target: { type: "teamContent", kind, teamId, parentId: announcementId, contentId },
    });
  }, [announcementId, teamId]);

  const selectedActions = useMemo<MessageModalAction[]>(() => {
    if (actionTarget?.kind !== "announcementReply" || !actionTarget.mine) return [];
    return [{
      confirmation: {
        body: t("teamMessages.deleteForEveryoneBody"),
        confirmLabel: t("common.delete"),
        title: t("teamMessages.deleteForEveryoneTitle"),
      },
      destructive: true,
      errorMessage: t("teamReplies.deleteError"),
      id: "delete-for-everyone",
      label: t("teamMessages.deleteForEveryone"),
      onPress: () => deleteReply(actionTarget.reply),
    }];
  }, [actionTarget, deleteReply, t]);

  const childNames = summary ? getTeamChildNames(summary) : [];
  const childName = childNames.length === 0
    ? t("myTeams.childNotSpecified")
    : childNames.length === 1
      ? childNames[0]
      : t("myTeams.childrenCount", { count: childNames.length });

  return (
    <ScreenWrapper>
      <MessageKeyboardAwareScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity accessibilityLabel={t("myTeams.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{t("myTeams.coachUpdate")}</Text>
            <Text style={styles.subtitle}>{childName} · {summary?.team.name ?? t("myTeams.team")}</Text>
          </View>
        </View>

        {loading ? (
          <Card style={styles.stateCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("myTeams.loadingUpdate")}</Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            {!announcement ? (
              <TouchableOpacity accessibilityRole="button" onPress={loadAnnouncement} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>{t("myTeams.tryAgain")}</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        ) : null}

        {announcement ? (
          <>
            <Card style={styles.announcementCard}>
              <View style={styles.announcementTop}>
                {announcement.isDeleted
                  ? <Text accessibilityLiveRegion="polite" style={styles.deletedMessage}>{t("teamMessages.messageDeleted")}</Text>
                  : announcement.title
                    ? <Text style={styles.announcementTitle}>{announcement.title}</Text>
                    : <View style={styles.announcementTitle} />}
                {!announcement.isDeleted && announcement.createdBy !== auth.currentUser?.uid ? (
                  <TouchableOpacity
                    accessibilityLabel={t("teamMessages.messageActions")}
                    accessibilityRole="button"
                    onPress={() => setActionTarget({ contentId: announcement.id, kind: "announcement", mine: false })}
                    style={styles.replyMenuButton}
                  >
                    <MoreVertical accessible={false} color={Colors.primary} size={20} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {!announcement.isDeleted ? <Text style={styles.announcementBody}>{announcement.body}</Text> : null}
              {!announcement.isDeleted && announcement.contentType === "voice" && announcement.voiceMemo ? (
                <VoiceMemoPlayer
                  durationMilliseconds={announcement.voiceMemo.durationMilliseconds}
                  isOwnMessage={announcement.createdBy === auth.currentUser?.uid}
                  source={{
                    kind: "persisted-message",
                    messageId: announcement.id,
                    messageKind: "announcement",
                    storagePath: announcement.voiceMemo.storagePath,
                  }}
                />
              ) : !announcement.isDeleted && announcement.contentType === "voice" ? <VoiceMemoUnavailable /> : null}
              <View style={styles.metaPanel}>
                <Text style={styles.metaText}>{announcement.createdByName || t(announcement.authorProfileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember")}</Text>
                <Text style={styles.metaText}>{formatDateTime(announcement.createdAt, i18n.language)}</Text>
              </View>
            </Card>

            <Card style={styles.repliesCard}>
              <View style={styles.repliesHeader}>
                <MessageCircle color={Colors.primary} size={20} />
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t("myTeams.replies")}</Text>
              </View>
              {replies.length === 0 ? <Text style={styles.cardText}>{t("myTeams.noReplies")}</Text> : null}
              {replies.map((reply) => (
                <View key={reply.id} style={styles.replyRow}>
                  <View style={styles.replyTopRow}>
                    <View style={styles.replyAuthorCopy}>
                      <Text style={styles.replyName}>{reply.displayName || t(reply.profileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember")}</Text>
                      <Text style={styles.replyTime}>{formatDateTime(reply.createdAt, i18n.language)}</Text>
                    </View>
                    {!reply.isDeleted && reply.userId ? (
                      <TouchableOpacity
                        accessibilityLabel={t("teamMessages.messageActions")}
                        accessibilityRole="button"
                        onPress={() => setActionTarget({
                          kind: "announcementReply",
                          mine: reply.userId === auth.currentUser?.uid,
                          reply,
                        })}
                        style={styles.replyMenuButton}
                      >
                        <MoreVertical accessible={false} color={Colors.primary} size={20} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                  <Text style={reply.isDeleted ? styles.deletedMessage : styles.replyBody}>
                    {reply.isDeleted
                      ? reply.deletedBy === auth.currentUser?.uid
                        ? t("teamMessages.youDeletedMessage")
                        : t("teamMessages.messageDeleted")
                      : reply.body}
                  </Text>
                </View>
              ))}
              {hasOlderReplies ? (
                <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: loadingOlderReplies }} disabled={loadingOlderReplies} onPress={() => { void loadOlderReplies(); }} style={styles.outlineButton}>
                  {loadingOlderReplies ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.outlineButtonText}>{t("myTeams.loadOlderReplies")}</Text>}
                </TouchableOpacity>
              ) : null}
            </Card>

            {announcement.allowReplies && summary?.team.status === "active" ? (
              <View
                collapsable={false}
                onLayout={updateComposerKeyboardOverlap}
                ref={composerBoundaryRef}
                style={composerKeyboardOverlap > 0 ? { marginBottom: composerKeyboardOverlap } : undefined}
              >
                <Card style={styles.composerCard}>
                  <Text style={styles.sectionTitle}>{t("myTeams.addReply")}</Text>
                  <View style={styles.quickGrid}>
                    {QUICK_REPLY_IDS.map((quickReplyId) => {
                      const selected = sendingQuickReplyId === quickReplyId;
                      const disabled = sending || Boolean(sendingQuickReplyId);
                      return (
                        <TouchableOpacity
                          key={quickReplyId}
                          accessibilityRole="button"
                          accessibilityState={{ busy: selected, disabled }}
                          activeOpacity={0.86}
                          disabled={disabled}
                          onPress={() => void sendQuickReply(quickReplyId)}
                          style={[styles.quickButton, disabled && styles.disabledButton]}
                        >
                          {selected
                            ? <ActivityIndicator color={Colors.primary} size="small" />
                            : <Text style={styles.quickButtonText}>{t(QUICK_REPLY_TRANSLATION_KEYS[quickReplyId])}</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <TextInput
                    accessibilityLabel={t("myTeams.replyPlaceholder")}
                    multiline
                    onChangeText={setReplyBody}
                    onContentSizeChange={updateComposerKeyboardOverlap}
                    onFocus={updateComposerKeyboardOverlap}
                    placeholder={t("myTeams.replyPlaceholder")}
                    placeholderTextColor={Colors.textPrimary}
                    style={styles.input}
                    value={replyBody}
                  />
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ busy: sending, disabled: sending || Boolean(sendingQuickReplyId) || !replyBody.trim() }}
                    disabled={sending || Boolean(sendingQuickReplyId) || !replyBody.trim()}
                    onPress={sendReply}
                    style={[styles.primaryButton, (sending || Boolean(sendingQuickReplyId) || !replyBody.trim()) && styles.disabledButton]}
                  >
                    {sending
                      ? <ActivityIndicator color={Colors.surface} />
                      : <Text style={styles.primaryButtonText}>{t("myTeams.sendReply")}</Text>}
                  </TouchableOpacity>
                </Card>
              </View>
            ) : (
              <Card style={styles.repliesOffCard}>
                <Text style={styles.cardText}>{t("myTeams.repliesOff")}</Text>
              </Card>
            )}
          </>
        ) : null}
      </MessageKeyboardAwareScrollView>
      <MessageActionsModal
        actions={selectedActions}
        onDismiss={() => setActionTarget(null)}
        report={actionTarget && !actionTarget.mine
          ? {
            errorMessage: t("moderation.reportError"),
            onSubmit: ({ explanation, reason }) => submitReport(
              actionTarget.kind,
              actionTarget.kind === "announcement" ? actionTarget.contentId : actionTarget.reply.id,
              reason,
              explanation,
            ),
            successBody: t("moderation.reportSentBody"),
            successTitle: t("moderation.reportSentTitle"),
          }
          : undefined}
        visible={Boolean(actionTarget)}
      />
    </ScreenWrapper>
  );
}

function formatDateTime(value: unknown, locale: string) {
  const date = readDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function readDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate();
  }
  return null;
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function appendReply(replies: AnnouncementReply[], reply: AnnouncementReply) {
  return mergeReplies(replies, [reply]);
}

function mergeReplies(...groups: AnnouncementReply[][]) {
  const byId = new Map<string, AnnouncementReply>();
  groups.flat().forEach((reply) => byId.set(reply.id, reply));
  return Array.from(byId.values()).sort((first, second) => {
    const time = replyMillis(first.createdAt) - replyMillis(second.createdAt);
    return time || first.id.localeCompare(second.id);
  });
}

function replyMillis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function logOperationError(operation: string, error: unknown) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[ParentAnnouncement] operation failed", { operation, code });
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  headerCopy: { flex: 1 },
  backButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 28 },
  subtitle: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  errorCard: { alignItems: "center", borderLeftColor: Colors.primary, borderLeftWidth: 4, gap: Spacing.sm },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  outlineButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  announcementCard: { borderLeftColor: Colors.accentGold, borderLeftWidth: 4, gap: Spacing.md },
  announcementTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  announcementTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyBold, fontSize: 20 },
  announcementBody: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 23 },
  metaPanel: { borderTopColor: Colors.secondary, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, paddingTop: Spacing.sm },
  metaText: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  repliesCard: { gap: Spacing.sm },
  repliesHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  replyRow: { backgroundColor: Colors.background, borderRadius: Radius.sm, gap: 4, padding: Spacing.sm },
  replyTopRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", gap: Spacing.sm },
  replyAuthorCopy: { flex: 1, gap: 2 },
  replyName: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 13 },
  replyTime: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 10 },
  replyMenuButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44, marginRight: -Spacing.sm, marginTop: -Spacing.sm },
  replyBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 },
  deletedMessage: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  composerCard: { gap: Spacing.sm },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  quickButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexBasis: "46%", flexGrow: 1, justifyContent: "center", minHeight: 48, minWidth: 120, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  quickButtonText: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 19, textAlign: "center" },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, maxHeight: 144, minHeight: 90, padding: Spacing.md, textAlignVertical: "top" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  disabledButton: { opacity: 0.55 },
  repliesOffCard: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderWidth: 1 },
});
