export type TeamCalendarConnectLoadState = 'loading' | 'ready' | 'error';

export type TeamCalendarConnectRequest = {
  contextKey: string;
  generation: number;
};

export function createTeamCalendarConnectRequestGuard() {
  let generation = 0;
  return {
    begin(contextKey: string): TeamCalendarConnectRequest {
      generation += 1;
      return { contextKey, generation };
    },
    isCurrent(request: TeamCalendarConnectRequest, currentContextKey: string) {
      return request.generation === generation && request.contextKey === currentContextKey;
    },
    invalidate() {
      generation += 1;
    },
  };
}

export function calendarConnectContextKey(teamId: string, userId: string | null | undefined) {
  return `${userId ?? 'signed-out'}:${teamId || 'missing-team'}`;
}
