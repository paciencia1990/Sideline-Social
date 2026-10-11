import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { requireAccountCapability, requirePermanentUid } from './permanentAuth';
import { canAccessTeamAnnouncement, hasParentRole, isTeamActive } from './teamMembershipCore';
import { isExplicitConversationParticipant } from './teamVoiceMessagingCore';
import { createTranslationEngine, nextTranslationUsage, parseTranslationRequest, type TranslationRequest } from './teamTranslationCore';

const unavailable = () => new functions.https.HttpsError('unavailable', 'Translation is temporarily unavailable.');
const denied = () => new functions.https.HttpsError('permission-denied', 'This message is unavailable.');
const visible = (data: FirebaseFirestore.DocumentData | undefined) => data && data.isDeleted !== true &&
  data.moderationState !== 'hidden' && data.moderationState !== 'removed';

export async function loadAuthorizedTranslationText(uid: string, request: TranslationRequest) {
  await requireAccountCapability(uid, 'app'); // Reading remains available during a messaging restriction.
  const db = admin.firestore();
  if (request.kind === 'announcement') {
    const teamRef = db.collection('teams').doc(request.teamId);
    const [team, member, message] = await Promise.all([
      teamRef.get(), teamRef.collection('members').doc(uid).get(),
      teamRef.collection('announcements').doc(request.messageId).get(),
    ]);
    const data = message.data();
    if (!team.exists || !isTeamActive(team.data()) || !hasParentRole(member.data()) ||
      !canAccessTeamAnnouncement(member.data(), data?.audience) || !visible(data) || data?.createdBy === uid) throw denied();
    return { text: [data?.title, data?.body].filter((value) => typeof value === 'string' && value.trim()).map((value) => (value as string).trim()).join('\n\n'),
      inviteCode: typeof team.data()?.inviteCode === 'string' ? team.data()?.inviteCode as string : undefined };
  }
  const conversationRef = db.collection('teamPrivateConversations').doc(request.conversationId);
  const [conversation, message, hidden] = await Promise.all([
    conversationRef.get(), conversationRef.collection('messages').doc(request.messageId).get(),
    conversationRef.collection('members').doc(uid).collection('hiddenMessages').doc(request.messageId).get(),
  ]);
  const conversationData = conversation.data();
  const data = message.data();
  if (!conversation.exists || !isExplicitConversationParticipant(conversationData, uid) ||
    conversationData?.parentUserId !== uid || !visible(data) || hidden.exists || data?.senderUserId !== conversationData?.coachUserId ||
    data?.teamId !== conversationData?.teamId || data?.senderRole !== 'coach') throw denied();
  const teamId = conversationData?.teamId;
  if (typeof teamId !== 'string' || !/^[A-Za-z0-9_-]{1,180}$/.test(teamId)) throw denied();
  const teamRef = db.collection('teams').doc(teamId);
  const [team, member] = await Promise.all([teamRef.get(), teamRef.collection('members').doc(uid).get()]);
  if (!team.exists || !isTeamActive(team.data()) || member.data()?.status !== 'active' || !hasParentRole(member.data())) throw denied();
  const text = data?.contentType === 'voice'
    ? typeof data?.caption === 'string' ? data.caption.trim() : undefined
    : data?.text;
  if (typeof text !== 'string' || !text.trim()) throw denied();
  return { text, inviteCode: typeof team.data()?.inviteCode === 'string' ? team.data()?.inviteCode as string : undefined };
}

export async function reserveTranslationCharacters(uid: string, characters: number) {
  const rawLimit = process.env.TEAM_TRANSLATION_MONTHLY_CHAR_LIMIT ?? '500000';
  const monthlyLimit = Number(rawLimit);
  if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 500_000) throw unavailable();
  const db = admin.firestore();
  const globalRef = db.collection('teamTranslationUsage').doc('current');
  // Server-only subcollection; recursive account deletion already deletes it.
  const userRef = db.collection('users').doc(uid).collection('translationUsage').doc('current');
  await db.runTransaction(async (transaction) => {
    const [global, user] = await transaction.getAll(globalRef, userRef);
    let next;
    try {
      next = nextTranslationUsage({ now: Date.now(), characters, monthlyLimit, global: global.data() ?? {}, user: user.data() ?? {} });
    } catch {
      throw new functions.https.HttpsError('resource-exhausted', 'Translation usage limit reached. Try again later.');
    }
    transaction.set(globalRef, next.global);
    transaction.set(userRef, next.user);
  });
  // Reservations are not refunded after timeouts: the provider may already have charged.
}

export async function translateWithGoogle(texts: string[], targetLanguageCode: string) {
  const projectId = process.env.GCLOUD_PROJECT;
  if (!projectId || !/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw unavailable();
  const credential = admin.app().options.credential;
  if (!credential) throw unavailable();
  const token = await credential.getAccessToken();
  const response = await fetch(`https://translation.googleapis.com/v3/projects/${projectId}/locations/global:translateText`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(12_000),
    headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: texts, mimeType: 'text/plain', targetLanguageCode,
      model: `projects/${projectId}/locations/global/models/general/nmt` }),
  });
  if (!response.ok) throw unavailable(); // Do not retain response bodies, messages or credentials in diagnostics.
  const body = await response.json() as { translations?: { translatedText?: unknown }[] };
  if (!Array.isArray(body.translations) || body.translations.some((item) => typeof item.translatedText !== 'string')) throw unavailable();
  return body.translations.map((item) => item.translatedText as string);
}

const translate = createTranslationEngine({ load: loadAuthorizedTranslationText, reserve: reserveTranslationCharacters, translate: translateWithGoogle });
export const translateTeamMessage = functions.region('us-central1').runWith({
  timeoutSeconds: 30, memory: '256MB', enforceAppCheck: true,
}).https.onCall(async (data, context) => {
  const uid = requirePermanentUid(context);
  if (!context.app) throw new functions.https.HttpsError('failed-precondition', 'App verification is required.');
  if (process.env.TEAM_TRANSLATION_ENABLED !== 'true') throw unavailable();
  try {
    const request = parseTranslationRequest(data);
    return await translate(uid, request);
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    if (error instanceof Error && ['invalid-argument', 'failed-precondition'].includes(error.message)) {
      throw new functions.https.HttpsError(error.message as 'invalid-argument' | 'failed-precondition', 'Translation request is unavailable.');
    }
    throw unavailable();
  }
});
