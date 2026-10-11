import type { TeamMembership } from "@/services/teamService";

// Archive information is secondary; it must not disable current team access.
export async function loadCoachHomeData(
  reads: { memberships: () => Promise<TeamMembership[]>; archivedCount: () => Promise<number> },
  timeoutMs = 15000,
) {
  const bounded = <T,>(read: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error("Coach home read timed out"), { code: "deadline-exceeded" }));
    }, timeoutMs);
    Promise.resolve().then(read).then(resolve, reject).finally(() => clearTimeout(timer));
  });
  const [memberships, archivedCount] = await Promise.allSettled([
    bounded(reads.memberships), bounded(reads.archivedCount),
  ]);
  if (memberships.status === "rejected") throw memberships.reason;
  return {
    memberships: memberships.value,
    archivedCount: archivedCount.status === "fulfilled" ? archivedCount.value : 0,
    archiveCountUnavailable: archivedCount.status === "rejected",
  };
}
