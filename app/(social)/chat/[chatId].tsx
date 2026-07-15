import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View, type FlatList as FlatListType } from "react-native";
import { ArrowLeft, MoreHorizontal, Send } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  CHAT_MESSAGE_LIMIT,
  createChatClientMessageId,
  getConversationDisplayTitle,
  getFriendConversationAccess,
  listenToFriendChatMessages,
  loadEarlierFriendChatMessages,
  mapFriendChatError,
  markFriendConversationRead,
  removeOwnFriendChatMessage,
  reportFriendChatMessage,
  sendFriendChatMessage,
  setActiveFriendConversation,
  type ConversationAccess,
  type FriendChatMessage,
} from "@/services/chatService";

export default function FriendConversationScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { chatId: rawChatId } = useLocalSearchParams<{ chatId?: string | string[] }>();
  const chatId = Array.isArray(rawChatId) ? rawChatId[0] : rawChatId;
  const listRef = useRef<FlatListType<FriendChatMessage>>(null);
  const [access, setAccess] = useState<ConversationAccess | null>(null);
  const [messages, setMessages] = useState<FriendChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid || !chatId) { setLoading(false); setErrorKey("chat.noAccess"); return; }
    let active = true;
    let unsubscribe = () => {};
    setActiveFriendConversation(chatId);
    void (async () => {
      try {
        const nextAccess = await getFriendConversationAccess(chatId);
        if (!active) return;
        if (!nextAccess) { setErrorKey("chat.missingChat"); return; }
        if (nextAccess.member.status === "invited") {
          router.replace(`/(social)/chat/invitation/${chatId}` as never);
          return;
        }
        if (nextAccess.member.status !== "active" || !nextAccess.member.joinedAt) { setErrorKey("chat.membershipEnded"); return; }
        setAccess(nextAccess);
        unsubscribe = listenToFriendChatMessages(chatId, user.uid, nextAccess.blockedUserIds, (items) => {
          setMessages(items);
          setHasMore(items.length >= 50);
          setLoading(false);
          void markFriendConversationRead(chatId).catch(() => undefined);
        }, (error) => { if (active) { setErrorKey(errorTranslationKey(mapFriendChatError(error))); setLoading(false); } });
      } catch (error) {
        if (active) { setErrorKey(errorTranslationKey(mapFriendChatError(error))); setLoading(false); }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; unsubscribe(); setActiveFriendConversation(null); };
  }, [authLoading, chatId, user?.uid]);

  const title = useMemo(() => access && user?.uid
    ? getConversationDisplayTitle(access.conversation, user.uid, t("chat.unnamedGroup"))
    : t("chat.title"), [access, t, user?.uid]);
  const canSend = Boolean(access && (access.conversation.conversationType === "group" || access.directFriendshipActive));
  const trimmedLength = draft.trim().length;

  const send = useCallback(async () => {
    if (!chatId || sending || !canSend || trimmedLength === 0 || draft.length > CHAT_MESSAGE_LIMIT) return;
    const text = draft.trim();
    const clientMessageId = createChatClientMessageId();
    setDraft(""); setSending(true); setErrorKey(null);
    try { await sendFriendChatMessage(chatId, text, clientMessageId); }
    catch (error) { setDraft(text); setErrorKey(errorTranslationKey(mapFriendChatError(error))); }
    finally { setSending(false); }
  }, [canSend, chatId, draft, sending, trimmedLength]);

  const loadEarlier = useCallback(async () => {
    const first = messages[0];
    if (!access || !user?.uid || !chatId || !first?.createdAtTimestamp || !hasMore || loadingEarlier) return;
    setLoadingEarlier(true);
    try {
      const page = await loadEarlierFriendChatMessages(chatId, user.uid, first.createdAtTimestamp, access.blockedUserIds);
      setMessages((current) => [...page.messages.filter((item) => !current.some((existing) => existing.messageId === item.messageId)), ...current]);
      setHasMore(page.hasMore);
    } catch (error) { setErrorKey(errorTranslationKey(mapFriendChatError(error))); }
    finally { setLoadingEarlier(false); }
  }, [access, chatId, hasMore, loadingEarlier, messages, user?.uid]);

  const messageActions = (message: FriendChatMessage) => {
    if (!chatId || message.messageType === "system" || message.status === "removed") return;
    const mine = message.senderUserId === user?.uid;
    Alert.alert(mine ? t("chat.messageOptions") : t("chat.reportMessageTitle"), mine ? t("chat.messageOptionsBody") : t("chat.reportMessageBody"), [
      { text: t("common.cancel"), style: "cancel" },
      mine
        ? { text: t("chat.removeMessage"), style: "destructive", onPress: () => void removeOwnFriendChatMessage(chatId, message.messageId).catch(() => setErrorKey("chat.tryAgain")) }
        : { text: t("chat.report"), style: "destructive", onPress: () => void reportFriendChatMessage(chatId, message.messageId).then(() => Alert.alert(t("chat.reportSentTitle"), t("chat.reportSentBody"))).catch(() => setErrorKey("chat.tryAgain")) },
    ]);
  };

  if (authLoading || loading) return <ScreenWrapper><View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("chat.loadingConversation")}</Text></View></ScreenWrapper>;
  if (!access) return <ScreenWrapper><View style={styles.center}><Text style={styles.title}>{t("chat.cannotOpenTitle")}</Text><Text style={styles.body}>{t(errorKey ?? "chat.noAccess")}</Text><TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/(social)/chat")} style={styles.primary}><Text style={styles.primaryText}>{t("chat.backToChats")}</Text></TouchableOpacity></View></ScreenWrapper>;

  return (
    <ScreenWrapper>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0} style={styles.fill}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={t("chat.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity>
          <View style={styles.headerCopy}><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text><Text style={styles.headerMeta}>{access.conversation.conversationType === "group" ? t("chat.participants", { count: access.conversation.activeParticipantCount }) : t("chat.directConversation")}</Text></View>
          <TouchableOpacity accessibilityLabel={t("chat.conversationSettings")} accessibilityRole="button" onPress={() => router.push({ pathname: "/(social)/chat/manage", params: { conversationId: chatId } })} style={styles.iconButton}><MoreHorizontal color={Colors.textHeading} size={24} /></TouchableOpacity>
        </View>
        {errorKey ? <Card style={styles.errorCard}><Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text></Card> : null}
        {!access.directFriendshipActive && access.conversation.conversationType === "direct" ? <View style={styles.notice}><Text style={styles.noticeText}>{t("chat.friendshipEndedReadOnly")}</Text></View> : null}
        <FlatList
          ref={listRef}
          contentContainerStyle={messages.length ? styles.messages : styles.emptyMessages}
          data={messages}
          keyExtractor={(item) => item.messageId}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={hasMore ? <TouchableOpacity accessibilityRole="button" disabled={loadingEarlier} onPress={() => void loadEarlier()} style={styles.loadEarlier}>{loadingEarlier ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.loadEarlierText}>{t("chat.loadEarlier")}</Text>}</TouchableOpacity> : null}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyTitle}>{t("chat.noMessages")}</Text><Text style={styles.body}>{t("chat.noMessagesBody")}</Text></View>}
          onContentSizeChange={() => { if (messages.length <= 50) listRef.current?.scrollToEnd({ animated: false }); }}
          renderItem={({ item }) => <MessageBubble isMine={item.senderUserId === user?.uid} message={item} onPress={() => messageActions(item)} />}
        />
        <View style={styles.composer}>
          <View style={styles.inputWrap}>
            <TextInput editable={canSend && !sending} maxLength={CHAT_MESSAGE_LIMIT + 1} multiline onChangeText={setDraft} placeholder={canSend ? t("chat.messagePlaceholder") : t("chat.readOnlyPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={draft} />
            <Text style={[styles.counter, draft.length > CHAT_MESSAGE_LIMIT && styles.error]}>{CHAT_MESSAGE_LIMIT - draft.length}</Text>
          </View>
          <TouchableOpacity accessibilityLabel={sending ? t("chat.sending") : t("chat.send")} accessibilityRole="button" accessibilityState={{ busy: sending, disabled: !canSend || sending || !trimmedLength || draft.length > CHAT_MESSAGE_LIMIT }} disabled={!canSend || sending || !trimmedLength || draft.length > CHAT_MESSAGE_LIMIT} onPress={() => void send()} style={[styles.send, (!canSend || sending || !trimmedLength || draft.length > CHAT_MESSAGE_LIMIT) && styles.disabled]}>{sending ? <ActivityIndicator color={Colors.surface} /> : <Send color={Colors.surface} size={18} />}</TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

function MessageBubble({ message, isMine, onPress }: { message: FriendChatMessage; isMine: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  if (message.messageType === "system") return <Text style={styles.systemMessage}>{message.text}</Text>;
  const time = message.createdAt?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) ?? "";
  const sender = isMine ? t("chat.you") : message.senderDisplayName || t("chat.aFriend");
  const text = message.status === "removed" ? t("chat.messageRemoved") : message.text;
  return <TouchableOpacity accessibilityLabel={t("chat.messageAccessibility", { sender, text, time })} accessibilityHint={message.status === "active" ? t("chat.messageActionsHint") : undefined} accessibilityRole="button" activeOpacity={0.8} disabled={message.status === "removed"} onLongPress={onPress} style={[styles.messageRow, isMine && styles.mineRow]}><View style={[styles.bubble, isMine && styles.mineBubble]}>{!isMine && message.senderDisplayName ? <Text style={styles.sender}>{message.senderDisplayName}</Text> : null}<Text style={[styles.messageText, isMine && styles.mineText, message.status === "removed" && styles.removed]}>{text}</Text><Text style={[styles.time, isMine && styles.mineTime]}>{time}</Text></View></TouchableOpacity>;
}

function errorTranslationKey(error: ReturnType<typeof mapFriendChatError>) {
  if (error === "network") return "chat.networkError";
  if (error === "friendshipEnded") return "chat.friendshipEndedReadOnly";
  if (error === "blocked") return "chat.messagingBlocked";
  if (error === "removed") return "chat.membershipEnded";
  if (error === "permission") return "chat.noAccess";
  return "chat.tryAgain";
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, center: { alignItems: "center", flex: 1, gap: Spacing.sm, justifyContent: "center", padding: Spacing.xl },
  header: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", minHeight: 58, paddingHorizontal: Spacing.sm },
  iconButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }, headerCopy: { flex: 1 },
  headerTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 }, headerMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 26, textAlign: "center" }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.lg }, primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  errorCard: { borderColor: Colors.primary, borderWidth: 1, margin: Spacing.sm, marginBottom: 0 }, error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  notice: { backgroundColor: Colors.secondary, padding: Spacing.sm }, noticeText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  messages: { gap: Spacing.sm, padding: Spacing.md }, emptyMessages: { flexGrow: 1 }, loadEarlier: { alignItems: "center", minHeight: 40, justifyContent: "center" }, loadEarlierText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 }, messageRow: { alignItems: "flex-start" }, mineRow: { alignItems: "flex-end" },
  bubble: { backgroundColor: Colors.surface, borderRadius: Radius.button, maxWidth: "82%", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Shadow.card }, mineBubble: { backgroundColor: Colors.primary },
  sender: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 11, marginBottom: 2 }, messageText: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 21 }, mineText: { color: Colors.surface }, removed: { fontStyle: "italic", opacity: 0.75 },
  time: { alignSelf: "flex-end", color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 10, marginTop: 3 }, mineTime: { color: Colors.surface, opacity: 0.8 }, systemMessage: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, padding: Spacing.sm, textAlign: "center" },
  composer: { alignItems: "flex-end", backgroundColor: Colors.surface, borderTopColor: Colors.secondary, borderTopWidth: 1, flexDirection: "row", gap: Spacing.sm, padding: Spacing.sm }, inputWrap: { flex: 1 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, maxHeight: 110, minHeight: 44, paddingHorizontal: Spacing.md, paddingRight: 42, paddingVertical: 10 }, counter: { bottom: 6, color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 10, position: "absolute", right: 9 },
  send: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, height: 44, justifyContent: "center", width: 44 }, disabled: { opacity: 0.45 },
});
