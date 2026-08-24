import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  MODERATION_REASON_CODES,
  type ModerationReasonCode,
  type ModerationReportReceipt,
} from "@/services/moderationReportService";

export type MessageReportReason = ModerationReasonCode;

export type MessageModalAction = {
  confirmation?: {
    body: string;
    confirmLabel: string;
    title: string;
  };
  destructive?: boolean;
  errorMessage: string;
  id: string;
  label: string;
  onPress: () => Promise<void>;
};

type Props = {
  actions: MessageModalAction[];
  onDismiss: () => void;
  reactions?: {
    errorMessage: string;
    onToggle: (emoji: string) => Promise<void>;
    options: string[];
    selectedEmoji?: string | null;
  };
  report?: {
    canBlock?: boolean;
    errorMessage: string;
    onSubmit: (input: {
      blockRequested: boolean;
      explanation: string | null;
      reason: MessageReportReason;
    }) => Promise<ModerationReportReceipt>;
    successBody: string;
    successTitle: string;
  };
  visible: boolean;
};

const REPORT_REASONS: readonly MessageReportReason[] = MODERATION_REASON_CODES;

export function MessageActionsModal({ actions, onDismiss, reactions, report, visible }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"actions" | "confirmation" | "report">("actions");
  const [pendingAction, setPendingAction] = useState<MessageModalAction | null>(null);
  const [reason, setReason] = useState<MessageReportReason | null>(null);
  const [explanation, setExplanation] = useState("");
  const [blockRequested, setBlockRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleRef = useRef(visible);
  const operationIdRef = useRef(0);

  useEffect(() => {
    visibleRef.current = visible;
    if (visible) return;
    operationIdRef.current += 1;
    setPhase("actions");
    setPendingAction(null);
    setReason(null);
    setExplanation("");
    setBlockRequested(false);
    setSubmitting(false);
    setError(null);
  }, [visible]);

  const dismiss = () => {
    operationIdRef.current += 1;
    onDismiss();
  };

  const chooseAction = (action: MessageModalAction) => {
    setError(null);
    if (action.confirmation) {
      setPendingAction(action);
      setPhase("confirmation");
      return;
    }
    void runAction(action);
  };

  const runAction = async (action: MessageModalAction) => {
    if (submitting) return;
    const operationId = ++operationIdRef.current;
    setSubmitting(true);
    setError(null);
    try {
      await action.onPress();
      if (operationIdRef.current !== operationId) return;
      onDismiss();
    } catch {
      if (operationIdRef.current === operationId && visibleRef.current) setError(action.errorMessage);
    } finally {
      if (operationIdRef.current === operationId) setSubmitting(false);
    }
  };

  const toggleReaction = async (emoji: string) => {
    if (!reactions || submitting) return;
    const operationId = ++operationIdRef.current;
    setSubmitting(true);
    setError(null);
    try {
      await reactions.onToggle(emoji);
      if (operationIdRef.current !== operationId) return;
      onDismiss();
    } catch {
      if (operationIdRef.current === operationId && visibleRef.current) setError(reactions.errorMessage);
    } finally {
      if (operationIdRef.current === operationId) setSubmitting(false);
    }
  };

  const submitReport = async () => {
    if (!report || !reason || submitting) return;
    const operationId = ++operationIdRef.current;
    setSubmitting(true);
    setError(null);
    try {
      const receipt = await report.onSubmit({
        blockRequested,
        explanation: explanation.trim() || null,
        reason,
      });
      if (operationIdRef.current !== operationId) return;
      onDismiss();
      Alert.alert(
        report.successTitle,
        receipt.receiptNumber
          ? `${report.successBody}\n\n${t("moderation.receiptNumber", { receipt: receipt.receiptNumber })}`
          : report.successBody,
      );
    } catch {
      if (operationIdRef.current === operationId && visibleRef.current) setError(report.errorMessage);
    } finally {
      if (operationIdRef.current === operationId) setSubmitting(false);
    }
  };

  const title = phase === "report"
    ? t("moderation.reportMessage")
    : phase === "confirmation"
      ? pendingAction?.confirmation?.title ?? t("teamMessages.messageActions")
      : t("teamMessages.messageActions");

  return (
    <Modal
      allowSwipeDismissal
      animationType="slide"
      onRequestClose={dismiss}
      presentationStyle="overFullScreen"
      transparent
      visible={visible}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel={t("common.cancel")}
          accessibilityRole="button"
          onPress={dismiss}
          style={styles.backdropDismiss}
        />
        <View accessibilityViewIsModal style={styles.sheet}>
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <TouchableOpacity
              accessibilityLabel={t("moderation.close")}
              accessibilityRole="button"
              onPress={dismiss}
              style={styles.close}
            >
              <X accessible={false} color={Colors.textHeading} size={22} />
            </TouchableOpacity>
          </View>

          {phase === "actions" ? (
            <View style={styles.content}>
              {reactions ? (
                <View>
                  <Text style={styles.reactionTitle}>{t("chat.reactions")}</Text>
                  <View accessibilityRole="radiogroup" style={styles.reactionRow}>
                    {reactions.options.map((emoji) => {
                      const selected = reactions.selectedEmoji === emoji;
                      return (
                        <TouchableOpacity
                          accessibilityLabel={t("chat.reactWith", { emoji })}
                          accessibilityRole="button"
                          accessibilityState={{ checked: selected, disabled: submitting }}
                          disabled={submitting}
                          key={emoji}
                          onPress={() => { void toggleReaction(emoji); }}
                          style={[styles.reactionButton, selected && styles.reactionButtonSelected]}
                        >
                          <Text style={styles.reactionEmoji}>{emoji}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              {actions.map((action) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={submitting}
                  key={action.id}
                  onPress={() => chooseAction(action)}
                  style={[styles.action, action.destructive && styles.destructiveAction]}
                >
                  <Text style={[styles.actionText, action.destructive && styles.destructiveText]}>
                    {action.label}
                  </Text>
                </TouchableOpacity>
              ))}
              {report ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={submitting}
                  onPress={() => {
                    setError(null);
                    setPhase("report");
                  }}
                  style={styles.action}
                >
                  <Text style={styles.actionText}>{t("moderation.reportMessage")}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {phase === "confirmation" && pendingAction?.confirmation ? (
            <View style={styles.content}>
              <Text style={styles.prompt}>{pendingAction.confirmation.body}</Text>
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={dismiss}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ busy: submitting, disabled: submitting }}
                  disabled={submitting}
                  onPress={() => { void runAction(pendingAction); }}
                  style={[styles.primaryButton, styles.destructiveButton]}
                >
                  {submitting
                    ? <ActivityIndicator color={Colors.surface} size="small" />
                    : <Text style={styles.primaryButtonText}>{pendingAction.confirmation.confirmLabel}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          {phase === "report" ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              <Text style={styles.prompt}>{t("moderation.reportQuestion")}</Text>
              <View accessibilityRole="radiogroup" style={styles.reasons}>
                {REPORT_REASONS.map((option) => {
                  const selected = reason === option;
                  return (
                    <TouchableOpacity
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected, disabled: submitting }}
                      disabled={submitting}
                      key={option}
                      onPress={() => setReason(option)}
                      style={styles.reason}
                    >
                      <View style={[styles.radio, selected && styles.radioSelected]}>
                        {selected ? <View style={styles.radioDot} /> : null}
                      </View>
                      <Text style={styles.reasonText}>{t(`moderation.reasons.${option}`)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>{t("moderation.explanationLabel")}</Text>
              <TextInput
                accessibilityLabel={t("moderation.explanationLabel")}
                maxLength={1500}
                multiline
                onChangeText={setExplanation}
                placeholder={t("moderation.explanationPlaceholder")}
                placeholderTextColor={Colors.textPrimary}
                style={styles.explanationInput}
                textAlignVertical="top"
                value={explanation}
              />
              {report?.canBlock ? (
                <View style={styles.blockRow}>
                  <View style={styles.blockText}>
                    <Text style={styles.fieldLabel}>{t("moderation.blockNow")}</Text>
                    <Text style={styles.blockHint}>{t("moderation.blockNowHint")}</Text>
                  </View>
                  <Switch
                    accessibilityLabel={t("moderation.blockNow")}
                    disabled={submitting}
                    onValueChange={setBlockRequested}
                    value={blockRequested}
                  />
                </View>
              ) : null}
              <View style={styles.buttonRow}>
                <TouchableOpacity
                  accessibilityRole="button"
                  onPress={dismiss}
                  style={styles.secondaryButton}
                >
                  <Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityState={{ busy: submitting, disabled: !reason || submitting }}
                  disabled={!reason || submitting}
                  onPress={() => { void submitReport(); }}
                  style={[styles.primaryButton, (!reason || submitting) && styles.disabled]}
                >
                  {submitting
                    ? (
                      <View style={styles.submitting}>
                        <ActivityIndicator color={Colors.surface} size="small" />
                        <Text style={styles.primaryButtonText}>{t("moderation.submitting")}</Text>
                      </View>
                    )
                    : <Text style={styles.primaryButtonText}>{t("moderation.submitReport")}</Text>}
                  </TouchableOpacity>
              </View>
            </ScrollView>
          ) : null}

          {error ? <Text accessibilityLiveRegion="assertive" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

          {phase === "actions" ? (
            <TouchableOpacity
              accessibilityRole="button"
              onPress={dismiss}
              style={styles.cancel}
            >
              <Text style={styles.cancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "rgba(20, 18, 18, 0.48)",
    flex: 1,
    justifyContent: "flex-end",
  },
  backdropDismiss: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    gap: Spacing.md,
    maxHeight: "92%",
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    ...Shadow.card,
  },
  header: { alignItems: "center", flexDirection: "row", minHeight: 44 },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyBold, fontSize: 20 },
  close: { alignItems: "center", justifyContent: "center", minHeight: 44, minWidth: 44 },
  content: { gap: Spacing.md },
  action: {
    alignItems: "center",
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: Spacing.md,
  },
  destructiveAction: { borderColor: Colors.primary },
  actionText: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  destructiveText: { color: Colors.primary },
  reactionButton: {
    alignItems: "center",
    borderColor: Colors.secondary,
    borderRadius: 20,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  reactionButtonSelected: { backgroundColor: Colors.secondary, borderColor: Colors.primary },
  reactionEmoji: { fontSize: 22 },
  reactionRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  reactionTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, marginBottom: Spacing.sm },
  prompt: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22 },
  reasons: { gap: Spacing.xs, maxHeight: 320 },
  reason: { alignItems: "center", flexDirection: "row", gap: Spacing.sm, minHeight: 48 },
  reasonText: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyRegular, fontSize: 15 },
  radio: {
    alignItems: "center",
    borderColor: Colors.textPrimary,
    borderRadius: 10,
    borderWidth: 2,
    height: 20,
    justifyContent: "center",
    width: 20,
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: { backgroundColor: Colors.primary, borderRadius: 5, height: 10, width: 10 },
  fieldLabel: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  explanationInput: {
    borderColor: Colors.secondary,
    borderRadius: Radius.button,
    borderWidth: 1,
    color: Colors.textHeading,
    fontFamily: Typography.bodyRegular,
    minHeight: 96,
    padding: Spacing.sm,
  },
  blockRow: { alignItems: "center", flexDirection: "row", gap: Spacing.md },
  blockText: { flex: 1, gap: Spacing.xs },
  blockHint: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17 },
  buttonRow: { flexDirection: "row", gap: Spacing.sm },
  secondaryButton: {
    alignItems: "center",
    borderColor: Colors.primary,
    borderRadius: Radius.button,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: Spacing.sm,
  },
  secondaryButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  primaryButton: {
    alignItems: "center",
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: Spacing.sm,
  },
  destructiveButton: { backgroundColor: Colors.primary },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  submitting: { alignItems: "center", flexDirection: "row", gap: Spacing.xs },
  disabled: { opacity: 0.5 },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, textAlign: "center" },
  cancel: { alignItems: "center", justifyContent: "center", minHeight: 48 },
  cancelText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
});
