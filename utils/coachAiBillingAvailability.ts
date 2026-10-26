import type { CoachAiBillingStatus } from '../types/coachAiBilling';

export type CoachAiBillingAvailability = 'checking' | 'build_unavailable' | 'account_unavailable' | 'verification_error' | 'billing_unavailable' | 'ready';

/** Missing status is not a server decision to disable billing. */
export function resolveCoachAiBillingAvailability(input: {
  enabled: boolean;
  eligible: boolean;
  prerequisitesLoading: boolean;
  prerequisitesError: boolean;
  loading: boolean;
  error: boolean;
  status: CoachAiBillingStatus | null;
}): CoachAiBillingAvailability {
  if (!input.enabled) return 'build_unavailable';
  if (input.prerequisitesLoading) return 'checking';
  if (input.prerequisitesError) return 'verification_error';
  if (!input.eligible) return 'account_unavailable';
  if (input.error) return 'verification_error';
  if (input.loading || !input.status) return 'checking';
  return input.status.enabled ? 'ready' : 'billing_unavailable';
}
