import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, CalendarPlus, FileUp, Link2, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { getTeamScheduleAccess } from "@/services/teamScheduleService";

export default function AddTeamScheduleScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTeamScheduleAccess(teamId).then((access) => {
      if (!access.canManage || access.teamStatus !== "active") throw new Error("unauthorized");
      setReady(true);
    }).catch(() => setError(t("schedule.errors.importUnauthorized")));
  }, [t, teamId]);

  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}>
      <TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ArrowLeft color={Colors.textHeading} size={22} />
      </TouchableOpacity>
      <Text accessibilityRole="header" style={styles.title}>{t("schedule.addSchedule.title")}</Text>
    </View>
    <Text style={styles.intro}>{t("schedule.addSchedule.intro")}</Text>
    {!ready && !error ? <ActivityIndicator accessibilityLabel={t("schedule.loading")} color={Colors.primary} /> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {ready ? <>
      <Option Icon={Link2} title={t("schedule.addSchedule.connectTitle")} badge={t("schedule.addSchedule.recommended")} body={t("schedule.addSchedule.connectBody")} onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/connect", params: { teamId } } as never)} />
      <Option Icon={FileUp} title={t("schedule.addSchedule.uploadTitle")} body={t("schedule.addSchedule.uploadBody")} onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/upload", params: { teamId } } as never)} />
      <Option Icon={CalendarPlus} title={t("schedule.addSchedule.createTitle")} body={t("schedule.addSchedule.createBody")} onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/edit", params: { teamId } } as never)} />
    </> : null}
  </ScrollView></ScreenWrapper>;
}

function Option({ Icon, title, badge, body, onPress }: { Icon: LucideIcon; title: string; badge?: string; body: string; onPress: () => void }) {
  return <TouchableOpacity accessibilityHint={body} accessibilityLabel={title} accessibilityRole="button" activeOpacity={0.84} onPress={onPress}>
    <Card style={styles.option}>
      <View style={styles.icon}><Icon color={Colors.communicationLink} size={24} /></View>
      <View style={styles.copy}><View style={styles.optionHeader}><Text style={styles.optionTitle}>{title}</Text>{badge ? <Text style={styles.badge}>{badge}</Text> : null}</View><Text style={styles.body}>{body}</Text></View>
    </Card>
  </TouchableOpacity>;
}

function normalizeParam(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 },
  intro: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22 },
  error: { backgroundColor: "#F6DDDA", borderRadius: Radius.sm, color: Colors.primary, fontFamily: Typography.bodySemiBold, padding: Spacing.md },
  option: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.md, minHeight: 112 },
  icon: { alignItems: "center", backgroundColor: "#E8EDF1", borderRadius: 24, height: 48, justifyContent: "center", width: 48 },
  copy: { flex: 1, gap: Spacing.xs, minWidth: 0 },
  optionHeader: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  optionTitle: { color: Colors.textHeading, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 18 },
  badge: { backgroundColor: "#E5EEE7", borderRadius: Radius.sm, color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 10, paddingHorizontal: Spacing.xs, paddingVertical: 4, textTransform: "uppercase" },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 },
});
