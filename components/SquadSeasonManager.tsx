import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { CalendarDays } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Colors, Radius, Shadow, Spacing, Typography } from "@/constants/theme";
import {
  createSquadSeason,
  endSquadSeason,
  getSquadSeasons,
  updateSquadSeason,
  type GetSquadSeasonsResult,
  type SquadSeasonSummary,
} from "@/services/leaderboardService";
import { getFixedFooterBottomPadding } from "@/utils/safeAreaLayout";
import {
  getSeasonDatePickerCapability,
  openSeasonAndroidDatePicker,
  type SeasonDatePickerCapability,
  type SeasonDatePickerIssue,
} from "@/services/seasonDatePickerCapability";
import {
  createSeasonDateField,
  DEFAULT_SQUAD_TIME_ZONE,
  formatSeasonDateRange,
  formatSpokenDateKey,
  isValidIanaTimeZone,
  localDateToDateKey,
  normalizeDateKey,
  type SeasonDateField,
} from "@/utils/squadSeasonDate";

const TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

type FormMode = "schedule" | "startNow" | "editUpcoming" | "extend";
type PickerField = "startDate" | "endDate";

type SeasonForm = {
  name: string;
  startDate: SeasonDateField;
  endDate: SeasonDateField;
  timeZone: string;
  idempotencyKey: string;
};

export function SquadSeasonManager({ squadId }: { squadId: string }) {
  const { i18n, t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [result, setResult] = useState<GetSquadSeasonsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<FormMode | null>(null);
  const [editingSeason, setEditingSeason] = useState<SquadSeasonSummary | null>(null);
  const [form, setForm] = useState<SeasonForm>(emptyForm());
  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [pickerDraft, setPickerDraft] = useState<Date>(new Date());
  const [pickerCapability, setPickerCapability] = useState<SeasonDatePickerCapability | null>(null);
  const [pickerIssue, setPickerIssue] = useState<SeasonDatePickerIssue | null>(null);
  const [dateInstruction, setDateInstruction] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const androidPickerOpenRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setResult(await getSquadSeasons(squadId));
    } catch {
      setLoadError(true);
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
  const listedSeasonIds = useMemo(
    () => new Set([currentSeason?.seasonId, ...upcomingSeasons.map((season) => season.seasonId)].filter(Boolean)),
    [currentSeason?.seasonId, upcomingSeasons],
  );
  const unavailableSeasons = useMemo(
    () => result?.seasons.filter((season) => !season.detailsAvailable && !listedSeasonIds.has(season.seasonId)) ?? [],
    [listedSeasonIds, result?.seasons],
  );
  const closedSeasons = result?.seasons.filter((season) => season.status === "closed") ?? [];

  const openForm = useCallback((nextMode: FormMode, season?: SquadSeasonSummary) => {
    const requestedTimeZone = season?.timeZone ?? result?.timeZone ?? DEFAULT_SQUAD_TIME_ZONE;
    const timeZone = isValidIanaTimeZone(requestedTimeZone) ? requestedTimeZone : DEFAULT_SQUAD_TIME_ZONE;
    const today = new Date();
    const defaultStart = nextMode === "startNow" ? today : addDays(today, 1);
    const defaultEnd = addDays(today, 90);
    setEditingSeason(season ?? null);
    setForm({
      name: season?.name ?? "",
      startDate: createSeasonDateField(season?.startDateKey ?? localDateToDateKey(defaultStart)),
      endDate: createSeasonDateField(season?.endDateKey ?? localDateToDateKey(defaultEnd)),
      timeZone,
      idempotencyKey: createSeasonRequestId(),
    });
    setDateInstruction(null);
    setPickerField(null);
    setPickerIssue(null);
    setMode(nextMode);
  }, [result?.timeZone]);

  const closeForm = useCallback(() => {
    if (saving) return;
    if (pickerField) {
      setPickerField(null);
      return;
    }
    setMode(null);
    setEditingSeason(null);
    setForm(emptyForm());
    setDateInstruction(null);
    setPickerIssue(null);
  }, [pickerField, saving]);

  const applyPickedDate = useCallback((field: PickerField, selected: Date) => {
    const dateKey = localDateToDateKey(selected);
    if (!dateKey) return;
    if (field === "endDate" && form.startDate.dateKey && dateKey < form.startDate.dateKey) {
      const message = t("season.endOnOrAfterStart");
      setDateInstruction(message);
      Alert.alert("", message);
      return;
    }
    if (field === "startDate") {
      const invalidatesEnd = Boolean(form.endDate.dateKey && dateKey > form.endDate.dateKey);
      setForm((value) => ({
        ...value,
        startDate: createSeasonDateField(dateKey),
        endDate: invalidatesEnd ? createSeasonDateField(null) : value.endDate,
      }));
      if (invalidatesEnd) {
        const message = t("season.startAfterEnd");
        setDateInstruction(message);
        Alert.alert("", message);
      } else {
        setDateInstruction(null);
      }
      return;
    }
    setForm((value) => ({ ...value, endDate: createSeasonDateField(dateKey) }));
    setDateInstruction(null);
  }, [form.endDate.dateKey, form.startDate.dateKey, t]);

  const openPicker = useCallback((field: PickerField) => {
    if (pickerField || saving || androidPickerOpenRef.current) return;
    const loadResult = getSeasonDatePickerCapability();
    if (loadResult.status === "unavailable") {
      setPickerIssue(loadResult.issue);
      return;
    }
    const capability = loadResult.capability;
    const selected = form[field].calendarDate;
    const fallback = field === "endDate"
      ? form.startDate.calendarDate ?? addDays(new Date(), 1)
      : new Date();
    const value = selected ?? fallback;

    if (Platform.OS === "android") {
      androidPickerOpenRef.current = true;
      const opened = openSeasonAndroidDatePicker({
        capability,
        minimumDate: field === "endDate" ? form.startDate.calendarDate ?? undefined : new Date(),
        onDismiss: () => {
          androidPickerOpenRef.current = false;
        },
        onFailure: (issue) => {
          androidPickerOpenRef.current = false;
          setPickerIssue(issue);
        },
        onSet: (date) => {
          androidPickerOpenRef.current = false;
          applyPickedDate(field, date);
        },
        value,
      });
      if (!opened) androidPickerOpenRef.current = false;
      else setPickerIssue(null);
      return;
    }

    setPickerDraft(value);
    setPickerCapability(capability);
    setPickerIssue(null);
    setPickerField(field);
  }, [applyPickedDate, form, pickerField, saving]);

  const cancelIosPicker = useCallback(() => setPickerField(null), []);
  const confirmIosPicker = useCallback(() => {
    const field = pickerField;
    setPickerField(null);
    if (field) applyPickedDate(field, pickerDraft);
  }, [applyPickedDate, pickerDraft, pickerField]);

  const save = useCallback(async () => {
    if (!mode || submittingRef.current) return;
    if (form.name.trim().length < 2) {
      Alert.alert("", t("season.validationName"));
      return;
    }
    const startDate = normalizeDateKey(form.startDate.dateKey);
    const endDate = normalizeDateKey(form.endDate.dateKey);
    if (mode !== "extend" && !startDate) {
      Alert.alert("", t("season.invalidStartDate"));
      return;
    }
    if (!endDate) {
      Alert.alert("", t("season.invalidEndDate"));
      return;
    }
    if (startDate && endDate < startDate) {
      Alert.alert("", t("season.endOnOrAfterStart"));
      return;
    }
    if (!isValidIanaTimeZone(form.timeZone)) {
      Alert.alert("", t("season.unsupportedTimeZone"));
      return;
    }

    submittingRef.current = true;
    setSaving(true);
    const submittedMode = mode;
    try {
      if (submittedMode === "schedule" || submittedMode === "startNow") {
        await createSquadSeason({
          squadId,
          name: form.name,
          startDate: startDate!,
          endDate,
          timeZone: form.timeZone,
          idempotencyKey: form.idempotencyKey,
          startNow: submittedMode === "startNow",
        });
      } else if (editingSeason) {
        await updateSquadSeason(submittedMode === "extend"
          ? { squadId, seasonId: editingSeason.seasonId, name: form.name, endDate }
          : {
              squadId,
              seasonId: editingSeason.seasonId,
              name: form.name,
              startDate: startDate!,
              endDate,
              timeZone: form.timeZone,
            });
      }
      setPickerField(null);
      setMode(null);
      setEditingSeason(null);
      setForm(emptyForm());
      setDateInstruction(null);
      setPickerIssue(null);
      await load();
      Alert.alert("", t(submittedMode === "schedule"
        ? "season.seasonScheduled"
        : submittedMode === "startNow" ? "season.seasonStarted" : "season.seasonUpdated"));
    } catch (error) {
      Alert.alert(t("season.seasonActionErrorTitle"), seasonErrorMessage(error, t));
    } finally {
      submittingRef.current = false;
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
            if (submittingRef.current) return;
            submittingRef.current = true;
            setSaving(true);
            try {
              await endSquadSeason(squadId, season.seasonId);
              await load();
              Alert.alert("", t("season.seasonEnded"));
            } catch (error) {
              Alert.alert(t("season.seasonActionErrorTitle"), seasonErrorMessage(error, t));
            } finally {
              submittingRef.current = false;
              setSaving(false);
            }
          },
        },
      ],
    );
  }, [load, squadId, t]);

  if (loading && !result) return <ActivityIndicator accessibilityLabel={t("season.loading")} color={Colors.primary} />;
  if (loadError && !result) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t("season.couldNotLoad")}</Text>
        <Text style={styles.muted}>{t("season.couldNotLoadBody")}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={() => void load()} style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>{t("common.retry")}</Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!result?.canManageSeasons) return null;

  const language = i18n.language;
  const bottomPadding = getFixedFooterBottomPadding(insets.bottom);
  const pickerMinimumDate = pickerField === "endDate"
    ? form.startDate.calendarDate ?? undefined
    : mode === "editUpcoming" ? new Date() : new Date();
  const DateTimePicker = pickerCapability?.Picker ?? null;

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <CalendarDays color={Colors.primary} size={22} />
        <Text style={styles.title}>{t("season.manageSeason")}</Text>
      </View>

      {currentSeason ? (
        <SeasonRow label={t("season.currentSeason")} language={language} season={currentSeason} t={t} />
      ) : (
        <Text style={styles.muted}>{t("season.noActiveSeason")}</Text>
      )}

      {upcomingSeasons.map((season) => (
        <View key={season.seasonId} style={styles.seasonBlock}>
          <SeasonRow label={t("season.nextSeason")} language={language} season={season} t={t} />
          {season.detailsAvailable ? (
            <TouchableOpacity accessibilityRole="button" onPress={() => openForm("editUpcoming", season)} style={styles.linkButton}>
              <Text style={styles.linkText}>{t("season.editSeason")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}

      {unavailableSeasons.map((season) => (
        <SeasonUnavailable key={season.seasonId} t={t} />
      ))}

      <View style={styles.actions}>
        {!currentSeason ? (
          <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => openForm("startNow")} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>{t("season.startSeasonNow")}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={saving || !currentSeason.detailsAvailable}
              onPress={() => openForm("extend", currentSeason)}
              style={[styles.secondaryButton, !currentSeason.detailsAvailable && styles.disabled]}
            >
              <Text style={styles.secondaryButtonText}>{t("season.extendSeason")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              disabled={saving || !currentSeason.detailsAvailable}
              onPress={() => confirmEnd(currentSeason)}
              style={[styles.destructiveButton, !currentSeason.detailsAvailable && styles.disabled]}
            >
              <Text style={styles.destructiveButtonText}>{t("season.endSeasonNow")}</Text>
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={() => openForm("schedule")} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>{t("season.scheduleSeason")}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.historyText}>
        {closedSeasons.length > 0
          ? t("season.pastSeasonCount", { count: closedSeasons.length })
          : t("season.noPastSeasons")}
      </Text>

      <Modal animationType="slide" onRequestClose={closeForm} transparent visible={mode !== null}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView
              contentContainerStyle={styles.form}
              keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              style={styles.formScroll}
            >
              <Text style={styles.modalTitle}>{t(formTitleKey(mode))}</Text>
              <Field
                label={t("season.seasonName")}
                onChangeText={(name) => setForm((value) => ({ ...value, name }))}
                placeholder={t("season.seasonNamePlaceholder")}
                value={form.name}
              />
              {mode !== "extend" ? (
                <DateField
                  disabled={mode === "startNow"}
                  field="startDate"
                  language={language}
                  label={t("season.startDate")}
                  onPress={() => openPicker("startDate")}
                  placeholder={t("season.chooseStartDate")}
                  selectLabel={t("season.selectStartDate")}
                  value={form.startDate}
                />
              ) : null}
              <DateField
                error={dateInstruction}
                field="endDate"
                language={language}
                label={t("season.endDate")}
                onPress={() => openPicker("endDate")}
                placeholder={t("season.chooseEndDate")}
                selectLabel={t("season.selectEndDate")}
                value={form.endDate}
              />
              {pickerIssue ? (
                <View accessibilityLiveRegion="polite" style={styles.pickerUnavailableCard}>
                  <Text style={styles.unavailableTitle}>{t(pickerIssue === "missing-native-module"
                    ? "season.calendarBuildRequired"
                    : "season.calendarOpenError")}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    onPress={() => setPickerIssue(null)}
                    style={styles.dismissButton}
                  >
                    <Text style={styles.dismissButtonText}>{t("common.dismiss")}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
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
            </ScrollView>
            <View style={[styles.modalFooter, { paddingBottom: bottomPadding }]}>
              <TouchableOpacity accessibilityRole="button" disabled={saving} onPress={closeForm} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ busy: saving, disabled: saving }}
                disabled={saving}
                onPress={() => void save()}
                style={[styles.primaryButton, saving && styles.disabled]}
              >
                {saving ? (
                  <View style={styles.savingRow}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>{t("common.saving")}</Text>
                  </View>
                ) : <Text style={styles.primaryButtonText}>{t("common.save")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal animationType="fade" onRequestClose={cancelIosPicker} transparent visible={Platform.OS === "ios" && pickerField !== null && DateTimePicker !== null}>
        <View style={styles.pickerBackdrop}>
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{t(pickerField === "startDate" ? "season.selectStartDate" : "season.selectEndDate")}</Text>
            {DateTimePicker ? (
              <DateTimePicker
                display="inline"
                minimumDate={pickerMinimumDate}
                mode="date"
                onChange={(_event, selected) => { if (selected) setPickerDraft(selected); }}
                value={pickerDraft}
              />
            ) : null}
            <View style={[styles.pickerActions, { paddingBottom: bottomPadding }]}>
              <TouchableOpacity accessibilityRole="button" onPress={cancelIosPicker} style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonText}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" onPress={confirmIosPicker} style={styles.primaryButton}>
                <Text style={styles.primaryButtonText}>{t("common.done")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function SeasonRow({
  label,
  language,
  season,
  t,
}: {
  label: string;
  language: string;
  season: SquadSeasonSummary;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const range = formatSeasonDateRange(season);
  if (!season.detailsAvailable || !range) return <SeasonUnavailable t={t} />;
  const spokenRange = `${formatSpokenDateKey(season.startDateKey, language)} – ${formatSpokenDateKey(season.endDateKey, language)}`;
  return (
    <View
      accessible
      accessibilityLabel={`${label}. ${season.name}. ${t(`season.status.${season.status}`)}. ${spokenRange}. ${season.timeZone}.`}
      style={styles.seasonRow}
    >
      <Text style={styles.eyebrow}>{label}</Text>
      <Text style={styles.seasonName}>{season.name}</Text>
      <Text style={styles.seasonDates}>{range}</Text>
      <Text style={styles.timeZoneText}>{season.timeZone}</Text>
      <Text style={styles.statusText}>{t(`season.status.${season.status}`)}</Text>
    </View>
  );
}

function SeasonUnavailable({ t }: { t: (key: string) => string }) {
  return (
    <View accessible style={styles.unavailableCard}>
      <Text style={styles.unavailableTitle}>{t("season.detailsUnavailable")}</Text>
      <Text style={styles.helper}>{t("season.detailsUnavailableBody")}</Text>
    </View>
  );
}

function DateField(props: {
  disabled?: boolean;
  error?: string | null;
  field: PickerField;
  label: string;
  language: string;
  onPress: () => void;
  placeholder: string;
  selectLabel: string;
  value: SeasonDateField;
}) {
  const spokenDate = formatSpokenDateKey(props.value.dateKey, props.language);
  const accessibilityLabel = spokenDate ? `${props.label}, ${spokenDate}` : props.selectLabel;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TouchableOpacity
        accessibilityHint={props.error ?? props.selectLabel}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(props.disabled) }}
        disabled={props.disabled}
        onPress={props.onPress}
        style={[styles.dateButton, props.disabled && styles.inputDisabled]}
        testID={`season-${props.field}-button`}
      >
        <Text style={[styles.dateValue, !props.value.displayValue && styles.placeholder]}>
          {props.value.displayValue || props.placeholder}
        </Text>
        <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.calendarTarget}>
          <CalendarDays color={Colors.primary} size={22} />
        </View>
      </TouchableOpacity>
      {props.error ? <Text accessibilityLiveRegion="polite" style={styles.fieldError}>{props.error}</Text> : null}
    </View>
  );
}

function Field(props: { label: string; onChangeText: (value: string) => void; placeholder: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        autoCapitalize="sentences"
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.textPrimary}
        style={styles.input}
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
  const message = typeof error === "object" && error && "message" in error ? String(error.message).toLowerCase() : "";
  if (code.includes("already-exists") || message.includes("overlap")) return t("season.datesOverlap");
  if (message.includes("past")) return t("season.startDatePast");
  if (message.includes("end") && message.includes("start")) return t("season.endOnOrAfterStart");
  if (message.includes("timezone")) return t("season.unsupportedTimeZone");
  if (code.includes("permission-denied")) return t("season.adminOnly");
  return t("season.seasonActionErrorBody");
}

function createSeasonRequestId() {
  return `season_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function emptyForm(): SeasonForm {
  return {
    name: "",
    startDate: createSeasonDateField(null),
    endDate: createSeasonDateField(null),
    timeZone: "",
    idempotencyKey: "",
  };
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
  timeZoneText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, flexShrink: 1 },
  statusText: { color: Colors.textPrimary, fontFamily: Typography.bodyMedium, fontSize: 12 },
  actions: { gap: Spacing.sm },
  primaryButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  primaryButtonText: { color: "#FFFFFF", fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  secondaryButton: { alignItems: "center", borderColor: Colors.primary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  secondaryButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  destructiveButton: { alignItems: "center", borderColor: "#B42318", borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  destructiveButtonText: { color: "#B42318", fontFamily: Typography.bodySemiBold, fontSize: 14, textAlign: "center" },
  disabled: { opacity: 0.55 },
  linkButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  linkText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13, textDecorationLine: "underline" },
  historyText: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  unavailableCard: { backgroundColor: `${Colors.secondary}33`, borderRadius: Radius.sm, gap: Spacing.xs, padding: Spacing.md },
  unavailableTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 14 },
  modalBackdrop: { backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "flex-end" },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, maxHeight: "92%", overflow: "hidden" },
  formScroll: { flexShrink: 1 },
  form: { gap: Spacing.md, padding: Spacing.lg, paddingBottom: Spacing.lg },
  modalFooter: { backgroundColor: Colors.surface, borderTopColor: `${Colors.secondary}66`, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  modalTitle: { color: Colors.textHeading, fontFamily: Typography.heading, fontSize: 24, flexShrink: 1 },
  field: { gap: Spacing.xs },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  helper: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 18 },
  input: { borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 15, minHeight: 48, paddingHorizontal: Spacing.md },
  inputDisabled: { backgroundColor: `${Colors.secondary}33` },
  dateButton: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, flexDirection: "row", minHeight: 52, paddingLeft: Spacing.md },
  dateValue: { color: Colors.textHeading, flex: 1, fontFamily: Typography.bodyRegular, fontSize: 15 },
  placeholder: { color: Colors.textPrimary },
  calendarTarget: { alignItems: "center", height: 48, justifyContent: "center", width: 48 },
  fieldError: { color: "#B42318", fontFamily: Typography.bodyMedium, fontSize: 12, lineHeight: 18 },
  zoneList: { gap: Spacing.xs },
  zoneButton: { borderColor: Colors.secondary, borderRadius: Radius.sm, borderWidth: 1, minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.sm },
  zoneButtonSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  zoneText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 13, flexShrink: 1 },
  zoneTextSelected: { color: "#FFFFFF" },
  savingRow: { alignItems: "center", flexDirection: "row", gap: Spacing.sm },
  pickerBackdrop: { backgroundColor: "rgba(0,0,0,0.45)", flex: 1, justifyContent: "flex-end" },
  pickerCard: { backgroundColor: Colors.surface, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card, gap: Spacing.md, paddingTop: Spacing.lg },
  pickerTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 18, paddingHorizontal: Spacing.lg },
  pickerActions: { borderTopColor: `${Colors.secondary}66`, borderTopWidth: StyleSheet.hairlineWidth, gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  pickerUnavailableCard: { backgroundColor: `${Colors.secondary}33`, borderRadius: Radius.sm, gap: Spacing.sm, padding: Spacing.md },
  dismissButton: { alignItems: "center", alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: Spacing.sm },
  dismissButtonText: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 13 },
});
