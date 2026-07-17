import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { MoreVertical } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { VoiceMemoPlayer } from "@/components/VoiceMemoPlayer";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { auth } from "@/config/firebase";
import { QUICK_REPLY_IDS, QUICK_REPLY_TRANSLATION_KEYS, type QuickReplyId } from "@/constants/teamReplies";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  deleteAnnouncementReply,
  deleteTeamAnnouncement,
  getTeamAnnouncement,
  listenToAnnouncementReplies,
  listenToTeamAnnouncement,
  replyToAnnouncement,
  type AnnouncementReply,
  type TeamAnnouncement,
} from "@/services/teamMessageService";
import {
  canManageTeamAnnouncements,
  getCurrentUserTeamMemberships,
  hasCoachAccess,
  isTeamActive,
} from "@/services/teamService";

export default function AnnouncementThreadScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[]; announcementId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const announcementId = normalizeParam(params.announcementId);
  const [announcement, setAnnouncement] = useState<TeamAnnouncement | null>(null);
  const [replies, setReplies] = useState<AnnouncementReply[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendingQuickReplyId, setSendingQuickReplyId] = useState<QuickReplyId | null>(null);
  const [deletingReplyId, setDeletingReplyId] = useState<string | null>(null);
  const [canModerateReplies, setCanModerateReplies] = useState(false);
  const [canDeleteAnnouncement, setCanDeleteAnnouncement] = useState(false);
  const [deletingAnnouncement, setDeletingAnnouncement] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const replySubmissionInFlight = useRef(false);
  const replyDeletionInFlight = useRef(false);
  const announcementDeletionInFlight = useRef(false);

  useEffect(() => {
    let isMounted = true;
    async function loadAnnouncement() {
      setLoading(true);
      setError(null);
      try {
        const [nextAnnouncement, memberships] = await Promise.all([
          getTeamAnnouncement(teamId, announcementId),
          getCurrentUserTeamMemberships(),
        ]);
        const membership = memberships.find((item) => item.teamId === teamId);
        if (isMounted) {
          setAnnouncement(nextAnnouncement);
          setCanModerateReplies(Boolean(
            membership?.status === "active" && hasCoachAccess(membership) && isTeamActive(membership.team),
          ));
          setCanDeleteAnnouncement(canManageTeamAnnouncements(membership, membership?.team));
        }
      } catch (nextError) {
        console.warn("[AnnouncementThread] load error:", nextError);
        if (isMounted) setError(t("coach.messages.error"));
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void loadAnnouncement();
    return () => {
      isMounted = false;
    };
  }, [announcementId, teamId, t]);

  useEffect(() => {
    if (!teamId || !announcementId) return () => {};
    return listenToTeamAnnouncement(
      teamId,
      announcementId,
      (nextAnnouncement) => {
        setAnnouncement(nextAnnouncement);
        if (!nextAnnouncement) setReplies([]);
      },
      () => setError(t("coach.messages.error")),
    );
  }, [announcementId, t, teamId]);

  useEffect(() => {
    if (!announcement?.id) {
      setReplies([]);
      return () => {};
    }
    return listenToAnnouncementReplies(
      teamId,
      announcementId,
      setReplies,
      () => setError(t("coach.messages.replyError")),
    );
  }, [announcement?.id, announcementId, teamId, t]);

  const submitReply = useCallback(
    async (body: string, quickReplyId?: QuickReplyId) => {
      if (!body.trim() || replySubmissionInFlight.current) return;
      replySubmissionInFlight.current = true;
      if (quickReplyId) setSendingQuickReplyId(quickReplyId);
      else setSending(true);
      setError(null);
      try {
        const reply = await replyToAnnouncement(teamId, announcementId, body, "team");
        setReplies((current) => appendReply(current, reply));
        if (!quickReplyId) setReplyBody("");
      } catch (nextError) {
        logOperationError(quickReplyId ? "createQuickReply" : "createReply", nextError);
        setError(t("coach.messages.replyError"));
      } finally {
        replySubmissionInFlight.current = false;
        if (quickReplyId) setSendingQuickReplyId(null);
        else setSending(false);
      }
    },
    [announcementId, t, teamId],
  );

  const confirmDeleteReply = useCallback((reply: AnnouncementReply) => {
    const deletingOwnReply = reply.userId === auth.currentUser?.uid;
    if ((!deletingOwnReply && !canModerateReplies) || replyDeletionInFlight.current) return;
    Alert.alert(
      t(deletingOwnReply ? "teamReplies.deleteOwnTitle" : "teamReplies.removeOtherTitle"),
      t(deletingOwnReply ? "teamReplies.deleteOwnBody" : "teamReplies.removeOtherBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t(deletingOwnReply ? "teamReplies.delete" : "teamReplies.removeReply"),
          style: "destructive",
          onPress: () => {
            if (replyDeletionInFlight.current) return;
            replyDeletionInFlight.current = true;
            setDeletingReplyId(reply.id);
            setError(null);
            void deleteAnnouncementReply(teamId, announcementId, reply.id)
              .then(() => setReplies((current) => current.filter((item) => item.id !== reply.id)))
              .catch((nextError) => {
                logOperationError("deleteReply", nextError);
                setError(t("teamReplies.deleteError"));
              })
              .finally(() => {
                replyDeletionInFlight.current = false;
                setDeletingReplyId(null);
              });
          },
        },
      ],
    );
  }, [announcementId, canModerateReplies, t, teamId]);

  const navigateBackToMessages = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace({ pathname: "/coach/messages", params: { teamId } } as never);
  }, [teamId]);

  const performDeleteAnnouncement = useCallback(async () => {
    if (!announcement || !canDeleteAnnouncement || announcementDeletionInFlight.current) return;
    announcementDeletionInFlight.current = true;
    setDeletingAnnouncement(true);
    setError(null);
    try {
      await deleteTeamAnnouncement(teamId, announcementId);
      setAnnouncement(null);
      setReplies([]);
      Alert.alert(
        t("coach.messages.deleteSuccess"),
        undefined,
        [{ text: t("common.ok"), onPress: navigateBackToMessages }],
      );
    } catch (nextError) {
      logAnnouncementDeleteError(nextError, {
        teamId,
        announcementId,
        authorized: canDeleteAnnouncement,
      });
      setError(t("coach.messages.deleteError"));
    } finally {
      announcementDeletionInFlight.current = false;
      setDeletingAnnouncement(false);
    }
  }, [announcement, announcementId, canDeleteAnnouncement, navigateBackToMessages, t, teamId]);

  const confirmDeleteAnnouncement = useCallback(() => {
    if (!announcement || !canDeleteAnnouncement || announcementDeletionInFlight.current) return;
    Alert.alert(
      t("coach.messages.deleteAnnouncementTitle"),
      t("coach.messages.deleteAnnouncementBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("coach.messages.delete"),
          style: "destructive",
          onPress: () => { void performDeleteAnnouncement(); },
        },
      ],
    );
  }, [announcement, canDeleteAnnouncement, performDeleteAnnouncement, t]);

  const openAnnouncementActions = useCallback(() => {
    if (!announcement || !canDeleteAnnouncement || announcementDeletionInFlight.current) return;
    Alert.alert(
      t("coach.messages.announcementActions"),
      undefined,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("coach.messages.deleteAnnouncement"),
          style: "destructive",
          onPress: confirmDeleteAnnouncement,
        },
      ],
    );
  }, [announcement, canDeleteAnnouncement, confirmDeleteAnnouncement, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("coach.messages.thread")}</Text>
          <Text style={styles.subtitle}>{t("coach.messages.replyToTeam")}</Text>
        </View>

        {loading ? (
          <Card style={styles.centerCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("common.loading")}</Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        ) : null}

        {announcement ? (
          <Card style={styles.cardGap}>
            <View style={styles.announcementHeader}>
              <Text style={styles.announcementTitle}>{announcement.title}</Text>
              {canDeleteAnnouncement ? (
                <TouchableOpacity
                  accessibilityLabel={deletingAnnouncement
                    ? t("coach.messages.deletingAnnouncement")
                    : t("coach.messages.deleteAnnouncement")}
                  accessibilityRole="button"
                  accessibilityState={{ busy: deletingAnnouncement, disabled: deletingAnnouncement }}
                  disabled={deletingAnnouncement}
                  hitSlop={8}
                  onPress={openAnnouncementActions}
                  style={styles.announcementMenuButton}
                >
                  {deletingAnnouncement
                    ? <ActivityIndicator color={Colors.primary} size="small" />
                    : <MoreVertical color={Colors.primary} size={22} />}
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={styles.cardText}>{announcement.body}</Text>
            {announcement.contentType === "voice" && announcement.voiceMemo ? (
              <VoiceMemoPlayer durationMilliseconds={announcement.voiceMemo.durationMilliseconds} storagePath={announcement.voiceMemo.storagePath} />
            ) : null}
            <Text style={styles.metaText}>{announcement.createdByName}</Text>
          </Card>
        ) : !loading ? (
          <Card style={styles.centerCard}>
            <Text style={styles.cardTitle}>{t("coach.messages.announcementUnavailable")}</Text>
            <Text style={styles.cardText}>{t("coach.messages.missingBody")}</Text>
          </Card>
        ) : null}

        {announcement ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.replies")}</Text>
            {replies.length === 0 ? <Text style={styles.cardText}>{t("coach.messages.noReplies")}</Text> : null}
            {replies.map((reply) => (
              <View key={reply.id} style={styles.replyRow}>
                <View style={styles.replyTopRow}>
                  <Text style={styles.replyName}>{reply.displayName || t("teamReplies.teamParentFallback")}</Text>
                  {reply.userId === auth.currentUser?.uid || canModerateReplies ? (
                    <TouchableOpacity
                      accessibilityLabel={t(reply.userId === auth.currentUser?.uid ? "teamReplies.deleteMenuOwn" : "teamReplies.deleteMenuModerate")}
                      accessibilityRole="button"
                      accessibilityState={{ busy: deletingReplyId === reply.id, disabled: Boolean(deletingReplyId) }}
                      disabled={Boolean(deletingReplyId)}
                      onPress={() => confirmDeleteReply(reply)}
                      style={styles.replyMenuButton}
                    >
                      {deletingReplyId === reply.id
                        ? <ActivityIndicator color={Colors.primary} size="small" />
                        : <MoreVertical color={Colors.primary} size={20} />}
                    </TouchableOpacity>
                  ) : null}
                </View>
                <Text style={styles.replyBody}>{reply.body}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {announcement?.allowReplies ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.reply")}</Text>
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
                    onPress={() => void submitReply(t(QUICK_REPLY_TRANSLATION_KEYS[quickReplyId]), quickReplyId)}
                    style={[styles.quickButton, disabled && styles.disabledButton]}
                  >
                    {selected
                      ? <ActivityIndicator color={Colors.primary} size="small" />
                      : <Text style={styles.quickButtonText}>{t(QUICK_REPLY_TRANSLATION_KEYS[quickReplyId])}</Text>}
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput multiline onChangeText={setReplyBody} placeholder={t("coach.messages.replyPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={replyBody} />
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: sending, disabled: sending || Boolean(sendingQuickReplyId) || !replyBody.trim() }} activeOpacity={0.86} disabled={sending || Boolean(sendingQuickReplyId) || !replyBody.trim()} onPress={() => void submitReply(replyBody)} style={[styles.primaryButton, (sending || Boolean(sendingQuickReplyId) || !replyBody.trim()) && styles.disabledButton]}>
              {sending ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryButtonText}>{t("coach.messages.reply")}</Text>}
            </TouchableOpacity>
          </Card>
        ) : announcement ? (
          <Card style={styles.centerCard}>
            <Text style={styles.cardText}>{t("coach.messages.repliesClosed")}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function appendReply(replies: AnnouncementReply[], reply: AnnouncementReply) {
  return replies.some((item) => item.id === reply.id) ? replies : [...replies, reply];
}

function logOperationError(operation: string, error: unknown) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[AnnouncementThread] operation failed", { operation, code });
}

function logAnnouncementDeleteError(
  error: unknown,
  context: { teamId: string; announcementId: string; authorized: boolean },
) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[AnnouncementThread] delete failed", {
    operation: "deleteAnnouncement",
    code,
    callableName: "deleteTeamAnnouncement",
    functionRegion: "us-central1",
    hasTeamId: Boolean(context.teamId),
    hasAnnouncementId: Boolean(context.announcementId),
    authorizedCoachOrStaff: context.authorized,
  });
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 31, textAlign: "center" },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21, textAlign: "center" },
  cardGap: { gap: Spacing.md },
  centerCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  errorCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4 },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  announcementHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  announcementTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  announcementMenuButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 },
  cardText: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  metaText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  replyRow: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, gap: 3, padding: Spacing.md },
  replyTopRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", gap: Spacing.sm },
  replyName: { color: Colors.textHeading, fontFamily: Typography.bodyBold },
  replyMenuButton: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44, marginRight: -Spacing.sm, marginTop: -Spacing.sm },
  replyBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 20 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  quickButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexBasis: "46%", flexGrow: 1, justifyContent: "center", minHeight: 48, minWidth: 120, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  quickButtonText: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 19, textAlign: "center" },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 84, padding: Spacing.md, textAlignVertical: "top" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.55 },
});
