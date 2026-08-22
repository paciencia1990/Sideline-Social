import assert from "node:assert/strict";

import {
  COACH_AI_STAGING_FIREBASE_PROJECT_ID,
  resolveFirebaseClientConfig,
} from "../config/firebaseEnvironment";

const production = resolveFirebaseClientConfig({}, "ios");
assert.equal(production.environment, "production");
assert.equal(production.options.projectId, "sideline-squad");
assert.equal(String(production.options.appId).includes(":ios:"), true);
assert.equal(resolveFirebaseClientConfig({ PATH: "C:/tools", HOME: "C:/user" }, "android").options.projectId, "sideline-squad");

const stagingEnvironment = {
  EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging",
  EXPO_PUBLIC_FIREBASE_API_KEY: `AIza${"a".repeat(30)}`,
  EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${COACH_AI_STAGING_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  EXPO_PUBLIC_FIREBASE_PROJECT_ID: COACH_AI_STAGING_FIREBASE_PROJECT_ID,
  EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${COACH_AI_STAGING_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123456789012",
  EXPO_PUBLIC_FIREBASE_DATABASE_URL: `https://${COACH_AI_STAGING_FIREBASE_PROJECT_ID}-default-rtdb.firebaseio.com`,
  EXPO_PUBLIC_FIREBASE_APP_ID_IOS: "1:123456789012:ios:abcdef123456",
  EXPO_PUBLIC_FIREBASE_APP_ID_ANDROID: "1:123456789012:android:abcdef123456",
};
const staging = resolveFirebaseClientConfig(stagingEnvironment, "android", "true");
assert.equal(staging.environment, "staging");
assert.equal(staging.options.projectId, COACH_AI_STAGING_FIREBASE_PROJECT_ID);
assert.equal(String(staging.options.appId).includes(":android:"), true);

assert.throws(
  () => resolveFirebaseClientConfig({}, "ios", "true"),
  /Coach AI beta Firebase configuration must resolve to staging project sideline-social-staging-2026/,
);
const alternateStagingProject = "sideline-social-alternate";
assert.throws(
  () => resolveFirebaseClientConfig({
    ...stagingEnvironment,
    EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN: `${alternateStagingProject}.firebaseapp.com`,
    EXPO_PUBLIC_FIREBASE_PROJECT_ID: alternateStagingProject,
    EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: `${alternateStagingProject}.firebasestorage.app`,
    EXPO_PUBLIC_FIREBASE_DATABASE_URL: `https://${alternateStagingProject}-default-rtdb.firebaseio.com`,
  }, "android", "true"),
  /Coach AI beta Firebase configuration must resolve to staging project sideline-social-staging-2026/,
);

assert.throws(() => resolveFirebaseClientConfig({ EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "staging" }, "ios"), /required/);
assert.throws(() => resolveFirebaseClientConfig({ ...stagingEnvironment, EXPO_PUBLIC_FIREBASE_PROJECT_ID: "sideline-squad" }, "ios"));
assert.throws(() => resolveFirebaseClientConfig({ ...stagingEnvironment, EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET: "wrong.firebasestorage.app" }, "ios"), /does not match/);
assert.throws(() => resolveFirebaseClientConfig({ EXPO_PUBLIC_FIREBASE_ENVIRONMENT: "preview" }, "ios"), /must be development, staging, or production/);

console.log("Coach AI Firebase production fallback, staging selection, and fail-closed consistency tests passed.");
