import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MessageCircle, MessageSquare, RefreshCw, Users } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getChatDisplayTitle,
  getOrCreateDirectChat,
  listenToUserChats,
  type ChatSummary,
} from "@/services/chatService";

function formatChatDate(value: Date | null): string {
  if (!value) return "";
  const now = Date.now();
  const elapsed = now - value.getTime();
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.max(1, Math.floor(elapsed / 60_000))}m`;
  if (elapsed < 86_400_000) return `${Math.max(1, Math.floor(elapsed / 3_600_000))}h`;
  return value.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ChatRow({ chat, currentUserId }: { chat: ChatSummary; currentUserId: string }) {
  const title = getChatDisplayTitle(chat, currentUserId);
  const isSquad = chat.type === "squad";

  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.84}
      onPress={() => router.push({ pathname: "/(social)/chat/[chatId]", params: { chatId: chat.chatId } })}
    >
      <Card style={styles.chatCard}>
        <View style={[styles.avatar, isSquad && styles.squadAvatar]}>
          {isSquad ? <Users size={22} color={Colors.surface} /> : <MessageCircle size={22} color={Colors.surface} />}
        </View>
        <View style={styles.chatText}>
          <View style={styles.chatTitleRow}>
            <Text numberOfLines={1} style={styles.chatTitle}>{title}</Text>
            <Text style={styles.timestamp}>{formatChatDate(chat.lastMessageAt ?? chat.updatedAt)}</Text>
          </View>
          <Text numberOfLines={1} style={styles.preview}>
            {chat.lastMessageText || "No messages yet"}
          </Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card style={styles.emptyCard}>
      <MessageSquare size={34} color={Colors.primary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        activeOpacity={0.82}
        onPress={() => router.push("/(tabs)/friends")}
        style={styles.friendButton}
      >
        <Text style={styles.friendButtonText}>Friends</Text>
      </TouchableOpacity>
    </Card>
  );
}

export default function ChatListScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const directOpenKeyRef = useRef<string | null>(null);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openingDirect, setOpeningDirect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid) {
      setChats([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    const unsubscribe = listenToUserChats(
      user.uid,
      (nextChats) => {
        setChats(nextChats);
        setLoading(false);
        setRefreshing(false);
      },
      () => {
        setError(t("chat.errorBody"));
        setLoading(false);
        setRefreshing(false);
      }
    );

    return unsubscribe;
  }, [authLoading, t, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !params.userId) return;
    const directKey = `${user.uid}:${params.userId}`;
    if (directOpenKeyRef.current === directKey) return;
    directOpenKeyRef.current = directKey;

    (async () => {
      setOpeningDirect(true);
      setError(null);
      try {
        const chatId = await getOrCreateDirectChat(params.userId ?? "", params.name);
        router.replace({ pathname: "/(social)/chat/[chatId]", params: { chatId } });
      } catch (nextError) {
        console.warn("[ChatListScreen] open direct chat error:", nextError);
        setError(nextError instanceof Error ? nextError.message : t("chat.errorBody"));
      } finally {
        setOpeningDirect(false);
      }
    })();
  }, [params.name, params.userId, t, user?.uid]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }, []);

  if (authLoading || loading) {
    return (
      <ScreenWrapper>
        <View style={styles.centeredState}>
          <ActivityIndicator color={Colors.primary} size="large" />
          <Text style={styles.stateText}>{t("common.loading")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (!user?.uid) {
    return (
      <ScreenWrapper>
        <View style={styles.centeredState}>
          <MessageCircle size={42} color={Colors.primary} />
          <Text style={styles.title}>{t("chat.title")}</Text>
          <Text style={styles.stateText}>{t("chat.signInRequired")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  const directChats = chats.filter((chat) => chat.type === "direct");
  const squadChats = chats.filter((chat) => chat.type === "squad");

  return (
    <ScreenWrapper>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={Colors.primary} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <MessageCircle size={42} color={Colors.primary} />
          <Text style={styles.title}>{t("chat.title")}</Text>
          <Text style={styles.subtitle}>{t("chat.subtitle")}</Text>
        </View>

        {openingDirect ? (
          <Card style={styles.noticeCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.noticeText}>{t("chat.startConversation")}</Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("chat.errorTitle")}</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={onRefresh} style={styles.retryButton}>
              <RefreshCw size={16} color={Colors.surface} />
              <Text style={styles.retryText}>{t("chat.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {directChats.length === 0 && squadChats.length === 0 ? (
          <EmptyState title={t("chat.emptyTitle")} body={t("chat.emptyBody")} />
        ) : null}

        {directChats.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("chat.directMessages")}</Text>
            {directChats.map((chat) => <ChatRow key={chat.chatId} chat={chat} currentUserId={user.uid} />)}
          </View>
        ) : null}

        {squadChats.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("chat.squadChats")}</Text>
            {squadChats.map((chat) => <ChatRow key={chat.chatId} chat={chat} currentUserId={user.uid} />)}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  header: {
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.lg,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 30,
    textAlign: "center",
  },
  subtitle: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  section: {
    gap: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
  },
  chatCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: 23,
    height: 46,
    justifyContent: "center",
    width: 46,
  },
  squadAvatar: {
    backgroundColor: Colors.accentGreen,
  },
  chatText: {
    flex: 1,
    gap: 3,
  },
  chatTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  chatTitle: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
  },
  timestamp: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
  },
  preview: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
  },
  emptyCard: {
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  emptyTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    textAlign: "center",
  },
  emptyBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  friendButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    minHeight: 42,
    justifyContent: "center",
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  friendButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  noticeCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  noticeText: {
    color: Colors.textPrimary,
    flex: 1,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
  },
  errorCard: {
    borderColor: Colors.primary,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  errorTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
  },
  errorBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexDirection: "row",
    gap: Spacing.xs,
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: Spacing.md,
  },
  retryText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  centeredState: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
    justifyContent: "center",
    padding: Spacing.xl,
  },
  stateText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
