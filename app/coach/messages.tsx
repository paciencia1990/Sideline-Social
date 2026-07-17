import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as FileSystem from "expo-file-system";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { VoiceMemoComposer } from "@/components/VoiceMemoComposer";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useCoachBackNavigation } from "@/hooks/useCoachBackNavigation";
import { createTeamAnnouncement, listenToTeamAnnouncements, type AnnouncementAudience, type TeamAnnouncement } from "@/services/teamMessageService";
import { finalizeVoiceAnnouncement, reserveVoiceUpload, uploadReservedVoiceMemo } from "@/services/teamPrivateMessageService";
import { getCurrentUserTeamMemberships, hasCoachAccess, isTeamActive, type TeamMembership } from "@/services/teamService";
import type { LocalVoiceMemoDraft } from "@/types/teamVoiceMessaging";

const AUDIENCES: AnnouncementAudience[] = ["all", "parents", "staff"];

export default function CoachMessagesScreen() {
  const { t } = useTranslation();
  const navigateBack = useCoachBackNavigation();
  const params = useLocalSearchParams<{
    teamId?: string | string[];
    draftBody?: string | string[];
    draftTitle?: string | string[];
  }>();
  const requestedTeamId = normalizeParam(params.teamId);
  const draftBody = normalizeParam(params.draftBody);
  const draftTitle = normalizeParam(params.draftTitle);
  const hasDraft = Boolean(draftBody || draftTitle);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [announcements, setAnnouncements] = useState<TeamAnnouncement[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState(requestedTeamId);
  const [title, setTitle] = useState(draftTitle);
  const [body, setBody] = useState(draftBody);
  const [messageType, setMessageType] = useState<"text" | "voice">("text");
  const [voiceDraft, setVoiceDraft] = useState<LocalVoiceMemoDraft | null>(null);
  const [voiceComposerKey, setVoiceComposerKey] = useState(0);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [sendPhase, setSendPhase] = useState<"uploading" | "finalizing" | null>(null);
  const [cancelUpload, setCancelUpload] = useState<(() => boolean) | null>(null);
  const [audience, setAudience] = useState<AnnouncementAudience>("all");
  const [allowReplies, setAllowReplies] = useState(true);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submissionInFlight = useRef(false);

  useEffect(() => {
    let isMounted = true;
    async function loadMemberships() {
      setLoading(true);
      setError(null);
      try {
        const nextMemberships = await getCurrentUserTeamMemberships();
        if (isMounted) setMemberships(nextMemberships.filter((membership) =>
          hasCoachAccess(membership) && isTeamActive(membership.team),
        ));
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

  useEffect(() => {
    if (memberships.length === 0) return;
    if (memberships.some((membership) => membership.teamId === selectedTeamId)) return;
    if (!hasDraft || memberships.length === 1) setSelectedTeamId(memberships[0].teamId);
    else setSelectedTeamId("");
  }, [hasDraft, memberships, selectedTeamId]);

  const selectedMembership = useMemo(
    () => memberships.find((membership) => membership.teamId === selectedTeamId) ?? null,
    [memberships, selectedTeamId],
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

  const performCreate = useCallback(async () => {
    if (!selectedTeam || submissionInFlight.current) return;
    submissionInFlight.current = true;
    setSending(true);
    setError(null);
    try {
      if (messageType === "voice") {
        if (!voiceDraft?.previewed) {
          setError(t("voiceMemo.previewRequired"));
          return;
        }
        setUploadProgress(0);
        setSendPhase("uploading");
        const reservation = await reserveVoiceUpload({
          teamId: selectedTeam.id,
          kind: "announcement",
          title,
          summary: body,
          audience,
          allowReplies,
          voiceMemo: voiceDraft,
        });
        const upload = await uploadReservedVoiceMemo(reservation, voiceDraft, setUploadProgress);
        setCancelUpload(() => () => upload.task.cancel());
        await upload.completion;
        setSendPhase("finalizing");
        await finalizeVoiceAnnouncement(reservation.reservationId);
        await FileSystem.deleteAsync(voiceDraft.uri, { idempotent: true });
        setVoiceDraft(null);
        setVoiceComposerKey((value) => value + 1);
      } else {
        await createTeamAnnouncement(selectedTeam.id, { title, body, audience, allowReplies });
      }
      setTitle("");
      setBody("");
      setAudience("all");
      setAllowReplies(true);
    } catch (nextError) {
      console.warn("[CoachMessages] create error:", nextError);
      setError(t("coach.messages.error"));
    } finally {
      setCancelUpload(null);
      setUploadProgress(null);
      setSendPhase(null);
      setSending(false);
      submissionInFlight.current = false;
    }
  }, [allowReplies, audience, body, messageType, selectedTeam, t, title, voiceDraft]);

  const handleCreate = useCallback(() => {
    if (!selectedTeam || !title.trim() || !body.trim() || (messageType === "voice" && !voiceDraft)) {
      setError(t("coach.messages.required"));
      return;
    }
    if (messageType === "voice") {
      if (!voiceDraft?.previewed) {
        setError(t("voiceMemo.previewRequired"));
        return;
      }
      Alert.alert(t("coach.messages.confirmVoiceTitle"), t("coach.messages.confirmVoiceBody"), [
        { text: t("common.cancel"), style: "cancel" },
        { text: t("coach.messages.send"), onPress: () => { void performCreate(); } },
      ]);
      return;
    }
    void performCreate();
  }, [body, messageType, performCreate, selectedTeam, t, title, voiceDraft]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader
          accessibilityLabel={t("coach.messages.backAccessibility")}
          onBack={navigateBack}
          subtitle={selectedTeam?.name ?? t("coach.messages.subtitle")}
          title={t("coach.home.sendMessage")}
        />

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

        {!selectedTeam && !loading && memberships.length === 0 ? (
          <Card style={styles.centerCard}>
            <Text style={styles.cardTitle}>{t("coach.messages.noTeamTitle")}</Text>
            <Text style={styles.cardText}>{t("coach.messages.noTeamBody")}</Text>
            <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/coach/team" as never)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>{t("coach.team.createTeam")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {!selectedTeam && !loading && memberships.length > 1 ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.resources.chooseTeam")}</Text>
            <Text style={styles.cardText}>{t("coach.resources.selectTeamBeforeComposer")}</Text>
            {memberships.map((membership) => (
              <TouchableOpacity
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedTeamId === membership.teamId }}
                key={membership.teamId}
                onPress={() => setSelectedTeamId(membership.teamId)}
                style={[styles.teamOption, selectedTeamId === membership.teamId && styles.teamOptionSelected]}
              >
                <Text style={styles.teamOptionText}>{membership.team?.name}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        ) : null}

        {selectedTeam && canCreate ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{t("coach.messages.create")}</Text>
            <Text style={styles.inputLabel}>{t("coach.messages.messageType")}</Text>
            <View accessibilityRole="tablist" style={styles.segmentRow}>
              {(["text", "voice"] as const).map((nextType) => (
                <TouchableOpacity accessibilityRole="tab" accessibilityState={{ selected: messageType === nextType }} key={nextType} onPress={() => setMessageType(nextType)} style={[styles.segment, messageType === nextType && styles.segmentActive]}>
                  <Text style={[styles.segmentText, messageType === nextType && styles.segmentTextActive]}>{t(`coach.messages.type${capitalize(nextType)}`)}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput onChangeText={setTitle} placeholder={t("coach.messages.titlePlaceholder")} placeholderTextColor={Colors.textPrimary} style={styles.input} value={title} />
            <View style={messageType === "voice" ? undefined : styles.hidden}>
              <VoiceMemoComposer active={messageType === "voice"} disabled={sending} key={voiceComposerKey} onChange={setVoiceDraft} uploadProgress={uploadProgress} />
            </View>
            {sendPhase === "finalizing" ? <Text accessibilityLiveRegion="polite" style={styles.progressText}>{t("voiceMemo.finalizing")}</Text> : null}
            <TextInput multiline maxLength={2000} onChangeText={setBody} placeholder={t(messageType === "voice" ? "coach.messages.summaryPlaceholder" : "coach.messages.bodyPlaceholder")} placeholderTextColor={Colors.textPrimary} style={[styles.input, styles.bodyInput]} value={body} />
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
            {cancelUpload ? <TouchableOpacity accessibilityRole="button" onPress={() => cancelUpload()}><Text style={styles.cancelUpload}>{t("voiceMemo.cancelUpload")}</Text></TouchableOpacity> : null}
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
                {announcement.contentType === "voice" ? <Text style={styles.voiceLabel}>{t("teamMessages.voicePreview")}</Text> : null}
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
  teamOption: { borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  teamOptionSelected: { backgroundColor: Colors.background, borderColor: Colors.primary },
  teamOptionText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  voiceLabel: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12, textTransform: "uppercase" },
  cancelUpload: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  hidden: { display: "none" },
  progressText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
});
