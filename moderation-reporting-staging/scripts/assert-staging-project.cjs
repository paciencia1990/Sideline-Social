"use strict";

const { basename, resolve } = require("node:path");

const APPROVED_STAGING_PROJECT = "sideline-social-staging-2026";
const APPROVED_SOURCE_DIRECTORY = "moderation-reporting-staging";
const actualProject = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const resourceDirectory = process.env.RESOURCE_DIR ? resolve(process.env.RESOURCE_DIR) : "";

if (actualProject !== APPROVED_STAGING_PROJECT) {
  throw new Error(
    `Refusing moderation-reporting deployment for non-staging project: ${actualProject || "missing project"}.`,
  );
}

if (!resourceDirectory || basename(resourceDirectory) !== APPROVED_SOURCE_DIRECTORY) {
  throw new Error("Refusing deployment from an unexpected Functions source directory.");
}

console.log("Isolated moderation-reporting deployment target verified as the approved staging project.");
