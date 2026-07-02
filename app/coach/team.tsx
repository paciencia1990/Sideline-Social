import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import {
  createTeam,
  getCurrentUserTeamMemberships,
  getTeamMembers,
  isCoachRole,
  switchActiveTeam,
  type Team,
  type TeamMembership,
} from "@/services/teamService";

const EMPTY_TEAM = {
  name: "",
  sport: "",
  ageRange: "",
  division: "",
  season: "",
};

export default function CoachTeamScreen() {
  const { t } = useTranslation();
  const { setActiveMode } = useApp();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const requestedTeamId = normalizeParam(params.teamId);
  const [members, setMembers] = useState<TeamMembership[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [form, setForm] = useState(EMPTY_TEAM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextMemberships = await getCurrentUserTeamMemberships();
      const selectedMembership = nextMemberships.find((membership) => membership.teamId === requestedTeamId) ?? nextMemberships[0] ?? null;
      const nextTeam = selectedMembership?.team ?? null;
      setSelectedTeam(nextTeam);
      setMembers(nextTeam ? await getTeamMembers(nextTeam.id) : []);
    } catch (nextError) {
      console.warn("[CoachTeam] load error:", nextError);
      setError(t("coach.team.error"));
      setSelectedTeam(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [requestedTeamId, t]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const staffMembers = useMemo(() => members.filter((member) => isCoachRole(member.role)), [members]);
  const parentMembers = useMemo(() => members.filter((member) => member.role === "parent"), [members]);

  const handleCreate = useCallback(async () => {
    if (!form.name.trim() || !form.sport.trim()) {
      setError(t("coach.team.required"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const team = await createTeam(form);
      setActiveMode("coach");
      await switchActiveTeam(team.id).catch(() => undefined);
      setForm(EMPTY_TEAM);
      router.replace({ pathname: "/coach/team", params: { teamId: team.id } } as never);
    } catch (nextError) {
      console.warn("[CoachTeam] create error:", nextError);
      setError(nextError instanceof Error ? nextError.message : t("coach.team.error"));
    } finally {
      setSaving(false);
    }
  }, [form, setActiveMode, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>{t("coach.team.title")}</Text>
          <Text style={styles.subtitle}>{t("coach.team.subtitle")}</Text>
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

        {selectedTeam ? (
          <Card style={styles.cardGap}>
            <Text style={styles.cardTitle}>{selectedTeam.name}</Text>
            <Text style={styles.cardText}>{[selectedTeam.sport, selectedTeam.ageRange, selectedTeam.division, selectedTeam.season].filter(Boolean).join(" • ")}</Text>
            <View style={styles.invitePanel}>
              <Text style={styles.inviteLabel}>{t("coach.team.inviteCode")}</Text>
              <Text style={styles.inviteCode}>{selectedTeam.inviteCode}</Text>
            </View>
            <View style={styles.buttonRow}>
              <TouchableOpacity activeOpacity={0.86} onPress={() => router.push({ pathname: "/coach/messages", params: { teamId: selectedTeam.id } } as never)} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{t("coach.messages.title")}</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.86} onPress={() => router.push("/teams/join" as never)} style={styles.outlineButton}>
                <Text style={styles.outlineButtonText}>{t("coach.team.joinTeam")}</Text>
              </TouchableOpacity>
            </View>
          </Card>
        ) : null}

        {!selectedTeam && !loading ? (
          <Card style={styles.centerCard}>
            <Text style={styles.cardTitle}>{t("coach.team.emptyTitle")}</Text>
            <Text style={styles.cardText}>{t("coach.team.emptyBody")}</Text>
          </Card>
        ) : null}

        <Card style={styles.cardGap}>
          <Text style={styles.cardTitle}>{t("coach.team.createTeam")}</Text>
          <TeamInput label={t("coach.team.name")} value={form.name} onChangeText={(name) => setForm((current) => ({ ...current, name }))} />
          <TeamInput label={t("coach.team.sport")} value={form.sport} onChangeText={(sport) => setForm((current) => ({ ...current, sport }))} />
          <TeamInput label={t("coach.team.ageRange")} value={form.ageRange} onChangeText={(ageRange) => setForm((current) => ({ ...current, ageRange }))} />
          <TeamInput label={t("coach.team.division")} value={form.division} onChangeText={(division) => setForm((current) => ({ ...current, division }))} />
          <TeamInput label={t("coach.team.season")} value={form.season} onChangeText={(season) => setForm((current) => ({ ...current, season }))} />
          <TouchableOpacity activeOpacity={0.86} disabled={saving} onPress={handleCreate} style={[styles.primaryButton, saving && styles.disabledButton]}>
            {saving ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryButtonText}>{t("coach.team.createTeam")}</Text>}
          </TouchableOpacity>
        </Card>

        {selectedTeam ? (
          <>
            <MemberSection title={t("coach.team.staff")} members={staffMembers} />
            <MemberSection title={t("coach.team.parents")} members={parentMembers} />
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function TeamInput({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput autoCapitalize="words" onChangeText={onChangeText} placeholder={label} placeholderTextColor={Colors.textPrimary} style={styles.input} value={value} />
    </View>
  );
}

function MemberSection({ members, title }: { members: TeamMembership[]; title: string }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.cardGap}>
      <Text style={styles.cardTitle}>{title}</Text>
      {members.length === 0 ? <Text style={styles.cardText}>{t("coach.team.noMembers")}</Text> : null}
      {members.map((member) => (
        <View key={member.userId} style={styles.memberRow}>
          <Text style={styles.memberName}>{member.displayName}</Text>
          <Text style={styles.roleText}>{member.role}</Text>
        </View>
      ))}
    </Card>
  );
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
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
  invitePanel: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, padding: Spacing.md },
  inviteLabel: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 12, textTransform: "uppercase" },
  inviteCode: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 26 },
  inputGroup: { gap: Spacing.xs },
  inputLabel: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 46, paddingHorizontal: Spacing.md },
  buttonRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexGrow: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabledButton: { opacity: 0.55 },
  memberRow: { alignItems: "center", borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: Spacing.sm },
  memberName: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold },
  roleText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12 },
});