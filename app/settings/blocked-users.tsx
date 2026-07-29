import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { getBlockedFriendChatUserIds, unblockFriendChatUser } from "@/services/chatService";
import { getPublicUserProfiles } from "@/services/publicProfileService";

type BlockedUser = { id: string; displayName: string };

export default function BlockedUsersScreen() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<BlockedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ids = await getBlockedFriendChatUserIds();
      const profiles = await getPublicUserProfiles(ids);
      const profilesById = new Map(profiles.map((profile) => [profile.userId, profile]));
      setUsers(ids.map((id) => {
        const profile = profilesById.get(id);
        return {
          id,
          displayName: profile?.displayName || t(profile?.profileState === "deleted"
            ? "common.formerMember"
            : "common.sidelineSocialMember"),
        };
      }));
    } catch {
      setError(t("settings.blockedLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const unblock = useCallback(async (userId: string) => {
    setBusyId(userId);
    setError(null);
    try {
      await unblockFriendChatUser(userId);
      setUsers((current) => current.filter((user) => user.id !== userId));
    } catch {
      setError(t("settings.unblockError"));
    } finally {
      setBusyId(null);
    }
  }, [t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <Text style={styles.title}>{t("settings.blockedUsers")}</Text>
        <Text style={styles.body}>{t("settings.blockedUsersBody")}</Text>
        {loading ? <ActivityIndicator color={Colors.primary} /> : null}
        {!loading && users.length === 0 ? <Text style={styles.body}>{t("settings.noBlockedUsers")}</Text> : null}
        {users.map((user) => (
          <View key={user.id} style={styles.row}>
            <Text style={styles.name}>{user.displayName}</Text>
            <TouchableOpacity accessibilityRole="button" disabled={busyId === user.id} onPress={() => void unblock(user.id)} style={styles.button}>
              <Text style={styles.buttonText}>{t("settings.unblock")}</Text>
            </TouchableOpacity>
          </View>
        ))}
        {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21 },
  button: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  buttonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  content: { gap: Spacing.md, padding: Spacing.lg },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  name: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold },
  row: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: Radius.card, flexDirection: "row", gap: Spacing.md, minHeight: 64, padding: Spacing.md },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
});
