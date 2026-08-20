import React, { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Linking, ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, CalendarDays, Copy, RefreshCw, Trash2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { createCalendarSubscription, revokeCalendarSubscription } from "@/services/teamCalendarIntegrationService";

export default function SubscribeTeamCalendarScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [links, setLinks] = useState<{ httpsUrl: string; webcalUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (busy) return; setBusy(true); setError(null);
    try { const result = await createCalendarSubscription(teamId); setLinks({ httpsUrl: result.httpsUrl, webcalUrl: result.webcalUrl }); }
    catch { setError(t("schedule.subscription.error")); }
    finally { setBusy(false); }
  }, [busy, t, teamId]);

  const revoke = useCallback(() => {
    if (busy) return;
    Alert.alert(t("schedule.subscription.revokeTitle"), t("schedule.subscription.revokeBody"), [{ text: t("common.cancel"), style: "cancel" }, { text: t("schedule.subscription.revoke"), style: "destructive", onPress: () => { setBusy(true); void revokeCalendarSubscription(teamId).then(() => setLinks(null)).catch(() => setError(t("schedule.subscription.error"))).finally(() => setBusy(false)); } }]);
  }, [busy, t, teamId]);

  const shareLink = useCallback(async () => { if (!links) return; try { await Share.share({ message: links.httpsUrl, title: t("schedule.subscription.copy") }); } catch { setError(t("schedule.subscription.copyError")); } }, [links, t]);
  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.back}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity><Text accessibilityRole="header" style={styles.title}>{t("schedule.subscription.title")}</Text></View>
    <Card style={styles.info}><CalendarDays color={Colors.communicationLink} size={25} /><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.subscription.completeTitle")}</Text><Text style={styles.body}>{t("schedule.subscription.body")}</Text><Text style={styles.notice}>{t("schedule.subscription.refreshNotice")}</Text></View></Card>
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {!links ? <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy }} disabled={busy} onPress={() => { void generate(); }} style={styles.primary}>{busy ? <ActivityIndicator color={Colors.surface} /> : <RefreshCw color={Colors.surface} size={18} />}<Text style={styles.primaryText}>{t("schedule.subscription.generate")}</Text></TouchableOpacity> : <>
      <TouchableOpacity accessibilityHint={t("schedule.subscription.googleHint")} accessibilityRole="link" onPress={() => { void Linking.openURL(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(links.httpsUrl)}`); }} style={styles.primary}><CalendarDays color={Colors.surface} size={18} /><Text style={styles.primaryText}>{t("schedule.subscription.google")}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="link" onPress={() => { void Linking.openURL(links.webcalUrl); }} style={styles.outline}><CalendarDays color={Colors.communicationLink} size={18} /><Text style={styles.outlineText}>{t("schedule.subscription.appleOther")}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityHint={t("schedule.subscription.copyHint")} accessibilityRole="button" onPress={() => { void shareLink(); }} style={styles.outline}><Copy color={Colors.communicationLink} size={18} /><Text style={styles.outlineText}>{t("schedule.subscription.copy")}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={() => { void generate(); }} style={styles.outline}><RefreshCw color={Colors.communicationLink} size={18} /><Text style={styles.outlineText}>{t("schedule.subscription.regenerate")}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={revoke} style={styles.danger}><Trash2 color={Colors.primary} size={18} /><Text style={styles.dangerText}>{t("schedule.subscription.revoke")}</Text></TouchableOpacity>
      <Text style={styles.credentialWarning}>{t("schedule.subscription.credentialWarning")}</Text>
    </>}
  </ScrollView></ScreenWrapper>;
}
function normalizeParam(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
const styles = StyleSheet.create({ content: { gap: Spacing.md, padding: Spacing.lg }, header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm }, back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 }, title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 }, info: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.md }, copy: { flex: 1, gap: 5 }, cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 }, notice: { color: Colors.communicationLink, fontFamily: Typography.bodyMedium, fontSize: 12, lineHeight: 18 }, error: { backgroundColor: "#F6DDDA", borderRadius: Radius.sm, color: Colors.primary, fontFamily: Typography.bodySemiBold, padding: Spacing.sm }, primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 50 }, primaryText: { color: Colors.surface, flexShrink: 1, fontFamily: Typography.bodySemiBold }, outline: { alignItems: "center", borderColor: Colors.communicationLink, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 50, paddingHorizontal: Spacing.sm }, outlineText: { color: Colors.communicationLink, flexShrink: 1, fontFamily: Typography.bodySemiBold }, danger: { alignItems: "center", flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 46 }, dangerText: { color: Colors.primary, fontFamily: Typography.bodySemiBold }, credentialWarning: { color: Colors.primary, fontFamily: Typography.bodyMedium, fontSize: 12, lineHeight: 18, textAlign: "center" } });
