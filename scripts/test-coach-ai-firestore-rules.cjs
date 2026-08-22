const fs = require("node:fs");
const path = require("node:path");
const { assertFails, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { deleteDoc, doc, getDoc, setDoc, updateDoc } = require("firebase/firestore");

const projectId = "sideline-coach-ai-rules-test";
const rules = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf8");

async function run() {
  const testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
  try {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, "coachAiRequests", "parent-a_request-1"), {
        userId: "parent-a",
        category: "practice_plan",
      });
      await setDoc(doc(firestore, "coachAiRateLimits", "parent-a"), {
        count: 1,
      });
      await setDoc(doc(firestore, "coachAiFeedback", "parent-a_request-1"), {
        testerUid: "parent-a",
        rating: "down",
      });
      await setDoc(doc(firestore, "coachAiFeedbackRateLimits", "parent-a"), { count: 1 });
      await setDoc(doc(firestore, "coachAiInternalConfig", "runtime"), { enabled: true });
    });

    const authenticatedDb = testEnv.authenticatedContext("parent-a").firestore();
    const anonymousDb = testEnv.unauthenticatedContext().firestore();

    for (const [collectionName, documentId] of [
      ["coachAiRequests", "parent-a_request-1"],
      ["coachAiRateLimits", "parent-a"],
      ["coachAiFeedback", "parent-a_request-1"],
      ["coachAiFeedbackRateLimits", "parent-a"],
      ["coachAiInternalConfig", "runtime"],
    ]) {
      const authenticatedRef = doc(authenticatedDb, collectionName, documentId);
      const anonymousRef = doc(anonymousDb, collectionName, documentId);
      await assertFails(getDoc(authenticatedRef));
      await assertFails(getDoc(anonymousRef));
      await assertFails(setDoc(doc(authenticatedDb, collectionName, "injected"), { userId: "parent-a" }));
      await assertFails(updateDoc(authenticatedRef, { count: 999 }));
      await assertFails(deleteDoc(authenticatedRef));
    }

    console.log("Coach AI requests, rate limits, feedback, and circuit-breaker records remain inaccessible to all clients.");
  } finally {
    await testEnv.cleanup();
  }
}

run().catch((error) => { console.error(error); process.exit(1); });
