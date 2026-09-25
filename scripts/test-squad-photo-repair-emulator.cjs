// Local emulator-only acceptance for the six proposed Squad/photo endpoints.
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const projectId = "demo-squad-photo-repair";
assert.equal(process.env.GCLOUD_PROJECT, projectId);
for (const [key, value] of Object.entries({
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
  FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  FIREBASE_STORAGE_EMULATOR_HOST: "127.0.0.1:9199",
})) assert.equal(process.env[key], value, "Refuse nonlocal or missing emulator: " + key);

const admin = require("../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const { getAuth, connectAuthEmulator, createUserWithEmailAndPassword } = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { getStorage, connectStorageEmulator, ref, uploadBytes } = require("firebase/storage");
const { getFirestore, connectFirestoreEmulator, doc, getDoc } = require("firebase/firestore");
admin.initializeApp({ projectId, storageBucket: projectId + ".appspot.com" });
const db = admin.firestore();
const code = (expected) => (error) => String(error?.code).includes(expected);
async function client(label) {
  const app = initializeApp({ apiKey: "demo-key", projectId }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const { user } = await createUserWithEmailAndPassword(auth, label + "@example.test", "LocalOnlyPass123!");
  const functions = getFunctions(app, "us-central1");
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const storage = getStorage(app, "gs://" + projectId + ".appspot.com");
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  const firestore = getFirestore(app);
  connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
  return { uid: user.uid, storage, firestore, call: async (name, data) => (await httpsCallable(functions, name)(data)).data };
}
function jpeg(width, height) {
  return Uint8Array.from([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,
    1,17,0,2,17,0,3,17,0,255,218,0,12,3,1,0,2,17,3,17,0,63,0,0,255,217]);
}
async function run() {
  const [a,b,outsider] = await Promise.all(["repair-a","repair-b","repair-outsider"].map(client));
  for (const [person,friends,name] of [[a,[b.uid],"Alex Example"],[b,[a.uid],"Blair Example"],[outsider,[],"Casey Example"]]) {
    await db.collection("users").doc(person.uid).set({displayName:name,friendIds:friends,squadIds:[]});
  }
  const input = { venueName:"Local Repair Field", latitude:35.1, longitude:-80.9, sportId:"other" };
  const created = await a.call("findOrCreateVenueSportSquad", input);
  assert.equal(created.status,"created");
  const same = await a.call("findOrCreateVenueSportSquad", input);
  assert.equal(same.status,"existing");
  assert.equal(same.squadId,created.squadId);
  assert.equal((await a.call("joinVenueSportSquad",{squadId:created.squadId})).status,"joined");
  assert.equal((await a.call("joinVenueSportSquad",{squadId:created.squadId})).status,"existing");
  const membership = (await db.collection("squadMemberships").doc(created.squadId+"__"+a.uid).get()).data();
  assert.equal(membership.membershipStatus,"active");
  assert.equal(membership.squadRole,"admin");
  const userProfile = (await getDoc(doc(a.firestore,"users",a.uid))).data();
  assert.ok(userProfile.squadIds.includes(created.squadId));
  assert.equal((await getDoc(doc(a.firestore,"squads",created.squadId))).exists(),true);
  await assert.rejects(()=>a.call("findOrCreateVenueSportSquad",{...input,sportId:"invalid"}),code("invalid-argument"));
  console.log("PASS: Squad create/dedupe/join/creator role and client-visible membership.");

  const conversation = await a.call("createOrOpenDirectConversation",{friendUserId:b.uid});
  const full = jpeg(1440,1080), thumb = jpeg(480,360);
  const photo = {conversationId:conversation.conversationId,clientMessageId:"repair_photo_0001",caption:"Synthetic local photo",
    image:{mediaProfileVersion:2,sourceMimeType:"image/jpeg",sourceSizeBytes:4096,
      main:{mimeType:"image/jpeg",width:1440,height:1080,sizeBytes:full.length},
      thumbnail:{mimeType:"image/jpeg",width:480,height:360,sizeBytes:thumb.length}}};
  await assert.rejects(()=>outsider.call("createFriendChatImageUpload",photo),code("permission-denied"));
  const reservation = await a.call("createFriendChatImageUpload",photo);
  assert.equal((await a.call("createFriendChatImageUpload",photo)).reservationId,reservation.reservationId);
  await assert.rejects(()=>uploadBytes(ref(b.storage,reservation.fullPath),full,{contentType:"image/jpeg"}));
  await uploadBytes(ref(a.storage,reservation.fullPath),full,{contentType:"image/jpeg"});
  await uploadBytes(ref(a.storage,reservation.thumbnailPath),thumb,{contentType:"image/jpeg"});
  const finalized = await a.call("finalizeFriendChatImageMessage",{reservationId:reservation.reservationId});
  assert.equal(finalized.status,"sent");
  assert.equal((await a.call("finalizeFriendChatImageMessage",{reservationId:reservation.reservationId})).status,"alreadyFinalized");
  const grant = await b.call("getFriendChatMediaDownloadUrl",{messageId:finalized.messageId,storagePath:reservation.fullPath});
  assert.equal(new URL(grant.url).hostname,"127.0.0.1");
  assert.equal((await fetch(grant.url)).status,200);
  await assert.rejects(()=>outsider.call("getFriendChatMediaDownloadUrl",{messageId:finalized.messageId,storagePath:reservation.fullPath}),code("permission-denied"));
  console.log("PASS: Direct-chat v2 photo reserve/upload/finalize/read; idempotency and unauthorized denial.");

  // The SDK's emulator download shortcut bypasses the production stream route.
  // Seed a synthetic local grant to exercise that actual exported HTTP handler.
  const token = "a".repeat(64);
  await db.collection("friendChatMediaPlaybackGrants").doc(createHash("sha256").update(token).digest("hex")).set({
    conversationId:conversation.conversationId,messageId:finalized.messageId,storagePath:reservation.fullPath,
    userId:b.uid,expiresAt:admin.firestore.Timestamp.fromMillis(Date.now()+60000)});
  const stream = "http://127.0.0.1:5001/"+projectId+"/us-central1/streamFriendChatMedia?grant="+token;
  const response = await fetch(stream);
  assert.equal(response.status,200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),full);
  assert.match(response.headers.get("cache-control"),/no-store/);
  await db.collection("userBlocks").doc(b.uid).collection("blockedUsers").doc(a.uid).set({status:"active"});
  assert.equal((await fetch(stream)).status,404);
  await assert.rejects(()=>b.call("getFriendChatMediaDownloadUrl",{messageId:finalized.messageId,storagePath:reservation.fullPath}),code("permission-denied"));
  console.log("PASS: Real HTTP media stream and access revoked after block.");
}
run().then(()=>process.exit(0)).catch((error)=>{console.error(error);process.exit(1);});
