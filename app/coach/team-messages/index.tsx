import React, { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useCoachBackNavigation } from "@/hooks/useCoachBackNavigation";
import { getTeamPrivateMessageInboxPage } from "@/services/teamPrivateMessageService";
import type { TeamPrivateConversation } from "@/types/teamVoiceMessaging";

export default function CoachTeamMessagesInboxScreen() {
  const { t } = useTranslation();
  const navigateBack = useCoachBackNavigation();
  const [conversations, setConversations] = useState<TeamPrivateConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError(false);
    try {
      const page = await getTeamPrivateMessageInboxPage("coach");
      setConversations(page.conversations);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
    }
    catch { setConversations([]); setError(true); }
    finally { setLoading(false); }
  }, []);
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true); setError(false);
    try {
      const page = await getTeamPrivateMessageInboxPage("coach", undefined, nextOffset);
      setConversations((current) => [...current, ...page.conversations]);
      setHasMore(page.hasMore);
      setNextOffset(page.nextOffset);
    } catch { setError(true); }
    finally { setLoadingMore(false); }
  }, [hasMore, loadingMore, nextOffset]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading && conversations.length > 0} onRefresh={load} tintColor={Colors.primary} />}>
        <CoachResourceHeader accessibilityLabel={t("teamMessages.back")} onBack={navigateBack} subtitle={t("teamMessages.inboxSubtitle")} title={t("teamMessages.title")} />
        {loading ? <ActivityIndicator color={Colors.primary} /> : null}
        {error ? <Card><Text style={styles.empty}>{t("teamMessages.loadError")}</Text></Card> : null}
        {!loading && !error && conversations.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("teamMessages.inboxEmptyTitle")}</Text>
            <Text style={styles.empty}>{t("teamMessages.inboxEmptyBody")}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/coach/team" as never)} style={styles.viewTeamButton}>
              <Text style={styles.viewTeamText}>{t("teamMessages.viewTeam")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
        {conversations.map((conversation) => (
          <TouchableOpacity accessibilityRole="button" key={conversation.conversationId} onPress={() => router.push(`/coach/team-messages/${conversation.conversationId}` as never)}>
            <Card style={styles.row}>
              <View style={styles.rowHeader}>
                <View importantForAccessibility="no" style={styles.avatar}><Text style={styles.avatarText}>{conversation.parentDisplayName.charAt(0).toUpperCase() || "P"}</Text></View>
                <View style={styles.rowCopy}><Text style={styles.name}>{conversation.parentDisplayName}</Text><Text style={styles.team}>{conversation.teamName}</Text></View>
                <Text style={styles.time}>{formatTime(conversation.lastMessageAtMillis)}</Text>
              </View>
              <Text numberOfLines={2} style={styles.preview}>{formatPreview(conversation, t)}{conversation.lastMessageType === "voice" && conversation.lastMessagePreview?.startsWith("voice:") ? ` · ${formatDuration(conversation.lastMessagePreview)}` : ""}</Text>
              {conversation.unreadCount > 0 ? <Text style={styles.unread}>{t("teamMessages.unread", { count: conversation.unreadCount })}</Text> : null}
              <ChevronRight color={Colors.primary} size={20} style={styles.chevron} />
            </Card>
          </TouchableOpacity>
        ))}
        {hasMore ? (
          <TouchableOpacity accessibilityRole="button" disabled={loadingMore} onPress={() => { void loadMore(); }} style={styles.loadMore}>
            {loadingMore ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.loadMoreText}>{t("teamMessages.loadMore")}</Text>}
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function formatPreview(conversation: TeamPrivateConversation, t: (key: string) => string) {
  return conversation.lastMessageType === "voice" ? t("teamMessages.voicePreview") : conversation.lastMessagePreview || t("teamMessages.noMessagesYet");
}

function formatTime(milliseconds: number) {
  if (!milliseconds) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(milliseconds));
}

function formatDuration(preview: string) {
  const milliseconds = Number(preview.split(":")[1] ?? 0);
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  row: { gap: 3, paddingRight: Spacing.xl, position: "relative" },
  rowHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  rowCopy: { flex: 1 },
  avatar: { alignItems: "center", backgroundColor: Colors.background, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  avatarText: { color: Colors.primary, fontFamily: Typography.bodyBold },
  time: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
  name: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 17 },
  team: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  preview: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 19 },
  unread: { alignSelf: "flex-start", backgroundColor: Colors.primary, borderRadius: Radius.button, color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 12, overflow: "hidden", paddingHorizontal: Spacing.sm, paddingVertical: 3 },
  chevron: { position: "absolute", right: Spacing.md, top: Spacing.lg },
  loadMore: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  loadMoreText: { color: Colors.primary, fontFamily: Typography.bodyBold },
  emptyCard: { alignItems: "center", gap: Spacing.md },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18, textAlign: "center" },
  empty: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, textAlign: "center" },
  viewTeamButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.lg },
  viewTeamText: { color: Colors.surface, fontFamily: Typography.bodyBold },
});
