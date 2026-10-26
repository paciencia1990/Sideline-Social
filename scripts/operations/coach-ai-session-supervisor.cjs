'use strict';
// Reusable future worker. No cloud/device operation on import; all execution
// callbacks must be bound to a fresh reviewed session before startWindow.
const {requireCapture} = require('./coach-ai-capture-readiness-contract.cjs');
const ensure = (ok, code) => { if (!ok) throw Error(code); };
const NORMAL_PHASES = new Set(['baseline', 'stage', 'enable', 'purchase', 'restoreA', 'preB', 'restoreB', 'returnA', 'event']);
const ACTIONS = new Set(['plansA', 'subscribe', 'final-confirmation', 'restoreA', 'plansB', 'restoreB', 'plansReturnA', 'statusReturnA']);
const safeCode = value => /^[a-z_]+$/.test(value || '') ? value : 'session_operation_failed';

function createSessionSupervisor({sessionId, lease, approved, executePhase, readCapture,
  captureExpected, notify = () => {}, now = Date.now, setTimer = setInterval, clearTimer = clearInterval}) {
  ensure(sessionId && lease && typeof approved === 'function' && typeof executePhase === 'function'
    && typeof readCapture === 'function' && typeof captureExpected === 'function', 'supervisor_dependencies_required');
  let window, timer, closed = false, stopping = false, shutdownPromise, tail = Promise.resolve(), monitorStarted = false;
  const consumed = new Set(), actions = new Set(), results = [];
  const send = event => { try { notify({sessionId, ...event}); } catch { /* UI delivery must not interrupt shutdown. */ } };
  const serial = fn => { const work = tail.then(fn); tail = work.catch(() => {}); return work; };
  function checkTime(shutdown) {
    ensure(window && !closed && now() >= window.start && now() < (shutdown ? window.shutdown : window.normal), 'session_window_closed');
  }
  function guard(shutdown = false) {
    checkTime(shutdown);
    ensure(shutdown || !stopping, 'testing_stopped_shutdown_only');
    lease.assertCoversWindow(window.shutdown);
  }
  function capture() {
    const live = readCapture();
    const expected = {...captureExpected(), sessionId, nowMs: now(), shutdownStarted: stopping};
    requireCapture('plans', live, expected); // quiet healthy streams remain valid
    return {live, expected};
  }
  function beginShutdown(reason) {
    if (shutdownPromise) return shutdownPromise;
    stopping = true; // Blocks instructions immediately, even while a request runs.
    if (timer !== undefined) { clearTimer(timer); timer = undefined; }
    send({status: 'TESTING_STOPPED_SHUTDOWN_QUEUED', reason: safeCode(reason)});
    shutdownPromise = serial(async () => {
      for (const phase of ['master-off', 'disable']) {
        if (consumed.has(phase)) continue;
        try {
          guard(true); consumed.add(phase);
          const result = await executePhase(phase, {token: () => lease.tokenForWindow(window.shutdown),
            beforeRequest: () => guard(true), shutdownOnly: true});
          const safe = {phase, ok: result?.ok === true, authenticationRejected: result?.authenticationRejected === true};
          results.push(safe);
          if (safe.authenticationRejected) { lease.reject(); break; }
          // Independent untouched shutdown is still allowed after a non-auth
          // failure. Adapter enforces exact ownership, one-use limits and masks.
        } catch (error) {
          results.push({phase, ok: false, reason: safeCode(error.message)});
          if (lease.receipt().rejected) break;
        }
      }
      closed = true; lease.close();
      const complete = ['master-off', 'disable'].every(phase => results.some(r => r.phase === phase && r.ok));
      const result = {status: complete ? 'SHUTDOWN_COMPLETE' : 'SHUTDOWN_INCOMPLETE_NO_RETRY', results: [...results]};
      send(result); return result;
    });
    return shutdownPromise;
  }
  function tick() {
    if (closed || stopping || !monitorStarted) return;
    try { guard(); capture(); } catch (error) { void beginShutdown(safeCode(error.message)); }
  }
  return {
    startWindow() {
      ensure(!window && !closed && approved() === true, 'fresh_session_approval_required');
      const start = now();
      lease.assertCoversWindow(start + 45 * 60000);
      window = {start, normal: start + 30 * 60000, shutdown: start + 45 * 60000};
      return {...window};
    },
    attachCapture() {
      ensure(!monitorStarted, 'monitor_already_started'); guard(); capture();
      monitorStarted = true; timer = setTimer(tick, 1000);
      return {status: 'LOCAL_CAPTURE_SUPERVISION_STARTED', pollingNetwork: false};
    },
    phase(phase) {
      ensure(NORMAL_PHASES.has(phase) && !consumed.has(phase) && !stopping, 'phase_consumed_or_not_allowed');
      consumed.add(phase);
      return serial(async () => {
        try {
          guard();
          if (phase !== 'baseline') { ensure(monitorStarted, 'capture_supervision_required'); capture(); }
          const result = await executePhase(phase, {token: () => lease.tokenForWindow(window.shutdown),
            beforeRequest: () => { guard(); if (phase !== 'baseline') capture(); }, shutdownOnly: false});
          if (result?.ok !== true) {
            if (result?.authenticationRejected === true) lease.reject();
            void beginShutdown(result?.authenticationRejected ? 'authentication_rejected' : 'phase_failed');
          }
          return result;
        } catch (error) { void beginShutdown(safeCode(error.message)); throw Error(safeCode(error.message)); }
      });
    },
    authorizeAction(action, validateAction) {
      ensure(ACTIONS.has(action) && !actions.has(action) && typeof validateAction === 'function', 'one_reviewed_action_required');
      guard(); ensure(monitorStarted, 'capture_supervision_required');
      const {live, expected} = capture();
      if (action === 'subscribe' || action === 'final-confirmation') requireCapture(action, live, expected);
      // The caller retains all product, identity, active-fixture, no-charge,
      // ownership and time-left checks; this layer cannot replace those checks.
      ensure(validateAction() === true, 'reviewed_action_facts_required');
      guard(); capture();
      actions.add(action);
      return {sessionId, action, maximumActions: 1, issuedAtMs: now(),
        validUntilMs: Math.min(now() + 90000, window.normal, Date.parse(live.captureEndsUtc))};
    },
    stop: beginShutdown, tick,
    settled: () => tail,
    snapshot: () => ({closed, stopping, monitoring: monitorStarted && !stopping,
      consumedPhases: [...consumed], issuedActions: [...actions], shutdownResults: [...results]}),
  };
}
module.exports = {createSessionSupervisor};
