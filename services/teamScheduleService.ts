import * as Crypto from "expo-crypto";
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";

import { auth, db, functions } from "@/config/firebase";
import { TEAM_HISTORY_PAGE_SIZES, type TeamHistoryCursor } from "@/constants/teamHistoryPagination";
import {
  buildScheduleFingerprint,
  type TeamScheduleDraft,
  type TeamScheduleEventType,
  type TeamScheduleHomeAway,
  type TeamScheduleStatus,
} from "@/utils/teamScheduleCore";

export type TeamScheduleEvent = {
  id: string;
  teamId: string;
  type: TeamScheduleEventType;
  title: string;
  startAt: Date;
  endAt: Date;
  arrivalAt: Date | null;
  timezone: string;
  isAllDay: boolean;
  opponentName: string | null;
  homeAway: TeamScheduleHomeAway | null;
  venueName: string | null;
  field: string | null;
  address: string | null;
  status: TeamScheduleStatus;
  teamScore: number | null;
  opponentScore: number | null;
  notes: string | null;
  source: "manual" | "csv";
  importFingerprint: string | null;
  recurrenceGroupId: string | null;
  recurrenceIndex: number | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date | null;
  updatedAt: Date | null;
  cancelledAt: Date | null;
};

export type TeamScheduleAccess = {
  teamId: string;
  teamName: string;
  teamStatus: "active" | "archived";
  membershipStatus: "active" | "inactive";
  canManage: boolean;
  isParent: boolean;
};

export type SaveScheduleEventInput = {
  teamId: string;
  eventId?: string;
  draft: TeamScheduleDraft;
  notifyTeam: boolean;
  recurrence?: { weekdays: number[]; endDate: string } | null;
  editScope?: "one" | "future";
  clientOperationId?: string;
};

export type ImportScheduleRow = {
  rowNumber: number;
  draft: TeamScheduleDraft;
  fingerprint: string;
};

export type ImportScheduleResult = {
  createdCount: number;
  unchangedCount: number;
  duplicateCount: number;
  eventIds: string[];
};

export type TeamSchedulePage = {
  events: TeamScheduleEvent[];
  hasMore: boolean;
  nextCursor: TeamHistoryCursor | null;
};

export async function getTeamScheduleAccess(teamIdValue: string): Promise<TeamScheduleAccess> {
  const user = auth.currentUser;
  const teamId = normalizeId(teamIdValue);
  if (!user || !teamId) throw scheduleError("unauthenticated");
  const [membershipSnapshot, teamSnapshot] = await Promise.all([
    getDoc(doc(db, "teams", teamId, "members", user.uid)),
    getDoc(doc(db, "teams", teamId)),
  ]);
  if (!membershipSnapshot.exists() || !teamSnapshot.exists()) throw scheduleError("not-found");
  const membership = membershipSnapshot.data();
  if (membership.status !== "active") throw scheduleError("permission-denied");
  const roles = isRecord(membership.roles) ? membership.roles : {};
  const legacyRole = typeof membership.role === "string" ? membership.role : "";
  const canManage = roles.coach === true || roles.staff === true || legacyRole === "coach" || legacyRole === "assistantCoach" || legacyRole === "teamParent";
  const isParent = roles.parent === true || legacyRole === "parent";
  const team = teamSnapshot.data();
  return {
    teamId,
    teamName: readString(team.name, "Team"),
    teamStatus: team.status === "archived" ? "archived" : "active",
    membershipStatus: "active",
    canManage,
    isParent,
  };
}

export function subscribeToTeamSchedule(
  teamIdValue: string,
  onNext: (events: TeamScheduleEvent[], fromCache: boolean) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  return subscribeToUpcomingTeamSchedule(teamIdValue, (page, fromCache) => onNext(page.events, fromCache), onError);
}

export function subscribeToUpcomingTeamSchedule(
  teamIdValue: string,
  onNext: (page: TeamSchedulePage, fromCache: boolean) => void,
  onError: (error: unknown) => void,
  fromDate = new Date(),
): Unsubscribe {
  const teamId = normalizeId(teamIdValue);
  if (!teamId) {
    onError(scheduleError("invalid-team"));
    return () => undefined;
  }
  const pageSize = TEAM_HISTORY_PAGE_SIZES.upcomingSchedule;
  return onSnapshot(
    query(
      collection(db, "teams", teamId, "events"),
      where("startAt", ">=", Timestamp.fromDate(fromDate)),
      orderBy("startAt", "asc"),
      orderBy(documentId(), "asc"),
      limit(pageSize + 1),
    ),
    (snapshot) => {
      const events = snapshot.docs.slice(0, pageSize).map((item) => normalizeEvent(teamId, item));
      onNext({
        events,
        hasMore: snapshot.size > pageSize,
        nextCursor: cursorForEvent(events.at(-1)),
      }, snapshot.metadata.fromCache);
    },
    onError,
  );
}

export async function getMoreUpcomingTeamSchedule(
  teamIdValue: string,
  cursor: TeamHistoryCursor,
): Promise<TeamSchedulePage> {
  const teamId = normalizeId(teamIdValue);
  if (!teamId) throw scheduleError("invalid-team");
  const pageSize = TEAM_HISTORY_PAGE_SIZES.upcomingSchedule;
  const snapshot = await getDocs(query(
    collection(db, "teams", teamId, "events"),
    orderBy("startAt", "asc"),
    orderBy(documentId(), "asc"),
    startAfter(Timestamp.fromMillis(cursor.timestampMillis), cursor.id),
    limit(pageSize + 1),
  ));
  const events = snapshot.docs.slice(0, pageSize).map((item) => normalizeEvent(teamId, item));
  return {
    events,
    hasMore: snapshot.size > pageSize,
    nextCursor: cursorForEvent(events.at(-1)),
  };
}

export async function getPastTeamSchedulePage(
  teamIdValue: string,
  cursor: TeamHistoryCursor | null = null,
  beforeDate = new Date(),
): Promise<TeamSchedulePage> {
  const teamId = normalizeId(teamIdValue);
  if (!teamId) throw scheduleError("invalid-team");
  const pageSize = TEAM_HISTORY_PAGE_SIZES.pastSchedule;
  const constraints = [
    where("startAt", "<", Timestamp.fromDate(beforeDate)),
    orderBy("startAt", "desc"),
    orderBy(documentId(), "desc"),
    ...(cursor ? [startAfter(Timestamp.fromMillis(cursor.timestampMillis), cursor.id)] : []),
    limit(pageSize + 1),
  ];
  const snapshot = await getDocs(query(collection(db, "teams", teamId, "events"), ...constraints));
  const events = snapshot.docs.slice(0, pageSize).map((item) => normalizeEvent(teamId, item));
  return {
    events,
    hasMore: snapshot.size > pageSize,
    nextCursor: cursorForEvent(events.at(-1)),
  };
}

export async function getTeamScheduleEvent(teamIdValue: string, eventIdValue: string) {
  const teamId = normalizeId(teamIdValue);
  const eventId = normalizeId(eventIdValue);
  if (!teamId || !eventId) return null;
  const snapshot = await getDoc(doc(db, "teams", teamId, "events", eventId));
  return snapshot.exists() ? normalizeEvent(teamId, snapshot) : null;
}

export async function getTeamScheduleImportFingerprints(teamIdValue: string, requestedFingerprints: string[]) {
  const teamId = normalizeId(teamIdValue);
  const fingerprints = Array.from(new Set(requestedFingerprints.filter((value) => /^[a-f0-9]{64}$/u.test(value))));
  if (!teamId || fingerprints.length === 0) return new Set<string>();
  const existing = new Set<string>();
  for (let start = 0; start < fingerprints.length; start += 30) {
    const snapshot = await getDocs(query(
      collection(db, "teams", teamId, "events"),
      where("importFingerprint", "in", fingerprints.slice(start, start + 30)),
    ));
    snapshot.docs.forEach((item) => {
      const value = item.data().importFingerprint;
      if (typeof value === "string") existing.add(value);
    });
  }
  return existing;
}

export async function saveTeamScheduleEvent(input: SaveScheduleEventInput) {
  const callable = httpsCallable<
    {
      teamId: string;
      eventId?: string;
      event: TeamScheduleDraft;
      notifyTeam: boolean;
      recurrence?: { weekdays: number[]; endDate: string } | null;
      editScope?: "one" | "future";
      clientOperationId: string;
    },
    { eventIds: string[]; recurrenceGroupId: string | null }
  >(functions, "saveTeamScheduleEvent");
  const response = await callable({
    teamId: input.teamId,
    eventId: input.eventId,
    event: input.draft,
    notifyTeam: input.notifyTeam,
    recurrence: input.recurrence ?? null,
    editScope: input.editScope ?? "one",
    clientOperationId: input.clientOperationId ?? Crypto.randomUUID(),
  });
  return response.data;
}

export async function deleteTeamScheduleEvent(teamId: string, eventId: string) {
  const callable = httpsCallable<
    { teamId: string; eventId: string },
    { deleted: boolean }
  >(functions, "deleteTeamScheduleEvent");
  return (await callable({ teamId, eventId })).data;
}

export async function importTeamScheduleEvents(
  teamId: string,
  rows: ImportScheduleRow[],
  notifyTeam: boolean,
  clientOperationId = Crypto.randomUUID(),
): Promise<ImportScheduleResult> {
  const callable = httpsCallable<
    { teamId: string; rows: ImportScheduleRow[]; notifyTeam: boolean; clientOperationId: string },
    ImportScheduleResult
  >(functions, "importTeamScheduleEvents");
  return (await callable({ teamId, rows, notifyTeam, clientOperationId })).data;
}

export function scheduleDraftFromEvent(event: TeamScheduleEvent): TeamScheduleDraft {
  return {
    type: event.type,
    title: event.title,
    date: formatPart(event.startAt, event.timezone, "date"),
    startTime: event.isAllDay ? "00:00" : formatPart(event.startAt, event.timezone, "time"),
    endTime: event.isAllDay ? "00:00" : formatPart(event.endAt, event.timezone, "time"),
    arrivalTime: event.arrivalAt ? formatPart(event.arrivalAt, event.timezone, "time") : "",
    timezone: event.timezone,
    isAllDay: event.isAllDay,
    opponentName: event.opponentName ?? "",
    homeAway: event.homeAway ?? "",
    venueName: event.venueName ?? "",
    field: event.field ?? "",
    address: event.address ?? "",
    status: event.status,
    teamScore: event.teamScore,
    opponentScore: event.opponentScore,
    notes: event.notes ?? "",
  };
}

export function importFingerprintForDraft(draft: TeamScheduleDraft) {
  return buildScheduleFingerprint(draft);
}

function normalizeEvent(teamId: string, snapshot: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData }): TeamScheduleEvent {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    teamId,
    type: data.type === "game" || data.type === "teamEvent" ? data.type : "practice",
    title: readString(data.title, "Team event"),
    startAt: readDate(data.startAt) ?? new Date(0),
    endAt: readDate(data.endAt) ?? readDate(data.startAt) ?? new Date(0),
    arrivalAt: readDate(data.arrivalAt),
    timezone: readString(data.timezone, "UTC"),
    isAllDay: data.isAllDay === true,
    opponentName: readNullableString(data.opponentName),
    homeAway: data.homeAway === "home" || data.homeAway === "away" || data.homeAway === "neutral" ? data.homeAway : null,
    venueName: readNullableString(data.venueName),
    field: readNullableString(data.field),
    address: readNullableString(data.address),
    status: data.status === "postponed" || data.status === "cancelled" || data.status === "completed" ? data.status : "scheduled",
    teamScore: readScore(data.teamScore),
    opponentScore: readScore(data.opponentScore),
    notes: readNullableString(data.notes),
    source: data.source === "csv" ? "csv" : "manual",
    importFingerprint: readNullableString(data.importFingerprint),
    recurrenceGroupId: readNullableString(data.recurrenceGroupId),
    recurrenceIndex: Number.isInteger(data.recurrenceIndex) ? data.recurrenceIndex : null,
    createdBy: readString(data.createdBy),
    updatedBy: readString(data.updatedBy),
    createdAt: readDate(data.createdAt),
    updatedAt: readDate(data.updatedAt),
    cancelledAt: readDate(data.cancelledAt),
  };
}

function formatPart(date: Date, timezone: string, part: "date" | "time") {
  const options: Intl.DateTimeFormatOptions = part === "date"
    ? { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }
    : { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  const parts = new Intl.DateTimeFormat(part === "date" ? "en-CA" : "en-GB", options).formatToParts(date);
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return part === "date" ? `${values.year}-${values.month}-${values.day}` : `${values.hour}:${values.minute}`;
}

function normalizeId(value: string) {
  const id = value.trim();
  return /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : "";
}

function readDate(value: unknown) {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  return null;
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readScore(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function cursorForEvent(event: TeamScheduleEvent | undefined): TeamHistoryCursor | null {
  if (!event || event.startAt.getTime() <= 0) return null;
  return { id: event.id, timestampMillis: event.startAt.getTime() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scheduleError(code: string) {
  const error = new Error(code);
  (error as { code?: string }).code = code;
  return error;
}
