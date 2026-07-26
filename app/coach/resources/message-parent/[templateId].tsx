import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, UserRound } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getCoachCommunicationTemplate,
  localizeCoachText,
  personalizeCoachTemplate,
  resolveCoachResourceLocale,
} from "@/services/coachResourcesService";
import {
  getEligiblePrivateTeamParents,
  getOrCreatePrivateTeamConversation,
  type EligiblePrivateTeamParent,
} from "@/services/teamPrivateMessageService";
import {
  getCurrentUserTeamMemberships,
  hasCoachAccess,
  isTeamActive,
  type TeamMembership,
} from "@/services/teamService";

type LoadState = "idle" | "loading" | "loaded" | "error";

export default function MessageAParentTemplateScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ templateId?: string | string[] }>();
  const templateId = normalizeParam(params.templateId);
  const template = getCoachCommunicationTemplate(templateId);
  const locale = resolveCoachResourceLocale(i18n.language);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [teamLoadState, setTeamLoadState] = useState<LoadState>("loading");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [parents, setParents] = useState<EligiblePrivateTeamParent[]>([]);
  const [parentLoadState, setParentLoadState] = useState<LoadState>("idle");
  const [search, setSearch] = useState("");
  const [selectedParentId, setSelectedParentId] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parentRequestVersion = useRef(0);

  const loadTeams = useCallback(async () => {
    setTeamLoadState("loading");
    setError(null);
    try {
      const results = await getCurrentUserTeamMemberships();
      const coachTeams = results.filter((entry) => hasCoachAccess(entry) && isTeamActive(entry.team));
      setMemberships(coachTeams);
      setSelectedTeamId((current) => {
        if (coachTeams.some((entry) => entry.teamId === current)) return current;
        return coachTeams.length === 1 ? coachTeams[0].teamId : "";
      });
      setTeamLoadState("loaded");
    } catch (nextError) {
      console.warn("[MessageAParent] teams load error:", getErrorCode(nextError));
      setMemberships([]);
      setTeamLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadTeams();
  }, [loadTeams]);

  const loadParents = useCallback(async (teamId: string) => {
    const requestVersion = ++parentRequestVersion.current;
    setParentLoadState("loading");
    setParents([]);
    setSelectedParentId("");
    setError(null);
    try {
      const result = await getEligiblePrivateTeamParents(teamId);
      if (requestVersion !== parentRequestVersion.current) return;
      setParents(result.parents);
      setParentLoadState("loaded");
    } catch (nextError) {
      if (requestVersion !== parentRequestVersion.current) return;
      console.warn("[MessageAParent] parents load error:", getErrorCode(nextError));
      setParentLoadState("error");
    }
  }, []);

  useEffect(() => {
    setSearch("");
    if (!selectedTeamId) {
      parentRequestVersion.current += 1;
      setParents([]);
      setSelectedParentId("");
      setParentLoadState("idle");
      return;
    }
    void loadParents(selectedTeamId);
  }, [loadParents, selectedTeamId]);

  const selectedMembership = memberships.find((entry) => entry.teamId === selectedTeamId) ?? null;
  const filteredParents = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return parents;
    return parents.filter((parent) => parent.displayName.toLocaleLowerCase().includes(normalizedSearch));
  }, [parents, search]);
  const selectedParent = parents.find((parent) => parent.userId === selectedParentId) ?? null;

  const openPrivateComposer = useCallback(async () => {
    if (!template || template.category !== "message_parent" || !selectedMembership?.team || !selectedParent || opening) return;
    setOpening(true);
    setError(null);
    try {
      const conversation = await getOrCreatePrivateTeamConversation(selectedMembership.teamId, selectedParent.userId);
      const initialText = personalizeCoachTemplate(template, locale, {
        coachName: user?.displayName ?? undefined,
        teamName: selectedMembership.team.name,
      });
      router.push({
        pathname: "/coach/team-messages/[conversationId]",
        params: {
          conversationId: conversation.conversationId,
          initialText,
          source: "message-parent",
        },
      } as never);
    } catch (nextError) {
      console.warn("[MessageAParent] conversation error:", getErrorCode(nextError));
      setError(t("coach.resources.messageParentOpenError"));
    } finally {
      setOpening(false);
    }
  }, [locale, opening, selectedMembership, selectedParent, t, template, user?.displayName]);

  if (!template || template.category !== "message_parent") {
    return (
      <ScreenWrapper>
        <View style={styles.center}>
          <Text style={styles.error}>{t("coach.resources.templateNotFound")}</Text>
        </View>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader
          subtitle={localizeCoachText(template.description, locale)}
          title={localizeCoachText(template.title, locale)}
        />

        <Card style={styles.privateCard}>
          <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.resources.messageParentPrivateTitle")}</Text>
          <Text style={styles.cardBody}>{t("coach.resources.messageParentPrivateBody")}</Text>
        </Card>

        <Card style={styles.cardGap}>
          <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.resources.chooseTeam")}</Text>
          {teamLoadState === "loading" ? <ActivityIndicator color={Colors.primary} /> : null}
          {teamLoadState === "error" ? (
            <>
              <Text accessibilityLiveRegion="polite" style={styles.error}>{t("coach.resources.messageParentTeamsError")}</Text>
              <RetryButton label={t("common.retry")} onPress={() => void loadTeams()} />
            </>
          ) : null}
          {teamLoadState === "loaded" && memberships.length === 0 ? (
            <Text style={styles.cardBody}>{t("coach.resources.messageParentNoTeams")}</Text>
          ) : null}
          {memberships.map((entry) => (
            <TouchableOpacity
              accessibilityLabel={entry.team?.name ?? t("coach.team.title")}
              accessibilityRole="radio"
              accessibilityState={{ checked: selectedTeamId === entry.teamId }}
              key={entry.teamId}
              onPress={() => setSelectedTeamId(entry.teamId)}
              style={[styles.teamOption, selectedTeamId === entry.teamId && styles.optionSelected]}
            >
              <Text style={styles.teamText}>{entry.team?.name}</Text>
              {selectedTeamId === entry.teamId ? <Check color={Colors.primary} size={20} /> : null}
            </TouchableOpacity>
          ))}
        </Card>

        {selectedTeamId ? (
          <Card style={styles.cardGap}>
            <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.resources.chooseParent")}</Text>
            <TextInput
              accessibilityLabel={t("coach.resources.parentSearchAccessibility")}
              autoCapitalize="words"
              onChangeText={(value) => {
                setSearch(value);
                if (error) setError(null);
              }}
              placeholder={t("coach.resources.parentSearchPlaceholder")}
              placeholderTextColor={Colors.textPrimary}
              style={styles.searchInput}
              value={search}
            />
            {parentLoadState === "loading" ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={Colors.primary} />
                <Text accessibilityLiveRegion="polite" style={styles.cardBody}>{t("coach.resources.parentsLoading")}</Text>
              </View>
            ) : null}
            {parentLoadState === "error" ? (
              <>
                <Text accessibilityLiveRegion="polite" style={styles.error}>{t("coach.resources.parentsLoadError")}</Text>
                <RetryButton label={t("common.retry")} onPress={() => void loadParents(selectedTeamId)} />
              </>
            ) : null}
            {parentLoadState === "loaded" && parents.length === 0 ? (
              <Text style={styles.cardBody}>{t("coach.resources.noEligibleParents")}</Text>
            ) : null}
            {parentLoadState === "loaded" && parents.length > 0 && filteredParents.length === 0 ? (
              <Text style={styles.cardBody}>{t("coach.resources.noParentSearchResults", { query: search.trim() })}</Text>
            ) : null}
            {filteredParents.map((parent) => (
              <TouchableOpacity
                accessibilityLabel={t("coach.resources.selectParentAccessibility", { name: parent.displayName })}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedParentId === parent.userId }}
                key={parent.userId}
                onPress={() => {
                  setSelectedParentId(parent.userId);
                  setError(null);
                }}
                style={[styles.parentOption, selectedParentId === parent.userId && styles.optionSelected]}
              >
                <View style={styles.avatar}>
                  <UserRound color={Colors.primary} size={20} />
                </View>
                <View style={styles.parentCopy}>
                  <Text style={styles.parentName}>{parent.displayName}</Text>
                  <Text style={styles.parentTeam}>{selectedMembership?.team?.name}</Text>
                </View>
                {selectedParentId === parent.userId ? <Check color={Colors.primary} size={20} /> : null}
              </TouchableOpacity>
            ))}
            {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={!selectedParent || opening}
              onPress={() => void openPrivateComposer()}
              style={[styles.primaryButton, (!selectedParent || opening) && styles.disabled]}
            >
              {opening
                ? <ActivityIndicator color={Colors.surface} />
                : <Text style={styles.primaryText}>{t("coach.resources.openPrivateMessage")}</Text>}
            </TouchableOpacity>
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function RetryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.retryButton}>
      <Text style={styles.retryText}>{label}</Text>
    </TouchableOpacity>
  );
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center", padding: Spacing.lg },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  cardGap: { gap: Spacing.md },
  privateCard: { borderLeftColor: Colors.primary, borderLeftWidth: 4, gap: Spacing.sm },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, lineHeight: 23 },
  cardBody: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 21 },
  teamOption: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 48, paddingHorizontal: Spacing.md },
  optionSelected: { backgroundColor: Colors.background, borderColor: Colors.primary },
  teamText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  searchInput: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 48, paddingHorizontal: Spacing.md },
  loadingRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, justifyContent: "center" },
  parentOption: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 64, padding: Spacing.sm },
  avatar: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  parentCopy: { flex: 1, gap: 2, minWidth: 0 },
  parentName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  parentTeam: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  disabled: { opacity: 0.5 },
  retryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.md },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14 },
});
