#!/usr/bin/env node
/*
 * Dry-run by default. Build Functions first so this script reuses the exact
 * canonical identity implementation used by the callables.
 *
 * node scripts/migrate-squads.cjs --project sideline-squad
 * node scripts/migrate-squads.cjs --project sideline-squad --apply
 */
const path = require("node:path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));
const { geohashForLocation } = require("geofire-common");

const corePath = path.join(process.cwd(), "functions", "lib", "squadCore.js");
let core;
try {
  core = require(corePath);
} catch {
  console.error("Build Functions first: npm --prefix functions run build");
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const projectIndex = process.argv.indexOf("--project");
const projectId = projectIndex >= 0 ? process.argv[projectIndex + 1] : process.env.GCLOUD_PROJECT;
if (!projectId) {
  console.error("Pass --project <firebase-project-id>.");
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function pointFrom(data) {
  const value = data.venueLocation ?? data.coordinates;
  const latitude = value?.latitude ?? value?._latitude;
  const longitude = value?.longitude ?? value?._longitude;
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

async function run() {
  const squadSnapshot = await db.collection("squads").get();
  const userSnapshot = await db.collection("users").get();
  const usersWithLegacyLocation = userSnapshot.docs.filter((document) => {
    const data = document.data();
    return "location" in data || "geohash" in data || "lastLocationUpdate" in data;
  });
  const candidates = [];
  const skipped = [];
  for (const document of squadSnapshot.docs) {
    const data = document.data();
    const venueName = String(data.venueName ?? data.name ?? "").trim();
    const point = pointFrom(data);
    const sportId = core.normalizeSportId(data.sportId ?? data.sportDisplayName ?? data.sport);
    if (!venueName || !point || !sportId) {
      skipped.push({ squadId: document.id, reason: !venueName ? "missing venue" : !point ? "missing coordinates" : "unknown sport" });
      continue;
    }
    const venueId = core.validateVenueId(data.venueId)
      ? data.venueId
      : core.canonicalVenueId(venueName, point.latitude, point.longitude);
    const venueSportKey = core.venueSportKeyFor(venueId, sportId);
    candidates.push({ document, data, venueName, point, sportId, venueId, venueSportKey });
  }

  const byKey = new Map();
  for (const candidate of candidates) {
    const group = byKey.get(candidate.venueSportKey) ?? [];
    group.push(candidate);
    byKey.set(candidate.venueSportKey, group);
  }
  const duplicateGroups = [...byKey.entries()].filter(([, group]) => group.length > 1);
  const duplicateIds = new Set(duplicateGroups.flatMap(([, group]) => group.map((item) => item.document.id)));
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    scannedSquads: squadSnapshot.size,
    migratableSquads: candidates.length - duplicateIds.size,
    skipped,
    duplicateCandidates: duplicateGroups.map(([venueSportKey, group]) => ({
      venueSportKey,
      squadIds: group.map((item) => item.document.id),
    })),
    usersWithLegacyLocation: usersWithLegacyLocation.length,
  }, null, 2));

  if (!apply) return;
  if (duplicateGroups.length > 0) {
    console.log("Duplicate candidates were skipped. Review each group manually; this script never merges or deletes Squads.");
  }

  let batch = db.batch();
  let writes = 0;
  let migrated = 0;
  for (const candidate of candidates) {
    if (duplicateIds.has(candidate.document.id)) continue;
    batch.set(candidate.document.ref, {
      squadId: candidate.document.id,
      venueId: candidate.venueId,
      venueName: candidate.venueName,
      normalizedVenueName: core.normalizeVenueName(candidate.venueName),
      sportId: candidate.sportId,
      sportDisplayName: core.getSportDisplayName(candidate.sportId),
      venueSportKey: candidate.venueSportKey,
      venueLocation: new admin.firestore.GeoPoint(candidate.point.latitude, candidate.point.longitude),
      venueGeohash: candidate.data.venueGeohash || geohashForLocation([candidate.point.latitude, candidate.point.longitude]),
      memberCount: Array.isArray(candidate.data.memberIds) ? new Set(candidate.data.memberIds).size : Number(candidate.data.memberCount ?? 0),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    writes += 1;
    migrated += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes > 0) await batch.commit();

  const membershipSnapshot = await db.collection("squadMemberships").get();
  batch = db.batch();
  writes = 0;
  let migratedMemberships = 0;
  for (const document of membershipSnapshot.docs) {
    const data = document.data();
    if (typeof data.userId !== "string" || typeof data.squadId !== "string") continue;
    const membershipStatus = data.membershipStatus ?? (data.isActive === false ? "left" : "active");
    const lastSeenAt = data.lastSeenAt ?? data.lastActiveAt ?? data.updatedAt ?? data.joinedAt ?? null;
    batch.set(document.ref, {
      membershipStatus,
      presenceStatus: membershipStatus === "active" ? "away" : "away",
      lastSeenAt,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    writes += 1;
    migratedMemberships += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes > 0) await batch.commit();

  // The retired client location flow wrote one current-location snapshot to
  // private user documents. Remove those stale fields during the explicit
  // migration; venue coordinates remain on Squad documents.
  batch = db.batch();
  writes = 0;
  for (const document of usersWithLegacyLocation) {
    batch.set(document.ref, {
      location: admin.firestore.FieldValue.delete(),
      geohash: admin.firestore.FieldValue.delete(),
      lastLocationUpdate: admin.firestore.FieldValue.delete(),
    }, { merge: true });
    writes += 1;
    if (writes === 400) {
      await batch.commit();
      batch = db.batch();
      writes = 0;
    }
  }
  if (writes > 0) await batch.commit();
  console.log(JSON.stringify({
    migratedSquads: migrated,
    migratedMemberships,
    removedLegacyUserLocations: usersWithLegacyLocation.length,
  }, null, 2));
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exit(1);
});
