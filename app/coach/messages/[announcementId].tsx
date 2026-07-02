import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getTeamAnnouncement,
  listenToAnnouncementReplies,
  replyToAnnouncement,
  type AnnouncementReply,
  type TeamAnnouncement,
} from "@/services/teamMessageService";

const QUICK_REPLIES = [
  "coach.messages.quickReplyIce",
  "coach.messages.quickReplyHelp",
  "coach.messages.quickReplyThere",
  "coach.messages.quickReplyQuestion",
] as const;

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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadAnnouncement() {
      setLoading(true);
      setError(null);
      try {
        const nextAnnouncement = await getTeamAnnouncement(teamId, announcementId);
        if (isMounted) setAnnouncement(nextAnnouncement);
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
    return listenToAnnouncementReplies(
      teamId,
      announcementId,
      setReplies,
      () => setError(t("coach.messages.replyError")),
    );
  }, [announcementId, teamId, t]);

  const sendReply = useCallback(
    async (body: string) => {
      if (!body.trim()) return;
      setSending(true);
      setError(null);
      try {
        await replyToAnnouncement(teamId, announcementId, body, "team");
        setReplyBody("");
      } catch (nextError) {
        console.warn("[AnnouncementThread] reply error:", nextError);
        setError(nextError instanceof Error ? nextError.message : t("coach.messages.replyError"));
      } finally {
        setSending(false);
      }
    },
    [announcementId, t, teamId],
  );

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
            <Text style={styles.cardTitle}>{announcement.title}</Text>
            <Text style={styles.cardText}>{announcement.body}</Text>
            <Text style={styles.metaText}>{announcement.createdByName}</Text>
          </Card>
        ) : !loading ? (
          <Card style={styles.centerCard}>
            <Text style={styles.cardTitle}>{t("coach.messages.missingTitle")}</Text>
            <Text style={styles.cardText}>{t("coach.messages.missingBody")}</Text>
          </Card>
        ) : null}

        {announcement ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.replies")}</Text>
            {replies.length === 0 ? <Text style={styles.cardText}>{t("coach.messages.noReplies")}</Text> : null}
            {replies.map((reply) => (
              <View key={reply.id} style={styles.replyRow}>
                <Text style={styles.replyName}>{reply.displayName}</Text>
                <Text style={styles.replyBody}>{reply.body}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {announcement?.allowReplies ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.reply")}</Text>
            <View style={styles.quickGrid}>
              {QUICK_REPLIES.map((key) => (
                <TouchableOpacity key={key} activeOpacity={0.86} onPress={() => void sendReply(t(key))} style={styles.quickButton}>
                  <Text style={styles.quickButtonText}>{t(key)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput multiline onChangeText={setReplyBody} placeholder={t("coach.messages.replyPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={replyBody} />
            <TouchableOpacity activeOpacity={0.86} disabled={sending || !replyBody.trim()} onPress={() => void sendReply(replyBody)} style={[styles.primaryButton, (sending || !replyBody.trim()) && styles.disabledButton]}>
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
  cardText: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  metaText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  replyRow: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, gap: 3, padding: Spacing.md },
  replyName: { color: Colors.textHeading, fontFamily: Typography.bodyBold },
  replyBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 20 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  quickButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexGrow: 1, minHeight: 40, justifyContent: "center", paddingHorizontal: Spacing.sm },
  quickButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 84, padding: Spacing.md, textAlignVertical: "top" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.55 },
});