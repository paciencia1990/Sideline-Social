"use strict";

const assert = require("node:assert/strict");
const {
  canonicalModerationReason,
  coachAiModerationIngestionEnabled,
  moderationCaseGroupingKey,
  moderationDedupeId,
  moderationEvidenceDestinationPath,
  moderationEvidenceMustBeRetained,
  moderationReceiptNumber,
  mobileModerationReportingEnabled,
  safeModerationEvidenceSourcePath,
} = require("../functions/lib/moderationReportsCore.js");

assert.equal(canonicalModerationReason("harassment_bullying"), "harassment_bullying");
assert.equal(canonicalModerationReason("harassment"), "harassment_bullying");
assert.equal(canonicalModerationReason("privacy"), "doxxing_privacy");
assert.equal(canonicalModerationReason("not-a-reason"), null);

const targetKey = moderationCaseGroupingKey("friendMessage", "synthetic-chat:synthetic-message");
assert.equal(targetKey.startsWith("friendMessage:"), true);
assert.equal(targetKey.includes("synthetic-message"), false, "case grouping does not expose the raw target key");

const firstDedupe = moderationDedupeId({
  reporterUserId: "synthetic-reporter",
  targetType: "friendMessage",
  targetKey: "synthetic-chat:synthetic-message",
});
const secondDedupe = moderationDedupeId({
  reporterUserId: "synthetic-reporter",
  targetType: "friendMessage",
  targetKey: "synthetic-chat:synthetic-message",
});
assert.equal(firstDedupe, secondDedupe);
assert.equal(firstDedupe.length, 64);

assert.equal(moderationReceiptNumber("synthetic-report-id"), moderationReceiptNumber("synthetic-report-id"));
assert.match(moderationReceiptNumber("synthetic-report-id"), /^SS-[A-F0-9]{12}$/u);

const imagePath = "friendChatMedia/synthetic-chat/synthetic-message/synthetic-reservation/image.jpg";
const voicePath = "teamVoiceMemos/synthetic-team/synthetic-message.m4a";
assert.equal(safeModerationEvidenceSourcePath(imagePath), imagePath);
assert.equal(safeModerationEvidenceSourcePath(voicePath), voicePath);
assert.equal(safeModerationEvidenceSourcePath("users/synthetic/private.txt"), null);
assert.match(moderationEvidenceDestinationPath("synthetic-report-id", imagePath), /^moderationEvidence\/synthetic-report-id\/[a-f0-9]{20}\/original\.jpg$/u);

assert.equal(moderationEvidenceMustBeRetained({ moderationEvidenceRetained: true }), true);
assert.equal(moderationEvidenceMustBeRetained({ moderationLegalHoldIds: ["synthetic-hold"] }), true);
assert.equal(moderationEvidenceMustBeRetained({ moderationLegalHoldIds: [] }), false);

const enabledCoachAiIngestion = {
  GCLOUD_PROJECT: "sideline-social-staging-2026",
  MODERATION_EXPECTED_PROJECT_ID: "sideline-social-staging-2026",
  MODERATION_SYSTEM_ENABLED: "true",
  MODERATION_REPORTING_V2_ENABLED: "true",
  MODERATION_APP_CHECK_MODE: "monitor",
  MODERATION_REPORT_RATE_LIMIT_WINDOW_HOURS: "24",
  MODERATION_REPORT_RATE_LIMIT_MAX: "25",
};
assert.equal(coachAiModerationIngestionEnabled(enabledCoachAiIngestion), true);
for (const key of Object.keys(enabledCoachAiIngestion)) {
  assert.equal(
    coachAiModerationIngestionEnabled({ ...enabledCoachAiIngestion, [key]: undefined }),
    false,
    `Coach AI moderation ingestion must fail closed without ${key}`,
  );
}
assert.equal(coachAiModerationIngestionEnabled({
  ...enabledCoachAiIngestion,
  GCLOUD_PROJECT: "sideline-squad",
}), false);

const enabledMobileReporting = {
  GCLOUD_PROJECT: "sideline-social-staging-2026",
  MODERATION_EXPECTED_PROJECT_ID: "sideline-social-staging-2026",
  MODERATION_SYSTEM_ENABLED: "true",
  MODERATION_REPORTING_V2_ENABLED: "true",
  MODERATION_APP_CHECK_MODE: "monitor",
};
assert.equal(mobileModerationReportingEnabled(enabledMobileReporting), true);
for (const key of Object.keys(enabledMobileReporting)) {
  assert.equal(
    mobileModerationReportingEnabled({ ...enabledMobileReporting, [key]: undefined }),
    false,
    `Mobile moderation reporting must fail closed without ${key}`,
  );
}
assert.equal(mobileModerationReportingEnabled({
  ...enabledMobileReporting,
  GCLOUD_PROJECT: "sideline-squad",
}), false);
assert.equal(coachAiModerationIngestionEnabled({
  ...enabledCoachAiIngestion,
  MODERATION_EXPECTED_PROJECT_ID: "sideline-squad",
}), false);
assert.equal(coachAiModerationIngestionEnabled({
  ...enabledCoachAiIngestion,
  MODERATION_REPORT_RATE_LIMIT_WINDOW_HOURS: "0",
}), false);
assert.equal(coachAiModerationIngestionEnabled({
  ...enabledCoachAiIngestion,
  MODERATION_REPORT_RATE_LIMIT_MAX: "501",
}), false);

console.log("Canonical moderation reasons, receipts, dedupe, evidence paths, and retention gates passed.");
