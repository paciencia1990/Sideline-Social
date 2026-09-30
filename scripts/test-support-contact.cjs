const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const legalConfig = read("config", "legal.ts");
const legalValidation = read("config", "legalConfig.js");
const legalScreen = read("app", "settings", "legal.tsx");
const translations = read("i18n", "index.ts");

assert.match(legalConfig, /normalizePublicHttpsUrl/);
assert.match(legalValidation, /info@joinsidelinesocial\.com/);
assert.match(legalScreen, /`mailto:\$\{SUPPORT_EMAIL\}`/);
assert.match(legalScreen, /accessibilityRole="link"/);
assert.match(legalScreen, /Linking\.openURL\(url\)/);
assert.match(translations, /You may appeal while this restriction or suspension is active\./);
assert.match(translations, /submitted appeal may still be reviewed and the record corrected\./);
assert.match(translations, /Concerns first raised after it ends can be sent to info@joinsidelinesocial\.com\./);
assert.match(translations, /We aim to begin reviewing appeals within two business days\./);
assert.match(translations, /Puedes apelar mientras esta restricci/);
assert.match(translations, /info@joinsidelinesocial\.com/);
assert.match(legalScreen, /openExternalLink\(SUPPORT_URL\)/);
assert.match(legalScreen, /catch\s*\{[\s\S]*settings\.linkErrorTitle[\s\S]*settings\.linkErrorBody/);
assert.match(legalScreen, /settings\.supportEmailAccessibility/);
assert.match(legalScreen, /settings\.supportEmail/);
assert.match(legalScreen, /settings\.privacyTitle/);
assert.match(legalScreen, /settings\.termsTitle/);
assert.match(legalScreen, /settings\.communityTitle/);
assert.equal(
  (translations.match(/supportEmail:/g) ?? []).length,
  2,
  "support email label is localized in English and Spanish",
);
assert.equal(
  (translations.match(/supportEmailAccessibility:/g) ?? []).length,
  2,
  "support email accessibility label is localized in English and Spanish",
);
for (const key of ["openFullPolicy", "openTerms", "contactSupport", "linkErrorTitle", "linkErrorBody"]) {
  assert.equal(
    (translations.match(new RegExp(`${key}:`, "g")) ?? []).length,
    2,
    `${key} must be localized in English and Spanish`,
  );
}

console.log("Support contact email, mailto link, accessibility, localization, and preserved legal sections tests passed.");
