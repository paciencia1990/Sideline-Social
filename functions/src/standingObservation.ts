import { createHash, randomBytes } from 'node:crypto';
import { logger } from 'firebase-functions';

// Same sanitized envelope as the Safety delivery observer. outboxHash is an
// opaque subject-path hash here; no account identifier or event payload is logged.
export async function observeStandingDelivery<T>(eventId: string, uid: string, work: () => Promise<T>): Promise<T> {
  const digest = (value: string) => createHash('sha256').update(value).digest('hex');
  const identity = { schema: 1, deliveryHash: digest(randomBytes(24).toString('hex')),
    eventHash: digest(eventId), outboxHash: digest(`accountStanding/${uid}`) };
  const emit = (phase: string, outcome: string, attempt: number) => {
    try { logger.info('moderation_standing_delivery', { ...identity, phase, outcome, attempt }); }
    catch { /* Diagnostics cannot change application behavior. */ }
  };
  emit('begin', 'started', 0); emit('work', 'admitted', 1);
  try { const result = await work(); emit('end', 'returned', 1); return result; }
  catch (error) { emit('end', 'threw', 1); throw error; }
}
