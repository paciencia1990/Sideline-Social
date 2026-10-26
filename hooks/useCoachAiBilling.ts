import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useAccountStanding } from '@/context/AccountStandingContext';
import { COACH_AI_BILLING_ENABLED, fetchCoachAiBillingStatus, subscribeCoachAiBilling } from '@/services/coachAiBillingService';
import type { CoachAiBillingStatus } from '@/types/coachAiBilling';
import { resolveCoachAiBillingAvailability } from '@/utils/coachAiBillingAvailability';
import { CoachAiBillingDiagnosticError, createBillingDiagnostic, type BillingDiagnostic } from '@/utils/coachAiBillingDiagnostics';

export function useCoachAiBilling() {
  const { user, loading: authLoading } = useAuth();
  const { activeMode } = useApp();
  const { standing, loading: standingLoading, error: standingError } = useAccountStanding();
  const prerequisitesLoading = authLoading || Boolean(user?.uid && standingLoading);
  const prerequisitesError = Boolean(user?.uid && standingError && !standing);
  const eligible = Boolean(!prerequisitesLoading && !prerequisitesError && user?.uid && user.adultEligibilityConfirmed && activeMode === 'coach' && standing?.status === 'active');
  const [state, setState] = useState<{ uid: string | null; status: CoachAiBillingStatus | null; loading: boolean; error: boolean; diagnostic?: BillingDiagnostic }>({ uid: null, status: null, loading: false, error: false });
  const generation = useRef(0);
  const stopped = useRef<string | null>(null);
  const refresh = useCallback(async (explicit = true) => {
    const uid = user?.uid;
    if (stopped.current && stopped.current !== uid) stopped.current = null;
    // Background/foreground notifications must not retry a failed status check.
    if (!explicit && stopped.current === uid) return null;
    if (explicit) stopped.current = null;
    const token = ++generation.current;
    if (!COACH_AI_BILLING_ENABLED || !eligible || !uid) { setState({ uid: uid ?? null, status: null, loading: false, error: false }); return null; }
    setState(previous => ({ uid, status: previous.uid === uid ? previous.status : null, loading: true, error: false, diagnostic: previous.uid === uid ? previous.diagnostic : undefined }));
    const check = createBillingDiagnostic('billing_status');
    try {
      const status = await fetchCoachAiBillingStatus(uid);
      if (token === generation.current) setState({ uid, status, loading: false, error: false,
        diagnostic: check.finish(status.enabled ? 'ready' : 'failed', status.enabled ? 'ok' : 'billing_disabled') });
      return token === generation.current ? status : null;
    } catch (error) {
      if (token === generation.current) {
        stopped.current = uid;
        const diagnostic = error instanceof CoachAiBillingDiagnosticError ? error.diagnostic : check.fail(error).diagnostic;
        setState(previous => ({ uid, status: previous.uid === uid ? previous.status : null, loading: false, error: true, diagnostic }));
      }
      return null;
    }
  }, [eligible, user?.uid]);
  useEffect(() => {
    void refresh(false);
    const unsubscribe = subscribeCoachAiBilling(status => {
      if (status && eligible && status.userId === user?.uid) {
        generation.current += 1; stopped.current = null;
        const check = createBillingDiagnostic('billing_status');
        setState({ uid: status.userId, status, loading: false, error: false,
          diagnostic: check.finish(status.enabled ? 'ready' : 'failed', status.enabled ? 'ok' : 'billing_disabled') });
      } else { void refresh(false); }
    });
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(false); });
    return () => { generation.current += 1; unsubscribe(); listener.remove(); };
  }, [refresh, eligible, user?.uid]);
  const status = eligible && state.uid === user?.uid ? state.status : null;
  const availability = resolveCoachAiBillingAvailability({
    enabled: COACH_AI_BILLING_ENABLED, eligible, prerequisitesLoading, prerequisitesError,
    status, loading: state.uid === user?.uid && state.loading, error: state.uid === user?.uid && state.error,
  });
  return { enabled: COACH_AI_BILLING_ENABLED, eligible, status, availability,
    diagnostic: state.uid === user?.uid ? state.diagnostic : undefined,
    loading: availability === 'checking', error: availability === 'verification_error', refresh };
}
