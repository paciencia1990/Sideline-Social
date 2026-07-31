#!/usr/bin/env node
/*
 * Dry-run by default. Build Functions first so this script reuses the same
 * lifecycle helpers as the production callables.
 *
 * npm --prefix functions run build
 * node scripts/reconcile-archived-team-indexes.cjs --project sideline-squad
 * node scripts/reconcile-archived-team-indexes.cjs --project sideline-squad --team <teamId>
 * node scripts/reconcile-archived-team-indexes.cjs --project sideline-squad --apply
 */
const path = require("node:path");
const admin = require(path.join(process.cwd(), "functions", "node_modules", "firebase-admin"));

const corePath = path.join(process.cwd(), "functions", "lib", "teamMembershipCore.js");
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
const teamIndex = process.argv.indexOf("--team");
const projectId = projectIndex >= 0 ? process.argv[projectIndex + 1] : process.env.GCLOUD_PROJECT;
const requestedTeamId = teamIndex >= 0 ? process.argv[teamIndex + 1] : null;
if (!projectId) {
  console.error("Pass --project <firebase-project-id>.");
  process.exit(1);
}

admin.initializeApp({ projectId });
const db = admin.firestore();

function readStringArray(value) {
  return Array.isArray(value) ? Array.from(new Set(value.filter((item) => typeof item === "string" && item.trim()))) : [];
}

function without(values, teamId) {
  return readStringArray(values).filter((value) => value !== teamId);
}

function withValue(values, teamId) {
  return Array.from(new Set([...readStringArray(values), teamId]));
}

function arraysEqual(first, second) {
  const left = readStringArray(first).sort();
  const right = readStringArray(second).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isTeamActive(data) {
  return data && (data.status === undefined || data.status === "active");
}

function expectedUserIndexes(teamId, team, member, user) {
  const expected = {
    activeTeamId: user.activeTeamId,
    archivedCoachTeamIds: readStringArray(user.archivedCoachTeamIds),
    archivedParentTeamIds: readStringArray(user.archivedParentTeamIds),
    coachTeamIds: readStringArray(user.coachTeamIds),
    parentTeamIds: readStringArray(user.parentTeamIds),
  };
  const teamActive = isTeamActive(team);
  const parentRole = core.hasParentRole(member);
  const coachRole = core.shouldIndexCoachMembership(member);
  const parentRestorable = core.shouldRestoreArchivedParentMembership(member);
  const parentRemoved = core.parentRemovedArchivedTeam(member);

  if (teamActive) {
    expected.archivedParentTeamIds = without(expected.archivedParentTeamIds, teamId);
    expected.archivedCoachTeamIds = without(expected.archivedCoachTeamIds, teamId);
    if (parentRestorable) expected.parentTeamIds = withValue(expected.parentTeamIds, teamId);
    if (!parentRestorable || parentRemoved) expected.parentTeamIds = without(expected.parentTeamIds, teamId);
    if (coachRole) expected.coachTeamIds = withValue(expected.coachTeamIds, teamId);
  } else {
    if (parentRole && member.status === "active" && !parentRemoved) {
      expected.archivedParentTeamIds = withValue(expected.archivedParentTeamIds, teamId);
    } else {
      expected.archivedParentTeamIds = without(expected.archivedParentTeamIds, teamId);
    }
    expected.parentTeamIds = without(expected.parentTeamIds, teamId);
    if (coachRole) expected.archivedCoachTeamIds = withValue(expected.archivedCoachTeamIds, teamId);
    expected.coachTeamIds = without(expected.coachTeamIds, teamId);
    if (expected.activeTeamId === teamId) expected.activeTeamId = null;
  }

  return expected;
}

function diffUserIndexes(teamId, team, member, user) {
  const expected = expectedUserIndexes(teamId, team, member, user);
  const actual = {
    activeTeamId: user.activeTeamId ?? null,
    archivedCoachTeamIds: readStringArray(user.archivedCoachTeamIds),
    archivedParentTeamIds: readStringArray(user.archivedParentTeamIds),
    coachTeamIds: readStringArray(user.coachTeamIds),
    parentTeamIds: readStringArray(user.parentTeamIds),
  };
  const changed = ["archivedCoachTeamIds", "archivedParentTeamIds", "coachTeamIds", "parentTeamIds"]
    .some((field) => !arraysEqual(actual[field], expected[field])) ||
    (actual.activeTeamId ?? null) !== (expected.activeTeamId ?? null);
  return changed ? { actual, expected } : null;
}

async function loadTeams() {
  if (requestedTeamId) {
    const document = await db.collection("teams").doc(requestedTeamId).get();
    return document.exists ? [document] : [];
  }
  return (await db.collection("teams").get()).docs;
}

async function run() {
  const teamDocuments = await loadTeams();
  const report = {
    mode: apply ? "apply" : "dry-run",
    projectId,
    requestedTeamId,
    scannedTeams: 0,
    scannedMemberships: 0,
    staleUserIndexes: 0,
    missingUsers: 0,
    archivedTeamsWithInviteCodes: [],
    fixes: [],
  };

  let batch = db.batch();
  let writes = 0;

  for (const teamDocument of teamDocuments) {
    const team = teamDocument.data();
    const teamId = teamDocument.id;
    report.scannedTeams += 1;
    if (!isTeamActive(team) && typeof team.inviteCode === "string" && team.inviteCode.trim()) {
      report.archivedTeamsWithInviteCodes.push(teamId);
    }

    const memberSnapshot = await teamDocument.ref.collection("members").get();
    for (const memberDocument of memberSnapshot.docs) {
      report.scannedMemberships += 1;
      const userRef = db.collection("users").doc(memberDocument.id);
      const userSnapshot = await userRef.get();
      if (!userSnapshot.exists) {
        report.missingUsers += 1;
        continue;
      }
      const diff = diffUserIndexes(teamId, team, memberDocument.data(), userSnapshot.data() ?? {});
      if (!diff) continue;
      report.staleUserIndexes += 1;
      report.fixes.push({
        teamId,
        userId: memberDocument.id,
        actual: diff.actual,
        expected: diff.expected,
      });
      if (!apply) continue;
      const update = {
        archivedCoachTeamIds: diff.expected.archivedCoachTeamIds,
        archivedParentTeamIds: diff.expected.archivedParentTeamIds,
        coachTeamIds: diff.expected.coachTeamIds,
        parentTeamIds: diff.expected.parentTeamIds,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (diff.expected.activeTeamId === null) {
        update.activeTeamId = admin.firestore.FieldValue.delete();
      } else if (typeof diff.expected.activeTeamId === "string") {
        update.activeTeamId = diff.expected.activeTeamId;
      }
      batch.set(userRef, update, { merge: true });
      writes += 1;
      if (writes === 400) {
        await batch.commit();
        batch = db.batch();
        writes = 0;
      }
    }
  }

  if (apply && writes > 0) await batch.commit();
  console.log(JSON.stringify(report, null, 2));
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
