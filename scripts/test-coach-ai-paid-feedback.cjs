'use strict';
const assert = require('node:assert/strict');
const { createSourceLoader } = require('./coach-ai-test-loader.cjs');
const memory = require('./coach-ai-memory-firestore.cjs').createMemoryFirestore();
let ingestions = 0;
const load = createSourceLoader({ ...memory.overrides,
  './moderationReportsCore': { coachAiModerationIngestionEnabled: () => true },
  './moderationReports': { createCoachAiUnsafeModerationReport: async input => { ingestions++; assert.equal(input.reporterUserId, 'feedback_coach'); return { receiptNumber: 'fixture_receipt' }; } },
});
const feedback = load('functions/src/coachAiFeedback.ts').submitCoachAiFeedback;
const context = { auth: { uid: 'feedback_coach', token: { firebase: { sign_in_provider: 'password' } } }, app: { appId: 'fixture_app_check' } };
async function run() {
  process.env.COACH_AI_TESTING_ENABLED = 'false';
  await memory.db.doc('users/feedback_coach').set({ adultEligibilityConfirmed: true, activeMode: 'coach' });
  await memory.db.doc('coachAiInternalConfig/runtime').set({ enabled: false });
  await memory.db.doc('coachAiRequests/feedback_coach_fixture_request').set({ userId: 'feedback_coach', paid: true, status: 'completed', category: 'other', locale: 'en', result: { title: 'Fixture output' } });
  const data = { requestId: 'fixture_request', rating: 'down', reason: 'unsafe' };
  const accepted = await feedback.run(data, context); assert.equal(accepted.saved, true); assert.equal(ingestions, 1, 'Paid feedback still uses the existing unsafe-output moderation ingestion');
  await assert.rejects(feedback.run(data, { auth: context.auth }), e => e.code === 'permission-denied');
  await assert.rejects(feedback.run({ ...data, requestId: 'another_request' }, context), e => e.code === 'not-found');
  await memory.db.doc('accountStanding/feedback_coach').set({ messagingRestricted: true }); await assert.rejects(feedback.run(data, context), e => e.details?.reason === 'messaging_restricted');
  console.log('Paid output feedback: owned record/App Check required, expiry and generation-off do not block reporting, existing moderation ingestion and standing gates retained.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
