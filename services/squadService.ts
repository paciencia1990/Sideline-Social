import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { httpsCallable } from "firebase/functions";
import {
  GeoPoint,
  Timestamp,
  doc,
  getDoc,
  type DocumentData,
} from "firebase/firestore";

import { db, functions } from "@/config/firebase";
import {
  getSquadSportOption,
  normalizeSquadSportId,
  type SquadSportId,
} from "@/constants/sports";
import { getPublicUserProfiles } from "@/services/publicProfileService";
import { getSafeProfileName } from "@/utils/friendPrivacy";

export const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
export const STARTING_SOON_MS = 30 * 60 * 1000;
const LOCATION_TIMEOUT_MS = 12_000;
const LAST_LOCATION_MAX_AGE_MS = 5 * 60 * 1000;

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Squad {
  squadId: string;
  venueId: string;
  venueName: string;
  normalizedVenueName: string;
  sportId: SquadSportId;
  sportDisplayName: string;
  venueSportKey: string | null;
  venueLocation: Coordinates;
  venueGeohash: string;
  memberIds: string[];
  memberCount: number;
  activeMemberCount: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  lastActivityAt: number;
  currentSeasonId: string | null;
  timeZone: string | null;
  distanceMiles?: number;
  // Compatibility aliases for legacy UI and stored documents.
  name: string;
  sport: string;
}

export interface CreateSquadInput {
  venueId?: string;
  venueName: string;
  sportId: SquadSportId;
  venueLocation: Coordinates;
}

export interface FindOrCreateSquadResult {
  squadId: string;
  status: "existing" | "created";
}

export interface AppConfig {
  squadRadiusMiles: number;
  maxSquadsPerUser: number;
}

export interface UserSquadState {
  squadIds: string[];
  selectedSquadId: string | null;
}

export type LocationPermissionState = "undetermined" | "granted" | "denied";

export interface LocationPermissionResult {
  status: LocationPermissionState;
  canAskAgain: boolean;
}

export interface CurrentLocationResult {
  coords: Coordinates | null;
  error: "services_disabled" | "timeout" | "unavailable" | null;
  mocked: boolean;
  timestamp: number | null;
  source: "current" | "last-known" | null;
}

export interface MemberPreview {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

export interface SquadDetail extends Squad {
  members: MemberPreview[];
  extraMemberCount: number;
}

export type SquadStatus = "active" | "starting_soon" | "quiet";

type FirestoreDate = Timestamp | number | Date | null | undefined;
type NearbyResponse = { squads: Record<string, unknown>[]; radiusMiles: number };
type SearchResponse = { squads: Record<string, unknown>[] };

function toMillis(value: FirestoreDate): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function readPoint(value: unknown): Coordinates {
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  const data = value as { latitude?: number; longitude?: number; _latitude?: number; _longitude?: number } | null;
  return {
    latitude: data?.latitude ?? data?._latitude ?? 0,
    longitude: data?.longitude ?? data?._longitude ?? 0,
  };
}

export function normalizeSquadDocument(id: string, data: DocumentData): Squad {
  const venueName = readString(data.venueName) || readString(data.name) || "Sports Venue";
  const sportId = normalizeSquadSportId(data.sportId ?? data.sportDisplayName ?? data.sport);
  const sportOption = getSquadSportOption(sportId);
  const memberIds = readStringArray(data.memberIds);
  return {
    squadId: id,
    venueId: readString(data.venueId) || `legacy_${id}`,
    venueName,
    normalizedVenueName: readString(data.normalizedVenueName),
    sportId,
    sportDisplayName: readString(data.sportDisplayName) || sportOption.englishName,
    venueSportKey: readString(data.venueSportKey) || null,
    venueLocation: readPoint(data.venueLocation),
    venueGeohash: readString(data.venueGeohash),
    memberIds,
    memberCount: readFiniteNumber(data.memberCount, memberIds.length),
    activeMemberCount: readFiniteNumber(data.activeMemberCount, 0),
    createdBy: readString(data.createdBy),
    createdAt: toMillis(data.createdAt as FirestoreDate),
    updatedAt: toMillis(data.updatedAt as FirestoreDate),
    isActive: data.isActive !== false,
    lastActivityAt: toMillis(data.lastActivityAt as FirestoreDate),
    currentSeasonId: readString(data.currentSeasonId) || null,
    timeZone: readString(data.timeZone) || null,
    distanceMiles: typeof data.distanceMiles === "number" ? data.distanceMiles : undefined,
    name: venueName,
    sport: sportOption.englishName,
  };
}

export function getSquadStatus(squad: Squad): SquadStatus {
  if (!squad.lastActivityAt) return "quiet";
  const elapsed = Date.now() - squad.lastActivityAt;
  if (elapsed < STARTING_SOON_MS) return "active";
  if (elapsed < THREE_HOURS_MS) return "starting_soon";
  return "quiet";
}

function normalizePermission(permission: Location.LocationPermissionResponse): LocationPermissionResult {
  const status = permission.status === Location.PermissionStatus.GRANTED
    ? "granted"
    : permission.status === Location.PermissionStatus.DENIED
      ? "denied"
      : "undetermined";
  return { status, canAskAgain: permission.canAskAgain };
}

export async function getLocationPermissionStatus(): Promise<LocationPermissionResult> {
  try {
    return normalizePermission(await Location.getForegroundPermissionsAsync());
  } catch (error) {
    logSquadDiagnostic("permission-status", error);
    return { status: "undetermined", canAskAgain: true };
  }
}

export async function requestLocationPermission(): Promise<LocationPermissionResult> {
  try {
    return normalizePermission(await Location.requestForegroundPermissionsAsync());
  } catch (error) {
    logSquadDiagnostic("permission-request", error);
    return { status: "denied", canAskAgain: false };
  }
}

export async function getCurrentLocation(): Promise<CurrentLocationResult> {
  try {
    if (!(await Location.hasServicesEnabledAsync())) {
      return emptyLocation("services_disabled");
    }
    try {
      const position = await withTimeout(
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          mayShowUserSettingsDialog: true,
        }),
        LOCATION_TIMEOUT_MS,
      );
      return locationResult(position, "current");
    } catch (error) {
      const lastKnown = await Location.getLastKnownPositionAsync({
        maxAge: LAST_LOCATION_MAX_AGE_MS,
        requiredAccuracy: 1000,
      });
      if (lastKnown) return locationResult(lastKnown, "last-known");
      logSquadDiagnostic(error instanceof LocationTimeoutError ? "location-timeout" : "location-current", error);
      return emptyLocation(error instanceof LocationTimeoutError ? "timeout" : "unavailable");
    }
  } catch (error) {
    logSquadDiagnostic("location-services", error);
    return emptyLocation("unavailable");
  }
}

export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const snapshot = await getDoc(doc(db, "appConfig", "squadConfig"));
    const data = snapshot.data();
    return {
      squadRadiusMiles: readFiniteNumber(data?.squadRadiusMiles, 2),
      maxSquadsPerUser: readFiniteNumber(data?.maxSquadsPerUser, 10),
    };
  } catch (error) {
    logSquadDiagnostic("config", error);
    return { squadRadiusMiles: 2, maxSquadsPerUser: 10 };
  }
}

export async function fetchUserSquadState(userId: string): Promise<UserSquadState> {
  if (!userId) return { squadIds: [], selectedSquadId: null };
  try {
    const snapshot = await getDoc(doc(db, "users", userId));
    const squadIds = readStringArray(snapshot.data()?.squadIds);
    const serverSelected = readString(snapshot.data()?.selectedSquadId) || null;
    const localSelected = await AsyncStorage.getItem(selectedSquadStorageKey(userId));
    const selectedSquadId = [serverSelected, localSelected].find((candidate) => candidate && squadIds.includes(candidate)) ?? null;
    return { squadIds, selectedSquadId };
  } catch (error) {
    logSquadDiagnostic("membership-state", error);
    return { squadIds: [], selectedSquadId: null };
  }
}

export async function fetchUserSquadIds(userId: string): Promise<string[]> {
  return (await fetchUserSquadState(userId)).squadIds;
}

export async function fetchSquadsByIds(squadIds: string[]): Promise<Squad[]> {
  const uniqueIds = Array.from(new Set(squadIds)).slice(0, 25);
  const snapshots = await Promise.all(uniqueIds.map((squadId) => getDoc(doc(db, "squads", squadId))));
  return snapshots.flatMap((snapshot) => {
    const data = snapshot.data();
    return data && data.isActive !== false ? [normalizeSquadDocument(snapshot.id, data)] : [];
  });
}

export async function fetchNearbySquads(lat: number, lng: number, radiusMiles: number): Promise<Squad[]> {
  const callable = httpsCallable<
    { latitude: number; longitude: number; radiusMiles: number },
    NearbyResponse
  >(functions, "findNearbyVenueSportSquads");
  const response = await callable({ latitude: lat, longitude: lng, radiusMiles });
  return response.data.squads.map((data) => normalizeSquadDocument(readString(data.squadId), data));
}

export async function findNearbySquads(coords: Coordinates, radiusMiles: number): Promise<Squad[]> {
  return fetchNearbySquads(coords.latitude, coords.longitude, radiusMiles);
}

export async function searchVenueSquads(queryText: string): Promise<Squad[]> {
  const callable = httpsCallable<{ queryText: string }, SearchResponse>(functions, "searchVenueSportSquads");
  const response = await callable({ queryText: queryText.trim() });
  return response.data.squads.map((data) => normalizeSquadDocument(readString(data.squadId), data));
}

export async function findOrCreateSquad(input: CreateSquadInput): Promise<FindOrCreateSquadResult> {
  const callable = httpsCallable<
    { venueId?: string; venueName: string; latitude: number; longitude: number; sportId: SquadSportId },
    FindOrCreateSquadResult
  >(functions, "findOrCreateVenueSportSquad");
  const response = await callable({
    venueId: input.venueId,
    venueName: input.venueName.trim(),
    latitude: input.venueLocation.latitude,
    longitude: input.venueLocation.longitude,
    sportId: input.sportId,
  });
  return response.data;
}

export async function joinSquad(squadId: string): Promise<{ selectedSquadId: string; status: "existing" | "joined" }> {
  const callable = httpsCallable<
    { squadId: string },
    { selectedSquadId: string; status: "existing" | "joined" }
  >(functions, "joinVenueSportSquad");
  return (await callable({ squadId })).data;
}

export async function leaveSquad(squadId: string): Promise<{ selectedSquadId: string | null }> {
  const callable = httpsCallable<{ squadId: string }, { selectedSquadId: string | null }>(functions, "leaveVenueSportSquad");
  return (await callable({ squadId })).data;
}

export async function persistSelectedSquad(userId: string, squadId: string | null): Promise<void> {
  if (squadId) await AsyncStorage.setItem(selectedSquadStorageKey(userId), squadId);
  else await AsyncStorage.removeItem(selectedSquadStorageKey(userId));
  const callable = httpsCallable<{ squadId: string | null }, { selectedSquadId: string | null }>(functions, "setSelectedSquad");
  await callable({ squadId });
}

export async function updateMemberLastActive(): Promise<void> {
  const callable = httpsCallable<Record<string, never>, { updatedCount: number }>(functions, "refreshSquadPresence");
  await callable({});
}

export async function fetchSquadDetail(squadId: string): Promise<SquadDetail | null> {
  try {
    const snapshot = await getDoc(doc(db, "squads", squadId));
    if (!snapshot.exists()) return null;
    const squad = normalizeSquadDocument(snapshot.id, snapshot.data());
    const publicProfiles = await getPublicUserProfiles(squad.memberIds.slice(0, 8));
    const members = publicProfiles.map((profile) => ({
      uid: profile.userId,
      displayName: getSafeProfileName(profile.displayName),
      photoURL: null,
    }));
    return { ...squad, members, extraMemberCount: Math.max(0, squad.memberCount - members.length) };
  } catch (error) {
    logSquadDiagnostic("detail", error);
    return null;
  }
}

function selectedSquadStorageKey(userId: string) {
  return `sideline:selectedSquad:${userId}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0)))
    : [];
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function locationResult(position: Location.LocationObject, source: "current" | "last-known"): CurrentLocationResult {
  return {
    coords: { latitude: position.coords.latitude, longitude: position.coords.longitude },
    error: null,
    mocked: Boolean(position.mocked),
    timestamp: position.timestamp ?? null,
    source,
  };
}

function emptyLocation(error: CurrentLocationResult["error"]): CurrentLocationResult {
  return { coords: null, error, mocked: false, timestamp: null, source: null };
}

class LocationTimeoutError extends Error {}

async function withTimeout<T>(request: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new LocationTimeoutError("Location request timed out.")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function logSquadDiagnostic(operation: string, error: unknown) {
  if (!__DEV__) return;
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "unknown";
  console.info("[SquadDiagnostic]", { operation, code });
}
