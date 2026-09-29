export type SquadCallableErrorKind =
  | "service-unavailable"
  | "authentication-required"
  | "permission-denied"
  | "temporarily-unavailable"
  | "unknown";

export function classifySquadCallableError(error: unknown): SquadCallableErrorKind {
  const code = typeof error === "object" && error && "code" in error
    ? String(error.code).toLocaleLowerCase()
    : "";
  if (code.includes("not-found") || code.includes("unimplemented")) return "service-unavailable";
  if (code.includes("unauthenticated")) return "authentication-required";
  if (code.includes("permission-denied")) return "permission-denied";
  if (code.includes("unavailable") || code.includes("deadline-exceeded") || code.includes("internal")) {
    return "temporarily-unavailable";
  }
  return "unknown";
}
