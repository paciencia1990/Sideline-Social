import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { SettingsBackButton } from "@/components/SettingsBackButton";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { blockFriendChatUser } from "@/services/chatService";
import {
  listMyModerationReports,
  MODERATION_REASON_CODES,
  submitModerationReport,
  type ModerationReasonCode,
  type MyModerationReport,
} from "@/services/moderationReportService";

export default function SafetyScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{
    conversationId?: string | string[];
    reportedUserId?: string | string[];
  }>();
  const reportedUserId = singleParam(params.reportedUserId);
  const conversationId = singleParam(params.conversationId);
  const [reason, setReason] = useState<ModerationReasonCode | null>(null);
  const [explanation, setExplanation] = useState("");
  const [blockRequested, setBlockRequested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reports, setReports] = useState<MyModerationReport[]>([]);

  const refreshReports = useCallback(async () => {
    setLoadingReports(true);
    try {
      setReports(await listMyModerationReports());
    } catch {
      setReports([]);
    } finally {
      setLoadingReports(false);
    }
  }, []);

  useEffect(() => {
    void refreshReports();
  }, [refreshReports]);

  const canSubmit = useMemo(() => {
    if (!reason || submitting) return false;
    return Boolean(reportedUserId) || explanation.trim().length >= 20;
  }, [explanation, reason, reportedUserId, submitting]);

  const submit = useCallback(async () => {
    if (!reason || !canSubmit) return;
    setSubmitting(true);
    try {
      const receipt = await submitModerationReport({
        blockRequested,
        explanation,
        reason,
        target: reportedUserId
          ? { type: "userProfile", reportedUserId, ...(conversationId ? { conversationId } : {}) }
          : { type: "conduct" },
      });
      let blockWarning = false;
      if (blockRequested && reportedUserId) {
        try {
          await blockFriendChatUser(reportedUserId);
        } catch {
          blockWarning = true;
        }
      }
      setReason(null);
      setExplanation("");
      setBlockRequested(false);
      await refreshReports();
      Alert.alert(
        t("moderation.reportSentTitle"),
        t(blockWarning ? "moderation.reportSentBlockFailed" : "moderation.reportSentReceipt", {
          receipt: receipt.receiptNumber,
        }),
      );
    } catch {
      Alert.alert(t("moderation.reportErrorTitle"), t("moderation.reportError"));
    } finally {
      setSubmitting(false);
    }
  }, [blockRequested, canSubmit, conversationId, explanation, reason, refreshReports, reportedUserId, t]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content}>
        <SettingsBackButton />
        <View style={styles.heading}>
          <Text style={styles.title}>{t("moderation.safetyCenter")}</Text>
          <Text style={styles.body}>
            {t(reportedUserId ? "moderation.profileReportBody" : "moderation.conductReportBody")}
          </Text>
        </View>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t("moderation.chooseReason")}</Text>
          <View style={styles.reasons}>
            {MODERATION_REASON_CODES.map((code) => {
              const selected = reason === code;
              return (
                <TouchableOpacity
                  key={code}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  onPress={() => setReason(code)}
                  style={[styles.reason, selected && styles.reasonSelected]}
                >
                  <Text style={[styles.reasonText, selected && styles.reasonTextSelected]}>
                    {t(`moderation.reasons.${code}`)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.label}>{t("moderation.explanationLabel")}</Text>
          <TextInput
            accessibilityLabel={t("moderation.explanationLabel")}
            maxLength={1000}
            multiline
            onChangeText={setExplanation}
            placeholder={t(reportedUserId ? "moderation.explanationOptional" : "moderation.explanationRequired")}
            placeholderTextColor={Colors.textPrimary}
            style={styles.input}
            value={explanation}
          />
          {!reportedUserId && explanation.trim().length < 20 ? (
            <Text style={styles.hint}>{t("moderation.conductMinimum")}</Text>
          ) : null}
          {reportedUserId ? (
            <View style={styles.switchRow}>
              <View style={styles.grow}>
                <Text style={styles.label}>{t("moderation.blockNow")}</Text>
                <Text style={styles.hint}>{t("moderation.blockNowHint")}</Text>
              </View>
              <Switch
                accessibilityLabel={t("moderation.blockNow")}
                onValueChange={setBlockRequested}
                trackColor={{ false: Colors.secondary, true: Colors.primary }}
                value={blockRequested}
              />
            </View>
          ) : null}
          <PrimaryButton
            disabled={!canSubmit}
            loading={submitting}
            onPress={() => void submit()}
            title={t("moderation.submitReport")}
          />
          <Text style={styles.privacy}>{t("moderation.reportPrivacyNotice")}</Text>
        </Card>

        <Card style={styles.card}>
          <Text style={styles.sectionTitle}>{t("moderation.myReports")}</Text>
          {loadingReports ? <Text style={styles.body}>{t("common.loading")}</Text> : null}
          {!loadingReports && reports.length === 0 ? <Text style={styles.body}>{t("moderation.noReports")}</Text> : null}
          {reports.map((report) => (
            <View key={report.reportId} style={styles.reportRow}>
              <View style={styles.grow}>
                <Text style={styles.reportReceipt}>{report.receiptNumber ?? t("moderation.receiptUnavailable")}</Text>
                <Text style={styles.hint}>{t(`moderation.reasons.${report.reason}`)}</Text>
              </View>
              <Text style={styles.status}>{t(`moderation.status.${report.reporterVisibleStatus}`)}</Text>
            </View>
          ))}
        </Card>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function singleParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const styles = StyleSheet.create({
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, lineHeight: 21 },
  card: { gap: Spacing.md },
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  grow: { flex: 1 },
  heading: { gap: Spacing.xs },
  hint: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 96, padding: Spacing.md, textAlignVertical: "top" },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  privacy: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  reason: { borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  reasonSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  reasonText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13 },
  reasonTextSelected: { color: "#FFFFFF" },
  reasons: { gap: Spacing.xs },
  reportReceipt: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  reportRow: { alignItems: "center", borderTopColor: Colors.secondary, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: Spacing.sm, paddingTop: Spacing.sm },
  sectionTitle: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  status: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  switchRow: { alignItems: "center", flexDirection: "row", gap: Spacing.md },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
});
