export type CoachAiRequestErrorKind = "access" | "configuration" | "offline" | "provider" | "rate_limit" | "timeout" | "unknown";

const COACH_AI_CONFIGURATION_REASONS = new Set([
  "coach_ai_disabled",
  "feature_disabled",
  "gateway_authentication_failed",
  "gateway_credential_misconfigured",
  "provider_unavailable",
  "server_testing_disabled",
]);

export class CoachAiRequestError extends Error {
  constructor(readonly kind: CoachAiRequestErrorKind) {
    super(`coach_ai_${kind}`);
    this.name = "CoachAiRequestError";
  }
}

export function classifyCoachAiRequestError(error: unknown) {
  const code = readErrorField(error, "code");
  const reason = readErrorReason(error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (code.includes("unauthenticated") || code.includes("permission-denied")) return new CoachAiRequestError("access");
  if (code.includes("resource-exhausted") || reason === "rate_limited") return new CoachAiRequestError("rate_limit");
  if (code.includes("deadline-exceeded") || reason === "timeout") return new CoachAiRequestError("timeout");
  if (COACH_AI_CONFIGURATION_REASONS.has(reason)) return new CoachAiRequestError("configuration");
  if (reason === "provider_error") return new CoachAiRequestError("provider");
  if (code.includes("unavailable") || code.includes("network-request-failed") || message.includes("network")) return new CoachAiRequestError("offline");
  if (code.includes("internal") || code.includes("unknown")) return new CoachAiRequestError("provider");
  return new CoachAiRequestError("unknown");
}

function readErrorField(error: unknown, field: string) {
  if (!error || typeof error !== "object" || !(field in error)) return "";
  return String((error as Record<string, unknown>)[field] ?? "").toLowerCase();
}

function readErrorReason(error: unknown) {
  if (!error || typeof error !== "object" || !("details" in error)) return "";
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== "object" || !("reason" in details)) return "";
  return String((details as { reason?: unknown }).reason ?? "").toLowerCase();
}
