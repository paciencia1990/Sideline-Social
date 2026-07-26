import { router } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { createTeam } from "@/services/teamService";

export default function CreateCoachTeamScreen() {
  const { t } = useTranslation();
  const { setActiveMode } = useApp();
  const [name, setName] = useState("");
  const [sport, setSport] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [division, setDivision] = useState("");
  const [season, setSeason] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (creating) return;
    if (!name.trim() || !sport.trim()) {
      setError(t("coach.team.required"));
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const team = await createTeam({ name, sport, ageRange, division, season });
      setActiveMode("coach");
      router.replace({ pathname: "/coach/team", params: { teamId: team.id } } as never);
    } catch (nextError) {
      console.warn("[CreateTeam] failed:", getErrorCode(nextError));
      setError(t("coach.team.createErrorBody"));
      setCreating(false);
    }
  }, [ageRange, creating, division, name, season, setActiveMode, sport, t]);

  return (
    <ScreenWrapper>
      <KeyboardAwareScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <TouchableOpacity accessibilityLabel={t("common.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <View style={styles.headerCopy}>
            <Text accessibilityRole="header" style={styles.title}>{t("coach.team.createTeam")}</Text>
            <Text style={styles.subtitle}>{t("coach.team.createSubtitle")}</Text>
          </View>
        </View>

        <Card style={styles.formCard}>
          <TeamField label={t("coach.team.name")} onChangeText={setName} value={name} />
          <TeamField label={t("coach.team.sport")} onChangeText={setSport} value={sport} />
          <TeamField label={t("coach.team.ageRange")} onChangeText={setAgeRange} value={ageRange} />
          <TeamField label={t("coach.team.division")} onChangeText={setDivision} value={division} />
          <TeamField label={t("coach.team.season")} onChangeText={setSeason} value={season} />
          {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
          <TouchableOpacity
            accessibilityRole="button"
            activeOpacity={0.86}
            disabled={creating}
            onPress={() => void handleCreate()}
            style={[styles.primaryButton, creating && styles.disabledButton]}
          >
            {creating ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.primaryButtonText}>{t("coach.team.createTeam")}</Text>}
          </TouchableOpacity>
        </Card>
      </KeyboardAwareScrollView>
    </ScreenWrapper>
  );
}

function TeamField({ label, onChangeText, value }: { label: string; onChangeText: (value: string) => void; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="words"
        onChangeText={onChangeText}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

function getErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  headerRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  backButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44, ...Shadow.card },
  headerCopy: { flex: 1, gap: 2 },
  title: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 30 },
  subtitle: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, lineHeight: 19 },
  formCard: { gap: Spacing.md },
  field: { gap: Spacing.xs },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  input: { backgroundColor: Colors.background, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, minHeight: 50, paddingHorizontal: Spacing.md },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, lineHeight: 20, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 50, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  disabledButton: { opacity: 0.6 },
});
