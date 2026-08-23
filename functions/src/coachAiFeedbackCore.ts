import { normalizeCoachHelpText } from './coachResourceHelpCore';

export const COACH_AI_FEEDBACK_REASONS = [
  'inaccurate',
  'unsafe',
  'wrong_tone',
  'not_useful',
  'technical_problem',
  'other',
] as const;

export type CoachAiFeedbackReason = typeof COACH_AI_FEEDBACK_REASONS[number];
export type ValidatedCoachAiFeedback = {
  requestId: string;
  rating: 'up' | 'down';
  reason?: CoachAiFeedbackReason;
  comment?: string;
};

export function validateCoachAiFeedback(value: unknown): ValidatedCoachAiFeedback {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_feedback');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => !['requestId', 'rating', 'reason', 'comment'].includes(key))) {
    throw new Error('invalid_feedback');
  }
  const requestId = normalizeCoachHelpText(typeof data.requestId === 'string' ? data.requestId : '');
  if (requestId.length < 8 || requestId.length > 80 || !/^[A-Za-z0-9_-]+$/.test(requestId)) {
    throw new Error('invalid_request_id');
  }
  const rating = data.rating;
  if (rating !== 'up' && rating !== 'down') throw new Error('invalid_rating');
  const reason = data.reason;
  if (reason != null && !COACH_AI_FEEDBACK_REASONS.includes(reason as CoachAiFeedbackReason)) {
    throw new Error('invalid_reason');
  }
  if (rating === 'down' && reason == null) throw new Error('reason_required');
  if (rating === 'up' && reason != null) throw new Error('reason_not_allowed');
  const comment = normalizeCoachHelpText(typeof data.comment === 'string' ? data.comment : '');
  if (comment.length > 500) throw new Error('comment_too_long');
  return {
    requestId,
    rating,
    ...(reason ? { reason: reason as CoachAiFeedbackReason } : {}),
    ...(comment ? { comment } : {}),
  };
}
