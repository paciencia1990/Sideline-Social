'use strict';
const {createBudget} = require('../host/transport.cjs');
const {PROJECT} = require('../host/config.cjs');
const COUNT_FIELDS = ['pendingCleanup','pendingEvents','held','overdueReview','technicalEscalation','dueReceipts','dueReviews','overdueExceptions','inconsistent','malformed','stalledGeneration'];
const REASONS = ['scan_complete','inventory_limit','records_need_review','read_or_validation_failed'];
const MAX_DELAY_MS = 15 * 60000;
const eastern = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York', weekday:'short', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23'});
const defaultLog = value => process.stdout.write(JSON.stringify(value) + '\n');
const REJECTION_REASONS = new Set(['raw_body_unavailable', 'invalid_json', 'invalid_observer_mode',
  'job_name_missing', 'job_name_mismatch', 'scheduler_flag_missing', 'scheduler_flag_mismatch',
  'schedule_time_format', 'schedule_time_calendar', 'schedule_time_precision',
  'schedule_time_offset', 'schedule_time_future', 'schedule_time_stale', 'slot_not_on_schedule', 'schedule_guard_denied']);
const HEADER_REJECTIONS = new Set(['job_name_missing', 'job_name_mismatch', 'scheduler_flag_missing', 'scheduler_flag_mismatch']);
const HEADER_STATUSES = new Set(['match', 'missing', 'mismatch']);
function reportObserverRejection(log = defaultLog, reason, headerChecks) {
  // No input values, tokens, identities, schedule headers or exception text.
  // Copy only fixed statuses, so one event can identify both header failures.
  const checks = HEADER_REJECTIONS.has(reason)
    && HEADER_STATUSES.has(headerChecks?.jobNameStatus) && HEADER_STATUSES.has(headerChecks?.schedulerFlagStatus)
    ? {jobNameStatus:headerChecks.jobNameStatus, schedulerFlagStatus:headerChecks.schedulerFlagStatus} : {};
  try {log({schema:1, component:'coach_ai_cleanup_observer_rejection',
    reason:REJECTION_REASONS.has(reason) ? reason : 'schedule_guard_denied', ...checks});} catch {/* No logging retry. */}
}
function scheduleDenied(reason, headerChecks) {throw Object.assign(Error('cleanup_schedule_denied'), {reason, headerChecks});}
function scheduleTime(value) {
  // Scheduler documents an RFC3339 offset, not exclusively the Z spelling.
  // Validate the civil date before converting it; Date.parse alone rolls some
  // invalid dates forward. Never round sub-minute values into an allowed slot.
  const match = typeof value === 'string'
    && /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.([0-9]{1,9}))?([Zz]|[+-]\d\d:\d\d)$/.exec(value);
  if (!match || match[0] !== value) scheduleDenied('schedule_time_format');
  const [,year,month,day,hour,minute,second,fraction,zone] = match;
  if (fraction && /[1-9]/.test(fraction)) scheduleDenied('schedule_time_precision');
  const civil = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
  const wallTime = Date.parse(civil + '.000Z');
  if (!Number.isSafeInteger(wallTime) || year === '0000'
    || new Date(wallTime).toISOString().slice(0,19) !== civil) scheduleDenied('schedule_time_calendar');
  let offset = 0;
  if (!/^[Zz]$/.test(zone)) {
    const hours = Number(zone.slice(1,3)), minutes = Number(zone.slice(4,6));
    // RFC3339's -00:00 means an unknown offset; a job needs a known instant.
    if (hours > 23 || minutes > 59 || zone === '-00:00') scheduleDenied('schedule_time_offset');
    offset = (hours * 60 + minutes) * 60000 * (zone[0] === '+' ? 1 : -1);
  }
  const time = wallTime - offset;
  if (!Number.isSafeInteger(time) || !/^\d{4}-/.test(new Date(time).toISOString())) scheduleDenied('schedule_time_calendar');
  return time;
}
function scheduleSlot(mode, headers, now) {
  if (!['health','notice'].includes(mode)) scheduleDenied('invalid_observer_mode');
  const job = `projects/${PROJECT}/locations/us-central1/jobs/coach-ai-cleanup-${mode}`;
  const jobNameStatus = headers['x-cloudscheduler-jobname'] === undefined ? 'missing'
    : headers['x-cloudscheduler-jobname'] === job ? 'match' : 'mismatch';
  const schedulerFlagStatus = headers['x-cloudscheduler'] === undefined ? 'missing'
    : headers['x-cloudscheduler'] === 'true' ? 'match' : 'mismatch';
  if (jobNameStatus !== 'match' || schedulerFlagStatus !== 'match') {
    const reason = jobNameStatus !== 'match' ? 'job_name_' + jobNameStatus : 'scheduler_flag_' + schedulerFlagStatus;
    scheduleDenied(reason, {jobNameStatus, schedulerFlagStatus});
  }
  const value = headers['x-cloudscheduler-scheduletime'];
  const time = scheduleTime(value), date = new Date(time);
  if (!Number.isSafeInteger(now) || time > now) scheduleDenied('schedule_time_future');
  if (now - time > MAX_DELAY_MS) scheduleDenied('schedule_time_stale');
  const p = Object.fromEntries(eastern.formatToParts(time).map(v => [v.type, v.value]));
  if (p.second !== '00' || (mode === 'health' ? Number(p.minute) % 10 !== 0
    : !['Mon','Tue','Wed','Thu','Fri'].includes(p.weekday) || !['09','16'].includes(p.hour) || p.minute !== '00')) scheduleDenied('slot_not_on_schedule');
  return {key: mode + ':' + date.toISOString(), time};
}
function aggregate(scan) {
  if (!scan || !['healthy','attention','unknown'].includes(scan.health) || !REASONS.includes(scan.reason)) throw Error('cleanup_monitor_result');
  let counts = null;
  if (scan.counts !== null) {
    if (!scan.counts || COUNT_FIELDS.some(k => !Number.isSafeInteger(scan.counts[k]) || scan.counts[k] < 0 || scan.counts[k] > 100000)) throw Error('cleanup_monitor_result');
    counts = Object.fromEntries(COUNT_FIELDS.map(k => [k, scan.counts[k]]));
  }
  if (scan.health !== 'unknown' && (!counts || scan.reason !== 'scan_complete')
    || scan.health === 'healthy' && Object.values(counts).some(n => n !== 0)
    || scan.health === 'attention' && !Object.values(counts).some(n => n > 0)) throw Error('cleanup_monitor_result');
  return {health: scan.health, reason: scan.reason, counts};
}
function createObserverHost({enabled = false, createRuntime, log = defaultLog, now = Date.now}) {
  if (typeof enabled !== 'boolean') throw Error('cleanup_observer_capability_configuration');
  const slots = new Map();
  let busy = false;
  return async function handle(req, res) {
    const controller = new AbortController(), budget = createBudget({now, signal: controller.signal});
    const disconnect = () => {if (!res.writableEnded) controller.abort();};
    req.once('aborted', disconnect); res.once('close', disconnect);
    const stopInput = () => {if (!req.complete) req.destroy();};
    budget.signal.addEventListener('abort', stopInput, {once:true});
    const reply = (status, body) => {if (!res.destroyed && !res.writableEnded) {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); res.end(JSON.stringify(body));}};
    let claimed, scanning = false, emitted = false;
    const emit = value => {emitted = true; log({schema:1, component:'coach_ai_cleanup_observer', mode:claimed.mode, slot:claimed.key,
      checkedAtMs:now(), delayedMs:now() - claimed.time, noticeWindow:claimed.mode === 'notice', ...value});};
    try {
      if (req.url === '/healthz' && req.method === 'GET') return reply(200, {status:'up', observerEnabled:enabled});
      if (req.url !== '/observe' || req.method !== 'POST') return reply(404, {error:'not_found'});
      if (!enabled) return reply(503, {error:'cleanup_observer_disabled'});
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json' || req.headers['content-encoding'] || req.headers.cookie || req.headers.origin
        || req.headers['x-serverless-authorization'] || !/^Bearer [^\s]{1,8192}$/.test(req.headers.authorization || '')) return reply(403, {error:'cleanup_observer_denied'});
      const critical = ['authorization','content-length','content-type','x-cloudscheduler','x-cloudscheduler-jobname','x-cloudscheduler-scheduletime'];
      for (const name of critical) if ((req.rawHeaders || []).filter((_, i) => i % 2 === 0).filter(v => v.toLowerCase() === name).length > 1) return reply(403, {error:'cleanup_observer_denied'});
      const declared = req.headers['content-length'];
      if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > 256)) return reply(413, {error:'request_too_large'});
      const chunks = []; let length = 0;
      for await (const chunk of req) {budget.check(); length += Buffer.byteLength(chunk); if (length > 256) return reply(413, {error:'request_too_large'}); chunks.push(Buffer.from(chunk));}
      let body; try {body = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {
        reportObserverRejection(log, 'invalid_json'); return reply(400, {error:'invalid_json'});
      }
      if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !['health','notice'].includes(body.mode)) {
        reportObserverRejection(log, 'invalid_observer_mode'); return reply(400, {error:'invalid_observer_mode'});
      }
      const runtime = createRuntime(budget);
      try {await runtime.authenticate(req.headers.authorization);} catch {return reply(403, {error:'cleanup_observer_denied'});}
      budget.check();
      let slot; try {slot = scheduleSlot(body.mode, req.headers, now());} catch (error) {
        reportObserverRejection(log, error?.reason, error?.headerChecks); return reply(400, {error:'cleanup_schedule_denied'});
      }
      for (const [key, entry] of slots) if (now() - entry.time > MAX_DELAY_MS) slots.delete(key);
      const previous = slots.get(slot.key);
      if (previous) return reply(previous.state === 'complete' ? 200 : 409, {status:'duplicate_suppressed', outcome:previous.state});
      if (slots.size >= 64) return reply(503, {error:'cleanup_slot_capacity'});
      claimed = {...slot, mode:body.mode, state:'stopped'}; slots.set(slot.key, claimed);
      if (busy) {emit({health:'unknown', reason:'observer_busy', counts:null}); return reply(409, {error:'cleanup_observer_busy'});}
      busy = true; scanning = true;
      const snapshot = aggregate(await runtime.scan());
      budget.check(); emit(snapshot);
      claimed.state = snapshot.health === 'unknown' ? 'stopped' : 'complete';
      return reply(snapshot.health === 'unknown' ? 503 : 200, {status:snapshot.health});
    } catch {
      if (claimed && !emitted) {try {emit({health:'unknown', reason:'observer_stopped', counts:null});} catch {/* No logging retry. */}}
      return reply(503, {error:'cleanup_observer_stopped'});
    } finally {
      if (scanning) busy = false;
      budget.signal.removeEventListener('abort', stopInput); budget.close(); req.removeListener('aborted', disconnect); res.removeListener('close', disconnect);
    }
  };
}
module.exports = {createObserverHost, scheduleSlot, MAX_DELAY_MS, reportObserverRejection};
