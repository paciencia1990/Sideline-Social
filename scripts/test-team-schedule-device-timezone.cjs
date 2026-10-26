'use strict';
// New display behavior only. No device, SDK, provider, build or live request.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createSourceLoader, root } = require('./coach-ai-test-loader.cjs');
const { harness } = require('./test-coach-ai-billing-availability.cjs');
const load = createSourceLoader();
const display = load('utils/teamScheduleDisplay.ts');
const core = load('utils/teamScheduleCore.ts');
const cases = [];

function actualFunctions(file, names, scope = {}) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(source.parseDiagnostics.length, 0, file);
  const functions = names.map(name => {
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
    assert.ok(declaration, 'missing_actual_function:' + name);
    return declaration.getText(source).replace(/^export\s+/u, '');
  });
  const compiled = ts.transpileModule(functions.join('\n') + '\nmodule.exports = {' + names.join(',') + '};', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('module', ...Object.keys(scope), compiled)(module, ...Object.values(scope));
  return module.exports;
}

const card = actualFunctions('components/TeamScheduleEventCard.tsx', ['formatEventTime', 'shortTimeZone']);
const details = actualFunctions('app/teams/[teamId]/schedule/[eventId].tsx', ['formatEventDate', 'formatTime'], {
  scheduleDisplayTimeZone: display.scheduleDisplayTimeZone,
});
const drafts = actualFunctions('services/teamScheduleService.ts', ['scheduleDraftFromEvent', 'formatPart']);
const event = { id: 'fictional_event', type: 'practice', title: 'Fictional practice',
  startAt: new Date('2027-07-15T14:00:00.000Z'), endAt: new Date('2027-07-15T15:00:00.000Z'),
  arrivalAt: new Date('2027-07-15T13:45:00.000Z'), timezone: 'UTC', isAllDay: false,
  opponentName: null, homeAway: null, venueName: null, field: null, address: null,
  status: 'scheduled', teamScore: null, opponentScore: null, notes: null };
const t = (key, values) => values ? JSON.stringify(values) : key;
async function test(name, fn) { await fn(); cases.push(name); }

async function main() {
  await test('timed_card_and_details_follow_three_different_phone_zones', () => {
    for (const [timezone, start, arrival] of [['America/New_York', '10:00', '9:45'],
      ['America/Los_Angeles', '7:00', '6:45'], ['Asia/Tokyo', '11:00', '10:45']]) {
      const text = card.formatEventTime(event, 'en-US', timezone, t);
      assert.ok(text.includes(start), text);
      assert.ok(details.formatEventDate(event, 'en-US', 'All day', timezone).includes(start));
      assert.ok(details.formatTime(event.arrivalAt, event, 'en-US', timezone).includes(arrival));
      assert.equal(display.scheduleDisplayTimeZone(event, timezone), timezone);
    }
  });
  await test('eastern_daylight_and_standard_offsets_come_from_event_date', () => {
    const summer = JSON.parse(card.formatEventTime(event, 'en-US', 'America/New_York', t));
    const winter = JSON.parse(card.formatEventTime({ ...event, startAt: new Date('2027-01-15T14:00:00Z'),
      endAt: new Date('2027-01-15T15:00:00Z') }, 'en-US', 'America/New_York', t));
    assert.match(summer.start, /10:00/u); assert.equal(summer.timezone, 'EDT');
    assert.match(winter.start, /9:00/u); assert.equal(winter.timezone, 'EST');
  });
  await test('timed_date_groups_and_detail_date_agree_across_local_midnight', () => {
    const midnight = { ...event, startAt: new Date('2027-03-01T01:00:00Z'), endAt: new Date('2027-03-01T02:00:00Z') };
    const ny = core.groupScheduleEvents([midnight], 'America/New_York');
    const tokyo = core.groupScheduleEvents([midnight], 'Asia/Tokyo');
    assert.equal(ny[0].monthKey, '2027-02'); assert.equal(ny[0].days[0].dateKey, '2027-02-28');
    assert.equal(tokyo[0].monthKey, '2027-03'); assert.equal(tokyo[0].days[0].dateKey, '2027-03-01');
    assert.match(details.formatEventDate(midnight, 'en-US', 'All day', 'America/New_York'), /February 28/u);
    assert.match(details.formatEventDate(midnight, 'en-US', 'All day', 'Asia/Tokyo'), /March 1/u);
    assert.equal(core.groupScheduleEvents([midnight])[0].days[0].dateKey, '2027-03-01', 'omitted display zone preserves existing source-zone API');
  });
  await test('all_day_source_dates_do_not_shift_when_phone_zone_changes', () => {
    const allDay = { ...event, isAllDay: true, startAt: new Date('2027-03-01T00:00:00Z'), endAt: new Date('2027-03-02T00:00:00Z') };
    for (const timezone of ['America/Los_Angeles', 'Pacific/Honolulu', 'Asia/Tokyo']) {
      assert.equal(core.groupScheduleEvents([allDay], timezone)[0].days[0].dateKey, '2027-03-01');
      assert.equal(display.scheduleDisplayTimeZone(allDay, timezone), 'UTC');
      assert.equal(card.formatEventTime(allDay, 'en-US', timezone, t), 'schedule.allDay');
      assert.match(details.formatEventDate(allDay, 'en-US', 'All day', timezone), /March 1/u);
      assert.equal(display.formatSchedulePreview({ ...allDay, startAtMillis: allDay.startAt.getTime() }, 'en-US', timezone), 'Mar 1, 2027');
    }
  });
  await test('import_preview_uses_phone_zone_and_selected_locale_without_mutating_input', () => {
    const preview = { startAtMillis: event.startAt.getTime(), timezone: 'UTC', isAllDay: false };
    const before = JSON.stringify(preview);
    assert.match(display.formatSchedulePreview(preview, 'en-US', 'America/New_York'), /10:00/u);
    assert.match(display.formatSchedulePreview(preview, 'en-US', 'America/Los_Angeles'), /7:00/u);
    assert.equal(display.formatSchedulePreview(preview, 'es-MX', 'America/New_York'),
      new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }).format(event.startAt));
    assert.equal(JSON.stringify(preview), before);
  });
  await test('display_conversion_preserves_instants_source_zone_and_edit_draft', () => {
    const before = JSON.stringify(event), draft = drafts.scheduleDraftFromEvent(event);
    core.groupScheduleEvents([event], 'America/Los_Angeles');
    card.formatEventTime(event, 'en-US', 'Asia/Tokyo', t);
    details.formatEventDate(event, 'en-US', 'All day', 'America/New_York');
    assert.equal(JSON.stringify(event), before);
    assert.equal(draft.timezone, 'UTC'); assert.equal(draft.startTime, '14:00');
    assert.equal(draft.arrivalTime, '13:45'); assert.deepEqual(drafts.scheduleDraftFromEvent(event), draft);
  });
  await test('phone_zone_resolution_has_no_fixed_regional_default', () => {
    for (const timezone of ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Asia/Tokyo']) {
      const fakeIntl = { DateTimeFormat: function (_locale, options) {
        return options ? new Intl.DateTimeFormat('en-US', options) : { resolvedOptions: () => ({ timeZone: timezone }) };
      } };
      assert.equal(actualFunctions('utils/teamScheduleDisplay.ts', ['getDeviceTimeZone'], { Intl: fakeIntl }).getDeviceTimeZone(), timezone);
    }
    const unavailable = { DateTimeFormat() { throw Error('fixture_zone_unavailable'); } };
    assert.equal(actualFunctions('utils/teamScheduleDisplay.ts', ['getDeviceTimeZone'], { Intl: unavailable }).getDeviceTimeZone(), 'UTC');
  });
  await test('foreground_zone_change_updates_mounted_hook_and_removes_listener', () => {
    const h = harness(); let timezone = 'America/New_York', listener, removed = false;
    const hook = createSourceLoader({ react: h.react,
      'react-native': { AppState: { addEventListener(name, callback) {
        assert.equal(name, 'change'); listener = callback; return { remove() { removed = true; } };
      } } }, '@/utils/teamScheduleDisplay': { getDeviceTimeZone: () => timezone },
    })('hooks/useDeviceTimeZone.ts').useDeviceTimeZone;
    assert.equal(h.mount(hook), 'America/New_York');
    timezone = 'Asia/Tokyo'; listener('background'); assert.equal(h.render(), 'America/New_York');
    listener('active'); assert.equal(h.render(), 'Asia/Tokyo');
    h.unmount(); assert.equal(removed, true);
  });
  return { status: 'PASS', groups: cases.length, cases, deviceRequests: 0, networkRequests: 0,
    builds: 0, deployments: 0, retries: 0 };
}

main().then(result => console.log(JSON.stringify(result))).catch(error => {
  console.error(JSON.stringify({ status: 'FAIL', completed: cases, message: error.message })); process.exitCode = 1;
});
