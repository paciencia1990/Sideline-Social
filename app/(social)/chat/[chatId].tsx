import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type FlatList as FlatListType,
} from "react-native";
import { ArrowLeft, Send } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  getChatById,
  getChatDisplayTitle,
  listenToChatMessages,
  markChatRead,
  sendMessage,
  type ChatMessage,
  type ChatSummary,
} from "@/services/chatService";

function formatMessageTime(value: Date | null): string {
  if (!value) return "";
  return value.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function MessageBubble({ message, isMine }: { message: ChatMessage; isMine: boolean }) {
  return (
    <View style={[styles.messageRow, isMine && styles.myMessageRow]}>
      <View style={[styles.messageBubble, isMine && styles.myMessageBubble]}>
        {!isMine ? <Text style={styles.senderName}>{message.senderName}</Text> : null}
        <Text style={[styles.messageText, isMine && styles.myMessageText]}>{message.text}</Text>
        <Text style={[styles.messageTime, isMine && styles.myMessageTime]}>{formatMessageTime(message.createdAt)}</Text>
      </View>
    </View>
  );
}

export default function ChatConversationScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const listRef = useRef<FlatListType<ChatMessage>>(null);

  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const title = useMemo(() => {
    if (!chat || !user?.uid) return t("chat.title");
    return getChatDisplayTitle(chat, user.uid);
  }, [chat, t, user?.uid]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid || !chatId) {
      setLoading(false);
      return;
    }

    let unsubscribe = () => {};
    let mounted = true;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const nextChat = await getChatById(chatId);
        if (!mounted) return;

        if (!nextChat) {
          setError(t("chat.missingChat"));
          setLoading(false);
          return;
        }

        if (!nextChat.participantIds.includes(user.uid)) {
          setError(t("chat.noAccess"));
          setLoading(false);
          return;
        }

        setChat(nextChat);
        await markChatRead(chatId);
        unsubscribe = listenToChatMessages(
          chatId,
          (nextMessages) => {
            setMessages(nextMessages);
            setLoading(false);
          },
          () => {
            setError(t("chat.errorBody"));
            setLoading(false);
          }
        );
      } catch (nextError) {
        console.warn("[ChatConversationScreen] load error:", nextError);
        if (!mounted) return;
        setError(nextError instanceof Error ? nextError.message : t("chat.errorBody"));
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [authLoading, chatId, t, user?.uid]);

  const handleSend = useCallback(async () => {
    if (!chatId || sending || !draft.trim()) return;
    const text = draft;
    setDraft("");
    setSending(true);
    setError(null);
    try {
      await sendMessage(chatId, text);
    } catch (nextError) {
      setDraft(text);
      setError(nextError instanceof Error ? nextError.message : t("chat.errorBody"));
    } finally {
      setSending(false);
    }
  }, [chatId, draft, sending, t]);

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
          <Text style={styles.title}>{t("chat.title")}</Text>
          <Text style={styles.stateText}>{t("chat.signInRequired")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  if (error && !chat) {
    return (
      <ScreenWrapper>
        <View style={styles.centeredState}>
          <Text style={styles.title}>{t("chat.errorTitle")}</Text>
          <Text style={styles.stateText}>{error}</Text>
          <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={() => router.back()} style={styles.backButtonLarge}>
            <Text style={styles.backButtonLargeText}>{t("chat.back")}</Text>
          </TouchableOpacity>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
        style={styles.keyboardView}
      >
        <View style={styles.header}>
          <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft size={22} color={Colors.textHeading} />
          </TouchableOpacity>
          <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
        </View>

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorBody}>{error}</Text>
          </Card>
        ) : null}

        <FlatList
          ref={listRef}
          contentContainerStyle={messages.length === 0 ? styles.emptyMessages : styles.messageList}
          data={messages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => <MessageBubble message={item} isMine={item.senderId === user.uid} />}
          ListEmptyComponent={
            <View style={styles.noMessagesWrap}>
              <Text style={styles.noMessagesTitle}>{t("chat.noMessages")}</Text>
              <Text style={styles.noMessagesBody}>{t("chat.noMessagesBody")}</Text>
            </View>
          }
        />

        <View style={styles.inputBar}>
          <TextInput
            multiline
            onChangeText={setDraft}
            placeholder={t("chat.messagePlaceholder")}
            placeholderTextColor={Colors.textPrimary}
            style={styles.input}
            value={draft}
          />
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t("chat.send")}
            activeOpacity={0.82}
            disabled={sending || !draft.trim()}
            onPress={handleSend}
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
          >
            {sending ? <ActivityIndicator color={Colors.surface} size="small" /> : <Send size={18} color={Colors.surface} />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderBottomColor: Colors.secondary,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 56,
    paddingHorizontal: Spacing.md,
  },
  backButton: {
    alignItems: "center",
    borderRadius: 20,
    height: 40,
    justifyContent: "center",
    marginRight: Spacing.sm,
    width: 40,
  },
  headerTitle: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
  },
  messageList: {
    gap: Spacing.sm,
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
  },
  emptyMessages: {
    flexGrow: 1,
    justifyContent: "center",
    padding: Spacing.xl,
  },
  messageRow: {
    alignItems: "flex-start",
  },
  myMessageRow: {
    alignItems: "flex-end",
  },
  messageBubble: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.button,
    maxWidth: "82%",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Shadow.card,
  },
  myMessageBubble: {
    backgroundColor: Colors.primary,
  },
  senderName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    marginBottom: 2,
  },
  messageText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    lineHeight: 21,
  },
  myMessageText: {
    color: Colors.surface,
  },
  messageTime: {
    alignSelf: "flex-end",
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 10,
    marginTop: 4,
  },
  myMessageTime: {
    color: Colors.surface,
    opacity: 0.8,
  },
  inputBar: {
    alignItems: "flex-end",
    backgroundColor: Colors.surface,
    borderTopColor: Colors.secondary,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  input: {
    backgroundColor: Colors.background,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    maxHeight: 110,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
  },
  sendButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  errorCard: {
    borderColor: Colors.primary,
    borderWidth: 1,
    margin: Spacing.md,
    marginBottom: 0,
  },
  errorBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  noMessagesWrap: {
    alignItems: "center",
    gap: Spacing.xs,
  },
  noMessagesTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
    textAlign: "center",
  },
  noMessagesBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  centeredState: {
    alignItems: "center",
    flex: 1,
    gap: Spacing.md,
    justifyContent: "center",
    padding: Spacing.xl,
  },
  title: {
    color: Colors.textHeading,
    fontFamily: Typography.heading,
    fontSize: 28,
    textAlign: "center",
  },
  stateText: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  backButtonLarge: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  backButtonLargeText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
});
