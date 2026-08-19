const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");
const constants = read("constants", "teamHistoryPagination.ts");
const announcementService = read("services", "teamMessageService.ts");
const parentService = read("services", "parentTeamService.ts");
const privateService = read("services", "teamPrivateMessageService.ts");
const scheduleService = read("services", "teamScheduleService.ts");
const scheduleScreen = read("app", "teams", "[teamId]", "schedule", "index.tsx");
const privateThread = read("components", "PrivateTeamMessageThread.tsx");
const functionsSource = read("functions", "src", "index.ts");
const notificationCore = read("utils", "notificationCore.ts");
const translations = read("i18n", "index.ts");

for (const [key, size] of Object.entries({
  announcements: 20,
  announcementReplies: 30,
  privateMessages: 40,
  upcomingSchedule: 50,
  pastSchedule: 20,
  archivedTeams: 20,
})) {
  assert.match(constants, new RegExp(`${key}: ${size}`));
}

for (const source of [announcementService, parentService, privateService, scheduleService]) {
  assert.match(source, /orderBy\(documentId\(\)/);
  assert.match(source, /startAfter\(/);
  assert.match(source, /limit\(pageSize \+ 1\)/);
}
assert.match(scheduleService, /where\("startAt", ">=", Timestamp\.fromDate\(fromDate\)\)/);
assert.match(scheduleService, /where\("startAt", "<", Timestamp\.fromDate\(beforeDate\)\)/);
assert.match(scheduleScreen, /if \(!expanded && pastEvents\.length === 0\) void loadPast\(\)/);
const initialScheduleEffect = scheduleScreen.slice(scheduleScreen.indexOf("useEffect(() =>"), scheduleScreen.indexOf("const upcomingGroups"));
assert.doesNotMatch(initialScheduleEffect, /getPastTeamSchedulePage\(/);
assert.match(privateService, /where\(documentId\(\), "in", ids\)/);
assert.match(privateThread, /olderAnchorRef/);
assert.match(privateThread, /paginationInFlight\.current/);
assert.match(privateThread, /getPrivateTeamMessage\(conversationId, targetMessageId\)/);
assert.match(functionsSource, /syncTeamAnnouncementSummaries/);
assert.match(functionsSource, /marker\.exists/);
assert.match(functionsSource, /recentUnreadAnnouncements/);
assert.match(functionsSource, /Compatibility only for installed clients/);
assert.match(notificationCore, /messageId=\$\{encodeURIComponent\(data\.messageId\)\}/);
assert.match(translations, /loadOlderAnnouncements/);
assert.match(translations, /Cargar anuncios anteriores/);

function compareNewest(first, second) {
  return second.timestampMillis - first.timestampMillis || second.id.localeCompare(first.id);
}

function page(items, size, cursor = null) {
  const ordered = [...items].sort(compareNewest);
  const start = cursor
    ? ordered.findIndex((item) => item.id === cursor.id && item.timestampMillis === cursor.timestampMillis) + 1
    : 0;
  const visible = ordered.slice(start, start + size);
  return {
    items: visible,
    cursor: visible.length ? visible[visible.length - 1] : null,
    hasMore: ordered.length > start + size,
  };
}

for (const total of [0, 10, 20, 21, 40, 41, 1000]) {
  const items = Array.from({ length: total }, (_, index) => ({ id: `id-${String(index).padStart(4, "0")}`, timestampMillis: 1_000 }));
  const seen = [];
  let cursor = null;
  do {
    const next = page(items, 20, cursor);
    seen.push(...next.items);
    cursor = next.cursor;
    if (!next.hasMore) break;
  } while (cursor);
  assert.equal(seen.length, total);
  assert.equal(new Set(seen.map((item) => item.id)).size, total);
}

const original = Array.from({ length: 100 }, (_, index) => ({ id: `item-${String(index).padStart(3, "0")}`, timestampMillis: 10_000 - Math.floor(index / 3) }));
const newest = page(original, 20);
const withRealtimeArrival = [{ id: "new-realtime", timestampMillis: 20_000 }, ...original];
const older = page(withRealtimeArrival, 20, newest.cursor);
assert.equal(new Set([...newest.items, ...older.items].map((item) => item.id)).size, 40);
assert.equal(older.items.some((item) => item.id === "new-realtime"), false);

const measurements = [10, 100, 1000].map((count) => ({
  count,
  announcementBefore: count * 2 + 1,
  announcementAfter: Math.min(count, 21) + 2,
  announcementListenerBefore: count,
  announcementListenerAfter: Math.min(count, 21),
  privateMessageListenerBefore: count,
  privateMessageListenerAfter: Math.min(count, 41),
  replyListenerBefore: count,
  replyListenerAfter: Math.min(count, 31),
  scheduleListenerBefore: count,
  scheduleListenerAfter: Math.min(count, 51),
  collapsedPastReadsAfter: 0,
}));

assert.deepEqual(measurements.map((item) => item.announcementAfter), [12, 23, 23]);
assert.equal(measurements[2].privateMessageListenerAfter, 41);
assert.equal(measurements[2].collapsedPastReadsAfter, 0);
console.log(JSON.stringify({ status: "passed", measurements }));
