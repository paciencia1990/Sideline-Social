import * as firebaseFunctions from 'firebase-functions';

import { permanentAccountFunctions } from './permanentAuth';

const functions = permanentAccountFunctions(firebaseFunctions);

const coachHelpFunctions = functions.region('us-central1').runWith({
  timeoutSeconds: 30,
  memory: '256MB',
});

/**
 * Compatibility boundary for app versions that still know this callable name.
 *
 * Coach AI is intentionally disabled. Keep this implementation free of secret
 * bindings, provider calls, Firestore writes, and user-supplied prompt logging.
 */
export const generateCoachResourceHelp = coachHelpFunctions.https.onCall(async (_data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Sign in is required.',
      { reason: 'auth_required' },
    );
  }

  functions.logger.info('coach_ai_help_unavailable', { reason: 'feature_disabled' });
  throw new functions.https.HttpsError(
    'failed-precondition',
    'AI Coach is not available yet.',
    { reason: 'feature_disabled' },
  );
});
