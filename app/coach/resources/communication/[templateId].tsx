import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Send, Share2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  findUnresolvedCoachPlaceholders,
  getCoachCommunicationTemplate,
  localizeCoachText,
  personalizeCoachTemplate,
  resolveCoachResourceLocale,
} from "@/services/coachResourcesService";
import { getCurrentUserTeamMemberships, hasCoachAccess, isTeamActive, type TeamMembership } from "@/services/teamService";

export default function CoachCommunicationTemplateScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ templateId?: string | string[] }>();
  const templateId = Array.isArray(params.templateId) ? params.templateId[0] ?? "" : params.templateId ?? "";
  const template = getCoachCommunicationTemplate(templateId);
  const locale = resolveCoachResourceLocale(i18n.language);
  const [memberships, setMemberships] = useState<TeamMembership[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [message, setMessage] = useState(() => template ? personalizeCoachTemplate(template, locale, { coachName: user?.displayName ?? undefined }) : "");
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getCurrentUserTeamMemberships().then((results) => {
      if (!active) return;
      const coachTeams = results.filter((entry) => hasCoachAccess(entry) && isTeamActive(entry.team));
      setMemberships(coachTeams);
      if (coachTeams.length === 1) setSelectedTeamId(coachTeams[0].teamId);
    });
    return () => { active = false; };
  }, []);

  const selectedMembership = memberships.find((entry) => entry.teamId === selectedTeamId) ?? null;

  useEffect(() => {
    if (!template || !selectedMembership?.team) return;
    setMessage((current) => current
      .replaceAll("{teamName}", selectedMembership.team?.name ?? "{teamName}")
      .replaceAll("{coachName}", user?.displayName ?? "{coachName}"));
  }, [selectedMembership, template, user?.displayName]);

  const unresolved = useMemo(() => findUnresolvedCoachPlaceholders(message), [message]);
  const validate = useCallback(() => {
    if (!message.trim()) {
      setValidation(t("coach.resources.messageRequired"));
      return false;
    }
    if (unresolved.length > 0) {
      setValidation(t("coach.resources.unresolvedBody", { placeholders: unresolved.map((key) => `{${key}}`).join(", ") }));
      return false;
    }
    setValidation(null);
    return true;
  }, [message, t, unresolved]);

  const shareMessage = useCallback(async () => {
    if (!validate()) return;
    try {
      const result = await Share.share({ message, title: template ? localizeCoachText(template.title, locale) : undefined });
      if (result.action === Share.sharedAction) Alert.alert(t("coach.resources.shareSuccessTitle"), t("coach.resources.shareSuccessBody"));
    } catch {
      setValidation(t("coach.resources.shareError"));
    }
  }, [locale, message, t, template, validate]);

  const sendToComposer = useCallback(() => {
    if (!validate()) return;
    if (!selectedMembership?.team) {
      setValidation(t("coach.resources.selectTeamRequired"));
      return;
    }
    router.push({
      pathname: "/coach/messages",
      params: {
        teamId: selectedMembership.teamId,
        draftTitle: template ? localizeCoachText(template.title, locale) : "",
        draftBody: message,
      },
    } as never);
  }, [locale, message, selectedMembership, t, template, validate]);

  if (!template) {
    return <ScreenWrapper><View style={styles.center}><Text style={styles.error}>{t("coach.resources.templateNotFound")}</Text></View></ScreenWrapper>;
  }

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={localizeCoachText(template.description, locale)} title={localizeCoachText(template.title, locale)} />

        {memberships.length > 0 ? (
          <Card style={styles.cardGap}>
            <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.resources.chooseTeam")}</Text>
            {memberships.map((entry) => (
              <TouchableOpacity
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedTeamId === entry.teamId }}
                key={entry.teamId}
                onPress={() => setSelectedTeamId(entry.teamId)}
                style={[styles.teamOption, selectedTeamId === entry.teamId && styles.teamOptionSelected]}
              >
                <Text style={styles.teamText}>{entry.team?.name}</Text>
              </TouchableOpacity>
            ))}
          </Card>
        ) : null}

        <Card style={styles.cardGap}>
          <Text accessibilityRole="header" style={styles.cardTitle}>{t("coach.resources.editMessage")}</Text>
          <TextInput
            accessibilityLabel={t("coach.resources.editMessage")}
            multiline
            onChangeText={(value) => { setMessage(value); setValidation(null); }}
            style={styles.editor}
            textAlignVertical="top"
            value={message}
          />
          {unresolved.length > 0 ? (
            <View accessibilityLiveRegion="polite" style={styles.unresolvedBox}>
              <Text style={styles.unresolvedTitle}>{t("coach.resources.unresolvedTitle")}</Text>
              <Text style={styles.unresolvedText}>{unresolved.map((key) => `{${key}}`).join(", ")}</Text>
            </View>
          ) : null}
          {validation ? <Text accessibilityLiveRegion="polite" style={styles.error}>{validation}</Text> : null}
          <View style={styles.actions}>
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={sendToComposer} style={styles.primaryButton}>
              <Send color={Colors.surface} size={18} />
              <Text style={styles.primaryText}>{t("coach.resources.sendToTeam")}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={() => void shareMessage()} style={styles.outlineButton}>
              <Share2 color={Colors.primary} size={18} />
              <Text style={styles.outlineText}>{t("coach.resources.shareMessage")}</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.reviewNote}>{t("coach.resources.reviewBeforeSend")}</Text>
        </Card>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center", padding: Spacing.lg },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  cardGap: { gap: Spacing.md },
  cardTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17, lineHeight: 23 },
  teamOption: { borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  teamOptionSelected: { backgroundColor: Colors.background, borderColor: Colors.primary },
  teamText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  editor: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 22, minHeight: 220, padding: Spacing.md },
  unresolvedBox: { backgroundColor: Colors.background, borderLeftColor: Colors.accentGold, borderLeftWidth: 4, gap: Spacing.xs, padding: Spacing.sm },
  unresolvedTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 13 },
  unresolvedText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19, textAlign: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", flexGrow: 1, gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", flexGrow: 1, gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  reviewNote: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18, textAlign: "center" },
});
