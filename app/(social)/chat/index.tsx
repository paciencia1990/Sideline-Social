import React, { useCallback, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BellRing, MessageCircle, MessagesSquare, Plus, Users } from "lucide-react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getConversationDisplayTitle,
  mapFriendChatError,
  subscribeToFriendChatInvitations,
  subscribeToFriendConversations,
  CHAT_LIST_LIMIT,
  CHAT_LIST_MAX,
  type FriendConversation,
  type FriendConversationListItem,
} from "@/services/chatService";

export default function ChatListScreen() {
  const { i18n, t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [conversations, setConversations] = useState<FriendConversationListItem[]>([]);
  const [invitations, setInvitations] = useState<FriendConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [conversationLimit, setConversationLimit] = useState(CHAT_LIST_LIMIT);

  useFocusEffect(useCallback(() => {
    if (refreshKey > 0) setErrorKey(null);
    if (authLoading) return () => {};
    if (!user?.uid) {
      setLoading(false);
      return () => {};
    }
    let activeLoaded = false;
    let invitationsLoaded = false;
    const finish = () => {
      if (activeLoaded && invitationsLoaded) {
        setLoading(false);
        setRefreshing(false);
      }
    };
    const handleError = (error: unknown) => {
      setErrorKey(chatErrorTranslationKey(mapFriendChatError(error)));
      setLoading(false);
      setRefreshing(false);
    };
    const unsubscribeActive = subscribeToFriendConversations(user.uid, (items) => {
      setConversations(items);
      activeLoaded = true;
      setErrorKey(null);
      finish();
    }, handleError, conversationLimit);
    const unsubscribeInvitations = subscribeToFriendChatInvitations(user.uid, (items) => {
      setInvitations(items);
      invitationsLoaded = true;
      finish();
    }, handleError);
    return () => {
      unsubscribeActive();
      unsubscribeInvitations();
    };
  }, [authLoading, conversationLimit, refreshKey, user?.uid]));

  const refresh = () => {
    setRefreshing(true);
    setRefreshKey((value) => value + 1);
  };

  if (authLoading || loading) {
    return <ScreenWrapper><View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("chat.loadingChats")}</Text></View></ScreenWrapper>;
  }

  return (
    <ScreenWrapper>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{t("chat.title")}</Text>
            <Text style={styles.body}>{t("chat.friendChatSubtitle")}</Text>
          </View>
          <TouchableOpacity
            accessibilityLabel={t("chat.newChat")}
            accessibilityRole="button"
            onPress={() => router.push("/(social)/chat/new")}
            style={styles.newButton}
          >
            <Plus color={Colors.surface} size={18} />
            <Text style={styles.newButtonText}>{t("chat.newChat")}</Text>
          </TouchableOpacity>
        </View>

        {errorKey ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("chat.temporarilyUnavailable")}</Text>
            <Text style={styles.body}>{t(errorKey)}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={refresh} style={styles.outlineButton}>
              <Text style={styles.outlineText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {invitations.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}><BellRing color={Colors.primary} size={20} /><Text style={styles.sectionTitle}>{t("chat.invitations")}</Text></View>
            {invitations.map((conversation) => {
              const title = getConversationDisplayTitle(conversation, user?.uid ?? "", t("chat.unnamedGroup"));
              return (
                <TouchableOpacity
                  key={conversation.conversationId}
                  accessibilityLabel={t("chat.invitationAccessibility", { name: title, count: conversation.activeParticipantCount })}
                  accessibilityRole="button"
                  onPress={() => router.push(`/(social)/chat/invitation/${conversation.conversationId}` as never)}
                >
                  <Card style={styles.row}><View style={styles.groupIcon}><Users color={Colors.surface} size={20} /></View><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowMeta}>{t("chat.participants", { count: conversation.activeParticipantCount })}</Text></View></Card>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {conversations.length === 0 && invitations.length === 0 && !errorKey ? (
          <Card style={styles.emptyCard}>
            <MessagesSquare color={Colors.primary} size={42} />
            <Text style={styles.emptyTitle}>{t("chat.noConversations")}</Text>
            <Text style={styles.body}>{t("chat.noConversationsBody")}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => router.push("/(social)/chat/new")} style={styles.newButton}>
              <Text style={styles.newButtonText}>{t("chat.newChat")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {conversations.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("chat.conversations")}</Text>
            {conversations.map((conversation) => (
              <ConversationRow key={conversation.conversationId} conversation={conversation} locale={i18n.language} />
            ))}
            {conversations.length >= conversationLimit && conversationLimit < CHAT_LIST_MAX ? <TouchableOpacity accessibilityRole="button" onPress={() => setConversationLimit((value) => Math.min(CHAT_LIST_MAX, value + CHAT_LIST_LIMIT))} style={styles.outlineButton}><Text style={styles.outlineText}>{t("chat.loadMoreConversations")}</Text></TouchableOpacity> : null}
          </View>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function ConversationRow({ conversation, locale }: { conversation: FriendConversationListItem; locale: string }) {
  const { t } = useTranslation();
  const uid = useAuth().user?.uid ?? "";
  const title = getConversationDisplayTitle(conversation, uid, t("chat.unnamedGroup"));
  const typeLabel = conversation.conversationType === "group" ? t("chat.groupConversation") : t("chat.directConversation");
  const preview = conversation.lastMessageRemoved
    ? t("chat.messageRemoved")
    : conversation.lastMessagePreview || t("chat.noMessages");
  const time = conversation.lastMessageAt?.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) ?? "";
  return (
    <TouchableOpacity
      accessibilityLabel={t("chat.conversationAccessibility", {
        name: title, type: typeLabel, preview, time, unread: conversation.unread ? t("chat.unread") : "",
      })}
      accessibilityRole="button"
      onPress={() => router.push(`/(social)/chat/${conversation.conversationId}` as never)}
    >
      <Card style={styles.row}>
        <View style={conversation.conversationType === "group" ? styles.groupIcon : styles.directIcon}>
          {conversation.conversationType === "group" ? <Users color={Colors.surface} size={20} /> : <MessageCircle color={Colors.surface} size={20} />}
        </View>
        <View style={styles.rowCopy}>
          <View style={styles.rowTitleLine}><Text numberOfLines={1} style={styles.rowTitle}>{title}</Text><Text style={styles.time}>{time}</Text></View>
          <Text style={styles.typeLabel}>{typeLabel}{conversation.ownMember.muted ? ` · ${t("chat.muted")}` : ""}</Text>
          <Text numberOfLines={1} style={styles.preview}>{preview}</Text>
        </View>
        {conversation.unread ? <View accessibilityLabel={t("chat.unread")} style={styles.unreadDot} /> : null}
      </Card>
    </TouchableOpacity>
  );
}

function chatErrorTranslationKey(error: ReturnType<typeof mapFriendChatError>) {
  if (error === "network") return "chat.checkConnection";
  if (error === "permission") return "chat.noAccess";
  if (error === "missingIndex") return "chat.missingIndex";
  return "chat.tryAgain";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.lg, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  center: { alignItems: "center", flex: 1, gap: Spacing.sm, justifyContent: "center", padding: Spacing.xl },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.md },
  headerCopy: { flex: 1, gap: 3 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  newButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  newButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  errorCard: { borderColor: Colors.primary, borderWidth: 1, gap: Spacing.sm },
  errorTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 17 },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, minHeight: 44, justifyContent: "center" },
  outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  section: { gap: Spacing.sm },
  sectionHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  row: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, minHeight: 82 },
  directIcon: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  groupIcon: { alignItems: "center", backgroundColor: Colors.accentGreen, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  rowCopy: { flex: 1, gap: 2, minWidth: 0 },
  rowTitleLine: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  rowTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  rowMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  typeLabel: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 11 },
  preview: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  time: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
  unreadDot: { backgroundColor: Colors.primary, borderRadius: 6, height: 12, width: 12 },
  emptyCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 19, textAlign: "center" },
});
