import * as https from 'node:https';

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const EXPO_PUSH_HOST = 'exp.host';
const EXPO_SEND_PATH = '/--/api/v2/push/send';
const EXPO_RECEIPTS_PATH = '/--/api/v2/push/getReceipts';
const SAFE_PUSH_TITLE = 'Sideline Social';
const SAFE_PUSH_BODY = 'You have a new update.';

type PushData = Record<string, string>;

type ExpoTicket = {
  id?: string;
  status?: string;
  details?: { error?: string };
};

export async function sendPushToUser(
  uid: string,
  data: PushData,
  androidChannelId: 'coach-updates' | 'chat-messages' = 'coach-updates',
) {
  const snapshot = await admin.firestore().collection('notificationTokens').where('uid', '==', uid).limit(20).get();
  await sendPushToTokenDocuments(snapshot.docs, data, androidChannelId);
}

export async function sendPushToTokenDocuments(
  tokenDocuments: FirebaseFirestore.QueryDocumentSnapshot[],
  data: PushData,
  androidChannelId: 'coach-updates' | 'chat-messages' = 'coach-updates',
) {
  const expoDocuments = tokenDocuments.filter((document) => document.data()?.platform === 'ios');
  const firebaseDocuments = tokenDocuments.filter((document) => document.data()?.platform !== 'ios');

  await Promise.allSettled(firebaseDocuments.map(async (tokenDocument) => {
    const token = tokenDocument.data()?.token;
    if (typeof token !== 'string' || !token) return;
    try {
      await admin.messaging().send({
        token,
        notification: { title: SAFE_PUSH_TITLE, body: SAFE_PUSH_BODY },
        data,
        android: { notification: { channelId: androidChannelId } },
      });
    } catch (error) {
      const code = codeFrom(error);
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
        await tokenDocument.ref.delete();
        return;
      }
      throw error;
    }
  }));

  for (let index = 0; index < expoDocuments.length; index += 100) {
    const documents = expoDocuments.slice(index, index + 100);
    const messages = documents.map((document) => ({
      to: document.data().token,
      title: SAFE_PUSH_TITLE,
      body: SAFE_PUSH_BODY,
      sound: 'default',
      data,
    }));
    const response = await postJson(EXPO_SEND_PATH, messages) as { data?: ExpoTicket[] };
    const tickets = Array.isArray(response?.data) ? response.data : [];
    await Promise.all(tickets.map(async (ticket, ticketIndex) => {
      const tokenDocument = documents[ticketIndex];
      if (!tokenDocument) return;
      if (ticket.details?.error === 'DeviceNotRegistered') {
        await tokenDocument.ref.delete();
        return;
      }
      if (ticket.status === 'ok' && typeof ticket.id === 'string') {
        await admin.firestore().collection('expoPushTickets').doc(ticket.id).set({
          createdAt: FieldValue.serverTimestamp(),
          tokenDocumentId: tokenDocument.id,
        });
      }
    }));
  }
}

export async function processPendingExpoPushReceipts() {
  const firestore = admin.firestore();
  const cutoff = Timestamp.fromMillis(Date.now() - 5 * 60 * 1000);
  const snapshot = await firestore.collection('expoPushTickets')
    .where('createdAt', '<=', cutoff)
    .limit(100)
    .get();
  if (snapshot.empty) return 0;

  const response = await postJson(EXPO_RECEIPTS_PATH, { ids: snapshot.docs.map((document) => document.id) }) as {
    data?: Record<string, { status?: string; details?: { error?: string } }>;
  };
  const receipts = response?.data ?? {};
  const writer = firestore.bulkWriter();
  snapshot.docs.forEach((ticketDocument) => {
    const receipt = receipts[ticketDocument.id];
    if (receipt?.details?.error === 'DeviceNotRegistered') {
      const tokenDocumentId = ticketDocument.data()?.tokenDocumentId;
      if (typeof tokenDocumentId === 'string') {
        writer.delete(firestore.collection('notificationTokens').doc(tokenDocumentId));
      }
    }
    if (receipt) writer.delete(ticketDocument.ref);
  });
  await writer.close();
  return snapshot.size;
}

function postJson(path: string, value: unknown): Promise<unknown> {
  const body = JSON.stringify(value);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: EXPO_PUSH_HOST,
      path,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { responseBody += chunk; });
      response.on('end', () => {
        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Expo Push service returned HTTP ${response.statusCode ?? 'unknown'}.`));
          return;
        }
        try {
          resolve(JSON.parse(responseBody));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

function codeFrom(error: unknown) {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}
