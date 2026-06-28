import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Check, Heart, MessageCircle, Search, UserMinus, UserPlus, Users, X } from "lucide-react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { useAuth } from "@/context/AuthContext";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  acceptFriendRequest,
  declineFriendRequest,
  getCurrentUserProfile,
  getFriends,
  getIncomingFriendRequests,
  getOutgoingFriendRequests,
  searchUsers,
  sendFriendRequest,
  removeFriend,
  type FriendProfile,
  type FriendRequest,
} from "@/services/friendsService";
import { getOrCreateDirectChat } from "@/services/chatService";

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "SS";
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {typeof count === "number" ? <Text style={styles.sectionCount}>{count}</Text> : null}
    </View>
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

function Avatar({ name }: { name: string }) {
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{getInitials(name)}</Text>
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
      <Avatar name={profile.displayName} />
      <View style={styles.personText}>
        <Text style={styles.personName}>{profile.displayName}</Text>
        {profile.email ? <Text style={styles.personMeta}>{profile.email}</Text> : null}
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

function RequestRow({
  request,
  onAccept,
  onDecline,
  busyAction,
  metaText,
}: {
  request: FriendRequest;
  onAccept: () => void;
  onDecline: () => void;
  busyAction: string | null;
  metaText: string;
}) {
  const acceptBusy = busyAction === `accept:${request.id}`;
  const declineBusy = busyAction === `decline:${request.id}`;

  return (
    <Card style={styles.personCard}>
      <Avatar name={request.fromDisplayName} />
      <View style={styles.personText}>
        <Text style={styles.personName}>{request.fromDisplayName}</Text>
        <Text style={styles.personMeta}>{metaText}</Text>
      </View>
      <View style={styles.requestActions}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Accept request"
          activeOpacity={0.82}
          disabled={acceptBusy || declineBusy}
          onPress={onAccept}
          style={styles.smallIconButton}
        >
          {acceptBusy ? <ActivityIndicator color={Colors.surface} size="small" /> : <Check size={18} color={Colors.surface} />}
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Decline request"
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
  const [currentProfile, setCurrentProfile] = useState<FriendProfile | null>(null);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequest[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<FriendProfile[]>([]);
  const [searchText, setSearchText] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const outgoingUserIds = useMemo(
    () => new Set(outgoingRequests.map((request) => request.toUserId)),
    [outgoingRequests]
  );

  const loadFriends = useCallback(async () => {
    if (!user) {
      setCurrentProfile(null);
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      setSuggestedUsers([]);
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const profile = await getCurrentUserProfile();
      setCurrentProfile(profile);

      const [nextFriends, nextIncoming, nextOutgoing, nextSuggested] = await Promise.all([
        getFriends(user.uid),
        getIncomingFriendRequests(user.uid),
        getOutgoingFriendRequests(user.uid),
        searchUsers(""),
      ]);

      setFriends(nextFriends);
      setIncomingRequests(nextIncoming);
      setOutgoingRequests(nextOutgoing);
      setSuggestedUsers(nextSuggested);
    } catch (nextError) {
      console.warn("[FriendsScreen] load error:", nextError);
      setError(t("friends.errorBody"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t, user]);

  useEffect(() => {
    if (authLoading) return;
    setLoading(true);
    void loadFriends();
  }, [authLoading, loadFriends]);

  useEffect(() => {
    if (!user) return;

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        setSuggestedUsers(await searchUsers(searchText));
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(timeout);
  }, [searchText, user]);

  const runAction = useCallback(
    async (actionId: string, action: () => Promise<void>) => {
      setBusyAction(actionId);
      setError(null);
      try {
        await action();
        await loadFriends();
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : t("friends.errorBody");
        setError(message);
      } finally {
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

  const openDirectChat = useCallback(
    async (friend: FriendProfile) => {
      setBusyAction(`chat:${friend.id}`);
      setError(null);
      try {
        const chatId = await getOrCreateDirectChat(friend.id, friend.displayName);
        router.push({ pathname: "/(social)/chat/[chatId]", params: { chatId } });
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : t("friends.errorBody");
        setError(message);
      } finally {
        setBusyAction(null);
      }
    },
    [t]
  );

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
      <ScrollView
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

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorTitle}>{t("friends.errorTitle")}</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.82} onPress={onRefresh} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("friends.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        <SectionTitle title={t("friends.requests")} count={incomingRequests.length} />
        {incomingRequests.length > 0 ? (
          incomingRequests.map((request) => (
            <RequestRow
              key={request.id}
              request={request}
              busyAction={busyAction}
              metaText={t("friends.requestMeta")}
              onAccept={() => void runAction(`accept:${request.id}`, () => acceptFriendRequest(request.id))}
              onDecline={() => void runAction(`decline:${request.id}`, () => declineFriendRequest(request.id))}
            />
          ))
        ) : (
          <EmptyState title={t("friends.noRequestsTitle")} body={t("friends.noRequestsBody")} />
        )}

        {outgoingRequests.length > 0 ? (
          <>
            <SectionTitle title={t("friends.outgoing")} count={outgoingRequests.length} />
            {outgoingRequests.map((request) => (
              <Card key={request.id} style={styles.personCard}>
                <Avatar name={request.toDisplayName} />
                <View style={styles.personText}>
                  <Text style={styles.personName}>{request.toDisplayName}</Text>
                  <Text style={styles.personMeta}>{t("friends.pending")}</Text>
                </View>
              </Card>
            ))}
          </>
        ) : null}

        <SectionTitle title={t("friends.myFriends")} count={friends.length} />
        {friends.length > 0 ? (
          friends.map((friend) => (
            <FriendRow
              key={friend.id}
              profile={friend}
              actionLabel={t("friends.remove")}
              actionIcon={<UserMinus size={18} color={Colors.surface} />}
              danger
              busy={busyAction === `remove:${friend.id}`}
              onAction={() => confirmRemove(friend)}
              secondaryActionLabel={t("chat.startConversation")}
              secondaryActionIcon={<MessageCircle size={18} color={Colors.surface} />}
              secondaryBusy={busyAction === `chat:${friend.id}`}
              onSecondaryAction={() => void openDirectChat(friend)}
            />
          ))
        ) : (
          <EmptyState title={t("friends.emptyTitle")} body={t("friends.emptyBody")} />
        )}

        <SectionTitle title={t("friends.suggested")} />
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

        {suggestedUsers.length > 0 ? (
          suggestedUsers.map((profile) => {
            const pending = outgoingUserIds.has(profile.id);
            return (
              <FriendRow
                key={profile.id}
                profile={profile}
                actionLabel={pending ? t("friends.pending") : t("friends.addFriend")}
                actionIcon={<UserPlus size={18} color={Colors.surface} />}
                busy={busyAction === `add:${profile.id}`}
                disabled={pending}
                onAction={() => void runAction(`add:${profile.id}`, () => sendFriendRequest(profile.id))}
              />
            );
          })
        ) : (
          <EmptyState title={t("friends.noSuggestionsTitle")} body={t("friends.noSuggestionsBody")} />
        )}
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
