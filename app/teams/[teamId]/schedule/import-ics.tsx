import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Check, FileUp, Square } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { calendarIntegrationErrorReason, importScheduleIcs, previewScheduleIcs, type TeamCalendarPreviewEvent } from "@/services/teamCalendarIntegrationService";

const MAX_ICS_BYTES = 512 * 1024;
type Picker = { getDocumentAsync: (options: Record<string, unknown>) => Promise<{ canceled: boolean; assets?: { name: string; uri: string; size?: number; mimeType?: string }[] }> };
type Preview = TeamCalendarPreviewEvent & { selected: boolean };

export default function ImportTeamScheduleIcsScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [busy, setBusy] = useState<"pick" | "import" | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [events, setEvents] = useState<Preview[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const selected = useMemo(() => events.filter((event) => event.selected), [events]);

  const pick = useCallback(async () => {
    if (busy) return;
    setBusy("pick"); setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const picker = require("expo-document-picker") as Picker;
      const result = await picker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) throw new Error("ics_file_unavailable");
      const mime = asset.mimeType?.split(";")[0]?.toLowerCase() ?? "";
      if (!/\.ics$/iu.test(asset.name) || (mime && !["text/calendar", "application/ics", "application/octet-stream", "text/plain"].includes(mime))) throw new Error("ics_unsupported_file");
      if (typeof asset.size === "number" && asset.size > MAX_ICS_BYTES) throw new Error("ics_file_too_large");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { File } = require("expo-file-system") as { File: new (uri: string) => { text: () => Promise<string> } };
      const text = await new File(asset.uri).text();
      if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) throw new Error("ics_file_too_large");
      const preview = await previewScheduleIcs(teamId, text);
      setPreviewId(preview.previewId ?? null); setFileName(asset.name); setEvents(preview.events.map((event) => ({ ...event, selected: true })));
      if (preview.rejectedCount > 0) setError(t("schedule.ics.partial", { count: preview.rejectedCount }));
    } catch (nextError) {
      const reason = nextError instanceof Error && /^ics_/u.test(nextError.message) ? nextError.message : calendarIntegrationErrorReason(nextError);
      setError(t(`schedule.ics.errors.${reason}`, { defaultValue: t("schedule.ics.errors.unexpected") }));
    } finally { setBusy(null); }
  }, [busy, t, teamId]);

  const runImport = useCallback(async () => {
    if (!previewId || selected.length === 0 || busy) return;
    setBusy("import"); setError(null);
    try {
      const summary = await importScheduleIcs(teamId, previewId, selected.map((event) => event.key), notifyTeam);
      Alert.alert(t("schedule.ics.successTitle"), t("schedule.ics.successBody", summary), [{ text: t("common.ok"), onPress: () => router.replace({ pathname: "/teams/[teamId]/schedule", params: { teamId } } as never) }]);
    } catch (nextError) { setError(t(`schedule.ics.errors.${calendarIntegrationErrorReason(nextError)}`, { defaultValue: t("schedule.ics.errors.unexpected") })); setBusy(null); }
  }, [busy, notifyTeam, previewId, selected, t, teamId]);

  return <ScreenWrapper><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.back}><ArrowLeft color={Colors.textHeading} size={22} /></TouchableOpacity><Text accessibilityRole="header" style={styles.title}>{t("schedule.ics.title")}</Text></View>
    <Text style={styles.body}>{t("schedule.ics.body")}</Text>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: busy === "pick", disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={() => { void pick(); }} style={styles.primary}>{busy === "pick" ? <ActivityIndicator color={Colors.surface} /> : <FileUp color={Colors.surface} size={19} />}<Text style={styles.primaryText}>{t("schedule.ics.choose")}</Text></TouchableOpacity>
    {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
    {fileName ? <Text style={styles.fileName}>{fileName}</Text> : null}
    {events.map((event) => <TouchableOpacity accessibilityLabel={event.title} accessibilityRole="checkbox" accessibilityState={{ checked: event.selected }} key={event.key} onPress={() => setEvents((current) => current.map((item) => item.key === event.key ? { ...item, selected: !item.selected } : item))}><Card style={styles.row}>{event.selected ? <Check color={Colors.communicationLink} size={21} /> : <Square color={Colors.textPrimary} size={21} />}<View style={styles.copy}><Text style={styles.rowTitle}>{event.title}</Text><Text style={styles.meta}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: event.isAllDay ? undefined : "short", timeZone: event.timezone }).format(new Date(event.startAtMillis))}</Text><Text style={styles.meta}>{t(`schedule.statuses.${event.status}`)}</Text></View></Card></TouchableOpacity>)}
    {events.length > 0 ? <Card style={styles.row}><View style={styles.copy}><Text style={styles.rowTitle}>{t("schedule.form.notifyTeam")}</Text><Text style={styles.meta}>{t("schedule.import.notifyHelp")}</Text></View><Switch accessibilityLabel={t("schedule.form.notifyTeam")} onValueChange={setNotifyTeam} value={notifyTeam} /></Card> : null}
    {events.length > 0 ? <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: busy === "import", disabled: Boolean(busy) || selected.length === 0 }} disabled={Boolean(busy) || selected.length === 0} onPress={() => { void runImport(); }} style={[styles.primary, selected.length === 0 && styles.disabled]}>{busy === "import" ? <ActivityIndicator color={Colors.surface} /> : null}<Text style={styles.primaryText}>{t("schedule.ics.importSelected", { count: selected.length })}</Text></TouchableOpacity> : null}
  </ScrollView></ScreenWrapper>;
}
function normalizeParam(value?: string | string[]) { return Array.isArray(value) ? value[0] ?? "" : value ?? ""; }
const styles = StyleSheet.create({ content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl }, header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm }, back: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 }, title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 }, body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 }, primary: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 50, paddingHorizontal: Spacing.md }, primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold }, disabled: { opacity: 0.5 }, error: { backgroundColor: "#F6DDDA", borderRadius: Radius.sm, color: Colors.primary, fontFamily: Typography.bodySemiBold, padding: Spacing.sm }, fileName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 }, row: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm }, copy: { flex: 1, gap: 3 }, rowTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 }, meta: { color: Colors.communicationLink, fontFamily: Typography.bodyMedium, fontSize: 12 } });
