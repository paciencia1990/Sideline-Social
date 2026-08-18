import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { TeamScheduleEventForm, type TeamScheduleFormOptions } from "@/components/TeamScheduleEventForm";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getTeamScheduleAccess,
  getTeamScheduleEvent,
  saveTeamScheduleEvent,
  scheduleDraftFromEvent,
  type TeamScheduleEvent,
} from "@/services/teamScheduleService";
import { createDefaultScheduleDraft, type TeamScheduleDraft } from "@/utils/teamScheduleCore";

export default function TeamScheduleEditScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[]; eventId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const eventId = normalizeParam(params.eventId);
  const isEditing = Boolean(eventId);
  const [event, setEvent] = useState<TeamScheduleEvent | null>(null);
  const [draft, setDraft] = useState<TeamScheduleDraft | null>(isEditing ? null : createDefaultScheduleDraft());
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const access = await getTeamScheduleAccess(teamId);
      if (!access.canManage) throw new Error("permission-denied");
      if (access.teamStatus === "archived") throw new Error("team-archived");
      if (eventId) {
        const nextEvent = await getTeamScheduleEvent(teamId, eventId);
        if (!nextEvent) throw new Error("event-not-found");
        setEvent(nextEvent);
        setDraft(scheduleDraftFromEvent(nextEvent));
      } else {
        setDraft(createDefaultScheduleDraft());
      }
    } catch (nextError) {
      const code = nextError instanceof Error ? nextError.message : "unknown";
      setError(t(code === "team-archived" ? "schedule.errors.archivedWrite" : "schedule.errors.editUnauthorized"));
    } finally {
      setLoading(false);
    }
  }, [eventId, t, teamId]);

  useEffect(() => { void load(); }, [load]);

  const submit = useCallback(async (nextDraft: TeamScheduleDraft, options: TeamScheduleFormOptions) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await saveTeamScheduleEvent({
        teamId,
        eventId: eventId || undefined,
        draft: nextDraft,
        notifyTeam: options.notifyTeam,
        recurrence: options.recurrence,
        editScope: options.editScope,
      });
      const destinationId = eventId || result.eventIds[0];
      router.replace(destinationId
        ? { pathname: "/teams/[teamId]/schedule/[eventId]", params: { teamId, eventId: destinationId } } as never
        : { pathname: "/teams/[teamId]/schedule", params: { teamId } } as never);
    } catch (nextError) {
      const reason = getFunctionReason(nextError);
      setError(t(reason === "team_archived" ? "schedule.errors.archivedWrite" : "schedule.errors.save"));
      setSubmitting(false);
    }
  }, [eventId, submitting, t, teamId]);

  return (
    <ScreenWrapper>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <Text accessibilityRole="header" style={styles.title}>{t(isEditing ? "schedule.form.editTitle" : "schedule.form.newTitle")}</Text>
        </View>

        {loading ? <Card style={styles.stateCard}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("schedule.loading")}</Text></Card> : null}
        {!loading && error && !draft ? <Card style={styles.stateCard}><Text style={styles.body}>{error}</Text><TouchableOpacity accessibilityRole="button" onPress={load} style={styles.retryButton}><Text style={styles.retryText}>{t("common.retry")}</Text></TouchableOpacity></Card> : null}
        {error && draft ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
        {draft ? (
          <TeamScheduleEventForm
            initialDraft={draft}
            isEditing={isEditing}
            isRecurring={Boolean(event?.recurrenceGroupId)}
            submitting={submitting}
            onSubmit={submit}
          />
        ) : null}
      </View>
    </ScreenWrapper>
  );
}

function getFunctionReason(error: unknown) {
  if (!error || typeof error !== "object") return "unknown";
  if ("details" in error && error.details && typeof error.details === "object" && "reason" in error.details) return String(error.details.reason);
  return "unknown";
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  screen: { flex: 1, gap: Spacing.md, paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  iconButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  error: { backgroundColor: "#F6DDDA", borderRadius: Radius.sm, color: Colors.primary, fontFamily: Typography.bodySemiBold, padding: Spacing.sm, textAlign: "center" },
  retryButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, minHeight: 42, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
});
