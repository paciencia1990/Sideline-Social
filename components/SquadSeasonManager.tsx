import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CalendarDays } from "lucide-react-native";
import { useTranslation } from "react-i18next";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  createSquadSeason,
  endSquadSeason,
  getSquadSeasons,
  updateSquadSeason,
  type GetSquadSeasonsResult,
  type SquadSeasonSummary,
} from "@/services/leaderboardService";

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

type FormMode = "schedule" | "startNow" | "editUpcoming" | "extend";

type SeasonForm = {
  name: string;
  startDate: string;
  endDate: string;
  timeZone: string;
};

export function SquadSeasonManager({ squadId }: { squadId: string }) {
  const { i18n, t } = useTranslation();
  const [result, setResult] = useState<GetSquadSeasonsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<FormMode | null>(null);
  const [editingSeason, setEditingSeason] = useState<SquadSeasonSummary | null>(null);
  const [form, setForm] = useState<SeasonForm>(emptyForm());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await getSquadSeasons(squadId));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [squadId]);

  useEffect(() => { void load(); }, [load]);

  const currentSeason = result?.seasons.find((season) => season.status === "active") ?? null;
  const upcomingSeasons = useMemo(
    () => result?.seasons.filter((season) => season.status === "upcoming") ?? [],
    [result?.seasons],
  );
  const closedSeasons = result?.seasons.filter((season) => season.status === "closed") ?? [];

  const openForm = useCallback((nextMode: FormMode, season?: SquadSeasonSummary) => {
    const timeZone = season?.timeZone ?? result?.timeZone ?? "";
    const startDate = season
      ? dateInTimeZone(season.startAt.toDate(), timeZone)
      : nextMode === "startNow" ? dateInputFromDate(new Date()) : dateInputFromDate(addDays(new Date(), 1));
    const endDate = season
      ? dateInTimeZone(new Date(season.endAt.toMillis() - 1), timeZone)
      : dateInputFromDate(addDays(new Date(), 90));
    setEditingSeason(season ?? null);
    setForm({ name: season?.name ?? "", startDate, endDate, timeZone });
    setMode(nextMode);
  }, [result?.timeZone]);

  const closeForm = useCallback(() => {
    if (saving) return;
    setMode(null);
    setEditingSeason(null);
  }, [saving]);

  const save = useCallback(async () => {
    if (!mode) return;
    if (form.name.trim().length < 2) {
      Alert.alert("", t("season.validationName"));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.endDate) || (mode !== "extend" && !/^\d{4}-\d{2}-\d{2}$/.test(form.startDate))) {
      Alert.alert("", t("season.validationDateFormat"));
      return;
    }
    if (!form.timeZone) {
      Alert.alert("", t("season.validationTimeZone"));
      return;
    }
    setSaving(true);
    try {
      if (mode === "schedule" || mode === "startNow") {
        await createSquadSeason({
          squadId,
          name: form.name,
          startDate: form.startDate,
          endDate: form.endDate,
          timeZone: form.timeZone,
          startNow: mode === "startNow",
        });
      } else if (editingSeason) {
        await updateSquadSeason(mode === "extend"
          ? { squadId, seasonId: editingSeason.seasonId, name: form.name, endDate: form.endDate }
          : {
              squadId,
              seasonId: editingSeason.seasonId,
              name: form.name,
              startDate: form.startDate,
              endDate: form.endDate,
              timeZone: form.timeZone,
            });
      }
      setMode(null);
      setEditingSeason(null);
      await load();
      Alert.alert("", t(mode === "schedule" ? "season.seasonScheduled" : mode === "startNow" ? "season.seasonStarted" : "season.seasonUpdated"));
    } catch (error) {
      Alert.alert(t("season.seasonActionErrorTitle"), seasonErrorMessage(error, t));
    } finally {
      setSaving(false);
    }
  }, [editingSeason, form, load, mode, squadId, t]);

  const confirmEnd = useCallback((season: SquadSeasonSummary) => {
    Alert.alert(
      t("season.endConfirmTitle", { name: season.name }),
      `${t("season.finalStandingsPreserved")} ${t("season.newStarsNoLongerCount")}`,
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("season.endSeasonNow"),
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            try {
              await endSquadSeason(squadId, season.seasonId);
              await load();
              Alert.alert("", t("season.seasonEnded"));
            } catch (error) {
              Alert.alert(t("season.seasonActionErrorTitle"), seasonErrorMessage(error, t));
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  }, [load, squadId, t]);

  if (loading) return <ActivityIndicator accessibilityLabel={t("season.loading")} color={Colors.primary} />;
  if (!result?.canManageSeasons) return null;

  const locale = i18n.language.startsWith("es") ? "es" : "en";
  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <CalendarDays color={Colors.primary} size={22} />
        <Text style={styles.title}>{t("season.manageSeason")}</Text>
      </View>

      {currentSeason ? (
        <SeasonRow label={t("season.currentSeason")} locale={locale} season={currentSeason} t={t} />
      ) : (
        <Text style={styles.muted}>{t("season.noActiveSeason")}</Text>
      )}

      {upcomingSeasons.map((season) => (
        <View key={season.seasonId} style={styles.seasonBlock}>
          <SeasonRow label={t("season.nextSeason")} locale={locale} season={season} t={t} />
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => openForm("editUpcoming", season)}
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>{t("season.editSeason")}</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={styles.actions}>
        {!currentSeason ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={saving}
            onPress={() => openForm("startNow")}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{t("season.startSeasonNow")}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={saving}
              onPress={() => openForm("extend", currentSeason)}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonText}>{t("season.extendSeason")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={saving}
              onPress={() => confirmEnd(currentSeason)}
              style={styles.destructiveButton}
            >
              <Text style={styles.destructiveButtonText}>{t("season.endSeasonNow")}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          disabled={saving}
          onPress={() => openForm("schedule")}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryButtonText}>{t("season.scheduleSeason")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.historyText}>
        {closedSeasons.length > 0
          ? t("season.pastSeasonCount", { count: closedSeasons.length })
          : t("season.noPastSeasons")}
      </Text>

      <Modal animationType="slide" onRequestClose={closeForm} transparent visible={mode !== null}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalTitle}>{t(formTitleKey(mode))}</Text>
              <Field
                label={t("season.seasonName")}
                onChangeText={(name) => setForm((value) => ({ ...value, name }))}
                placeholder={t("season.seasonNamePlaceholder")}
                value={form.name}
              />
              {mode !== "extend" ? (
                <Field
                  editable={mode !== "startNow"}
                  label={t("season.startDate")}
                  onChangeText={(startDate) => setForm((value) => ({ ...value, startDate }))}
                  placeholder="YYYY-MM-DD"
                  value={form.startDate}
                />
              ) : null}
              <Field
                label={t("season.endDate")}
                onChangeText={(endDate) => setForm((value) => ({ ...value, endDate }))}
                placeholder="YYYY-MM-DD"
                value={form.endDate}
              />
              {mode !== "extend" ? (
                <View style={styles.field}>
                  <Text style={styles.label}>{t("season.timeZone")}</Text>
                  <Text style={styles.helper}>{t("season.timeZoneHelp")}</Text>
                  <View style={styles.zoneList}>
                    {TIME_ZONES.map((timeZone) => {
                      const selected = form.timeZone === timeZone;
                      return (
                        <TouchableOpacity
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          key={timeZone}
                          onPress={() => setForm((value) => ({ ...value, timeZone }))}
                          style={[styles.zoneButton, selected && styles.zoneButtonSelected]}
                        >
                          <Text style={[styles.zoneText, selected && styles.zoneTextSelected]}>{timeZone}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              <View style={styles.modalActions}>
                <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={closeForm} style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => void save()} style={styles.primaryButton}>
                  {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>{t("common.save")}</Text>}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SeasonRow({
  label,
  locale,
  season,
  t,
}: {
  label: string;
  locale: string;
  season: SquadSeasonSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const range = formatSeasonRange(season, locale);
  return (
    <View accessible accessibilityLabel={`${label}. ${season.name}. ${t(`season.status.${season.status}`)}. ${range}.`} style={styles.seasonRow}>
      <Text style={styles.eyebrow}>{label}</Text>
      <Text style={styles.seasonName}>{season.name}</Text>
      <Text style={styles.seasonDates}>{range}</Text>
      <Text style={styles.statusText}>{t(`season.status.${season.status}`)}</Text>
    </View>
  );
}

function Field(props: {
  editable?: boolean;
  label: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        autoCapitalize="sentences"
        editable={props.editable !== false}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.textPrimary}
        style={[styles.input, props.editable === false && styles.inputDisabled]}
        value={props.value}
      />
    </View>
  );
}

function formTitleKey(mode: FormMode | null) {
  if (mode === "schedule") return "season.scheduleSeason";
  if (mode === "startNow") return "season.startSeasonNow";
  if (mode === "extend") return "season.extendSeason";
  return "season.editSeason";
}

function seasonErrorMessage(error: unknown, t: (key: string) => string) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  const message = typeof error === "object" && error && "message" in error ? String(error.message) : "";
  if (code.includes("already-exists") || message.includes("overlap")) return t("season.datesOverlap");
  if (message.includes("past")) return t("season.startDatePast");
  if (message.includes("after the start")) return t("season.endAfterStart");
  if (code.includes("permission-denied")) return t("season.adminOnly");
  return t("season.seasonActionErrorBody");
}

function formatSeasonRange(season: SquadSeasonSummary, locale: string) {
  const formatter = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year: "numeric", timeZone: season.timeZone });
  return `${formatter.format(season.startAt.toDate())} – ${formatter.format(new Date(season.endAt.toMillis() - 1))}`;
}

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function dateInputFromDate(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function emptyForm(): SeasonForm {
  return { name: "", startDate: "", endDate: "", timeZone: "" };
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, gap: Spacing.md, ...Shadow.card },
  titleRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  title: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 17 },
  muted: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 14 },
  seasonBlock: { borderTopColor: `${Colors.secondary}66`, borderTopWidth: 1, paddingTop: Spacing.sm },
  seasonRow: { gap: 3 },
  eyebrow: { color: Colors.primary, fontFamily: Typography.bodyBold, fontSize: 11, textTransform: "uppercase" },
  seasonName: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 16, flexShrink: 1 },
  seasonDates: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 13, flexShrink: 1 },
  statusText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  actions: { gap: Spacing.sm },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: "#FFFFFF", fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  secondaryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  secondaryButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  destructiveButton: { alignItems: "center", borderColor: "#B42318", borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 46, paddingHorizontal: Spacing.md },
  destructiveButtonText: { color: "#B42318", fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  linkButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  linkText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textDecorationLine: "underline" },
  historyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  modalBackdrop: { backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "flex-end" },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, maxHeight: "92%" },
  form: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.xl },
  modalTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 24, flexShrink: 1 },
  field: { gap: Spacing.xs },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  helper: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  input: { borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, minHeight: 48, paddingHorizontal: Spacing.md },
  inputDisabled: { backgroundColor: `${Colors.secondary}33` },
  zoneList: { gap: Spacing.xs },
  zoneButton: { borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.sm },
  zoneButtonSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  zoneText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13, flexShrink: 1 },
  zoneTextSelected: { color: "#FFFFFF" },
  modalActions: { gap: Spacing.sm },
});
