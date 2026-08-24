import { createHash } from "node:crypto";

export const MODERATION_REASON_CODES = [
  "harassment_bullying",
  "hate_discrimination",
  "threat_violence",
  "sexual_content",
  "child_safety",
  "sexual_extortion",
  "nonconsensual_intimate_image",
  "doxxing_privacy",
  "stalking",
  "self_harm",
  "spam_scam_impersonation",
  "illegal_activity",
  "offline_behavior",
  "ai_unsafe_output",
  "other",
] as const;

export const MODERATION_TARGET_TYPES = [
  "friendMessage",
  "teamContent",
  "userProfile",
  "conduct",
  "coachAiOutput",
] as const;

export type ModerationReasonCode = typeof MODERATION_REASON_CODES[number];
export type ModerationTargetType = typeof MODERATION_TARGET_TYPES[number];
export type ModerationSeverity = "critical" | "high" | "standard" | "low";

const LEGACY_REASON_MAP: Record<string, ModerationReasonCode> = {
  childExploitation: "child_safety",
  credibleThreat: "threat_violence",
  harassment: "harassment_bullying",
  immediateDanger: "threat_violence",
  offensive: "other",
  privacy: "doxxing_privacy",
  sexualContent: "sexual_content",
  spam: "spam_scam_impersonation",
};

export function canonicalModerationReason(value: unknown): ModerationReasonCode | null {
  if (typeof value !== "string") return null;
  if ((MODERATION_REASON_CODES as readonly string[]).includes(value)) {
    return value as ModerationReasonCode;
  }
  return LEGACY_REASON_MAP[value] ?? null;
}

export function moderationSeverityFor(reason: ModerationReasonCode): ModerationSeverity {
  if (
    reason === "child_safety" ||
    reason === "threat_violence" ||
    reason === "sexual_extortion" ||
    reason === "self_harm"
  ) return "critical";
  if (
    reason === "harassment_bullying" ||
    reason === "hate_discrimination" ||
    reason === "sexual_content" ||
    reason === "nonconsensual_intimate_image" ||
    reason === "doxxing_privacy" ||
    reason === "stalking" ||
    reason === "illegal_activity"
  ) return "high";
  if (reason === "spam_scam_impersonation") return "low";
  return "standard";
}

export function moderationHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function moderationReceiptNumber(reportId: string) {
  return `SS-${moderationHash(reportId).slice(0, 12).toUpperCase()}`;
}

export function moderationDedupeId(input: {
  reporterUserId: string;
  targetType: ModerationTargetType;
  targetKey: string;
}) {
  return moderationHash(`${input.reporterUserId}\u001f${input.targetType}\u001f${input.targetKey}`);
}

export function moderationCaseGroupingKey(targetType: ModerationTargetType, targetKey: string) {
  return `${targetType}:${moderationHash(targetKey)}`;
}

export function safeModerationEvidenceSourcePath(value: unknown) {
  if (typeof value !== "string" || value.length > 1000) return null;
  if (/^teamVoiceMemos\/[A-Za-z0-9_./-]{1,900}\.m4a$/u.test(value)) return value;
  if (
    /^friendChatMedia\/[A-Za-z0-9_-]{1,200}\/[A-Za-z0-9_-]{1,200}\/[A-Za-z0-9_-]{1,200}\/(?:voice\.m4a|image\.jpg|thumbnail\.jpg)$/u.test(value)
  ) return value;
  return null;
}

export function moderationEvidenceExtension(path: string) {
  if (path.endsWith(".m4a")) return "m4a";
  if (path.endsWith(".jpg")) return "jpg";
  return "bin";
}

export function moderationEvidenceDestinationPath(reportId: string, sourcePath: string) {
  const extension = moderationEvidenceExtension(sourcePath);
  const sourceKey = moderationHash(sourcePath).slice(0, 20);
  return `moderationEvidence/${reportId}/${sourceKey}/original.${extension}`;
}

export function readPositiveIntegerConfiguration(value: unknown, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : null;
}

export function coachAiModerationIngestionEnabled(
  environment: Record<string, string | undefined>,
) {
  const approvedStagingProject = "sideline-social-staging-2026";
  const actualProject = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  return actualProject === approvedStagingProject &&
    environment.MODERATION_EXPECTED_PROJECT_ID === approvedStagingProject &&
    environment.MODERATION_SYSTEM_ENABLED === "true" &&
    environment.MODERATION_REPORTING_V2_ENABLED === "true" &&
    environment.MODERATION_APP_CHECK_MODE === "monitor" &&
    readPositiveIntegerConfiguration(
      environment.MODERATION_REPORT_RATE_LIMIT_WINDOW_HOURS,
      24 * 30,
    ) !== null &&
    readPositiveIntegerConfiguration(
      environment.MODERATION_REPORT_RATE_LIMIT_MAX,
      500,
    ) !== null;
}

export function mobileModerationReportingEnabled(
  environment: Record<string, string | undefined>,
) {
  const approvedStagingProject = "sideline-social-staging-2026";
  const actualProject = environment.GCLOUD_PROJECT || environment.GOOGLE_CLOUD_PROJECT;
  return actualProject === approvedStagingProject &&
    environment.MODERATION_EXPECTED_PROJECT_ID === approvedStagingProject &&
    environment.MODERATION_SYSTEM_ENABLED === "true" &&
    environment.MODERATION_REPORTING_V2_ENABLED === "true" &&
    environment.MODERATION_APP_CHECK_MODE === "monitor";
}

export function boundedModerationText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

export function moderationEvidenceMustBeRetained(data: FirebaseFirestore.DocumentData | undefined) {
  return data?.moderationEvidenceRetained === true ||
    (Array.isArray(data?.moderationLegalHoldIds) && data.moderationLegalHoldIds.length > 0);
}
