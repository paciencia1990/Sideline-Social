'use strict';

// Proposed resources, not an assertion that they exist. No environment or
// credentials are read on import. Availability must pass the deployment review.
const PROJECT = 'sideline-social-staging-2026';
const REGION = 'us-central1';
const SITE = 'sideline-coach-cleanup-2026';
const ORIGIN = `https://${SITE}.web.app`;
const CONSOLE = 'coachAiCleanupConsole';
const OBSERVER = 'coachAiCleanupObserver';
const OBSERVER_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net/${OBSERVER}`;
const SCHEDULER = `coach-ai-cleanup-scheduler@${PROJECT}.iam.gserviceaccount.com`;

function flag(env, name) {
  if (env[name] === undefined || env[name] === 'false') return false;
  if (env[name] === 'true') return true;
  throw Error('cleanup_invalid_capability');
}

function runtimeProject(env, target) {
  const claims = [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].filter(v => v !== undefined && v !== '');
  if (env.FIREBASE_CONFIG !== undefined) {
    let config;
    try {config = JSON.parse(env.FIREBASE_CONFIG);} catch {throw Error('cleanup_project_mismatch');}
    if (!config || Array.isArray(config) || typeof config !== 'object' || typeof config.projectId !== 'string') {
      throw Error('cleanup_project_mismatch');
    }
    claims.push(config.projectId);
  }
  if (!claims.length || claims.some(v => v !== PROJECT) || env.CLEANUP_PROJECT_ID !== PROJECT) {
    throw Error('cleanup_project_mismatch');
  }
  // Google also supplies K_SERVICE in first-generation Functions. Its presence
  // cannot establish the deployment generation. The SDK and reviewed v1 API
  // deployment pin that platform; retain the project and entrypoint checks here.
  if (env.FUNCTION_TARGET !== undefined && env.FUNCTION_TARGET !== target
    || env.FUNCTION_NAME !== undefined && env.FUNCTION_NAME !== target
    || env.FUNCTION_SIGNATURE_TYPE !== undefined && env.FUNCTION_SIGNATURE_TYPE !== 'http') {
    throw Error('cleanup_function_mismatch');
  }
}

function readFirebaseConsoleConfig(env) {
  runtimeProject(env, CONSOLE);
  if (env.CLEANUP_HOSTING_SITE !== SITE || env.CLEANUP_ORIGIN !== ORIGIN || flag(env, 'CLEANUP_OBSERVER_ENABLED')) {
    throw Error('cleanup_origin_required');
  }
  const readsEnabled = flag(env, 'CLEANUP_READS_ENABLED');
  const mutationsEnabled = flag(env, 'CLEANUP_MUTATIONS_ENABLED');
  const loginEnabled = flag(env, 'CLEANUP_LOGIN_ENABLED');
  const operatorActionsEnabled = flag(env, 'CLEANUP_OPERATOR_ACTIONS_ENABLED');
  if (mutationsEnabled && !readsEnabled) throw Error('cleanup_capability_configuration');
  if (operatorActionsEnabled && (!readsEnabled || !loginEnabled || mutationsEnabled)) throw Error('cleanup_capability_configuration');
  let publicAuthConfig = null, operatorPins, verificationKey;
  if (loginEnabled) {
    if (!/^[-A-Za-z0-9_]{10,150}$/.test(env.CLEANUP_FIREBASE_WEB_API_KEY || '')) throw Error('cleanup_public_auth_config');
    publicAuthConfig = Object.freeze({projectId: PROJECT, apiKey: env.CLEANUP_FIREBASE_WEB_API_KEY});
  }
  if (readsEnabled) {
    const primaryUid = env.CLEANUP_PRIMARY_UID, backupUid = env.CLEANUP_BACKUP_UID;
    if (![primaryUid, backupUid].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v))
      || primaryUid === backupUid) throw Error('cleanup_operator_pins_required');
    const key = env.REVENUECAT_VERIFICATION_KEY;
    if (typeof key !== 'string' || !/^[^\s]{10,2048}$/.test(key)) throw Error('cleanup_verification_key_required');
    operatorPins = Object.freeze({primaryUid, backupUid});
    verificationKey = () => key;
  }
  return Object.freeze({projectId: PROJECT, origin: ORIGIN, publicAuthConfig, operatorPins,
    verificationKey, readsEnabled, mutationsEnabled, loginEnabled, operatorActionsEnabled});
}

function readFirebaseObserverConfig(env) {
  runtimeProject(env, OBSERVER);
  if (['CLEANUP_READS_ENABLED', 'CLEANUP_MUTATIONS_ENABLED', 'CLEANUP_LOGIN_ENABLED'].some(name => flag(env, name))) {
    throw Error('cleanup_capability_configuration');
  }
  const enabled = flag(env, 'CLEANUP_OBSERVER_ENABLED');
  let audience, schedulerSubject;
  if (enabled) {
    // Full Function URL, including its name. Job URI and audience are identical;
    // no caller Host/X-Forwarded-* value, run.app alias or query is accepted.
    if (env.CLEANUP_OBSERVER_AUDIENCE !== OBSERVER_URL) throw Error('cleanup_observer_audience');
    if (!/^[0-9]{6,30}$/.test(env.CLEANUP_SCHEDULER_SUBJECT_ID || '')) throw Error('cleanup_scheduler_subject_required');
    audience = OBSERVER_URL;
    schedulerSubject = env.CLEANUP_SCHEDULER_SUBJECT_ID;
  }
  return Object.freeze({projectId: PROJECT, enabled, audience, schedulerEmail: SCHEDULER, schedulerSubject});
}

module.exports = {PROJECT, REGION, SITE, ORIGIN, CONSOLE, OBSERVER, OBSERVER_URL, SCHEDULER,
  readFirebaseConsoleConfig, readFirebaseObserverConfig};
