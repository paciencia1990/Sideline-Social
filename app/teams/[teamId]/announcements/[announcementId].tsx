import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, MessageCircle } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getParentTeamSummary,
  markTeamAnnouncementRead,
  getTeamChildNames,
  type ParentTeamSummary,
} from "@/services/parentTeamService";
import {
  getTeamAnnouncement,
  listenToParentAnnouncementReplies,
  replyToAnnouncement,
  type AnnouncementReply,
  type TeamAnnouncement,
} from "@/services/teamMessageService";

export default function ParentAnnouncementScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{
    teamId?: string | string[];
    announcementId?: string | string[];
  }>();
  const teamId = normalizeParam(params.teamId);
  const announcementId = normalizeParam(params.announcementId);
  const [summary, setSummary] = useState<ParentTeamSummary | null>(null);
  const [announcement, setAnnouncement] = useState<TeamAnnouncement | null>(null);
  const [replies, setReplies] = useState<AnnouncementReply[]>([]);
  const [replyBody, setReplyBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(t("myTeams.announcementMissing"));
        return;
      }
      setSummary(nextSummary);
      setAnnouncement(nextAnnouncement);
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
  }, [announcementId, t, teamId]);

  useEffect(() => {
    void loadAnnouncement();
  }, [loadAnnouncement]);

  useEffect(() => {
    if (!teamId || !announcementId) return () => {};
    return listenToParentAnnouncementReplies(
      teamId,
      announcementId,
      setReplies,
      (replyError) => {
        console.warn("[ParentAnnouncement] replies error:", replyError);
        setError(t("myTeams.repliesLoadError"));
      },
    );
  }, [announcementId, t, teamId]);

  const sendReply = useCallback(async () => {
    if (!replyBody.trim() || !announcement?.allowReplies) return;
    setSending(true);
    setError(null);
    try {
      await replyToAnnouncement(teamId, announcementId, replyBody.trim(), "team");
      setReplyBody("");
    } catch (nextError) {
      console.warn("[ParentAnnouncement] reply error:", nextError);
      setError(t("myTeams.replyError"));
    } finally {
      setSending(false);
    }
  }, [announcement?.allowReplies, announcementId, replyBody, t, teamId]);

  const childNames = summary ? getTeamChildNames(summary) : [];
  const childName = childNames.length === 0
    ? t("myTeams.childNotSpecified")
    : childNames.length === 1
      ? childNames[0]
      : t("myTeams.childrenCount", { count: childNames.length });

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
              {announcement.title ? <Text style={styles.announcementTitle}>{announcement.title}</Text> : null}
              <Text style={styles.announcementBody}>{announcement.body}</Text>
              <View style={styles.metaPanel}>
                <Text style={styles.metaText}>{announcement.createdByName || t("myTeams.coachFallback")}</Text>
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
                    <Text style={styles.replyName}>{reply.displayName}</Text>
                    <Text style={styles.replyTime}>{formatDateTime(reply.createdAt, i18n.language)}</Text>
                  </View>
                  <Text style={styles.replyBody}>{reply.body}</Text>
                </View>
              ))}
            </Card>

            {announcement.allowReplies ? (
              <Card style={styles.composerCard}>
                <Text style={styles.sectionTitle}>{t("myTeams.addReply")}</Text>
                <TextInput
                  accessibilityLabel={t("myTeams.replyPlaceholder")}
                  multiline
                  onChangeText={setReplyBody}
                  placeholder={t("myTeams.replyPlaceholder")}
                  placeholderTextColor={Colors.textPrimary}
                  style={styles.input}
                  value={replyBody}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={sending || !replyBody.trim()}
                  onPress={sendReply}
                  style={[styles.primaryButton, (sending || !replyBody.trim()) && styles.disabledButton]}
                >
                  {sending
                    ? <ActivityIndicator color={Colors.surface} />
                    : <Text style={styles.primaryButtonText}>{t("myTeams.sendReply")}</Text>}
                </TouchableOpacity>
              </Card>
            ) : (
              <Card style={styles.repliesOffCard}>
                <Text style={styles.cardText}>{t("myTeams.repliesOff")}</Text>
              </Card>
            )}
          </>
        ) : null}
      </ScrollView>
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
  announcementTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 20 },
  announcementBody: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 23 },
  metaPanel: { borderTopColor: Colors.secondary, borderTopWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, paddingTop: Spacing.sm },
  metaText: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  repliesCard: { gap: Spacing.sm },
  repliesHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  replyRow: { backgroundColor: Colors.background, borderRadius: Radius.sm, gap: 4, padding: Spacing.sm },
  replyTopRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: Spacing.sm },
  replyName: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 13 },
  replyTime: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 10 },
  replyBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 },
  composerCard: { gap: Spacing.sm },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 90, padding: Spacing.md, textAlignVertical: "top" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  disabledButton: { opacity: 0.55 },
  repliesOffCard: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderWidth: 1 },
});