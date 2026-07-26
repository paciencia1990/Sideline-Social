import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { ArrowLeft, Check, Shield, UserPlus, Users } from "lucide-react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  blockFriendChatUser,
  getConversationDisplayTitle,
  getFriendConversationAccess,
  getFriendConversationMembers,
  inviteFriendsToGroupConversation,
  leaveFriendConversation,
  MAX_CHAT_PARTICIPANTS,
  mapFriendChatError,
  removeFriendGroupMember,
  renameFriendGroupConversation,
  reportFriendChatUser,
  setFriendConversationMuted,
  setFriendGroupAdminRole,
  transferFriendGroupOwnership,
  type ConversationAccess,
  type FriendConversationMember,
} from "@/services/chatService";
import { getFriends, type FriendProfile } from "@/services/friendsService";

export default function FriendChatManageScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  const conversationId = Array.isArray(params.conversationId) ? params.conversationId[0] : params.conversationId;
  const [access, setAccess] = useState<ConversationAccess | null>(null);
  const [members, setMembers] = useState<FriendConversationMember[]>([]);
  const [friends, setFriends] = useState<FriendProfile[]>([]);
  const [selectedInviteIds, setSelectedInviteIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!conversationId) { setLoading(false); return; }
    try {
      const nextAccess = await getFriendConversationAccess(conversationId);
      if (!nextAccess || nextAccess.member.status !== "active") { setErrorKey("chat.noAccess"); return; }
      const [nextMembers, nextFriends] = await Promise.all([
        getFriendConversationMembers(conversationId),
        nextAccess.conversation.conversationType === "group" && user?.uid ? getFriends(user.uid) : Promise.resolve([]),
      ]);
      setAccess(nextAccess); setMembers(nextMembers); setFriends(nextFriends);
      setGroupName(nextAccess.conversation.groupName ?? ""); setErrorKey(null);
    } catch (error) { setErrorKey(errorTranslationKey(mapFriendChatError(error))); }
    finally { setLoading(false); }
  }, [conversationId, user?.uid]);
  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, action: () => Promise<unknown>, reload = true) => {
    if (busy) return;
    setBusy(key); setErrorKey(null);
    try { await action(); if (reload) await load(); }
    catch (error) { setErrorKey(errorTranslationKey(mapFriendChatError(error))); }
    finally { setBusy(null); }
  };
  const isGroup = access?.conversation.conversationType === "group";
  const isOwner = access?.member.role === "owner";
  const isAdmin = access?.member.role === "admin" || isOwner;
  const availableFriends = useMemo(() => {
    const excluded = new Set([...members.map((member) => member.userId), ...(access?.conversation.invitedParticipantIds ?? [])]);
    return friends.filter((friend) => !excluded.has(friend.id));
  }, [access?.conversation.invitedParticipantIds, friends, members]);
  const title = access && user?.uid
    ? getConversationDisplayTitle(access.conversation, user.uid, t("chat.unnamedGroup"), t("common.formerMember"), t("common.sidelineSocialMember"))
    : t("chat.conversationSettings");

  const confirmMemberAction = (member: FriendConversationMember) => {
    if (!conversationId || member.userId === user?.uid || !isGroup) return;
    const options: { text: string; style?: "cancel" | "destructive"; onPress?: () => void }[] = [{ text: t("common.cancel"), style: "cancel" }];
    if (isOwner && member.role !== "owner") options.push({ text: member.role === "admin" ? t("chat.removeAdmin") : t("chat.makeAdmin"), onPress: () => void run(`role:${member.userId}`, () => setFriendGroupAdminRole(conversationId, member.userId, member.role !== "admin")) });
    if (isOwner) options.push({ text: t("chat.transferOwnership"), onPress: () => confirmTransfer(member) });
    if (isAdmin && member.role !== "owner" && !(access?.member.role === "admin" && member.role === "admin")) options.push({ text: t("chat.removeMember"), style: "destructive", onPress: () => void run(`remove:${member.userId}`, () => removeFriendGroupMember(conversationId, member.userId)) });
    options.push({ text: t("chat.reportUser"), onPress: () => void run(`report:${member.userId}`, async () => { await reportFriendChatUser(conversationId, member.userId); Alert.alert(t("chat.reportSentTitle"), t("chat.reportSentBody")); }, false) });
    options.push({ text: t("chat.blockUser"), style: "destructive", onPress: () => Alert.alert(t("chat.blockUser"), t("chat.blockUserBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("chat.block"), style: "destructive", onPress: () => void run(`block:${member.userId}`, () => blockFriendChatUser(member.userId)) }]) });
    Alert.alert(member.displayNameSnapshot, t("chat.memberOptionsBody"), options);
  };
  const confirmTransfer = (member: FriendConversationMember) => Alert.alert(t("chat.transferOwnership"), t("chat.transferOwnershipBody", { name: member.displayNameSnapshot }), [
    { text: t("common.cancel"), style: "cancel" },
    { text: t("chat.transfer"), onPress: () => conversationId && void run(`transfer:${member.userId}`, () => transferFriendGroupOwnership(conversationId, member.userId)) },
  ]);

  if (loading) return <ScreenWrapper><View style={styles.center}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("common.loading")}</Text></View></ScreenWrapper>;
  if (!access) return <ScreenWrapper><View style={styles.center}><Text style={styles.title}>{t("chat.cannotOpenTitle")}</Text><Text style={styles.body}>{t(errorKey ?? "chat.noAccess")}</Text></View></ScreenWrapper>;

  const directFriendId = isGroup ? null : access.conversation.activeParticipantIds.find((id) => id !== user?.uid) ?? null;
  return (
    <ScreenWrapper>
      <View style={styles.header}><TouchableOpacity accessibilityLabel={t("chat.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity><Text numberOfLines={1} style={styles.headerTitle}>{t("chat.conversationSettings")}</Text></View>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <View><Text style={styles.title}>{title}</Text><Text style={styles.body}>{isGroup ? t("chat.groupConversation") : t("chat.directConversation")}</Text></View>
        {errorKey ? <Card style={styles.errorCard}><Text accessibilityRole="alert" style={styles.error}>{t(errorKey)}</Text></Card> : null}

        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>{t("chat.notifications")}</Text>
          <TouchableOpacity accessibilityRole="button" disabled={Boolean(busy)} onPress={() => conversationId && void run("mute", () => setFriendConversationMuted(conversationId, !access.member.muted))} style={styles.outline}><Text style={styles.outlineText}>{access.member.muted ? t("chat.unmute") : t("chat.mute")}</Text></TouchableOpacity>
        </Card>

        {isGroup ? <>
          {isAdmin ? <Card style={styles.section}><Text style={styles.sectionTitle}>{t("chat.groupName")}</Text><TextInput maxLength={60} onChangeText={setGroupName} placeholder={t("chat.optionalGroupName")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={groupName} /><TouchableOpacity accessibilityRole="button" disabled={Boolean(busy)} onPress={() => conversationId && void run("rename", () => renameFriendGroupConversation(conversationId, groupName.trim() || null))} style={styles.primary}><Text style={styles.primaryText}>{t("common.save")}</Text></TouchableOpacity></Card> : null}
          <Card style={styles.section}><View style={styles.sectionHeading}><Users color={Colors.primary} size={20} /><Text style={styles.sectionTitle}>{t("chat.members", { count: members.length })}</Text></View>{members.map((member) => {
            const name = member.displayNameSnapshot || t(member.profileState === "deleted" ? "common.formerMember" : "common.sidelineSocialMember");
            return <TouchableOpacity key={member.userId} accessibilityLabel={t("chat.memberAccessibility", { name, role: t(`chat.role.${member.role}`) })} accessibilityRole="button" disabled={member.userId === user?.uid} onPress={() => confirmMemberAction({ ...member, displayNameSnapshot: name })} style={styles.memberRow}><View style={styles.avatar}><Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.grow}><Text style={styles.memberName}>{name}{member.userId === user?.uid ? ` ${t("chat.you")}` : ""}</Text><Text style={styles.role}>{t(`chat.role.${member.role}`)}</Text></View>{member.role !== "member" ? <Shield color={Colors.accentGold} size={17} /> : null}</TouchableOpacity>;
          })}</Card>
          {isAdmin && availableFriends.length > 0 && (access.conversation.activeParticipantCount + access.conversation.invitedParticipantCount < MAX_CHAT_PARTICIPANTS) ? <Card style={styles.section}><View style={styles.sectionHeading}><UserPlus color={Colors.primary} size={20} /><Text style={styles.sectionTitle}>{t("chat.inviteFriends")}</Text></View><Text style={styles.bodyLeft}>{t("chat.inviteFriendsHint", { remaining: MAX_CHAT_PARTICIPANTS - access.conversation.activeParticipantCount - access.conversation.invitedParticipantCount })}</Text>{availableFriends.slice(0, 25).map((friend) => { const selected = selectedInviteIds.includes(friend.id); return <TouchableOpacity key={friend.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setSelectedInviteIds((ids) => selected ? ids.filter((id) => id !== friend.id) : ids.length < MAX_CHAT_PARTICIPANTS - access.conversation.activeParticipantCount - access.conversation.invitedParticipantCount ? [...ids, friend.id] : ids)} style={styles.friendRow}><Text style={styles.memberName}>{friend.displayName}</Text><View style={[styles.check, selected && styles.checked]}>{selected ? <Check color={Colors.surface} size={14} /> : null}</View></TouchableOpacity>; })}<TouchableOpacity accessibilityRole="button" disabled={Boolean(busy) || selectedInviteIds.length === 0} onPress={() => conversationId && void run("invite", async () => { await inviteFriendsToGroupConversation(conversationId, selectedInviteIds); setSelectedInviteIds([]); })} style={[styles.primary, selectedInviteIds.length === 0 && styles.disabled]}><Text style={styles.primaryText}>{t("chat.sendInvitations", { count: selectedInviteIds.length })}</Text></TouchableOpacity></Card> : null}
          <Card style={styles.section}><TouchableOpacity accessibilityRole="button" onPress={() => Alert.alert(t("chat.leaveGroup"), t(isOwner && members.length > 1 ? "chat.ownerLeaveWarning" : "chat.leaveGroupBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("chat.leave"), style: "destructive", onPress: () => conversationId && void run("leave", async () => { await leaveFriendConversation(conversationId); router.replace("/(social)/chat"); }, false) }])} style={styles.danger}><Text style={styles.dangerText}>{t("chat.leaveGroup")}</Text></TouchableOpacity></Card>
        </> : directFriendId ? <Card style={styles.section}><Text style={styles.sectionTitle}>{t("chat.safety")}</Text><TouchableOpacity accessibilityRole="button" onPress={() => void run("report", async () => { await reportFriendChatUser(conversationId!, directFriendId); Alert.alert(t("chat.reportSentTitle"), t("chat.reportSentBody")); }, false)} style={styles.outline}><Text style={styles.outlineText}>{t("chat.reportUser")}</Text></TouchableOpacity><TouchableOpacity accessibilityRole="button" onPress={() => Alert.alert(t("chat.blockUser"), t("chat.blockUserBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("chat.block"), style: "destructive", onPress: () => void run("block", async () => { await blockFriendChatUser(directFriendId); router.replace("/(social)/chat"); }, false) }])} style={styles.danger}><Text style={styles.dangerText}>{t("chat.blockUser")}</Text></TouchableOpacity></Card> : null}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function errorTranslationKey(error: ReturnType<typeof mapFriendChatError>) { return error === "network" ? "chat.networkError" : error === "permission" ? "chat.noAccess" : "chat.tryAgain"; }
const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, gap: Spacing.sm, justifyContent: "center", padding: Spacing.xl }, header: { alignItems: "center", backgroundColor: Colors.surface, borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", minHeight: 56, paddingHorizontal: Spacing.sm }, iconButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }, headerTitle: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl }, title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 27 }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" }, bodyLeft: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 }, section: { gap: Spacing.sm }, sectionHeading: { alignItems: "center", flexDirection: "row", gap: Spacing.sm }, sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 16 }, errorCard: { borderColor: Colors.primary, borderWidth: 1 }, error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 44, paddingHorizontal: Spacing.md }, primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md }, primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold }, outline: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44 }, outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold }, danger: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44 }, dangerText: { color: Colors.primary, fontFamily: Typography.bodySemiBold }, disabled: { opacity: 0.45 },
  memberRow: { alignItems: "center", borderBottomColor: Colors.secondary, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: Spacing.sm, minHeight: 54 }, avatar: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: 18, height: 36, justifyContent: "center", width: 36 }, avatarText: { color: Colors.surface, fontFamily: Typography.bodyBold }, grow: { flex: 1 }, memberName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 }, role: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 11 }, friendRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 42 }, check: { borderColor: Colors.secondary, borderRadius: 4, borderWidth: 1, height: 22, width: 22 }, checked: { alignItems: "center", backgroundColor: Colors.primary, borderColor: Colors.primary, justifyContent: "center" },
});
