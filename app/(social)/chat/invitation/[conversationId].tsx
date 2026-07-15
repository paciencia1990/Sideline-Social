import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ArrowLeft, Users } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getConversationDisplayTitle,
  getFriendConversationAccess,
  getFriendConversationMembers,
  mapFriendChatError,
  respondToFriendGroupInvitation,
  type ConversationAccess,
  type FriendConversationMember,
} from "@/services/chatService";
import { acknowledgeNotificationAfterOpen } from "@/services/notificationService";

export default function FriendChatInvitationScreen() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ conversationId?: string; notificationId?: string }>();
  const conversationId = single(params.conversationId);
  const notificationId = single(params.notificationId);
  const [access, setAccess] = useState<ConversationAccess | null>(null);
  const [members, setMembers] = useState<FriendConversationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [responding, setResponding] = useState<"accept" | "decline" | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    let active = true;
    if (!user?.uid || !conversationId) {
      setLoading(false);
      setErrorKey("chat.invitationUnavailable");
      return;
    }
    void (async () => {
      try {
        const nextAccess = await getFriendConversationAccess(conversationId);
        if (!active) return;
        if (!nextAccess || nextAccess.conversation.conversationType !== "group" || nextAccess.member.status !== "invited") {
          setErrorKey("chat.invitationUnavailable");
          return;
        }
        const nextMembers = await getFriendConversationMembers(conversationId);
        if (!active) return;
        setAccess(nextAccess);
        setMembers(nextMembers);
        if (notificationId) void acknowledgeNotificationAfterOpen(notificationId);
      } catch (error) {
        if (active) setErrorKey(errorTranslationKey(mapFriendChatError(error)));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [authLoading, conversationId, notificationId, user?.uid]);

  const title = useMemo(() => access && user?.uid
    ? getConversationDisplayTitle(access.conversation, user.uid, t("chat.unnamedGroup"))
    : t("chat.groupInvitation"), [access, t, user?.uid]);
  const inviterName = access?.member.invitedBy
    ? access.conversation.participantNameSnapshots[access.member.invitedBy] || t("chat.aFriend")
    : t("chat.aFriend");
  const participantNames = members.map((member) => member.displayNameSnapshot).filter(Boolean).join(", ");

  const respond = async (response: "accept" | "decline") => {
    if (!conversationId || responding) return;
    setResponding(response);
    setErrorKey(null);
    try {
      await respondToFriendGroupInvitation(conversationId, response);
      if (response === "accept") {
        router.replace({ pathname: "/(social)/chat/[chatId]", params: { chatId: conversationId } });
      } else {
        router.replace("/(social)/chat");
      }
    } catch (error) {
      setErrorKey(errorTranslationKey(mapFriendChatError(error)));
    } finally {
      setResponding(null);
    }
  };

  if (authLoading || loading) return <ScreenWrapper><Centered><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("chat.loadingInvitation")}</Text></Centered></ScreenWrapper>;
  if (!access || errorKey) return <ScreenWrapper><Centered><Text style={styles.title}>{t("chat.invitationUnavailableTitle")}</Text><Text style={styles.body}>{t(errorKey ?? "chat.invitationUnavailable")}</Text><BackButton /></Centered></ScreenWrapper>;

  return (
    <ScreenWrapper>
      <View style={styles.header}>
        <TouchableOpacity accessibilityLabel={t("chat.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity>
        <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>{t("chat.groupInvitation")}</Text>
      </View>
      <View style={styles.content}>
        <Card style={styles.card}>
          <View style={styles.groupIcon}><Users color={Colors.surface} size={30} /></View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{t("chat.invitedBy", { name: inviterName })}</Text>
          <Text style={styles.count}>{t("chat.participantCount", { count: access.conversation.activeParticipantCount })}</Text>
          {participantNames ? <Text style={styles.names}>{participantNames}</Text> : null}
          <Text style={styles.historyNotice}>{t("chat.invitationHistoryNotice")}</Text>
          {errorKey ? <Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={Boolean(responding)} onPress={() => void respond("accept")} style={[styles.primary, responding && styles.disabled]}>
            {responding === "accept" ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryText}>{t("chat.acceptInvitation")}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={Boolean(responding)} onPress={() => void respond("decline")} style={[styles.secondary, responding && styles.disabled]}>
            {responding === "decline" ? <ActivityIndicator color={Colors.primary} /> : <Text style={styles.secondaryText}>{t("chat.declineInvitation")}</Text>}
          </TouchableOpacity>
        </Card>
      </View>
    </ScreenWrapper>
  );
}

function Centered({ children }: { children: React.ReactNode }) { return <View style={styles.center}>{children}</View>; }
function BackButton() { const { t } = useTranslation(); return <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/(social)/chat")} style={styles.primary}><Text style={styles.primaryText}>{t("chat.backToChats")}</Text></TouchableOpacity>; }
function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
function errorTranslationKey(error: ReturnType<typeof mapFriendChatError>) {
  if (error === "network") return "chat.networkError";
  if (error === "permission") return "chat.noAccess";
  return "chat.invitationUnavailable";
}

const styles = StyleSheet.create({
  header: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", minHeight: 56, paddingHorizontal: Spacing.md },
  iconButton: { alignItems: "center", height: 40, justifyContent: "center", marginRight: Spacing.sm, width: 40 },
  headerTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  content: { flex: 1, justifyContent: "center", padding: Spacing.lg },
  card: { alignItems: "center", gap: Spacing.md, padding: Spacing.lg },
  groupIcon: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 32, height: 64, justifyContent: "center", width: 64 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 25, textAlign: "center" },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22, textAlign: "center" },
  count: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  names: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19, textAlign: "center" },
  historyNotice: { backgroundColor: Colors.background, borderRadius: Radius.sm, color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18, padding: Spacing.md, textAlign: "center" },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
  primary: { alignItems: "center", alignSelf: "stretch", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.lg },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  secondary: { alignItems: "center", alignSelf: "stretch", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.lg },
  secondaryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabled: { opacity: 0.55 },
  center: { alignItems: "center", flex: 1, gap: Spacing.md, justifyContent: "center", padding: Spacing.xl },
});
