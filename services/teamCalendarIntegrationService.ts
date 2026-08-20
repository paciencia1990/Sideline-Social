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
    return error.details.reason;
  }
  return "unexpected";
}
