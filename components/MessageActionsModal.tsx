import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { X } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";

export type MessageReportReason = "privacy" | "harassment" | "offensive" | "other";

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
  report?: {
    errorMessage: string;
    onSubmit: (reason: MessageReportReason) => Promise<void>;
    successBody: string;
    successTitle: string;
  };
  visible: boolean;
};

const REPORT_REASONS: MessageReportReason[] = [
  "privacy",
  "harassment",
  "offensive",
  "other",
];

export function MessageActionsModal({ actions, onDismiss, report, visible }: Props) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"actions" | "confirmation" | "report">("actions");
  const [pendingAction, setPendingAction] = useState<MessageModalAction | null>(null);
  const [reason, setReason] = useState<MessageReportReason | null>(null);
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

  const submitReport = async () => {
    if (!report || !reason || submitting) return;
    const operationId = ++operationIdRef.current;
    setSubmitting(true);
    setError(null);
    try {
      await report.onSubmit(reason);
      if (operationIdRef.current !== operationId) return;
      onDismiss();
      Alert.alert(report.successTitle, report.successBody);
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
            <View style={styles.content}>
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
            </View>
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
  prompt: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 15, lineHeight: 22 },
  reasons: { gap: Spacing.xs },
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
