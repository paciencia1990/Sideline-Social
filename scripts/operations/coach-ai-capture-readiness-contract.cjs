'use strict';
// Pure future-controller contract. It never reads files or operates an app.
function requireCapture(phase, live, expected) {
  const fail = code => { throw Error(code); };
  if (!['plans', 'subscribe', 'final-confirmation'].includes(phase)) fail('invalid_capture_phase');
  const at = Date.parse(live?.at), end = Date.parse(live?.captureEndsUtc);
  const maximumEnd = Date.parse(expected.captureMustEndByUtc);
  const age = expected.nowMs - at;
  if (typeof expected.sessionId !== 'string' || !expected.sessionId
      || typeof expected.captureId !== 'string' || !expected.captureId
      || live?.schemaVersion !== 2 || live.sessionId !== expected.sessionId
      || live.captureId !== expected.captureId
      || !Number.isFinite(age) || age < 0 || age > 5000
      || !Number.isFinite(maximumEnd) || !Number.isFinite(end)
      || end > maximumEnd || end <= expected.nowMs || expected.shutdownStarted
      || live.live !== true || live.transportReadyForPlansOnly !== true
      || live.streamProcessRunning !== true || live.stdoutReaderRunning !== true
      || live.stderrMonitorStarted !== true || live.fault || live.eof) {
    fail('fresh_healthy_capture_required');
  }
  if (phase !== 'plans' && (!expected.plansBoundaryId
      || live.plansBoundaryId !== expected.plansBoundaryId
      || live.appLogSincePlansAuthorization !== true
      || expected.ownerPlansReady !== true)) {
    fail('app_delivery_and_owner_plans_confirmation_required');
  }
  return {phase, transportAttached: true,
    appDeliverySincePlansAuthorization: live.appLogSincePlansAuthorization === true,
    purchaseAuthorized: false, causalPlansLogProof: false};
}
module.exports = {requireCapture};
