const assert = require("node:assert/strict");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { connectAuthEmulator, createUserWithEmailAndPassword, getAuth } = require("firebase/auth");
const { connectFunctionsEmulator, getFunctions, httpsCallable } = require("firebase/functions");

const projectId = process.env.GCLOUD_PROJECT || "sideline-friend-search-functions-test";
if (!admin.apps.length) admin.initializeApp({ projectId });
const db = admin.firestore();

async function createClient(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = await createUserWithEmailAndPassword(auth, `${label}@example.test`, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return {
    uid: credential.user.uid,
    call: (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}

function createGuestCall(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  return (name, data = {}) => httpsCallable(callableFunctions, name)(data).then((result) => result.data);
}

function hasCode(code) {
  return (error) => String(error?.code).includes(code);
}

async function waitFor(check, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for emulator trigger");
}

async function run() {
  const guestCall = createGuestCall("search-guest");
  const [
    viewer,
    courtland,
    friend,
    outgoing,
    incoming,
    viewerBlocked,
    blocksViewer,
    legacy,
    missingProfile,
  ] = await Promise.all([
    "search-viewer",
    "search-courtland",
    "search-friend",
    "search-outgoing",
    "search-incoming",
    "search-viewer-blocked",
    "search-blocks-viewer",
    "search-legacy",
    "search-missing-profile",
  ].map(createClient));
  const profiles = [
    [viewer, "Joann", "Coach"],
    [courtland, "Courtland", "Tester"],
    [friend, "Friendly", "Parent"],
    [outgoing, "Olivia", "Outgoing"],
    [incoming, "Ian", "Incoming"],
    [viewerBlocked, "Blocked", "One"],
    [blocksViewer, "Blocked", "Two"],
    [legacy, "Legacy", "Parent"],
  ];
  await Promise.all(profiles.map(([client, firstName, lastName]) => (
    db.collection("users").doc(client.uid).set({
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      friendIds: [],
      searchName: `${firstName} ${lastName}`.toLocaleLowerCase(),
      createdAt: admin.firestore.Timestamp.now(),
    })
  )));
  await waitFor(async () => {
    const snapshot = await db.collection("publicUserProfiles").doc(courtland.uid).get();
    return snapshot.data()?.lastNameLower === "tester";
  });

  await Promise.all([
    db.collection("users").doc(viewer.uid).update({ friendIds: [friend.uid] }),
    db.collection("users").doc(friend.uid).update({ friendIds: [viewer.uid] }),
    db.collection("teams").doc("friend-search-team").set({
      name: "Search Team",
      createdBy: viewer.uid,
      memberIds: [viewer.uid, courtland.uid],
    }),
    db.collection("teams").doc("friend-search-team").collection("members").doc(viewer.uid).set({
      userId: viewer.uid, role: "coach", status: "accepted",
    }),
    db.collection("teams").doc("friend-search-team").collection("members").doc(courtland.uid).set({
      userId: courtland.uid, role: "parent", status: "accepted",
    }),
    db.collection("friendRequests").doc(`${viewer.uid}__${outgoing.uid}`).set({
      fromUserId: viewer.uid,
      toUserId: outgoing.uid,
      status: "pending",
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000),
    }),
    db.collection("friendRequests").doc(`${incoming.uid}__${viewer.uid}`).set({
      fromUserId: incoming.uid,
      toUserId: viewer.uid,
      status: "pending",
      createdAt: admin.firestore.Timestamp.now(),
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 86400000),
    }),
    db.collection("userBlocks").doc(viewer.uid).collection("blockedUsers").doc(viewerBlocked.uid).set({
      blockedUserId: viewerBlocked.uid,
      createdAt: admin.firestore.Timestamp.now(),
    }),
    db.collection("userBlocks").doc(blocksViewer.uid).collection("blockedUsers").doc(viewer.uid).set({
      blockedUserId: viewer.uid,
      createdAt: admin.firestore.Timestamp.now(),
    }),
  ]);

  const courtlandByFirst = await viewer.call("searchPublicUserProfiles", { query: "COURT", limit: 20 });
  assert.equal(courtlandByFirst.results.length, 1);
  assert.equal(courtlandByFirst.results[0].userId, courtland.uid);
  assert.equal(courtlandByFirst.results[0].relationship, "none");
  const courtlandByLast = await viewer.call("searchPublicUserProfiles", { query: "tester", limit: 20 });
  assert.equal(courtlandByLast.results[0].userId, courtland.uid, "accepted same-Team parent is discoverable by last name");

  const friendResult = await viewer.call("searchPublicUserProfiles", { query: "friendly", limit: 20 });
  assert.equal(friendResult.results[0].relationship, "friends", "existing friends remain searchable");
  const suggestionResult = await viewer.call("getSuggestedConnections", { queryText: "friendly" });
  assert.equal(suggestionResult.suggestions.some((profile) => profile.userId === friend.uid), false);
  const outgoingResult = await viewer.call("searchPublicUserProfiles", { query: "olivia", limit: 20 });
  assert.equal(outgoingResult.results[0].relationship, "outgoing-request");
  const incomingResult = await viewer.call("searchPublicUserProfiles", { query: "ian", limit: 20 });
  assert.equal(incomingResult.results[0].relationship, "incoming-request");

  const blockedResults = await viewer.call("searchPublicUserProfiles", { query: "blocked", limit: 20 });
  assert.equal(blockedResults.results.some((profile) => profile.userId === viewerBlocked.uid), false);
  assert.equal(blockedResults.results.some((profile) => profile.userId === blocksViewer.uid), false);
  const selfResult = await viewer.call("searchPublicUserProfiles", { query: "joann", limit: 20 });
  assert.equal(selfResult.results.some((profile) => profile.userId === viewer.uid), false);
  const noMatchResult = await viewer.call("searchPublicUserProfiles", { query: "zzzzzz", limit: 20 });
  assert.deepEqual(noMatchResult.results, [], "no matching name returns a normal empty result");
  const missingProfileResult = await missingProfile.call("searchPublicUserProfiles", {
    query: "courtland",
    limit: 20,
  });
  assert.deepEqual(
    missingProfileResult.results,
    [],
    "an authenticated user with no profile document receives a normal empty result",
  );
  await db.collection("publicUserProfiles").doc("deleted-search-profile").set({
    userId: "deleted-search-profile",
    firstName: "Deleted",
    lastName: "Fixture",
    displayName: "Deleted Fixture",
    displayNameLower: "deleted fixture",
    firstNameLower: "deleted",
    lastNameLower: "fixture",
    photoURL: null,
  });
  const deletedResult = await viewer.call("searchPublicUserProfiles", { query: "deleted", limit: 20 });
  assert.equal(
    deletedResult.results.some((profile) => profile.userId === "deleted-search-profile"),
    false,
    "stale projections for deleted Authentication users are excluded",
  );

  const allowedKeys = [
    "displayName",
    "firstName",
    "lastName",
    "photoURL",
    "profileState",
    "relationship",
    "userId",
  ];
  courtlandByFirst.results.forEach((profile) => {
    assert.deepEqual(Object.keys(profile).sort(), allowedKeys);
    for (const privateField of ["email", "phoneNumber", "location", "children", "friendIds"]) {
      assert.equal(Object.hasOwn(profile, privateField), false);
    }
  });

  await db.collection("users").doc(legacy.uid).update({
    searchName: admin.firestore.FieldValue.delete(),
  });
  await waitFor(async () => {
    const synchronized = await db.collection("publicUserProfiles").doc(legacy.uid).get();
    return synchronized.data()?.displayNameLower === "legacy parent";
  });
  await db.collection("publicUserProfiles").doc(legacy.uid).set({
    userId: legacy.uid,
    firstName: "Legacy",
    lastName: "Parent",
    displayName: "Legacy Parent",
    photoURL: null,
    updatedAt: admin.firestore.Timestamp.now(),
  });
  const legacyResult = await viewer.call("searchPublicUserProfiles", { query: "legacy", limit: 20 });
  assert.equal(legacyResult.results[0].userId, legacy.uid, "legacy public profile fallback remains discoverable");
  await waitFor(async () => {
    const repaired = await db.collection("publicUserProfiles").doc(legacy.uid).get();
    return repaired.data()?.firstNameLower === "legacy" && repaired.data()?.lastNameLower === "parent";
  });
  await db.collection("users").doc(legacy.uid).update({
    firstName: "Legacy",
    lastName: "Updated",
    displayName: "Legacy Updated",
  });
  await waitFor(async () => {
    const updated = await db.collection("publicUserProfiles").doc(legacy.uid).get();
    return updated.data()?.displayNameLower === "legacy updated" &&
      updated.data()?.lastNameLower === "updated";
  });
  const renamedResult = await viewer.call("searchPublicUserProfiles", { query: "updated", limit: 20 });
  assert.equal(renamedResult.results[0].userId, legacy.uid, "profile name edits refresh every normalized field");

  await assert.rejects(
    () => guestCall("searchPublicUserProfiles", { query: "courtland", limit: 20 }),
    hasCode("unauthenticated"),
  );
  await assert.rejects(
    () => viewer.call("searchPublicUserProfiles", { query: "a", limit: 20 }),
    hasCode("invalid-argument"),
  );
  await assert.rejects(
    () => viewer.call("searchPublicUserProfiles", {}),
    hasCode("invalid-argument"),
  );
  await assert.rejects(
    () => viewer.call("searchPublicUserProfiles", { query: "parent", limit: 21 }),
    hasCode("invalid-argument"),
  );
  await db.collection("publicUserSearchRateLimits").doc(viewer.uid).set({
    count: 30,
    windowStartedAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  await assert.rejects(
    () => viewer.call("searchPublicUserProfiles", { query: "courtland", limit: 20 }),
    hasCode("resource-exhausted"),
  );

  console.log("Friend Search auth, global Team-independent discovery, first/last prefix, relationship, block, privacy, limit/rate-limit, profile update, and legacy self-heal emulator tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
