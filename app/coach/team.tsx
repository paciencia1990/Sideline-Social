import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getCurrentUserTeamMemberships,
  getTeamMembers,
  type Team,
  type TeamMembership,
} from "@/services/teamService";

export default function CoachTeamScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const requestedTeamId = normalizeParam(params.teamId);
  const [members, setMembers] = useState<TeamMembership[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);
  const [parentsLoading, setParentsLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [parentsError, setParentsError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    setTeamError(null);
    setParentsError(null);

    try {
      const nextMemberships = await getCurrentUserTeamMemberships();
      const selectedMembership = nextMemberships.find((membership) => membership.teamId === requestedTeamId) ?? nextMemberships[0] ?? null;
      const nextTeam = selectedMembership?.team ?? null;

      setSelectedTeam(nextTeam);
      setMembers([]);

      if (!nextTeam) {
        return;
      }

      setParentsLoading(true);
      try {
        setMembers(await getTeamMembers(nextTeam.id));
      } catch (nextError) {
        console.warn("[CoachTeam] parents load error:", nextError);
        setMembers([]);
        setParentsError(t("coach.team.parentsLoadError"));
      } finally {
        setParentsLoading(false);
      }
    } catch (nextError) {
      console.warn("[CoachTeam] load error:", nextError);
      setTeamError(t("coach.team.error"));
      setSelectedTeam(null);
      setMembers([]);
      setParentsLoading(false);
    } finally {
      setTeamLoading(false);
    }
  }, [requestedTeamId, t]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const acceptedParents = useMemo(
    () => members
      .filter((member) => member.role === "parent" && member.status === "active")
      .sort((first, second) => getParentName(first, t).localeCompare(getParentName(second, t))),
    [members, t],
  );

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {teamLoading && !selectedTeam ? (
          <Card style={styles.centerCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.cardText}>{t("common.loading")}</Text>
          </Card>
        ) : null}

        {teamError ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{teamError}</Text>
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={loadTeam} style={styles.retryButton}>
              <Text style={styles.retryText}>{t("common.retry")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}

        {selectedTeam ? (
          <>
            <Card style={styles.cardGap}>
              <Text style={styles.cardTitle}>{selectedTeam.name}</Text>
              <Text style={styles.cardText}>{formatTeamDetails(selectedTeam)}</Text>
              <Text style={styles.successText}>{t("coach.team.youAreCoach")}</Text>
              <View style={styles.invitePanel}>
                <Text style={styles.inviteLabel}>{t("coach.team.inviteCode")}</Text>
                <Text style={styles.inviteCode}>{selectedTeam.inviteCode}</Text>
              </View>
            </Card>

            <Card style={styles.cardGap}>
              <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.team.parents")}</Text>
              {parentsLoading ? (
                <View accessibilityLiveRegion="polite" style={styles.centerInline}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.cardText}>{t("common.loading")}</Text>
                </View>
              ) : null}

              {!parentsLoading && parentsError ? (
                <View accessibilityLiveRegion="polite" style={styles.centerInline}>
                  <Text style={styles.errorText}>{parentsError}</Text>
                  <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={loadTeam} style={styles.retryButton}>
                    <Text style={styles.retryText}>{t("common.retry")}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {!parentsLoading && !parentsError && acceptedParents.length === 0 ? (
                <View accessibilityLiveRegion="polite" style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>{t("coach.team.noParentsTitle")}</Text>
                  <Text style={styles.cardText}>{t("coach.team.noParentsBody")}</Text>
                </View>
              ) : null}

              {!parentsLoading && !parentsError && acceptedParents.length > 0 ? (
                <View style={styles.parentList}>
                  {acceptedParents.map((parent) => (
                    <ParentRow key={parent.userId} member={parent} />
                  ))}
                </View>
              ) : null}
            </Card>
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function ParentRow({ member }: { member: TeamMembership }) {
  const { t } = useTranslation();
  const name = getParentName(member, t);

  return (
    <View accessibilityLabel={t("coach.team.parentAccessibilityLabel", { name })} accessible style={styles.parentRow}>
      <View importantForAccessibility="no" style={styles.parentAvatar}>
        <Text style={styles.parentInitial}>{getInitial(name)}</Text>
      </View>
      <Text style={styles.parentName}>{name}</Text>
    </View>
  );
}

function formatTeamDetails(team: Team) {
  return [team.sport, team.ageRange, team.division, team.season].filter(Boolean).join(" - ");
}

function getParentName(member: TeamMembership, t: (key: string) => string) {
  return member.displayName.trim() || t("coach.team.teamParentFallback");
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "P";
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  cardGap: { gap: Spacing.md },
  centerCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  centerInline: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.md },
  errorCard: { alignItems: "center", borderLeftColor: Colors.primary, borderLeftWidth: 4, gap: Spacing.md },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  successText: { color: Colors.accentGreen, fontFamily: Typography.bodyBold, textAlign: "center" },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  invitePanel: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, padding: Spacing.md },
  inviteLabel: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 12, textTransform: "uppercase" },
  inviteCode: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 26 },
  retryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: Spacing.lg },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  emptyState: { alignItems: "center", gap: Spacing.xs, paddingVertical: Spacing.md },
  emptyTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, textAlign: "center" },
  parentList: { gap: Spacing.xs },
  parentRow: { alignItems: "center", borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", gap: Spacing.sm, paddingVertical: Spacing.sm },
  parentAvatar: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  parentInitial: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 15 },
  parentName: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 15 },
});
