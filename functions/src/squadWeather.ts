import { getFirestore } from 'firebase-admin/firestore';
import * as firebaseFunctions from 'firebase-functions/v1';
import { FieldValue } from 'firebase-admin/firestore';
import { permanentAccountFunctions } from './permanentAuth';
import { isActiveSquadAdmin, isDurablyActiveSquadMembership } from './squadAdminCore';
import { isActiveSquadRecord, isPubliclyDiscoverableSquad } from './squadCore';
import { isTeamActive } from './teamMembershipCore';
import { parseSquadWeatherLink, squadWeatherView } from './squadWeatherCore';

const fail = (code: firebaseFunctions.https.FunctionsErrorCode, message: string) => new firebaseFunctions.https.HttpsError(code, message);
const readId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,360}$/.test(value)) throw fail('invalid-argument', 'Invalid Squad or Team reference.');
  return value;
};
const readers = permanentAccountFunctions(firebaseFunctions, 'app').region('us-central1').runWith({ enforceAppCheck: true });
const writers = permanentAccountFunctions(firebaseFunctions, 'communication').region('us-central1').runWith({ enforceAppCheck: true });

export const getSquadWeather = readers.https.onCall(async (data, context) => {
  if (!context.app) throw fail('failed-precondition', 'App verification is required.');
  const squadId = readId(data?.squadId), uid = context.auth!.uid;
  const db = getFirestore();
  const snapshot = await db.doc(`squads/${squadId}`).get(), squad = snapshot.data();
  if (!squad || !isActiveSquadRecord(squad)) throw fail('not-found', 'This Squad is unavailable.');
  if (!isPubliclyDiscoverableSquad(squad)) {
    const [canonical, members] = await Promise.all([
      db.doc(`squadMemberships/${squadId}__${uid}`).get(),
      db.collection('squadMemberships').where('squadId', '==', squadId).where('userId', '==', uid).limit(2).get(),
    ]);
    const membership = canonical.exists ? canonical.data() : members.size === 1 ? members.docs[0].data() : undefined;
    let authorized = isDurablyActiveSquadMembership({ membership, squadId, userId: uid });
    if (!authorized && data?.teamId != null) {
      const teamId = readId(data.teamId), teamRef = db.doc(`teams/${teamId}`);
      const [team, member] = await Promise.all([teamRef.get(), teamRef.collection('members').doc(uid).get()]);
      authorized = Boolean(team.data()?.squadId === squadId && isTeamActive(team.data()) && member.data()?.status === 'active');
    }
    if (!authorized) throw fail('permission-denied', 'This Squad is unavailable.');
  }
  // This projection contains public venue information only, never members or editor IDs.
  try { return squadWeatherView(squadId, squad); } catch { throw fail('failed-precondition', 'The venue link requires review.'); }
});

export const updateSquadWeather = writers.https.onCall(async (data, context) => {
  if (!context.app) throw fail('failed-precondition', 'App verification is required.');
  const squadId = readId(data?.squadId), uid = context.auth!.uid, expectedRevision = data?.expectedRevision;
  const link = data?.link === null ? null : parseSquadWeatherLink(data?.link);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || (data?.link !== null && (!link || data?.confirmedVenue !== true))) {
    throw fail('invalid-argument', 'Confirm a valid public venue link before saving.');
  }
  const db = getFirestore(), squadRef = db.doc(`squads/${squadId}`);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(squadRef), squad = snapshot.data();
    const canonical = await transaction.get(db.doc(`squadMemberships/${squadId}__${uid}`));
    const memberships = await transaction.get(db.collection('squadMemberships').where('squadId', '==', squadId).where('userId', '==', uid).limit(2));
    const membership = canonical.exists ? canonical.data() : memberships.size === 1 ? memberships.docs[0].data() : undefined;
    if (!squad || !isActiveSquadRecord(squad)) throw fail('not-found', 'This Squad is unavailable.');
    if (!isActiveSquadAdmin({ squad, membership, squadId, userId: uid })) {
      throw fail('permission-denied', 'Only active Squad admins can edit this venue link.');
    }
    let current;
    try { current = squadWeatherView(squadId, squad); } catch { throw fail('failed-precondition', 'The venue link requires review.'); }
    if (current.revision !== expectedRevision) throw fail('aborted', 'Another admin changed this link. Reload before saving.');
    if (current.mode !== 'default' && JSON.stringify(current.link) === JSON.stringify(link)) return current;
    if (current.revision >= Number.MAX_SAFE_INTEGER) throw fail('failed-precondition', 'The venue link requires review.');
    const revision = current.revision + 1;
    transaction.update(squadRef, { weatherLink: link, weatherLinkRevision: revision, weatherLinkUpdatedBy: uid, updatedAt: FieldValue.serverTimestamp() });
    transaction.create(squadRef.collection('weatherLinkChanges').doc(String(revision)), {
      revision, changedBy: uid, changedAt: FieldValue.serverTimestamp(), operation: link ? 'save' : 'remove',
    });
    return { ...current, revision, mode: link ? 'custom' as const : 'disabled' as const, link };
  });
});
