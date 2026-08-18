import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Archive, CalendarDays, ChevronRight, MoreVertical, RotateCcw } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { auth } from "@/config/firebase";
import { Colors, Radius, Spacing, TeamCodeTypography, Typography } from "@/constants/theme";
import { useCoachBackNavigation } from "@/hooks/useCoachBackNavigation";
import { getTeamRosterProfiles, type TeamRosterProfile } from "@/services/teamRosterService";
import { getOrCreatePrivateTeamConversation } from "@/services/teamPrivateMessageService";
import {
  getCoachRosterActionAvailability,
  resolveCoachTeamAuthority,
  resolveRosterActionTarget,
  type RosterActionAvailability,
} from "@/utils/coachCommunicationCore";
import {
  getCurrentUserTeamMemberships,
  getTeamMembers,
  hasCoachAccess,
  hasTeamRole,
  isTeamActive,
  setTeamArchived,
  setTeamStaffRole,
  type Team,
  type TeamMembership,
} from "@/services/teamService";

type RosterProfiles = Record<string, TeamRosterProfile>;
type StaffRoleFeedback = { message: string; isError: boolean };
type RosterMenuAction = {
  button: {
    onPress: () => void;
    style?: "default" | "destructive";
    text: string;
  };
  key: "makeStaff" | "removeStaffAccess" | "sendPrivateMessage";
};

export default function CoachTeamScreen() {
  const { t } = useTranslation();
  const navigateBack = useCoachBackNavigation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const requestedTeamId = normalizeParam(params.teamId);
  const [members, setMembers] = useState<TeamMembership[]>([]);
  const [profiles, setProfiles] = useState<RosterProfiles>({});
  const [selectedTeam, setSelectedTeam] = useState<Team | null>(null);
  const [currentMembership, setCurrentMembership] = useState<TeamMembership | null>(null);
  const [teamLoading, setTeamLoading] = useState(true);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [openingMessageUserId, setOpeningMessageUserId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<StaffRoleFeedback | null>(null);
  const [lifecycleAction, setLifecycleAction] = useState<"archive" | "restore" | null>(null);
  const staffRoleUpdateInFlight = useRef(false);

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    setTeamError(null);
    setRosterError(null);
    setProfileError(null);
    setFeedback(null);
    setRosterLoading(false);

    try {
      const nextMemberships = await getCurrentUserTeamMemberships({ throwOnError: true });
      const selectedMembership = requestedTeamId
        ? nextMemberships.find((membership) =>
          membership.teamId === requestedTeamId && hasCoachAccess(membership)) ?? null
        : nextMemberships.find(hasCoachAccess) ?? null;
      const nextTeam = selectedMembership?.team ?? null;

      setSelectedTeam(nextTeam);
      setCurrentMembership(selectedMembership);
      setMembers([]);
      setProfiles({});

      if (!nextTeam) return;

      setRosterLoading(true);
      try {
        const nextMembers = await getTeamMembers(nextTeam.id);
        setMembers(nextMembers);
        try {
          setProfiles(await getTeamRosterProfiles(nextMembers.map((member) => member.userId)));
        } catch {
          setProfiles({});
          setProfileError(t("coach.team.profilesLoadError"));
        }
      } catch {
        setMembers([]);
        setProfiles({});
        setRosterError(t("coach.team.rosterLoadError"));
      } finally {
        setRosterLoading(false);
      }
    } catch {
      setTeamError(t("coach.team.error"));
      setSelectedTeam(null);
      setCurrentMembership(null);
      setMembers([]);
      setProfiles({});
      setRosterLoading(false);
    } finally {
      setTeamLoading(false);
    }
  }, [requestedTeamId, t]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const getRosterName = useCallback(
    (member: TeamMembership) => resolveRosterName(profiles[member.userId], t),
    [profiles, t],
  );

  const staffMembers = useMemo(
    () => members
      .filter((member) => member.status === "active" &&
        (hasTeamRole(member, "coach") || hasTeamRole(member, "staff")))
      .sort((first, second) => getRosterName(first).localeCompare(getRosterName(second))),
    [getRosterName, members],
  );

  const parentMembers = useMemo(
    () => members
      .filter((member) => member.status === "active" &&
        hasTeamRole(member, "parent") &&
        !hasTeamRole(member, "coach") &&
        !hasTeamRole(member, "staff"))
      .sort((first, second) => getRosterName(first).localeCompare(getRosterName(second))),
    [getRosterName, members],
  );

  const authenticatedUserId = auth.currentUser?.uid ?? "";
  const teamAuthority = resolveCoachTeamAuthority({
    authenticatedUserId,
    callerMembershipId: currentMembership?.id ?? "",
    callerMembershipStatus: currentMembership?.status ?? "inactive",
    callerMemberUserId: currentMembership?.userId ?? "",
    callerRoles: {
      coach: hasTeamRole(currentMembership, "coach"),
      parent: hasTeamRole(currentMembership, "parent"),
      staff: hasTeamRole(currentMembership, "staff"),
    },
    coachOwnerUserId: selectedTeam?.createdBy ?? "",
    teamActive: isTeamActive(selectedTeam),
  });
  const mayManageLifecycle = teamAuthority.canManageTeamLifecycle;
  const mayManageRoles = teamAuthority.canManageStaff;

  const resolveMemberActions = useCallback((member: TeamMembership) =>
    getCoachRosterActionAvailability({
      authenticatedUserId,
      callerCanManageTeam: mayManageRoles,
      callerHasCoachAccess: teamAuthority.hasCoachAccess,
      coachOwnerUserId: selectedTeam?.createdBy ?? "",
      memberRoles: {
        coach: hasTeamRole(member, "coach"),
        parent: hasTeamRole(member, "parent"),
        staff: hasTeamRole(member, "staff"),
      },
      membershipId: member.id,
      membershipStatus: member.status,
      memberUserId: member.userId,
      teamActive: isTeamActive(selectedTeam),
    }), [authenticatedUserId, mayManageRoles, selectedTeam, teamAuthority.hasCoachAccess]);

  useEffect(() => {
    if (!__DEV__ || members.length === 0) return;
    members.forEach((member) => {
      const actions = resolveMemberActions(member);
      console.info("[CoachTeam] roster action policy", {
        memberUserIdMatchesCaller: member.userId === authenticatedUserId,
        memberUserIdMatchesOwner: member.userId === selectedTeam?.createdBy,
        membershipRole: hasTeamRole(member, "coach")
          ? "coach"
          : hasTeamRole(member, "staff")
            ? "staff"
            : hasTeamRole(member, "parent")
              ? "parent"
              : member.role,
        membershipStatus: member.status,
        hasMembershipId: Boolean(member.id),
        computedActions: {
          showMenu: actions.showMenu,
          makeStaff: actions.showMakeStaff,
          removeStaffAccess: actions.showRemoveStaffAccess,
          sendPrivateMessage: actions.showSendPrivateMessage,
        },
      });
    });
  }, [authenticatedUserId, members, resolveMemberActions, selectedTeam?.createdBy]);

  const changeArchivedState = useCallback(async (archived: boolean) => {
    if (!selectedTeam || !mayManageLifecycle || lifecycleAction) return;
    setLifecycleAction(archived ? "archive" : "restore");
    setFeedback(null);
    try {
      await setTeamArchived(selectedTeam.id, archived);
      if (archived) {
        Alert.alert(
          t("coach.team.archiveSuccessTitle"),
          t("coach.team.archiveSuccessBody"),
          [{ text: t("common.ok"), onPress: () => router.replace("/coach" as never) }],
        );
      } else {
        await loadTeam();
        Alert.alert(t("coach.team.restoreSuccessTitle"), t("coach.team.restoreSuccessBody"));
      }
    } catch (nextError) {
      console.warn("[CoachTeam] lifecycle error:", getErrorCode(nextError));
      setFeedback({
        isError: true,
        message: archived ? t("coach.team.archiveError") : t("coach.team.restoreError"),
      });
    } finally {
      setLifecycleAction(null);
    }
  }, [lifecycleAction, loadTeam, mayManageLifecycle, selectedTeam, t]);

  const confirmArchivedState = useCallback((archived: boolean) => {
    if (!selectedTeam || lifecycleAction) return;
    Alert.alert(
      archived
        ? t("coach.team.archiveTitle", { teamName: selectedTeam.name })
        : t("coach.team.restoreTitle", { teamName: selectedTeam.name }),
      archived ? t("coach.team.archiveBody") : t("coach.team.restoreBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: archived ? t("coach.team.archiveTeam") : t("coach.team.restoreTeam"),
          style: archived ? "destructive" : "default",
          onPress: () => { void changeArchivedState(archived); },
        },
      ],
    );
  }, [changeArchivedState, lifecycleAction, selectedTeam, t]);

  const changeStaffRole = useCallback(async (
    member: TeamMembership,
    name: string,
    isStaff: boolean,
  ) => {
    if (!selectedTeam || staffRoleUpdateInFlight.current || !mayManageRoles) return;
    const target = resolveRosterActionTarget({ membershipId: member.id, memberUserId: member.userId });
    if (!target) {
      setFeedback({ isError: true, message: t("coach.team.staffRoleError") });
      return;
    }
    staffRoleUpdateInFlight.current = true;
    setUpdatingUserId(target.membershipId);
    setFeedback(null);
    try {
      const result = await setTeamStaffRole(selectedTeam.id, target.targetUserId, isStaff);
      setMembers((currentMembers) => currentMembers.map((currentMember) =>
        currentMember.id === target.membershipId
          ? { ...currentMember, role: result.role, roles: result.roles }
          : currentMember,
      ));
      setFeedback({
        isError: false,
        message: isStaff
          ? t("coach.team.staffAddedSuccess", { name })
          : t("coach.team.staffRemovedSuccess"),
      });
    } catch {
      setFeedback({ isError: true, message: t("coach.team.staffRoleError") });
    } finally {
      staffRoleUpdateInFlight.current = false;
      setUpdatingUserId(null);
    }
  }, [mayManageRoles, selectedTeam, t]);

  const confirmStaffRole = useCallback((member: TeamMembership, name: string, isStaff: boolean) => {
    Alert.alert(
      isStaff
        ? t("coach.team.makeStaffTitle", { name })
        : t("coach.team.removeStaffTitle"),
      isStaff
        ? t("coach.team.makeStaffBody")
        : t("coach.team.removeStaffBody", { name }),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: isStaff ? t("coach.team.makeStaff") : t("coach.team.removeAccess"),
          style: isStaff ? "default" : "destructive",
          onPress: () => { void changeStaffRole(member, name, isStaff); },
        },
      ],
    );
  }, [changeStaffRole, t]);

  const openMemberActions = useCallback((
    member: TeamMembership,
    name: string,
    availability: RosterActionAvailability,
  ) => {
    if (updatingUserId || openingMessageUserId || !selectedTeam) return;
    const target = resolveRosterActionTarget({ membershipId: member.id, memberUserId: member.userId });
    if (!target) return;
    const actions: RosterMenuAction[] = [];
    if (availability.showMakeStaff) actions.push({
      key: "makeStaff",
      button: {
        text: t("coach.team.makeStaff"),
        style: "default",
        onPress: () => confirmStaffRole(member, name, true),
      },
    });
    if (availability.showRemoveStaffAccess) actions.push({
      key: "removeStaffAccess",
      button: {
        text: t("coach.team.removeStaffAccess"),
        style: "destructive",
        onPress: () => confirmStaffRole(member, name, false),
      },
    });
    if (availability.showSendPrivateMessage) actions.push({
      key: "sendPrivateMessage",
      button: {
        text: t("teamMessages.sendPrivateMessage"),
        onPress: () => {
          setOpeningMessageUserId(target.membershipId);
          void getOrCreatePrivateTeamConversation(selectedTeam.id, target.targetUserId)
            .then((conversation) => router.push(`/coach/team-messages/${conversation.conversationId}` as never))
            .catch((nextError) => {
              console.warn("[CoachTeam] open private message", getErrorCode(nextError));
              setFeedback({ isError: true, message: t("teamMessages.openError") });
            })
            .finally(() => setOpeningMessageUserId(null));
        },
      },
    });
    if (actions.length === 0) return;
    Alert.alert(
      t("coach.team.memberActionsTitle", { name }),
      undefined,
      [
        { text: t("common.cancel"), style: "cancel" },
        ...actions.map((action) => action.button),
      ],
    );
  }, [confirmStaffRole, openingMessageUserId, selectedTeam, t, updatingUserId]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader
          accessibilityLabel={t("coach.team.backAccessibility")}
          onBack={navigateBack}
          title={t("coach.home.viewTeam")}
        />

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
              {teamAuthority.showCoachHeader ? (
                <Text style={styles.successText}>{t("coach.team.youAreCoach")}</Text>
              ) : null}
              {isTeamActive(selectedTeam) ? (
                <View style={styles.invitePanel}>
                  <Text style={styles.inviteLabel}>{t("coach.team.inviteCode")}</Text>
                  <Text maxFontSizeMultiplier={1.4} style={styles.inviteCode}>{selectedTeam.inviteCode}</Text>
                </View>
              ) : <Text style={styles.archivedStatus}>{t("coach.team.archivedStatus")}</Text>}
            </Card>

            <TouchableOpacity
              accessibilityLabel={t("schedule.teamSchedule", { teamName: selectedTeam.name })}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: "/teams/[teamId]/schedule", params: { teamId: selectedTeam.id } } as never)}
            >
              <Card style={styles.scheduleCard}>
                <CalendarDays color={Colors.communicationLink} size={24} />
                <View style={styles.scheduleCopy}>
                  <Text style={styles.scheduleTitle}>{t("schedule.title")}</Text>
                  <Text style={styles.scheduleSubtitle}>{t("schedule.teamSchedule", { teamName: selectedTeam.name })}</Text>
                </View>
                <ChevronRight color={Colors.textPrimary} size={21} />
              </Card>
            </TouchableOpacity>

            <Card style={styles.cardGap}>
              <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.team.members")}</Text>

              {rosterLoading ? (
                <View accessibilityLiveRegion="polite" style={styles.centerInline}>
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.cardText}>{t("common.loading")}</Text>
                </View>
              ) : null}

              {!rosterLoading && rosterError ? (
                <View accessibilityLiveRegion="polite" style={styles.centerInline}>
                  <Text style={styles.errorText}>{rosterError}</Text>
                  <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={loadTeam} style={styles.retryButton}>
                    <Text style={styles.retryText}>{t("common.retry")}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {!rosterLoading && !rosterError ? (
                <>
                  {profileError ? (
                    <Text accessibilityLiveRegion="polite" style={styles.profileError}>{profileError}</Text>
                  ) : null}
                  {feedback ? (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={feedback.isError ? styles.errorText : styles.feedbackText}
                    >
                      {feedback.message}
                    </Text>
                  ) : null}

                  <RosterSection
                    emptyText={t("coach.team.noStaffTitle")}
                    members={staffMembers}
                    profiles={profiles}
                    title={t("coach.team.staff")}
                    updatingUserId={updatingUserId ?? openingMessageUserId}
                    resolveActions={resolveMemberActions}
                    onOpenActions={openMemberActions}
                  />

                  <RosterSection
                    emptyText={t("coach.team.noParentsTitle")}
                    members={parentMembers}
                    profiles={profiles}
                    title={t("coach.team.parents")}
                    updatingUserId={updatingUserId ?? openingMessageUserId}
                    resolveActions={resolveMemberActions}
                    onOpenActions={openMemberActions}
                  />

                  {parentMembers.length === 0 ? (
                    <Text style={styles.cardText}>{t("coach.team.noParentsBody")}</Text>
                  ) : null}
                </>
              ) : null}
            </Card>

            {mayManageLifecycle ? (
              <Card style={styles.cardGap}>
                <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.team.teamSettings")}</Text>
                <TouchableOpacity
                  accessibilityLabel={isTeamActive(selectedTeam)
                    ? t("coach.team.archiveTeam")
                    : t("coach.team.restoreTeam")}
                  accessibilityRole="button"
                  accessibilityState={{ busy: Boolean(lifecycleAction), disabled: Boolean(lifecycleAction) }}
                  disabled={Boolean(lifecycleAction)}
                  onPress={() => confirmArchivedState(isTeamActive(selectedTeam))}
                  style={isTeamActive(selectedTeam) ? styles.destructiveButton : styles.primaryButton}
                >
                  {lifecycleAction
                    ? <ActivityIndicator color={Colors.surface} size="small" />
                    : isTeamActive(selectedTeam)
                      ? <Archive color={Colors.surface} size={18} />
                      : <RotateCcw color={Colors.surface} size={18} />}
                  <Text style={styles.actionText}>
                    {lifecycleAction === "archive"
                      ? t("coach.team.archiving")
                      : lifecycleAction === "restore"
                        ? t("coach.team.restoring")
                        : isTeamActive(selectedTeam)
                          ? t("coach.team.archiveTeam")
                          : t("coach.team.restoreTeam")}
                  </Text>
                </TouchableOpacity>
              </Card>
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function RosterSection({
  emptyText,
  members,
  onOpenActions,
  profiles,
  resolveActions,
  title,
  updatingUserId,
}: {
  emptyText: string;
  members: TeamMembership[];
  onOpenActions: (member: TeamMembership, name: string, actions: RosterActionAvailability) => void;
  profiles: RosterProfiles;
  resolveActions: (member: TeamMembership) => RosterActionAvailability;
  title: string;
  updatingUserId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {members.length === 0 ? <Text style={styles.emptyText}>{emptyText}</Text> : null}
      {members.map((member) => {
        const name = resolveRosterName(profiles[member.userId], t);
        const actions = resolveActions(member);
        return (
          <MemberRow
            key={member.id}
            canManage={actions.showMenu}
            isUpdating={updatingUserId === member.id}
            name={name}
            onOpenActions={() => onOpenActions(member, name, actions)}
            roleLabel={getRoleLabel(member, t)}
            updatesDisabled={Boolean(updatingUserId)}
          />
        );
      })}
    </View>
  );
}

function resolveRosterName(profile: TeamRosterProfile | undefined, t: (key: string) => string) {
  return profile?.displayName ?? t(profile?.profileState === "deleted"
    ? "common.formerMember"
    : "common.sidelineSocialMember");
}

function MemberRow({
  canManage,
  isUpdating,
  name,
  onOpenActions,
  roleLabel,
  updatesDisabled,
}: {
  canManage: boolean;
  isUpdating: boolean;
  name: string;
  onOpenActions: () => void;
  roleLabel: string;
  updatesDisabled: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View accessibilityLabel={t("coach.team.memberAccessibilityLabel", { name, role: roleLabel })} style={styles.memberRow}>
      <View importantForAccessibility="no" style={styles.memberAvatar}>
        <Text style={styles.memberInitial}>{getInitial(name)}</Text>
      </View>
      <View style={styles.memberText}>
        <Text style={styles.memberName}>{name}</Text>
        <Text style={styles.roleLabel}>{roleLabel}</Text>
      </View>
      {canManage ? (
        <TouchableOpacity
          accessibilityLabel={t("coach.team.memberActionsTitle", { name })}
          accessibilityRole="button"
          activeOpacity={0.75}
          disabled={updatesDisabled}
          hitSlop={8}
          onPress={onOpenActions}
          style={[styles.actionButton, updatesDisabled ? styles.actionDisabled : null]}
        >
          {isUpdating
            ? <ActivityIndicator color={Colors.primary} size="small" />
            : <MoreVertical color={Colors.primary} size={22} strokeWidth={2.2} />}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function getRoleLabel(member: TeamMembership, t: (key: string) => string) {
  const isParent = hasTeamRole(member, "parent");
  if (hasTeamRole(member, "coach")) {
    return isParent ? t("coach.team.roleCoachParent") : t("coach.team.roleCoach");
  }
  if (hasTeamRole(member, "staff")) {
    return isParent ? t("coach.team.roleStaffParent") : t("coach.team.roleStaff");
  }
  return t("coach.team.roleParent");
}

function formatTeamDetails(team: Team) {
  return [team.sport, team.ageRange, team.division, team.season].filter(Boolean).join(" - ");
}

function getInitial(name: string) {
  return name.trim().charAt(0).toUpperCase() || "P";
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl + Spacing.lg },
  cardGap: { gap: Spacing.md },
  centerCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  centerInline: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.md },
  errorCard: { alignItems: "center", borderLeftColor: Colors.primary, borderLeftWidth: 4, gap: Spacing.md },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  profileError: { color: Colors.primary, fontFamily: Typography.bodyRegular, fontSize: 13, textAlign: "center" },
  feedbackText: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  successText: { color: Colors.accentGreen, fontFamily: Typography.bodyBold, textAlign: "center" },
  archivedStatus: { color: Colors.primary, fontFamily: Typography.bodyBold, textAlign: "center", textTransform: "uppercase" },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, textAlign: "center" },
  cardText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20, textAlign: "center" },
  scheduleCard: { alignItems: "center", borderColor: Colors.communicationLink, borderWidth: 1, flexDirection: "row", gap: Spacing.sm },
  scheduleCopy: { flex: 1, gap: 2 },
  scheduleTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  scheduleSubtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  invitePanel: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, padding: Spacing.md },
  inviteLabel: { color: Colors.textPrimary, fontFamily: Typography.bodySemiBold, fontSize: 12, textTransform: "uppercase" },
  inviteCode: { ...TeamCodeTypography, color: Colors.textHeading, fontSize: 26 },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  destructiveButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  actionText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  retryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: Spacing.lg },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  section: { gap: Spacing.xs },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 16, marginTop: Spacing.xs },
  emptyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, paddingVertical: Spacing.sm },
  memberRow: { alignItems: "center", borderBottomColor: Colors.secondary, borderBottomWidth: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 58, paddingVertical: Spacing.sm },
  memberAvatar: { alignItems: "center", backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  memberInitial: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 15 },
  memberText: { flex: 1, gap: 2 },
  memberName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  roleLabel: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13 },
  actionButton: { alignItems: "center", height: 44, justifyContent: "center", width: 44 },
  actionDisabled: { opacity: 0.45 },
});

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}
