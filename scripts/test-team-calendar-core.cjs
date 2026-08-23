const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function load(file) {
  const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", output)(require, loaded, loaded.exports);
  return loaded.exports;
}

const csv = load("utils/teamScheduleCore.ts");
const calendar = load("functions/src/teamCalendarCore.ts");
const fixture = (...segments) => fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", ...segments), "utf8");

const excel = csv.analyzeTeamScheduleCsv(fixture("team-schedule-excel.csv"));
assert.equal(excel.delimiter, ";");
assert.deepEqual(excel.fileErrors, []);
assert.equal(excel.rows.length, 2);
assert.equal(excel.rows[0].draft.title, "Home, Opener");
assert.equal(excel.rows[0].draft.date, "2027-03-14");
assert.equal(excel.rows[0].draft.startTime, "10:00");
assert.equal(excel.rows[0].draft.notes.replace(/\r\n/g, "\n"), "Bring water;\nand both jerseys");
assert.equal(excel.rows[1].draft.notes, 'Coach said "arrive early"');

const comma = csv.analyzeTeamScheduleCsv('Type,Title,Date,Start Time,End Time,Time Zone,Notes\r\nPractice,"Quoted, title",2027-03-20,17:30,19:00,UTC,"line one\nline two"\r\n');
assert.equal(comma.rows[0].draft.title, "Quoted, title");
assert.equal(comma.rows[0].draft.notes, "line one\nline two");
assert.ok(csv.analyzeTeamScheduleCsv("Title,Event Name,Type,Date,Start Time,End Time,Time Zone\nA,A,Practice,2027-01-01,10:00,11:00,UTC").fileErrors.includes("ambiguousHeaders"));
assert.ok(csv.analyzeTeamScheduleCsv("Title,Date\nA,2027-01-01").fileErrors.includes("missingHeaders"));
assert.ok(csv.analyzeTeamScheduleCsv("\uFFFE\u0000bad").fileErrors.includes("invalidEncoding"));
assert.equal(/\.csv$/iu.test("SCHEDULE.CSV"), true);

const parsed = calendar.parseTeamCalendarIcs(fixture("team-calendar-synthetic.ics"));
assert.equal(parsed.events.length, 6, "game, two generated practices after EXDATE/override, all-day, and cancelled");
assert.equal(parsed.events.find((event) => event.title === "Rescheduled Practice").sequence, 2);
assert.equal(parsed.events.find((event) => event.title === "Team Meeting").isAllDay, true);
assert.equal(parsed.events.find((event) => event.title === "Cancelled Match").status, "cancelled");
assert.equal(parsed.events.some((event) => /attendee|organizer/i.test(JSON.stringify(event))), false);

const webcal = calendar.normalizeCalendarFeedUrl("webcal://calendar.example.invalid/team.ics?token=redacted");
assert.equal(webcal.url.protocol, "https:");
assert.equal(webcal.hostname, "calendar.example.invalid");
assert.equal(webcal.fingerprint.length, 64);
for (const value of ["http://example.invalid/a.ics", "https://user:pass@example.invalid/a.ics", "https://example.invalid:8443/a.ics", "https://example.invalid/a.ics#secret"]) assert.throws(() => calendar.normalizeCalendarFeedUrl(value));
for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "::1", "fc00::1", "ff02::1"]) assert.equal(calendar.isBlockedCalendarAddress(address), true, address);
for (const address of ["8.8.8.8", "2001:4860:4860::8888"]) assert.equal(calendar.isBlockedCalendarAddress(address), false, address);

const body = calendar.serializeTeamScheduleIcs({ calendarName: "Synthetic Team", domain: "calendar.example.invalid", events: parsed.events.map((event, index) => ({ id: `event-${index}`, title: event.title, startAtMillis: event.startAtMillis, endAtMillis: event.endAtMillis, timezone: event.timezone, isAllDay: event.isAllDay, location: event.location, notes: null, status: event.status, revision: event.sequence })), });
assert.match(body, /BEGIN:VCALENDAR\r\n/);
assert.match(body, /UID:event-0@calendar\.example\.invalid/);
assert.match(body, /STATUS:CANCELLED/);
assert.doesNotMatch(body, /ATTENDEE|ORGANIZER|mailto:/i);

const source = fs.readFileSync(path.join(process.cwd(), "functions", "src", "teamCalendar.ts"), "utf8");
for (const boundary of ["TEAM_CALENDAR_FEED_ENCRYPTION_KEY", "aes-256-gcm", "lookup:", "isBlockedCalendarAddress", "TEAM_CALENDAR_FEED_ALLOWED_HOSTS", "automaticSyncFeatureEnabled", "sourceIntegrationId", "resolveAccountStanding"]) assert.ok(source.includes(boundary), boundary);
assert.doesNotMatch(source, /console\.(log|debug|warn|error)/);
assert.doesNotMatch(source, /GameChanger|gamechanger/);

console.log("Team Schedule CSV, provider-neutral iCalendar, SSRF, token-feed, and credential-redaction core tests passed.");
