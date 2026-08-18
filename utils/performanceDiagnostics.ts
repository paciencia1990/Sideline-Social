export type PerformanceTraceName =
  | "friends.overview"
  | "games.lobby-directory"
  | "home.parent-teams"
  | "home.weekly-challenge"
  | "squads.membership-hydration"
  | "startup.account-standing"
  | "startup.auth-profile"
  | "startup.mode-hydration"
  | "startup.route-resolution";

function nowMilliseconds() {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

export function startDevelopmentPerformanceTrace(name: PerformanceTraceName) {
  const startedAt = nowMilliseconds();
  let completed = false;

  return () => {
    if (completed) return 0;
    completed = true;
    const durationMs = Math.max(0, nowMilliseconds() - startedAt);
    if (__DEV__) {
      console.info("[Performance]", {
        durationMs: Math.round(durationMs),
        name,
      });
    }
    return durationMs;
  };
}

export async function measureDevelopmentPerformance<T>(
  name: PerformanceTraceName,
  operation: () => Promise<T>,
) {
  const complete = startDevelopmentPerformanceTrace(name);
  try {
    return await operation();
  } finally {
    complete();
  }
}
