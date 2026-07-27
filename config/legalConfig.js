const SUPPORT_EMAIL = "joann@joinsidelinesocial.com";

const RESERVED_HOSTNAMES = new Set([
  "example.com",
  "example.net",
  "example.org",
  "localhost",
]);

const PUBLIC_HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/iu;

function isPublicHostname(value) {
  const hostname = value.toLowerCase().replace(/\.$/u, "");
  if (!PUBLIC_HOSTNAME_PATTERN.test(hostname)) return false;
  if (RESERVED_HOSTNAMES.has(hostname)) return false;
  if (
    hostname.endsWith(".example.com") ||
    hostname.endsWith(".example.net") ||
    hostname.endsWith(".example.org") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".test")
  ) {
    return false;
  }
  return true;
}

function normalizePublicHttpsUrl(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      !isPublicHostname(parsed.hostname)
    ) {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function validateProductionLegalConfig(input) {
  const errors = [];
  const urls = [
    ["EXPO_PUBLIC_PRIVACY_POLICY_URL", input.privacyPolicyUrl],
    ["EXPO_PUBLIC_TERMS_OF_USE_URL", input.termsOfUseUrl],
    ["EXPO_PUBLIC_SUPPORT_URL", input.supportUrl],
  ];

  for (const [name, value] of urls) {
    if (typeof value !== "string" || !value.trim()) {
      errors.push(`${name} is required for a production release.`);
    } else if (!normalizePublicHttpsUrl(value)) {
      errors.push(`${name} must be a valid public HTTPS URL.`);
    }
  }

  if (input.supportEmail !== SUPPORT_EMAIL) {
    errors.push("The bundled Sideline Social support email does not match the approved release contact.");
  }

  return {
    errors,
    valid: errors.length === 0,
  };
}

function assertProductionLegalConfig(input) {
  const result = validateProductionLegalConfig(input);
  if (!result.valid) {
    throw new Error(
      `Production legal configuration is invalid:\n${result.errors.map((error) => `- ${error}`).join("\n")}`,
    );
  }
}

module.exports = {
  SUPPORT_EMAIL,
  assertProductionLegalConfig,
  normalizePublicHttpsUrl,
  validateProductionLegalConfig,
};
