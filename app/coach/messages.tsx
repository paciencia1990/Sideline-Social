import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { createTeamAnnouncement, listenToTeamAnnouncements, type AnnouncementAudience, type TeamAnnouncement } from "@/services/teamMessageService";
import { getCurrentUserTeamMemberships, hasCoachAccess, type TeamMembership } from "@/services/teamService";

const AUDIENCES: AnnouncementAudience[] = ["parents", "staff", "all"];

export default function CoachMessagesScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const requestedTeamId = normalizeParam(params.teamId);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AnnouncementAudience>("parents");
  const [allowReplies, setAllowReplies] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadMemberships() {
      setLoading(true);
      setError(null);
      try {
        const nextMemberships = await getCurrentUserTeamMemberships();
        if (isMounted) setMemberships(nextMemberships);
      } catch (nextError) {
        console.warn("[CoachMessages] memberships error:", nextError);
        if (isMounted) setError(t("coach.messages.error"));
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    void loadMemberships();
    return () => {
      isMounted = false;
    };
  }, [t]);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.teamId === requestedTeamId) ?? memberships[0] ?? null,
    [memberships, requestedTeamId],
  );
  const selectedTeam = selectedMembership?.team ?? null;
  const canCreate = hasCoachAccess(selectedMembership);

  useEffect(() => {
    if (!selectedTeam) {
      setAnnouncements([]);
      return;
    }

    return listenToTeamAnnouncements(
      selectedTeam.id,
      setAnnouncements,
      () => setError(t("coach.messages.error")),
    );
  }, [selectedTeam, t]);

  const handleCreate = useCallback(async () => {
    if (!selectedTeam || !title.trim() || !body.trim()) {
      setError(t("coach.messages.required"));
      return;
    }

    setSending(true);
    setError(null);
    try {
      await createTeamAnnouncement(selectedTeam.id, {
        title,
        body,
        audience,
        allowReplies,
      });
      setTitle("");
      setBody("");
      setAudience("parents");
      setAllowReplies(true);
    } catch (nextError) {
      console.warn("[CoachMessages] create error:", nextError);
      setError(nextError instanceof Error ? nextError.message : t("coach.messages.error"));
    } finally {
      setSending(false);
    }
  }, [allowReplies, audience, body, selectedTeam, t, title]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("coach.messages.title")}</Text>
          <Text style={styles.subtitle}>{selectedTeam?.name ?? t("coach.messages.subtitle")}</Text>
        </View>

        {loading ? (
          <Card style={styles.centerCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("common.loading")}</Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </Card>
        ) : null}

        {!selectedTeam && !loading ? (
          <Card style={styles.centerCard}>
            <Text style={styles.cardTitle}>{t("coach.messages.noTeamTitle")}</Text>
            <Text style={styles.cardText}>{t("coach.messages.noTeamBody")}</Text>
            <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/coach/team" as never)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t("coach.team.createTeam")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {selectedTeam && canCreate ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.create")}</Text>
            <TextInput onChangeText={setTitle} placeholder={t("coach.messages.titlePlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={title} />
            <TextInput multiline onChangeText={setBody} placeholder={t("coach.messages.bodyPlaceholder")} placeholderTextColor={Colors.textPrimary} style={[styles.input, styles.bodyInput]} value={body} />
            <Text style={styles.inputLabel}>{t("coach.messages.audience")}</Text>
            <View style={styles.segmentRow}>
              {AUDIENCES.map((nextAudience) => (
                <TouchableOpacity key={nextAudience} activeOpacity={0.86} onPress={() => setAudience(nextAudience)} style={[styles.segment, audience === nextAudience && styles.segmentActive]}>
                  <Text style={[styles.segmentText, audience === nextAudience && styles.segmentTextActive]}>{t(`coach.messages.audience${capitalize(nextAudience)}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity activeOpacity={0.86} onPress={() => setAllowReplies((value) => !value)} style={styles.toggleRow}>
              <View style={[styles.checkbox, allowReplies && styles.checkboxActive]} />
              <Text style={styles.toggleText}>{t("coach.messages.allowReplies")}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.86} disabled={sending} onPress={handleCreate} style={[styles.primaryButton, sending && styles.disabledButton]}>
              {sending ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryButtonText}>{t("coach.messages.send")}</Text>}
            </TouchableOpacity>
          </Card>
        ) : null}

        {selectedTeam ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.threadList")}</Text>
            {announcements.length === 0 ? <Text style={styles.cardText}>{t("coach.messages.emptyBody")}</Text> : null}
            {announcements.map((announcement) => (
              <TouchableOpacity
                key={announcement.id}
                activeOpacity={0.86}
                onPress={() => router.push({ pathname: "/coach/messages/[announcementId]", params: { teamId: selectedTeam.id, announcementId: announcement.id } } as never)}
                style={styles.announcementRow}
              >
                <Text style={styles.announcementTitle}>{announcement.title}</Text>
                <Text style={styles.announcementBody} numberOfLines={2}>{announcement.body}</Text>
                <Text style={styles.announcementMeta}>{announcement.createdByName} • {t(`coach.messages.audience${capitalize(announcement.audience)}`)}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", gap: Spacing.xs },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 31, textAlign: "center" },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21, textAlign: "center" },
  cardGap: { gap: Spacing.md },
  centerCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  errorCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4 },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 46, paddingHorizontal: Spacing.md },
  bodyInput: { minHeight: 92, paddingTop: Spacing.md, textAlignVertical: "top" },
  inputLabel: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  segment: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexGrow: 1, minHeight: 40, justifyContent: "center", paddingHorizontal: Spacing.sm },
  segmentActive: { backgroundColor: Colors.primary },
  segmentText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  segmentTextActive: { color: Colors.surface },
  toggleRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  checkbox: { borderColor: Colors.primary, borderRadius: 5, borderWidth: 1, height: 22, width: 22 },
  checkboxActive: { backgroundColor: Colors.primary },
  toggleText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.55 },
  announcementRow: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, gap: 4, padding: Spacing.md },
  announcementTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 16 },
  announcementBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 19 },
  announcementMeta: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
});