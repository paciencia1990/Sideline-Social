import * as Crypto from "expo-crypto";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, Check, Download, FileUp, Square } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Card } from "@/components/Card";
import { ScreenWrapper } from "@/components/ScreenWrapper";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  getTeamScheduleAccess,
  getTeamScheduleImportFingerprints,
  importTeamScheduleEvents,
  type ImportScheduleRow,
} from "@/services/teamScheduleService";
import {
  TEAM_SCHEDULE_MAX_CSV_BYTES,
  TEAM_SCHEDULE_SAMPLE_CSV,
  parseTeamScheduleCsv,
  type ParsedScheduleCsvRow,
} from "@/utils/teamScheduleCore";

type DocumentPickerModule = {
  getDocumentAsync: (options: Record<string, unknown>) => Promise<{
    canceled: boolean;
    assets?: { name: string; size?: number; uri: string; mimeType?: string }[];
  }>;
};

type FileSystemModule = {
  EncodingType: { UTF8: string };
  readAsStringAsync: (uri: string, options?: { encoding?: string }) => Promise<string>;
};

type PreviewRow = ParsedScheduleCsvRow & {
  selected: boolean;
  state: "valid" | "invalid" | "duplicate" | "unchanged";
};

export default function TeamScheduleImportScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = normalizeParam(params.teamId);
  const [authorized, setAuthorized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getTeamScheduleAccess(teamId)
      .then((access) => {
        if (!access.canManage || access.teamStatus !== "active") throw new Error("unauthorized");
        setAuthorized(true);
      })
      .catch(() => setError(t("schedule.errors.importUnauthorized")))
      .finally(() => setLoading(false));
  }, [t, teamId]);

  const counts = useMemo(() => rows.reduce((result, row) => ({
    ...result,
    [row.state]: result[row.state] + 1,
  }), { valid: 0, invalid: 0, duplicate: 0, unchanged: 0 }), [rows]);
  const selectedRows = useMemo(() => rows.filter((row) => row.state === "valid" && row.selected && row.draft && row.fingerprint), [rows]);

  const pickCsv = useCallback(async () => {
    if (!authorized || picking || importing) return;
    setPicking(true);
    setError(null);
    try {
      const picker = loadDocumentPicker();
      const result = await picker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) throw importError("file_unavailable");
      if (typeof asset.size === "number" && asset.size > TEAM_SCHEDULE_MAX_CSV_BYTES) throw importError("file_too_large");
      const fileSystem = loadFileSystem();
      const text = await fileSystem.readAsStringAsync(asset.uri, { encoding: fileSystem.EncodingType.UTF8 });
      if (new TextEncoder().encode(text).length > TEAM_SCHEDULE_MAX_CSV_BYTES) throw importError("file_too_large");
      const parsed = parseTeamScheduleCsv(text);
      const parsedWithFingerprints = [];
      for (const row of parsed) {
        parsedWithFingerprints.push({
          ...row,
          fingerprint: row.fingerprint
            ? await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, row.fingerprint)
            : null,
        });
      }
      const existing = await getTeamScheduleImportFingerprints(
        teamId,
        parsedWithFingerprints.flatMap((row) => row.fingerprint ? [row.fingerprint] : []),
      );
      const seen = new Set<string>();
      const preview: PreviewRow[] = [];
      for (const row of parsedWithFingerprints) {
        const hashedFingerprint = row.fingerprint;
        const duplicate = Boolean(hashedFingerprint && seen.has(hashedFingerprint));
        if (hashedFingerprint) seen.add(hashedFingerprint);
        const unchanged = Boolean(hashedFingerprint && existing.has(hashedFingerprint));
        const state: PreviewRow["state"] = row.errors.length > 0 || !row.draft
          ? "invalid"
          : duplicate
            ? "duplicate"
            : unchanged
              ? "unchanged"
              : "valid";
        preview.push({ ...row, fingerprint: hashedFingerprint, state, selected: state === "valid" });
      }
      setFileName(asset.name);
      setRows(preview);
      if (preview.length === 0) setError(t("schedule.import.emptyFile"));
    } catch (nextError) {
      const code = errorCode(nextError);
      const key = ["file_too_large", "picker_build_required", "file_unavailable"].includes(code) ? code : "readFailed";
      setError(t(`schedule.import.${key}`));
    } finally {
      setPicking(false);
    }
  }, [authorized, importing, picking, t, teamId]);

  const shareTemplate = useCallback(async () => {
    try {
      await Share.share({ message: TEAM_SCHEDULE_SAMPLE_CSV, title: t("schedule.import.templateTitle") });
    } catch {
      setError(t("schedule.import.templateShareFailed"));
    }
  }, [t]);

  const runImport = useCallback(async () => {
    if (selectedRows.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const payload: ImportScheduleRow[] = selectedRows.map((row) => ({
        rowNumber: row.rowNumber,
        draft: row.draft!,
        fingerprint: row.fingerprint!,
      }));
      const result = await importTeamScheduleEvents(teamId, payload, notifyTeam);
      Alert.alert(
        t("schedule.import.successTitle"),
        t("schedule.import.successBody", { created: result.createdCount, unchanged: result.unchangedCount }),
        [{ text: t("common.ok"), onPress: () => router.replace({ pathname: "/teams/[teamId]/schedule", params: { teamId } } as never) }],
      );
    } catch {
      setError(t("schedule.import.importFailed"));
      setImporting(false);
    }
  }, [importing, notifyTeam, selectedRows, t, teamId]);

  const confirmImport = useCallback(() => {
    if (selectedRows.length === 0 || importing) return;
    Alert.alert(t("schedule.import.confirmTitle"), t("schedule.import.confirmBody", { count: selectedRows.length }), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("schedule.import.confirmAction"), onPress: () => { void runImport(); } },
    ]);
  }, [importing, runImport, selectedRows.length, t]);

  return (
    <ScreenWrapper>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <TouchableOpacity accessibilityLabel={t("schedule.back")} accessibilityRole="button" onPress={() => router.back()} style={styles.iconButton}>
            <ArrowLeft color={Colors.textHeading} size={22} />
          </TouchableOpacity>
          <Text accessibilityRole="header" style={styles.title}>{t("schedule.import.title")}</Text>
        </View>

        <Card style={styles.actionsCard}>
          <TouchableOpacity accessibilityRole="button" onPress={() => { void shareTemplate(); }} style={styles.outlineButton}>
            <Download color={Colors.communicationLink} size={19} />
            <Text style={styles.outlineText}>{t("schedule.import.shareTemplate")}</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: picking, disabled: !authorized || picking }} disabled={!authorized || picking} onPress={() => { void pickCsv(); }} style={[styles.primaryButton, (!authorized || picking) && styles.disabled]}>
            {picking ? <ActivityIndicator color={Colors.surface} /> : <FileUp color={Colors.surface} size={19} />}
            <Text style={styles.primaryText}>{t("schedule.import.chooseFile")}</Text>
          </TouchableOpacity>
        </Card>

        {loading ? <Card style={styles.stateCard}><ActivityIndicator color={Colors.primary} /><Text style={styles.body}>{t("schedule.loading")}</Text></Card> : null}
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}

        {fileName ? (
          <Card style={styles.summaryCard}>
            <Text style={styles.fileName}>{fileName}</Text>
            <View style={styles.countRow}>
              <Count label={t("schedule.import.valid")} value={counts.valid} />
              <Count label={t("schedule.import.invalid")} value={counts.invalid} />
              <Count label={t("schedule.import.duplicate")} value={counts.duplicate} />
              <Count label={t("schedule.import.unchanged")} value={counts.unchanged} />
            </View>
          </Card>
        ) : null}

        {rows.map((row) => (
          <TouchableOpacity
            accessibilityLabel={t("schedule.import.rowAccessibility", { row: row.rowNumber, state: t(`schedule.import.states.${row.state}`) })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: row.selected, disabled: row.state !== "valid" }}
            disabled={row.state !== "valid"}
            key={`${row.rowNumber}-${row.fingerprint ?? "invalid"}`}
            onPress={() => setRows((current) => current.map((item) => item.rowNumber === row.rowNumber ? { ...item, selected: !item.selected } : item))}
          >
            <Card style={[styles.rowCard, row.state !== "valid" && styles.inactiveRow]}>
              {row.selected ? <Check color={Colors.communicationLink} size={21} /> : <Square color={Colors.textPrimary} size={21} />}
              <View style={styles.rowCopy}>
                <Text style={styles.rowTitle}>{row.draft?.title || t("schedule.import.rowNumber", { row: row.rowNumber })}</Text>
                <Text style={styles.rowMeta}>{t(`schedule.import.states.${row.state}`)}</Text>
                {row.errors.length > 0 ? <Text style={styles.rowError}>{row.errors.map((code) => t(`schedule.validation.${code}`)).join(" | ")}</Text> : null}
              </View>
            </Card>
          </TouchableOpacity>
        ))}

        {rows.length > 0 ? (
          <Card style={styles.notifyCard}>
            <View style={styles.notifyCopy}>
              <Text style={styles.notifyTitle}>{t("schedule.form.notifyTeam")}</Text>
              <Text style={styles.bodyLeft}>{t("schedule.import.notifyHelp")}</Text>
            </View>
            <Switch accessibilityLabel={t("schedule.form.notifyTeam")} onValueChange={setNotifyTeam} value={notifyTeam} trackColor={{ false: Colors.secondary, true: Colors.accentGreen }} />
          </Card>
        ) : null}

        {rows.length > 0 ? (
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: importing, disabled: importing || selectedRows.length === 0 }} disabled={importing || selectedRows.length === 0} onPress={confirmImport} style={[styles.primaryButton, (importing || selectedRows.length === 0) && styles.disabled]}>
            {importing ? <ActivityIndicator color={Colors.surface} /> : null}
            <Text style={styles.primaryText}>{t("schedule.import.importSelected", { count: selectedRows.length })}</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </ScreenWrapper>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <View style={styles.count}><Text style={styles.countValue}>{value}</Text><Text style={styles.countLabel}>{label}</Text></View>;
}

function loadDocumentPicker(): DocumentPickerModule {
  try {
    // Metro requires a literal package name while preserving deferred native-module loading.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-document-picker") as DocumentPickerModule;
  } catch {
    throw importError("picker_build_required");
  }
}

function loadFileSystem(): FileSystemModule {
  // Metro requires a literal package name for the legacy UTF-8 file reader.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-file-system/legacy") as FileSystemModule;
}

function importError(code: string) {
  const error = new Error(code);
  (error as { code?: string }).code = code;
  return error;
}

function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
}

function normalizeParam(value?: string | string[]) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xxl },
  header: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  iconButton: { alignItems: "center", backgroundColor: Colors.surface, borderRadius: 22, height: 44, justifyContent: "center", width: 44 },
  title: { color: Colors.textHeading, flex: 1, fontFamily: Typography.heading, fontSize: 27 },
  actionsCard: { flexDirection: "row", gap: Spacing.sm },
  outlineButton: { alignItems: "center", borderColor: Colors.communicationLink, borderRadius: Radius.button, borderWidth: 1, flex: 1, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.sm },
  outlineText: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 12, textAlign: "center" },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, flexDirection: "row", gap: Spacing.xs, justifyContent: "center", minHeight: 50, paddingHorizontal: Spacing.md },
  primaryText: { color: Colors.surface, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  disabled: { opacity: 0.5 },
  stateCard: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.xl },
  body: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14, textAlign: "center" },
  bodyLeft: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17 },
  error: { backgroundColor: "#F6DDDA", borderRadius: Radius.sm, color: Colors.primary, fontFamily: Typography.bodySemiBold, padding: Spacing.sm, textAlign: "center" },
  summaryCard: { gap: Spacing.sm },
  fileName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16 },
  countRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  count: { backgroundColor: Colors.background, borderRadius: Radius.sm, minWidth: 72, padding: Spacing.sm },
  countValue: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  countLabel: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 10 },
  rowCard: { alignItems: "flex-start", flexDirection: "row", gap: Spacing.sm },
  inactiveRow: { opacity: 0.68 },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  rowMeta: { color: Colors.communicationLink, fontFamily: Typography.bodyBold, fontSize: 11 },
  rowError: { color: Colors.primary, fontFamily: Typography.bodyRegular, fontSize: 11, lineHeight: 16 },
  notifyCard: { alignItems: "center", flexDirection: "row", gap: Spacing.md },
  notifyCopy: { flex: 1, gap: 3 },
  notifyTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
});
