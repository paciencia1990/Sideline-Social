import { httpsCallable } from "firebase/functions";

import { functions } from "@/config/firebase";

export type TeamCalendarPreviewEvent = {
  key: string;
  title: string;
  startAtMillis: number;
  endAtMillis: number;
  timezone: string;
  isAllDay: boolean;
  location: string | null;
  status: "scheduled" | "cancelled";
  type: "game" | "practice" | "teamEvent";
};

export type TeamCalendarPreview = {
  previewId?: string;
  integrationId?: string;
  hostname?: string;
  events: TeamCalendarPreviewEvent[];
  rejectedCount: number;
  warnings: string[];
};

export type TeamCalendarSyncSummary = {
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  rejected: number;
};

export type TeamCalendarConnection = {
  integrationId: string;
  hostname: string;
  status: "connected" | "attention";
  automaticSyncEnabled: boolean;
  lastSuccessfulSyncAt: number | null;
  lastAttemptedSyncAt: number | null;
  nextSyncAt: number | null;
  summary: TeamCalendarSyncSummary | null;
};

export async function previewScheduleIcs(teamId: string, ics: string) {
  return call<{ teamId: string; ics: string }, TeamCalendarPreview>("previewTeamScheduleIcs", { teamId, ics });
}

export async function importScheduleIcs(teamId: string, previewId: string, selectedKeys: string[], notifyTeam: boolean) {
  return call<{ teamId: string; previewId: string; selectedKeys: string[]; notifyTeam: boolean }, TeamCalendarSyncSummary>("importTeamScheduleIcs", { teamId, previewId, selectedKeys, notifyTeam });
}

export async function previewCalendarFeed(teamId: string, url: string, replaceIntegrationId?: string) {
  return call<{ teamId: string; url: string; replaceIntegrationId?: string }, TeamCalendarPreview>("connectTeamCalendarFeed", { teamId, url, ...(replaceIntegrationId ? { replaceIntegrationId } : {}) });
}

export async function confirmCalendarFeed(teamId: string, integrationId: string, selectedKeys: string[], automaticSyncEnabled: boolean, notifyTeam: boolean) {
  return call<{ teamId: string; integrationId: string; selectedKeys: string[]; automaticSyncEnabled: boolean; notifyTeam: boolean }, TeamCalendarSyncSummary & { automaticSyncEnabled: boolean }>("confirmTeamCalendarFeed", { teamId, integrationId, selectedKeys, automaticSyncEnabled, notifyTeam });
}

export async function getCalendarConnection(teamId: string) {
  return call<{ teamId: string }, { connection: TeamCalendarConnection | null; automaticSyncAvailable: boolean }>("getTeamCalendarConnection", { teamId });
}

export async function syncCalendarFeed(teamId: string, integrationId: string) {
  return call<{ teamId: string; integrationId: string }, TeamCalendarSyncSummary>("syncTeamCalendarFeedNow", { teamId, integrationId });
}

export async function setCalendarAutomaticSync(teamId: string, integrationId: string, enabled: boolean) {
  return call<{ teamId: string; integrationId: string; enabled: boolean }, { automaticSyncEnabled: boolean }>("setTeamCalendarAutomaticSync", { teamId, integrationId, enabled });
}

export async function disconnectCalendarFeed(teamId: string, integrationId: string, removeEvents: boolean) {
  return call<{ teamId: string; integrationId: string; removeEvents: boolean }, { affectedEvents: number; removed: boolean }>("disconnectTeamCalendarFeed", { teamId, integrationId, removeEvents });
}

export async function createCalendarSubscription(teamId: string) {
  return call<{ teamId: string }, { httpsUrl: string; webcalUrl: string; teamName: string }>("createTeamCalendarSubscription", { teamId });
}

export async function revokeCalendarSubscription(teamId: string) {
  return call<{ teamId: string }, { revoked: boolean }>("revokeTeamCalendarSubscription", { teamId });
}

async function call<TInput, TResult>(name: string, input: TInput): Promise<TResult> {
  const callable = httpsCallable<TInput, TResult>(functions, name);
  return (await callable(input)).data;
}

export function calendarIntegrationErrorReason(error: unknown) {
  if (!error || typeof error !== "object") return "unexpected";
  if ("details" in error && error.details && typeof error.details === "object" && "reason" in error.details && typeof error.details.reason === "string") {
    if (SAFE_CALENDAR_REASONS.has(error.details.reason)) return error.details.reason;
  }
  const code = "code" in error && typeof error.code === "string" ? error.code.replace(/^functions\//u, "") : "";
  if (code === "unauthenticated") return "authentication_required";
  if (code === "permission-denied") return "calendar_access_denied";
  if (code === "not-found") return "calendar_service_unavailable";
  if (code === "deadline-exceeded" || code === "unavailable") return "calendar_service_unavailable";
  return "unexpected";
}

const SAFE_CALENDAR_REASONS = new Set([
  "automatic_sync_not_approved", "calendar_rate_limited", "feed_address_blocked", "feed_content_encoding_invalid",
  "feed_content_encoding_unsupported", "feed_content_type_invalid", "feed_dns_failed", "feed_embedded_credentials",
  "feed_credential_invalid", "feed_empty", "feed_encryption_not_configured", "feed_fetch_failed", "feed_fragment_unsupported", "feed_host_not_approved", "feed_http_error",
  "feed_https_required", "feed_not_connected", "feed_port_unsupported", "feed_redirect_invalid", "feed_redirect_limit",
  "feed_response_too_large", "feed_timeout", "feed_tls_invalid", "feed_transport_configuration", "feed_unreachable", "feed_url_invalid",
  "ics_event_limit", "ics_file_too_large", "ics_invalid_calendar", "import_authorization_changed", "no_events_selected",
  "sync_in_progress",
]);
