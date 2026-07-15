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
const serverCore = loadTypeScript("functions/src/notificationDismissalCore.ts");
assert.equal(core.getNotificationDestination({ type: "coachAnnouncement", teamId: "team-1", announcementId: "update-1" }), "/teams/team-1/announcements/update-1");
assert.equal(core.getNotificationDestination({ type: "coach_update", teamId: "team-1", announcementId: "update-1" }), "/teams/team-1/announcements/update-1");
assert.equal(core.getNotificationDestination({ type: "coachAnnouncement", teamId: "bad/path", announcementId: "update-1" }), null);
assert.equal(core.getNotificationDestination({ type: "friendRequest" }), "/(tabs)/friends");
assert.equal(core.getNotificationDestination({ type: "friendRequestAccepted" }), "/(tabs)/friends");
assert.equal(core.getNotificationDestination({ type: "unknown" }), null);
assert.equal(core.normalizeNotificationId("friendRequest_request-1"), "friendRequest_request-1");
assert.equal(core.normalizeNotificationId("bad/path"), null);
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
assert.equal(core.isVisibleNotification({ hasDismissedAtField: true, dismissedAt: null, isRead: true }), true);
assert.equal(core.isVisibleNotification({ hasDismissedAtField: true, dismissedAt: new Date() }), false);
assert.equal(core.isVisibleNotification({ isRead: false, readAt: null }), true);
assert.equal(core.isVisibleNotification({ isRead: true, readAt: new Date() }), false);
assert.equal(core.countVisibleNotifications([
  { hasDismissedAtField: true, dismissedAt: null },
  { hasDismissedAtField: true, dismissedAt: new Date() },
  { isRead: false, readAt: null },
  { isRead: true, readAt: new Date() },
]), 2);

const now = Date.now();
const timestamp = (millis) => ({ toMillis: () => millis });
assert.equal(serverCore.isVisibleStoredNotification({ dismissedAt: null, isRead: true }), true);
assert.equal(serverCore.isVisibleStoredNotification({ isRead: true, readAt: timestamp(now) }), false);
assert.equal(serverCore.getNotificationCleanupReason({ dismissedAt: timestamp(now - 31 * 86400000) }, now), "dismissed30d");
assert.equal(serverCore.getNotificationCleanupReason({ isRead: true, readAt: timestamp(now - 31 * 86400000) }, now), "legacyRead30d");
assert.equal(serverCore.getNotificationCleanupReason({ isRead: false, readAt: null, createdAt: timestamp(now - 91 * 86400000) }, now), "unresolved90d");
assert.equal(serverCore.getNotificationCleanupReason({ dismissedAt: null, expiresAt: timestamp(now - 1), createdAt: timestamp(now - 91 * 86400000) }, now), "unresolved90d");

const home = read("app", "(tabs)", "index.tsx");
const inbox = read("app", "notifications.tsx");
const service = read("services", "notificationService.ts");
const coordinator = read("components", "NotificationCoordinator.tsx");
const functionsSource = read("functions", "src", "index.ts");
const dismissalFunctions = read("functions", "src", "userNotificationDismissal.ts");
const announcementDestination = read("app", "teams", "[teamId]", "announcements", "[announcementId].tsx");
const friendsDestination = read("app", "(tabs)", "friends.tsx");
const translations = read("i18n", "index.ts");
const indexes = JSON.parse(read("firestore.indexes.json"));

assert.equal(home.includes("Community Activity"), false);
assert.equal(home.includes('t("home.activity")'), false);
assert.equal(home.includes("subscribeToActivityFeed"), false);
assert.equal(home.includes('router.push("/notifications")'), true);
assert.equal(home.includes("safeUnreadCount > 0"), true);
assert.equal(home.includes("formatUnreadBadgeCount"), true);
assert.equal(inbox.includes("subscribeToNotifications"), true);
assert.equal(inbox.includes("markNotificationRead"), false);
assert.equal(inbox.includes("clearAllNotifications"), true);
assert.equal(inbox.includes("getNotificationOpenTargetFromData"), true);
assert.equal(inbox.includes("setNotifications(items)"), true);
assert.equal(service.includes("orderBy(\"createdAt\", \"desc\"), limit(100)"), true);
assert.equal(service.includes("isVisibleNotification"), true);
assert.equal(service.includes("notification-dismissal-retry-ids-v1"), true);
assert.equal(service.includes("MAX_RETRY_IDS = 50"), true);
assert.equal(service.includes("acknowledgeNotificationOpened"), true);
assert.equal(service.includes("clearUserNotifications"), true);
assert.equal(service.includes("formatFriendRequestSenderName"), true);
assert.equal(service.includes("actorDisplayName ? { ...params, actorName: actorDisplayName } : params"), true);
assert.equal(coordinator.includes("getNotificationOpenTargetFromData"), true);
assert.equal(coordinator.includes("markNotificationRead"), false);
assert.equal(coordinator.includes("retryPendingNotificationAcknowledgements"), true);
assert.equal(announcementDestination.includes("acknowledgeNotificationAfterOpen(notificationId)"), true);
assert.ok(announcementDestination.indexOf("setAnnouncement(nextAnnouncement)") < announcementDestination.indexOf("acknowledgeNotificationAfterOpen(notificationId)"));
assert.equal(friendsDestination.includes("acknowledgeNotificationAfterOpen(notificationId)"), true);
assert.ok(friendsDestination.indexOf("setSuggestedUsers(nextSuggested)") < friendsDestination.indexOf("acknowledgeNotificationAfterOpen(notificationId)"));
assert.equal(dismissalFunctions.includes("functions.region('us-central1')"), true);
assert.equal(dismissalFunctions.includes("acknowledgeNotificationOpened"), true);
assert.equal(dismissalFunctions.includes("clearUserNotifications"), true);
assert.equal(dismissalFunctions.includes("cleanupExpiredUserNotifications"), true);
assert.equal(dismissalFunctions.includes("FieldValue.serverTimestamp()"), true);
for (const fieldPath of ["createdAt", "readAt", "dismissedAt"]) {
  const override = indexes.fieldOverrides.find((item) => item.collectionGroup === "notifications" && item.fieldPath === fieldPath);
  assert.ok(override, `${fieldPath} needs a notification collection-group index.`);
  assert.ok(override.indexes.some((index) => index.queryScope === "COLLECTION_GROUP" && index.order === "ASCENDING"));
}

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
assert.equal(functionsSource.includes("dismissedAt: null"), true);
assert.equal(functionsSource.includes("dismissReason: null"), true);
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
  "allCaughtUp", "clearAll", "clearing", "clearedTitle", "clearedBody", "clearAllError",
  "opened", "unableToUpdate", "dismissalRetry", "bellNoUnread", "bellUnread",
  "coachAnnouncementTitle", "friendRequestTitle", "friendRequestAcceptedTitle",
  "friendRequestFallbackBody",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) || []).length, 2, `${key} needs English and Spanish copy.`);
}
assert.equal(translations.includes("New alerts will appear here."), true);

console.log("Notification visibility, destination acknowledgement, retry, cleanup, privacy, push, and Clear all tests passed.");
