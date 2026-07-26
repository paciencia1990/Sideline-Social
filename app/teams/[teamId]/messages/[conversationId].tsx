import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { PrivateTeamMessageThread } from "@/components/PrivateTeamMessageThread";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function ParentPrivateTeamMessageScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[]; conversationId?: string | string[] }>();
  const teamId = normalize(params.teamId);
  const conversationId = normalize(params.conversationId);
  return <ScreenWrapper><View style={styles.content}><View style={styles.header}><TouchableOpacity accessibilityLabel={t("teamMessages.back")} accessibilityRole="button" onPress={() => router.replace(`/teams/${teamId}` as never)} style={styles.back}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity><Text accessibilityRole="header" style={styles.title}>{t("teamMessages.title")}</Text></View><PrivateTeamMessageThread conversationId={conversationId} role="parent" /></View></ScreenWrapper>;
}
function normalize(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
const styles = StyleSheet.create({ content: { flex: 1, gap: Spacing.md, padding: Spacing.lg }, header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm }, back: { alignItems: "center", height: 44, justifyContent: "center", width: 44 }, title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 26 } });
