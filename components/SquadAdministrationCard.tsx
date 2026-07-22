import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, AppState, findNodeHandle, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ShieldCheck, UserPlus } from "lucide-react-native";
import { useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  cancelSquadAdminInvitation,
  getSquadAdministration,
  getSquadAdminErrorReason,
  inviteSquadAdmin,
  removeSquadAdmin,
  requestSquadAdminAccess,
  respondToSquadAdminInvitation,
  type SquadAdministration,
  type SquadAdminMember,
} from "@/services/squadService";

type Props = {
  onStateChange?: (state: SquadAdministration | null) => void;
  selectionRequestKey?: number;
  squadId: string;
};

export type SquadAdministrationCardHandle = {
  focusHeading: () => void;
};

export const SquadAdministrationCard = forwardRef<SquadAdministrationCardHandle, Props>(function SquadAdministrationCard(
  { onStateChange, selectionRequestKey = 0, squadId },
  ref,
) {
  const { t } = useTranslation();
  const headingRef = useRef<React.ElementRef<typeof Text>>(null);
  const loadRequestRef = useRef(0);
  const [state, setState] = useState<SquadAdministration | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEligibleMembers, setShowEligibleMembers] = useState(false);

  const load = useCallback(async () => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    setError(null);
    onStateChange?.(null);
    try {
      const next = await getSquadAdministration(squadId);
      if (requestId !== loadRequestRef.current) return;
      setState(next);
      onStateChange?.(next);
    } catch (nextError) {
      if (requestId !== loadRequestRef.current) return;
      onStateChange?.(null);
      setError(adminErrorMessage(nextError, t));
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [onStateChange, squadId, t]);

  const focusHeading = useCallback(() => {
    const node = findNodeHandle(headingRef.current);
    if (node != null) AccessibilityInfo.setAccessibilityFocus(node);
  }, []);

  useImperativeHandle(ref, () => ({ focusHeading }), [focusHeading]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void load();
    });
    return () => subscription.remove();
  }, [load]);
  useEffect(() => {
    if (selectionRequestKey > 0) setShowEligibleMembers(true);
  }, [selectionRequestKey]);

  const names = useMemo(() => new Map(
    state?.members.map((member) => [member.userId, memberName(member, t)]) ?? [],
  ), [state?.members, t]);

  const run = useCallback(async (actionId: string, action: () => Promise<unknown>, successKey?: string) => {
    if (busyAction) return;
    setBusyAction(actionId);
    setError(null);
    try {
      await action();
      if (successKey) Alert.alert("", t(successKey));
      await load();
    } catch (nextError) {
      setError(adminErrorMessage(nextError, t));
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, load, t]);

  if (loading && !state) {
    return <ActivityIndicator accessibilityLabel={t("squadAdmin.loading")} color={Colors.primary} />;
  }
  if (!state) {
    return error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null;
  }

  const inviterName = state.myInvitation ? names.get(state.myInvitation.invitedByUserId) ?? t("squadAdmin.memberNameUnavailable") : "";
  return (
    <Card style={styles.card}>
      <View style={styles.headingRow}>
        <ShieldCheck color={Colors.primary} size={22} />
        <Text accessibilityRole="header" ref={headingRef} style={styles.title}>{t("squadAdmin.title")}</Text>
      </View>

      {state.myInvitation ? (
        <View accessibilityLiveRegion="polite" style={styles.invitationCard}>
          <Text
            accessibilityLabel={t("squadAdmin.invitationAccessibility", { actorName: inviterName, squadName: state.squadLabel })}
            accessibilityRole="header"
            style={styles.invitationTitle}
          >
            {t("squadAdmin.helpManageTitle")}
          </Text>
          <Text style={styles.body}>{t("squadAdmin.helpManageBody", { actorName: inviterName, squadName: state.squadLabel })}</Text>
          <Text style={styles.body}>{t("squadAdmin.responsibilityBody")}</Text>
          <View style={styles.actions}>
            <ActionButton
              accessibilityLabel={t("squadAdmin.acceptAccessibility", { squadName: state.squadLabel })}
              busy={busyAction === "accept"}
              disabled={Boolean(busyAction)}
              label={t("squadAdmin.acceptInvitation")}
              onPress={() => void run("accept", () => respondToSquadAdminInvitation(squadId, "accept"), "squadAdmin.accepted")}
            />
            <ActionButton
              accessibilityLabel={t("squadAdmin.declineAccessibility", { squadName: state.squadLabel })}
              disabled={Boolean(busyAction)}
              label={t("squadAdmin.decline")}
              onPress={() => confirmAction(
                t("squadAdmin.declineConfirmTitle"),
                t("squadAdmin.declineConfirmBody", { squadName: state.squadLabel }),
                t("squadAdmin.decline"),
                () => void run("decline", () => respondToSquadAdminInvitation(squadId, "decline"), "squadAdmin.declined"),
                t,
              )}
              secondary
            />
          </View>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>{t("squadAdmin.admins")}</Text>
      {state.admins.length ? state.admins.map((member) => (
        <MemberRow
          key={member.userId}
          name={memberName(member, t)}
          trailing={member.isCurrentUser ? t("squadAdmin.you") : undefined}
        >
          {state.callerIsAdmin && state.activeAdminCount > 1 ? (
            <TextAction
              destructive
              disabled={Boolean(busyAction)}
              label={member.isCurrentUser ? t("squadAdmin.stepDown") : t("squadAdmin.removeAdmin")}
              onPress={() => confirmAction(
                member.isCurrentUser ? t("squadAdmin.stepDownConfirmTitle") : t("squadAdmin.removeConfirmTitle"),
                member.isCurrentUser
                  ? t("squadAdmin.stepDownConfirmBody")
                  : t("squadAdmin.removeConfirmBody", { name: memberName(member, t) }),
                member.isCurrentUser ? t("squadAdmin.stepDown") : t("squadAdmin.removeAdmin"),
                () => void run(`remove:${member.userId}`, () => removeSquadAdmin(squadId, member.userId), "squadAdmin.roleUpdated"),
                t,
                true,
              )}
            />
          ) : null}
        </MemberRow>
      )) : <Text style={styles.warning}>{t("squadAdmin.noAdministrator")}</Text>}

      {state.isOrphaned ? (
        <View style={styles.orphanedCard}>
          <Text style={styles.warning}>{t("squadAdmin.orphanedBody")}</Text>
          {state.recoveryRequestStatus === "pending" ? (
            <Text accessibilityLiveRegion="polite" style={styles.pending}>{t("squadAdmin.recoverySubmitted")}</Text>
          ) : (
            <ActionButton
              accessibilityLabel={t("squadAdmin.requestAccess")}
              busy={busyAction === "recovery"}
              disabled={Boolean(busyAction)}
              label={t("squadAdmin.requestAccess")}
              onPress={() => void run("recovery", () => requestSquadAdminAccess(squadId), "squadAdmin.recoverySubmitted")}
            />
          )}
        </View>
      ) : null}

      {state.callerIsAdmin ? (
        <>
          {state.pendingInvitations.length ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t("squadAdmin.pendingInvitations")}</Text>
              {state.pendingInvitations.map((invitation) => {
                const name = names.get(invitation.targetUserId) ?? t("squadAdmin.memberNameUnavailable");
                return (
                  <MemberRow key={invitation.invitationId} name={name} trailing={t("squadAdmin.pendingInvitation")}>
                    <TextAction
                      destructive
                      disabled={Boolean(busyAction)}
                      label={t("squadAdmin.cancelInvitation")}
                      onPress={() => confirmAction(
                        t("squadAdmin.cancelConfirmTitle"),
                        t("squadAdmin.cancelConfirmBody", { name }),
                        t("squadAdmin.cancelInvitation"),
                        () => void run(`cancel:${invitation.targetUserId}`, () => cancelSquadAdminInvitation(squadId, invitation.targetUserId), "squadAdmin.invitationCanceled"),
                        t,
                        true,
                      )}
                    />
                  </MemberRow>
                );
              })}
            </View>
          ) : null}

          <View style={styles.section}>
            <TouchableOpacity
              accessibilityLabel={t("squadAdmin.chooseNewAdmin")}
              accessibilityRole="button"
              accessibilityState={{ expanded: showEligibleMembers }}
              activeOpacity={0.84}
              onPress={() => setShowEligibleMembers((value) => !value)}
              style={styles.selectorButton}
            >
              <UserPlus color={Colors.primary} size={18} />
              <Text style={styles.selectorText}>{t("squadAdmin.chooseNewAdmin")}</Text>
            </TouchableOpacity>
            {showEligibleMembers ? (
              <View accessibilityLiveRegion="polite" style={styles.memberList}>
                <Text style={styles.sectionTitle}>{t("squadAdmin.members")}</Text>
                {state.eligibleMembers.length ? state.eligibleMembers.map((member) => {
                  const name = memberName(member, t);
                  return (
                    <MemberRow key={member.userId} name={name}>
                      <TextAction
                        disabled={Boolean(busyAction)}
                        label={t("squadAdmin.inviteAsAdmin")}
                        onPress={() => confirmAction(
                          t("squadAdmin.inviteConfirmTitle"),
                          t("squadAdmin.inviteConfirmBody", { name }),
                          t("squadAdmin.inviteAsAdmin"),
                          () => void run(`invite:${member.userId}`, () => inviteSquadAdmin(squadId, member.userId), "squadAdmin.invitationSent"),
                          t,
                        )}
                      />
                    </MemberRow>
                  );
                }) : <Text style={styles.body}>{t("squadAdmin.noEligibleMembers")}</Text>}
              </View>
            ) : null}
          </View>
        </>
      ) : null}

      {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    </Card>
  );
});

function MemberRow({
  children,
  name,
  trailing,
}: {
  children?: React.ReactNode;
  name: string;
  trailing?: string;
}) {
  return (
    <View
      accessible={!children}
      accessibilityLabel={!children ? [name, trailing].filter(Boolean).join(", ") : undefined}
      style={styles.memberRow}
    >
      <View style={styles.memberCopy}>
        <Text style={styles.memberName}>{name}</Text>
        {trailing ? <Text style={styles.role}>{trailing}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ActionButton({ accessibilityLabel, busy, disabled, label, onPress, secondary = false }: {
  accessibilityLabel: string;
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: Boolean(busy), disabled: Boolean(disabled) }}
      activeOpacity={0.84}
      disabled={disabled}
      onPress={onPress}
      style={[secondary ? styles.secondaryButton : styles.primaryButton, disabled && styles.disabled]}
    >
      {busy ? <ActivityIndicator color={secondary ? Colors.primary : "#FFFFFF"} size="small" /> : null}
      <Text style={secondary ? styles.secondaryButtonText : styles.primaryButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

function TextAction({ destructive = false, disabled, label, onPress }: {
  destructive?: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={styles.textAction}
    >
      <Text style={[styles.textActionLabel, destructive && styles.destructiveText]}>{label}</Text>
    </TouchableOpacity>
  );
}

function confirmAction(
  title: string,
  body: string,
  confirmLabel: string,
  onConfirm: () => void,
  t: (key: string) => string,
  destructive = false,
) {
  Alert.alert(title, body, [
    { text: t("common.cancel"), style: "cancel" },
    { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: onConfirm },
  ]);
}

function memberName(member: SquadAdminMember, t: (key: string) => string) {
  return member.displayName?.trim() || t(member.profileState === "deleted"
    ? "common.formerMember"
    : "common.sidelineSocialMember");
}

function adminErrorMessage(error: unknown, t: (key: string) => string) {
  const reason = getSquadAdminErrorReason(error);
  const keys: Record<string, string> = {
    cannot_invite_self: "squadAdmin.errorCannotInviteSelf",
    last_active_admin: "squadAdmin.errorLastAdmin",
    target_not_admin: "squadAdmin.errorTargetNotAdmin",
    target_not_active_member: "squadAdmin.errorTargetInactive",
    target_already_admin: "squadAdmin.errorAlreadyAdmin",
    invitation_accepted: "squadAdmin.errorAlreadyAdmin",
    invitation_already_pending: "squadAdmin.errorInvitationPending",
    invitation_declined: "squadAdmin.errorInvitationResolved",
    invitation_expired: "squadAdmin.errorInvitationExpired",
    invitation_not_found: "squadAdmin.errorInvitationNotFound",
    invitation_canceled: "squadAdmin.errorInvitationCanceled",
    not_squad_admin: "squadAdmin.errorNotAdmin",
    squad_has_active_admin: "squadAdmin.errorSquadHasAdmin",
    squad_has_no_active_admin: "squadAdmin.errorNoAdmin",
    squad_not_found: "squadAdmin.errorSquadUnavailable",
    recovery_request_already_pending: "squadAdmin.recoverySubmitted",
    recovery_request_not_found: "squadAdmin.errorRecoveryUnavailable",
    concurrent_admin_change: "squadAdmin.errorConcurrentChange",
  };
  return t(reason && keys[reason] ? keys[reason] : "squadAdmin.errorGeneric");
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  headingRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  title: { color: Colors.textHeading, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  body: { color: Colors.textPrimary, flexShrink: 1, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  invitationCard: { backgroundColor: `${Colors.secondary}33`, borderRadius: Radius.sm, gap: Spacing.sm, padding: Spacing.md },
  invitationTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  actions: { gap: Spacing.sm },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: "#FFFFFF", flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  secondaryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  secondaryButtonText: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  disabled: { opacity: 0.55 },
  memberList: { gap: Spacing.sm },
  memberRow: { alignItems: "center", borderTopColor: `${Colors.secondary}66`, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, minHeight: 48, paddingTop: Spacing.sm },
  memberCopy: { flex: 1, minWidth: 140 },
  memberName: { color: Colors.textHeading, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  role: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  textAction: { justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.xs },
  textActionLabel: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "right" },
  destructiveText: { color: "#B42318" },
  selectorButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  selectorText: { color: Colors.primary, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  orphanedCard: { borderColor: Colors.accentGold, borderRadius: Radius.sm, borderWidth: 1, gap: Spacing.sm, padding: Spacing.md },
  warning: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
  pending: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
});
