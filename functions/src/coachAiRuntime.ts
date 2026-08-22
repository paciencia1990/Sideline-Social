import type { Firestore } from 'firebase-admin/firestore';

export const COACH_AI_RUNTIME_CONFIG_PATH = 'coachAiInternalConfig/runtime';

export async function requireCoachAiRuntimeEnabled(firestore: Firestore) {
  const snapshot = await firestore.doc(COACH_AI_RUNTIME_CONFIG_PATH).get();
  return snapshot.exists && snapshot.data()?.enabled === true;
}
