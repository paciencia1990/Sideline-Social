"use strict";

const assert = require("node:assert/strict");
const {
  canonicalModerationReason,
  moderationCaseGroupingKey,
  moderationDedupeId,
  moderationEvidenceDestinationPath,
  moderationEvidenceMustBeRetained,
  moderationReceiptNumber,
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

console.log("Canonical moderation reasons, receipts, dedupe, evidence paths, and retention gates passed.");
