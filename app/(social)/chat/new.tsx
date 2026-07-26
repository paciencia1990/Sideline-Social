import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ArrowLeft, Check, MessageCircle, Users } from "lucide-react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  MAX_CHAT_PARTICIPANTS,
  createFriendGroupConversation,
  createOrOpenDirectConversation,
  mapFriendChatError,
} from "@/services/chatService";
import { getFriends, type FriendProfile } from "@/services/friendsService";

export default function NewFriendChatScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    void getFriends(user.uid)
      .then(setFriends)
      .catch(() => setError(t("chat.temporarilyUnavailable")))
      .finally(() => setLoading(false));
  }, [t, user?.uid]);

  const isGroup = selectedIds.length > 1;
  const maxSelected = MAX_CHAT_PARTICIPANTS - 1;
  const selectedLabel = useMemo(() => t("chat.selectedCount", { count: selectedIds.length, max: maxSelected }), [maxSelected, selectedIds.length, t]);

  const toggleFriend = (friendId: string) => {
    setError(null);
    setSelectedIds((current) => {
      if (current.includes(friendId)) return current.filter((id) => id !== friendId);
      if (current.length >= maxSelected) {
        setError(t("chat.participantLimit", { count: MAX_CHAT_PARTICIPANTS }));
        return current;
      }
      return [...current, friendId];
    });
  };

  const createChat = async () => {
    if (selectedIds.length === 0 || submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const result = selectedIds.length === 1
        ? await createOrOpenDirectConversation(selectedIds[0])
        : await createFriendGroupConversation(selectedIds, groupName.trim() || null);
      router.replace(`/(social)/chat/${result.conversationId}` as never);
    } catch (nextError) {
      setError(errorCopy(mapFriendChatError(nextError), t));
    } finally {
      submissionInFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={t("common.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}><Text accessibilityRole="header" style={styles.title}>{t("chat.newChat")}</Text><Text style={styles.selected}>{selectedLabel}</Text></View>
        </View>

        {loading ? <View style={styles.loading}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("chat.loadingFriends")}</Text></View> : null}
        {!loading && friends.length === 0 ? (
          <Card style={styles.empty}><Users color={Colors.primary} size={36} /><Text style={styles.emptyTitle}>{t("chat.noAcceptedFriends")}</Text><Text style={styles.body}>{t("chat.addFriendsToChat")}</Text><TouchableOpacity accessibilityRole="button" onPress={() => router.push("/(tabs)/friends")} style={styles.primary}><Text style={styles.primaryText}>{t("friends.title")}</Text></TouchableOpacity></Card>
        ) : null}

        {friends.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t("chat.selectFriends")}</Text>
            {friends.map((friend) => {
              const selected = selectedIds.includes(friend.id);
              return (
                <TouchableOpacity
                  key={friend.id}
                  accessibilityLabel={friend.displayName}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: !selected && selectedIds.length >= maxSelected }}
                  onPress={() => toggleFriend(friend.id)}
                >
                  <Card style={[styles.friendRow, selected && styles.friendSelected]}>
                    <View style={styles.avatar}><Text style={styles.avatarText}>{friend.displayName.slice(0, 1).toUpperCase()}</Text></View>
                    <Text style={styles.friendName}>{friend.displayName}</Text>
                    <View style={[styles.checkbox, selected && styles.checkboxSelected]}>{selected ? <Check color={Colors.surface} size={16} /> : null}</View>
                  </Card>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : null}

        {isGroup ? (
          <Card style={styles.groupCard}>
            <View style={styles.groupHeader}><MessageCircle color={Colors.primary} size={20} /><Text style={styles.sectionTitle}>{t("chat.newGroup")}</Text></View>
            <Text style={styles.label}>{t("chat.groupName")} · {t("chat.optional")}</Text>
            <TextInput
              accessibilityLabel={t("chat.groupName")}
              maxLength={60}
              onChangeText={setGroupName}
              placeholder={t("chat.groupNamePlaceholder")}
              placeholderTextColor={Colors.textPrimary}
              style={styles.input}
              value={groupName}
            />
          </Card>
        ) : null}

        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
        {friends.length > 0 ? (
          <TouchableOpacity
            accessibilityLabel={submitting ? t("chat.creatingChat") : t("chat.createChat")}
            accessibilityRole="button"
            accessibilityState={{ busy: submitting, disabled: submitting || selectedIds.length === 0 }}
            disabled={submitting || selectedIds.length === 0}
            onPress={() => void createChat()}
            style={[styles.primary, (submitting || selectedIds.length === 0) && styles.disabled]}
          >
            {submitting ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryText}>{t("chat.createChat")}</Text>}
          </TouchableOpacity>
        ) : null}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function errorCopy(error: ReturnType<typeof mapFriendChatError>, t: ReturnType<typeof useTranslation>["t"]) {
  if (error === "blocked") return t("chat.blocked");
  if (error === "permission") return t("chat.acceptedFriendsOnly");
  if (error === "network") return t("chat.checkConnection");
  return t("chat.tryAgain");
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  headerCopy: { flex: 1 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 28 },
  selected: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  loading: { alignItems: "center", gap: Spacing.sm, padding: Spacing.xl },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  empty: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 17 },
  friendRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  friendSelected: { borderColor: Colors.primary, borderWidth: 2 },
  avatar: { alignItems: "center", backgroundColor: Colors.background, borderRadius: 20, height: 40, justifyContent: "center", width: 40 },
  avatarText: { color: Colors.primary, fontFamily: Typography.bodyBold },
  friendName: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold },
  checkbox: { alignItems: "center", borderColor: Colors.secondary, borderRadius: 11, borderWidth: 2, height: 22, justifyContent: "center", width: 22 },
  checkboxSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  groupCard: { gap: Spacing.sm },
  groupHeader: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  label: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 46, paddingHorizontal: Spacing.md },
  primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  disabled: { opacity: 0.45 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
});
