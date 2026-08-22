#!/usr/bin/env node
const readline = require("node:readline/promises");
const admin = require("../functions/node_modules/firebase-admin");

async function main() {
  const [operation, ...tokens] = process.argv.slice(2);
  if (!["status", "enable", "disable"].includes(operation)) throw new Error("Operation must be status, enable, or disable.");
  const projectIndex = tokens.indexOf("--project");
  const projectId = projectIndex >= 0 ? tokens[projectIndex + 1] : "";
  if (!/^[a-z][a-z0-9-]{4,29}$/i.test(projectId)) throw new Error("A valid explicit --project is required.");
  const dryRun = tokens.includes("--dry-run");
  const ciApproved = tokens.includes("--ci") && tokens.includes("--yes") && process.env.COACH_AI_RUNTIME_CI === "true";
  if (tokens.includes("--yes") && !ciApproved) throw new Error("--yes requires --ci and COACH_AI_RUNTIME_CI=true.");
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  const ref = admin.firestore().collection("coachAiInternalConfig").doc("runtime");
  const snapshot = await ref.get();
  console.log(`Project: ${projectId}`);
  console.log(`Coach AI runtime: ${snapshot.data()?.enabled === true ? "enabled" : "disabled (fail closed)"}`);
  if (operation === "status") return;
  const enabled = operation === "enable";
  if (dryRun) {
    console.log(`Dry run: would set the runtime circuit breaker to ${enabled ? "enabled" : "disabled"}.`);
    return;
  }
  if (!ciApproved) {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    const expected = `${operation.toUpperCase()} ${projectId}`;
    const answer = await prompt.question(`Type ${expected} to confirm: `);
    prompt.close();
    if (answer !== expected) throw new Error("Confirmation did not match; runtime state was not changed.");
  }
  await ref.set({ enabled, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const verified = await ref.get();
  if (verified.data()?.enabled !== enabled) throw new Error("Runtime circuit-breaker verification failed.");
  console.log(`Verified: Coach AI runtime is ${enabled ? "enabled" : "disabled"}.`);
}

main()
  .then(() => Promise.all(admin.apps.map((app) => app.delete())))
  .catch(async (error) => {
    console.error(error instanceof Error ? error.message : "Runtime operation failed.");
    await Promise.all(admin.apps.map((app) => app.delete()));
    process.exit(1);
  });
