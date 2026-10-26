'use strict';
// Fresh reviewed helpers retain their own request budgets, target restrictions,
// one-use markers and approval checks. This adapter adds a guard before EVERY
// request, including requests inside an already-running stage.
const crypto = require('node:crypto');
const vm = require('node:vm');
const path = require('node:path');
function createReviewedPhaseExecutor({bindings, readFile, readOutcome, core, https,
  environment, requireModule, emit = () => {}}) {
  if (!bindings || !readFile || !readOutcome || !core || !https || !requireModule) throw Error('reviewed_executor_dependencies_required');
  const used = new Set();
  return async (phase, context) => {
    const pin = bindings[phase];
    if (!pin || used.has(phase)) throw Error('bound_phase_required_once');
    used.add(phase);
    const source = readFile(pin.file);
    if (typeof source !== 'string' || crypto.createHash('sha256').update(source).digest('hex') !== pin.sha256) throw Error('reviewed_phase_source_changed');
    context.beforeRequest();
    const proc = {env: environment, argv: ['node', pin.file, pin.argument], exitCode: 0};
    const guardedHttps = {...https, request(...args) { context.beforeRequest(); return https.request(...args); }};
    const localRequire = name => {
      if (name === 'node:https' || name === 'https') return guardedHttps;
      if (name === './cleanup-firebase-cloud-20261017.cjs') return {...core, cliToken: context.token};
      return requireModule(name);
    };
    const sandbox = {Buffer, URL, Date, setTimeout, clearTimeout,
      console: {log: () => {}}, process: proc, __dirname: path.dirname(pin.file),
      __filename: pin.file, require: localRequire};
    await new vm.Script(source, {filename: pin.file}).runInNewContext(sandbox);
    const outcome = readOutcome(pin.outcomeFile);
    const result = {ok: proc.exitCode === 0 && outcome?.status === pin.successStatus,
      authenticationRejected: (outcome?.requests || []).some(row => row.httpStatus === 401),
      status: /^[A-Z_0-9]+$/.test(outcome?.status || '') ? outcome.status : 'PHASE_OUTCOME_UNCONFIRMED'};
    emit({phase, ...result});
    return result;
  };
}
module.exports = {createReviewedPhaseExecutor};
