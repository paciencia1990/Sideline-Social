import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ChildProfilePicker } from "@/components/ChildProfilePicker";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import { setParentTeamChildLinks } from "@/services/childService";
import { getParentTeamSummary, type ParentTeamSummary } from "@/services/parentTeamService";

export default function ManageTeamChildrenScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [summary, setSummary] = useState<ParentTeamSummary | null>(null);
  const [selectedChildIds, setSelectedChildIds] = useState<string[]>([]);
  const [savedChildIds, setSavedChildIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTeam = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextSummary = await getParentTeamSummary(teamId);
      const childIds = nextSummary.children.map((child) => child.id);
      setSummary(nextSummary);
      setSelectedChildIds(childIds);
      setSavedChildIds(childIds);
    } catch (nextError) {
      console.warn("[ManageTeamChildren] load error:", getErrorCode(nextError));
      setSummary(null);
      setError(t("myTeams.teamLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t, teamId]);

  useFocusEffect(useCallback(() => {
    void loadTeam();
  }, [loadTeam]));

  const hasChanges = useMemo(
    () => normalizeIds(selectedChildIds) !== normalizeIds(savedChildIds),
    [savedChildIds, selectedChildIds],
  );

  const saveChildren = useCallback(async () => {
    if (saving || !hasChanges) return;
    setSaving(true);
    setError(null);
    try {
      await setParentTeamChildLinks(teamId, selectedChildIds);
      setSavedChildIds(selectedChildIds);
      Alert.alert(
        t("myTeams.childrenUpdatedTitle"),
        t("myTeams.childrenUpdatedBody"),
        [{ text: t("common.ok"), onPress: () => router.back() }],
      );
    } catch (nextError) {
      console.warn("[ManageTeamChildren] save error:", getErrorCode(nextError));
      setError(t("myTeams.membershipUpdateError"));
    } finally {
      setSaving(false);
    }
  }, [hasChanges, saving, selectedChildIds, t, teamId]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            accessibilityLabel={t("myTeams.back")}
            accessibilityRole="button"
            disabled={saving}
            onPress={() => router.back()}
            style={styles.backButton}
          >
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{t("myTeams.manageChildren")}</Text>
            <Text style={styles.subtitle}>{summary?.team.name ?? t("myTeams.team")}</Text>
          </View>
        </View>

        {loading ? (
          <Card style={styles.stateCard}>
            <ActivityIndicator color={Colors.primary} />
            <Text style={styles.body}>{t("myTeams.loadingChildren")}</Text>
          </Card>
        ) : null}

        {!loading && summary ? (
          <Card style={styles.card}>
            <Text style={styles.body}>{t("myTeams.manageChildrenBody")}</Text>
            <ChildProfilePicker onChange={setSelectedChildIds} selectedIds={selectedChildIds} />
            {error ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{error}</Text> : null}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={saving || !hasChanges}
              onPress={saveChildren}
              style={[styles.primaryButton, (saving || !hasChanges) && styles.disabledButton]}
            >
              {saving
                ? <><ActivityIndicator color={Colors.surface} /><Text style={styles.primaryButtonText}>{t("myTeams.saving")}</Text></>
                : <Text style={styles.primaryButtonText}>{t("myTeams.saveChildren")}</Text>}
            </TouchableOpacity>
          </Card>
        ) : null}

        {!loading && !summary ? (
          <Card style={styles.stateCard}>
            <Text style={styles.errorText}>{error ?? t("myTeams.teamLoadError")}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={loadTeam} style={styles.outlineButton}>
              <Text style={styles.outlineButtonText}>{t("myTeams.tryAgain")}</Text>
            </TouchableOpacity>
          </Card>
        ) : null}
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function normalizeIds(ids: string[]) {
  return [...ids].sort().join("|");
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  headerCopy: { flex: 1 },
  backButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 26 },
  subtitle: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  card: { gap: Spacing.md },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, lineHeight: 20 },
  errorText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold },
  outlineButton: { borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  outlineButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold },
  disabledButton: { opacity: 0.55 },
});
