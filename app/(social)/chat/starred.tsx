import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Image as ImageIcon, MessageCircle, Mic, Star } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Card } from "@/components/Card";
import { NestedBackButton } from "@/components/NestedBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getConversationDisplayTitle,
  getFriendConversationAccess,
  mapFriendChatError,
  subscribeToStarredFriendChatMessages,
  type ConversationAccess,
  type FriendChatMessage,
} from "@/services/chatService";

export default function StarredFriendChatMessagesScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const [access, setAccess] = useState<ConversationAccess | null>(null);
  const [messages, setMessages] = useState<FriendChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return undefined;
    if (!user?.uid || !conversationId) {
      setLoading(false);
      setErrorKey("chat.noAccess");
      return undefined;
    }
    let unsubscribe = () => {};
    let active = true;
    void (async () => {
      try {
        const nextAccess = await getFriendConversationAccess(conversationId);
        if (!active) return;
        if (!nextAccess || nextAccess.member.status !== "active") {
          setErrorKey("chat.noAccess");
          return;
        }
        setAccess(nextAccess);
        unsubscribe = subscribeToStarredFriendChatMessages(
          conversationId,
          user.uid,
          nextAccess.blockedUserIds,
          (items) => {
            setMessages(items);
            setLoading(false);
            setErrorKey(null);
          },
          (error) => {
            setErrorKey(errorTranslationKey(mapFriendChatError(error)));
            setLoading(false);
          },
        );
      } catch (error) {
        if (active) {
          setErrorKey(errorTranslationKey(mapFriendChatError(error)));
          setLoading(false);
        }
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [authLoading, conversationId, user?.uid]);

  const title = useMemo(() => access && user?.uid
    ? getConversationDisplayTitle(access.conversation, user.uid, t("chat.unnamedGroup"), t("common.formerMember"), t("common.sidelineSocialMember"))
    : t("chat.starredMessages"), [access, t, user?.uid]);
  const fallbackRoute = conversationId
    ? `/(social)/chat/manage?conversationId=${encodeURIComponent(conversationId)}`
    : "/(social)/chat";

  if (authLoading || loading) {
    return <ScreenWrapper><View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("chat.loadingStarredMessages")}</Text></View></ScreenWrapper>;
  }

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <NestedBackButton accessibilityLabel={t("chat.back")} fallbackRoute={fallbackRoute} style={styles.iconButton} />
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{t("chat.starredMessages")}</Text>
          <Text numberOfLines={1} style={styles.headerMeta}>{title}</Text>
        </View>
      </View>
      {errorKey ? (
        <Card style={styles.errorCard}>
          <Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text>
        </Card>
      ) : null}
      <FlatList
        contentContainerStyle={messages.length ? styles.list : styles.emptyList}
        data={messages}
        keyExtractor={(item) => item.messageId}
        ListEmptyComponent={<Card style={styles.emptyCard}><Star color={Colors.accentGold} size={36} /><Text style={styles.emptyTitle}>{t("chat.noStarredMessages")}</Text><Text style={styles.body}>{t("chat.noStarredMessagesBody")}</Text></Card>}
        renderItem={({ item }) => (
          <StarredMessageRow
            message={item}
            onPress={() => conversationId && router.push(`/(social)/chat/${conversationId}` as never)}
          />
        )}
      />
    </ScreenWrapper>
  );
}

function StarredMessageRow({ message, onPress }: { message: FriendChatMessage; onPress: () => void }) {
  const { t } = useTranslation();
  const sender = message.senderDisplayName ?? t("common.sidelineSocialMember");
  const preview = messagePreview(message, t);
  const time = message.createdAt?.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) ?? "";
  const Icon = message.messageType === "image" ? ImageIcon : message.messageType === "voice" ? Mic : MessageCircle;
  return (
    <TouchableOpacity
      accessibilityLabel={t("chat.starredMessageAccessibility", { preview, sender, time })}
      accessibilityRole="button"
      onPress={onPress}
    >
      <Card style={styles.row}>
        <View style={styles.rowIcon}><Icon color={Colors.surface} size={18} /></View>
        <View style={styles.rowCopy}>
          <View style={styles.rowTitleLine}>
            <Text numberOfLines={1} style={styles.sender}>{sender}</Text>
            <Text style={styles.time}>{time}</Text>
          </View>
          <Text numberOfLines={3} style={styles.preview}>{preview}</Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function messagePreview(message: FriendChatMessage, t: TFunction) {
  if (message.messageType === "image") return message.caption ? `${t("chat.photoPreview")}: ${message.caption}` : t("chat.photoPreview");
  if (message.messageType === "voice") return message.caption ? `${t("chat.voicePreview")}: ${message.caption}` : t("chat.voicePreview");
  return message.text || t("chat.quotedMessageUnavailable");
}

function errorTranslationKey(error: ReturnType<typeof mapFriendChatError>) {
  if (error === "network") return "chat.networkError";
  if (error === "permission") return "chat.noAccess";
  return "chat.tryAgain";
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  center: { alignItems: "center", flex: 1, gap: Spacing.sm, justifyContent: "center", padding: Spacing.xl },
  emptyCard: { alignItems: "center", gap: Spacing.sm },
  emptyList: { flexGrow: 1, justifyContent: "center", padding: Spacing.lg },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18, textAlign: "center" },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
  errorCard: { borderColor: Colors.primary, borderWidth: 1, margin: Spacing.md, marginBottom: 0 },
  header: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", minHeight: 58, paddingHorizontal: Spacing.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  headerMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  headerTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  iconButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  list: { gap: Spacing.sm, padding: Spacing.md, paddingBottom: Spacing.xxl },
  preview: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  row: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, minHeight: 72 },
  rowCopy: { flex: 1, gap: 3, minWidth: 0 },
  rowIcon: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  rowTitleLine: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  sender: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  time: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
});
