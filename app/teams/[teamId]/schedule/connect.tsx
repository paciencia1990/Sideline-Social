import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Check, Link2, RefreshCw, Square, Unlink } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  calendarIntegrationErrorReason,
  confirmCalendarFeed,
  disconnectCalendarFeed,
  getCalendarConnection,
  previewCalendarFeed,
  setCalendarAutomaticSync,
  syncCalendarFeed,
  type TeamCalendarConnection,
  type TeamCalendarPreviewEvent,
} from "@/services/teamCalendarIntegrationService";

type Selectable = TeamCalendarPreviewEvent & { selected: boolean };

export default function ConnectTeamCalendarScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [connection, setConnection] = useState<TeamCalendarConnection | null>(null);
  const [automaticAvailable, setAutomaticAvailable] = useState(false);
  const [url, setUrl] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [integrationId, setIntegrationId] = useState<string | null>(null);
  const [hostname, setHostname] = useState<string | null>(null);
  const [events, setEvents] = useState<Selectable[]>([]);
  const [automatic, setAutomatic] = useState(false);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState<string | null>(null);
  const selected = useMemo(() => events.filter((event) => event.selected), [events]);

  const load = useCallback(async () => {
    setBusy("load"); setError(null);
    try { const result = await getCalendarConnection(teamId); setConnection(result.connection); setAutomaticAvailable(result.automaticSyncAvailable); }
    catch (nextError) { setError(messageFor(nextError, t)); }
    finally { setBusy(null); }
  }, [t, teamId]);
  useEffect(() => { void load(); }, [load]);

  const preview = useCallback(async () => {
    if (!url.trim() || busy) return;
    const submittedUrl = url.trim();
    setUrl(""); // A credential-bearing URL must not remain visible after submission.
    setBusy("preview"); setError(null);
    try {
      const result = await previewCalendarFeed(teamId, submittedUrl, replacing ? connection?.integrationId : undefined);
      setIntegrationId(result.integrationId ?? null); setHostname(result.hostname ?? null); setEvents(result.events.map((event) => ({ ...event, selected: true })));
      if (result.rejectedCount > 0) setError(t("schedule.connect.partial", { count: result.rejectedCount }));
    } catch (nextError) { setError(messageFor(nextError, t)); }
    finally { setBusy(null); }
  }, [busy, connection?.integrationId, replacing, t, teamId, url]);

  const confirm = useCallback(async () => {
    if (!integrationId || selected.length === 0 || busy) return;
    setBusy("confirm"); setError(null);
    try { await confirmCalendarFeed(teamId, integrationId, selected.map((event) => event.key), automatic, notifyTeam); setEvents([]); setReplacing(false); await load(); }
    catch (nextError) { setError(messageFor(nextError, t)); setBusy(null); }
  }, [automatic, busy, integrationId, load, notifyTeam, selected, t, teamId]);

  const sync = useCallback(async () => {
    if (!connection || busy) return;
    setBusy("sync"); setError(null);
    try { await syncCalendarFeed(teamId, connection.integrationId); await load(); }
    catch (nextError) { setError(messageFor(nextError, t)); setBusy(null); }
  }, [busy, connection, load, t, teamId]);

  const toggleAutomatic = useCallback(async (enabled: boolean) => {
    if (!connection || busy) return;
    setBusy("automatic"); setError(null);
    try { await setCalendarAutomaticSync(teamId, connection.integrationId, enabled); setConnection({ ...connection, automaticSyncEnabled: enabled }); }
    catch (nextError) { setError(messageFor(nextError, t)); }
    finally { setBusy(null); }
  }, [busy, connection, t, teamId]);

  const disconnect = useCallback((removeEvents: boolean) => {
    if (!connection || busy) return;
    Alert.alert(t("schedule.connect.disconnectTitle"), t("schedule.connect.disconnectBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: removeEvents ? t("schedule.connect.removeEvents") : t("schedule.connect.keepEvents"), style: removeEvents ? "destructive" : "default", onPress: () => { setBusy("disconnect"); void disconnectCalendarFeed(teamId, connection.integrationId, removeEvents).then(() => { setConnection(null); setBusy(null); }).catch((nextError) => { setError(messageFor(nextError, t)); setBusy(null); }); } },
    ]);
  }, [busy, connection, t, teamId]);

  const showInput = !connection || replacing;
  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.back}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity><Text accessibilityRole="header" style={styles.title}>{t("schedule.connect.title")}</Text></View>
    <Card style={styles.warning}><Link2 color={Colors.communicationLink} size={22} /><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.connect.secureTitle")}</Text><Text style={styles.body}>{t("schedule.connect.secureBody")}</Text></View></Card>
    {busy === "load" ? <ActivityIndicator accessibilityLabel={t("schedule.loading")} color={Colors.primary} /> : null}
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {connection && !replacing ? <ConnectionCard connection={connection} locale={i18n.language} t={t} /> : null}
    {showInput ? <Card style={styles.form}>
      <Text style={styles.label}>{t("schedule.connect.linkLabel")}</Text>
      <TextInput accessibilityHint={t("schedule.connect.linkHint")} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={setUrl} placeholder={t("schedule.connect.linkPlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={url} />
      <Text style={styles.body}>{t("schedule.connect.hostApproval")}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: busy === "preview", disabled: Boolean(busy) || !url.trim() }} disabled={Boolean(busy) || !url.trim()} onPress={() => { void preview(); }} style={styles.primary}>{busy === "preview" ? <ActivityIndicator color={Colors.surface} /> : null}<Text style={styles.primaryText}>{t("schedule.connect.preview")}</Text></TouchableOpacity>
    </Card> : null}
    {events.length > 0 ? <>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{t("schedule.connect.previewTitle", { hostname })}</Text>
      {events.map((event) => <TouchableOpacity accessibilityLabel={event.title} accessibilityRole="checkbox" accessibilityState={{ checked: event.selected }} key={event.key} onPress={() => setEvents((current) => current.map((item) => item.key === event.key ? { ...item, selected: !item.selected } : item))}><Card style={styles.event}>{event.selected ? <Check color={Colors.communicationLink} size={21} /> : <Square color={Colors.textPrimary} size={21} />}<View style={styles.copy}><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.meta}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: event.isAllDay ? undefined : "short", timeZone: event.timezone }).format(new Date(event.startAtMillis))}</Text></View></Card></TouchableOpacity>)}
      <Card style={styles.toggle}><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.connect.automatic")}</Text><Text style={styles.body}>{t(automaticAvailable ? "schedule.connect.automaticBody" : "schedule.connect.automaticUnavailable")}</Text></View><Switch accessibilityLabel={t("schedule.connect.automatic")} disabled={!automaticAvailable} onValueChange={setAutomatic} value={automatic && automaticAvailable} /></Card>
      <Card style={styles.toggle}><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.form.notifyTeam")}</Text><Text style={styles.body}>{t("schedule.import.notifyHelp")}</Text></View><Switch accessibilityLabel={t("schedule.form.notifyTeam")} onValueChange={setNotifyTeam} value={notifyTeam} /></Card>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: busy === "confirm", disabled: Boolean(busy) || selected.length === 0 }} disabled={Boolean(busy) || selected.length === 0} onPress={() => { void confirm(); }} style={styles.primary}>{busy === "confirm" ? <ActivityIndicator color={Colors.surface} /> : null}<Text style={styles.primaryText}>{t("schedule.connect.importSelected", { count: selected.length })}</Text></TouchableOpacity>
    </> : null}
    {connection && !replacing ? <>
      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: busy === "sync" }} disabled={Boolean(busy)} onPress={() => { void sync(); }} style={styles.primary}><RefreshCw color={Colors.surface} size={18} /><Text style={styles.primaryText}>{t("schedule.connect.syncNow")}</Text></TouchableOpacity>
      <Card style={styles.toggle}><View style={styles.copy}><Text style={styles.cardTitle}>{t("schedule.connect.automatic")}</Text><Text style={styles.body}>{t(automaticAvailable ? "schedule.connect.automaticBody" : "schedule.connect.automaticUnavailable")}</Text></View><Switch accessibilityLabel={t("schedule.connect.automatic")} disabled={Boolean(busy) || !automaticAvailable} onValueChange={(enabled) => { void toggleAutomatic(enabled); }} value={connection.automaticSyncEnabled} /></Card>
      <TouchableOpacity accessibilityRole="button" disabled={Boolean(busy)} onPress={() => setReplacing(true)} style={styles.outline}><Text style={styles.outlineText}>{t("schedule.connect.replace")}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={Boolean(busy)} onPress={() => disconnect(false)} style={styles.outline}><Unlink color={Colors.primary} size={18} /><Text style={styles.outlineText}>{t("schedule.connect.disconnectKeep")}</Text></TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" disabled={Boolean(busy)} onPress={() => disconnect(true)} style={styles.danger}><Text style={styles.dangerText}>{t("schedule.connect.disconnectRemove")}</Text></TouchableOpacity>
    </> : null}
  </ScrollView></ScreenWrapper>;
}

function ConnectionCard({ connection, locale, t }: { connection: TeamCalendarConnection; locale: string; t: ReturnType<typeof useTranslation>["t"] }) {
  const date = (value: number | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : t("schedule.connect.never");
  return <Card style={styles.form}><Text style={styles.cardTitle}>{connection.hostname}</Text><Text style={styles.status}>{t(`schedule.connect.status.${connection.status}`)}</Text><Text style={styles.body}>{t("schedule.connect.lastSuccess", { date: date(connection.lastSuccessfulSyncAt) })}</Text><Text style={styles.body}>{t("schedule.connect.lastAttempt", { date: date(connection.lastAttemptedSyncAt) })}</Text><Text style={styles.body}>{t("schedule.connect.nextSync", { date: date(connection.nextSyncAt) })}</Text>{connection.summary ? <Text style={styles.summary}>{t("schedule.connect.summary", connection.summary)}</Text> : null}</Card>;
}
function messageFor(error: unknown, t: ReturnType<typeof useTranslation>["t"]) { return t(`schedule.connect.errors.${calendarIntegrationErrorReason(error)}`, { defaultValue: t("schedule.connect.errors.unexpected") }); }
function normalizeParam(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
const styles = StyleSheet.create({ content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl }, header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm }, back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 }, title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 }, warning: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm }, copy: { flex: 1, gap: 4, minWidth: 0 }, cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 }, error: { backgroundColor: "#F6DDDA", borderRadius: Radius.sm, color: Colors.primary, fontFamily: Typography.bodySemiBold, padding: Spacing.sm }, form: { gap: Spacing.sm }, label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 }, input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, minHeight: 50, paddingHorizontal: Spacing.md }, primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 50, paddingHorizontal: Spacing.md }, primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold }, sectionTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 22 }, event: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm }, eventTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 }, meta: { color: Colors.communicationLink, fontFamily: Typography.bodyMedium, fontSize: 12 }, toggle: { alignItems: "center", flexDirection: "row", gap: Spacing.md }, outline: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 48 }, outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold }, danger: { alignItems: "center", minHeight: 44, justifyContent: "center" }, dangerText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textDecorationLine: "underline" }, status: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 12, textTransform: "uppercase" }, summary: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 12, lineHeight: 18 } });
