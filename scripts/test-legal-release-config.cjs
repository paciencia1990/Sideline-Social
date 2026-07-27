const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SUPPORT_EMAIL,
  assertProductionLegalConfig,
  normalizePublicHttpsUrl,
  validateProductionLegalConfig,
} = require("../config/legalConfig");

const root = path.resolve(__dirname, "..");
const read = (...segments) => fs.readFileSync(path.join(root, ...segments), "utf8");
const appConfigPath = path.join(root, "app.config.js");
const validConfig = {
  privacyPolicyUrl: "https://www.iana.org/help/example-domains?document=privacy",
  termsOfUseUrl: "https://www.iana.org/help/example-domains?document=terms",
  supportUrl: "https://www.iana.org/help/example-domains?document=support",
  supportEmail: SUPPORT_EMAIL,
};

assert.equal(SUPPORT_EMAIL, "joann@joinsidelinesocial.com");
assert.deepEqual(validateProductionLegalConfig(validConfig), { errors: [], valid: true });
assert.doesNotThrow(() => assertProductionLegalConfig(validConfig));
assert.equal(
  normalizePublicHttpsUrl("  https://www.iana.org/help/example-domains?language=en#summary  "),
  "https://www.iana.org/help/example-domains?language=en#summary",
);

for (const invalidUrl of [
  "",
  "http://www.iana.org/help/example-domains",
  "https://",
  "https://example.com/privacy",
  "https://localhost/privacy",
  "https://privacy",
  "https://127.0.0.1/privacy",
  "https://user:password@www.iana.org/help/example-domains",
  "https://www.iana.org:8443/help/example-domains",
]) {
  assert.equal(normalizePublicHttpsUrl(invalidUrl), null, `${invalidUrl || "empty URL"} must not pass`);
}

for (const field of ["privacyPolicyUrl", "termsOfUseUrl", "supportUrl"]) {
  const result = validateProductionLegalConfig({ ...validConfig, [field]: undefined });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes(" is required for a production release.")));
}

const invalidValue = "http://private-host.local/legal?token=do-not-log";
const invalidResult = validateProductionLegalConfig({
  ...validConfig,
  privacyPolicyUrl: invalidValue,
});
assert.equal(invalidResult.valid, false);
assert.equal(invalidResult.errors.some((error) => error.includes(invalidValue)), false);
assert.throws(
  () => assertProductionLegalConfig({ ...validConfig, supportEmail: "other@example.com" }),
  /approved release contact/u,
);

function loadAppConfig(environment) {
  const names = [
    "APP_VARIANT",
    "REQUIRE_PRODUCTION_LEGAL_CONFIG",
    "EXPO_PUBLIC_PRIVACY_POLICY_URL",
    "EXPO_PUBLIC_TERMS_OF_USE_URL",
    "EXPO_PUBLIC_SUPPORT_URL",
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    names.forEach((name) => delete process.env[name]);
    Object.assign(process.env, environment);
    delete require.cache[require.resolve(appConfigPath)];
    return require(appConfigPath);
  } finally {
    names.forEach((name) => {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    });
    delete require.cache[require.resolve(appConfigPath)];
  }
}

assert.doesNotThrow(() => loadAppConfig({ APP_VARIANT: "development" }));
assert.doesNotThrow(() => loadAppConfig({
  APP_VARIANT: "development",
  REQUIRE_PRODUCTION_LEGAL_CONFIG: "true",
}));
assert.doesNotThrow(() => loadAppConfig({
  APP_VARIANT: "production",
  REQUIRE_PRODUCTION_LEGAL_CONFIG: "true",
  EXPO_PUBLIC_PRIVACY_POLICY_URL: validConfig.privacyPolicyUrl,
  EXPO_PUBLIC_TERMS_OF_USE_URL: validConfig.termsOfUseUrl,
  EXPO_PUBLIC_SUPPORT_URL: validConfig.supportUrl,
}));
assert.throws(
  () => loadAppConfig({
    APP_VARIANT: "production",
    REQUIRE_PRODUCTION_LEGAL_CONFIG: "true",
  }),
  /EXPO_PUBLIC_PRIVACY_POLICY_URL is required/u,
);

const appConfig = read("app.config.js");
const eas = JSON.parse(read("eas.json"));
assert.match(appConfig, /!IS_DEVELOPMENT && process\.env\.REQUIRE_PRODUCTION_LEGAL_CONFIG === "true"/u);
assert.match(appConfig, /assertProductionLegalConfig\(\{/u);
assert.equal(eas.build.production.env.REQUIRE_PRODUCTION_LEGAL_CONFIG, "true");
assert.equal(eas.build.development.env.REQUIRE_PRODUCTION_LEGAL_CONFIG, undefined);
assert.equal(eas.build.preview.env?.REQUIRE_PRODUCTION_LEGAL_CONFIG, undefined);

console.log("Production legal URL, support contact, safe-error, and cross-platform build-gate tests passed.");
