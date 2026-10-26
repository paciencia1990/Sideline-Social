'use strict';
const PROJECT = 'sideline-social-staging-2026';
const SCHEDULER = `coach-ai-cleanup-scheduler@${PROJECT}.iam.gserviceaccount.com`;
function flag(env, name) {
  const value = env[name];
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw Error('cleanup_invalid_capability');
}
function exactOrigin(value, runOnly = false) {
  try {
    const url = new URL(value);
    if (url.origin !== value || url.protocol !== 'https:' || url.username || url.password
      || runOnly && (!url.hostname.endsWith('.run.app') || url.port)) throw Error();
    return value;
  } catch { throw Error('cleanup_origin_required'); }
}
function common(env, service) {
  if ([env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT, env.CLEANUP_PROJECT_ID].some(v => v !== undefined && v !== PROJECT)) throw Error('cleanup_project_mismatch');
  if (env.K_SERVICE !== undefined && env.K_SERVICE !== service) throw Error('cleanup_service_mismatch');
  const port = env.PORT === undefined ? 8080 : Number(env.PORT);
  if (env.PORT !== undefined && !/^[1-9][0-9]{0,4}$/.test(env.PORT) || !Number.isInteger(port) || port > 65535) throw Error('cleanup_invalid_port');
  return {projectId: PROJECT, port};
}
function readConsoleConfig(env) {
  const base = common(env, 'coach-ai-cleanup-console');
  const readsEnabled = flag(env, 'CLEANUP_READS_ENABLED'), mutationsEnabled = flag(env, 'CLEANUP_MUTATIONS_ENABLED');
  const loginEnabled = flag(env, 'CLEANUP_LOGIN_ENABLED');
  if (flag(env, 'CLEANUP_OBSERVER_ENABLED') || mutationsEnabled && !readsEnabled) throw Error('cleanup_capability_configuration');
  const origin = exactOrigin(env.CLEANUP_ORIGIN);
  const publicAuthConfig = loginEnabled ? {projectId: PROJECT, apiKey: env.CLEANUP_FIREBASE_WEB_API_KEY} : null;
  if (loginEnabled && !/^[-A-Za-z0-9_]{10,150}$/.test(publicAuthConfig.apiKey || '')) throw Error('cleanup_public_auth_config');
  let operatorPins, verificationKey;
  if (readsEnabled) {
    const primaryUid = env.CLEANUP_PRIMARY_UID, backupUid = env.CLEANUP_BACKUP_UID;
    if (![primaryUid, backupUid].every(v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)) || primaryUid === backupUid) throw Error('cleanup_operator_pins_required');
    const key = env.REVENUECAT_VERIFICATION_KEY;
    if (typeof key !== 'string' || !/^[^\s]{10,2048}$/.test(key)) throw Error('cleanup_verification_key_required');
    operatorPins = Object.freeze({primaryUid, backupUid});
    verificationKey = () => key;
  }
  return Object.freeze({...base, origin, readsEnabled, mutationsEnabled, loginEnabled, publicAuthConfig, operatorPins, verificationKey});
}
function readObserverConfig(env) {
  const base = common(env, 'coach-ai-cleanup-observer'), enabled = flag(env, 'CLEANUP_OBSERVER_ENABLED');
  if (['CLEANUP_READS_ENABLED', 'CLEANUP_MUTATIONS_ENABLED', 'CLEANUP_LOGIN_ENABLED'].some(k => flag(env, k))) throw Error('cleanup_observer_capability_configuration');
  let audience, schedulerSubject;
  if (enabled) {
    audience = exactOrigin(env.CLEANUP_OBSERVER_AUDIENCE, true);
    schedulerSubject = env.CLEANUP_SCHEDULER_SUBJECT_ID;
    if (typeof schedulerSubject !== 'string' || !/^[0-9]{6,30}$/.test(schedulerSubject)) throw Error('cleanup_scheduler_subject_required');
  }
  return Object.freeze({...base, enabled, audience, schedulerEmail: SCHEDULER, schedulerSubject});
}
module.exports = {PROJECT, SCHEDULER, readConsoleConfig, readObserverConfig};
