import type { AccountStanding } from "@/types/accountStanding";

export type AccountStandingGateKind =
  | "warning"
  | "messagingRestricted"
  | "suspended"
  | "banned"
  | null;

export function accountStandingGate(
  standing: AccountStanding,
  acknowledgedRevision: number | null,
): AccountStandingGateKind {
  if (standing.status === "suspended" || standing.status === "banned") {
    return standing.status;
  }
  if (
    standing.status === "messagingRestricted" &&
    acknowledgedRevision !== standing.revision
  ) {
    return "messagingRestricted";
  }
  if (standing.status === "active" && standing.warning?.pending) return "warning";
  return null;
}
