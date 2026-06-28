import * as Location from "expo-location";
import { geohashForLocation, geohashQueryBounds, distanceBetween } from "geofire-common";
import {
  GeoPoint,
  Timestamp,
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/config/firebase";

export const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
export const STARTING_SOON_MS = 30 * 60 * 1000;
export const MILES_TO_METERS = 1609.34;

export interface Squad {
  squadId: string;
  name: string;
  sport: string;
  venueName: string;
  venueLocation: { latitude: number; longitude: number };
  venueGeohash: string;
  memberIds: string[];
  activeMemberCount: number;
  createdBy: string;
  createdAt: number;
  isActive: boolean;
  seasonId: string | null;
  sponsorId: string | null;
  lastActivityAt: number;
  distanceMiles?: number;
}

export interface CreateSquadInput {
  name: string;
  sport: string;
  venueName: string;
  venueLocation: { latitude: number; longitude: number };
}

export interface AppConfig {
  squadRadiusMiles: number;
  maxSquadsPerUser: number;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type LocationPermissionState = "undetermined" | "granted" | "denied";

export interface CurrentLocationResult {
  coords: Coordinates | null;
  error: "services_disabled" | "unavailable" | null;
  mocked: boolean;
  timestamp: number | null;
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

function toMillis(value: FirestoreDate): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function readPoint(value: unknown): { latitude: number; longitude: number } {
  if (value instanceof GeoPoint) {
    return { latitude: value.latitude, longitude: value.longitude };
  }

  const data = value as { latitude?: number; longitude?: number; _latitude?: number; _longitude?: number } | null;
  return {
    latitude: data?.latitude ?? data?._latitude ?? 0,
    longitude: data?.longitude ?? data?._longitude ?? 0,
  };
}

function docToSquad(id: string, data: Record<string, unknown>): Squad {
  return {
    squadId: id,
    name: (data.name as string) ?? "",
    sport: (data.sport as string) ?? "",
    venueName: (data.venueName as string) ?? "",
    venueLocation: readPoint(data.venueLocation),
    venueGeohash: (data.venueGeohash as string) ?? "",
    memberIds: (data.memberIds as string[]) ?? [],
    activeMemberCount: (data.activeMemberCount as number) ?? 0,
    createdBy: (data.createdBy as string) ?? "",
    createdAt: toMillis(data.createdAt as FirestoreDate),
    isActive: (data.isActive as boolean) ?? false,
    seasonId: (data.seasonId as string | null) ?? null,
    sponsorId: (data.sponsorId as string | null) ?? null,
    lastActivityAt: toMillis(data.lastActivityAt as FirestoreDate),
  };
}

export function encodeGeohash(lat: number, lng: number): string {
  return geohashForLocation([lat, lng]);
}

export function calculateDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return distanceBetween([lat1, lng1], [lat2, lng2]) * 0.621371;
}

export function getSquadStatus(squad: Squad): SquadStatus {
  const elapsed = Date.now() - squad.lastActivityAt;
  if (elapsed < STARTING_SOON_MS) return "active";
  if (elapsed < THREE_HOURS_MS) return "starting_soon";
  return "quiet";
}
function normalizePermissionStatus(status: Location.PermissionStatus): LocationPermissionState {
  if (status === Location.PermissionStatus.GRANTED) return "granted";
  if (status === Location.PermissionStatus.DENIED) return "denied";
  return "undetermined";
}

export async function getLocationPermissionStatus(): Promise<LocationPermissionState> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    return normalizePermissionStatus(permission.status);
  } catch (error) {
    console.warn("[SquadService] getLocationPermissionStatus error:", error);
    return "undetermined";
  }
}

export async function requestLocationPermission(): Promise<LocationPermissionState> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    return normalizePermissionStatus(permission.status);
  } catch (error) {
    console.warn("[SquadService] requestLocationPermission error:", error);
    return "denied";
  }
}

export async function getCurrentLocation(): Promise<CurrentLocationResult> {
  try {
    const servicesEnabled = await Location.hasServicesEnabledAsync();
    if (!servicesEnabled) {
      return { coords: null, error: "services_disabled", mocked: false, timestamp: null };
    }

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
      mayShowUserSettingsDialog: true,
    });

    const mocked = "mocked" in position ? Boolean(position.mocked) : false;

    return {
      coords: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      },
      error: null,
      mocked,
      timestamp: position.timestamp ?? null,
    };
  } catch (error) {
    console.warn("[SquadService] getCurrentLocation error:", error);
    return { coords: null, error: "unavailable", mocked: false, timestamp: null };
  }
}

export async function updateUserLocation(userId: string, coords: Coordinates): Promise<void> {
  if (!userId) return;
  if (!Number.isFinite(coords.latitude) || !Number.isFinite(coords.longitude)) return;

  try {
    await setDoc(doc(db, "users", userId), {
      location: new GeoPoint(coords.latitude, coords.longitude),
      locationGeohash: encodeGeohash(coords.latitude, coords.longitude),
      locationUpdatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    console.warn("[SquadService] updateUserLocation error:", error);
  }
}

export async function findNearbySquads(coords: Coordinates, radiusMiles: number): Promise<Squad[]> {
  return fetchNearbySquads(coords.latitude, coords.longitude, radiusMiles);
}

export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const snap = await getDoc(doc(db, "appConfig", "squadConfig"));
    if (!snap.exists()) return { squadRadiusMiles: 2, maxSquadsPerUser: 10 };
    const data = snap.data();
    return {
      squadRadiusMiles: data.squadRadiusMiles ?? 2,
      maxSquadsPerUser: data.maxSquadsPerUser ?? 10,
    };
  } catch (error) {
    console.warn("[SquadService] fetchAppConfig error:", error);
    return { squadRadiusMiles: 2, maxSquadsPerUser: 10 };
  }
}

export async function fetchUserSquadIds(userId: string): Promise<string[]> {
  try {
    const snap = await getDoc(doc(db, "users", userId));
    return snap.exists() ? ((snap.data().squadIds as string[]) ?? []) : [];
  } catch (error) {
    console.warn("[SquadService] fetchUserSquadIds error:", error);
    return [];
  }
}

export async function fetchNearbySquads(lat: number, lng: number, radiusMiles: number): Promise<Squad[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radiusMiles)) return [];

  try {
    const radiusInMeters = radiusMiles * MILES_TO_METERS;
    const bounds = geohashQueryBounds([lat, lng], radiusInMeters);
    const squadsRef = collection(db, "squads");

    const snapshots = await Promise.all(
      bounds.map(([lower, upper]) =>
        getDocs(query(
          squadsRef,
          where("venueGeohash", ">=", lower),
          where("venueGeohash", "<=", upper),
          where("isActive", "==", true)
        ))
      )
    );

    const seen = new Set<string>();
    const squads: Squad[] = [];

    snapshots.forEach((snap) => {
      snap.docs.forEach((squadDoc) => {
        if (seen.has(squadDoc.id)) return;
        seen.add(squadDoc.id);

        const squad = docToSquad(squadDoc.id, squadDoc.data());
        const distanceMiles = calculateDistanceMiles(
          lat,
          lng,
          squad.venueLocation.latitude,
          squad.venueLocation.longitude
        );

        if (distanceMiles > radiusMiles) return;
        if (Date.now() - squad.lastActivityAt > THREE_HOURS_MS) return;

        squads.push({ ...squad, distanceMiles });
      });
    });

    return squads.sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
  } catch (error) {
    console.warn("[SquadService] fetchNearbySquads error:", error);
    return [];
  }
}

export async function joinSquad(userId: string, squadId: string, isFirstSquadEver: boolean): Promise<void> {
  const membershipRef = doc(collection(db, "squadMemberships"));
  const squadRef = doc(db, "squads", squadId);
  const userRef = doc(db, "users", userId);
  const batch = writeBatch(db);

  batch.update(squadRef, {
    memberIds: arrayUnion(userId),
    lastActivityAt: serverTimestamp(),
  });
  batch.set(membershipRef, {
    membershipId: membershipRef.id,
    userId,
    squadId,
    joinedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    isActive: true,
  });
  batch.set(userRef, {
    squadIds: arrayUnion(squadId),
    sidelineStars: increment(isFirstSquadEver ? 100 : 25),
  }, { merge: true });

  await batch.commit();
  await addDoc(collection(db, "activity"), {
    type: "squad_join",
    userId,
    squadId,
    createdAt: serverTimestamp(),
  });
}

export async function createSquad(input: CreateSquadInput, userId: string): Promise<string> {
  const squadRef = doc(collection(db, "squads"));
  const membershipRef = doc(collection(db, "squadMemberships"));
  const userRef = doc(db, "users", userId);
  const geohash = encodeGeohash(input.venueLocation.latitude, input.venueLocation.longitude);
  const batch = writeBatch(db);

  batch.set(squadRef, {
    squadId: squadRef.id,
    name: input.name,
    sport: input.sport,
    venueName: input.venueName,
    venueLocation: new GeoPoint(input.venueLocation.latitude, input.venueLocation.longitude),
    venueGeohash: geohash,
    memberIds: [userId],
    activeMemberCount: 1,
    createdBy: userId,
    createdAt: serverTimestamp(),
    isActive: true,
    seasonId: null,
    sponsorId: null,
    lastActivityAt: serverTimestamp(),
  });
  batch.set(membershipRef, {
    membershipId: membershipRef.id,
    userId,
    squadId: squadRef.id,
    joinedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp(),
    isActive: true,
  });
  batch.set(userRef, { squadIds: arrayUnion(squadRef.id) }, { merge: true });

  await batch.commit();
  return squadRef.id;
}

export async function leaveSquad(userId: string, squadId: string): Promise<void> {
  const memberships = await getDocs(query(
    collection(db, "squadMemberships"),
    where("userId", "==", userId),
    where("squadId", "==", squadId),
    where("isActive", "==", true),
    limit(1)
  ));

  const batch = writeBatch(db);
  memberships.docs.forEach((membershipDoc) => batch.update(membershipDoc.ref, { isActive: false }));
  batch.update(doc(db, "squads", squadId), { memberIds: arrayRemove(userId) });
  batch.set(doc(db, "users", userId), { squadIds: arrayRemove(squadId) }, { merge: true });
  await batch.commit();
}

export async function updateMemberLastActive(userId: string): Promise<void> {
  try {
    const memberships = await getDocs(query(
      collection(db, "squadMemberships"),
      where("userId", "==", userId),
      where("isActive", "==", true)
    ));
    if (memberships.empty) return;

    const batch = writeBatch(db);
    memberships.docs.forEach((membershipDoc) => batch.update(membershipDoc.ref, { lastActiveAt: serverTimestamp() }));
    await batch.commit();
  } catch (error) {
    console.warn("[SquadService] updateMemberLastActive error:", error);
  }
}

export async function fetchSquadDetail(squadId: string): Promise<SquadDetail | null> {
  try {
    const squadSnap = await getDoc(doc(db, "squads", squadId));
    if (!squadSnap.exists()) return null;

    const squad = docToSquad(squadSnap.id, squadSnap.data());
    const memberIds = squad.memberIds.slice(0, 8);
    const memberSnaps = await Promise.all(memberIds.map((uid) => getDoc(doc(db, "users", uid))));
    const members = memberSnaps
      .filter((snap) => snap.exists())
      .map((snap) => {
        const data = snap.data() ?? {};
        return {
          uid: snap.id,
          displayName: (data.displayName as string) ?? (data.firstName as string) ?? null,
          photoURL: (data.photoURL as string) ?? null,
        };
      });

    return {
      ...squad,
      members,
      extraMemberCount: Math.max(0, squad.memberIds.length - members.length),
    };
  } catch (error) {
    console.warn("[SquadService] fetchSquadDetail error:", error);
    return null;
  }
}