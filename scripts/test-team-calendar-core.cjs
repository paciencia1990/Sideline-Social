const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { brotliCompressSync, deflateSync, gzipSync } = require("node:zlib");
const ts = require("typescript");

function load(file, overrides = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const loaded = { exports: {} };
  const localRequire = (request) => Object.prototype.hasOwnProperty.call(overrides, request) ? overrides[request] : require(request);
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const csv = load("utils/teamScheduleCore.ts");
const calendar = load("functions/src/teamCalendarCore.ts");
const fetcher = load("functions/src/teamCalendarFetch.ts", { "./teamCalendarCore": calendar });
const fixture = (...segments) => fs.readFileSync(path.join(process.cwd(), "scripts", "fixtures", ...segments), "utf8");
const reason = (error) => error instanceof Error ? error.message : "";

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

const parsed = calendar.parseTeamCalendarIcs(fixture("team-calendar-synthetic.ics"));
assert.equal(parsed.events.length, 6, "recurrence exception, all-day event, and cancellation remain stable");
assert.equal(parsed.events.find((event) => event.title === "Rescheduled Practice").sequence, 2);
assert.equal(parsed.events.find((event) => event.title === "Team Meeting").isAllDay, true);
assert.equal(parsed.events.find((event) => event.title === "Cancelled Match").status, "cancelled");
assert.equal(parsed.events.some((event) => /attendee|organizer/iu.test(JSON.stringify(event))), false);

const unsupported = calendar.parseTeamCalendarIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:monthly\r\nDTSTART;TZID=America/New_York:20270115T100000\r\nDTEND;TZID=America/New_York:20270115T110000\r\nRRULE:FREQ=MONTHLY;COUNT=3\r\nSUMMARY:Monthly\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
assert.equal(unsupported.events.length, 0, "unsupported recurrence is not silently reduced to one event");
assert.equal(unsupported.rejectedCount, 1);
assert.deepEqual(unsupported.warnings, ["ics_recurrence_unsupported"]);
const invalidZone = calendar.parseTeamCalendarIcs("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:zone\r\nDTSTART;TZID=Not/AZone:20270115T100000\r\nDTEND;TZID=Not/AZone:20270115T110000\r\nSUMMARY:Bad zone\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
assert.equal(invalidZone.events.length, 0);
assert.ok(invalidZone.warnings.includes("ics_invalid_timezone"));

const webcal = calendar.normalizeCalendarFeedUrl("webcal://calendar.example.com/team.ics?token=redacted");
assert.equal(webcal.url.protocol, "https:");
assert.equal(webcal.hostname, "calendar.example.com");
assert.equal(webcal.fingerprint.length, 64);
for (const value of ["http://example.com/a.ics", "https://user:pass@example.com/a.ics", "https://example.com:8443/a.ics", "https://example.com/a.ics#secret"]) assert.throws(() => calendar.normalizeCalendarFeedUrl(value));
for (const hostname of ["localhost", "metadata.google.internal", "calendar.local", "team.home.arpa", "example.invalid"]) assert.equal(calendar.isBlockedCalendarHostname(hostname), true, hostname);
for (const hostname of ["calendar.google.com", "outlook.office365.com"]) assert.equal(calendar.isBlockedCalendarHostname(hostname), false, hostname);
for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "192.168.1.2", "::1", "fc00::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:10.2.3.4", "2001:db8::1"]) assert.equal(calendar.isBlockedCalendarAddress(address), true, address);
for (const address of ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888"]) assert.equal(calendar.isBlockedCalendarAddress(address), false, address);

const icsBody = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
for (const [encoding, payload] of [["identity", Buffer.from(icsBody)], ["gzip", gzipSync(icsBody)], ["deflate", deflateSync(icsBody)], ["br", brotliCompressSync(icsBody)]]) {
  assert.equal(fetcher.decodeCalendarPayload(payload, encoding), icsBody, encoding);
}
assert.throws(() => fetcher.decodeCalendarPayload(gzipSync(Buffer.alloc(calendar.MAX_ICS_BYTES + 1, 65)), "gzip"), (error) => reason(error) === "feed_response_too_large");
assert.throws(() => fetcher.decodeCalendarPayload(Buffer.from("bad"), "gzip"), (error) => reason(error) === "feed_content_encoding_invalid");

async function fetchTests() {
  const requestLog = [];
  const dependencies = {
    resolve: async (hostname) => [{ address: hostname === "calendar.google.com" ? "8.8.8.8" : "1.1.1.1", family: 4 }],
    request: async (url, address, family, conditional) => {
      requestLog.push({ url: url.href, address, family, conditional });
      return { status: 200, body: icsBody, contentType: "text/calendar", etag: "v1", lastModified: null, redirect: null };
    },
  };
  const direct = await fetcher.fetchPublicCalendar(new URL("https://calendar.google.com/team.ics?private=redacted"), {}, dependencies);
  assert.equal(direct.body, icsBody);
  assert.equal(requestLog[0].address, "8.8.8.8", "request is pinned to the validated address");

  await assert.rejects(() => fetcher.fetchPublicCalendar(new URL("https://calendar.example.com/team.ics"), {}, { ...dependencies, resolve: async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.2", family: 4 }] }), (error) => reason(error) === "feed_address_blocked");

  const redirects = [];
  await fetcher.fetchPublicCalendar(new URL("https://calendar.google.com/redirect"), { etag: "private-etag", lastModified: "yesterday" }, {
    resolve: dependencies.resolve,
    request: async (url, _address, _family, conditional) => {
      redirects.push({ host: url.hostname, conditional });
      if (url.hostname === "calendar.google.com") return { status: 302, body: "", contentType: "", etag: null, lastModified: null, redirect: "https://outlook.office365.com/calendar.ics" };
      return { status: 200, body: icsBody, contentType: "text/calendar", etag: null, lastModified: null, redirect: null };
    },
  });
  assert.deepEqual(redirects[0].conditional, { etag: "private-etag", lastModified: "yesterday" });
  assert.deepEqual(redirects[1].conditional, {}, "conditional source metadata is not forwarded across origins");

  await assert.rejects(() => fetcher.fetchPublicCalendar(new URL("https://calendar.google.com/redirect"), {}, {
    resolve: dependencies.resolve,
    request: async () => ({ status: 302, body: "", contentType: "", etag: null, lastModified: null, redirect: "https://127.0.0.1/calendar.ics" }),
  }), (error) => reason(error) === "feed_address_blocked");
  await assert.rejects(() => fetcher.fetchPublicCalendar(new URL("https://calendar.google.com/team"), {}, {
    resolve: dependencies.resolve,
    request: async () => ({ status: 200, body: "<html>share page</html>", contentType: "text/html", etag: null, lastModified: null, redirect: null }),
  }), (error) => reason(error) === "feed_content_type_invalid");
  await assert.rejects(() => fetcher.fetchPublicCalendar(new URL("https://calendar.google.com/team"), {}, {
    resolve: dependencies.resolve,
    request: async () => { const error = new Error("socket details must not escape"); error.code = "ETIMEDOUT"; throw error; },
  }), (error) => reason(error) === "feed_timeout");
}

const body = calendar.serializeTeamScheduleIcs({ calendarName: "Synthetic Team", domain: "calendar.example.com", events: parsed.events.map((event, index) => ({ id: `event-${index}`, title: event.title, startAtMillis: event.startAtMillis, endAtMillis: event.endAtMillis, timezone: event.timezone, isAllDay: event.isAllDay, location: event.location, notes: null, status: event.status, revision: event.sequence })), });
assert.match(body, /BEGIN:VCALENDAR\r\n/);
assert.match(body, /UID:event-0@calendar\.example\.com/);
assert.match(body, /STATUS:CANCELLED/);
assert.doesNotMatch(body, /ATTENDEE|ORGANIZER|mailto:/iu);

const source = fs.readFileSync(path.join(process.cwd(), "functions", "src", "teamCalendar.ts"), "utf8");
const fetchSource = fs.readFileSync(path.join(process.cwd(), "functions", "src", "teamCalendarFetch.ts"), "utf8");
for (const boundary of ["TEAM_CALENDAR_FEED_ENCRYPTION_KEY", "aes-256-gcm", "automaticSyncFeatureEnabled", "sourceIntegrationId", "resolveAccountStanding", "fetchPublicCalendar"]) assert.ok(source.includes(boundary), boundary);
assert.doesNotMatch(source, /TEAM_CALENDAR_FEED_ALLOWED_HOSTS|assertAllowedHostname/);
for (const boundary of ["lookup:", "servername:", "Accept-Encoding", "maxHeaderSize", "isBlockedCalendarHostname", "isBlockedCalendarAddress"]) assert.ok(fetchSource.includes(boundary), boundary);
assert.doesNotMatch(`${source}\n${fetchSource}`, /console\.(log|debug|warn|error)/);
assert.doesNotMatch(`${source}\n${fetchSource}`, /GameChanger|gamechanger/iu);

fetchTests().then(() => console.log("Team Schedule CSV, provider-neutral iCalendar, SSRF, redirect, compression, and credential-redaction core tests passed."));
