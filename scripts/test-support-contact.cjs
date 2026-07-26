const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

const legalConfig = read("config", "legal.ts");
const legalScreen = read("app", "settings", "legal.tsx");
const translations = read("i18n", "index.ts");

assert.match(legalConfig, /joann@joinsidelinesocial\.com/);
assert.match(legalScreen, /`mailto:\$\{SUPPORT_EMAIL\}`/);
assert.match(legalScreen, /accessibilityRole="link"/);
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

console.log("Support contact email, mailto link, accessibility, localization, and preserved legal sections tests passed.");
