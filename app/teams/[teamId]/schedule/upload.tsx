import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, FileSpreadsheet, CalendarRange } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Spacing, Typography } from "@/constants/theme";

export default function UploadTeamScheduleScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.back}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity><Text accessibilityRole="header" style={styles.title}>{t("schedule.upload.title")}</Text></View>
    <Text style={styles.body}>{t("schedule.upload.body")}</Text>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/import", params: { teamId } } as never)}><Card style={styles.card}><FileSpreadsheet color={Colors.communicationLink} size={25} /><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.upload.csvTitle")}</Text><Text style={styles.body}>{t("schedule.upload.csvBody")}</Text></View></Card></TouchableOpacity>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/import-ics", params: { teamId } } as never)}><Card style={styles.card}><CalendarRange color={Colors.communicationLink} size={25} /><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.upload.icsTitle")}</Text><Text style={styles.body}>{t("schedule.upload.icsBody")}</Text></View></Card></TouchableOpacity>
    <Text style={styles.future}>{t("schedule.upload.xlsxFuture")}</Text>
  </ScrollView></ScreenWrapper>;
}
function normalizeParam(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
const styles = StyleSheet.create({ content: { gap: Spacing.md, padding: Spacing.lg }, header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm }, back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 }, title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 }, card: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.md }, copy: { flex: 1, gap: 4 }, cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 }, future: { color: Colors.communicationLink, fontFamily: Typography.bodyMedium, fontSize: 12, lineHeight: 18 } });
