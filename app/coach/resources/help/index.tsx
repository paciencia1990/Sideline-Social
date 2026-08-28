import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { ChevronDown, ChevronRight, ShieldAlert } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import {
  KeyboardAwareScrollView,
  useCoachAiMultilineInputHeight,
  useKeyboardAwareInputReveal,
} from "@/components/CoachAiKeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import { useCoachAiAccess } from "@/hooks/useCoachAiAccess";
import {
  acceptCoachAiDisclosure,
  cacheGeneratedCoachHelpResult,
  generateCoachResourceHelp,
  hasAcceptedCoachAiDisclosure,
  getSavedCoachHelpResults,
  resolveCoachResourceLocale,
} from "@/services/coachResourcesService";
import type { CoachHelpCategory, CoachHelpRequest, CoachHelpTone, SavedCoachHelpResult } from "@/types/coachResources";
import { CoachAiRequestError } from "@/utils/coachAiErrors";
import { toggleCoachAiSavedExpanded } from "@/utils/coachAiExperienceCore";

const CATEGORIES: CoachHelpCategory[] = [
  "practice_plan", "parent_message", "parent_concern", "player_behavior", "discouraged_player",
  "team_culture", "child_explanation", "game_day", "other",
];
const TONES: CoachHelpTone[] = ["warm", "direct", "encouraging", "neutral"];

export default function CoachResourceHelpScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const coachAiAccess = useCoachAiAccess();
  const locale = resolveCoachResourceLocale(i18n.language);
  const [category, setCategory] = useState<CoachHelpCategory | null>(null);
  const [sport, setSport] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [situation, setSituation] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [tone, setTone] = useState<CoachHelpTone>("warm");
  const [practiceMinutes, setPracticeMinutes] = useState("");
  const [playerCount, setPlayerCount] = useState("");
  const [equipment, setEquipment] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryRequest, setRetryRequest] = useState<CoachHelpRequest | null>(null);
  const [saved, setSaved] = useState<SavedCoachHelpResult[]>([]);
  const [savedOwnerId, setSavedOwnerId] = useState<string | null>(null);
  const [savedExpanded, setSavedExpanded] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState<boolean | null>(null);
  const [disclosureError, setDisclosureError] = useState(false);
  const generationToken = useRef(0);
  const generationInFlight = useRef(false);

  useLayoutEffect(() => {
    generationToken.current += 1;
    generationInFlight.current = false;
    setCategory(null);
    setSport("");
    setAgeGroup("");
    setSituation("");
    setDesiredOutcome("");
    setTone("warm");
    setPracticeMinutes("");
    setPlayerCount("");
    setEquipment("");
    setGenerating(false);
    setError(null);
    setRetryRequest(null);
    return () => {
      generationToken.current += 1;
      generationInFlight.current = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    setDisclosureAccepted(null);
    setDisclosureError(false);
    setSaved([]);
    setSavedOwnerId(null);
    setSavedExpanded(false);
  }, [user?.uid]);

  useFocusEffect(useCallback(() => {
    const userId = user?.uid;
    let active = true;
    generationInFlight.current = false;
    setGenerating(false);
    setSaved([]);
    setSavedOwnerId(null);
    setSavedExpanded(false);
    if (!userId) return () => {
      active = false;
      generationToken.current += 1;
    };
    void getSavedCoachHelpResults(userId).then((entries) => {
      if (active) {
        setSaved(entries);
        setSavedOwnerId(userId);
      }
    }).catch(() => {
      if (active) {
        setSaved([]);
        setSavedOwnerId(userId);
      }
    });
    void hasAcceptedCoachAiDisclosure(userId).then((accepted) => {
      if (active) setDisclosureAccepted(accepted);
    }).catch(() => {
      if (active) setDisclosureAccepted(false);
    });
    return () => {
      active = false;
      generationToken.current += 1;
      generationInFlight.current = false;
    };
  }, [user?.uid]));

  const acceptDisclosure = useCallback(async () => {
    if (!user?.uid) return;
    setDisclosureError(false);
    try {
      await acceptCoachAiDisclosure(user.uid);
      setDisclosureAccepted(true);
      AccessibilityInfo.announceForAccessibility(t("coach.resources.aiDisclosureAccepted"));
    } catch {
      setDisclosureError(true);
    }
  }, [t, user?.uid]);

  const generate = useCallback(async (requestToRetry?: CoachHelpRequest) => {
    if (!user?.uid || !category || generationInFlight.current || !coachAiAccess.canRequest) return;
    let request = requestToRetry;
    if (!request) {
      const trimmedSituation = situation.trim();
      if (trimmedSituation.length < 10) {
        setError(t("coach.resources.helpSituationRequired"));
        setRetryRequest(null);
        return;
      }
      request = {
        category,
        situation: trimmedSituation.slice(0, 1500),
        clientRequestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        locale,
        ...(sport.trim() ? { sport: sport.trim().slice(0, 80) } : {}),
        ...(ageGroup.trim() ? { ageGroup: ageGroup.trim().slice(0, 80) } : {}),
        ...(desiredOutcome.trim() ? { desiredOutcome: desiredOutcome.trim().slice(0, 500) } : {}),
        ...(!["practice_plan"].includes(category) ? { tone } : {}),
        ...(practiceMinutes ? { practiceMinutes: Number(practiceMinutes) } : {}),
        ...(playerCount ? { playerCount: Number(playerCount) } : {}),
        ...(equipment.trim() ? { equipment: equipment.split(",").map((entry) => entry.trim()).filter(Boolean).slice(0, 12) } : {}),
      };
    }
    const operationToken = ++generationToken.current;
    generationInFlight.current = true;
    setGenerating(true);
    setError(null);
    setRetryRequest(request);
    try {
      const result = await generateCoachResourceHelp(request);
      if (operationToken !== generationToken.current) return;
      await cacheGeneratedCoachHelpResult(user.uid, request.clientRequestId, result);
      if (operationToken !== generationToken.current) return;
      setRetryRequest(null);
      router.push({ pathname: "/coach/resources/help/result", params: { requestId: request.clientRequestId } } as never);
    } catch (requestError) {
      if (operationToken !== generationToken.current) return;
      const kind = requestError instanceof CoachAiRequestError ? requestError.kind : "unknown";
      setError(t(`coach.resources.helpErrors.${kind}`));
    } finally {
      if (operationToken === generationToken.current) {
        generationInFlight.current = false;
        setGenerating(false);
      }
    }
  }, [ageGroup, category, coachAiAccess.canRequest, desiredOutcome, equipment, locale, playerCount, practiceMinutes, situation, sport, t, tone, user?.uid]);

  const cancelGeneration = useCallback(() => {
    if (!generationInFlight.current) return;
    generationToken.current += 1;
    generationInFlight.current = false;
    setGenerating(false);
    setError(t("coach.resources.helpCanceled"));
  }, [t]);

  if (!coachAiAccess.canView) {
    return (
      <ScreenWrapper>
        <View style={styles.unavailableContent}>
          <CoachResourceHeader subtitle={t("coach.resources.coachAiUnavailableBody")} title={t("coach.resources.coachAiUnavailableTitle")} />
          <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/coach/resources" as never)} style={styles.backToResourcesButton}>
            <Text style={styles.backToResourcesText}>{t("coach.resources.backToResources")}</Text>
          </TouchableOpacity>
        </View>
      </ScreenWrapper>
    );
  }

  if (disclosureAccepted !== true) {
    return (
      <ScreenWrapper>
        <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <CoachResourceHeader subtitle={t("coach.resources.aiDisclosureSubtitle")} title={t("coach.resources.aiDisclosureTitle")} />
          <Card style={styles.disclosureCard}>
            <Text style={styles.reminderText}>{t("coach.resources.aiDisclosureBody")}</Text>
            <Text style={styles.reminderText}>{t("coach.resources.aiDisclosurePrivacy")}</Text>
            <Text style={styles.reminderText}>{t("coach.resources.aiDisclosureStorage")}</Text>
          </Card>
          {disclosureError ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{t("coach.resources.aiDisclosureError")}</Text> : null}
          <TouchableOpacity accessibilityRole="button" disabled={disclosureAccepted === null} onPress={() => void acceptDisclosure()} style={[styles.generateButton, disclosureAccepted === null && styles.disabled]}>
            {disclosureAccepted === null ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.generateText}>{t("coach.resources.aiDisclosureContinue")}</Text>}
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" onPress={() => router.replace("/coach/resources" as never)} style={styles.backStepButton}>
            <Text style={styles.backStepText}>{t("coach.resources.backToResources")}</Text>
          </TouchableOpacity>
        </KeyboardAwareScrollView>
      </ScreenWrapper>
    );
  }

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={t("coach.resources.helpSubtitle")} title={t("coach.resources.needHelp")} />
        <Text style={styles.previewLabel}>{t("coach.resources.coachAiTestingPreview")}</Text>

        {!category ? (
          <>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t("coach.resources.helpQuestion")}</Text>
            <View style={styles.categoryList}>
              {CATEGORIES.map((entry) => (
                <TouchableOpacity accessibilityRole="button" key={entry} onPress={() => { setCategory(entry); setError(null); setRetryRequest(null); }} style={styles.categoryRow}>
                  <Text style={styles.categoryText}>{t(`coach.resources.helpCategories.${entry}`)}</Text>
                  <ChevronRight color={Colors.textHeading} size={20} />
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.savedSection}>
              <TouchableOpacity
                accessibilityHint={t(savedExpanded ? "coach.resources.savedCollapseHint" : "coach.resources.savedExpandHint")}
                accessibilityLabel={t("coach.resources.savedHelp")}
                accessibilityRole="button"
                accessibilityState={{ expanded: savedExpanded }}
                onPress={() => setSavedExpanded(toggleCoachAiSavedExpanded)}
                style={styles.savedHeader}
              >
                <Text accessibilityRole="header" style={styles.sectionTitle}>{t("coach.resources.savedHelp")}</Text>
                {savedExpanded
                  ? <ChevronDown color={Colors.textHeading} size={20} />
                  : <ChevronRight color={Colors.textHeading} size={20} />}
              </TouchableOpacity>
              {savedExpanded ? (
                <View style={styles.savedList}>
                  {savedOwnerId === user?.uid && saved.length > 0 ? saved.map((entry) => (
                    <TouchableOpacity accessibilityRole="button" key={entry.id} onPress={() => router.push({ pathname: "/coach/resources/help/result", params: { requestId: entry.id } } as never)} style={styles.categoryRow}>
                      <Text style={styles.categoryText}>{entry.result.title}</Text>
                      <ChevronRight color={Colors.textHeading} size={20} />
                    </TouchableOpacity>
                  )) : (
                    <Text accessibilityLiveRegion="polite" style={styles.savedEmptyText}>{t("coach.resources.savedEmpty")}</Text>
                  )}
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <Card style={styles.reminderCard}>
              <ShieldAlert color={Colors.accentGold} size={22} />
              <Text style={styles.reminderText}>{t("coach.resources.privacyReminder")}</Text>
            </Card>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t(`coach.resources.helpCategories.${category}`)}</Text>

            {category === "practice_plan" ? (
              <>
                <Field label={t("coach.resources.fields.sport")} maxLength={80} onChangeText={setSport} value={sport} />
                <Field label={t("coach.resources.fields.ageGroup")} maxLength={80} onChangeText={setAgeGroup} value={ageGroup} />
                <Field keyboardType="number-pad" label={t("coach.resources.fields.practiceMinutes")} maxLength={3} onChangeText={setPracticeMinutes} value={practiceMinutes} />
                <Field keyboardType="number-pad" label={t("coach.resources.fields.playerCount")} maxLength={3} onChangeText={setPlayerCount} value={playerCount} />
                <Field label={t("coach.resources.fields.skillFocus")} maxLength={1500} multiline onChangeText={setSituation} value={situation} />
                <Field label={t("coach.resources.fields.equipment")} maxLength={300} onChangeText={setEquipment} value={equipment} />
              </>
            ) : (
              <>
                {!["parent_message", "parent_concern", "team_culture"].includes(category) ? <Field label={t("coach.resources.fields.ageGroup")} maxLength={80} onChangeText={setAgeGroup} value={ageGroup} /> : null}
                {category === "game_day" || category === "child_explanation" ? <Field label={t("coach.resources.fields.sport")} maxLength={80} onChangeText={setSport} value={sport} /> : null}
                <Field label={t(`coach.resources.situationLabels.${category}`)} maxLength={1500} multiline onChangeText={setSituation} value={situation} />
                <Field label={t("coach.resources.fields.desiredOutcome")} maxLength={500} multiline onChangeText={setDesiredOutcome} value={desiredOutcome} />
                <Text style={styles.label}>{t("coach.resources.fields.tone")}</Text>
                <View accessibilityRole="radiogroup" style={styles.tones}>
                  {TONES.map((entry) => (
                    <TouchableOpacity accessibilityRole="radio" accessibilityState={{ checked: tone === entry }} key={entry} onPress={() => setTone(entry)} style={[styles.tone, tone === entry && styles.toneSelected]}>
                      <Text style={[styles.toneText, tone === entry && styles.toneTextSelected]}>{t(`coach.resources.tones.${entry}`)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
            {error && retryRequest && !generating ? (
              <TouchableOpacity accessibilityRole="button" onPress={() => void generate(retryRequest)} style={styles.retryButton}>
                <Text style={styles.retryText}>{t("coach.resources.retryHelp")}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: generating, disabled: generating }} disabled={generating} onPress={() => void generate()} style={[styles.generateButton, generating && styles.disabled]}>
              {generating ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.generateText}>{t("coach.resources.generateHelp")}</Text>}
            </TouchableOpacity>
            {generating ? <Text accessibilityLiveRegion="polite" style={styles.loadingText}>{t("coach.resources.generating")}</Text> : null}
            {generating ? (
              <TouchableOpacity accessibilityRole="button" onPress={cancelGeneration} style={styles.backStepButton}>
                <Text style={styles.backStepText}>{t("coach.resources.cancelGeneration")}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity accessibilityRole="button" disabled={generating} onPress={() => { setCategory(null); setError(null); }} style={styles.backStepButton}>
              <Text style={styles.backStepText}>{t("coach.resources.chooseDifferentSituation")}</Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function Field({ keyboardType, label, maxLength, multiline, onChangeText, value }: {
  keyboardType?: "default" | "number-pad"; label: string; maxLength: number; multiline?: boolean; onChangeText: (value: string) => void; value: string;
}) {
  const inputRef = useRef<TextInput>(null);
  const multilineInputHeight = useCoachAiMultilineInputHeight();
  const requestInputReveal = useKeyboardAwareInputReveal();
  const revealInput = useCallback(() => requestInputReveal(inputRef.current), [requestInputReveal]);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        keyboardType={keyboardType}
        maxLength={maxLength}
        multiline={multiline}
        onChangeText={(text) => {
          onChangeText(text);
          if (multiline) revealInput();
        }}
        onContentSizeChange={multiline ? revealInput : undefined}
        onFocus={revealInput}
        onSelectionChange={multiline ? revealInput : undefined}
        ref={inputRef}
        scrollEnabled={multiline ? true : undefined}
        style={[styles.input, multiline && styles.textarea, multiline && { height: multilineInputHeight }]}
        textAlignVertical={multiline ? "top" : "center"}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  unavailableContent: { gap: Spacing.lg, padding: Spacing.lg },
  backToResourcesButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 52, paddingHorizontal: Spacing.lg },
  backToResourcesText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 15, textAlign: "center" },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  previewLabel: { alignSelf: "flex-start", backgroundColor: Colors.background, borderColor: Colors.accentGold, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 11, lineHeight: 16, overflow: "hidden", paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, lineHeight: 24 },
  categoryList: { gap: Spacing.sm },
  categoryRow: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, minHeight: 58, padding: Spacing.md },
  categoryText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodySemiBold, fontSize: 14, lineHeight: 20 },
  savedSection: { gap: Spacing.sm, paddingTop: Spacing.md },
  savedHeader: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 52, paddingHorizontal: Spacing.md },
  savedList: { gap: Spacing.sm },
  savedEmptyText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 13, lineHeight: 20, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  reminderCard: { alignItems: "flex-start", borderLeftColor: Colors.accentGold, borderLeftWidth: 4, flexDirection: "row", gap: Spacing.sm },
  disclosureCard: { borderLeftColor: Colors.accentGold, borderLeftWidth: 4, gap: Spacing.md },
  reminderText: { color: Colors.textPrimary, flex: 1, fontFamily: Typography.bodyMedium, fontSize: 13, lineHeight: 20 },
  field: { gap: Spacing.xs },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
  input: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 50, paddingHorizontal: Spacing.md },
  textarea: { paddingTop: Spacing.md },
  tones: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  tone: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexGrow: 1, justifyContent: "center", minHeight: 44, paddingHorizontal: Spacing.sm },
  toneSelected: { backgroundColor: Colors.primary },
  toneText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  toneTextSelected: { color: Colors.surface },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19, textAlign: "center" },
  retryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.lg },
  retryText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  generateButton: { alignItems: "center", backgroundColor: Colors.textHeading, borderRadius: Radius.button, justifyContent: "center", minHeight: 52, paddingHorizontal: Spacing.lg },
  generateText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 15, textAlign: "center" },
  loadingText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 13, textAlign: "center" },
  disabled: { opacity: 0.65 },
  backStepButton: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  backStepText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
});
