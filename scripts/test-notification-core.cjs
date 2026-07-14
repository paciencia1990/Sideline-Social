const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function read(...segments) {
  return fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");
}

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const core = loadTypeScript("utils/notificationCore.ts");
assert.equal(core.getNotificationDestination({ type: "coachAnnouncement", teamId: "team-1", announcementId: "update-1" }), "/teams/team-1/announcements/update-1");
assert.equal(core.getNotificationDestination({ type: "coach_update", teamId: "team-1", announcementId: "update-1" }), "/teams/team-1/announcements/update-1");
assert.equal(core.getNotificationDestination({ type: "coachAnnouncement", teamId: "bad/path", announcementId: "update-1" }), null);
assert.equal(core.getNotificationDestination({ type: "friendRequest" }), "/(tabs)/friends");
assert.equal(core.getNotificationDestination({ type: "friendRequestAccepted" }), "/(tabs)/friends");
assert.equal(core.getNotificationDestination({ type: "unknown" }), null);
assert.equal(core.formatUnreadBadgeCount(0), "0");
assert.equal(core.formatUnreadBadgeCount(1), "1");
assert.equal(core.formatUnreadBadgeCount(99), "99");
assert.equal(core.formatUnreadBadgeCount(100), "99+");
assert.equal(core.countUnreadNotifications([
  { readAt: null, isRead: false, status: "active" },
  { readAt: new Date(), isRead: true, status: "active" },
  { readAt: null, isRead: false, status: "dismissed" },
  { readAt: null, isRead: false, status: "active", expiresAt: new Date(Date.now() - 1000) },
]), 1);

const home = read("app", "(tabs)", "index.tsx");
const inbox = read("app", "notifications.tsx");
const service = read("services", "notificationService.ts");
const coordinator = read("components", "NotificationCoordinator.tsx");
const functionsSource = read("functions", "src", "index.ts");
const translations = read("i18n", "index.ts");

assert.equal(home.includes("Community Activity"), false);
assert.equal(home.includes('t("home.activity")'), false);
assert.equal(home.includes("subscribeToActivityFeed"), false);
assert.equal(home.includes('router.push("/notifications")'), true);
assert.equal(home.includes("safeUnreadCount > 0"), true);
assert.equal(home.includes("formatUnreadBadgeCount"), true);
assert.equal(inbox.includes("subscribeToNotifications"), true);
assert.equal(inbox.includes("markNotificationRead"), true);
assert.equal(inbox.includes("markAllNotificationsRead"), true);
assert.equal(inbox.includes("getNotificationDestination"), true);
assert.equal(inbox.includes("setNotifications(items)"), true);
assert.equal(service.includes('where("readAt", "==", null), limit(100)'), true);
assert.equal(service.includes("orderBy(\"createdAt\", \"desc\"), limit(100)"), true);
assert.equal(service.includes("formatFriendRequestSenderName"), true);
assert.equal(service.includes("actorDisplayName ? { ...params, actorName: actorDisplayName } : params"), true);
assert.equal(coordinator.includes("getNotificationOpenTargetFromData"), true);
assert.equal(coordinator.includes("markNotificationRead"), true);

const friendCreated = functionsSource.slice(
  functionsSource.indexOf("export const onFriendRequestCreated"),
  functionsSource.indexOf("export const onFriendRequestAccepted"),
);
const actorNameResolver = functionsSource.slice(
  functionsSource.indexOf("async function getPrivateNotificationActorName"),
  functionsSource.indexOf("// ---------------------------------------------------------------------------\n// 1. updateActiveMemberCount"),
);
const friendAccepted = functionsSource.slice(
  functionsSource.indexOf("export const onFriendRequestAccepted"),
  functionsSource.indexOf("export const onSquadMemberJoined"),
);
const teamAnnouncement = functionsSource.slice(
  functionsSource.indexOf("export const notifyParentsOfTeamAnnouncement"),
  functionsSource.indexOf("// Public social profile reads"),
);
for (const source of [friendCreated, friendAccepted, teamAnnouncement]) {
  assert.equal(source.includes("createPersonalNotificationAndPush"), true);
  assert.equal(source.includes("fcmToken"), false);
  assert.equal(source.toLowerCase().includes("email"), false);
  assert.equal(source.toLowerCase().includes("childname"), false);
}
assert.equal(functionsSource.includes("transaction.create(notificationRef"), true);
assert.equal(functionsSource.includes("notificationId: input.eventId"), true);
assert.equal(functionsSource.includes("actorDisplayName: input.actorDisplayName ?? null"), true);
assert.equal(friendCreated.includes("getPrivateNotificationActorName(request.fromUserId, '')"), true);
assert.equal(friendCreated.includes("notifications.types.friendRequestFallbackBody"), true);
assert.equal(friendCreated.includes("`${senderName} wants to connect with you.`"), true);
assert.equal(friendCreated.includes("A Sideline parent wants to connect with you."), true);
assert.equal(friendCreated.includes("actorDisplayName: senderName || undefined"), true);
assert.equal(actorNameResolver.includes("admin.auth().getUser(userId)"), true);
assert.equal(actorNameResolver.includes("formatSuggestedConnectionName(authName)"), true);
assert.equal(actorNameResolver.toLowerCase().includes("email"), false);
assert.equal(teamAnnouncement.includes("memberSnapshot.id === authorUserId"), true);

for (const key of [
  "allCaughtUp", "markAllRead", "bellNoUnread", "bellUnread",
  "coachAnnouncementTitle", "friendRequestTitle", "friendRequestAcceptedTitle",
  "friendRequestFallbackBody",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy.`);
}
assert.equal(translations.includes("New team, friend, Squad, and game updates will appear here."), true);
assert.equal(translations.includes("Las nuevas actualizaciones de equipos, amistades, Squads y juegos aparecerán aquí."), true);

console.log("Notification inbox, routing, unread badge, idempotency, privacy, push integration, and Home cleanup tests passed.");
