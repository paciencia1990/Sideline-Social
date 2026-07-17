import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system";
import { useTranslation } from "react-i18next";

import { VoiceMemoComposer } from "@/components/VoiceMemoComposer";
import { VoiceMemoPlayer } from "@/components/VoiceMemoPlayer";
import { Card } from "@/components/Card";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { auth } from "@/config/firebase";
import {
  createClientMessageId,
  finalizePrivateVoiceMessage,
  listenToPrivateTeamConversation,
  listenToPrivateTeamMessages,
  markPrivateTeamConversationRead,
  reserveVoiceUpload,
  sendPrivateTeamTextMessage,
  uploadReservedVoiceMemo,
} from "@/services/teamPrivateMessageService";
import type { LocalVoiceMemoDraft, TeamPrivateConversation, TeamPrivateMessage } from "@/types/teamVoiceMessaging";

export function PrivateTeamMessageThread({ conversationId, role }: { conversationId: string; role: "coach" | "parent" }) {
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<TeamPrivateConversation | null>(null);
  const [messages, setMessages] = useState<TeamPrivateMessage[]>([]);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [text, setText] = useState("");
  const [caption, setCaption] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<LocalVoiceMemoDraft | null>(null);
  const [voiceComposerKey, setVoiceComposerKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [sendPhase, setSendPhase] = useState<"uploading" | "finalizing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const clientId = useRef(createClientMessageId());
  const uploadCancel = useRef<(() => boolean) | null>(null);
  const sendInFlight = useRef(false);

  useEffect(() => listenToPrivateTeamConversation(conversationId, setConversation, () => setError(t("teamMessages.loadError"))), [conversationId, t]);
  useEffect(() => listenToPrivateTeamMessages(conversationId, (next) => {
    setMessages(next);
    void markPrivateTeamConversationRead(conversationId).catch(() => {});
  }, () => setError(t("teamMessages.loadError"))), [conversationId, t]);
  useFocusEffect(useCallback(() => {
    void markPrivateTeamConversationRead(conversationId).catch(() => {});
  }, [conversationId]));
  useEffect(() => () => { uploadCancel.current?.(); }, []);

  const otherName = useMemo(() => role === "coach" ? conversation?.parentDisplayName : conversation?.coachDisplayName, [conversation, role]);
  const readOnly = conversation?.status === "readOnly";

  const sendText = useCallback(async () => {
    if (!text.trim() || sending || sendInFlight.current || readOnly) return;
    sendInFlight.current = true;
    setSending(true);
    setError(null);
    try {
      await sendPrivateTeamTextMessage(conversationId, text, clientId.current);
      setText("");
      clientId.current = createClientMessageId();
    } catch (nextError) {
      console.warn("[PrivateTeamMessageThread] text send", getErrorCode(nextError));
      setError(resolveSendError(nextError, t));
    } finally {
      setSending(false);
      sendInFlight.current = false;
    }
  }, [conversationId, readOnly, sending, t, text]);

  const sendVoice = useCallback(async () => {
    if (!conversation || !voiceDraft || !voiceDraft.previewed || sending || sendInFlight.current || readOnly) {
      if (voiceDraft && !voiceDraft.previewed) setError(t("voiceMemo.previewRequired"));
      return;
    }
    sendInFlight.current = true;
    setSending(true);
    setUploadProgress(0);
    setSendPhase("uploading");
    setError(null);
    try {
      const reservation = await reserveVoiceUpload({
        teamId: conversation.teamId,
        kind: "privateMessage",
        conversationId,
        clientMessageId: clientId.current,
        caption,
        voiceMemo: voiceDraft,
      });
      const upload = await uploadReservedVoiceMemo(reservation, voiceDraft, setUploadProgress);
      uploadCancel.current = () => upload.task.cancel();
      await upload.completion;
      setSendPhase("finalizing");
      await finalizePrivateVoiceMessage(reservation.reservationId);
      await FileSystem.deleteAsync(voiceDraft.uri, { idempotent: true });
      setCaption("");
      setVoiceDraft(null);
      setVoiceComposerKey((value) => value + 1);
      setMode("text");
      clientId.current = createClientMessageId();
    } catch (nextError) {
      console.warn("[PrivateTeamMessageThread] voice send", getErrorCode(nextError));
      setError(resolveSendError(nextError, t));
    } finally {
      uploadCancel.current = null;
      setUploadProgress(null);
      setSendPhase(null);
      setSending(false);
      sendInFlight.current = false;
    }
  }, [caption, conversation, conversationId, readOnly, sending, t, voiceDraft]);

  return (
    <View style={styles.container}>
      <Card style={styles.identityCard}>
        <Text style={styles.name}>{conversation?.teamName ?? t("teamMessages.teamFallback")}</Text>
        <Text style={styles.team}>{otherName ?? t("teamMessages.participantFallback")}</Text>
        <Text style={styles.privateLabel}>{t("teamMessages.privateLabel")}</Text>
        <Text style={styles.privacy}>{t("teamMessages.privacy")}</Text>
      </Card>

      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      {readOnly ? <Card style={styles.readOnlyCard}><Text style={styles.error}>{t("teamMessages.readOnly")}</Text></Card> : null}

      <View style={styles.messages}>
        {messages.length === 0 ? <Text style={styles.empty}>{t("teamMessages.empty")}</Text> : null}
        {messages.map((message) => {
          const mine = message.senderUserId === auth.currentUser?.uid;
          return (
            <View key={message.id} style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
              <Text style={styles.sender}>{mine ? t("teamMessages.you") : otherName}</Text>
              {message.contentType === "voice" && message.voiceMemo ? (
                <VoiceMemoPlayer durationMilliseconds={message.voiceMemo.durationMilliseconds} storagePath={message.voiceMemo.storagePath} />
              ) : <Text style={styles.messageText}>{message.text}</Text>}
              {message.caption ? <Text style={styles.caption}>{message.caption}</Text> : null}
            </View>
          );
        })}
      </View>

      {!readOnly ? (
        <Card style={styles.composer}>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {(["text", "voice"] as const).map((nextMode) => (
              <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: mode === nextMode }} key={nextMode} onPress={() => setMode(nextMode)} style={[styles.tab, mode === nextMode && styles.tabActive]}>
                <Text style={[styles.tabText, mode === nextMode && styles.tabTextActive]}>{t(`teamMessages.${nextMode}Mode`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {mode === "text" ? <TextInput maxLength={2000} multiline onChangeText={setText} placeholder={t("teamMessages.messagePlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={text} /> : null}
          <View style={mode === "voice" ? undefined : styles.hidden}>
            <VoiceMemoComposer active={mode === "voice"} disabled={sending} key={voiceComposerKey} onChange={setVoiceDraft} uploadProgress={uploadProgress} />
            <TextInput maxLength={500} multiline onChangeText={setCaption} placeholder={t("teamMessages.captionPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={caption} />
          </View>
          {sendPhase === "finalizing" ? <Text accessibilityLiveRegion="polite" style={styles.cancel}>{t("voiceMemo.finalizing")}</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={sending || (mode === "text" ? !text.trim() : !voiceDraft)} onPress={mode === "text" ? sendText : sendVoice} style={[styles.send, (sending || (mode === "text" ? !text.trim() : !voiceDraft)) && styles.disabled]}>
            {sending ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.sendText}>{t("teamMessages.send")}</Text>}
          </TouchableOpacity>
          {uploadProgress != null ? <TouchableOpacity accessibilityRole="button" onPress={() => uploadCancel.current?.()}><Text style={styles.cancel}>{t("voiceMemo.cancelUpload")}</Text></TouchableOpacity> : null}
        </Card>
      ) : null}
    </View>
  );
}

function resolveSendError(error: unknown, t: (key: string) => string) {
  const code = getErrorCode(error);
  if (code.includes("resource-exhausted")) return t("teamMessages.rateLimited");
  if (code.includes("failed-precondition")) return t("teamMessages.readOnly");
  return t("teamMessages.sendError");
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  container: { gap: Spacing.md },
  identityCard: { gap: 3 },
  privateLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12, textTransform: "uppercase" },
  name: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 20 },
  team: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold },
  privacy: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17, marginTop: Spacing.xs },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  readOnlyCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4 },
  messages: { gap: Spacing.sm },
  empty: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, paddingVertical: Spacing.lg, textAlign: "center" },
  bubble: { borderRadius: Radius.card, gap: Spacing.xs, maxWidth: "92%", padding: Spacing.md, width: "auto" },
  mine: { alignSelf: "flex-end", backgroundColor: Colors.background, borderColor: Colors.primary, borderWidth: 1 },
  theirs: { alignSelf: "flex-start", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderWidth: 1 },
  sender: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12 },
  messageText: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 21 },
  caption: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  composer: { gap: Spacing.md },
  tabs: { flexDirection: "row", gap: Spacing.sm },
  tab: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flex: 1, minHeight: 42, justifyContent: "center" },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  tabTextActive: { color: Colors.surface },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 76, padding: Spacing.md, textAlignVertical: "top" },
  send: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46 },
  sendText: { color: Colors.surface, fontFamily: Typography.bodyBold },
  disabled: { opacity: 0.5 },
  cancel: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  hidden: { display: "none" },
});
