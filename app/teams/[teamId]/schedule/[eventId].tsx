import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  findNodeHandle,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, CalendarPlus, Clock3, MapPin, Pencil, Trash2, type LucideIcon } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { acknowledgeNotificationAfterOpen } from "@/services/notificationService";
import { addTeamEventToPersonalCalendar, openCalendarSettings } from "@/services/teamScheduleCalendarService";
import {
  deleteTeamScheduleEvent,
  getTeamScheduleAccess,
  getTeamScheduleEvent,
  type TeamScheduleAccess,
  type TeamScheduleEvent,
} from "@/services/teamScheduleService";
import {
  isTeamScheduleCalendarErrorCode,
  shouldOfferCalendarSettings,
  type TeamScheduleCalendarErrorCode,
} from "@/utils/teamScheduleCalendarCore";

export default function TeamScheduleEventDetailScreen() {
  const { i18n, t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[]; eventId?: string | string[]; notificationId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const eventId = normalizeParam(params.eventId);
  const notificationId = normalizeParam(params.notificationId);
  const acknowledged = useRef(false);
  const calendarActionRef = useRef<React.ElementRef<typeof TouchableOpacity>>(null);
  const calendarBusyRef = useRef(false);
  const [access, setAccess] = useState<TeamScheduleAccess | null>(null);
  const [event, setEvent] = useState<TeamScheduleEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"calendar" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextAccess, nextEvent] = await Promise.all([
        getTeamScheduleAccess(teamId),
        getTeamScheduleEvent(teamId, eventId),
      ]);
      if (!nextEvent) throw new Error("not-found");
      setAccess(nextAccess);
      setEvent(nextEvent);
      if (notificationId && !acknowledged.current) {
        acknowledged.current = true;
        void acknowledgeNotificationAfterOpen(notificationId);
      }
    } catch {
      setAccess(null);
      setEvent(null);
      setError(t("schedule.errors.eventUnavailable"));
    } finally {
      setLoading(false);
    }
  }, [eventId, notificationId, t, teamId]);

  useEffect(() => { void load(); }, [load]);

  const addToCalendar = useCallback(async () => {
    if (!event || busy || calendarBusyRef.current) return;
    calendarBusyRef.current = true;
    setBusy("calendar");
    AccessibilityInfo.announceForAccessibility(t("schedule.calendar.opening"));
    try {
      const result = await addTeamEventToPersonalCalendar(event, t("schedule.calendar.cancelledTitlePrefix"));
      if (result === "saved") {
        AccessibilityInfo.announceForAccessibility(t("schedule.calendar.savedTitle"));
        Alert.alert(t("schedule.calendar.savedTitle"), t("schedule.calendar.savedBody"));
      }
    } catch (nextError) {
      const code = errorCode(nextError);
      if (shouldOfferCalendarSettings(code)) {
        Alert.alert(t("schedule.calendar.permissionTitle"), t("schedule.calendar.permissionPermanent"), [
          { text: t("common.cancel"), style: "cancel" },
          { text: t("schedule.calendar.openSettings"), onPress: () => { void openCalendarSettings(); } },
        ]);
      } else {
        Alert.alert(t("schedule.calendar.errorTitle"), t(`schedule.calendar.${code}`));
      }
    } finally {
      calendarBusyRef.current = false;
      setBusy(null);
      setTimeout(() => {
        const node = findNodeHandle(calendarActionRef.current);
        if (node) AccessibilityInfo.setAccessibilityFocus(node);
      }, 100);
    }
  }, [busy, event, t]);

  const openMap = useCallback(async () => {
    if (!event?.address) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.address)}`;
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t("schedule.map.errorTitle"), t("schedule.map.errorBody"));
    }
  }, [event?.address, t]);

  const remove = useCallback(async () => {
    if (!event || busy) return;
    setBusy("delete");
    try {
      await deleteTeamScheduleEvent(teamId, event.id);
      router.replace({ pathname: "/teams/[teamId]/schedule", params: { teamId } } as never);
    } catch {
      Alert.alert(t("schedule.delete.errorTitle"), t("schedule.delete.errorBody"));
      setBusy(null);
    }
  }, [busy, event, t, teamId]);

  const confirmDelete = useCallback(() => {
    if (!event || busy) return;
    Alert.alert(t("schedule.delete.title"), t("schedule.delete.body", { title: event.title }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("schedule.delete.confirm"), style: "destructive", onPress: () => { void remove(); } },
    ]);
  }, [busy, event, remove, t]);

  const canManage = access?.canManage === true && access.teamStatus === "active";
  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <Text accessibilityRole="header" style={styles.title}>{t("schedule.eventDetails")}</Text>
        </View>

        {loading ? <Card style={styles.stateCard}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("schedule.loading")}</Text></Card> : null}
        {!loading && error ? <Card style={styles.stateCard}><Text style={styles.cardTitle}>{t("schedule.unavailable")}</Text><Text style={styles.body}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={load} style={styles.outlineButton}><Text style={styles.outlineText}>{t("common.retry")}</Text></TouchableOpacity></Card> : null}

        {event ? (
          <>
            <Card style={styles.heroCard}>
              <View style={styles.statusRow}>
                <Text style={styles.type}>{t(`schedule.types.${event.type}`)}</Text>
                <Text style={styles.status}>{t(`schedule.statuses.${event.status}`)}</Text>
              </View>
              <Text style={styles.eventTitle}>{event.title}</Text>
              {event.teamScore !== null && event.opponentScore !== null ? <Text style={styles.score}>{t("schedule.scoreLine", { team: event.teamScore, opponent: event.opponentScore })}</Text> : null}
            </Card>

            <Card style={styles.detailCard}>
              <Detail icon={<Clock3 color={Colors.communicationLink} size={19} />} label={t("schedule.form.date")} value={formatEventDate(event, i18n.language, t("schedule.allDay"))} />
              <Detail label={t("schedule.form.timezone")} value={event.timezone} />
              {event.arrivalAt ? <Detail label={t("schedule.form.arrivalTime")} value={formatTime(event.arrivalAt, event, i18n.language)} /> : null}
              {event.type === "game" && event.opponentName ? <Detail label={t("schedule.form.opponent")} value={event.opponentName} /> : null}
              {event.type === "game" && event.homeAway ? <Detail label={t("schedule.form.homeAway")} value={t(`schedule.homeAway.${event.homeAway}`)} /> : null}
              {event.venueName ? <Detail label={t("schedule.form.venue")} value={event.venueName} /> : null}
              {event.field ? <Detail label={t("schedule.form.field")} value={event.field} /> : null}
              {event.address ? <Detail icon={<MapPin color={Colors.communicationLink} size={19} />} label={t("schedule.form.address")} value={event.address} /> : null}
              {event.notes ? <Detail label={t("schedule.form.notes")} value={event.notes} /> : null}
            </Card>

            <View style={styles.actions}>
              {event.address ? <Action label={t("schedule.map.open")} Icon={MapPin} onPress={() => { void openMap(); }} /> : null}
              <Action
                accessibilityHint={t("schedule.calendar.addHint")}
                buttonRef={calendarActionRef}
                busy={busy === "calendar"}
                disabled={Boolean(busy)}
                label={t("schedule.calendar.add")}
                Icon={CalendarPlus}
                onPress={() => { void addToCalendar(); }}
              />
              {canManage ? <Action label={t("schedule.editEvent")} Icon={Pencil} onPress={() => router.push({ pathname: "/teams/[teamId]/schedule/edit", params: { teamId, eventId: event.id } } as never)} /> : null}
            </View>

            {canManage ? (
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: busy === "delete", disabled: Boolean(busy) }} disabled={Boolean(busy)} onPress={confirmDelete} style={styles.deleteButton}>
                {busy === "delete" ? <ActivityIndicator color={Colors.primary} /> : <Trash2 color={Colors.primary} size={18} />}
                <Text style={styles.deleteText}>{t("schedule.delete.action")}</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function Detail({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
  return <View style={styles.detailRow}>{icon}<View style={styles.detailCopy}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value}</Text></View></View>;
}

function Action({ accessibilityHint, buttonRef, busy, disabled, Icon, label, onPress }: {
  accessibilityHint?: string;
  buttonRef?: React.Ref<React.ElementRef<typeof TouchableOpacity>>;
  busy?: boolean;
  disabled?: boolean;
  Icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return <TouchableOpacity ref={buttonRef} accessibilityHint={accessibilityHint} accessibilityLabel={label} accessibilityRole="button" accessibilityState={{ busy, disabled: disabled || busy }} disabled={disabled || busy} onPress={onPress} style={styles.action}>{busy ? <ActivityIndicator color={Colors.communicationLink} /> : <Icon color={Colors.communicationLink} size={20} />}<Text style={styles.actionText}>{label}</Text></TouchableOpacity>;
}

function formatEventDate(event: TeamScheduleEvent, locale: string, allDayLabel: string) {
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: event.timezone }).format(event.startAt);
  if (event.isAllDay) return `${date} | ${allDayLabel}`;
  return `${date} | ${formatTime(event.startAt, event, locale)} - ${formatTime(event.endAt, event, locale)}`;
}

function formatTime(date: Date, event: TeamScheduleEvent, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit", timeZone: event.timezone }).format(date);
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function errorCode(error: unknown): TeamScheduleCalendarErrorCode {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : null;
  return isTeamScheduleCalendarErrorCode(code) ? code : "calendar_unexpected";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  iconButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, textAlign: "center" },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21, textAlign: "center" },
  outlineButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, minHeight: 42, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  heroCard: { borderLeftColor: Colors.accentGreen, borderLeftWidth: 4, gap: Spacing.sm },
  statusRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "space-between" },
  type: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  status: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 11 },
  eventTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 26, lineHeight: 32 },
  score: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  detailCard: { gap: Spacing.md },
  detailRow: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm },
  detailCopy: { flex: 1, gap: 2 },
  detailLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 10, textTransform: "uppercase" },
  detailValue: { color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  action: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.communicationLink, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, minHeight: 46, paddingHorizontal: Spacing.md },
  actionText: { color: Colors.communicationLink, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  deleteButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 46 },
  deleteText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
});
