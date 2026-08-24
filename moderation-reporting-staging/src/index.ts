import * as admin from "firebase-admin";

const APPROVED_STAGING_PROJECT = "sideline-social-staging-2026";
const actualProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const runningInEmulator = process.env.FUNCTIONS_EMULATOR === "true";

if (!runningInEmulator && actualProject !== APPROVED_STAGING_PROJECT) {
  throw new Error("The isolated moderation-reporting codebase is restricted to the approved staging project.");
}

if (!admin.apps.length) admin.initializeApp();

export { submitModerationReportV2 } from "./generated/moderationReports";
