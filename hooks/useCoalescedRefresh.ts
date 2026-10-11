import { useCallback, useEffect, useMemo, useRef } from 'react';
import { createCoalescedRefresh, type RefreshOptions } from '@/utils/coalescedRefresh';

export function useCoalescedRefresh<Input, Result>(identity: string, options: RefreshOptions<Input, Result>) {
  const current = useRef({ identity, options });
  current.current = { identity, options };
  const controller = useMemo(() => {
    const active = () => current.current.identity === identity;
    return createCoalescedRefresh<Input, Result>({
      load: (input) => active() ? current.current.options.load(input) : Promise.reject(new Error('refresh_superseded')),
      merge: (previous, next) => current.current.options.merge(previous, next),
      covers: (scheduled, requested) => current.current.options.covers?.(scheduled, requested) ?? true,
      onStart: () => { if (active()) current.current.options.onStart?.(); },
      onSuccess: (result) => { if (active()) current.current.options.onSuccess(result); },
      onError: (error) => { if (active()) current.current.options.onError(error); },
      onSettled: () => { if (active()) current.current.options.onSettled?.(); },
    });
  }, [identity]);
  useEffect(() => {
    controller.activate();
    return () => controller.dispose();
  }, [controller]);
  return useCallback((input: Input, invalidate = true) => controller.refresh(input, invalidate), [controller]);
}
