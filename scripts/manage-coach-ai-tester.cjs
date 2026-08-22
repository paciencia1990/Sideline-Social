#!/usr/bin/env node
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const admin = require("../functions/node_modules/firebase-admin");
const { claimsEqual, nextTesterClaims, parseTesterClaimArgs } = require("./coach-ai-tester-claims-core.cjs");

async function main() {
  const options = parseTesterClaimArgs(process.argv.slice(2));
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: options.project });
  const auth = admin.auth();
  const user = options.uid ? await auth.getUser(options.uid) : await auth.getUserByEmail(options.email);
  const existing = user.customClaims || {};
  const currentStatus = existing.aiCoachTester === true ? "granted" : "not granted";
  console.log(`Project: ${options.project}`);
  console.log(`Account: ${user.uid}${user.email ? ` (${user.email})` : ""}`);
  console.log(`AI Coach tester claim: ${currentStatus}`);

  if (options.operation === "status") return;
  const next = nextTesterClaims(existing, options.operation);
  if (options.dryRun) {
    console.log(`Dry run: would ${options.operation} aiCoachTester and preserve ${Object.keys(existing).filter((key) => key !== "aiCoachTester").length} unrelated claim(s).`);
    return;
  }
  if (!options.yes) {
    const prompt = readline.createInterface({ input: stdin, output: stdout });
    const answer = await prompt.question(`Type ${options.operation.toUpperCase()} to confirm this account and project: `);
    prompt.close();
    if (answer !== options.operation.toUpperCase()) throw new Error("Confirmation did not match; no claims changed.");
  }
  await auth.setCustomUserClaims(user.uid, next);
  const verified = (await auth.getUser(user.uid)).customClaims || {};
  if (!claimsEqual(next, verified)) throw new Error("Claim verification failed.");
  console.log(`Verified: aiCoachTester ${options.operation === "grant" ? "granted" : "revoked"}.`);
  console.log("The tester must refresh the ID token or sign out and back in.");
}

main()
  .then(() => Promise.all(admin.apps.map((app) => app.delete())))
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : "Tester claim operation failed.");
    await Promise.all(admin.apps.map((app) => app.delete()));
    process.exit(1);
  });
