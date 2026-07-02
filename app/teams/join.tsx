import React, { useCallback, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { joinTeamByInviteCode } from "@/services/teamService";

export default function JoinTeamScreen() {
  const { t } = useTranslation();
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleJoin = useCallback(async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) {
      setError(t("team.join.enterCode"));
      return;
    }

    setLoading(true);
    setError(null);
    setMessage(null);
    try {
      const team = await joinTeamByInviteCode(code);
      setMessage(t("team.join.success", { team: team.name }));
      router.replace({ pathname: "/coach/team", params: { teamId: team.id } } as never);
    } catch (nextError) {
      console.warn("[JoinTeam] error:", nextError);
      setError(nextError instanceof Error ? nextError.message : t("team.join.error"));
    } finally {
      setLoading(false);
    }
  }, [inviteCode, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("team.join.title")}</Text>
          <Text style={styles.subtitle}>{t("team.join.subtitle")}</Text>
        </View>

        <Card style={styles.card}>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={(value) => setInviteCode(value.toUpperCase())}
            placeholder={t("team.join.enterCode")}
            placeholderTextColor={Colors.textPrimary}
            style={styles.input}
            value={inviteCode}
          />
          {message ? <Text style={styles.successText}>{message}</Text> : null}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <TouchableOpacity activeOpacity={0.86} disabled={loading} onPress={handleJoin} style={[styles.primaryButton, loading && styles.disabledButton]}>
            {loading ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryButtonText}>{t("coach.team.joinTeam")}</Text>}
          </TouchableOpacity>
        </Card>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 31, textAlign: "center" },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21, textAlign: "center" },
  card: { gap: Spacing.md },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 22, letterSpacing: 4, minHeight: 52, paddingHorizontal: Spacing.md, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.55 },
  successText: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
});