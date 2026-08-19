import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "expo-router";
import { MoreHorizontal } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { MessageActionsModal, type MessageModalAction } from "@/components/MessageActionsModal";
import { VoiceMemoComposer } from "@/components/VoiceMemoComposer";
import { VoiceMemoPlayer, VoiceMemoUnavailable } from "@/components/VoiceMemoPlayer";
import { Card } from "@/components/Card";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { auth } from "@/config/firebase";
import {
  createClientMessageId,
  deletePrivateTeamMessage,
  finalizePrivateVoiceMessage,
  hidePrivateTeamMessageForCurrentUser,
  listenToPrivateTeamConversation,
  listenToNewestPrivateTeamMessagesPage,
  getOlderPrivateTeamMessagesPage,
  getPrivateTeamMessage,
  markPrivateTeamConversationRead,
  reserveVoiceUpload,
  sendPrivateTeamTextMessage,
  uploadReservedVoiceMemo,
} from "@/services/teamPrivateMessageService";
import type { TeamHistoryCursor } from "@/constants/teamHistoryPagination";
import { acknowledgeNotificationAfterOpen } from "@/services/notificationService";
import { isTeamVoiceAudioAvailable } from "@/services/teamVoiceAudioCapability";
import { deleteLocalVoiceMemo } from "@/services/voiceMemoFileService";
import { clearPersistedVoicePlaybackArtifacts } from "@/services/voicePlaybackCleanupService";
import { reportTeamContent, type TeamContentReportReason } from "@/services/contentModerationService";
import { findUnresolvedCoachPlaceholders } from "@/services/coachResourcesService";
import type { LocalVoiceMemoDraft, TeamPrivateConversation, TeamPrivateMessage } from "@/types/teamVoiceMessaging";

export function PrivateTeamMessageThread({
  conversationId,
  initialText = "",
  isTemplateDraft = false,
  notificationId = "",
  role,
  targetMessageId = "",
}: {
  conversationId: string;
  initialText?: string;
  isTemplateDraft?: boolean;
  notificationId?: string;
  role: "coach" | "parent";
  targetMessageId?: string;
}) {
  const { t } = useTranslation();
  const [conversation, setConversation] = useState<TeamPrivateConversation | null>(null);
  const [messages, setMessages] = useState<TeamPrivateMessage[]>([]);
  const [olderMessages, setOlderMessages] = useState<TeamPrivateMessage[]>([]);
  const [historyCursor, setHistoryCursor] = useState<TeamHistoryCursor | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [text, setText] = useState(() => initialText.slice(0, 2000));
  const [caption, setCaption] = useState("");
  const [voiceDraft, setVoiceDraft] = useState<LocalVoiceMemoDraft | null>(null);
  const [voiceComposerKey, setVoiceComposerKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [sendPhase, setSendPhase] = useState<"uploading" | "finalizing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<TeamPrivateMessage | null>(null);
  const voiceAudioAvailable = isTeamVoiceAudioAvailable();
  const clientId = useRef(createClientMessageId());
  const uploadCancel = useRef<(() => boolean) | null>(null);
  const sendInFlight = useRef(false);
  const deleteInFlight = useRef(false);
  const messageScrollRef = useRef<ScrollView>(null);
  const paginationInFlight = useRef(false);
  const paginationGeneration = useRef(0);
  const olderPageLoadedRef = useRef(false);
  const contentHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const olderAnchorRef = useRef<{ height: number; offset: number } | null>(null);
  const targetResolvedRef = useRef(!targetMessageId);
  const acknowledgedNotificationIds = useRef(new Set<string>());
  const keyboardVisibleRef = useRef(false);
  const keyboardTopRef = useRef<number | null>(null);
  const composerBoundaryRef = useRef<View>(null);
  const composerKeyboardOverlapRef = useRef(0);
  const [composerKeyboardOverlap, setComposerKeyboardOverlap] = useState(0);

  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => messageScrollRef.current?.scrollToEnd({ animated }));
  }, []);

  const updateComposerKeyboardOverlap = useCallback(() => {
    const keyboardTop = keyboardTopRef.current;
    if (keyboardTop == null) return;
    requestAnimationFrame(() => {
      composerBoundaryRef.current?.measureInWindow((_x, y, _width, height) => {
        const unadjustedBottom = y + height + composerKeyboardOverlapRef.current;
        const nextOverlap = Math.max(0, unadjustedBottom - keyboardTop);
        if (Math.abs(nextOverlap - composerKeyboardOverlapRef.current) < 0.5) return;
        composerKeyboardOverlapRef.current = nextOverlap;
        setComposerKeyboardOverlap(nextOverlap);
      });
    });
  }, []);

  useEffect(() => listenToPrivateTeamConversation(conversationId, setConversation, () => setError(t("teamMessages.loadError"))), [conversationId, t]);
  useEffect(() => {
    const generation = ++paginationGeneration.current;
    setOlderMessages([]);
    setMessages([]);
    setHistoryCursor(null);
    setHasOlderMessages(false);
    paginationInFlight.current = false;
    olderPageLoadedRef.current = false;
    return listenToNewestPrivateTeamMessagesPage(conversationId, (page) => {
      if (generation !== paginationGeneration.current) return;
      setMessages(page.messages);
      setHistoryCursor((current) => current ?? page.nextCursor);
      if (!olderPageLoadedRef.current) setHasOlderMessages(page.hasMore);
      if (targetResolvedRef.current) void markPrivateTeamConversationRead(conversationId).catch(() => {});
    }, () => setError(t("teamMessages.loadError")));
  }, [conversationId, t]);
  useEffect(() => {
    targetResolvedRef.current = !targetMessageId;
    if (!targetMessageId) return () => {};
    let active = true;
    void getPrivateTeamMessage(conversationId, targetMessageId).then((target) => {
      if (!active) return;
      if (!target) {
        setError(t("teamMessages.targetUnavailable"));
        return;
      }
      setOlderMessages((current) => mergeThreadMessages(current, [target]));
      targetResolvedRef.current = true;
      void markPrivateTeamConversationRead(conversationId).catch(() => {});
      if (notificationId && !acknowledgedNotificationIds.current.has(notificationId)) {
        acknowledgedNotificationIds.current.add(notificationId);
        void acknowledgeNotificationAfterOpen(notificationId);
      }
    }).catch(() => {
      if (active) setError(t("teamMessages.targetUnavailable"));
    });
    return () => { active = false; };
  }, [conversationId, notificationId, t, targetMessageId]);
  useFocusEffect(useCallback(() => {
    if (targetResolvedRef.current) void markPrivateTeamConversationRead(conversationId).catch(() => {});
  }, [conversationId]));
  useEffect(() => () => { uploadCancel.current?.(); }, []);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      keyboardVisibleRef.current = true;
      keyboardTopRef.current = Platform.OS === "android" ? event.endCoordinates.screenY : null;
      scrollToLatest(false);
      if (Platform.OS === "android") updateComposerKeyboardOverlap();
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
      keyboardTopRef.current = null;
      composerKeyboardOverlapRef.current = 0;
      setComposerKeyboardOverlap(0);
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollToLatest, updateComposerKeyboardOverlap]);

  const otherName = useMemo(() => {
    const displayName = role === "coach" ? conversation?.parentDisplayName : conversation?.coachDisplayName;
    const profileState = role === "coach" ? conversation?.parentProfileState : conversation?.coachProfileState;
    return displayName || t(profileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember");
  }, [conversation, role, t]);
  const readOnly = conversation?.status === "readOnly";
  const visibleMessages = useMemo(
    () => mergeThreadMessages(olderMessages, messages),
    [messages, olderMessages],
  );
  const unresolvedTemplatePlaceholders = useMemo(
    () => isTemplateDraft ? findUnresolvedCoachPlaceholders(text) : [],
    [isTemplateDraft, text],
  );

  const loadOlderMessages = useCallback(async () => {
    if (!historyCursor || !hasOlderMessages || paginationInFlight.current) return;
    const generation = paginationGeneration.current;
    paginationInFlight.current = true;
    olderAnchorRef.current = { height: contentHeightRef.current, offset: scrollOffsetRef.current };
    setLoadingOlder(true);
    setError(null);
    try {
      const page = await getOlderPrivateTeamMessagesPage(conversationId, historyCursor);
      if (generation !== paginationGeneration.current) return;
      olderPageLoadedRef.current = true;
      setOlderMessages((current) => mergeThreadMessages(page.messages, current));
      setHistoryCursor(page.nextCursor);
      setHasOlderMessages(page.hasMore);
    } catch {
      if (generation === paginationGeneration.current) setError(t("teamMessages.loadError"));
    } finally {
      if (generation === paginationGeneration.current) {
        paginationInFlight.current = false;
        setLoadingOlder(false);
      }
    }
  }, [conversationId, hasOlderMessages, historyCursor, t]);

  const sendText = useCallback(async () => {
    if (!text.trim() || sending || sendInFlight.current || readOnly) return;
    if (unresolvedTemplatePlaceholders.length > 0) {
      setError(t("coach.resources.unresolvedBody", {
        placeholders: unresolvedTemplatePlaceholders.map((key) => `{${key}}`).join(", "),
      }));
      return;
    }
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
  }, [conversationId, readOnly, sending, t, text, unresolvedTemplatePlaceholders]);

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
    let voicePhase: "reserving" | "uploading" | "finalizing" = "reserving";
    try {
      const reservation = await reserveVoiceUpload({
        teamId: conversation.teamId,
        kind: "privateMessage",
        conversationId,
        clientMessageId: clientId.current,
        caption,
        voiceMemo: voiceDraft,
      });
      voicePhase = "uploading";
      const upload = await uploadReservedVoiceMemo(reservation, voiceDraft, setUploadProgress);
      uploadCancel.current = () => upload.task.cancel();
      await upload.completion;
      voicePhase = "finalizing";
      setSendPhase("finalizing");
      await finalizePrivateVoiceMessage(reservation.reservationId);
      await deleteLocalVoiceMemo(voiceDraft.uri);
      setCaption("");
      setVoiceDraft(null);
      setVoiceComposerKey((value) => value + 1);
      setMode("text");
      clientId.current = createClientMessageId();
    } catch (nextError) {
      console.warn("[PrivateTeamMessageThread] voice send", getErrorCode(nextError));
      setError(voicePhase === "uploading" ? t("voiceMemo.uploadError") : resolveSendError(nextError, t));
    } finally {
      uploadCancel.current = null;
      setUploadProgress(null);
      setSendPhase(null);
      setSending(false);
      sendInFlight.current = false;
    }
  }, [caption, conversation, conversationId, readOnly, sending, t, voiceDraft]);

  const submitReport = useCallback(async (messageId: string, reason: TeamContentReportReason) => {
    if (!conversation?.teamId) throw new Error("missing_team");
    await reportTeamContent({
      kind: "privateTeamMessage",
      teamId: conversation.teamId,
      parentId: conversationId,
      contentId: messageId,
      reason,
    });
  }, [conversation?.teamId, conversationId]);

  const deleteMessage = useCallback(async (message: TeamPrivateMessage) => {
    if (
      deleteInFlight.current ||
      message.isDeleted ||
      message.senderUserId !== auth.currentUser?.uid
    ) return;
    deleteInFlight.current = true;
    setError(null);
    try {
      if (message.voiceMemo) {
        await clearPersistedVoicePlaybackArtifacts({
          kind: "persisted-message",
          messageId: message.id,
          messageKind: "privateMessage",
          storagePath: message.voiceMemo.storagePath,
        });
      }
      await deletePrivateTeamMessage(conversationId, message.id);
    } catch {
      throw new Error("delete_failed");
    } finally {
      deleteInFlight.current = false;
    }
  }, [conversationId]);

  const hideMessage = useCallback(async (message: TeamPrivateMessage) => {
    if (deleteInFlight.current || message.senderUserId === auth.currentUser?.uid) return;
    deleteInFlight.current = true;
    setError(null);
    try {
      if (message.voiceMemo) {
        await clearPersistedVoicePlaybackArtifacts({
          kind: "persisted-message",
          messageId: message.id,
          messageKind: "privateMessage",
          storagePath: message.voiceMemo.storagePath,
        });
      }
      await hidePrivateTeamMessageForCurrentUser(conversationId, message.id);
    } catch {
      throw new Error("hide_failed");
    } finally {
      deleteInFlight.current = false;
    }
  }, [conversationId]);

  const selectedMine = actionMessage?.senderUserId === auth.currentUser?.uid;
  const selectedActions = useMemo<MessageModalAction[]>(() => {
    if (!actionMessage) return [];
    if (selectedMine) {
      if (actionMessage.isDeleted) return [];
      return [{
        confirmation: {
          body: t("teamMessages.deleteForEveryoneBody"),
          confirmLabel: t("common.delete"),
          title: t("teamMessages.deleteForEveryoneTitle"),
        },
        destructive: true,
        errorMessage: t("teamMessages.deleteError"),
        id: "delete-for-everyone",
        label: t("teamMessages.deleteForEveryone"),
        onPress: () => deleteMessage(actionMessage),
      }];
    }
    return [{
      confirmation: {
        body: t("teamMessages.deleteForMeBody"),
        confirmLabel: t("common.delete"),
        title: t("teamMessages.deleteForMeTitle"),
      },
      destructive: true,
      errorMessage: t("teamMessages.deleteError"),
      id: "delete-for-me",
      label: t("teamMessages.deleteForMe"),
      onPress: () => hideMessage(actionMessage),
    }];
  }, [actionMessage, deleteMessage, hideMessage, selectedMine, t]);

  return (
    <View style={styles.container}>
      <ScrollView
        ref={messageScrollRef}
        contentContainerStyle={styles.threadContent}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={(_width, height) => {
          const anchor = olderAnchorRef.current;
          contentHeightRef.current = height;
          if (anchor) {
            olderAnchorRef.current = null;
            messageScrollRef.current?.scrollTo({ animated: false, y: anchor.offset + Math.max(0, height - anchor.height) });
          } else if (keyboardVisibleRef.current) {
            scrollToLatest(false);
          }
        }}
        onLayout={() => {
          if (keyboardVisibleRef.current) scrollToLatest(false);
        }}
        onScroll={(event) => { scrollOffsetRef.current = event.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
        style={styles.messageScroll}
      >
        <Card style={styles.identityCard}>
          <Text style={styles.name}>{conversation?.teamName ?? t("teamMessages.teamFallback")}</Text>
          <Text style={styles.team}>{otherName}</Text>
          <Text style={styles.privateLabel}>{t("teamMessages.privateLabel")}</Text>
          <Text style={styles.privacy}>{t("teamMessages.privacy")}</Text>
        </Card>

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {readOnly ? <Card style={styles.readOnlyCard}><Text style={styles.error}>{t("teamMessages.readOnly")}</Text></Card> : null}

        <View style={styles.messages}>
          {hasOlderMessages ? (
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: loadingOlder }} disabled={loadingOlder} onPress={() => { void loadOlderMessages(); }} style={styles.loadOlderButton}>
              {loadingOlder ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.loadOlderText}>{t("teamMessages.loadOlder")}</Text>}
            </TouchableOpacity>
          ) : null}
          {visibleMessages.length === 0 ? <Text style={styles.empty}>{t("teamMessages.empty")}</Text> : null}
          {visibleMessages.map((message) => {
            const mine = message.senderUserId === auth.currentUser?.uid;
            return (
              <View key={message.id} style={[styles.bubble, message.contentType === "voice" && !message.isDeleted && styles.voiceBubble, mine ? styles.mine : styles.theirs]}>
                <View style={styles.messageHeader}>
                  <Text style={styles.sender}>{mine ? t("teamMessages.you") : otherName}</Text>
                  {(mine ? !message.isDeleted : true) ? (
                    <TouchableOpacity
                      accessibilityLabel={t("teamMessages.messageActions")}
                      accessibilityRole="button"
                      onPress={() => setActionMessage(message)}
                      style={styles.messageActions}
                    >
                      <MoreHorizontal accessible={false} color={Colors.primary} size={20} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                {message.isDeleted ? (
                  <Text accessibilityLiveRegion="polite" style={styles.deletedMessage}>
                    {message.isModerated
                      ? t("teamMessages.contentRemoved")
                      : mine
                        ? t("teamMessages.youDeletedMessage")
                        : t("teamMessages.messageDeleted")}
                  </Text>
                ) : message.contentType === "voice" && message.voiceMemo ? (
                  <VoiceMemoPlayer
                    durationMilliseconds={message.voiceMemo.durationMilliseconds}
                    isOwnMessage={mine}
                    source={{
                      kind: "persisted-message",
                      messageId: message.id,
                      messageKind: "privateMessage",
                      storagePath: message.voiceMemo.storagePath,
                    }}
                  />
                ) : message.contentType === "voice"
                  ? <VoiceMemoUnavailable />
                  : <Text style={styles.messageText}>{message.text}</Text>}
                {!message.isDeleted && message.caption ? <Text style={styles.caption}>{message.caption}</Text> : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <MessageActionsModal
        actions={selectedActions}
        onDismiss={() => setActionMessage(null)}
        report={!selectedMine && actionMessage && !actionMessage.isDeleted
          ? {
            errorMessage: t("moderation.reportError"),
            onSubmit: (reason) => submitReport(actionMessage.id, reason),
            successBody: t("moderation.reportSentBody"),
            successTitle: t("moderation.reportSentTitle"),
          }
          : undefined}
        visible={Boolean(actionMessage)}
      />

      {!readOnly ? (
        <View
          collapsable={false}
          onLayout={updateComposerKeyboardOverlap}
          ref={composerBoundaryRef}
          style={composerKeyboardOverlap > 0 ? { marginBottom: composerKeyboardOverlap } : undefined}
        >
        <Card style={styles.composer}>
          <View accessibilityRole="tablist" style={styles.tabs}>
            {(["text", "voice"] as const).map((nextMode) => (
              <TouchableOpacity accessibilityRole="tab" accessibilityState={{ disabled: nextMode === "voice" && !voiceAudioAvailable, selected: mode === nextMode }} disabled={nextMode === "voice" && !voiceAudioAvailable} key={nextMode} onPress={() => setMode(nextMode)} style={[styles.tab, mode === nextMode && styles.tabActive, nextMode === "voice" && !voiceAudioAvailable && styles.disabled]}>
                <Text style={[styles.tabText, mode === nextMode && styles.tabTextActive]}>{t(`teamMessages.${nextMode}Mode`)}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!voiceAudioAvailable ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t("voiceMemo.updatedBuildRequired")}</Text> : null}
          {mode === "text" ? <TextInput maxLength={2000} multiline onChangeText={(value) => { setText(value); if (error) setError(null); }} onContentSizeChange={() => scrollToLatest(false)} onFocus={() => scrollToLatest(false)} placeholder={t("teamMessages.messagePlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={text} /> : null}
          {voiceAudioAvailable ? <View style={mode === "voice" ? undefined : styles.hidden}>
            <VoiceMemoComposer active={mode === "voice"} disabled={sending} key={voiceComposerKey} onChange={setVoiceDraft} uploadProgress={uploadProgress} />
            <TextInput maxLength={500} multiline onChangeText={setCaption} onContentSizeChange={() => scrollToLatest(false)} onFocus={() => scrollToLatest(false)} placeholder={t("teamMessages.captionPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={caption} />
          </View> : null}
          {sendPhase === "finalizing" ? <Text accessibilityLiveRegion="polite" style={styles.cancel}>{t("voiceMemo.finalizing")}</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={sending || (mode === "text" ? !text.trim() : !voiceDraft)} onPress={mode === "text" ? sendText : sendVoice} style={[styles.send, (sending || (mode === "text" ? !text.trim() : !voiceDraft)) && styles.disabled]}>
            {sending ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.sendText}>{t("teamMessages.send")}</Text>}
          </TouchableOpacity>
          {uploadProgress != null ? <TouchableOpacity accessibilityRole="button" onPress={() => uploadCancel.current?.()}><Text style={styles.cancel}>{t("voiceMemo.cancelUpload")}</Text></TouchableOpacity> : null}
        </Card>
        </View>
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

function mergeThreadMessages(...groups: TeamPrivateMessage[][]) {
  const byId = new Map<string, TeamPrivateMessage>();
  groups.flat().forEach((message) => byId.set(message.id, message));
  return Array.from(byId.values()).sort((first, second) => {
    const time = messageMillis(first.createdAt) - messageMillis(second.createdAt);
    return time || first.id.localeCompare(second.id);
  });
}

function messageMillis(value: unknown) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  container: { flex: 1, gap: Spacing.md },
  messageScroll: { flex: 1 },
  threadContent: { gap: Spacing.md, paddingBottom: Spacing.xs },
  identityCard: { gap: 3 },
  privateLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12, textTransform: "uppercase" },
  name: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 20 },
  team: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold },
  privacy: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17, marginTop: Spacing.xs },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  readOnlyCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4 },
  messages: { gap: Spacing.sm },
  loadOlderButton: { alignItems: "center", alignSelf: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  loadOlderText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  empty: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, paddingVertical: Spacing.lg, textAlign: "center" },
  bubble: { borderRadius: Radius.card, gap: Spacing.xs, maxWidth: "92%", padding: Spacing.md, width: "auto" },
  voiceBubble: { width: "92%" },
  mine: { alignSelf: "flex-end", backgroundColor: Colors.background, borderColor: Colors.primary, borderWidth: 1 },
  theirs: { alignSelf: "flex-start", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderWidth: 1 },
  sender: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12 },
  messageHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 28 },
  messageActions: { alignItems: "center", justifyContent: "center", minHeight: 36, minWidth: 36 },
  messageText: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 21 },
  deletedMessage: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, fontStyle: "italic", lineHeight: 20 },
  caption: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18 },
  composer: { gap: Spacing.md },
  tabs: { flexDirection: "row", gap: Spacing.sm },
  tab: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flex: 1, minHeight: 42, justifyContent: "center" },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  tabTextActive: { color: Colors.surface },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, maxHeight: 144, minHeight: 76, padding: Spacing.md, textAlignVertical: "top" },
  send: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46 },
  sendText: { color: Colors.surface, fontFamily: Typography.bodyBold },
  disabled: { opacity: 0.5 },
  cancel: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  hidden: { display: "none" },
});
