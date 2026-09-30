import { getApps, initializeApp } from "firebase-admin/app";

const APPROVED_STAGING_PROJECT = "sideline-social-staging-2026";
const configuredProject = process.env.MODERATION_EXPECTED_PROJECT_ID;
const providerProjects = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT]
  .filter((value): value is string => Boolean(value));
const runningInEmulator = process.env.FUNCTIONS_EMULATOR === "true";

if (
  !runningInEmulator &&
  (configuredProject !== APPROVED_STAGING_PROJECT ||
    providerProjects.some((value) => value !== APPROVED_STAGING_PROJECT))
) {
  throw new Error("The isolated moderation-reporting codebase is restricted to the approved staging project.");
}

if (!getApps().length) initializeApp();

export { submitModerationReportV2 } from "./generated/moderationReports";
