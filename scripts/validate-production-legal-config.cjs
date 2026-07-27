const {
  SUPPORT_EMAIL,
  validateProductionLegalConfig,
} = require("../config/legalConfig");

const result = validateProductionLegalConfig({
  privacyPolicyUrl: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
  termsOfUseUrl: process.env.EXPO_PUBLIC_TERMS_OF_USE_URL,
  supportUrl: process.env.EXPO_PUBLIC_SUPPORT_URL,
  supportEmail: SUPPORT_EMAIL,
});

if (!result.valid) {
  console.error("Production legal configuration validation failed.");
  result.errors.forEach((error) => console.error(`ERROR: ${error}`));
  process.exitCode = 1;
} else {
  console.log("Production privacy, terms, support URL, and support email validation passed.");
}
