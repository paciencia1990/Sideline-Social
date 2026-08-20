import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { CalendarDays, MapPin } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import type { TeamScheduleEvent } from "@/services/teamScheduleService";

export function TeamScheduleEventCard({ event, locale, onPress }: {
  event: TeamScheduleEvent;
  locale: string;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const location = [event.venueName, event.field].filter(Boolean).join(" - ");
  const score = event.type === "game" && event.teamScore !== null && event.opponentScore !== null
    ? t("schedule.scoreLine", { team: event.teamScore, opponent: event.opponentScore })
    : null;
  return (
    <TouchableOpacity
      accessibilityLabel={t("schedule.openEventAccessibility", { title: event.title })}
      accessibilityRole="button"
      activeOpacity={0.84}
      onPress={onPress}
    >
      <Card style={[styles.card, event.status === "cancelled" && styles.cancelledCard]}>
        <View style={styles.topRow}>
          <View style={[styles.typeIcon, typeBackground(event.type)]}>
            <CalendarDays color={Colors.textHeading} size={19} />
          </View>
          <View style={styles.copy}>
            <Text style={styles.type}>{t(`schedule.types.${event.type}`)}</Text>
            <Text style={[styles.title, event.status === "cancelled" && styles.cancelledText]}>{event.title}</Text>
          </View>
          <View style={[styles.status, statusBackground(event.status)]}>
            <Text style={styles.statusText}>{t(`schedule.statuses.${event.status}`)}</Text>
          </View>
        </View>
        <Text style={styles.time}>{formatEventTime(event, locale, t)}</Text>
        {event.source === "ics-feed" ? <Text accessibilityLabel={t("schedule.syncedIndicator")} style={styles.synced}>{t("schedule.syncedIndicator")}</Text> : null}
        {event.opponentName ? (
          <Text style={styles.detail}>
            {t(`schedule.homeAway.${event.homeAway ?? "neutral"}`)} | {event.opponentName}
          </Text>
        ) : null}
        {location ? (
          <View style={styles.locationRow}>
            <MapPin color={Colors.communicationLink} size={16} />
            <Text style={styles.location}>{location}</Text>
          </View>
        ) : null}
        {score ? <Text style={styles.score}>{score}</Text> : null}
      </Card>
    </TouchableOpacity>
  );
}

function formatEventTime(
  event: TeamScheduleEvent,
  locale: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (event.isAllDay) return t("schedule.allDay");
  const formatter = new Intl.DateTimeFormat(locale, {
    timeZone: event.timezone,
    hour: "numeric",
    minute: "2-digit",
  });
  return t("schedule.timeRange", {
    start: formatter.format(event.startAt),
    end: formatter.format(event.endAt),
    timezone: shortTimeZone(event.startAt, event.timezone, locale),
  });
}

function shortTimeZone(date: Date, timezone: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, timeZoneName: "short" })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value ?? timezone;
}

function typeBackground(type: TeamScheduleEvent["type"]) {
  if (type === "game") return { backgroundColor: "#F6DDDA" };
  if (type === "practice") return { backgroundColor: "#E5EEE7" };
  return { backgroundColor: "#F8EACF" };
}

function statusBackground(status: TeamScheduleEvent["status"]) {
  if (status === "cancelled") return { backgroundColor: "#F6DDDA" };
  if (status === "postponed") return { backgroundColor: "#F8EACF" };
  if (status === "completed") return { backgroundColor: "#E5EEE7" };
  return { backgroundColor: "#E8EDF1" };
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  cancelledCard: { opacity: 0.78 },
  topRow: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm },
  typeIcon: { alignItems: "center", borderRadius: Radius.sm, height: 38, justifyContent: "center", width: 38 },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  type: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 10, textTransform: "uppercase" },
  title: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, lineHeight: 22 },
  cancelledText: { textDecorationLine: "line-through" },
  status: { borderRadius: Radius.sm, maxWidth: "34%", paddingHorizontal: Spacing.sm, paddingVertical: 5 },
  statusText: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 10, textAlign: "center" },
  time: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13 },
  detail: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  locationRow: { alignItems: "center", flexDirection: "row", gap: Spacing.xs },
  location: { color: Colors.communicationLink, flex: 1, fontFamily: Typography.bodyMedium, fontSize: 13 },
  score: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 14 },
  synced: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 10, textTransform: "uppercase" },
});
