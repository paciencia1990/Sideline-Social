const OPERATIONS = new Set(["grant", "revoke", "status"]);

function parseTesterClaimArgs(argv, environment = process.env) {
  const [operation, ...tokens] = argv;
  if (!OPERATIONS.has(operation)) throw new Error("Operation must be grant, revoke, or status.");
  const options = { operation, dryRun: false, ci: false, yes: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--dry-run") options.dryRun = true;
    else if (token === "--ci") options.ci = true;
    else if (token === "--yes") options.yes = true;
    else if (["--project", "--uid", "--email"].includes(token)) {
      const value = tokens[++index];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      options[token.slice(2)] = value.trim();
    } else throw new Error(`Unknown argument: ${token}`);
  }
  if (!/^[a-z][a-z0-9-]{4,29}$/i.test(options.project || "")) throw new Error("A valid explicit --project is required.");
  if (Boolean(options.uid) === Boolean(options.email)) throw new Error("Provide exactly one of --uid or --email.");
  if (options.yes && (!options.ci || environment.COACH_AI_CLAIMS_CI !== "true")) {
    throw new Error("--yes requires --ci and COACH_AI_CLAIMS_CI=true.");
  }
  if (options.ci && !options.yes) throw new Error("CI mode requires the explicit --yes safeguard.");
  return options;
}

function nextTesterClaims(existingClaims, operation) {
  const next = { ...(existingClaims || {}) };
  if (operation === "grant") next.aiCoachTester = true;
  if (operation === "revoke") delete next.aiCoachTester;
  return next;
}

function claimsEqual(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

module.exports = { claimsEqual, nextTesterClaims, parseTesterClaimArgs };
