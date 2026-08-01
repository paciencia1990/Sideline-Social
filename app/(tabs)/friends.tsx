import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Check, ChevronDown, Heart, MessageCircle, Search, UserMinus, UserPlus, Users, X } from "lucide-react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  acceptFriendRequest,
  cancelFriendRequest,
  declineFriendRequest,
  getCurrentUserProfile,
  getFriends,
  getFriendRequestGroups,
  searchParentsByName,
  searchUsers,
  sendFriendRequest,
  subscribeToFriendRequestChanges,
  removeFriend,
  type FriendProfile,
  type FriendRequest,
  type FriendSearchResult,
  type HydratedIncomingFriendRequest,
  type SuggestedFriendProfile,
} from "@/services/friendsService";
import { createOrOpenDirectConversation } from "@/services/chatService";
import { acknowledgeNotificationAfterOpen } from "@/services/notificationService";
import { formatPublicUserName, getFriendNameInitials } from "@/utils/friendPrivacy";
import { getSentAge, reconcilePendingFriendRequests } from "@/utils/friendRequestState";

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {typeof count === "number" ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
  );
}

function AccordionHeader({
  title,
  count,
  expanded,
  onPress,
}: {
  title: string;
  count: number;
  expanded: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={`${title} (${count})`}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      activeOpacity={0.82}
      disabled={count === 0}
      onPress={onPress}
      style={[styles.accordionHeader, count === 0 && styles.accordionHeaderEmpty]}
    >
      <Text style={styles.accordionTitle}>{title} ({count})</Text>
      <ChevronDown
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        color={Colors.textHeading}
        size={20}
        style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
      />
    </TouchableOpacity>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card style={styles.emptyCard}>
      <Users size={28} color={Colors.secondary} />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

function Avatar({ name, photoURL }: { name: string; photoURL?: string | null }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.avatar}>
      {photoURL ? <Image source={{ uri: photoURL }} style={styles.avatarImage} /> : (
        <Text style={styles.avatarText}>{getFriendNameInitials(name)}</Text>
      )}
    </View>
  );
}

function FriendRow({
  profile,
  actionLabel,
  actionIcon,
  onAction,
  busy,
  danger = false,
  disabled = false,
  secondaryActionLabel,
  secondaryActionIcon,
  onSecondaryAction,
  secondaryBusy = false,
}: {
  profile: FriendProfile;
  actionLabel: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
  busy: boolean;
  danger?: boolean;
  disabled?: boolean;
  secondaryActionLabel?: string;
  secondaryActionIcon?: React.ReactNode;
  onSecondaryAction?: () => void;
  secondaryBusy?: boolean;
}) {
  return (
    <Card style={styles.personCard}>
      <Avatar name={profile.displayName} photoURL={profile.photoURL} />
      <View style={styles.personText}>
        <Text style={styles.personName}>{profile.displayName}</Text>
      </View>
      <View style={styles.rowActions}>
        {onSecondaryAction && secondaryActionIcon ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={secondaryActionLabel}
            activeOpacity={0.82}
            disabled={secondaryBusy}
            onPress={onSecondaryAction}
            style={[styles.iconButton, styles.messageButton, secondaryBusy && styles.disabledButton]}
          >
            {secondaryBusy ? <ActivityIndicator color={Colors.surface} size="small" /> : secondaryActionIcon}
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          activeOpacity={0.82}
          disabled={busy || disabled}
          onPress={onAction}
          style={[styles.iconButton, danger && styles.dangerButton, disabled && styles.disabledButton]}
        >
          {busy ? <ActivityIndicator color={Colors.surface} size="small" /> : actionIcon}
        </TouchableOpacity>
      </View>
    </Card>
  );
}

function SuggestedConnectionRow({
  profile,
  pending,
  busy,
  error,
  onAdd,
}: {
  profile: SuggestedFriendProfile;
  pending: boolean;
  busy: boolean;
  error?: string | null;
  onAdd: () => void;
}) {
  const { t } = useTranslation();
  const displayName = formatPublicUserName(profile.displayName) ?? t("friends.publicNameUnavailable");
  const context = profile.sharedSquadName || profile.sharedActivity || t("friends.suggestedParentContext");

  return (
    <Card style={styles.personCard}>
      <Avatar name={displayName} photoURL={profile.photoURL} />
      <View style={styles.personText}>
        <Text style={styles.personName}>{displayName}</Text>
        <Text style={styles.personMeta}>{context}</Text>
        {typeof profile.mutualConnectionCount === "number" && profile.mutualConnectionCount > 0 ? (
          <Text style={styles.mutualConnections}>
            {t("friends.mutualConnections", { count: profile.mutualConnectionCount })}
          </Text>
        ) : null}
        {error ? <Text accessibilityLiveRegion="polite" style={styles.inlineActionError}>{error}</Text> : null}
      </View>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={busy
          ? t("friends.sendingFriendRequestTo", { name: displayName })
          : pending
            ? t("friends.friendRequestSent")
            : t("friends.sendFriendRequestTo", { name: displayName })}
        accessibilityState={{ busy, disabled: busy || pending || !profile.id }}
        activeOpacity={0.82}
        disabled={busy || pending || !profile.id}
        hitSlop={4}
        onPress={onAdd}
        style={[styles.iconButton, (pending || !profile.id) && styles.disabledButton]}
      >
        {busy ? <ActivityIndicator color={Colors.surface} size="small" /> : <UserPlus size={18} color={Colors.surface} />}
      </TouchableOpacity>
    </Card>
  );
}

function SearchResultRow({
  profile,
  busy,
  error,
  onAdd,
  onMessage,
  onRespond,
}: {
  profile: FriendSearchResult;
  busy: boolean;
  error?: string | null;
  onAdd: () => void;
  onMessage: () => void;
  onRespond: () => void;
}) {
  const { t } = useTranslation();
  const displayName = formatPublicUserName(profile.displayName) ?? t("friends.publicNameUnavailable");
  const relationshipLabel = profile.relationship === "friends"
    ? t("friends.searchRelationshipFriends")
    : profile.relationship === "outgoing-request"
      ? t("friends.searchRelationshipOutgoing")
      : profile.relationship === "incoming-request"
        ? t("friends.searchRelationshipIncoming")
        : t("friends.searchRelationshipNone");
  const actionLabel = profile.relationship === "friends"
    ? t("friends.messageFriend")
    : profile.relationship === "outgoing-request"
      ? t("friends.friendRequestSent")
      : profile.relationship === "incoming-request"
        ? t("friends.respond")
        : t("friends.addFriend");
  const onPress = profile.relationship === "friends"
    ? onMessage
    : profile.relationship === "incoming-request"
      ? onRespond
      : onAdd;
  const disabled = busy || profile.relationship === "outgoing-request";

  return (
    <Card style={styles.personCard}>
      <Avatar name={displayName} photoURL={profile.photoURL} />
      <View style={styles.personText}>
        <Text style={styles.personName}>{displayName}</Text>
        <Text style={styles.personMeta}>{relationshipLabel}</Text>
        {error ? <Text accessibilityLiveRegion="polite" style={styles.inlineActionError}>{error}</Text> : null}
      </View>
      <TouchableOpacity
        accessibilityLabel={t("friends.searchResultAction", { action: actionLabel, name: displayName })}
        accessibilityRole="button"
        accessibilityState={{ busy, disabled }}
        activeOpacity={0.82}
        disabled={disabled}
        onPress={onPress}
        style={[styles.searchActionButton, disabled && styles.disabledButton]}
      >
        {busy ? (
          <ActivityIndicator color={Colors.surface} size="small" />
        ) : (
          <>
            {profile.relationship === "friends" ? <MessageCircle size={16} color={Colors.surface} /> : null}
            {profile.relationship === "none" ? <UserPlus size={16} color={Colors.surface} /> : null}
            <Text style={styles.searchActionText}>{actionLabel}</Text>
          </>
        )}
      </TouchableOpacity>
    </Card>
  );
}

function RequestRow({
  request,
  onAccept,
  onDecline,
  busyAction,
}: {
  request: HydratedIncomingFriendRequest;
  onAccept: () => void;
  onDecline: () => void;
  busyAction: string | null;
}) {
  const { t } = useTranslation();
  const acceptBusy = busyAction === `accept:${request.id}`;
  const declineBusy = busyAction === `decline:${request.id}`;
  const visibleSenderName = request.senderProfileState === "loading"
    ? t("friends.loadingParentName")
    : request.senderDisplayName || t(request.senderProfileState === "deleted"
      ? "common.formerMember"
      : "common.sidelineSocialMember");

  return (
    <Card style={styles.personCard}>
      <Avatar name={visibleSenderName} photoURL={request.senderPhotoURL} />
      <View style={styles.personText}>
        <Text
          accessibilityLabel={t("friends.friendRequestFrom", { name: visibleSenderName })}
          style={styles.personName}
        >
          {visibleSenderName}
        </Text>
        <Text
          accessibilityLabel={t("friends.friendRequestBody", { name: visibleSenderName })}
          style={styles.personMeta}
        >
          {t("friends.requestMeta")}
        </Text>
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t("friends.acceptFriendRequestFrom", { name: visibleSenderName })}
          accessibilityState={{ disabled: acceptBusy || declineBusy }}
          activeOpacity={0.82}
          disabled={acceptBusy || declineBusy}
          onPress={onAccept}
          style={styles.smallIconButton}
        >
          {acceptBusy ? <ActivityIndicator color={Colors.surface} size="small" /> : <Check size={18} color={Colors.surface} />}
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={t("friends.declineFriendRequestFrom", { name: visibleSenderName })}
          accessibilityState={{ disabled: acceptBusy || declineBusy }}
          activeOpacity={0.82}
          disabled={acceptBusy || declineBusy}
          onPress={onDecline}
          style={[styles.smallIconButton, styles.dangerButton]}
        >
          {declineBusy ? <ActivityIndicator color={Colors.surface} size="small" /> : <X size={18} color={Colors.surface} />}
        </TouchableOpacity>
      </View>
    </Card>
  );
}

export default function FriendsScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ notificationId?: string | string[] }>();
  const notificationId = Array.isArray(params.notificationId)
    ? params.notificationId[0] ?? ""
    : params.notificationId ?? "";
  const [currentProfile, setCurrentProfile] = useState<FriendProfile | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<HydratedIncomingFriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [incomingExpanded, setIncomingExpanded] = useState(false);
  const [outgoingExpanded, setOutgoingExpanded] = useState(false);
  const [suggestedUsers, setSuggestedUsers] = useState<SuggestedFriendProfile[]>([]);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<FriendSearchResult[]>([]);
  const [searchCompleted, setSearchCompleted] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchRefreshVersion, setSearchRefreshVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ actionId: string; message: string } | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const actionsInFlight = useRef(new Set<string>());
  const friendsLoadSequence = useRef(0);
  const searchRequestSequence = useRef(0);
  const acknowledgedNotificationIds = useRef(new Set<string>());
  const incomingExpansionInitialized = useRef(false);
  const previousIncomingCount = useRef(0);

  const outgoingUserIds = useMemo(
    () => new Set(outgoingRequests.map((request) => request.toUserId)),
    [outgoingRequests]
  );
  const normalizedSearchText = useMemo(
    () => searchText.trim().replace(/\s+/gu, " "),
    [searchText],
  );
  const searchIsReady = useMemo(
    () => normalizedSearchText.length >= 2 &&
      (normalizedSearchText.match(/\p{L}/gu)?.length ?? 0) >= 2,
    [normalizedSearchText],
  );

  const loadFriends = useCallback(async () => {
    const requestSequence = ++friendsLoadSequence.current;
    if (!user) {
      setCurrentProfile(null);
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setSuggestedUsers([]);
      setSearchResults([]);
      setSearchCompleted(false);
      setSearchError(null);
      setLoading(false);
      return;
    }

    setLoadError(null);
    try {
      const [profile, nextFriends, nextRequestGroups, nextSuggested] = await Promise.all([
        getCurrentUserProfile(),
        getFriends(user.uid),
        getFriendRequestGroups(user.uid),
        searchUsers(""),
      ]);
      if (friendsLoadSequence.current !== requestSequence) return;
      const reconciledRequests = reconcilePendingFriendRequests(
        nextRequestGroups.incoming,
        nextRequestGroups.outgoing,
        new Set(nextFriends.map((friend) => friend.id)),
      );
      setCurrentProfile(profile);
      setFriends(nextFriends);
      setIncomingRequests(reconciledRequests.incoming);
      setOutgoingRequests(reconciledRequests.outgoing);
      setSuggestedUsers(nextSuggested);
      if (notificationId && !acknowledgedNotificationIds.current.has(notificationId)) {
        acknowledgedNotificationIds.current.add(notificationId);
        void acknowledgeNotificationAfterOpen(notificationId);
      }
    } catch (nextError) {
      if (friendsLoadSequence.current !== requestSequence) return;
      logFriendsScreenIssue("loadFriends", nextError);
      setLoadError(t("friends.errorBody"));
    } finally {
      if (friendsLoadSequence.current === requestSequence) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [notificationId, t, user]);

  useFocusEffect(useCallback(() => {
    if (!authLoading) void loadFriends();
  }, [authLoading, loadFriends]));

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeToFriendRequestChanges(user.uid, () => void loadFriends());
  }, [loadFriends, user?.uid]);

  useEffect(() => {
    if (loading) return;
    if (!incomingExpansionInitialized.current) {
      incomingExpansionInitialized.current = true;
      setIncomingExpanded(incomingRequests.length > 0);
    } else if (incomingRequests.length === 0) {
      setIncomingExpanded(false);
    } else if (previousIncomingCount.current === 0) {
      setIncomingExpanded(true);
    }
    previousIncomingCount.current = incomingRequests.length;
  }, [incomingRequests.length, loading]);

  useEffect(() => {
    if (outgoingRequests.length === 0) setOutgoingExpanded(false);
  }, [outgoingRequests.length]);

  useEffect(() => {
    const nextExpiry = [...incomingRequests, ...outgoingRequests]
      .map((request) => request.expiresAt?.getTime() ?? Number.NaN)
      .filter(Number.isFinite)
      .reduce((soonest, expiresAt) => Math.min(soonest, expiresAt), Number.POSITIVE_INFINITY);
    if (!Number.isFinite(nextExpiry)) return;
    const delay = Math.min(
      Math.max(0, nextExpiry - Date.now()) + 250,
      2_147_483_647,
    );
    const timeout = setTimeout(() => void loadFriends(), delay);
    return () => clearTimeout(timeout);
  }, [incomingRequests, loadFriends, outgoingRequests]);

  useEffect(() => {
    if (!user?.uid) return;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void loadFriends();
    });
    return () => subscription.remove();
  }, [loadFriends, user?.uid]);

  useEffect(() => {
    const requestSequence = ++searchRequestSequence.current;
    setSearchResults([]);
    setSearchCompleted(false);
    setSearchError(null);
    setSearching(false);
    if (!user || !searchIsReady) return;

    const timeout = setTimeout(async () => {
      if (searchRequestSequence.current !== requestSequence) return;
      setSearching(true);
      try {
        const results = await searchParentsByName(normalizedSearchText);
        if (searchRequestSequence.current !== requestSequence) return;
        setSearchResults(results);
        setSearchCompleted(true);
      } catch (nextError) {
        if (searchRequestSequence.current !== requestSequence) return;
        logFriendsScreenIssue("searchParentsByName", nextError);
        setSearchError(t("friends.searchUnavailableBody"));
        setSearchCompleted(true);
      } finally {
        if (searchRequestSequence.current === requestSequence) setSearching(false);
      }
    }, 350);

    return () => {
      clearTimeout(timeout);
      if (searchRequestSequence.current === requestSequence) {
        searchRequestSequence.current += 1;
      }
    };
  }, [normalizedSearchText, searchIsReady, searchRefreshVersion, t, user]);

  const runAction = useCallback(
    async (actionId: string, action: () => Promise<void>, failureMessage = t("friends.errorBody")) => {
      if (actionsInFlight.current.has(actionId)) return;
      actionsInFlight.current.add(actionId);
      friendsLoadSequence.current += 1;
      setBusyAction(actionId);
      setActionError((current) => current?.actionId === actionId ? null : current);
      try {
        await action();
        await loadFriends();
        setSearchRefreshVersion((current) => current + 1);
        setActionError((current) => current?.actionId === actionId ? null : current);
      } catch (nextError) {
        logFriendsScreenIssue(actionId, nextError);
        if (["friend-request/reverse-pending", "friend-request/no-longer-available"].includes(getFriendsErrorCode(nextError))) {
          await loadFriends();
          setSearchRefreshVersion((current) => current + 1);
        }
        setActionError({ actionId, message: mapFriendActionError(nextError, failureMessage, t) });
      } finally {
        actionsInFlight.current.delete(actionId);
        setBusyAction(null);
      }
    },
    [loadFriends, t]
  );

  const confirmRemove = useCallback(
    (friend: FriendProfile) => {
      Alert.alert(t("friends.removeConfirmTitle"), t("friends.removeConfirmBody", { name: friend.displayName }), [
        { text: t("friends.cancel"), style: "cancel" },
        {
          text: t("friends.remove"),
          style: "destructive",
          onPress: () => void runAction(`remove:${friend.id}`, () => removeFriend(friend.id)),
        },
      ]);
    },
    [runAction, t]
  );

  const confirmCancelRequest = useCallback((request: FriendRequest) => {
    const recipientName = request.recipientDisplayName || t(request.recipientProfileState === "deleted"
      ? "common.formerMember"
      : "common.sidelineSocialMember");
    Alert.alert(t("friends.cancelRequest"), t("friends.cancelRequestConfirm"), [
      { text: t("friends.cancel"), style: "cancel" },
      {
        text: t("friends.cancelRequest"),
        style: "destructive",
        onPress: () => void runAction(
          `cancel:${request.id}`,
          async () => {
            await cancelFriendRequest(request.id);
            setOutgoingRequests((current) => current.filter((item) => item.id !== request.id));
          },
          t("friends.cancelRequestError", { name: recipientName }),
        ),
      },
    ]);
  }, [runAction, t]);

  const openDirectChat = useCallback(
    async (friend: FriendProfile) => {
      setBusyAction(`chat:${friend.id}`);
      setActionError(null);
      try {
        const result = await createOrOpenDirectConversation(friend.id);
        router.push({ pathname: "/(social)/chat/[chatId]", params: { chatId: result.conversationId } });
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : t("friends.errorBody");
        setActionError({ actionId: `chat:${friend.id}`, message });
      } finally {
        setBusyAction(null);
      }
    },
    [t]
  );

  const respondToSearchResult = useCallback((profile: FriendSearchResult) => {
    const request = incomingRequests.find((item) => item.fromUserId === profile.id);
    if (!request) {
      setIncomingExpanded(true);
      setActionError({
        actionId: `respond:${profile.id}`,
        message: t("friends.requestNoLongerAvailable"),
      });
      void loadFriends();
      return;
    }
    const displayName = formatPublicUserName(profile.displayName) ?? t("friends.publicNameUnavailable");
    Alert.alert(
      t("friends.respondToRequest", { name: displayName }),
      t("friends.friendRequestBody", { name: displayName }),
      [
        { text: t("friends.cancel"), style: "cancel" },
        {
          text: t("friends.decline"),
          style: "destructive",
          onPress: () => void runAction(
            `decline:${request.id}`,
            async () => {
              await declineFriendRequest(request.id);
              setIncomingRequests((current) => current.filter((item) => item.id !== request.id));
            },
            t("friends.declineRequestError"),
          ),
        },
        {
          text: t("friends.accept"),
          onPress: () => void runAction(
            `accept:${request.id}`,
            async () => {
              await acceptFriendRequest(request.id);
              setIncomingRequests((current) => current.filter((item) => item.id !== request.id));
            },
            t("friends.acceptRequestError"),
          ),
        },
      ],
    );
  }, [incomingRequests, loadFriends, runAction, t]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadFriends();
  }, [loadFriends]);

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

  if (!user) {
    return (
      <ScreenWrapper>
        <View style={styles.centeredState}>
          <Heart size={42} color={Colors.primary} />
          <Text style={styles.title}>{t("friends.title")}</Text>
          <Text style={styles.stateText}>{t("friends.signInRequired")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={Colors.primary} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Users size={44} color={Colors.primary} />
          <Text style={styles.title}>{t("friends.title")}</Text>
          <Text style={styles.subtitle}>{t("friends.subtitle")}</Text>
          {currentProfile ? <Text style={styles.profileHint}>{currentProfile.displayName}</Text> : null}
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.82}
            onPress={() => router.push("/(social)/chat")}
            style={styles.chatListButton}
          >
            <MessageCircle size={16} color={Colors.surface} />
            <Text style={styles.chatListButtonText}>{t("chat.title")}</Text>
          </TouchableOpacity>
        </View>

        {loadError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("friends.errorTitle")}</Text>
            <Text style={styles.errorBody}>{loadError}</Text>
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={onRefresh} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("friends.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {actionError &&
          !actionError.actionId.startsWith("add:") &&
          !actionError.actionId.startsWith("respond:") ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("friends.actionErrorTitle")}</Text>
            <Text style={styles.errorBody}>{actionError.message}</Text>
          </Card>
        ) : null}

        {currentProfile?.hasValidPublicIdentity === false ? (
          <Card style={styles.identityCard}>
            <Text style={styles.errorTitle}>{t("friends.addNameBeforeSending")}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.82}
              onPress={() => router.push("/(tabs)/profile")}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>{t("friends.editProfile")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        <AccordionHeader
          title={t("friends.requests")}
          count={incomingRequests.length}
          expanded={incomingExpanded && incomingRequests.length > 0}
          onPress={() => setIncomingExpanded((current) => !current)}
        />
        {incomingExpanded && incomingRequests.length > 0 ? (
          incomingRequests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              busyAction={busyAction}
              onAccept={() => void runAction(
                `accept:${request.id}`,
                async () => {
                  await acceptFriendRequest(request.id);
                  setIncomingRequests((current) => current.filter((item) => item.id !== request.id));
                },
                t("friends.acceptRequestError"),
              )}
              onDecline={() => void runAction(
                `decline:${request.id}`,
                async () => {
                  await declineFriendRequest(request.id);
                  setIncomingRequests((current) => current.filter((item) => item.id !== request.id));
                },
                t("friends.declineRequestError"),
              )}
            />
          ))
        ) : null}

        <AccordionHeader
          title={t("friends.outgoing")}
          count={outgoingRequests.length}
          expanded={outgoingExpanded && outgoingRequests.length > 0}
          onPress={() => setOutgoingExpanded((current) => !current)}
        />
        {outgoingExpanded && outgoingRequests.length > 0 ? (
          <>
            {outgoingRequests.map((request) => {
              const recipientName = request.recipientProfileState === "loading"
                ? t("friends.loadingParentName")
                : request.recipientDisplayName || t(request.recipientProfileState === "deleted"
                  ? "common.formerMember"
                  : "common.sidelineSocialMember");
              return (
                <Card key={request.id} style={styles.personCard}>
                  <Avatar name={recipientName} photoURL={request.recipientPhotoURL} />
                  <View style={styles.personText}>
                    <Text style={styles.personName}>{recipientName}</Text>
                    <Text style={styles.personMeta}>
                      {t("friends.sentTime", { time: formatSentAge(request.createdAt, t) })}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityLabel={t("friends.cancelRequestFor", { name: recipientName })}
                    accessibilityRole="button"
                    activeOpacity={0.82}
                    disabled={busyAction === `cancel:${request.id}`}
                    onPress={() => confirmCancelRequest(request)}
                    style={[styles.cancelRequestButton, busyAction === `cancel:${request.id}` && styles.disabledButton]}
                  >
                    {busyAction === `cancel:${request.id}` ? (
                      <ActivityIndicator color={Colors.primary} size="small" />
                    ) : <Text style={styles.cancelRequestText}>{t("friends.cancelRequest")}</Text>}
                  </TouchableOpacity>
                </Card>
              );
            })}
          </>
        ) : null}

        <SectionTitle title={t("friends.findParents")} />
        <View style={styles.searchBox}>
          <Search size={18} color={Colors.textPrimary} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setSearchText}
            placeholder={t("friends.searchPlaceholder")}
            placeholderTextColor={Colors.textPrimary}
            style={styles.searchInput}
            value={searchText}
          />
          {searching ? <ActivityIndicator color={Colors.primary} size="small" /> : null}
        </View>

        {searchText.length > 0 && !searchIsReady ? (
          <Text accessibilityLiveRegion="polite" style={styles.searchHint}>
            {t("friends.searchMinimum")}
          </Text>
        ) : null}

        {searchIsReady && searchResults.length > 0 ? (
          <>
            <SectionTitle title={t("friends.searchResults")} count={searchResults.length} />
            {searchResults.map((profile) => (
              <SearchResultRow
                key={profile.id}
                profile={profile}
                busy={
                  busyAction === `add:${profile.id}` ||
                  busyAction === `chat:${profile.id}` ||
                  incomingRequests.some((request) => (
                    request.fromUserId === profile.id &&
                    (
                      busyAction === `accept:${request.id}` ||
                      busyAction === `decline:${request.id}`
                    )
                  ))
                }
                error={
                  actionError?.actionId === `add:${profile.id}` ||
                  actionError?.actionId === `respond:${profile.id}`
                    ? actionError.message
                    : null
                }
                onAdd={() => void runAction(
                  `add:${profile.id}`,
                  async () => {
                    const result = await sendFriendRequest(profile.id);
                    if (result.status === "reversePending") {
                      throw createFriendsActionError("friend-request/reverse-pending");
                    }
                  },
                  t("friends.friendRequestError"),
                )}
                onMessage={() => void openDirectChat(profile)}
                onRespond={() => respondToSearchResult(profile)}
              />
            ))}
          </>
        ) : null}

        {searchIsReady && searchCompleted && !searching && !searchError && searchResults.length === 0 ? (
          <EmptyState
            title={t("friends.noSearchResultsTitle", { query: normalizedSearchText })}
            body={t("friends.noSearchResultsBody")}
          />
        ) : null}

        {searchIsReady && searchCompleted && searchError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("friends.searchUnavailableTitle")}</Text>
            <Text style={styles.errorBody}>{searchError}</Text>
            <TouchableOpacity
              accessibilityRole="button"
              activeOpacity={0.82}
              onPress={() => setSearchRefreshVersion((current) => current + 1)}
              style={styles.retryButton}
            >
              <Text style={styles.retryText}>{t("friends.retrySearch")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        <SectionTitle title={t("friends.myFriends")} count={friends.length} />
        {friends.length > 0 ? (
          friends.map((friend) => {
            const visibleFriend = {
              ...friend,
              displayName: friend.displayName || t(friend.profileState === "deleted"
                ? "common.formerMember"
                : "common.sidelineSocialMember"),
            };
            return (
              <FriendRow
                key={visibleFriend.id}
                profile={visibleFriend}
                actionLabel={t("friends.remove")}
                actionIcon={<UserMinus size={18} color={Colors.surface} />}
                danger
                busy={busyAction === `remove:${visibleFriend.id}`}
                onAction={() => confirmRemove(visibleFriend)}
                secondaryActionLabel={t("chat.startConversation")}
                secondaryActionIcon={<MessageCircle size={18} color={Colors.surface} />}
                secondaryBusy={busyAction === `chat:${visibleFriend.id}`}
                onSecondaryAction={() => void openDirectChat(visibleFriend)}
              />
            );
          })
        ) : (
          <EmptyState title={t("friends.emptyTitle")} body={t("friends.emptyBody")} />
        )}

        <SectionTitle title={t("friends.suggested")} />
        {suggestedUsers.length > 0 ? (
          suggestedUsers.map((profile) => {
            const pending = outgoingUserIds.has(profile.id);
            return (
              <SuggestedConnectionRow
                key={profile.id}
                profile={profile}
                busy={busyAction === `add:${profile.id}`}
                error={actionError?.actionId === `add:${profile.id}` ? actionError.message : null}
                pending={pending}
                onAdd={() => void runAction(
                  `add:${profile.id}`,
                  async () => {
                    const result = await sendFriendRequest(profile.id);
                    if (result.status === "reversePending") {
                      throw createFriendsActionError("friend-request/reverse-pending");
                    }
                  },
                  t("friends.friendRequestError"),
                )}
              />
            );
          })
        ) : (
          <EmptyState title={t("friends.noSuggestionsTitle")} body={t("friends.noSuggestionsBody")} />
        )}
      </KeyboardAwareScrollView>
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
  profileHint: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 13,
    marginTop: Spacing.xs,
  },
  chatListButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexDirection: "row",
    gap: Spacing.xs,
    minHeight: 40,
    justifyContent: "center",
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  chatListButtonText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: Spacing.xs,
  },
  accordionHeader: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.card,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    ...Shadow.card,
  },
  accordionHeaderEmpty: {
    minHeight: 42,
    opacity: 0.72,
  },
  accordionTitle: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    paddingRight: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 17,
  },
  sectionCount: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyMedium,
    fontSize: 13,
  },
  personCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: Spacing.sm,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: Colors.secondary,
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarText: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 14,
  },
  avatarImage: {
    borderRadius: 22,
    height: 44,
    width: 44,
  },
  personText: {
    flex: 1,
    gap: 2,
  },
  personName: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
  },
  personMeta: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 12,
    lineHeight: 17,
  },
  inlineActionError: {
    color: Colors.primary,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
  },
  mutualConnections: {
    color: Colors.primary,
    fontFamily: Typography.bodyMedium,
    fontSize: 12,
    lineHeight: 17,
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  smallIconButton: {
    alignItems: "center",
    backgroundColor: Colors.accentGreen,
    borderRadius: Radius.button,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  dangerButton: {
    backgroundColor: Colors.textHeading,
  },
  messageButton: {
    backgroundColor: Colors.accentGreen,
  },
  disabledButton: {
    opacity: 0.45,
  },
  rowActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  requestActions: {
    flexDirection: "row",
    gap: Spacing.xs,
  },
  cancelRequestButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 40,
    maxWidth: 126,
    paddingHorizontal: Spacing.sm,
  },
  cancelRequestText: {
    color: Colors.primary,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    textAlign: "center",
  },
  emptyCard: {
    alignItems: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.lg,
  },
  emptyTitle: {
    color: Colors.textHeading,
    fontFamily: Typography.bodySemiBold,
    fontSize: 15,
    textAlign: "center",
  },
  emptyBody: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flexDirection: "row",
    gap: Spacing.sm,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    ...Shadow.card,
  },
  searchInput: {
    color: Colors.textHeading,
    flex: 1,
    fontFamily: Typography.bodyRegular,
    fontSize: 15,
    minHeight: 48,
  },
  searchHint: {
    color: Colors.textPrimary,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  searchActionButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flexDirection: "row",
    gap: Spacing.xs,
    justifyContent: "center",
    minHeight: 42,
    maxWidth: 142,
    paddingHorizontal: Spacing.sm,
  },
  searchActionText: {
    color: Colors.surface,
    fontFamily: Typography.bodySemiBold,
    fontSize: 12,
    textAlign: "center",
  },
  errorCard: {
    borderColor: Colors.primary,
    borderWidth: 1,
    gap: Spacing.sm,
  },
  identityCard: {
    borderColor: Colors.secondary,
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

function formatSentAge(
  createdAt: Date | null,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const age = getSentAge(createdAt);
  if (age.kind === "recent") return t("friends.sentRecently");
  return age.kind === "today"
    ? t("friends.sentToday")
    : t("friends.sentDaysAgo", { count: age.count });
}

function logFriendsScreenIssue(operation: string, error: unknown) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[FriendsScreen] operation failed", { operation, code });
}

function getFriendsErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function mapFriendActionError(
  error: unknown,
  fallback: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const code = getFriendsErrorCode(error);
  if (code === "friend-request/reverse-pending") return t("friends.friendRequestReversePending");
  if (code === "friend-request/already-friends") return t("friends.friendRequestAlreadyConnected");
  if (code === "functions/already-exists") return t("friends.friendRequestAlreadySent");
  if (code === "functions/not-found" || code === "friend-request/invalid-target") {
    return t("friends.friendRequestUnavailable");
  }
  if (code === "friend-request/no-longer-available") return t("friends.requestNoLongerAvailable");
  if (code === "functions/failed-precondition") return t("friends.addNameBeforeSending");
  if (code === "functions/permission-denied") return t("friends.requestNoLongerAvailable");
  if (code === "functions/unavailable" || code === "firestore/unavailable" || code === "auth/network-request-failed") {
    return t("friends.friendRequestNetworkError");
  }
  return fallback;
}

function createFriendsActionError(code: string) {
  const error = new Error("Friend request needs attention.") as Error & { code: string };
  error.code = code;
  return error;
}
