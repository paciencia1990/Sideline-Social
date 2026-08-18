const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const read = (...segments) => fs.readFileSync(path.join(process.cwd(), ...segments), "utf8");

function loadTypeScript(relativePath) {
  const output = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", output)(loaded, loaded.exports);
  return loaded.exports;
}

const client = loadTypeScript("utils/teamScheduleCore.ts");
const server = loadTypeScript("functions/src/teamScheduleCore.ts");
const calendar = loadTypeScript("utils/teamScheduleCalendarCore.ts");

const draft = {
  type: "game",
  title: "  Home   Opener ",
  date: "2027-03-14",
  startTime: "10:00",
  endTime: "12:00",
  arrivalTime: "09:30",
  timezone: "America/New_York",
  isAllDay: false,
  opponentName: "River City",
  homeAway: "home",
  venueName: "Community Field",
  field: "Field 2",
  address: "100 Main St",
  status: "scheduled",
  teamScore: null,
  opponentScore: null,
  notes: "Bring both jerseys",
};

assert.deepEqual(client.validateScheduleDraft(draft), {});
assert.equal(client.validateScheduleDraft({ ...draft, endTime: "09:00" }).endTime, "endBeforeStart");
assert.equal(client.validateScheduleDraft({ ...draft, arrivalTime: "10:30" }).arrivalTime, "arrivalAfterStart");
assert.equal(client.validateScheduleDraft({ ...draft, status: "scheduled", teamScore: 2 }).teamScore, "scoreOnlyWhenCompleted");
assert.equal(client.validateScheduleDraft({ ...draft, status: "completed", teamScore: 1000 }).teamScore, "invalidScore");
assert.equal(client.validateScheduleDraft({ ...draft, date: "2027-03-14", startTime: "02:30", arrivalTime: "" }).startTime, "invalidLocalTime");

const beforeDst = client.zonedDateTimeToMillis("2027-03-07", "10:00", "America/New_York");
const afterDst = client.zonedDateTimeToMillis("2027-03-14", "10:00", "America/New_York");
assert.equal(afterDst - beforeDst, (7 * 24 - 1) * 60 * 60 * 1000, "weekly local time survives the DST transition");

const normalized = server.normalizeScheduleInput(draft);
assert.equal(client.buildScheduleFingerprint(draft), server.scheduleFingerprintCanonical(normalized), "client preview and server import fingerprints use the same normalized values");
const allDay = { ...draft, isAllDay: true, startTime: "", endTime: "", arrivalTime: "" };
const normalizedAllDay = server.normalizeScheduleInput(allDay);
assert.equal(normalizedAllDay.endAtMillis - normalizedAllDay.startAtMillis, 23 * 60 * 60 * 1000, "all-day events retain local calendar boundaries across spring DST");
assert.equal(client.buildScheduleFingerprint(allDay), server.scheduleFingerprintCanonical(normalizedAllDay));

assert.deepEqual(
  client.generateWeeklyRecurrenceDates("2027-03-01", [1, 3, 1], "2027-03-10"),
  ["2027-03-01", "2027-03-03", "2027-03-08", "2027-03-10"],
);
assert.equal(client.generateWeeklyRecurrenceDates("2027-01-01", [1, 2, 3, 4, 5], "2028-01-01").length, 0, "unbounded recurrence is rejected");
assert.throws(() => server.generateWeeklyScheduleDates("2027-01-01", [1, 2, 3, 4, 5], "2028-01-01"), /recurrence_limit/);

const events = [
  { id: "past", startAt: new Date("2027-01-02T15:00:00Z"), endAt: new Date("2027-01-02T16:00:00Z"), timezone: "America/New_York" },
  { id: "later", startAt: new Date("2027-03-02T16:00:00Z"), endAt: new Date("2027-03-02T17:00:00Z"), timezone: "America/New_York" },
  { id: "sooner", startAt: new Date("2027-02-01T16:00:00Z"), endAt: new Date("2027-02-01T17:00:00Z"), timezone: "America/New_York" },
];
const split = client.splitScheduleEvents(events, new Date("2027-01-15T00:00:00Z"));
assert.deepEqual(split.upcoming.map((event) => event.id), ["sooner", "later"]);
assert.deepEqual(split.past.map((event) => event.id), ["past"]);
assert.deepEqual(client.groupScheduleEvents(split.upcoming).map((group) => group.monthKey), ["2027-02", "2027-03"]);

const csv = `\uFEFFtype,title,date,start_time,end_time,arrival_time,timezone,all_day,opponent,home_away,venue,field,address,status,team_score,opponent_score,notes\n` +
  `game,"Home, Opener",2027-03-14,10:00,12:00,09:30,America/New_York,false,River City,home,Community Field,Field 2,100 Main St,scheduled,,,"Bring water, jerseys"\n` +
  `practice,Bad time,2027-03-15,19:00,18:00,18:30,America/New_York,false,,,,,,,scheduled,,,`;
const parsed = client.parseTeamScheduleCsv(csv);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].draft.title, "Home, Opener");
assert.equal(parsed[0].draft.notes, "Bring water, jerseys");
assert.equal(parsed[1].draft, null);
assert.ok(parsed[1].errors.includes("endBeforeStart"));
assert.ok(client.parseTeamScheduleCsv("title,date\nPractice,2027-01-01")[0].errors.includes("missingHeaders"));
const row = "practice,Practice,2027-05-01,10:00,11:00,09:45,UTC,false,,,,,scheduled,,,";
const tooManyRows = `${client.TEAM_SCHEDULE_SAMPLE_CSV.split("\n")[0]}\n${Array.from({ length: 201 }, () => row).join("\n")}`;
assert.ok(client.parseTeamScheduleCsv(tooManyRows).at(-1).errors.includes("rowLimit"));

assert.equal(calendar.normalizeTeamScheduleCalendarError(new Error("Permission denied")), "calendar_permission_denied");
assert.equal(calendar.normalizeTeamScheduleCalendarError(new Error("Permission denied; use Settings")), "calendar_permission_permanent");
assert.equal(calendar.shouldOfferCalendarSettings("calendar_permission_permanent"), true);
assert.equal(calendar.shouldOfferCalendarSettings("calendar_permission_denied"), false);
assert.equal(calendar.normalizeTeamScheduleCalendarError(new Error("Calendar unavailable")), "calendar_unavailable");
assert.equal(calendar.normalizeTeamScheduleCalendarError({ code: "calendar_build_required" }), "calendar_build_required");

const fixture = read("constants", "teamSchedulePreview.ts");
assert.match(fixture, /__DEV__ && process\.env\.EXPO_PUBLIC_TEAM_SCHEDULE_FIXTURE === "true"/);
for (const status of ["scheduled", "postponed", "cancelled", "completed"]) assert.ok(fixture.includes(`"${status}"`));
for (const type of ["game", "practice", "teamEvent"]) assert.ok(fixture.includes(`"${type}"`));
assert.match(fixture, /Team photo night", 34/);
assert.doesNotMatch(fixture, /GameChanger|signed media|child name/i);

const parentHub = read("app", "teams", "[teamId]", "index.tsx");
const coachTeam = read("app", "coach", "team.tsx");
const coachHome = read("app", "coach", "index.tsx");
for (const source of [parentHub, coachTeam, coachHome]) assert.match(source, /schedule/);
assert.match(read("app", "teams", "index.tsx"), /pastTeamActions[\s\S]*schedule/);
const scheduleList = read("app", "teams", "[teamId]", "schedule", "index.tsx");
assert.match(scheduleList, /splitScheduleEvents/);
assert.match(scheduleList, /groupScheduleEvents/);
assert.match(scheduleList, /pastExpanded/);
assert.match(scheduleList, /access\?\.canManage === true && access\.teamStatus === "active"/);
const scheduleDetail = read("app", "teams", "[teamId]", "schedule", "[eventId].tsx");
assert.match(scheduleDetail, /schedule\.form\.opponent/);
assert.match(scheduleDetail, /schedule\.form\.homeAway/);
const scheduleForm = read("components", "TeamScheduleEventForm.tsx");
assert.match(scheduleForm, /notificationReviewOpen/);
assert.match(scheduleForm, /schedule\.form\.notifyConfirmTitle/);
const calendarService = read("services", "teamScheduleCalendarService.ts");
assert.match(calendarService, /require\("expo-calendar\/legacy"\)/);
assert.doesNotMatch(calendarService, /getCalendarsAsync|requestCalendarPermissionsAsync|readCalendar/);
const config = read("app.config.js");
assert.match(config, /NSCalendarsWriteOnlyAccessUsageDescription/);
assert.match(config, /Sideline Social adds a Team event to your calendar only when you choose Add to Calendar/);
assert.match(config, /android\.permission\.READ_CALENDAR/);
assert.match(config, /android\.permission\.WRITE_CALENDAR/);
for (const locale of ["en", "es"]) {
  const localeConfig = read("config", "locales", `${locale}.json`);
  assert.match(localeConfig, /NSCalendarsUsageDescription/);
  assert.match(localeConfig, /NSCalendarsWriteOnlyAccessUsageDescription/);
}

const translations = read("i18n", "index.ts");
for (const key of [
  "teamSchedule", "archivedTitle", "importUnauthorized", "calendar_permission_denied",
  "teamScheduleImportTitle", "teamScheduleNewBody", "teamScheduleTimeChangedBody",
  "teamScheduleVenueChangedBody", "teamSchedulePostponedBody", "teamScheduleCancelledBody",
  "teamScheduleUpdatedBody", "notifyConfirmTitle", "notifyConfirmBody", "notifyConfirmAction",
]) {
  assert.equal((translations.match(new RegExp(`${key}:`, "g")) ?? []).length, 2, `${key} requires English and Spanish copy`);
}

const scheduleSources = [
  "functions/src/teamSchedule.ts", "functions/src/teamScheduleCore.ts", "services/teamScheduleService.ts",
  "app/teams/[teamId]/schedule/index.tsx", "app/teams/[teamId]/schedule/import.tsx",
].map((file) => read(file)).join("\n");
assert.doesNotMatch(scheduleSources, /GameChanger|gamechanger/i);

console.log("Team Schedule sorting, time-zone, recurrence, CSV, calendar, navigation, fixture, and localization tests passed.");
