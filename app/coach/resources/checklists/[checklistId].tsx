import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Check, MessageCircle } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { CoachResourceHeader } from "@/components/CoachResourceHeader";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { useAuth } from "@/context/AuthContext";
import {
  getChecklistItemIds,
  getCoachChecklist,
  getCoachChecklistProgress,
  getCoachCommunicationTemplate,
  localizeCoachText,
  resetCoachChecklistProgress,
  resolveCoachResourceLocale,
  saveCoachChecklistProgress,
} from "@/services/coachResourcesService";

export default function CoachChecklistDetailScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ checklistId?: string | string[] }>();
  const checklistId = Array.isArray(params.checklistId) ? params.checklistId[0] ?? "" : params.checklistId ?? "";
  const checklist = getCoachChecklist(checklistId);
  const locale = resolveCoachResourceLocale(i18n.language);
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [storageError, setStorageError] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    let active = true;
    if (!checklist || !user?.uid) {
      setHydrated(true);
      return;
    }
    void getCoachChecklistProgress(user.uid, checklist).then((progress) => {
      if (active) {
        setCompletedIds(progress.completedItemIds);
        setHydrated(true);
      }
    });
    return () => { active = false; };
  }, [checklist, user?.uid]);

  const persist = useCallback((next: string[]) => {
    if (!checklist || !user?.uid) return;
    saveQueue.current = saveQueue.current
      .then(() => saveCoachChecklistProgress(user.uid, checklist, next))
      .then(() => setStorageError(false))
      .catch(() => setStorageError(true));
  }, [checklist, user?.uid]);

  const toggleItem = useCallback((itemId: string) => {
    if (!hydrated) return;
    setCompletedIds((current) => {
      const next = current.includes(itemId) ? current.filter((id) => id !== itemId) : [...current, itemId];
      persist(next);
      return next;
    });
  }, [hydrated, persist]);

  const openCommunicationTemplate = useCallback((templateId: string) => {
    router.push(`/coach/resources/communication/${templateId}` as never);
  }, []);

  const confirmReset = useCallback(() => {
    if (!checklist || !user?.uid) return;
    Alert.alert(t("coach.resources.resetTitle"), t("coach.resources.resetBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("coach.resources.resetAction"), style: "destructive", onPress: () => {
          void resetCoachChecklistProgress(user.uid, checklist)
            .then(() => { setCompletedIds([]); setStorageError(false); })
            .catch(() => setStorageError(true));
        },
      },
    ]);
  }, [checklist, t, user?.uid]);

  if (!checklist) {
    return <ScreenWrapper><View style={styles.center}><Text style={styles.error}>{t("coach.resources.checklistNotFound")}</Text></View></ScreenWrapper>;
  }

  const total = getChecklistItemIds(checklist).length;
  const completed = completedIds.length;
  const isComplete = hydrated && completed === total;
  const progressPercent = total > 0 ? `${Math.round((completed / total) * 100)}%` as const : "0%";
  const resetLabel = checklist.id === "practice-day"
    ? t("coach.resources.newPractice")
    : checklist.id === "game-day"
      ? t("coach.resources.newGameDay")
      : t("coach.resources.startAgain");

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={localizeCoachText(checklist.description, locale)} title={localizeCoachText(checklist.title, locale)} />
        <Card style={styles.progressCard}>
          <Text accessibilityLiveRegion="polite" style={styles.progressText}>{t("coach.resources.progress", { completed, total })}</Text>
          <View accessibilityLabel={t("coach.resources.progress", { completed, total })} accessibilityRole="progressbar" style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: progressPercent }]} />
          </View>
          {isComplete ? <Text accessibilityLiveRegion="polite" style={styles.completeText}>{t("coach.resources.completeMessage")}</Text> : null}
          {storageError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{t("coach.resources.progressSaveError")}</Text> : null}
        </Card>

        {checklist.safetyNote ? <Card style={styles.safetyCard}><Text style={styles.safetyText}>{localizeCoachText(checklist.safetyNote, locale)}</Text></Card> : null}

        {checklist.sections.map((section) => (
          <View key={section.id} style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{localizeCoachText(section.title, locale)}</Text>
            {section.items.map((entry) => {
              const checked = completedIds.includes(entry.id);
              const template = entry.communicationTemplateId ? getCoachCommunicationTemplate(entry.communicationTemplateId) : null;
              const templateTitle = template ? localizeCoachText(template.title, locale) : "";
              const templateActionLabel = template ? t("coach.resources.openCommunicationTemplate", { title: templateTitle }) : "";
              return (
                <View key={entry.id} style={styles.itemBlock}>
                  <TouchableOpacity
                    accessibilityLabel={localizeCoachText(entry.label, locale)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    activeOpacity={0.82}
                    onPress={() => toggleItem(entry.id)}
                    style={[styles.itemRow, checked && styles.itemRowChecked]}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                      {checked ? <Check color={Colors.surface} size={18} strokeWidth={3} /> : null}
                    </View>
                    <Text style={[styles.itemText, checked && styles.itemTextChecked]}>{localizeCoachText(entry.label, locale)}</Text>
                  </TouchableOpacity>
                  {template ? (
                    <Pressable
                      accessibilityHint={t("coach.resources.openCommunicationTemplateHint")}
                      accessibilityLabel={templateActionLabel}
                      accessibilityRole="button"
                      onPress={() => openCommunicationTemplate(template.id)}
                      style={({ pressed }) => [styles.templateLink, pressed && styles.templateLinkPressed]}
                    >
                      {({ pressed }) => (
                        <>
                          <MessageCircle color={pressed ? Colors.communicationLinkPressed : Colors.communicationLink} size={16} />
                          <Text style={[styles.templateLinkText, pressed && styles.templateLinkTextPressed]}>{templateActionLabel}</Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}

        <TouchableOpacity accessibilityRole="button" activeOpacity={0.86} onPress={confirmReset} style={styles.resetButton}>
          <Text style={styles.resetText}>{resetLabel}</Text>
        </TouchableOpacity>
      </ScrollView>
    </ScreenWrapper>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", flex: 1, justifyContent: "center", padding: Spacing.lg },
  content: { gap: Spacing.lg, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  progressCard: { gap: Spacing.sm },
  progressText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  progressTrack: { backgroundColor: Colors.secondary, borderRadius: 5, height: 10, overflow: "hidden" },
  progressFill: { backgroundColor: Colors.accentGreen, borderRadius: 5, height: "100%" },
  completeText: { color: Colors.accentGreen, fontFamily: Typography.bodyBold, fontSize: 14, lineHeight: 20 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19, textAlign: "center" },
  safetyCard: { borderLeftColor: Colors.accentGold, borderLeftWidth: 4 },
  safetyText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 13, lineHeight: 20 },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 12, letterSpacing: 0.8, lineHeight: 18, textTransform: "uppercase" },
  itemBlock: { gap: Spacing.xs },
  itemRow: { alignItems: "center", backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.md, minHeight: 60, padding: Spacing.md },
  itemRowChecked: { borderColor: Colors.accentGreen },
  checkbox: { alignItems: "center", borderColor: Colors.primary, borderRadius: 6, borderWidth: 2, flexShrink: 0, height: 28, justifyContent: "center", width: 28 },
  checkboxChecked: { backgroundColor: Colors.accentGreen, borderColor: Colors.accentGreen },
  itemText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyMedium, fontSize: 14, lineHeight: 21 },
  itemTextChecked: { color: Colors.textPrimary },
  templateLink: { alignItems: "center", alignSelf: "flex-start", borderRadius: Radius.sm, flexDirection: "row", gap: Spacing.xs, marginLeft: 44, minHeight: 36, paddingHorizontal: Spacing.xs },
  templateLinkPressed: { backgroundColor: `${Colors.communicationLinkPressed}14` },
  templateLinkText: { color: Colors.communicationLink, flexShrink: 1, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 18 },
  templateLinkTextPressed: { color: Colors.communicationLinkPressed },
  resetButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  resetText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
});
