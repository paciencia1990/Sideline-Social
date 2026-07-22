import type { ComponentProps, ComponentType } from "react";
import { Platform } from "react-native";

type DatePickerModule = typeof import("@react-native-community/datetimepicker");

export type SeasonDatePickerEvent = import("@react-native-community/datetimepicker").DateTimePickerEvent;
export type SeasonDatePickerProps = ComponentProps<DatePickerModule["default"]>;
export type SeasonDatePickerIssue = "missing-native-module" | "calendar-error";

export type SeasonDatePickerCapability = {
  Picker: ComponentType<SeasonDatePickerProps>;
  androidApi: DatePickerModule["DateTimePickerAndroid"] | null;
};

export type SeasonDatePickerLoadResult =
  | { status: "available"; capability: SeasonDatePickerCapability }
  | { status: "unavailable"; issue: SeasonDatePickerIssue };

export type SeasonDatePickerAvailability =
  | "unchecked"
  | "available"
  | "missing-native-module"
  | "error";

let cachedLoadResult: SeasonDatePickerLoadResult | undefined;
const writtenDiagnostics = new Set<string>();

export function getSeasonDatePickerCapability(): SeasonDatePickerLoadResult {
  if (cachedLoadResult !== undefined) return cachedLoadResult;

  try {
    const loaded = require("@react-native-community/datetimepicker") as unknown;
    const capability = normalizeSeasonDatePickerModule(loaded);
    cachedLoadResult = capability
      ? { status: "available", capability }
      : { status: "unavailable", issue: "calendar-error" };
    writeLoadDiagnostic(loaded, cachedLoadResult);
  } catch (error) {
    cachedLoadResult = {
      status: "unavailable",
      issue: classifySeasonDatePickerError(error),
    };
    writeLoadDiagnostic(null, cachedLoadResult, error);
  }

  return cachedLoadResult;
}

export function getSeasonDatePickerAvailability(): SeasonDatePickerAvailability {
  if (cachedLoadResult === undefined) return "unchecked";
  if (cachedLoadResult.status === "available") return "available";
  return cachedLoadResult.issue === "missing-native-module" ? "missing-native-module" : "error";
}

export function normalizeSeasonDatePickerModule(value: unknown): SeasonDatePickerCapability | null {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return null;
  const moduleRecord = value as { default?: unknown; DateTimePickerAndroid?: unknown };
  const candidate = moduleRecord.default ?? value;
  if (!candidate || (typeof candidate !== "function" && typeof candidate !== "object")) return null;
  const androidApi = moduleRecord.DateTimePickerAndroid;
  return {
    Picker: candidate as ComponentType<SeasonDatePickerProps>,
    androidApi: androidApi && typeof androidApi === "object"
      ? androidApi as DatePickerModule["DateTimePickerAndroid"]
      : null,
  };
}

export function classifySeasonDatePickerError(error: unknown): SeasonDatePickerIssue {
  const message = getErrorMessage(error);
  return /TurboModuleRegistry[\s\S]*(?:could not be found|not found)|(?:RNCDatePicker|RNCTimePicker|RNCMaterialDatePicker|RNCMaterialTimePicker)[\s\S]*(?:could not be found|not found|not registered)/i.test(message)
    ? "missing-native-module"
    : "calendar-error";
}

export function openSeasonAndroidDatePicker(input: {
  capability: SeasonDatePickerCapability;
  minimumDate?: Date;
  onDismiss: () => void;
  onFailure: (issue: SeasonDatePickerIssue) => void;
  onSet: (date: Date) => void;
  value: Date;
}): boolean {
  const open = input.capability.androidApi?.open;
  if (typeof open !== "function") {
    writeFailureDiagnostic("android-api-missing");
    input.onFailure("calendar-error");
    return false;
  }

  let failedSynchronously = false;
  try {
    open({
      display: "calendar",
      minimumDate: input.minimumDate,
      mode: "date",
      onChange: (event, selected) => {
        if (event.type === "set" && selected) input.onSet(selected);
        else input.onDismiss();
      },
      onError: (error) => {
        failedSynchronously = true;
        const issue = classifySeasonDatePickerError(error);
        writeFailureDiagnostic("android-invocation", error, issue);
        input.onFailure(issue);
      },
      value: input.value,
    });
    return !failedSynchronously;
  } catch (error) {
    const issue = classifySeasonDatePickerError(error);
    writeFailureDiagnostic("android-invocation", error, issue);
    input.onFailure(issue);
    return false;
  }
}

function writeLoadDiagnostic(loaded: unknown, result: SeasonDatePickerLoadResult, error?: unknown) {
  const record = loaded && (typeof loaded === "object" || typeof loaded === "function")
    ? loaded as { default?: unknown; DateTimePickerAndroid?: unknown }
    : null;
  const androidApi = record?.DateTimePickerAndroid;
  writeDiagnostic("capability", {
    platform: Platform.OS,
    packageLoaded: loaded != null,
    hasDefaultExport: record?.default != null,
    defaultExportType: typeof record?.default,
    hasAndroidApi: androidApi != null,
    hasAndroidOpen: Boolean(androidApi && typeof androidApi === "object" && typeof (androidApi as { open?: unknown }).open === "function"),
    result: result.status === "available" ? "available" : result.issue,
    ...getSafeErrorDetails(error),
  });
}

function writeFailureDiagnostic(stage: string, error?: unknown, issue: SeasonDatePickerIssue = "calendar-error") {
  writeDiagnostic(stage, {
    platform: Platform.OS,
    result: issue,
    ...getSafeErrorDetails(error),
  });
}

function writeDiagnostic(stage: string, details: Record<string, unknown>) {
  if (!__DEV__ || writtenDiagnostics.has(stage)) return;
  writtenDiagnostics.add(stage);
  console.info("[SeasonDatePicker]", { stage, ...details });
}

function getSafeErrorDetails(error: unknown) {
  if (!error) return {};
  return {
    failureName: error && typeof error === "object" && "name" in error
      ? String(error.name).slice(0, 80)
      : typeof error,
    failureMessage: getErrorMessage(error).replace(/\s+/g, " ").slice(0, 240),
  };
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error ?? "");
}
