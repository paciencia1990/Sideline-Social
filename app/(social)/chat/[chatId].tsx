import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AccessibilityActionEvent,
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  ScrollView,
  Text,
  TextInput,
  Pressable,
  TouchableOpacity,
  View,
  type FlatList as FlatListType,
} from "react-native";
import * as Haptics from "expo-haptics";
import { ArrowLeft, Check, Forward, Image as ImageIcon, Mic, MoreHorizontal, Pin, Reply, Send, Star, StarOff, Trash2, X } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { Card } from "@/components/Card";
import { FriendChatExpandedReactionPicker } from "@/components/FriendChatExpandedReactionPicker";
import { FriendChatImageMessage } from "@/components/FriendChatImageMessage";
import { FriendChatReactionTray, type FriendChatReactionTrayAnchor } from "@/components/FriendChatReactionTray";
import { FriendChatSelectionOverflowMenu, type FriendChatOverflowAction } from "@/components/FriendChatSelectionOverflowMenu";
import { MessageActionsModal, type MessageModalAction } from "@/components/MessageActionsModal";
import { NestedBackButton } from "@/components/NestedBackButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { VoiceMemoComposer } from "@/components/VoiceMemoComposer";
import { VoiceMemoPlayer, VoiceMemoUnavailable } from "@/components/VoiceMemoPlayer";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  CHAT_MESSAGE_LIMIT,
  FRIEND_CHAT_FORWARD_MAX_DESTINATIONS,
  FRIEND_CHAT_QUICK_REACTIONS,
  FRIEND_CHAT_REACTIONS,
  FRIEND_CHAT_VOICE_LIMIT_MS,
  FRIEND_CHAT_VOICE_SIZE_LIMIT_BYTES,
  createChatClientMessageId,
  deleteFriendChatMessagesForMe,
  finalizeFriendChatImageMessage,
  finalizeFriendChatVoiceMessage,
  forwardFriendChatMessages,
  getConversationDisplayTitle,
  getFriendConversationAccess,
  listenToFriendChatMessages,
  loadEarlierFriendChatMessages,
  mapFriendChatError,
  markFriendConversationRead,
  pinFriendChatMessage,
  removeOwnFriendChatMessage,
  reportFriendChatMessage,
  reserveFriendChatImageUpload,
  reserveFriendChatVoiceUpload,
  sendFriendChatMessage,
  setActiveFriendConversation,
  setFriendChatMessagesStarred,
  subscribeToFriendConversations,
  toggleFriendChatReaction,
  unpinFriendChatMessage,
  uploadReservedFriendChatImage,
  uploadReservedFriendChatVoiceMemo,
  type ConversationAccess,
  type FriendConversationListItem,
  type FriendChatMessage,
  type FriendChatReactionEmoji,
  type FriendChatReplyContext,
} from "@/services/chatService";
import {
  acknowledgeFriendChatImagePickerResult,
  claimFriendChatImagePickerResult,
  deleteFriendChatImageDraft,
  discardFriendChatImagePickerOperation,
  pickFriendChatImageDraft,
  recoverFriendChatImageDraft,
  releaseFriendChatImagePickerResult,
  type FriendChatImageRecoveryResult,
  type LocalFriendChatImageDraft,
} from "@/services/friendChatImageService";
import { saveFriendChatPhoto } from "@/services/friendChatPhotoSaveService";
import { deleteLocalVoiceMemo } from "@/services/voiceMemoFileService";
import { clearPersistedVoicePlaybackArtifacts } from "@/services/voicePlaybackCleanupService";
import type { LocalVoiceMemoDraft } from "@/types/teamVoiceMessaging";
import { FriendChatPhotoSaveError } from "@/utils/friendChatPhotoSaveCore";
import {
  friendChatSendStatusTranslationKey,
  type FriendChatSendStatus,
} from "@/utils/friendChatSendStatusCore";

type ReactionTrayState = { anchor: FriendChatReactionTrayAnchor; messageId: string };
type ReplyDraft = FriendChatReplyContext;

function isFriendChatMessageInteractive(message: FriendChatMessage | null | undefined) {
  return Boolean(message && message.status === "active" && message.messageType !== "system" && !message.isModerated);
}

function isFriendChatMessageForwardable(message: FriendChatMessage | null | undefined) {
  if (!isFriendChatMessageInteractive(message)) return false;
  if (message?.messageType === "image") return Boolean(message.image);
  return message?.messageType === "text";
}

export default function FriendConversationScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const { chatId: rawChatId } = useLocalSearchParams<{ chatId?: string | string[] }>();
  const chatId = Array.isArray(rawChatId) ? rawChatId[0] : rawChatId;
  const listRef = useRef<FlatListType<FriendChatMessage>>(null);
  const keyboardVisibleRef = useRef(false);
  const imageDraftRef = useRef<LocalFriendChatImageDraft | null>(null);
  const imagePickerInFlightRef = useRef(false);
  const handledImagePickerOperationsRef = useRef(new Set<string>());
  const recoveredImagePickerContextRef = useRef<string | null>(null);
  const screenActiveRef = useRef(true);
  const currentChatIdRef = useRef(chatId);
  const currentUserIdRef = useRef(user?.uid);
  const overflowButtonRef = useRef<View>(null);
  const forwardClientMessageIdRef = useRef<string | null>(null);
  const photoSaveInFlightRef = useRef<string | null>(null);
  const reactionSubmittingRef = useRef(false);
  const uploadCancel = useRef<(() => unknown) | null>(null);
  const voiceDraftRef = useRef<LocalVoiceMemoDraft | null>(null);
  const sendInFlight = useRef(false);
  const [access, setAccess] = useState<ConversationAccess | null>(null);
  const [accessResolvedChatId, setAccessResolvedChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FriendChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<LocalVoiceMemoDraft | null>(null);
  const [voiceAutoStartKey, setVoiceAutoStartKey] = useState(0);
  const [voiceComposerKey, setVoiceComposerKey] = useState(0);
  const [imageDraft, setImageDraft] = useState<LocalFriendChatImageDraft | null>(null);
  const [imagePickerBusy, setImagePickerBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<FriendChatSendStatus | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<FriendChatMessage | null>(null);
  const [deleteSelectionVisible, setDeleteSelectionVisible] = useState(false);
  const [forwardConversationIds, setForwardConversationIds] = useState<string[]>([]);
  const [forwardConversations, setForwardConversations] = useState<FriendConversationListItem[]>([]);
  const [forwardMessageIds, setForwardMessageIds] = useState<string[]>([]);
  const [forwardVisible, setForwardVisible] = useState(false);
  const [overflowAnchor, setOverflowAnchor] = useState<FriendChatReactionTrayAnchor | null>(null);
  const [reactionPickerVisible, setReactionPickerVisible] = useState(false);
  const [reactionSubmitting, setReactionSubmitting] = useState(false);
  const [reactionTray, setReactionTray] = useState<ReactionTrayState | null>(null);
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [savingPhotoMessageId, setSavingPhotoMessageId] = useState<string | null>(null);
  const [unavailableImageMessageIds, setUnavailableImageMessageIds] = useState<string[]>([]);

  const scrollToLatest = useCallback((animated: boolean) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);
  const dismissReactionTray = useCallback(() => setReactionTray(null), []);
  const clearSelection = useCallback(() => {
    forwardClientMessageIdRef.current = null;
    setSelectedMessageIds([]);
    setOverflowAnchor(null);
    setReactionPickerVisible(false);
    setReactionTray(null);
  }, []);

  const selectedMessages = useMemo(() => {
    const selected = new Set(selectedMessageIds);
    return messages.filter((message) => selected.has(message.messageId));
  }, [messages, selectedMessageIds]);
  const selectionMode = selectedMessageIds.length > 0;

  useEffect(() => { imageDraftRef.current = imageDraft; }, [imageDraft]);
  useEffect(() => { voiceDraftRef.current = voiceDraft; }, [voiceDraft]);
  useEffect(() => { currentChatIdRef.current = chatId; }, [chatId]);
  useEffect(() => { currentUserIdRef.current = user?.uid; }, [user?.uid]);
  useEffect(() => {
    const activeImageIds = new Set(messages
      .filter((message) => message.status === "active" && message.messageType === "image")
      .map((message) => message.messageId));
    setUnavailableImageMessageIds((ids) => ids.filter((id) => activeImageIds.has(id)));
  }, [messages]);
  useEffect(() => () => {
    screenActiveRef.current = false;
    uploadCancel.current?.();
    void deleteFriendChatImageDraft(imageDraftRef.current);
    if (voiceDraftRef.current?.uri) void deleteLocalVoiceMemo(voiceDraftRef.current.uri);
  }, []);

  useEffect(() => {
    if (!selectionMode) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      clearSelection();
      return true;
    });
    return () => subscription.remove();
  }, [clearSelection, selectionMode]);

  useEffect(() => {
    if (!selectionMode) return;
    const visibleIds = new Set(messages.filter(isFriendChatMessageInteractive).map((message) => message.messageId));
    setSelectedMessageIds((ids) => ids.filter((id) => visibleIds.has(id)));
  }, [messages, selectionMode]);

  useEffect(() => {
    if (!forwardVisible || !user?.uid) return undefined;
    return subscribeToFriendConversations(
      user.uid,
      (items) => setForwardConversations(items.filter((item) => item.conversationId !== chatId)),
      () => setErrorKey("chat.tryAgain"),
      50,
    );
  }, [chatId, forwardVisible, user?.uid]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => {
      keyboardVisibleRef.current = true;
      dismissReactionTray();
      scrollToLatest(false);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      keyboardVisibleRef.current = false;
      dismissReactionTray();
    });
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [dismissReactionTray, scrollToLatest]);

  useEffect(() => {
    if (authLoading) return;
    if (!user?.uid || !chatId) { setLoading(false); setErrorKey("chat.noAccess"); return; }
    let active = true;
    let unsubscribe = () => {};
    setAccess(null);
    setAccessResolvedChatId(null);
    setLoading(true);
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
        if (active) {
          setAccessResolvedChatId(chatId);
          setLoading(false);
        }
      }
    })();
    return () => { active = false; unsubscribe(); setActiveFriendConversation(null); };
  }, [authLoading, chatId, user?.uid]);

  const title = useMemo(() => access && user?.uid
    ? getConversationDisplayTitle(access.conversation, user.uid, t("chat.unnamedGroup"), t("common.formerMember"), t("common.sidelineSocialMember"))
    : t("chat.title"), [access, t, user?.uid]);
  const canSend = Boolean(access && (access.conversation.conversationType === "group" || access.directFriendshipActive));
  const trimmedDraft = draft.trim();
  const canSubmit = Boolean(canSend && !sending && draft.length <= CHAT_MESSAGE_LIMIT && (trimmedDraft || imageDraft || voiceDraft));

  const removeImageDraft = useCallback(async () => {
    const current = imageDraftRef.current;
    imageDraftRef.current = null;
    setImageDraft(null);
    await deleteFriendChatImageDraft(current);
  }, []);

  const removeVoiceDraft = useCallback(async () => {
    const current = voiceDraftRef.current;
    voiceDraftRef.current = null;
    setVoiceDraft(null);
    setVoiceMode(false);
    setVoiceComposerKey((value) => value + 1);
    if (current?.uri) await deleteLocalVoiceMemo(current.uri);
  }, []);

  const applyImagePickerResult = useCallback(async (
    result: FriendChatImageRecoveryResult,
  ) => {
    if (result.status === "none") return;
    if (handledImagePickerOperationsRef.current.has(result.operationId)) return;

    const isCurrentConversation = screenActiveRef.current &&
      currentUserIdRef.current === result.uid &&
      currentChatIdRef.current === result.conversationId;
    if (result.status === "stale") {
      if (isCurrentConversation) setErrorKey("chat.imagePickerError");
      return;
    }
    if (!isCurrentConversation) return;

    const context = { conversationId: result.conversationId, uid: result.uid };
    const claimed = await claimFriendChatImagePickerResult(context, result.operationId);
    if (!claimed) return;
    handledImagePickerOperationsRef.current.add(result.operationId);
    let acknowledged = false;
    try {
      if (
        !screenActiveRef.current ||
        currentUserIdRef.current !== result.uid ||
        currentChatIdRef.current !== result.conversationId
      ) return;
      if (result.status === "cancelled") {
        acknowledged = await acknowledgeFriendChatImagePickerResult(context, result.operationId);
        return;
      }
      if (result.status === "failed") {
        setErrorKey(mediaErrorTranslationKey(new Error(result.errorCode)));
        acknowledged = await acknowledgeFriendChatImagePickerResult(context, result.operationId);
        return;
      }

      await removeImageDraft();
      await removeVoiceDraft();
      if (
        !screenActiveRef.current ||
        currentUserIdRef.current !== result.uid ||
        currentChatIdRef.current !== result.conversationId
      ) return;
      imageDraftRef.current = result.draft;
      setImageDraft(result.draft);
      setVoiceMode(false);
      scrollToLatest(false);
      acknowledged = await acknowledgeFriendChatImagePickerResult(context, result.operationId);
    } finally {
      if (!acknowledged) {
        releaseFriendChatImagePickerResult(result.operationId);
        handledImagePickerOperationsRef.current.delete(result.operationId);
      }
    }
  }, [removeImageDraft, removeVoiceDraft, scrollToLatest]);

  useEffect(() => {
    if (
      authLoading ||
      loading ||
      !user?.uid ||
      !chatId ||
      accessResolvedChatId !== chatId
    ) return;
    const context = { conversationId: chatId, uid: user.uid };
    const recoveryKey = `${user.uid}:${chatId}`;
    if (
      !access ||
      access.conversation.conversationId !== chatId ||
      access.member.status !== "active" ||
      !access.member.joinedAt ||
      !canSend
    ) {
      void discardFriendChatImagePickerOperation(context);
      return;
    }
    if (recoveredImagePickerContextRef.current === recoveryKey) return;
    recoveredImagePickerContextRef.current = recoveryKey;
    imagePickerInFlightRef.current = true;
    setImagePickerBusy(true);
    void recoverFriendChatImageDraft(context)
      .then(applyImagePickerResult)
      .catch((error) => {
        if (
          screenActiveRef.current &&
          currentUserIdRef.current === context.uid &&
          currentChatIdRef.current === context.conversationId
        ) setErrorKey(mediaErrorTranslationKey(error));
      })
      .finally(() => {
        imagePickerInFlightRef.current = false;
        if (screenActiveRef.current) setImagePickerBusy(false);
      });
  }, [access, accessResolvedChatId, applyImagePickerResult, authLoading, canSend, chatId, loading, user?.uid]);

  const pickImage = useCallback(async () => {
    if (!canSend || sending || imagePickerInFlightRef.current || !chatId || !user?.uid) return;
    const context = { conversationId: chatId, uid: user.uid };
    imagePickerInFlightRef.current = true;
    setImagePickerBusy(true);
    setErrorKey(null);
    try {
      const result = await pickFriendChatImageDraft(context);
      await applyImagePickerResult(result);
    } catch (error) {
      if (
        screenActiveRef.current &&
        currentUserIdRef.current === context.uid &&
        currentChatIdRef.current === context.conversationId
      ) setErrorKey(mediaErrorTranslationKey(error));
    } finally {
      imagePickerInFlightRef.current = false;
      if (screenActiveRef.current) setImagePickerBusy(false);
    }
  }, [applyImagePickerResult, canSend, chatId, sending, user?.uid]);

  const send = useCallback(async () => {
    if (!chatId || !canSubmit || sendInFlight.current) return;
    const caption = trimmedDraft;
    const clientMessageId = createChatClientMessageId();
    sendInFlight.current = true;
    setSending(true);
    setSendStatus(null);
    setUploadProgress(null);
    setErrorKey(null);
    try {
      if (imageDraft) {
        setSendStatus({ mediaType: "image", phase: "uploading" });
        const reservation = await reserveFriendChatImageUpload({ caption, clientMessageId, conversationId: chatId, image: imageDraft, replyToMessageId: replyDraft?.messageId ?? null });
        const upload = await uploadReservedFriendChatImage(reservation, imageDraft, setUploadProgress);
        uploadCancel.current = upload.cancel;
        await upload.completion;
        setSendStatus({ mediaType: "image", phase: "finalizing" });
        await finalizeFriendChatImageMessage(reservation.reservationId);
        await deleteFriendChatImageDraft(imageDraft);
        imageDraftRef.current = null;
        setImageDraft(null);
        setDraft("");
        setReplyDraft(null);
      } else if (voiceDraft) {
        if (!voiceDraft.previewed) {
          setErrorKey("voiceMemo.previewRequired");
          return;
        }
        setSendStatus({ mediaType: "voice", phase: "uploading" });
        const reservation = await reserveFriendChatVoiceUpload({ caption, clientMessageId, conversationId: chatId, replyToMessageId: replyDraft?.messageId ?? null, voiceMemo: voiceDraft });
        const upload = await uploadReservedFriendChatVoiceMemo(reservation, voiceDraft, setUploadProgress);
        uploadCancel.current = () => upload.task.cancel();
        await upload.completion;
        setSendStatus({ mediaType: "voice", phase: "finalizing" });
        await finalizeFriendChatVoiceMessage(reservation.reservationId);
        await deleteLocalVoiceMemo(voiceDraft.uri);
        voiceDraftRef.current = null;
        setVoiceDraft(null);
        setVoiceMode(false);
        setVoiceComposerKey((value) => value + 1);
        setDraft("");
        setReplyDraft(null);
      } else {
        await sendFriendChatMessage(chatId, caption, clientMessageId, replyDraft?.messageId ?? null);
        setDraft("");
        setReplyDraft(null);
      }
    } catch (error) {
      setErrorKey(mediaErrorTranslationKey(error));
    } finally {
      uploadCancel.current = null;
      setUploadProgress(null);
      setSendStatus(null);
      setSending(false);
      sendInFlight.current = false;
    }
  }, [canSubmit, chatId, imageDraft, replyDraft?.messageId, trimmedDraft, voiceDraft]);

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

  const reactionMessage = useMemo(() => reactionTray
    ? messages.find((message) => message.messageId === reactionTray.messageId) ?? null
    : null, [messages, reactionTray]);

  useEffect(() => {
    if (!reactionTray) return;
    if (!isFriendChatMessageInteractive(reactionMessage)) dismissReactionTray();
  }, [dismissReactionTray, reactionMessage, reactionTray]);

  const openReactionTray = useCallback((message: FriendChatMessage, anchor: FriendChatReactionTrayAnchor) => {
    if (!isFriendChatMessageInteractive(message)) return;
    void Haptics.selectionAsync().catch(() => undefined);
    setActionMessage(null);
    setReactionTray({ anchor, messageId: message.messageId });
  }, []);

  const toggleReaction = useCallback(async (messageId: string, emoji: FriendChatReactionEmoji, closeTrayAfter = false) => {
    if (!chatId || reactionSubmittingRef.current) return;
    reactionSubmittingRef.current = true;
    setReactionSubmitting(true);
    setErrorKey(null);
    try {
      await toggleFriendChatReaction(chatId, messageId, emoji);
      if (closeTrayAfter) dismissReactionTray();
    } catch (error) {
      setErrorKey(errorTranslationKey(mapFriendChatError(error)));
    } finally {
      reactionSubmittingRef.current = false;
      setReactionSubmitting(false);
    }
  }, [chatId, dismissReactionTray]);

  const makeReplyDraft = useCallback((message: FriendChatMessage): ReplyDraft => ({
    createdAt: message.createdAt,
    messageId: message.messageId,
    messageType: message.messageType,
    senderDisplayName: message.senderDisplayName,
    senderUserId: message.senderUserId,
    textExcerpt: message.messageType === "text"
      ? message.text
      : message.caption,
  }), []);

  const startReply = useCallback(() => {
    const message = selectedMessages[0];
    if (!message || selectedMessages.length !== 1) return;
    setReplyDraft(makeReplyDraft(message));
    clearSelection();
  }, [clearSelection, makeReplyDraft, selectedMessages]);

  const toggleSelection = useCallback((message: FriendChatMessage) => {
    if (!isFriendChatMessageInteractive(message)) return;
    setSelectedMessageIds((ids) => ids.includes(message.messageId)
      ? ids.filter((id) => id !== message.messageId)
      : [...ids, message.messageId]);
  }, []);

  const beginSelection = useCallback((message: FriendChatMessage, anchor: FriendChatReactionTrayAnchor) => {
    if (!isFriendChatMessageInteractive(message)) return;
    setSelectedMessageIds([message.messageId]);
    openReactionTray(message, anchor);
  }, [openReactionTray]);

  const runStarAction = useCallback(async () => {
    if (!chatId || selectedMessages.length === 0) return;
    const shouldStar = selectedMessages.some((message) => !message.starredBySelf);
    setErrorKey(null);
    try {
      await setFriendChatMessagesStarred(chatId, selectedMessages.map((message) => message.messageId), shouldStar);
      clearSelection();
    } catch (error) {
      setErrorKey(errorTranslationKey(mapFriendChatError(error)));
    }
  }, [chatId, clearSelection, selectedMessages]);

  const runDeleteSelection = useCallback(async () => {
    if (!chatId || selectedMessages.length === 0) return;
    setErrorKey(null);
    try {
      const ownMessages = selectedMessages.filter((message) => message.senderUserId === user?.uid);
      const otherMessages = selectedMessages.filter((message) => message.senderUserId !== user?.uid);
      await Promise.all([
        ...ownMessages.map((message) => removeOwnFriendChatMessage(chatId, message.messageId)),
        otherMessages.length ? deleteFriendChatMessagesForMe(chatId, otherMessages.map((message) => message.messageId)) : Promise.resolve(null),
      ]);
      setDeleteSelectionVisible(false);
      clearSelection();
    } catch (error) {
      setErrorKey(errorTranslationKey(mapFriendChatError(error)));
    }
  }, [chatId, clearSelection, selectedMessages, user?.uid]);

  const openForwardSheet = useCallback(() => {
    if (selectedMessages.some((message) =>
      !isFriendChatMessageForwardable(message) || unavailableImageMessageIds.includes(message.messageId))) {
      setErrorKey("chat.mediaForwardUnsupported");
      return;
    }
    forwardClientMessageIdRef.current = forwardClientMessageIdRef.current ?? createChatClientMessageId();
    setForwardMessageIds(selectedMessages.map((message) => message.messageId));
    setForwardConversationIds([]);
    setForwardVisible(true);
  }, [selectedMessages, unavailableImageMessageIds]);

  const openPhotoForwardSheet = useCallback((message: FriendChatMessage) => {
    if (!isFriendChatMessageForwardable(message) || unavailableImageMessageIds.includes(message.messageId)) return;
    forwardClientMessageIdRef.current = createChatClientMessageId();
    setForwardMessageIds([message.messageId]);
    setForwardConversationIds([]);
    setForwardVisible(true);
  }, [unavailableImageMessageIds]);

  const markImageUnavailable = useCallback((messageId: string) => {
    setUnavailableImageMessageIds((ids) => ids.includes(messageId) ? ids : [...ids, messageId]);
  }, []);

  const dismissForwardSheet = useCallback(() => {
    forwardClientMessageIdRef.current = null;
    setForwardConversationIds([]);
    setForwardMessageIds([]);
    setForwardVisible(false);
  }, []);

  const runForward = useCallback(async () => {
    if (!chatId || forwardMessageIds.length === 0 || forwardConversationIds.length === 0) return;
    setErrorKey(null);
    try {
      const clientForwardId = forwardClientMessageIdRef.current ?? createChatClientMessageId();
      forwardClientMessageIdRef.current = clientForwardId;
      await forwardFriendChatMessages(
        chatId,
        forwardMessageIds,
        forwardConversationIds,
        clientForwardId,
      );
      dismissForwardSheet();
      clearSelection();
    } catch (error) {
      setErrorKey(errorTranslationKey(mapFriendChatError(error)));
    }
  }, [chatId, clearSelection, dismissForwardSheet, forwardConversationIds, forwardMessageIds]);

  const savePhotoMessage = useCallback(async (message: FriendChatMessage) => {
    if (
      !chatId ||
      !user?.uid ||
      !message.image ||
      !isFriendChatMessageInteractive(message) ||
      photoSaveInFlightRef.current
    ) return;
    photoSaveInFlightRef.current = message.messageId;
    setSavingPhotoMessageId(message.messageId);
    try {
      await saveFriendChatPhoto({
        conversationId: chatId,
        messageId: message.messageId,
        storagePath: message.image.fullPath,
        uid: user.uid,
      });
      Alert.alert(t("chat.photoSavedTitle"), t("chat.photoSavedBody"));
    } catch (error) {
      Alert.alert(t("chat.savePhotoErrorTitle"), t(photoSaveErrorTranslationKey(error)));
    } finally {
      photoSaveInFlightRef.current = null;
      setSavingPhotoMessageId(null);
    }
  }, [chatId, t, user?.uid]);

  const runPinAction = useCallback(async () => {
    const message = selectedMessages[0];
    if (!chatId || !message || selectedMessages.length !== 1) return;
    setErrorKey(null);
    try {
      if (access?.conversation.pinnedMessage?.messageId === message.messageId) {
        await unpinFriendChatMessage(chatId, message.messageId);
      } else {
        await pinFriendChatMessage(chatId, message.messageId, "7d");
      }
      clearSelection();
    } catch (error) {
      setErrorKey(errorTranslationKey(mapFriendChatError(error)));
    }
  }, [access?.conversation.pinnedMessage?.messageId, chatId, clearSelection, selectedMessages]);

  const scrollToMessage = useCallback((messageId: string) => {
    const index = messages.findIndex((message) => message.messageId === messageId);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ animated: true, index, viewPosition: 0.45 });
      return;
    }
    if (messages[0]?.createdAtTimestamp) void loadEarlier();
  }, [loadEarlier, messages]);

  const selectedMine = actionMessage?.senderUserId === user?.uid;
  const selectedActive = isFriendChatMessageInteractive(actionMessage);
  const selectedActions = useMemo<MessageModalAction[]>(() => {
    if (!chatId || !actionMessage || !selectedMine || !selectedActive) return [];
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
      onPress: async () => {
        if (actionMessage.voiceMemo) {
          await clearPersistedVoicePlaybackArtifacts({
            kind: "persisted-message",
            messageId: actionMessage.messageId,
            messageKind: "friendChatMessage",
            storagePath: actionMessage.voiceMemo.storagePath,
          });
        }
        await removeOwnFriendChatMessage(chatId, actionMessage.messageId);
      },
    }];
  }, [actionMessage, chatId, selectedActive, selectedMine, t]);

  const selectedReaction = reactionMessage?.reactions.find((reaction) => reaction.reactedBySelf)?.emoji ?? null;
  const reportAction = actionMessage && !selectedMine && selectedActive && chatId
    ? { chatId, messageId: actionMessage.messageId }
    : null;
  const selectedCount = selectedMessages.length;
  const allSelectedStarred = selectedMessages.length > 0 && selectedMessages.every((message) => message.starredBySelf);
  const canReplyToSelection = selectedMessages.length === 1;
  const canForwardSelection = selectedMessages.length > 0 && selectedMessages.every((message) =>
    isFriendChatMessageForwardable(message) && !unavailableImageMessageIds.includes(message.messageId));
  const canPinSelection = Boolean(selectedMessages.length === 1 && access &&
    (access.conversation.conversationType === "direct" || access.member.role === "owner" || access.member.role === "admin"));
  const selectedPinned = selectedMessages.length === 1 && access?.conversation.pinnedMessage?.messageId === selectedMessages[0].messageId;
  const selectedIncoming = selectedMessages.length === 1 && selectedMessages[0].senderUserId !== user?.uid;
  const selectedGroupIncoming = selectedIncoming && access?.conversation.conversationType === "group";
  const selectedText = selectedMessages.length === 1 && selectedMessages[0].messageType === "text";
  const overflowActions = useMemo<FriendChatOverflowAction[]>(() => {
    const actions: FriendChatOverflowAction[] = [];
    if (selectedText) actions.push({ disabled: true, id: "copy", label: t("chat.copyUnavailable"), onPress: () => undefined });
    if (canReplyToSelection) actions.push({ id: "reply", label: t("chat.reply"), onPress: startReply });
    if (canPinSelection) actions.push({ id: "pin", label: selectedPinned ? t("chat.unpinMessage") : t("chat.pinForSevenDays"), onPress: runPinAction });
    if (selectedGroupIncoming) actions.push({ disabled: true, id: "reply-privately", label: t("chat.replyPrivatelyUnavailable"), onPress: () => undefined });
    if (selectedText) actions.push({ disabled: true, id: "translate", label: t("chat.translateUnavailable"), onPress: () => undefined });
    if (selectedIncoming) actions.push({ id: "report", label: t("moderation.reportMessage"), onPress: () => { setActionMessage(selectedMessages[0]); clearSelection(); } });
    return actions;
  }, [canPinSelection, canReplyToSelection, clearSelection, runPinAction, selectedGroupIncoming, selectedIncoming, selectedMessages, selectedPinned, selectedText, startReply, t]);
  const reactionCategories = useMemo(() => [
    { key: "quick", label: t("chat.reactionCategories.quick"), options: FRIEND_CHAT_QUICK_REACTIONS },
    { key: "support", label: t("chat.reactionCategories.support"), options: FRIEND_CHAT_REACTIONS.slice(8, 14) },
    { key: "energy", label: t("chat.reactionCategories.energy"), options: FRIEND_CHAT_REACTIONS.slice(6, 8).concat(FRIEND_CHAT_REACTIONS.slice(18, 22)) },
    { key: "sports", label: t("chat.reactionCategories.sports"), options: FRIEND_CHAT_REACTIONS.slice(22) },
    { key: "more", label: t("chat.reactionCategories.more"), options: FRIEND_CHAT_REACTIONS.slice(14, 18) },
  ], [t]);

  if (authLoading || loading) return <ScreenWrapper><View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("chat.loadingConversation")}</Text></View></ScreenWrapper>;
  if (!access) return <ScreenWrapper><View style={styles.center}><Text style={styles.title}>{t("chat.cannotOpenTitle")}</Text><Text style={styles.body}>{t(errorKey ?? "chat.noAccess")}</Text><TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/(social)/chat")} style={styles.primary}><Text style={styles.primaryText}>{t("chat.backToChats")}</Text></TouchableOpacity></View></ScreenWrapper>;

  return (
    <ScreenWrapper>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} onLayout={dismissReactionTray} style={styles.fill}>
        {selectionMode ? (
          <View accessibilityLiveRegion="polite" style={styles.selectionHeader}>
            <TouchableOpacity accessibilityLabel={t("chat.exitSelectionMode")} accessibilityRole="button" onPress={clearSelection} style={styles.iconButton}>
              <ArrowLeft color={Colors.textHeading} size={23} />
            </TouchableOpacity>
            <Text accessibilityRole="header" style={styles.selectionCount}>{t("chat.selectedMessages", { count: selectedCount })}</Text>
            {canReplyToSelection ? (
              <TouchableOpacity accessibilityLabel={t("chat.reply")} accessibilityRole="button" onPress={startReply} style={styles.iconButton}>
                <Reply color={Colors.textHeading} size={21} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity accessibilityLabel={allSelectedStarred ? t("chat.unstar") : t("chat.star")} accessibilityRole="button" onPress={() => void runStarAction()} style={styles.iconButton}>
              {allSelectedStarred ? <StarOff color={Colors.textHeading} size={21} /> : <Star color={Colors.textHeading} size={21} />}
            </TouchableOpacity>
            <TouchableOpacity accessibilityLabel={t("chat.delete")} accessibilityRole="button" onPress={() => setDeleteSelectionVisible(true)} style={styles.iconButton}>
              <Trash2 color={Colors.primary} size={21} />
            </TouchableOpacity>
            {canForwardSelection ? (
              <TouchableOpacity accessibilityLabel={t("chat.forward")} accessibilityRole="button" onPress={openForwardSheet} style={styles.iconButton}>
                <Forward color={Colors.textHeading} size={21} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              accessibilityLabel={t("chat.moreMessageActions")}
              accessibilityRole="button"
              onPress={() => overflowButtonRef.current?.measureInWindow((x, y, width, height) => setOverflowAnchor({ height, width, x, y }))}
              ref={overflowButtonRef}
              style={styles.iconButton}
            >
              <MoreHorizontal color={Colors.textHeading} size={23} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.header}>
            <NestedBackButton accessibilityLabel={t("chat.back")} fallbackRoute="/(social)/chat" style={styles.iconButton} />
            <View style={styles.headerCopy}><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text><Text style={styles.headerMeta}>{access.conversation.conversationType === "group" ? t("chat.participants", { count: access.conversation.activeParticipantCount }) : t("chat.directConversation")}</Text></View>
            <TouchableOpacity accessibilityLabel={t("chat.conversationSettings")} accessibilityRole="button" onPress={() => router.push({ pathname: "/(social)/chat/manage", params: { conversationId: chatId } })} style={styles.iconButton}><MoreHorizontal color={Colors.textHeading} size={24} /></TouchableOpacity>
          </View>
        )}
        {errorKey ? <Card style={styles.errorCard}><Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text></Card> : null}
        {!access.directFriendshipActive && access.conversation.conversationType === "direct" ? <View style={styles.notice}><Text style={styles.noticeText}>{t("chat.friendshipEndedReadOnly")}</Text></View> : null}
        {access.conversation.pinnedMessage ? (
          <TouchableOpacity accessibilityLabel={t("chat.pinnedMessageAccessibility")} accessibilityRole="button" onPress={() => scrollToMessage(access.conversation.pinnedMessage!.messageId)} style={styles.pinnedSummary}>
            <Pin color={Colors.accentGold} size={16} />
            <View style={styles.pinnedCopy}>
              <Text style={styles.pinnedTitle}>{t("chat.pinnedMessage")}</Text>
              <Text numberOfLines={1} style={styles.pinnedText}>{quotePreview(access.conversation.pinnedMessage, t)}</Text>
            </View>
          </TouchableOpacity>
        ) : null}
        <FlatList
          ref={listRef}
          contentContainerStyle={messages.length ? styles.messages : styles.emptyMessages}
          data={messages}
          keyExtractor={(item) => item.messageId}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={hasMore ? <TouchableOpacity accessibilityRole="button" disabled={loadingEarlier} onPress={() => void loadEarlier()} style={styles.loadEarlier}>{loadingEarlier ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.loadEarlierText}>{t("chat.loadEarlier")}</Text>}</TouchableOpacity> : null}
          ListEmptyComponent={<View style={styles.center}><Text style={styles.emptyTitle}>{t("chat.noMessages")}</Text><Text style={styles.body}>{t("chat.noMessagesBody")}</Text></View>}
          onContentSizeChange={() => { if (messages.length <= 50) listRef.current?.scrollToEnd({ animated: false }); }}
          onLayout={() => {
            if (keyboardVisibleRef.current) scrollToLatest(false);
          }}
          onScrollBeginDrag={dismissReactionTray}
          renderItem={({ item }) => (
            <MessageBubble
              isMine={item.senderUserId === user?.uid}
              message={item}
              onActions={() => setActionMessage(item)}
              onForwardImage={() => openPhotoForwardSheet(item)}
              onOpenReactions={beginSelection}
              onQuotePress={scrollToMessage}
              onReact={(emoji) => {
                void toggleReaction(item.messageId, emoji);
              }}
              onSaveImage={() => { void savePhotoMessage(item); }}
              onImageUnavailable={() => markImageUnavailable(item.messageId)}
              onToggleSelection={toggleSelection}
              selected={selectedMessageIds.includes(item.messageId)}
              savingPhoto={savingPhotoMessageId === item.messageId}
              selectionMode={selectionMode}
            />
          )}
          style={styles.messageList}
        />
        <View style={styles.composer}>
          {replyDraft ? (
            <View accessible accessibilityLabel={t("chat.replyingToAccessibility", { sender: replyDraft.senderDisplayName ?? t("common.sidelineSocialMember") })} style={styles.replyDraft}>
              <View style={styles.replyAccent} />
              <View style={styles.replyCopy}>
                <Text style={styles.replyTitle}>{t("chat.replyingTo", { sender: replyDraft.senderDisplayName ?? t("common.sidelineSocialMember") })}</Text>
                <Text numberOfLines={2} style={styles.replyText}>{quotePreview(replyDraft, t)}</Text>
              </View>
              <TouchableOpacity accessibilityLabel={t("chat.cancelReply")} accessibilityRole="button" onPress={() => setReplyDraft(null)} style={styles.removeDraft}>
                <X color={Colors.primary} size={18} />
              </TouchableOpacity>
            </View>
          ) : null}
          {imageDraft ? (
            <View accessible accessibilityLabel={t("chat.imageDraftAccessibility")} style={styles.draftCard}>
              <Image
                accessibilityIgnoresInvertColors
                resizeMode="cover"
                source={{ uri: imageDraft.thumbnail.uri }}
                style={styles.draftPreviewImage}
              />
              <View style={styles.draftCopy}>
                <Text style={styles.draftTitle}>{t("chat.imageReady")}</Text>
                <Text style={styles.draftMeta}>{t("chat.imageReadyBody")}</Text>
              </View>
              <TouchableOpacity accessibilityLabel={t("chat.removeImage")} accessibilityRole="button" onPress={() => { void removeImageDraft(); }} style={styles.removeDraft}>
                <X color={Colors.primary} size={19} />
              </TouchableOpacity>
            </View>
          ) : null}
          {(voiceMode || voiceDraft) ? (
            <View style={styles.voicePanel}>
              <VoiceMemoComposer
                active={voiceMode}
                autoStartKey={voiceAutoStartKey}
                disabled={sending || Boolean(imageDraft)}
                key={voiceComposerKey}
                maxDurationMilliseconds={FRIEND_CHAT_VOICE_LIMIT_MS}
                maxSizeBytes={FRIEND_CHAT_VOICE_SIZE_LIMIT_BYTES}
                onChange={(nextDraft) => {
                  setVoiceDraft(nextDraft);
                  if (nextDraft) setImageDraft(null);
                }}
                uploadProgress={uploadProgress}
              />
            </View>
          ) : null}
          <View style={styles.composerRow}>
            <TouchableOpacity accessibilityLabel={t("chat.chooseImage")} accessibilityRole="button" accessibilityState={{ busy: imagePickerBusy, disabled: !canSend || sending || imagePickerBusy }} disabled={!canSend || sending || imagePickerBusy} onPress={() => { void pickImage(); }} style={[styles.iconComposerButton, (!canSend || sending || imagePickerBusy) && styles.disabled]}>
              {imagePickerBusy ? <ActivityIndicator color={Colors.primary} size="small" /> : <ImageIcon color={Colors.primary} size={20} />}
            </TouchableOpacity>
            <View style={styles.inputWrap}>
              <TextInput editable={canSend && !sending} maxLength={CHAT_MESSAGE_LIMIT + 1} multiline onChangeText={(value) => { setDraft(value); if (errorKey) setErrorKey(null); }} onContentSizeChange={() => scrollToLatest(false)} onFocus={() => scrollToLatest(false)} placeholder={canSend ? (imageDraft || voiceDraft ? t("chat.captionPlaceholder") : t("chat.messagePlaceholder")) : t("chat.readOnlyPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={draft} />
              <Text style={[styles.counter, draft.length > CHAT_MESSAGE_LIMIT && styles.error]}>{CHAT_MESSAGE_LIMIT - draft.length}</Text>
            </View>
            {!trimmedDraft && !imageDraft ? (
              <TouchableOpacity accessibilityLabel={t("voiceMemo.recordAccessibility")} accessibilityRole="button" accessibilityState={{ selected: voiceMode, disabled: !canSend || sending }} disabled={!canSend || sending} onPress={() => { setVoiceMode(true); setVoiceAutoStartKey((value) => value + 1); }} style={[styles.iconComposerButton, voiceMode && styles.activeComposerButton, (!canSend || sending) && styles.disabled]}>
                <Mic color={voiceMode ? Colors.surface : Colors.primary} size={20} />
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity accessibilityLabel={sending ? t("chat.sending") : t("chat.send")} accessibilityRole="button" accessibilityState={{ busy: sending, disabled: !canSubmit }} disabled={!canSubmit} onPress={() => void send()} style={[styles.send, !canSubmit && styles.disabled]}>{sending ? <ActivityIndicator color={Colors.surface} /> : <Send color={Colors.surface} size={18} />}</TouchableOpacity>
          </View>
          {sendStatus?.phase === "finalizing" ? (
            <Text accessibilityLiveRegion="polite" style={styles.progressText}>
              {t(friendChatSendStatusTranslationKey(sendStatus))}
            </Text>
          ) : null}
          {sendStatus?.phase === "uploading" && uploadProgress != null ? (
            <View accessibilityLiveRegion="polite" style={styles.uploadRow}>
              <ActivityIndicator color={Colors.primary} size="small" />
              <Text style={styles.progressText}>{t(friendChatSendStatusTranslationKey(sendStatus), { percent: Math.round(uploadProgress * 100) })}</Text>
              <TouchableOpacity accessibilityRole="button" onPress={() => uploadCancel.current?.()}>
                <Text style={styles.cancelUpload}>{t("voiceMemo.cancelUpload")}</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
      <MessageActionsModal
        actions={selectedActions}
        onDismiss={() => setActionMessage(null)}
        report={reportAction
          ? {
            errorMessage: t("moderation.reportError"),
            onSubmit: async (reason) => {
              await reportFriendChatMessage(reportAction.chatId, reportAction.messageId, reason);
            },
            successBody: t("moderation.reportSentBody"),
            successTitle: t("moderation.reportSentTitle"),
          }
          : undefined}
        visible={Boolean(actionMessage)}
      />
      <FriendChatReactionTray
        anchor={reactionTray?.anchor ?? null}
        onDismiss={dismissReactionTray}
        onMore={() => setReactionPickerVisible(true)}
        onReact={(emoji) => {
          if (!reactionMessage) return;
          void toggleReaction(reactionMessage.messageId, emoji as FriendChatReactionEmoji, true);
        }}
        options={FRIEND_CHAT_QUICK_REACTIONS}
        selectedEmoji={selectedReaction}
        submitting={reactionSubmitting}
        visible={Boolean(reactionTray && reactionMessage)}
      />
      <FriendChatExpandedReactionPicker
        categories={reactionCategories}
        onDismiss={() => setReactionPickerVisible(false)}
        onReact={(emoji) => {
          if (!reactionMessage) return;
          void toggleReaction(reactionMessage.messageId, emoji as FriendChatReactionEmoji, true);
          setReactionPickerVisible(false);
        }}
        selectedEmoji={selectedReaction}
        visible={reactionPickerVisible}
      />
      <FriendChatSelectionOverflowMenu
        actions={overflowActions}
        anchor={overflowAnchor}
        dismissLabel={t("chat.dismissMessageActions")}
        onDismiss={() => setOverflowAnchor(null)}
        visible={Boolean(overflowAnchor && overflowActions.length)}
      />
      <MessageActionsModal
        actions={[{
          confirmation: {
            body: selectedMessages.some((message) => message.senderUserId !== user?.uid)
              ? t("chat.deleteSelectionMixedBody")
              : t("teamMessages.deleteForEveryoneBody"),
            confirmLabel: t("common.delete"),
            title: t("chat.deleteSelectedMessages"),
          },
          destructive: true,
          errorMessage: t("teamMessages.deleteError"),
          id: "delete-selection",
          label: t("chat.deleteSelectedMessages"),
          onPress: runDeleteSelection,
        }]}
        onDismiss={() => setDeleteSelectionVisible(false)}
        visible={deleteSelectionVisible}
      />
      <ForwardMessagesSheet
        conversations={forwardConversations}
        currentUserId={user?.uid ?? ""}
        maxDestinations={FRIEND_CHAT_FORWARD_MAX_DESTINATIONS}
        onDismiss={dismissForwardSheet}
        onForward={() => void runForward()}
        onToggleConversation={(conversationId) => setForwardConversationIds((ids) => ids.includes(conversationId)
          ? ids.filter((id) => id !== conversationId)
          : ids.length < FRIEND_CHAT_FORWARD_MAX_DESTINATIONS ? [...ids, conversationId] : ids)}
        selectedConversationIds={forwardConversationIds}
        visible={forwardVisible}
      />
    </ScreenWrapper>
  );
}

function MessageBubble({
  message,
  isMine,
  onActions,
  onForwardImage,
  onOpenReactions,
  onQuotePress,
  onReact,
  onSaveImage,
  onImageUnavailable,
  onToggleSelection,
  savingPhoto,
  selected,
  selectionMode,
}: {
  isMine: boolean;
  message: FriendChatMessage;
  onActions: () => void;
  onForwardImage: () => void;
  onOpenReactions: (message: FriendChatMessage, anchor: FriendChatReactionTrayAnchor) => void;
  onQuotePress: (messageId: string) => void;
  onReact: (emoji: FriendChatReactionEmoji) => void;
  onSaveImage: () => void;
  onImageUnavailable: () => void;
  onToggleSelection: (message: FriendChatMessage) => void;
  savingPhoto: boolean;
  selected: boolean;
  selectionMode: boolean;
}) {
  const { t } = useTranslation();
  const bubbleRef = useRef<View>(null);
  if (message.messageType === "system") return <Text style={styles.systemMessage}>{message.text}</Text>;
  const interactive = isFriendChatMessageInteractive(message);
  const time = message.createdAt?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) ?? "";
  const sender = isMine
    ? t("chat.you")
    : message.senderDisplayName || t(message.senderProfileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember");
  const text = message.isModerated
    ? t("teamMessages.contentRemoved")
    : message.status === "removed"
      ? t("chat.messageRemoved")
      : message.messageType === "image"
        ? message.caption || t("chat.photoPreview")
        : message.messageType === "voice"
          ? message.caption || t("chat.voicePreview")
          : message.text;
  const bubbleAccessibility = t("chat.messageAccessibility", { sender, text, time });
  const openReactionTray = () => {
    if (!interactive) return;
    bubbleRef.current?.measureInWindow((x, y, width, height) => {
      onOpenReactions(message, { height, width, x, y });
    });
  };
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (!interactive) return;
    if (event.nativeEvent.actionName === "select") {
      onToggleSelection(message);
      return;
    }
    if (event.nativeEvent.actionName === "more") {
      onActions();
      return;
    }
    if (event.nativeEvent.actionName === "react") openReactionTray();
  };
  return (
    <View style={[styles.messageRow, isMine && styles.mineRow, selectionMode && !selected && styles.dimmedMessage]}>
      <Pressable
        accessibilityActions={interactive
          ? [
            { label: t("chat.selectMessage"), name: "select" },
            { label: t("chat.reactToMessage"), name: "react" },
            { label: t("chat.moreMessageActions"), name: "more" },
          ]
          : undefined}
        accessibilityHint={interactive ? t("chat.messageOptionsAccessibilityHint") : undefined}
        accessibilityLabel={bubbleAccessibility}
        accessibilityRole="text"
        accessibilityState={{ selected }}
        delayLongPress={360}
        onAccessibilityAction={handleAccessibilityAction}
        onLongPress={openReactionTray}
        onPress={selectionMode ? () => onToggleSelection(message) : undefined}
        ref={bubbleRef}
        style={[
          styles.bubble,
          isMine && styles.mineBubble,
          selected && styles.selectedBubble,
          message.messageType === "voice" && message.status === "active" && styles.voiceBubble,
        ]}
      >
        {!isMine && message.senderDisplayName ? <Text style={styles.sender}>{message.senderDisplayName}</Text> : null}
        {message.forwarded ? <Text style={[styles.forwardedLabel, isMine && styles.mineText]}>{t("chat.forwarded")}</Text> : null}
        {message.replyTo ? (
          <TouchableOpacity accessibilityLabel={t("chat.openRepliedMessage")} accessibilityRole="button" onPress={() => onQuotePress(message.replyTo!.messageId)} style={[styles.quote, isMine && styles.mineQuote]}>
            <Text style={[styles.quoteSender, isMine && styles.mineText]}>{message.replyTo.senderDisplayName ?? t("common.sidelineSocialMember")}</Text>
            <Text numberOfLines={2} style={[styles.quoteText, isMine && styles.mineTime]}>{quotePreview(message.replyTo, t)}</Text>
          </TouchableOpacity>
        ) : null}
        <View style={styles.messageTop}>
          <View style={styles.messageContent}>
            {message.status === "removed" || message.isModerated ? (
              <Text style={[styles.messageText, isMine && styles.mineText, styles.removed]}>{text}</Text>
            ) : message.messageType === "voice" && message.voiceMemo ? (
              <VoiceMemoPlayer
                durationMilliseconds={message.voiceMemo.durationMilliseconds}
                isOwnMessage={isMine}
                source={{
                  kind: "persisted-message",
                  messageId: message.messageId,
                  messageKind: "friendChatMessage",
                  storagePath: message.voiceMemo.storagePath,
                }}
              />
            ) : message.messageType === "voice" ? (
              <VoiceMemoUnavailable />
            ) : message.messageType === "image" && message.image ? (
              <FriendChatImageMessage
                active={interactive}
                image={message.image}
                messageId={message.messageId}
                onForward={onForwardImage}
                onLongPress={openReactionTray}
                onSave={onSaveImage}
                onSelect={() => onToggleSelection(message)}
                onUnavailable={onImageUnavailable}
                saving={savingPhoto}
                selectionMode={selectionMode}
              />
            ) : message.messageType === "image" ? (
              <Text style={[styles.messageText, isMine && styles.mineText]}>{t("chat.imageUnavailable")}</Text>
            ) : (
              <Text style={[styles.messageText, isMine && styles.mineText]}>{message.text}</Text>
            )}
            {message.status === "active" && (message.messageType === "image" || message.messageType === "voice") && message.caption ? (
              <Text style={[styles.caption, isMine && styles.mineText]}>{message.caption}</Text>
            ) : null}
          </View>
        </View>
        <Text style={[styles.time, isMine && styles.mineTime]}>{time}</Text>
      </Pressable>
      {message.reactions.length > 0 ? (
        <View style={[styles.reactionSummary, isMine && styles.mineReactionSummary]}>
          {message.reactions.map((reaction) => (
            <TouchableOpacity
              accessibilityLabel={t("chat.reactionSummary", { count: reaction.count, emoji: reaction.emoji })}
              accessibilityRole="button"
              key={reaction.emoji}
              onPress={() => onReact(reaction.emoji)}
              style={[styles.reactionChip, reaction.reactedBySelf && styles.reactionChipSelected]}
            >
              <Text style={styles.reactionChipText}>{reaction.emoji} {reaction.count}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function quotePreview(message: FriendChatReplyContext, t: TFunction) {
  if (message.textExcerpt) return message.textExcerpt;
  if (message.messageType === "image") return t("chat.photoPreview");
  if (message.messageType === "voice") return t("chat.voicePreview");
  return t("chat.quotedMessageUnavailable");
}

function ForwardMessagesSheet({
  conversations,
  currentUserId,
  maxDestinations,
  onDismiss,
  onForward,
  onToggleConversation,
  selectedConversationIds,
  visible,
}: {
  conversations: FriendConversationListItem[];
  currentUserId: string;
  maxDestinations: number;
  onDismiss: () => void;
  onForward: () => void;
  onToggleConversation: (conversationId: string) => void;
  selectedConversationIds: string[];
  visible: boolean;
}) {
  const { t } = useTranslation();
  const selectedIds = new Set(selectedConversationIds);
  return (
    <Modal
      animationType="slide"
      onRequestClose={onDismiss}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.forwardBackdrop}>
        <Pressable accessibilityLabel={t("chat.dismissForwardSheet")} accessibilityRole="button" onPress={onDismiss} style={styles.forwardBackdropDismiss} />
        <View accessibilityLabel={t("chat.forwardMessages")} accessibilityViewIsModal style={styles.forwardSheet}>
          <View style={styles.forwardHeader}>
            <View style={styles.forwardTitleCopy}>
              <Text accessibilityRole="header" style={styles.forwardTitle}>{t("chat.forwardMessages")}</Text>
              <Text style={styles.forwardMeta}>{t("chat.chooseForwardDestinations", { count: selectedConversationIds.length, max: maxDestinations })}</Text>
            </View>
            <TouchableOpacity accessibilityLabel={t("common.close")} accessibilityRole="button" onPress={onDismiss} style={styles.iconButton}>
              <X color={Colors.textHeading} size={22} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.forwardList}>
            {conversations.length === 0 ? (
              <Text style={styles.forwardEmpty}>{t("chat.noForwardDestinations")}</Text>
            ) : conversations.map((conversation) => {
              const selected = selectedIds.has(conversation.conversationId);
              const disabled = !selected && selectedConversationIds.length >= maxDestinations;
              const title = getConversationDisplayTitle(conversation, currentUserId, t("chat.unnamedGroup"), t("common.formerMember"), t("common.sidelineSocialMember"));
              return (
                <TouchableOpacity
                  accessibilityLabel={t("chat.forwardTo", { name: title })}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled }}
                  disabled={disabled}
                  key={conversation.conversationId}
                  onPress={() => onToggleConversation(conversation.conversationId)}
                  style={[styles.forwardRow, disabled && styles.disabled]}
                >
                  <View style={styles.forwardAvatar}>
                    <Text style={styles.forwardAvatarText}>{title.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={styles.forwardRowCopy}>
                    <Text numberOfLines={1} style={styles.forwardRowTitle}>{title}</Text>
                    <Text style={styles.forwardRowMeta}>{conversation.conversationType === "group" ? t("chat.groupConversation") : t("chat.directConversation")}</Text>
                  </View>
                  <View style={[styles.forwardCheck, selected && styles.forwardCheckSelected]}>
                    {selected ? <Check color={Colors.surface} size={15} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            accessibilityLabel={t("chat.sendForward")}
            accessibilityRole="button"
            accessibilityState={{ disabled: selectedConversationIds.length === 0 }}
            disabled={selectedConversationIds.length === 0}
            onPress={onForward}
            style={[styles.forwardSend, selectedConversationIds.length === 0 && styles.disabled]}
          >
            <Forward color={Colors.surface} size={18} />
            <Text style={styles.forwardSendText}>{t("chat.sendForward")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function errorTranslationKey(error: ReturnType<typeof mapFriendChatError>) {
  if (error === "network") return "chat.networkError";
  if (error === "friendshipEnded") return "chat.friendshipEndedReadOnly";
  if (error === "blocked") return "chat.messagingBlocked";
  if (error === "rateLimited") return "chat.rateLimited";
  if (error === "removed") return "chat.membershipEnded";
  if (error === "permission") return "chat.noAccess";
  return "chat.tryAgain";
}

function mediaErrorTranslationKey(error: unknown) {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "code" in error ? String(error.code) : "";
  if (message.includes("image_feature_build_required")) return "chat.imageBuildRequired";
  if (message.includes("image_picker_in_progress")) return "chat.imagePickerInProgress";
  if (message.includes("image_picker_failed")) return "chat.imagePickerError";
  if (message.includes("image_source_too_large")) return "chat.imageSourceTooLarge";
  if (message.includes("unsupported_image_type")) return "chat.unsupportedImageType";
  if (message.includes("image_processing") || message.includes("image_thumbnail")) return "chat.imageProcessingError";
  if (message.includes("voice_preview_required")) return "voiceMemo.previewRequired";
  if (message.includes("voice_file_too_large")) return "voiceMemo.fileTooLarge";
  if (message.includes("media_upload_canceled") || message.includes("storage/canceled")) return "chat.mediaUploadCanceled";
  if (message.includes("media_upload") || message.includes("storage")) return "chat.mediaUploadError";
  return errorTranslationKey(mapFriendChatError(error));
}

function photoSaveErrorTranslationKey(error: unknown) {
  const code = error instanceof FriendChatPhotoSaveError
    ? error.code
    : error instanceof Error
      ? error.message
      : "";
  if (code === "photo_save_build_required") return "chat.savePhotoBuildRequired";
  if (code === "photo_save_permission_denied") return "chat.savePhotoPermissionDenied";
  if (code === "photo_save_permission_permanently_denied") return "chat.savePhotoPermissionPermanentlyDenied";
  if (code === "photo_save_unavailable") return "chat.savePhotoUnavailable";
  if (code === "photo_save_network") return "chat.savePhotoNetworkError";
  if (code === "photo_save_in_progress") return "chat.savePhotoInProgress";
  return "chat.savePhotoFailed";
}

const styles = StyleSheet.create({
  fill: { flex: 1 }, center: { alignItems: "center", flex: 1, gap: Spacing.sm, justifyContent: "center", padding: Spacing.xl },
  header: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", minHeight: 58, paddingHorizontal: Spacing.sm },
  selectionHeader: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", minHeight: 58, paddingHorizontal: Spacing.sm },
  selectionCount: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyBold, fontSize: 17 },
  iconButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }, headerCopy: { flex: 1 },
  headerTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 }, headerMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 26, textAlign: "center" }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.lg }, primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  errorCard: { borderColor: Colors.primary, borderWidth: 1, margin: Spacing.sm, marginBottom: 0 }, error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  notice: { backgroundColor: Colors.secondary, padding: Spacing.sm }, noticeText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  messageList: { flex: 1 }, messages: { gap: Spacing.sm, padding: Spacing.md }, emptyMessages: { flexGrow: 1 }, loadEarlier: { alignItems: "center", minHeight: 40, justifyContent: "center" }, loadEarlierText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 }, messageRow: { alignItems: "flex-start" }, mineRow: { alignItems: "flex-end" },
  dimmedMessage: { opacity: 0.48 },
  bubble: { backgroundColor: Colors.surface, borderRadius: Radius.button, maxWidth: "84%", paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, ...Shadow.card }, mineBubble: { backgroundColor: Colors.primary },
  selectedBubble: { borderColor: Colors.accentGold, borderWidth: 2 },
  voiceBubble: { width: "84%" },
  forwardedLabel: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 11, marginBottom: 4, opacity: 0.82 },
  quote: { backgroundColor: Colors.background, borderLeftColor: Colors.accentGold, borderLeftWidth: 3, borderRadius: Radius.card, marginBottom: Spacing.xs, padding: Spacing.sm },
  mineQuote: { backgroundColor: "rgba(255,255,255,0.16)", borderLeftColor: Colors.surface },
  quoteSender: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  quoteText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 16 },
  sender: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 11, marginBottom: 2 }, messageText: { color: Colors.textHeading, flexShrink: 1, flexWrap: "wrap", fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 21, minWidth: 0 }, mineText: { color: Colors.surface }, removed: { fontStyle: "italic", opacity: 0.75 },
  caption: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 18, marginTop: Spacing.xs },
  messageContent: { flexShrink: 1, minWidth: 0 },
  messageTop: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.xs },
  time: { alignSelf: "flex-end", color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 10, marginTop: 3 }, mineTime: { color: Colors.surface, opacity: 0.8 }, systemMessage: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, padding: Spacing.sm, textAlign: "center" },
  reactionSummary: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs, marginTop: 4, maxWidth: "84%" },
  mineReactionSummary: { justifyContent: "flex-end" },
  reactionChip: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: 14, borderWidth: 1, paddingHorizontal: Spacing.sm, paddingVertical: 3, ...Shadow.card },
  reactionChipSelected: { borderColor: Colors.primary },
  reactionChipText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  pinnedSummary: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 48, paddingHorizontal: Spacing.md },
  pinnedCopy: { flex: 1, minWidth: 0 },
  pinnedTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  pinnedText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  composer: { backgroundColor: Colors.surface, borderTopColor: Colors.secondary, borderTopWidth: 1, gap: Spacing.sm, padding: Spacing.sm },
  composerRow: { alignItems: "flex-end", flexDirection: "row", gap: Spacing.sm },
  inputWrap: { flex: 1 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, maxHeight: 110, minHeight: 44, paddingHorizontal: Spacing.md, paddingRight: 42, paddingVertical: 10 },
  counter: { bottom: 6, color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 10, position: "absolute", right: 9 },
  iconComposerButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  activeComposerButton: { backgroundColor: Colors.primary },
  send: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, height: 44, justifyContent: "center", width: 44 }, disabled: { opacity: 0.45 },
  draftCard: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, padding: Spacing.sm },
  draftCopy: { flex: 1, minWidth: 0 },
  draftPreviewImage: { backgroundColor: Colors.secondary, borderRadius: Radius.card, height: 56, width: 56 },
  draftMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  draftTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  removeDraft: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  replyDraft: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, padding: Spacing.sm },
  replyAccent: { alignSelf: "stretch", backgroundColor: Colors.accentGold, borderRadius: 2, width: 4 },
  replyCopy: { flex: 1, minWidth: 0 },
  replyTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  replyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17 },
  voicePanel: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, padding: Spacing.sm },
  uploadRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  progressText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  cancelUpload: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  forwardBackdrop: { backgroundColor: "rgba(47, 65, 86, 0.18)", flex: 1, justifyContent: "flex-end" },
  forwardBackdropDismiss: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  forwardSheet: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, gap: Spacing.md, maxHeight: "78%", padding: Spacing.lg, ...Shadow.card },
  forwardHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  forwardTitleCopy: { flex: 1, minWidth: 0 },
  forwardTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  forwardMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17 },
  forwardList: { gap: Spacing.xs, paddingBottom: Spacing.sm },
  forwardEmpty: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, paddingVertical: Spacing.lg, textAlign: "center" },
  forwardRow: { alignItems: "center", borderBottomColor: Colors.secondary, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: Spacing.sm, minHeight: 58, paddingVertical: Spacing.xs },
  forwardAvatar: { alignItems: "center", backgroundColor: Colors.accentGreen, borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  forwardAvatarText: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 14 },
  forwardRowCopy: { flex: 1, minWidth: 0 },
  forwardRowTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  forwardRowMeta: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 },
  forwardCheck: { alignItems: "center", borderColor: Colors.secondary, borderRadius: 6, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  forwardCheckSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  forwardSend: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 46 },
  forwardSendText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
