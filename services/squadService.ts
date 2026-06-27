/**
 * squadService.ts
 * All Firestore operations and geo-query logic for the Squad System.
 * Uses geofire-common for Geohash encoding and bounding-box proximity queries.
 */

import { geohashForLocation, geohashQueryBounds, distanceBetween } from 'geofire-common';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
export const STARTING_SOON_MS = 30 * 60 * 1000; // 30 min
export const MILES_TO_METERS = 1609.34;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  // computed client-side after fetch
  distanceMiles?: number;
}

export interface SquadMembership {
  membershipId: string;
  userId: string;
  squadId: string;
  joinedAt: number;
  lastActiveAt: number;
  isActive: boolean;
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

export interface SquadDetail extends Squad {
  members: MemberPreview[];
  extraMemberCount: number;
}

export interface MemberPreview {
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

export type SquadStatus = 'active' | 'starting_soon' | 'quiet';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function encodeGeohash(lat: number, lng: number): string {
  return geohashForLocation([lat, lng]);
}

export function calculateDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  // distanceBetween returns km
  const km = distanceBetween([lat1, lng1], [lat2, lng2]);
  return km * 0.621371;
}

export function getSquadStatus(squad: Squad): SquadStatus {
  const now = Date.now();
  const elapsed = now - squad.lastActivityAt;
  if (elapsed < STARTING_SOON_MS) return 'active';
  if (elapsed < THREE_HOURS_MS) return 'starting_soon';
  return 'quiet';
}

/** Deserialise a Firestore doc snapshot into a Squad object */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docToSquad(id: string, data: Record<string, any>): Squad {
  const gp = data.venueLocation;
  return {
    squadId: id,
    name: data.name ?? '',
    sport: data.sport ?? '',
    venueName: data.venueName ?? '',
    venueLocation: {
      latitude: gp?._latitude ?? gp?.latitude ?? 0,
      longitude: gp?._longitude ?? gp?.longitude ?? 0,
    },
    venueGeohash: data.venueGeohash ?? '',
    memberIds: data.memberIds ?? [],
    activeMemberCount: data.activeMemberCount ?? 0,
    createdBy: data.createdBy ?? '',
    createdAt: data.createdAt?.toMillis?.() ?? data.createdAt ?? 0,
    isActive: data.isActive ?? false,
    seasonId: data.seasonId ?? null,
    sponsorId: data.sponsorId ?? null,
    lastActivityAt: data.lastActivityAt?.toMillis?.() ?? data.lastActivityAt ?? 0,
  };
}

// ---------------------------------------------------------------------------
// App Config
// ---------------------------------------------------------------------------

export async function fetchAppConfig(): Promise<AppConfig> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const doc = await firestore().collection('appConfig').doc('squadConfig').get();
    if (doc.exists) {
      const data = doc.data()!;
      return {
        squadRadiusMiles: data.squadRadiusMiles ?? 2,
        maxSquadsPerUser: data.maxSquadsPerUser ?? 10,
      };
    }
  } catch (err) {
    console.warn('[SquadService] fetchAppConfig error:', err);
  }
  return { squadRadiusMiles: 2, maxSquadsPerUser: 10 };
}

// ---------------------------------------------------------------------------
// Nearby Squads (Geohash bounding-box queries)
// ---------------------------------------------------------------------------

export async function fetchNearbySquads(
  lat: number,
  lng: number,
  radiusMiles: number
): Promise<Squad[]> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const radiusInM = radiusMiles * MILES_TO_METERS;
    const bounds = geohashQueryBounds([lat, lng], radiusInM);

    // Run one Firestore query per bounding pair, then merge & de-dup
    const promises = bounds.map(([lower, upper]: [string, string]) =>
      firestore()
        .collection('squads')
        .where('venueGeohash', '>=', lower)
        .where('venueGeohash', '<=', upper)
        .where('isActive', '==', true)
        .get()
    );

    const snapshots = await Promise.all(promises);

    const seen = new Set<string>();
    const squads: Squad[] = [];

    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);

        const squad = docToSquad(doc.id, doc.data() as Record<string, unknown>);

        // Client-side: confirm it's within radius (geohash bounding box overshoots corners)
        const dist = calculateDistanceMiles(lat, lng, squad.venueLocation.latitude, squad.venueLocation.longitude);
        if (dist > radiusMiles) continue;

        // Filter: must have had activity within 3 hours (or be starting soon)
        const age = Date.now() - squad.lastActivityAt;
        if (age > THREE_HOURS_MS) continue;

        squad.distanceMiles = dist;
        squads.push(squad);
      }
    }

    // Sort by distance (closest first)
    squads.sort((a, b) => (a.distanceMiles ?? 0) - (b.distanceMiles ?? 0));
    return squads;
  } catch (err) {
    console.warn('[SquadService] fetchNearbySquads error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Join Squad
// ---------------------------------------------------------------------------

export async function joinSquad(
  userId: string,
  squadId: string,
  isFirstSquadEver: boolean
): Promise<void> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const fs = firestore();
    const now = Date.now();
    const membershipId = fs.collection('squadMemberships').doc().id;

    const batch = fs.batch();

    // Update squad: add userId + update lastActivityAt
    batch.update(fs.collection('squads').doc(squadId), {
      memberIds: firestore.FieldValue.arrayUnion(userId),
      lastActivityAt: now,
    });

    // Create squadMembership document
    batch.set(fs.collection('squadMemberships').doc(membershipId), {
      membershipId,
      userId,
      squadId,
      joinedAt: now,
      lastActiveAt: now,
      isActive: true,
    });

    // Update user's squadIds array
    batch.update(fs.collection('users').doc(userId), {
      squadIds: firestore.FieldValue.arrayUnion(squadId),
    });

    await batch.commit();

    // Award Sideline Stars + post activity
    // TODO: Call Cloud Function `onSquadJoin` once deployed
    // For now, award stars inline:
    const starsToAward = isFirstSquadEver ? 100 : 25;
    await fs.collection('users').doc(userId).update({
      sidelineStars: firestore.FieldValue.increment(starsToAward),
    });

    // Post join activity
    await fs.collection('activity').add({
      type: 'squad_join',
      userId,
      squadId,
      createdAt: now,
    });
  } catch (err) {
    console.warn('[SquadService] joinSquad error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Create Squad
// ---------------------------------------------------------------------------

export async function createSquad(
  data: CreateSquadInput,
  userId: string
): Promise<string> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const fs = firestore();
    const now = Date.now();
    const squadRef = fs.collection('squads').doc();
    const squadId = squadRef.id;
    const membershipId = fs.collection('squadMemberships').doc().id;
    const geohash = encodeGeohash(data.venueLocation.latitude, data.venueLocation.longitude);

    const batch = fs.batch();

    // Create squad document
    batch.set(squadRef, {
      squadId,
      name: data.name,
      sport: data.sport,
      venueName: data.venueName,
      venueLocation: new firestore.GeoPoint(
        data.venueLocation.latitude,
        data.venueLocation.longitude
      ),
      venueGeohash: geohash,
      memberIds: [userId],
      activeMemberCount: 1,
      createdBy: userId,
      createdAt: now,
      isActive: true,
      seasonId: null,
      sponsorId: null,
      lastActivityAt: now,
    });

    // Create membership for creator
    batch.set(fs.collection('squadMemberships').doc(membershipId), {
      membershipId,
      userId,
      squadId,
      joinedAt: now,
      lastActiveAt: now,
      isActive: true,
    });

    // Update user's squadIds
    batch.update(fs.collection('users').doc(userId), {
      squadIds: firestore.FieldValue.arrayUnion(squadId),
    });

    await batch.commit();
    return squadId;
  } catch (err) {
    console.warn('[SquadService] createSquad error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Leave Squad
// ---------------------------------------------------------------------------

export async function leaveSquad(userId: string, squadId: string): Promise<void> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const fs = firestore();

    // Find the membership document
    const membershipSnap = await fs
      .collection('squadMemberships')
      .where('userId', '==', userId)
      .where('squadId', '==', squadId)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    const batch = fs.batch();

    membershipSnap.docs.forEach((doc) => {
      batch.update(doc.ref, { isActive: false });
    });

    batch.update(fs.collection('squads').doc(squadId), {
      memberIds: firestore.FieldValue.arrayRemove(userId),
    });

    batch.update(fs.collection('users').doc(userId), {
      squadIds: firestore.FieldValue.arrayRemove(squadId),
    });

    await batch.commit();
  } catch (err) {
    console.warn('[SquadService] leaveSquad error:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Update lastActiveAt (call on app foreground)
// ---------------------------------------------------------------------------

export async function updateMemberLastActive(userId: string): Promise<void> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const fs = firestore();
    const now = Date.now();

    const snap = await fs
      .collection('squadMemberships')
      .where('userId', '==', userId)
      .where('isActive', '==', true)
      .get();

    if (snap.empty) return;

    const batch = fs.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, { lastActiveAt: now });
    });
    await batch.commit();
  } catch (err) {
    console.warn('[SquadService] updateMemberLastActive error:', err);
  }
}

// ---------------------------------------------------------------------------
// Squad Detail
// ---------------------------------------------------------------------------

export async function fetchSquadDetail(squadId: string): Promise<SquadDetail | null> {
  try {
    const firestore = (await import('@react-native-firebase/firestore')).default;
    const fs = firestore();

    const squadDoc = await fs.collection('squads').doc(squadId).get();
    if (!squadDoc.exists) return null;

    const squad = docToSquad(squadDoc.id, squadDoc.data() as Record<string, unknown>);

    // Fetch first 9 member profiles
    const memberIdsToFetch = squad.memberIds.slice(0, 9);
    const memberDocs = await Promise.all(
      memberIdsToFetch.map((uid) => fs.collection('users').doc(uid).get())
    );

    const members: MemberPreview[] = memberDocs
      .filter((d) => d.exists)
      .map((d) => {
        const data = d.data()!;
        return {
          uid: d.id,
          displayName: data.displayName ?? data.firstName ?? null,
          photoURL: data.photoURL ?? null,
        };
      });

    const extraMemberCount = Math.max(0, squad.memberIds.length - 8);

    return { ...squad, members: members.slice(0, 8), extraMemberCount };
  } catch (err) {
    console.warn('[SquadService] fetchSquadDetail error:', err);
    return null;
  }
}