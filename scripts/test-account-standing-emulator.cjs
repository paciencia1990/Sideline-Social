const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  signInWithEmailAndPassword,
  signInAnonymously,
  signOut,
} = require("firebase/auth");
const {
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  setDoc,
} = require("firebase/firestore");
const {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} = require("firebase/functions");
const {
  connectDatabaseEmulator,
  get: getDatabaseValue,
  getDatabase,
  ref: databaseRef,
} = require("firebase/database");
const {
  connectStorageEmulator,
  getStorage,
  ref: storageRef,
  uploadBytes,
} = require("firebase/storage");

const projectId = process.env.GCLOUD_PROJECT || "sideline-account-standing-test";
const databaseURL = `https://${projectId}.firebaseio.com`;
if (!admin.apps.length) {
  admin.initializeApp({
    projectId,
    databaseURL,
    storageBucket: `${projectId}.appspot.com`,
  });
}
const adminDb = admin.firestore();

async function createClient(label, anonymous = false) {
  const email = `${label}@example.test`;
  const app = initializeApp({
    apiKey: "demo-key",
    projectId,
    databaseURL,
    storageBucket: `${projectId}.appspot.com`,
  }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const credential = anonymous
    ? await signInAnonymously(auth)
    : await createUserWithEmailAndPassword(auth, email, "ValidPass123!");
  const callableFunctions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(callableFunctions, "127.0.0.1", 5001);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  const database = getDatabase(app);
  connectDatabaseEmulator(database, "127.0.0.1", 9000);
  const storage = getStorage(app);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  return {
    auth,
    email,
    database,
    firestore,
    storage,
    uid: credential.user.uid,
    call: (name, data = {}) =>
      httpsCallable(callableFunctions, name)(data).then((result) => result.data),
  };
}

function hasCode(code) {
  return (error) => String(error?.code).includes(code);
}

async function rejectsCode(promise, code, message) {
  await assert.rejects(promise, hasCode(code), message);
}

async function waitFor(check, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for account-standing projection");
}

async function setStanding(client, input) {
  await adminDb.collection("accountStanding").doc(client.uid).set({
    status: input.status,
    messagingRestricted: input.messagingRestricted === true,
    effectiveAt: admin.firestore.Timestamp.now(),
    expiresAt: input.expiresAt ?? null,
    reasonCode: "communityGuidelines",
    caseId: input.caseId ?? null,
    actionReference: input.caseId
      ? `moderationCases/${input.caseId}/actions/action-1`
      : null,
    revision: input.revision ?? 1,
    updatedAt: admin.firestore.Timestamp.now(),
    updatedBy: "moderation-admin",
  });
  await waitFor(async () => {
    const [projection, mirror] = await Promise.all([
      adminDb.collection("accountStandingPublic").doc(client.uid).get(),
      admin.database().ref(`accountStanding/${client.uid}`).get(),
    ]);
    return projection.data()?.revision === (input.revision ?? 1) &&
      mirror.val()?.revision === (input.revision ?? 1);
  });
}

async function seedVoiceReservation(client, reservationId, targetId) {
  await adminDb.collection("teamVoiceUploadReservations").doc(reservationId).set({
    reservationId,
    teamId: "team-standing",
    userId: client.uid,
    status: "pending",
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
    kind: "announcement",
    targetId,
    storagePath: `teamVoiceMemos/team-standing/announcements/${targetId}/${reservationId}/memo.m4a`,
    voiceMemo: {
      durationMilliseconds: 1_000,
      sizeBytes: 4,
      mimeType: "audio/mp4",
    },
  });
}

function hashHex(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function seedFriendMediaAccessGrant(client, otherUid, label) {
  const conversationId = `standingmedia_${hashHex(`${label}:conversation`).slice(0, 16)}`;
  const messageId = `message_${hashHex(`${label}:message`)}`;
  const reservationId = `media_${hashHex(`${label}:reservation`)}`;
  const storagePath = `friendChatMedia/${conversationId}/${messageId}/${reservationId}/voice.m4a`;
  const grantToken = hashHex(`${label}:grant`);
  const grantDocId = hashHex(grantToken);
  const now = admin.firestore.Timestamp.now();
  await Promise.all([
    adminDb.collection("friendConversations").doc(conversationId).set({
      conversationId,
      conversationType: "direct",
      status: "active",
      activeParticipantIds: [client.uid, otherUid],
    }),
    adminDb.collection("friendConversations").doc(conversationId)
      .collection("members").doc(client.uid).set({
        userId: client.uid,
        status: "active",
      }),
    adminDb.collection("friendConversations").doc(conversationId)
      .collection("members").doc(otherUid).set({
        userId: otherUid,
        status: "active",
      }),
    adminDb.collection("friendConversations").doc(conversationId)
      .collection("messages").doc(messageId).set({
        caption: null,
        conversationId,
        createdAt: now,
        mediaStoragePaths: [storagePath],
        messageId,
        messageType: "voice",
        senderUserId: client.uid,
        status: "active",
        text: "",
        visibleToUserIds: [client.uid, otherUid],
        voiceMemo: {
          durationMilliseconds: 1_000,
          mimeType: "audio/mp4",
          sizeBytes: 4,
          storagePath,
        },
      }),
    adminDb.collection("friendChatUploadReservations").doc(reservationId).set({
      clientMessageId: `client_${hashHex(`${label}:client`).slice(0, 16)}`,
      conversationId,
      createdAt: now,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
      kind: "voice",
      reservationId,
      status: "finalized",
      storagePath,
      targetId: messageId,
      userId: client.uid,
      voiceMemo: {
        durationMilliseconds: 1_000,
        mimeType: "audio/mp4",
        sizeBytes: 4,
      },
    }),
    adminDb.collection("friendChatMediaPlaybackGrants").doc(grantDocId).set({
      conversationId,
      createdAt: now,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
      mediaKind: "voice",
      messageId,
      storagePath,
      userId: client.uid,
    }),
    admin.storage().bucket().file(storagePath).save(Buffer.from([1, 2, 3, 4]), {
      metadata: { contentType: "audio/mp4" },
    }),
  ]);
  return { conversationId, grantDocId, grantToken, reservationId, storagePath };
}

async function seedPendingFriendMediaReservation(client, label) {
  const conversationId = `standingpending_${hashHex(`${label}:conversation`).slice(0, 16)}`;
  const messageId = `message_${hashHex(`${label}:message`)}`;
  const reservationId = `media_${hashHex(`${label}:reservation`)}`;
  const storagePath = `friendChatMedia/${conversationId}/${messageId}/${reservationId}/voice.m4a`;
  await adminDb.collection("friendChatUploadReservations").doc(reservationId).set({
    conversationId,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 60_000),
    kind: "voice",
    reservationId,
    status: "pending",
    storagePath,
    targetId: messageId,
    userId: client.uid,
    voiceMemo: {
      durationMilliseconds: 1_000,
      mimeType: "audio/mp4",
      sizeBytes: 4,
    },
  });
  await admin.storage().bucket().file(storagePath).save(Buffer.from([1, 2, 3, 4]), {
    metadata: { contentType: "audio/mp4" },
  });
  return { reservationId, storagePath };
}

async function streamFriendMediaStatus(grantToken, method = "HEAD") {
  const response = await fetch(
    `http://127.0.0.1:5001/${projectId}/us-central1/streamFriendChatMedia?grant=${grantToken}`,
    { method },
  );
  return response.status;
}

async function installDatabaseRulesForFunctionsNamespace() {
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  assert.equal(typeof emulatorHost, "string", "The Realtime Database emulator host is required");
  const rules = JSON.parse(fs.readFileSync(path.join(process.cwd(), "database.rules.json"), "utf8"));
  const response = await fetch(
    `http://${emulatorHost}/.settings/rules.json?ns=${projectId}`,
    {
      method: "PUT",
      headers: {
        authorization: "Bearer owner",
        "content-type": "application/json",
      },
      body: JSON.stringify(rules),
    },
  );
  assert.equal(response.ok, true, "The account-standing Functions namespace must load RTDB rules");
  const verification = await fetch(
    `http://${emulatorHost}/.settings/rules.json?ns=${projectId}`,
    { headers: { authorization: "Bearer owner" } },
  );
  assert.equal(verification.ok, true);
  const loaded = await verification.json();
  assert.equal(
    loaded?.rules?.accountStanding?.[".read"],
    false,
    "the Functions namespace keeps standing server-only",
  );
  assert.match(
    String(loaded?.rules?.gameSessions?.$sessionId?.[".read"]),
    /accountStanding/,
    "the Functions namespace enforces standing on game reads",
  );
}

async function assertAuthenticatedDatabaseReadDenied(client, targetPath, message) {
  const emulatorHost = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  const token = await client.auth.currentUser.getIdToken();
  const response = await fetch(
    `http://${emulatorHost}/${targetPath}.json?ns=${projectId}&auth=${encodeURIComponent(token)}`,
  );
  assert.notEqual(response.status, 200, message);
}

async function run() {
  await installDatabaseRulesForFunctionsNamespace();
  const [
    activeParent,
    activeCoach,
    activeStaff,
    messagingRestricted,
    suspended,
    banned,
    blocked,
    moderator,
    moderationAdmin,
    anonymous,
  ] = await Promise.all([
    "standing-active-parent",
    "standing-active-coach",
    "standing-active-staff",
    "standing-messaging-restricted",
    "standing-suspended",
    "standing-banned",
    "standing-blocked",
    "standing-moderator",
    "standing-moderation-admin",
  ].map((label) => createClient(label)).concat(createClient("standing-anonymous", true)));

  const permanentClients = [
    activeParent,
    activeCoach,
    activeStaff,
    messagingRestricted,
    suspended,
    banned,
    blocked,
    moderator,
    moderationAdmin,
  ];
  await Promise.all(permanentClients.map((client) =>
    adminDb.collection("users").doc(client.uid).set({
      firstName: client.uid === activeCoach.uid ? "Coach" : "Adult",
      lastName: "Tester",
      displayName: "Adult Tester",
      friendIds: [],
    }, { merge: true })));
  await Promise.all([
    admin.auth().setCustomUserClaims(moderator.uid, { moderationRole: "moderator" }),
    admin.auth().setCustomUserClaims(moderationAdmin.uid, { moderationRole: "moderationAdmin" }),
    seedVoiceReservation(messagingRestricted, "voice-restricted", "announcement-restricted"),
    adminDb.collection("friendRequests").doc("pending-before-restriction").set({
      requestId: "pending-before-restriction",
      fromUserId: messagingRestricted.uid,
      toUserId: activeParent.uid,
      status: "pending",
      createdAt: admin.firestore.Timestamp.now(),
    }),
    adminDb.collection("notificationTokens").doc("suspended-token").set({
      uid: suspended.uid,
      platform: "android",
      token: "emulator-token",
    }),
    adminDb.collection("userNotifications").doc(suspended.uid)
      .collection("notifications").doc("standing-notification").set({
        status: "active",
        isRead: false,
        type: "generic",
      }),
  ]);

  const [activeMedia, restrictedMedia, suspendedMedia, bannedMedia] = await Promise.all([
    seedFriendMediaAccessGrant(activeParent, activeCoach.uid, "active-media"),
    seedFriendMediaAccessGrant(messagingRestricted, activeParent.uid, "restricted-media"),
    seedFriendMediaAccessGrant(suspended, activeParent.uid, "suspended-media"),
    seedFriendMediaAccessGrant(banned, activeParent.uid, "banned-media"),
  ]);
  const [restrictedPendingMedia, suspendedPendingMedia, bannedPendingMedia] = await Promise.all([
    seedPendingFriendMediaReservation(messagingRestricted, "restricted-pending-media"),
    seedPendingFriendMediaReservation(suspended, "suspended-pending-media"),
    seedPendingFriendMediaReservation(banned, "banned-pending-media"),
  ]);
  assert.equal(await streamFriendMediaStatus(activeMedia.grantToken), 200);
  assert.equal(await streamFriendMediaStatus(activeMedia.grantToken, "GET"), 200);
  assert.equal(await streamFriendMediaStatus(restrictedMedia.grantToken), 200);
  assert.equal(await streamFriendMediaStatus(suspendedMedia.grantToken), 200);
  assert.equal(await streamFriendMediaStatus(bannedMedia.grantToken), 200);

  await Promise.all([
    setStanding(messagingRestricted, { status: "active", messagingRestricted: true }),
    setStanding(suspended, {
      status: "suspended",
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 3_600_000),
    }),
    setStanding(banned, { status: "banned" }),
  ]);

  await waitFor(async () => {
    const [
      reservation,
      request,
      token,
      notification,
      restrictedPending,
      suspendedPending,
      bannedPending,
      restrictedGrant,
      suspendedGrant,
      bannedGrant,
    ] = await Promise.all([
      adminDb.collection("teamVoiceUploadReservations").doc("voice-restricted").get(),
      adminDb.collection("friendRequests").doc("pending-before-restriction").get(),
      adminDb.collection("notificationTokens").doc("suspended-token").get(),
      adminDb.collection("userNotifications").doc(suspended.uid)
        .collection("notifications").doc("standing-notification").get(),
      adminDb.collection("friendChatUploadReservations").doc(restrictedPendingMedia.reservationId).get(),
      adminDb.collection("friendChatUploadReservations").doc(suspendedPendingMedia.reservationId).get(),
      adminDb.collection("friendChatUploadReservations").doc(bannedPendingMedia.reservationId).get(),
      adminDb.collection("friendChatMediaPlaybackGrants").doc(restrictedMedia.grantDocId).get(),
      adminDb.collection("friendChatMediaPlaybackGrants").doc(suspendedMedia.grantDocId).get(),
      adminDb.collection("friendChatMediaPlaybackGrants").doc(bannedMedia.grantDocId).get(),
    ]);
    return reservation.data()?.status === "canceled" &&
      request.data()?.status === "canceled" &&
      !token.exists &&
      notification.data()?.status === "dismissed" &&
      restrictedPending.data()?.status === "deletePending" &&
      suspendedPending.data()?.status === "deletePending" &&
      bannedPending.data()?.status === "deletePending" &&
      !restrictedGrant.exists &&
      !suspendedGrant.exists &&
      !bannedGrant.exists;
  });

  assert.equal(
    await streamFriendMediaStatus(activeMedia.grantToken),
    200,
    "active accounts keep authorized historical friend media access",
  );
  assert.notEqual(
    await streamFriendMediaStatus(restrictedMedia.grantToken),
    200,
    "messaging-restricted accounts lose historical friend media access",
  );
  assert.notEqual(
    await streamFriendMediaStatus(suspendedMedia.grantToken),
    200,
    "suspended accounts lose historical friend media access",
  );
  assert.notEqual(
    await streamFriendMediaStatus(bannedMedia.grantToken),
    200,
    "banned accounts lose historical friend media access",
  );
  await rejectsCode(
    messagingRestricted.call("createFriendChatVoiceUpload", {}),
    "permission-denied",
    "messaging-restricted stale credentials cannot reserve friend media",
  );
  await rejectsCode(
    suspended.call("createFriendChatVoiceUpload", {}),
    "permission-denied",
    "suspended stale credentials cannot reserve friend media",
  );
  await rejectsCode(
    banned.call("createFriendChatVoiceUpload", {}),
    "permission-denied",
    "banned stale credentials cannot reserve friend media",
  );

  assert.equal(
    (await admin.auth().getUser(moderator.uid)).customClaims?.moderationRole,
    "moderator",
  );
  assert.equal(
    (await admin.auth().getUser(moderationAdmin.uid)).customClaims?.moderationRole,
    "moderationAdmin",
  );
  assert.ok(
    (await admin.auth().getUser(banned.uid)).tokensValidAfterTime,
    "serious standing changes revoke refresh tokens",
  );

  const activeStanding = await activeParent.call("getMyAccountStanding");
  assert.equal(activeStanding.status, "active");
  assert.equal((await messagingRestricted.call("getMyAccountStanding")).status, "messagingRestricted");
  assert.equal((await suspended.call("getMyAccountStanding")).status, "suspended");
  assert.equal((await banned.call("getMyAccountStanding")).status, "banned");

  await rejectsCode(
    messagingRestricted.call("sendFriendRequest", { targetUserId: activeParent.uid }),
    "permission-denied",
    "messaging-restricted stale credentials cannot create social contact",
  );
  await rejectsCode(
    suspended.call("searchPublicUserProfiles", { query: "parent", limit: 20 }),
    "permission-denied",
    "suspended stale credentials cannot search",
  );
  await rejectsCode(
    banned.call("createGameJoinCode", {
      gameType: "trivia_blitz",
      sessionId: "banned-session",
      squadId: "banned-squad",
    }),
    "permission-denied",
    "banned stale credentials cannot host games",
  );
  await rejectsCode(
    anonymous.call("getMyAccountStanding"),
    "permission-denied",
    "anonymous identities cannot use safety callables",
  );

  await rejectsCode(
    setDoc(doc(activeParent.firestore, "accountStanding", activeParent.uid), { status: "active" }),
    "permission-denied",
    "ordinary users cannot alter standing",
  );
  await rejectsCode(
    getDoc(doc(activeParent.firestore, "accountStanding", activeParent.uid)),
    "permission-denied",
    "ordinary users cannot read canonical standing",
  );
  await rejectsCode(
    getDoc(doc(activeParent.firestore, "moderationCases", "private-case")),
    "permission-denied",
    "ordinary users cannot read moderation cases",
  );
  const safeProjection = await getDoc(
    doc(messagingRestricted.firestore, "accountStandingPublic", messagingRestricted.uid),
  );
  assert.equal(safeProjection.exists(), true);
  assert.deepEqual(
    Object.keys(safeProjection.data()).sort(),
    ["effectiveAt", "expiresAt", "publicReasonCode", "revision", "status", "updatedAt"],
    "safe standing projection excludes moderator, case, action, evidence, and child data",
  );
  await rejectsCode(
    getDoc(doc(messagingRestricted.firestore, "accountStandingPublic", activeParent.uid)),
    "permission-denied",
    "safe standing projections are self-only",
  );
  await assert.doesNotReject(
    getDoc(doc(messagingRestricted.firestore, "users", messagingRestricted.uid)),
    "messaging-restricted users retain permitted read access",
  );
  await rejectsCode(
    setDoc(
      doc(messagingRestricted.firestore, "users", messagingRestricted.uid),
      { firstName: "Changed" },
      { merge: true },
    ),
    "permission-denied",
    "messaging-restricted users cannot bypass profile/social mutation rules",
  );
  await rejectsCode(
    getDoc(doc(suspended.firestore, "users", suspended.uid)),
    "permission-denied",
    "suspended users cannot read ordinary private app data",
  );
  await rejectsCode(
    getDoc(doc(banned.firestore, "users", banned.uid)),
    "permission-denied",
    "banned users cannot read ordinary private app data",
  );

  await seedVoiceReservation(activeCoach, "voice-active", "announcement-active");
  const bytes = new Uint8Array([1, 2, 3, 4]);
  await uploadBytes(
    storageRef(activeCoach.storage, "teamVoiceMemos/team-standing/announcements/announcement-active/voice-active/memo.m4a"),
    bytes,
    { contentType: "audio/mp4" },
  );
  await rejectsCode(
    uploadBytes(
      storageRef(messagingRestricted.storage, "teamVoiceMemos/team-standing/announcements/announcement-restricted/voice-restricted/memo.m4a"),
      bytes,
      { contentType: "audio/mp4" },
    ),
    "storage/unauthorized",
    "messaging restriction prevents direct Storage upload",
  );

  await admin.database().ref("gameSessions/standing-session").set({
    hostUserId: activeCoach.uid,
    players: {
      [activeCoach.uid]: { displayName: "Coach" },
      [suspended.uid]: { displayName: "Suspended" },
    },
    status: "lobby",
    expiresAt: Date.now() + 60_000,
  });
  assert.equal(
    (await getDatabaseValue(databaseRef(activeCoach.database, "gameSessions/standing-session"))).exists(),
    true,
  );
  assert.equal(
    (await admin.database().ref(`accountStanding/${suspended.uid}`).get()).val()?.status,
    "suspended",
    "the standing trigger mirrors the effective suspension to RTDB",
  );
  await assertAuthenticatedDatabaseReadDenied(
    suspended,
    "gameSessions/standing-session",
    "suspended stale credentials cannot read a previously joined RTDB game",
  );

  await adminDb.collection("moderationCases").doc("appeal-case").set({
    caseId: "appeal-case",
    reportedUserId: messagingRestricted.uid,
    status: "actioned",
    appealState: "none",
    updatedAt: admin.firestore.Timestamp.now(),
  });
  await setStanding(messagingRestricted, {
    status: "active",
    messagingRestricted: true,
    caseId: "appeal-case",
    revision: 2,
  });
  const explanation = "Please review this restriction because I believe relevant context was missed.";
  const appeal = await messagingRestricted.call("submitMyModerationAppeal", {
    explanation,
    revision: 2,
  });
  assert.equal(appeal.appealStatus, "submitted");
  const duplicateAppeal = await messagingRestricted.call("submitMyModerationAppeal", {
    explanation,
    revision: 2,
  });
  assert.equal(duplicateAppeal.alreadySubmitted, true);

  await adminDb.collection("userBlocks").doc(activeParent.uid)
    .collection("blockedUsers").doc(blocked.uid).set({
      blockerUserId: activeParent.uid,
      blockedUserId: blocked.uid,
      status: "active",
      createdAt: admin.firestore.Timestamp.now(),
    });
  await rejectsCode(
    blocked.call("sendFriendRequest", { targetUserId: activeParent.uid }),
    "permission-denied",
    "blocking remains bidirectional for friend requests",
  );

  await banned.call("blockFriendChatUser", { blockedUserId: activeStaff.uid });
  assert.equal(
    (await adminDb.collection("userBlocks").doc(banned.uid)
      .collection("blockedUsers").doc(activeStaff.uid).get()).exists,
    true,
    "blocking remains available through a stale banned session",
  );

  const safetyConversation = adminDb.collection("friendConversations").doc("standing-safety-report");
  await Promise.all([
    safetyConversation.set({
      conversationId: safetyConversation.id,
      conversationType: "group",
      status: "active",
      activeParticipantIds: [suspended.uid, blocked.uid],
    }),
    safetyConversation.collection("members").doc(suspended.uid).set({
      userId: suspended.uid,
      status: "active",
    }),
    safetyConversation.collection("members").doc(blocked.uid).set({
      userId: blocked.uid,
      status: "active",
    }),
  ]);
  const safetyReport = await suspended.call("reportFriendChatUser", {
    conversationId: safetyConversation.id,
    reportedUserId: blocked.uid,
  });
  assert.equal(safetyReport.reported, true, "reporting remains available while suspended");
  assert.equal(
    (await adminDb.collection("chatModerationReports").doc(safetyReport.reportId).get()).data()?.reporterUserId,
    suspended.uid,
  );

  await setStanding(suspended, {
    status: "suspended",
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1_000),
    revision: 2,
  });
  assert.equal(
    (await suspended.call("getMyAccountStanding")).status,
    "active",
    "an expired temporary suspension restores active standing",
  );
  await setStanding(suspended, { status: "active", revision: 3 });
  assert.equal((await suspended.call("getMyAccountStanding")).status, "active");
  await signOut(suspended.auth);
  await signInWithEmailAndPassword(suspended.auth, suspended.email, "ValidPass123!");
  await assert.doesNotReject(
    getDoc(doc(suspended.firestore, "users", suspended.uid)),
    "authorized restoration plus reauthentication restores ordinary Rules access",
  );
  assert.equal(
    (await getDatabaseValue(databaseRef(suspended.database, "gameSessions/standing-session"))).exists(),
    true,
    "authorized restoration plus reauthentication restores RTDB participation reads",
  );

  for (const client of [activeCoach, activeStaff, moderator, moderationAdmin]) {
    assert.equal((await client.call("getMyAccountStanding")).status, "active");
  }

  console.log("Account-standing callable, stale-session, moderator identity, restoration, appeal, block/report safety, artifact cancellation, Firestore, RTDB, Storage, and anonymous enforcement emulator tests passed.");
}

run()
  .then(async () => {
    await admin.app().delete();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error?.stack ?? error);
    await admin.app().delete().catch(() => undefined);
    process.exit(1);
  });
