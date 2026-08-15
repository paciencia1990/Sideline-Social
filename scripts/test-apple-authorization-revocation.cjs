"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { generateKeyPairSync } = require("node:crypto");

const root = process.cwd();
const modulePath = path.join(root, "functions", "lib", "appleAuthorizationRevocation.js");
const source = fs.readFileSync(path.join(root, "functions", "src", "appleAuthorizationRevocation.ts"), "utf8");
const deletionSource = fs.readFileSync(path.join(root, "functions", "src", "accountDeletion.ts"), "utf8");
const clientSource = fs.readFileSync(path.join(root, "app", "settings", "delete-account.tsx"), "utf8");
const apple = require(modulePath);

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
const secrets = {
  clientId: "com.sidelinesocial.app",
  keyId: "ABCDEFGHIJ",
  privateKey: privateKeyPem,
  teamId: "KLMNOPQRST",
};

function response(status, body = "") {
  return { status, text: async () => body };
}

function identityToken(subject) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ sub: subject })}.test-signature`;
}

async function expectCategory(operation, category) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.category, category);
    assert.equal(String(error).includes("one-time-code"), false);
    assert.equal(String(error).includes("server-refresh-token"), false);
    return true;
  });
}

async function run() {
  assert.equal(apple.resolveAppleDeletionAuthorization({ authorizationCode: null, providerIds: ["password"] }), null);
  assert.equal(
    apple.resolveAppleDeletionAuthorization({ authorizationCode: "fresh-code", providerIds: ["password", "apple.com"] }),
    "fresh-code",
  );
  assert.throws(
    () => apple.resolveAppleDeletionAuthorization({ authorizationCode: null, providerIds: ["apple.com"] }),
    (error) => error.category === "apple_authorization_code_required",
  );
  assert.throws(
    () => apple.resolveAppleDeletionAuthorization({ authorizationCode: "wrong-account-code", providerIds: ["password"] }),
    (error) => error.category === "apple_provider_not_linked",
  );

  const calls = [];
  const result = await apple.revokeAppleAuthorizationCode({
    authorizationCode: "one-time-code",
    expectedAppleSubject: "linked-apple-subject",
    nowSeconds: 1_800_000_000,
    secrets,
    transport: async (url, init) => {
      calls.push({ url, init });
      return calls.length === 1
        ? response(200, JSON.stringify({
            access_token: "server-access-token",
            id_token: identityToken("linked-apple-subject"),
            refresh_token: "server-refresh-token",
          }))
        : response(200);
    },
  });

  assert.deepEqual(result, { revoked: true, tokenType: "refresh_token" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://appleid.apple.com/auth/token");
  assert.equal(calls[1].url, "https://appleid.apple.com/auth/revoke");
  const exchange = new URLSearchParams(calls[0].init.body);
  const revocation = new URLSearchParams(calls[1].init.body);
  assert.equal(exchange.get("code"), "one-time-code");
  assert.equal(exchange.get("grant_type"), "authorization_code");
  assert.equal(exchange.get("client_id"), "com.sidelinesocial.app");
  assert.equal(revocation.get("token"), "server-refresh-token");
  assert.equal(revocation.get("token_type_hint"), "refresh_token");

  const jwtParts = exchange.get("client_secret").split(".");
  assert.equal(jwtParts.length, 3);
  const claims = JSON.parse(Buffer.from(jwtParts[1], "base64url").toString("utf8"));
  assert.equal(claims.iss, secrets.teamId);
  assert.equal(claims.sub, "com.sidelinesocial.app");
  assert.equal(claims.aud, "https://appleid.apple.com");
  assert.equal(claims.exp - claims.iat, 300);

  await expectCategory(
    () => apple.revokeAppleAuthorizationCode({ authorizationCode: "", expectedAppleSubject: "linked-apple-subject", secrets, transport: async () => response(500) }),
    "apple_authorization_code_invalid",
  );
  await expectCategory(
    () => apple.revokeAppleAuthorizationCode({ authorizationCode: "expired-or-replayed", expectedAppleSubject: "linked-apple-subject", secrets, transport: async () => response(400, '{"error":"invalid_grant"}') }),
    "apple_token_exchange_failed",
  );
  await expectCategory(
    () => apple.revokeAppleAuthorizationCode({
      authorizationCode: "valid-code",
      expectedAppleSubject: "linked-apple-subject",
      secrets,
      transport: async (url) => url.endsWith("/token")
        ? response(200, JSON.stringify({ id_token: identityToken("linked-apple-subject"), refresh_token: "server-refresh-token" }))
        : response(503, "upstream unavailable"),
    }),
    "apple_revocation_failed",
  );
  await expectCategory(
    () => apple.revokeAppleAuthorizationCode({
      authorizationCode: "valid-code",
      expectedAppleSubject: "linked-apple-subject",
      secrets: { ...secrets, clientId: "incorrect.services.id" },
      transport: async () => response(200),
    }),
    "apple_credentials_unavailable",
  );
  await expectCategory(
    () => apple.revokeAppleAuthorizationCode({
      authorizationCode: "valid-code-from-another-apple-account",
      expectedAppleSubject: "linked-apple-subject",
      secrets,
      transport: async () => response(200, JSON.stringify({
        id_token: identityToken("different-apple-subject"),
        refresh_token: "server-refresh-token",
      })),
    }),
    "apple_subject_mismatch",
  );

  assert.match(deletionSource, /secrets: \[\.\.\.APPLE_REVOCATION_SECRET_NAMES\]/u);
  assert.match(deletionSource, /status: 'processing'/u, "Duplicate deletion calls must use a server-side processing lock.");
  assert.match(deletionSource, /status: 'revoked'/u, "Successful revocation must be retry-safe if later cleanup is interrupted.");
  assert.match(deletionSource, /apple_provider_not_linked/u);
  assert.match(source, /apple_authorization_code_required/u);
  assert.match(deletionSource, /account_deletion_in_progress/u);
  assert.match(deletionSource, /token\.auth_time/u);
  assert.match(clientSource, /appleAuthorizationRef/u);
  assert.equal(/console\.(log|warn|error).*authorizationCode/u.test(source), false);
  assert.equal(source.includes("APPLE_PRIVATE_KEY="), false);
  assert.equal(source.includes("server-refresh-token"), false);

  console.log("Apple authorization-code exchange, revocation, secret JWT, retry lock, sanitized failures, and client handoff checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
