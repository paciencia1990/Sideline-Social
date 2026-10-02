"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
};

const root = path.resolve(__dirname, "..");
const {
  initializeFederatedProfileForSession,
  loadAuthSessionProfile,
} = require(path.join(root, "utils", "authSessionProfileCore.ts"));
const { accountStandingGate } = require(path.join(root, "context", "accountStandingGate.ts"));

(async () => {
  const profile = { displayName: "Synthetic account" };
  const available = await loadAuthSessionProfile({
    allowUnavailable: true,
    classifyError: () => "unused",
    onUnavailable: () => assert.fail("available profiles must not use the restricted fallback"),
    read: async () => ({ exists: true, profile }),
  });
  assert.deepEqual(available, { exists: true, profile, unavailable: false });

  const safeCodes = [];
  const restricted = await loadAuthSessionProfile({
    allowUnavailable: true,
    classifyError: () => "firestore/permission-denied",
    onUnavailable: (code) => safeCodes.push(code),
    read: async () => {
      const error = new Error("synthetic private payload must not escape");
      error.code = "firestore/permission-denied";
      throw error;
    },
  });
  assert.deepEqual(restricted, { exists: true, profile: undefined, unavailable: true });
  assert.deepEqual(safeCodes, ["firestore/permission-denied"]);

  const unavailable = await loadAuthSessionProfile({
    allowUnavailable: true,
    classifyError: () => "firestore/unavailable",
    onUnavailable: (code) => safeCodes.push(code),
    read: async () => { throw Object.assign(new Error("offline"), { code: "firestore/unavailable" }); },
  });
  assert.equal(unavailable.unavailable, true, "network failure must preserve the authenticated shell");
  assert.deepEqual(safeCodes, ["firestore/permission-denied", "firestore/unavailable"]);

  await assert.rejects(
    loadAuthSessionProfile({
      allowUnavailable: false,
      classifyError: () => "firestore/permission-denied",
      onUnavailable: () => assert.fail("strict profile refresh must not suppress failures"),
      read: async () => { throw Object.assign(new Error("denied"), { code: "firestore/permission-denied" }); },
    }),
    (error) => error?.code === "firestore/permission-denied",
  );

  for (const provider of ["google", "apple"]) {
    let initializeCalls = 0;
    let securityChecks = 0;
    let standingReads = 0;
    const result = await initializeFederatedProfileForSession({
      classifyError: (error) => error.code,
      initializeProfile: async () => {
        initializeCalls += 1;
        throw Object.assign(new Error(`${provider} ordinary profile denied`), {
          code: "firestore/permission-denied",
        });
      },
      readStanding: async () => {
        standingReads += 1;
        return { status: "suspended" };
      },
      requireSecurityReady: async () => { securityChecks += 1; },
    });
    assert.deepEqual(result, { restrictedSession: true }, `${provider} must retain the restricted session`);
    assert.equal(initializeCalls, 1, `${provider} profile initialization must not be retried after denial`);
    assert.equal(securityChecks, 1, `${provider} standing verification requires App Check readiness`);
    assert.equal(standingReads, 1, `${provider} must confirm server-owned standing exactly once`);
  }

  await assert.rejects(
    initializeFederatedProfileForSession({
      classifyError: (error) => error.code,
      initializeProfile: async () => {
        throw Object.assign(new Error("active account denial"), { code: "permission-denied" });
      },
      readStanding: async () => ({ status: "active" }),
      requireSecurityReady: async () => {},
    }),
    (error) => error?.code === "permission-denied",
    "an active or new federated account must not be inferred from a denied profile read",
  );

  await assert.rejects(
    initializeFederatedProfileForSession({
      classifyError: (error) => error.code,
      initializeProfile: async () => {
        throw Object.assign(new Error("credential/provider failure"), { code: "auth/invalid-credential" });
      },
      readStanding: async () => assert.fail("credential failure must not read standing"),
      requireSecurityReady: async () => assert.fail("credential failure must remain strict"),
    }),
    (error) => error?.code === "auth/invalid-credential",
  );

  const suspendedStanding = {
    appeal: { available: true, status: "none" },
    effectiveAt: "2026-10-01T20:00:00.000Z",
    expiresAt: "2026-10-02T20:00:00.000Z",
    publicReasonCode: "communityGuidelines",
    revision: 2,
    status: "suspended",
    warning: null,
  };
  assert.equal(accountStandingGate(suspendedStanding, null), "suspended",
    "a restricted session must remain outside ordinary navigation while its appeal is available");
  assert.equal(accountStandingGate({
    ...suspendedStanding,
    appeal: { available: false, status: "resolved" },
    expiresAt: null,
    revision: 3,
    status: "active",
  }, null), null, "independent reversal must restore the ordinary navigation gate");

  const authSource = fs.readFileSync(path.join(root, "context", "AuthContext.tsx"), "utf8");
  const boundarySource = fs.readFileSync(path.join(root, "components", "AccountStandingBoundary.tsx"), "utf8");
  const standingSource = fs.readFileSync(path.join(root, "context", "AccountStandingContext.tsx"), "utf8");
  const passwordSignInSource = authSource.slice(
    authSource.indexOf("const signIn = useCallback"),
    authSource.indexOf("const signUp = useCallback"),
  );
  assert.match(passwordSignInSource, /signInWithEmailAndPassword[\s\S]*hydrateAuthenticatedProfile\(true\)/u,
    "password sign-in must preserve the session when the ordinary profile is unavailable");
  const federatedSignInSource = authSource.slice(
    authSource.indexOf("const signInFederated = useCallback"),
    authSource.indexOf("const signIn = useCallback"),
  );
  assert.match(federatedSignInSource, /signInWithCredential[\s\S]*initializeFederatedProfileForSession/u,
    "Google and Apple sign-in must verify restricted standing after a denied ordinary profile read");
  assert.match(federatedSignInSource, /initializeProfile: \(\) => ensureFederatedUserProfile/u,
    "first-time federated profile initialization must remain explicit and strict");
  assert.match(federatedSignInSource, /requireSecurityReady: requireFirebaseAppCheckReady/u,
    "restricted federated session verification must preserve App Check readiness");
  assert.match(authSource, /refreshProfile[\s\S]*hydrateAuthenticatedProfile\(false\)/u,
    "ordinary profile refresh must remain strict");
  assert.match(boundarySource, /if \(standingState\.error \|\| !standingState\.standing\)[\s\S]*kind="refresh"/u,
    "standing/network uncertainty must block ordinary app access");
  assert.match(boundarySource, /gate === "suspended" \|\| gate === "banned"/u,
    "suspension and ban must retain the restricted standing surface");
  assert.match(boundarySource, /standing\?\.appeal\.available/u,
    "eligible restricted users must retain the appeal form");
  assert.match(standingSource, /\} else \{[\s\S]*getIdToken\(true\)/u,
    "reversal must refresh the token before ordinary access resumes");

  console.log("Suspended-account session bootstrap and fail-closed standing checks passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
