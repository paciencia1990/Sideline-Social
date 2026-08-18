import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { KeyboardAwareScrollView } from "@/components/KeyboardAwareScrollView";
import { Colors, Radius, Spacing, Typography } from "@/constants/theme";
import {
  TEAM_SCHEDULE_EVENT_TYPES,
  TEAM_SCHEDULE_HOME_AWAY,
  TEAM_SCHEDULE_STATUSES,
  generateWeeklyRecurrenceDates,
  validateScheduleDraft,
  type TeamScheduleDraft,
} from "@/utils/teamScheduleCore";

type PickerField = "date" | "startTime" | "endTime" | "arrivalTime" | "recurrenceEndDate";

export type TeamScheduleFormOptions = {
  notifyTeam: boolean;
  recurrence: { weekdays: number[]; endDate: string } | null;
  editScope: "one" | "future";
};

export function TeamScheduleEventForm({
  initialDraft,
  isEditing,
  isRecurring,
  submitting,
  onSubmit,
}: {
  initialDraft: TeamScheduleDraft;
  isEditing: boolean;
  isRecurring: boolean;
  submitting: boolean;
  onSubmit: (draft: TeamScheduleDraft, options: TeamScheduleFormOptions) => void;
}) {
  const { i18n, t } = useTranslation();
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pickerField, setPickerField] = useState<PickerField | null>(null);
  const [notifyTeam, setNotifyTeam] = useState(false);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [weekdays, setWeekdays] = useState<number[]>([dateFromKey(initialDraft.date).getDay()]);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(addWeeks(initialDraft.date, 8));
  const [editScope, setEditScope] = useState<"one" | "future">("one");
  const notificationReviewOpen = useRef(false);
  const recurrenceDates = useMemo(() => repeatWeekly
    ? generateWeeklyRecurrenceDates(draft.date, weekdays, recurrenceEndDate)
    : [], [draft.date, recurrenceEndDate, repeatWeekly, weekdays]);

  const update = useCallback(function updateDraft<K extends keyof TeamScheduleDraft>(key: K, value: TeamScheduleDraft[K]) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if ((key === "type" && value !== "game") || (key === "status" && value !== "completed")) {
        next.teamScore = null;
        next.opponentScore = null;
      }
      return next;
    });
    setErrors((current) => {
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const submit = useCallback(() => {
    if (submitting) return;
    const nextErrors = validateScheduleDraft(draft);
    if (repeatWeekly && recurrenceDates.length === 0) nextErrors.recurrence = "recurrenceInvalid";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      void AccessibilityInfo.announceForAccessibility(t("schedule.form.validationSummary"));
      return;
    }
    const options: TeamScheduleFormOptions = {
      notifyTeam,
      recurrence: repeatWeekly ? { weekdays, endDate: recurrenceEndDate } : null,
      editScope,
    };
    if (!notifyTeam) {
      onSubmit(draft, options);
      return;
    }
    if (notificationReviewOpen.current) return;
    notificationReviewOpen.current = true;
    Alert.alert(
      t("schedule.form.notifyConfirmTitle"),
      t("schedule.form.notifyConfirmBody", { title: draft.title }),
      [
        { text: t("common.cancel"), style: "cancel", onPress: () => { notificationReviewOpen.current = false; } },
        {
          text: t("schedule.form.notifyConfirmAction"),
          onPress: () => {
            notificationReviewOpen.current = false;
            onSubmit(draft, options);
          },
        },
      ],
      { onDismiss: () => { notificationReviewOpen.current = false; } },
    );
  }, [draft, editScope, notifyTeam, onSubmit, recurrenceDates.length, repeatWeekly, submitting, t, weekdays, recurrenceEndDate]);

  const onPickerChange = useCallback((event: DateTimePickerEvent, value?: Date) => {
    const field = pickerField;
    if (Platform.OS === "android") setPickerField(null);
    if (event.type === "dismissed" || !value || !field) return;
    if (field === "date") update("date", toDateKey(value));
    else if (field === "recurrenceEndDate") setRecurrenceEndDate(toDateKey(value));
    else update(field, toTimeKey(value));
  }, [pickerField, update]);

  const pickerValue = pickerField === "recurrenceEndDate"
    ? dateFromKey(recurrenceEndDate)
    : pickerField === "date"
      ? dateFromKey(draft.date)
      : dateTimeFromKeys(draft.date, pickerField ? draft[pickerField] : draft.startTime);

  return (
    <KeyboardAwareScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <FieldGroup label={t("schedule.form.type")} error={fieldError(errors.type, t)}>
        <View style={styles.segmentRow}>
          {TEAM_SCHEDULE_EVENT_TYPES.map((type) => (
            <Segment key={type} label={t(`schedule.types.${type}`)} selected={draft.type === type} onPress={() => update("type", type)} />
          ))}
        </View>
      </FieldGroup>

      <TextField label={t("schedule.form.title")} value={draft.title} error={fieldError(errors.title, t)} maxLength={120} onChangeText={(value) => update("title", value)} />

      <View style={styles.twoColumn}>
        <DateButton label={t("schedule.form.date")} value={formatDateLabel(draft.date, i18n.language)} error={fieldError(errors.date, t)} onPress={() => setPickerField("date")} />
        <View style={styles.switchField}>
          <Text style={styles.label}>{t("schedule.form.allDay")}</Text>
          <Switch accessibilityLabel={t("schedule.form.allDay")} onValueChange={(value) => update("isAllDay", value)} value={draft.isAllDay} trackColor={{ false: Colors.secondary, true: Colors.accentGreen }} />
        </View>
      </View>

      {!draft.isAllDay ? (
        <>
          <View style={styles.twoColumn}>
            <DateButton label={t("schedule.form.startTime")} value={formatTimeLabel(draft.startTime, i18n.language)} error={fieldError(errors.startTime, t)} onPress={() => setPickerField("startTime")} />
            <DateButton label={t("schedule.form.endTime")} value={formatTimeLabel(draft.endTime, i18n.language)} error={fieldError(errors.endTime, t)} onPress={() => setPickerField("endTime")} />
          </View>
          <DateButton
            label={t("schedule.form.arrivalTime")}
            value={draft.arrivalTime ? formatTimeLabel(draft.arrivalTime, i18n.language) : t("schedule.form.notSet")}
            clearLabel={t("schedule.form.clear")}
            error={fieldError(errors.arrivalTime, t)}
            onClear={draft.arrivalTime ? () => update("arrivalTime", "") : undefined}
            onPress={() => setPickerField("arrivalTime")}
          />
        </>
      ) : null}

      <TextField label={t("schedule.form.timezone")} value={draft.timezone} error={fieldError(errors.timezone, t)} maxLength={80} autoCapitalize="none" onChangeText={(value) => update("timezone", value)} />

      {draft.type === "game" ? (
        <>
          <TextField label={t("schedule.form.opponent")} value={draft.opponentName} error={fieldError(errors.opponentName, t)} maxLength={120} onChangeText={(value) => update("opponentName", value)} />
          <FieldGroup label={t("schedule.form.homeAway")} error={fieldError(errors.homeAway, t)}>
            <View style={styles.segmentRow}>
              {TEAM_SCHEDULE_HOME_AWAY.map((value) => <Segment key={value} label={t(`schedule.homeAway.${value}`)} selected={draft.homeAway === value} onPress={() => update("homeAway", value)} />)}
            </View>
          </FieldGroup>
        </>
      ) : null}

      <TextField label={t("schedule.form.venue")} value={draft.venueName} error={fieldError(errors.venueName, t)} maxLength={160} onChangeText={(value) => update("venueName", value)} />
      <TextField label={t("schedule.form.field")} value={draft.field} error={fieldError(errors.field, t)} maxLength={80} onChangeText={(value) => update("field", value)} />
      <TextField label={t("schedule.form.address")} value={draft.address} error={fieldError(errors.address, t)} maxLength={240} onChangeText={(value) => update("address", value)} />
      <TextField label={t("schedule.form.notes")} value={draft.notes} error={fieldError(errors.notes, t)} maxLength={2000} multiline onChangeText={(value) => update("notes", value)} />

      <FieldGroup label={t("schedule.form.status")} error={fieldError(errors.status, t)}>
        <View style={styles.segmentRow}>
          {TEAM_SCHEDULE_STATUSES.map((status) => <Segment key={status} label={t(`schedule.statuses.${status}`)} selected={draft.status === status} onPress={() => update("status", status)} />)}
        </View>
      </FieldGroup>

      {draft.type === "game" && draft.status === "completed" ? (
        <View style={styles.twoColumn}>
          <NumericField label={t("schedule.form.teamScore")} value={draft.teamScore} error={fieldError(errors.teamScore, t)} onChange={(value) => update("teamScore", value)} />
          <NumericField label={t("schedule.form.opponentScore")} value={draft.opponentScore} error={fieldError(errors.opponentScore, t)} onChange={(value) => update("opponentScore", value)} />
        </View>
      ) : null}

      {!isEditing && draft.type === "practice" ? (
        <View style={styles.panel}>
          <View style={styles.switchRow}>
            <Text style={styles.panelTitle}>{t("schedule.recurrence.repeatWeekly")}</Text>
            <Switch accessibilityLabel={t("schedule.recurrence.repeatWeekly")} onValueChange={setRepeatWeekly} value={repeatWeekly} trackColor={{ false: Colors.secondary, true: Colors.accentGreen }} />
          </View>
          {repeatWeekly ? (
            <>
              <Text style={styles.label}>{t("schedule.recurrence.weekdays")}</Text>
              <View style={styles.weekdayRow}>
                {[0, 1, 2, 3, 4, 5, 6].map((day) => <Segment key={day} compact label={t(`schedule.weekdays.${day}`)} selected={weekdays.includes(day)} onPress={() => setWeekdays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])} />)}
              </View>
              <DateButton label={t("schedule.recurrence.endDate")} value={formatDateLabel(recurrenceEndDate, i18n.language)} error={fieldError(errors.recurrence, t)} onPress={() => setPickerField("recurrenceEndDate")} />
              <Text accessibilityLiveRegion="polite" style={styles.previewText}>
                {t("schedule.recurrence.previewCount", { count: recurrenceDates.length })}
              </Text>
              {recurrenceDates.slice(0, 6).map((date) => <Text key={date} style={styles.previewDate}>{formatDateLabel(date, i18n.language)}</Text>)}
            </>
          ) : null}
        </View>
      ) : null}

      {isEditing && isRecurring ? (
        <FieldGroup label={t("schedule.recurrence.editScope")}>
          <View style={styles.segmentRow}>
            <Segment label={t("schedule.recurrence.thisOccurrence")} selected={editScope === "one"} onPress={() => setEditScope("one")} />
            <Segment label={t("schedule.recurrence.futureOccurrences")} selected={editScope === "future"} onPress={() => setEditScope("future")} />
          </View>
        </FieldGroup>
      ) : null}

      <View style={styles.panel}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.panelTitle}>{t("schedule.form.notifyTeam")}</Text>
            <Text style={styles.help}>{t("schedule.form.notifyTeamHelp")}</Text>
          </View>
          <Switch accessibilityLabel={t("schedule.form.notifyTeam")} onValueChange={setNotifyTeam} value={notifyTeam} trackColor={{ false: Colors.secondary, true: Colors.accentGreen }} />
        </View>
      </View>

      <TouchableOpacity accessibilityRole="button" accessibilityState={{ busy: submitting, disabled: submitting }} disabled={submitting} onPress={submit} style={[styles.submitButton, submitting && styles.disabled]}>
        {submitting ? <ActivityIndicator color={Colors.surface} /> : <Text style={styles.submitText}>{t(isEditing ? "schedule.form.saveChanges" : "schedule.form.createEvent")}</Text>}
      </TouchableOpacity>

      {pickerField ? (
        <DateTimePicker
          display={Platform.OS === "ios" ? "spinner" : "default"}
          mode={pickerField === "date" || pickerField === "recurrenceEndDate" ? "date" : "time"}
          onChange={onPickerChange}
          value={pickerValue}
        />
      ) : null}
    </KeyboardAwareScrollView>
  );
}

function FieldGroup({ children, error, label }: { children: React.ReactNode; error?: string; label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text>{children}{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}</View>;
}

function TextField({ error, label, multiline, onChangeText, value, ...props }: React.ComponentProps<typeof TextInput> & { error?: string; label: string; value: string }) {
  return <FieldGroup error={error} label={label}><TextInput accessibilityLabel={label} multiline={multiline} onChangeText={onChangeText} style={[styles.input, multiline && styles.multiline, error && styles.inputError]} value={value} {...props} /></FieldGroup>;
}

function NumericField({ error, label, onChange, value }: { error?: string; label: string; onChange: (value: number | null) => void; value: number | null }) {
  return <View style={styles.column}><TextField error={error} keyboardType="number-pad" label={label} maxLength={3} onChangeText={(text) => onChange(text ? Number(text.replace(/\D/gu, "")) : null)} value={value === null ? "" : String(value)} /></View>;
}

function DateButton({ clearLabel, error, label, onClear, onPress, value }: { clearLabel?: string; error?: string; label: string; onClear?: () => void; onPress: () => void; value: string }) {
  return <View style={styles.column}><FieldGroup error={error} label={label}><View style={styles.dateButtonRow}><TouchableOpacity accessibilityLabel={`${label}: ${value}`} accessibilityRole="button" onPress={onPress} style={[styles.dateButton, styles.dateButtonGrow, error && styles.inputError]}><Text style={styles.dateText}>{value}</Text></TouchableOpacity>{onClear ? <TouchableOpacity accessibilityLabel={`${clearLabel ?? "Clear"} ${label}`} accessibilityRole="button" onPress={onClear} style={styles.clearButton}><Text style={styles.clearText}>x</Text></TouchableOpacity> : null}</View></FieldGroup></View>;
}

function Segment({ compact, label, onPress, selected }: { compact?: boolean; label: string; onPress: () => void; selected: boolean }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.segment, compact && styles.compactSegment, selected && styles.segmentSelected]}><Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{label}</Text></TouchableOpacity>;
}

function fieldError(code: string | undefined, t: (key: string) => string) {
  return code ? t(`schedule.validation.${code}`) : undefined;
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0);
}

function dateTimeFromKeys(date: string, time: string) {
  const value = dateFromKey(date);
  const [hour, minute] = time.split(":").map(Number);
  value.setHours(Number.isFinite(hour) ? hour : 12, Number.isFinite(minute) ? minute : 0, 0, 0);
  return value;
}

function toDateKey(value: Date) {
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

function toTimeKey(value: Date) {
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function addWeeks(value: string, weeks: number) {
  const date = dateFromKey(value);
  date.setDate(date.getDate() + weeks * 7);
  return toDateKey(date);
}

function formatDateLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(dateFromKey(value));
}

function formatTimeLabel(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(dateTimeFromKeys("2027-01-01", value));
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

const styles = StyleSheet.create({
  content: { gap: Spacing.md, paddingBottom: Spacing.xxl },
  field: { flex: 1, gap: Spacing.xs },
  column: { flex: 1, minWidth: 0 },
  label: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  input: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, color: Colors.textHeading, fontFamily: Typography.bodyRegular, fontSize: 16, minHeight: 48, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  inputError: { borderColor: Colors.primary, borderWidth: 2 },
  multiline: { maxHeight: 150, minHeight: 96, textAlignVertical: "top" },
  error: { color: Colors.primary, fontFamily: Typography.bodySemiBold, fontSize: 12 },
  twoColumn: { flexDirection: "row", gap: Spacing.sm },
  switchField: { alignItems: "center", flex: 1, gap: Spacing.xs, justifyContent: "center" },
  segmentRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  segment: { alignItems: "center", borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 44, minWidth: 92, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.sm },
  compactSegment: { minWidth: 42, paddingHorizontal: Spacing.xs },
  segmentSelected: { backgroundColor: Colors.textHeading, borderColor: Colors.textHeading },
  segmentText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 12, textAlign: "center" },
  segmentTextSelected: { color: Colors.surface, fontFamily: Typography.bodyBold },
  dateButton: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.button, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: Spacing.md },
  dateButtonRow: { alignItems: "center", flexDirection: "row", gap: Spacing.xs },
  dateButtonGrow: { flex: 1 },
  dateText: { color: Colors.textHeading, fontFamily: Typography.bodyMedium, fontSize: 14 },
  clearButton: { alignItems: "center", borderColor: Colors.secondary, borderRadius: 22, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  clearText: { color: Colors.textHeading, fontFamily: Typography.bodyBold, fontSize: 18 },
  panel: { backgroundColor: Colors.surface, borderColor: Colors.secondary, borderRadius: Radius.card, borderWidth: 1, gap: Spacing.sm, padding: Spacing.md },
  panelTitle: { color: Colors.textHeading, fontFamily: Typography.bodySemiBold, fontSize: 15 },
  switchRow: { alignItems: "center", flexDirection: "row", gap: Spacing.md, justifyContent: "space-between" },
  switchCopy: { flex: 1, gap: 3 },
  help: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12, lineHeight: 17 },
  weekdayRow: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  previewText: { color: Colors.communicationLink, fontFamily: Typography.bodySemiBold, fontSize: 13 },
  previewDate: { color: Colors.textPrimary, fontFamily: Typography.bodyRegular, fontSize: 12 },
  submitButton: { alignItems: "center", backgroundColor: Colors.primary, borderRadius: Radius.button, justifyContent: "center", minHeight: 50, paddingHorizontal: Spacing.lg },
  submitText: { color: Colors.surface, fontFamily: Typography.bodyBold, fontSize: 16 },
  disabled: { opacity: 0.55 },
});
