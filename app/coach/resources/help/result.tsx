import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, AppState, findNodeHandle, Share, StyleSheet, Text, TextInput, TouchableOpacity, View, type TextInputProps } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Edit3, Save, Send, Share2, ShieldAlert, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react-native";
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
  deleteCoachHelpResult,
  formatCoachHelpResultForSharing,
  getCachedCoachHelpResult,
  getSavedCoachHelpResults,
  resolveCoachResourceLocale,
  saveCoachHelpResult,
  submitCoachAiFeedback,
} from "@/services/coachResourcesService";
import {
  clearCoachAiResultReturn,
  rememberCoachAiResultReturn,
} from "@/services/systemRouteResumeService";
import type { CoachAiFeedbackRating, CoachAiFeedbackReason, CoachHelpResult } from "@/types/coachResources";
import { runCoachAiResultAction } from "@/utils/coachAiExperienceCore";

const FEEDBACK_REASONS: CoachAiFeedbackReason[] = [
  "inaccurate", "unsafe", "wrong_tone", "not_useful", "technical_problem", "other",
];

export default function CoachHelpResultScreen() {
  const { i18n, t } = useTranslation();
  const { user } = useAuth();
  const coachAiAccess = useCoachAiAccess();
  const params = useLocalSearchParams<{ requestId?: string | string[] }>();
  const requestId = Array.isArray(params.requestId) ? params.requestId[0] ?? "" : params.requestId ?? "";
  const locale = resolveCoachResourceLocale(i18n.language);
  const [result, setResult] = useState<CoachHelpResult | null>(null);
  const [loadedContext, setLoadedContext] = useState<{ locale: string; requestId: string; userId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editableText, setEditableText] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [feedbackRating, setFeedbackRating] = useState<CoachAiFeedbackRating | null>(null);
  const [feedbackReason, setFeedbackReason] = useState<CoachAiFeedbackReason | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [persistenceInFlight, setPersistenceInFlight] = useState(false);
  const resultHeadingRef = useRef<Text>(null);
  const activeResultContextKey = JSON.stringify([user?.uid ?? null, requestId, locale]);
  const activeResultContextKeyRef = useRef(activeResultContextKey);
  const resultScreenMountedRef = useRef(true);
  const persistenceInFlightRef = useRef(false);
  const pendingShareReturnRef = useRef<{ actionContextKey: string; requestId: string; userId: string } | null>(null);
  const shareBackgroundedRef = useRef(false);

  useLayoutEffect(() => {
    resultScreenMountedRef.current = true;
    activeResultContextKeyRef.current = activeResultContextKey;
    return () => { resultScreenMountedRef.current = false; };
  }, [activeResultContextKey]);

  const isActiveResultContext = useCallback((contextKey: string) => (
    resultScreenMountedRef.current && activeResultContextKeyRef.current === contextKey
  ), []);

  const beginPersistence = useCallback(() => {
    if (!resultScreenMountedRef.current || persistenceInFlightRef.current) return false;
    persistenceInFlightRef.current = true;
    setPersistenceInFlight(true);
    return true;
  }, []);

  const finishPersistence = useCallback(() => {
    persistenceInFlightRef.current = false;
    if (resultScreenMountedRef.current) setPersistenceInFlight(false);
  }, []);

  const clearPendingShareReturn = useCallback(async () => {
    const pendingReturn = pendingShareReturnRef.current;
    pendingShareReturnRef.current = null;
    shareBackgroundedRef.current = false;
    if (pendingReturn) await clearCoachAiResultReturn(pendingReturn).catch(() => undefined);
  }, []);

  useEffect(() => {
    const pendingReturn = pendingShareReturnRef.current;
    if (pendingReturn && pendingReturn.actionContextKey !== activeResultContextKey) {
      void clearPendingShareReturn();
    }
  }, [activeResultContextKey, clearPendingShareReturn]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (!pendingShareReturnRef.current) return;
      if (state !== "active") {
        shareBackgroundedRef.current = true;
        return;
      }
      if (shareBackgroundedRef.current) void clearPendingShareReturn();
    });
    return () => subscription.remove();
  }, [clearPendingShareReturn]);

  useEffect(() => {
    const userId = user?.uid;
    const nextContext = userId && requestId ? { locale, requestId, userId } : null;
    let active = true;
    setLoading(true);
    setResult(null);
    setLoadedContext(null);
    setSaved(false);
    setEditing(false);
    setEditableText("");
    setFeedback(null);
    setDeleteError(null);
    setFeedbackRating(null);
    setFeedbackReason(null);
    setFeedbackComment("");
    setSubmittingFeedback(false);
    if (!nextContext) {
      setLoading(false);
      return () => { active = false; };
    }
    void Promise.all([
      getCachedCoachHelpResult(nextContext.userId, nextContext.requestId),
      getSavedCoachHelpResults(nextContext.userId),
    ]).then(([cached, savedEntries]) => {
      if (!active) return;
      const savedEntry = savedEntries.find((entry) => entry.id === nextContext.requestId);
      const next = savedEntry?.result ?? cached ?? null;
      setResult(next);
      setSaved(Boolean(savedEntry));
      if (next) setEditableText(formatCoachHelpResultForSharing(next, nextContext.locale));
      setLoadedContext(nextContext);
      setLoading(false);
    }).catch(() => {
      if (!active) return;
      setLoadedContext(nextContext);
      setLoading(false);
    });
    return () => { active = false; };
  }, [locale, requestId, user?.uid]);

  useEffect(() => {
    if (!result || loading) return;
    const focusTimer = setTimeout(() => {
      const node = findNodeHandle(resultHeadingRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 250);
    return () => clearTimeout(focusTimer);
  }, [loading, result]);

  const applyEdit = useCallback(() => {
    if (persistenceInFlightRef.current || !result || !editableText.trim()) return;
    setResult({
      ...result,
      introduction: undefined,
      body: editableText.trim(),
      sections: undefined,
      phrasesToUse: undefined,
      phrasesToAvoid: undefined,
    });
    setEditing(false);
    setSaved(false);
    setFeedback(t("coach.resources.editApplied"));
  }, [editableText, result, t]);

  const saveResult = useCallback(async () => {
    if (!result || !user?.uid || !beginPersistence()) return;
    const actionContextKey = activeResultContextKey;
    const actionRequestId = requestId;
    const actionUserId = user.uid;
    try {
      await runCoachAiResultAction({
        clearReturn: () => clearCoachAiResultReturn({ requestId: actionRequestId, userId: actionUserId }),
        execute: () => saveCoachHelpResult(actionUserId, actionRequestId, result),
        rememberReturn: () => rememberCoachAiResultReturn({ requestId: actionRequestId, userId: actionUserId }),
      });
      if (!isActiveResultContext(actionContextKey)) return;
      setSaved(true);
      setFeedback(t("coach.resources.resultSaved"));
    } catch {
      if (isActiveResultContext(actionContextKey)) setFeedback(t("coach.resources.resultSaveError"));
    } finally {
      finishPersistence();
    }
  }, [activeResultContextKey, beginPersistence, finishPersistence, isActiveResultContext, requestId, result, t, user?.uid]);

  const confirmDelete = useCallback(() => {
    if (!user?.uid) return;
    const actionContextKey = activeResultContextKey;
    const actionRequestId = requestId;
    const actionUserId = user.uid;
    setDeleteError(null);
    Alert.alert(t("coach.resources.deleteResultTitle"), t("coach.resources.deleteResultBody"), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("coach.resources.deleteResult"), style: "destructive", onPress: () => {
        if (!isActiveResultContext(actionContextKey) || !beginPersistence()) return;
        void deleteCoachHelpResult(actionUserId, actionRequestId)
          .then(() => {
            if (isActiveResultContext(actionContextKey)) router.replace("/coach/resources/help" as never);
          })
          .catch(() => {
            if (isActiveResultContext(actionContextKey)) setDeleteError(t("coach.resources.resultDeleteError"));
          })
          .finally(finishPersistence);
      } },
    ]);
  }, [activeResultContextKey, beginPersistence, finishPersistence, isActiveResultContext, requestId, t, user?.uid]);

  const shareResult = useCallback(async () => {
    if (!result || !user?.uid) return;
    const actionContextKey = activeResultContextKey;
    const returnContext = { actionContextKey, requestId, userId: user.uid };
    try {
      await rememberCoachAiResultReturn(returnContext);
      if (!isActiveResultContext(actionContextKey)) {
        await clearCoachAiResultReturn(returnContext).catch(() => undefined);
        return;
      }
      pendingShareReturnRef.current = returnContext;
      shareBackgroundedRef.current = AppState.currentState !== "active";
    } catch {
      pendingShareReturnRef.current = null;
      shareBackgroundedRef.current = false;
    }
    if (!isActiveResultContext(actionContextKey)) return;
    try {
      const response = await Share.share({ message: formatCoachHelpResultForSharing(result, locale), title: result.title });
      if (!isActiveResultContext(actionContextKey)) {
        await clearPendingShareReturn();
        return;
      }
      if (response.action === Share.dismissedAction) await clearPendingShareReturn();
      if (response.action === Share.sharedAction) setFeedback(t("coach.resources.shareSuccessBody"));
    } catch {
      await clearPendingShareReturn();
      if (isActiveResultContext(actionContextKey)) setFeedback(t("coach.resources.shareError"));
    }
  }, [activeResultContextKey, clearPendingShareReturn, isActiveResultContext, locale, requestId, result, t, user?.uid]);

  const sendToComposer = useCallback(() => {
    if (!result?.canSendAsAnnouncement) return;
    router.push({ pathname: "/coach/messages", params: { draftTitle: result.title, draftBody: formatCoachHelpResultForSharing(result, locale) } } as never);
  }, [locale, result]);

  const sendFeedback = useCallback(async (rating: CoachAiFeedbackRating, reason?: CoachAiFeedbackReason) => {
    if (!requestId || submittingFeedback || (rating === "down" && !reason)) return;
    const actionContextKey = activeResultContextKey;
    setSubmittingFeedback(true);
    setFeedback(null);
    try {
      const feedbackResult = await submitCoachAiFeedback({
        requestId,
        rating,
        ...(reason ? { reason } : {}),
        ...(feedbackComment.trim() ? { comment: feedbackComment.trim().slice(0, 500) } : {}),
      });
      if (!isActiveResultContext(actionContextKey)) return;
      setFeedbackRating(rating);
      setFeedbackReason(reason ?? null);
      const message = reason === "unsafe"
        ? feedbackResult.moderationReceiptNumber
          ? t("coach.resources.unsafeReportThanksReceipt", { receipt: feedbackResult.moderationReceiptNumber })
          : t("coach.resources.unsafeReportThanks")
        : t("coach.resources.feedbackThanks");
      setFeedback(message);
      AccessibilityInfo.announceForAccessibility(message);
    } catch {
      if (isActiveResultContext(actionContextKey)) setFeedback(t("coach.resources.feedbackError"));
    } finally {
      if (isActiveResultContext(actionContextKey)) setSubmittingFeedback(false);
    }
  }, [activeResultContextKey, feedbackComment, isActiveResultContext, requestId, submittingFeedback, t]);

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

  const resultContextMatches = Boolean(
    loadedContext
      && user?.uid
      && loadedContext.userId === user.uid
      && loadedContext.requestId === requestId
      && loadedContext.locale === locale,
  );
  if (loading || (Boolean(user?.uid && requestId) && !resultContextMatches)) {
    return <ScreenWrapper><View style={styles.center}><Text accessibilityLiveRegion="polite" style={styles.body}>{t("common.loading")}</Text></View></ScreenWrapper>;
  }
  if (!resultContextMatches || !result) return <ScreenWrapper><View style={styles.center}><Text style={styles.error}>{t("coach.resources.resultNotFound")}</Text></View></ScreenWrapper>;

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <CoachResourceHeader subtitle={t("coach.resources.resultSubtitle")} title={result.title} titleRef={resultHeadingRef} />
        <Text style={styles.previewLabel}>{t("coach.resources.coachAiTestingPreview")}</Text>

        {editing ? (
          <Card style={styles.cardGap}>
            <CoachAiMultilineTextInput accessibilityLabel={t("coach.resources.editResult")} editable={!persistenceInFlight} onChangeText={setEditableText} style={styles.editor} textAlignVertical="top" value={editableText} />
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: persistenceInFlight }} disabled={persistenceInFlight} onPress={applyEdit} style={[styles.primaryButton, persistenceInFlight && styles.disabled]}><Save color={Colors.surface} size={18} /><Text style={styles.primaryText}>{t("coach.resources.applyEdit")}</Text></TouchableOpacity>
          </Card>
        ) : (
          <Card style={styles.cardGap}>
            {result.introduction ? <Text style={styles.body}>{result.introduction}</Text> : null}
            {result.body ? <Text style={styles.body}>{result.body}</Text> : null}
            {(result.sections ?? []).map((section) => (
              <View key={section.heading} style={styles.section}>
                <Text accessibilityRole="header" style={styles.sectionTitle}>{section.heading}</Text>
                {section.items.map((item, index) => <Text key={`${section.heading}-${index}`} style={styles.body}>{index + 1}. {item}</Text>)}
              </View>
            ))}
            {result.phrasesToUse?.length ? <ResultList items={result.phrasesToUse} title={t("coach.resources.phrasesUse")} /> : null}
            {result.phrasesToAvoid?.length ? <ResultList items={result.phrasesToAvoid} title={t("coach.resources.phrasesAvoid")} /> : null}
            {result.safetyNotice ? <Text style={styles.safety}>{result.safetyNotice}</Text> : null}
          </Card>
        )}

        <Card style={styles.feedbackCard}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>{t("coach.resources.feedbackTitle")}</Text>
          <Text style={styles.body}>{t("coach.resources.feedbackBody")}</Text>
          <View style={styles.feedbackActions}>
            <TouchableOpacity
              accessibilityLabel={t("coach.resources.feedbackHelpful")}
              accessibilityRole="button"
              accessibilityState={{ disabled: submittingFeedback, selected: feedbackRating === "up" }}
              disabled={submittingFeedback}
              onPress={() => void sendFeedback("up")}
              style={[styles.feedbackChoice, feedbackRating === "up" && styles.feedbackChoiceSelected]}
            >
              <ThumbsUp color={Colors.primary} size={20} />
              <Text style={styles.outlineText}>{t("coach.resources.feedbackHelpful")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityLabel={t("coach.resources.feedbackNotHelpful")}
              accessibilityRole="button"
              accessibilityState={{ disabled: submittingFeedback, selected: feedbackRating === "down" && feedbackReason !== "unsafe" }}
              disabled={submittingFeedback}
              onPress={() => { setFeedbackRating("down"); setFeedbackReason((current) => current === "unsafe" ? null : current); }}
              style={[styles.feedbackChoice, feedbackRating === "down" && feedbackReason !== "unsafe" && styles.feedbackChoiceSelected]}
            >
              <ThumbsDown color={Colors.primary} size={20} />
              <Text style={styles.outlineText}>{t("coach.resources.feedbackNotHelpful")}</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: submittingFeedback, selected: feedbackReason === "unsafe" }}
            disabled={submittingFeedback}
            onPress={() => { setFeedbackRating("down"); setFeedbackReason("unsafe"); }}
            style={[styles.unsafeButton, feedbackReason === "unsafe" && styles.feedbackChoiceSelected]}
          >
            <ShieldAlert color={Colors.primary} size={20} />
            <Text style={styles.outlineText}>{t("coach.resources.reportUnsafe")}</Text>
          </TouchableOpacity>
          {feedbackRating === "down" ? (
            <>
              <Text style={styles.label}>{t("coach.resources.feedbackReasonTitle")}</Text>
              <View accessibilityRole="radiogroup" style={styles.reasonList}>
                {FEEDBACK_REASONS.map((reason) => (
                  <TouchableOpacity
                    accessibilityRole="radio"
                    accessibilityState={{ checked: feedbackReason === reason, disabled: submittingFeedback }}
                    disabled={submittingFeedback}
                    key={reason}
                    onPress={() => setFeedbackReason(reason)}
                    style={[styles.reasonChoice, feedbackReason === reason && styles.reasonChoiceSelected]}
                  >
                    <Text style={[styles.reasonText, feedbackReason === reason && styles.reasonTextSelected]}>{t(`coach.resources.feedbackReasons.${reason}`)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <CoachAiMultilineTextInput
                accessibilityLabel={t("coach.resources.feedbackComment")}
                editable={!submittingFeedback}
                maxLength={500}
                onChangeText={setFeedbackComment}
                placeholder={t("coach.resources.feedbackCommentPlaceholder")}
                style={styles.feedbackInput}
                textAlignVertical="top"
                value={feedbackComment}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ busy: submittingFeedback, disabled: submittingFeedback || !feedbackReason }}
                disabled={submittingFeedback || !feedbackReason}
                onPress={() => void sendFeedback("down", feedbackReason ?? undefined)}
                style={[styles.primaryButton, (submittingFeedback || !feedbackReason) && styles.disabled]}
              >
                <Text style={styles.primaryText}>{t("coach.resources.submitFeedback")}</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </Card>

        {feedback ? <Text accessibilityLiveRegion="polite" style={styles.feedback}>{feedback}</Text> : null}
        {deleteError ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{deleteError}</Text> : null}
        <View style={styles.actions}>
          <Action disabled={persistenceInFlight} Icon={Edit3} label={t("coach.resources.editResult")} onPress={() => setEditing(true)} primary={false} />
          <Action Icon={Share2} label={t("coach.resources.shareResult")} onPress={() => void shareResult()} primary={false} />
          <Action disabled={persistenceInFlight} Icon={Save} label={saved ? t("coach.resources.saved") : t("coach.resources.saveResult")} onPress={() => void saveResult()} primary />
          {result.canSendAsAnnouncement ? <Action Icon={Send} label={t("coach.resources.sendToTeam")} onPress={sendToComposer} primary /> : null}
          {saved ? <Action disabled={persistenceInFlight} Icon={Trash2} label={t("coach.resources.deleteResult")} onPress={confirmDelete} primary={false} /> : null}
        </View>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function CoachAiMultilineTextInput({
  onContentSizeChange,
  onFocus,
  onSelectionChange,
  style,
  ...props
}: TextInputProps) {
  const inputRef = useRef<TextInput>(null);
  const multilineInputHeight = useCoachAiMultilineInputHeight();
  const requestInputReveal = useKeyboardAwareInputReveal();
  const revealInput = useCallback(() => requestInputReveal(inputRef.current), [requestInputReveal]);

  return (
    <TextInput
      {...props}
      multiline
      onContentSizeChange={(event) => {
        onContentSizeChange?.(event);
        revealInput();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        revealInput();
      }}
      onSelectionChange={(event) => {
        onSelectionChange?.(event);
        revealInput();
      }}
      ref={inputRef}
      scrollEnabled
      style={[style, { height: multilineInputHeight }]}
    />
  );
}

function ResultList({ items, title }: { items: string[]; title: string }) {
  return <View style={styles.section}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{items.map((item, index) => <Text key={`${title}-${index}`} style={styles.body}>• {item}</Text>)}</View>;
}

function Action({ disabled = false, Icon, label, onPress, primary }: { disabled?: boolean; Icon: typeof Edit3; label: string; onPress: () => void; primary: boolean }) {
  return (
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[primary ? styles.primaryButton : styles.outlineButton, disabled && styles.disabled]}>
      <Icon color={primary ? Colors.surface : Colors.primary} size={18} />
      <Text style={primary ? styles.primaryText : styles.outlineText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  unavailableContent: { gap: Spacing.lg, padding: Spacing.lg },
  backToResourcesButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 52, paddingHorizontal: Spacing.lg },
  backToResourcesText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 15, textAlign: "center" },
  center: { alignItems: "center", flex: 1, justifyContent: "center", padding: Spacing.lg },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  previewLabel: { alignSelf: "flex-start", backgroundColor: Colors.background, borderColor: Colors.accentGold, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 11, lineHeight: 16, overflow: "hidden", paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  cardGap: { gap: Spacing.md },
  section: { gap: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, lineHeight: 22 },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 22 },
  safety: { backgroundColor: Colors.background, borderLeftColor: Colors.accentGold, borderLeftWidth: 4, color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 13, lineHeight: 20, padding: Spacing.sm },
  editor: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 22, padding: Spacing.md },
  feedback: { color: Colors.accentGreen, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  feedbackCard: { gap: Spacing.md },
  feedbackActions: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  feedbackChoice: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", flexGrow: 1, gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  feedbackChoiceSelected: { backgroundColor: Colors.background, borderWidth: 2 },
  unsafeButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13, lineHeight: 19 },
  reasonList: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  reasonChoice: { borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, minHeight: 42, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  reasonChoiceSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  reasonText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13 },
  reasonTextSelected: { color: Colors.surface },
  feedbackInput: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, padding: Spacing.md },
  disabled: { opacity: 0.55 },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", flexGrow: 1, gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  outlineButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, flexDirection: "row", flexGrow: 1, gap: Spacing.sm, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  outlineText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
});
