import { getFirestore } from 'firebase-admin/firestore';
import { FieldValue, GeoPoint } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions/v1';
import { distanceBetween, geohashForLocation, geohashQueryBounds } from 'geofire-common';
import { permanentAccountFunctions } from './permanentAuth';
import { assertValidCoordinates, canonicalVenueId, isPubliclyDiscoverableSquad, normalizeSportId, normalizeVenueName, validateVenueId } from './squadCore';
import { isActiveSquadAdmin } from './squadAdminCore';
import { readSquadSports, squadSportsFields, squadSportsRevision, validateSquadSports } from './squadSportsCore';

const functions = permanentAccountFunctions(firebaseFunctions, 'communication');
const error = (code: firebaseFunctions.https.FunctionsErrorCode, message: string, reason?: string) =>
  new firebaseFunctions.https.HttpsError(code, message, reason ? { reason } : undefined);

// Keep the existing callable name so installed single-sport clients reuse the same community.
export const findOrCreateVenueSportSquad = functions.https.onCall(async (data, context) => {
  const uid = context.auth!.uid;
  const venueName = typeof data?.venueName === 'string' ? data.venueName.trim().replace(/\s+/g, ' ') : '';
  if (venueName.length < 2 || venueName.length > 120) throw error('invalid-argument', 'A valid venue name is required.');
  const latitude = data?.latitude;
  const longitude = data?.longitude;
  try { assertValidCoordinates(latitude, longitude); } catch { throw error('invalid-argument', 'Valid venue coordinates are required.'); }
  const legacySport = normalizeSportId(data?.sportId);
  const sports = data?.sportIds === undefined && legacySport ? [legacySport] : validateSquadSports(data?.sportIds);
  if (!sports) throw error('invalid-argument', 'Select at least one supported sport.');
  const suppliedVenueId = data?.venueId == null ? null : validateVenueId(data.venueId);
  if (data?.venueId != null && !suppliedVenueId) throw error('invalid-argument', 'The venue reference is invalid.');
  const normalizedVenueName = normalizeVenueName(venueName);
  const venueId = suppliedVenueId ?? canonicalVenueId(venueName, latitude, longitude);
  const db = getFirestore();
  const directoryRef = db.doc(`venueSquadDirectory/${venueId}`);
  const bounds = geohashQueryBounds([latitude, longitude], 250);
  const matchesVenue = (squad: FirebaseFirestore.DocumentData) => {
    const point = squad.venueLocation;
    const name = squad.venueName ?? squad.name;
    return isPubliclyDiscoverableSquad(squad) && point instanceof GeoPoint && typeof name === 'string'
      && normalizeVenueName(name) === normalizedVenueName
      && distanceBetween([latitude, longitude], [point.latitude, point.longitude]) * 0.621371 <= 0.15;
  };

  return db.runTransaction(async (transaction) => {
    const directory = await transaction.get(directoryRef);
    const queries = [db.collection('squads').where('venueId', '==', venueId).limit(51),
      ...bounds.map(([lower, upper]) => db.collection('squads').where('venueGeohash', '>=', lower)
        .where('venueGeohash', '<=', upper).where('isActive', '==', true).limit(51))];
    const snapshots = await Promise.all(queries.map((query) => transaction.get(query)));
    if (snapshots.some((snapshot) => snapshot.size === 51)) throw error('failed-precondition', 'This venue requires review.', 'duplicate-candidates');
    const candidates = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    snapshots.forEach((snapshot) => snapshot.docs.forEach((document) => {
      if (matchesVenue(document.data())) candidates.set(document.id, document);
    }));
    if (suppliedVenueId && !snapshots[0].docs.some((document) => matchesVenue(document.data()))) {
      throw error('invalid-argument', 'The venue reference could not be verified.');
    }
    if (directory.exists) {
      const registeredId = directory.data()?.squadId;
      if (typeof registeredId !== 'string' || !/^[A-Za-z0-9_-]{1,360}$/.test(registeredId)) throw error('failed-precondition', 'This venue requires review.');
      const registered = await transaction.get(db.collection('squads').doc(registeredId));
      if (!registered.exists || !matchesVenue(registered.data()!)) throw error('failed-precondition', 'This venue requires review.');
      candidates.set(registered.id, registered);
    }
    if (candidates.size > 1) throw error('failed-precondition', 'Existing Squads at this venue require review before combining.', 'duplicate-candidates');
    const existing = [...candidates.values()][0];
    if (existing) {
      // Finding a venue grants no permission to rewrite its sports or any other Squad fields.
      if (!directory.exists) transaction.create(directoryRef, { venueId, squadId: existing.id });
      return { squadId: existing.id, status: 'existing' as const, sportIds: readSquadSports(existing.data()!) };
    }
    const squadId = `${venueId}__community`;
    const squadRef = db.collection('squads').doc(squadId);
    const occupied = await transaction.get(squadRef);
    if (occupied.exists) throw error('failed-precondition', 'This venue requires review.');
    const timestamp = FieldValue.serverTimestamp();
    transaction.create(squadRef, {
      squadId, name: venueName, venueId, venueName, normalizedVenueName,
      ...squadSportsFields(sports), sportsRevision: 0,
      venueSportKey: `${venueId}__community`, venueLocation: new GeoPoint(latitude, longitude),
      venueGeohash: geohashForLocation([latitude, longitude]),
      memberIds: [], memberCount: 0, activeMemberCount: 0, createdBy: uid,
      createdAt: timestamp, updatedAt: timestamp, isActive: true,
      seasonId: null, currentSeasonId: null, timeZone: null, sponsorId: null, lastActivityAt: null,
    });
    transaction.create(directoryRef, { venueId, squadId });
    return { squadId, status: 'created' as const, sportIds: sports };
  });
});

export const updateSquadSports = functions.region('us-central1').runWith({ enforceAppCheck: true }).https.onCall(async (data, context) => {
  if (!context.app) throw error('failed-precondition', 'App verification is required.');
  const userId = context.auth!.uid;
  const squadId = data?.squadId;
  const sports = validateSquadSports(data?.sportIds);
  const expectedRevision = data?.expectedRevision;
  if (typeof squadId !== 'string' || !/^[A-Za-z0-9_-]{1,360}$/.test(squadId) || !sports
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw error('invalid-argument', 'Valid Squad sports are required.');
  const db = getFirestore();
  return db.runTransaction(async (transaction) => {
    const squadRef = db.collection('squads').doc(squadId);
    const squadSnapshot = await transaction.get(squadRef);
    const memberships = await transaction.get(db.collection('squadMemberships').where('squadId', '==', squadId).where('membershipStatus', '==', 'active'));
    const canonical = await transaction.get(db.collection('squadMemberships').doc(`${squadId}__${userId}`));
    const squad = squadSnapshot.data();
    const membership = canonical.exists ? canonical.data() : memberships.docs.find((document) => document.data().userId === userId)?.data();
    if (!squad || squad.isActive === false || squad.status === 'archived' || squad.status === 'deleted'
      || squad.archivedAt != null || squad.deletedAt != null) throw error('not-found', 'This Squad is unavailable.');
    if (!isActiveSquadAdmin({ squad, membership, squadId, userId })) throw error('permission-denied', 'Only active Squad managers can edit sports.');
    const revision = squadSportsRevision(squad);
    if (revision !== expectedRevision) throw error('aborted', 'The sports list changed. Reload it before saving.', 'sports-conflict');
    const existingSports = readSquadSports(squad);
    if (sports.join('|') === existingSports.join('|')) return { squadId, ...squadSportsFields(sports, squad.sportId), sportsRevision: revision };
    if (revision >= Number.MAX_SAFE_INTEGER) throw error('failed-precondition', 'This Squad requires review.');
    const fields = squadSportsFields(sports, squad.sportId ?? squad.sportDisplayName ?? squad.sport);
    transaction.update(squadRef, { ...fields, sportsRevision: revision + 1, sportsUpdatedBy: userId, updatedAt: FieldValue.serverTimestamp() });
    return { squadId, ...fields, sportsRevision: revision + 1 };
  });
});
