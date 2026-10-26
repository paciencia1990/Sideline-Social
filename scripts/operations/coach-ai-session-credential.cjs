'use strict';
// Future-session component. Importing this module performs no authentication.
const MINUTE = 60000;
const ensure = (ok, code) => { if (!ok) throw Error(code); };
function authFailure(run) {
  const text = String(run.stderr || '');
  if (['EACCES', 'EPERM'].includes(run.error?.code) || /access is denied|permission denied/i.test(text)) return 'local_access_denied';
  if (run.error?.code === 'ENOENT' || /not recognized|cannot find the file/i.test(text)) return 'local_tool_unavailable';
  if (/invalid_grant|invalid_rapt|reauth|re-login|auth login|expired or revoked/i.test(text)) return 'private_owner_sign_in_required';
  if (/network|connect|proxy|certificate|timed out|timeout/i.test(text)) return 'authentication_transport_failure';
  return 'authentication_failed';
}
function createCredentialLease({account, approved, now = Date.now, spawnSync, environment = process.env}) {
  ensure(typeof approved === 'function' && typeof now === 'function', 'credential_dependencies_required');
  ensure(typeof account === 'string' && /^[A-Za-z0-9._+\-]+@[A-Za-z0-9.\-]+$/.test(account), 'fixed_account_required');
  let attempted = false, token, expiryMs, obtainedAtMs, rejected = false, closed = false;
  const safe = () => ({acquisitionAttempts: attempted ? 1 : 0, acquired: !!token,
    obtainedAtUtc: obtainedAtMs ? new Date(obtainedAtMs).toISOString() : null,
    expiresAtUtc: expiryMs ? new Date(expiryMs).toISOString() : null,
    rejected, closed, credentialsRetainedInReceipt: false, automaticRefresh: false});
  function acquire() {
    ensure(!closed && !attempted && approved() === true, 'fresh_credential_approval_or_unused_attempt_required');
    attempted = true;
    let run, parsed;
    try {
      const spawn = spawnSync || require('node:child_process').spawnSync;
      // Google config-helper returns actual expiry and can refresh BEFORE the
      // first request. This is one approved acquisition, never a 401 retry.
      run = spawn('cmd.exe', ['/d', '/s', '/c', 'gcloud', 'config', 'config-helper',
        '--min-expiry=55m', '--format=json', '--account=' + account, '--quiet', '--verbosity=error'], {
        encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30000, maxBuffer: 1048576,
        env: {...environment, CLOUDSDK_CORE_MAX_RETRIES: '0', CLOUDSDK_CORE_DISABLE_FILE_LOGGING: 'true',
          CLOUDSDK_CORE_LOG_HTTP: 'false', CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: 'true',
          CLOUDSDK_CORE_DISABLE_PROMPTS: 'true', CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: 'true'},
      });
      ensure(run && !run.error && run.status === 0, authFailure(run || {}));
      try { parsed = JSON.parse(String(run.stdout || '')); } catch { throw Error('credential_json_invalid'); }
      const credential = parsed?.credential;
      ensure(typeof credential?.access_token === 'string' && /^[A-Za-z0-9._~+\/=\-]{20,16384}$/.test(credential.access_token), 'credential_token_invalid');
      ensure(typeof credential.token_expiry === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(credential.token_expiry), 'credential_expiry_required');
      expiryMs = Date.parse(credential.token_expiry); obtainedAtMs = now();
      ensure(Number.isFinite(expiryMs) && Number.isFinite(obtainedAtMs) && expiryMs - obtainedAtMs >= 50 * MINUTE, 'credential_lifetime_too_short');
      token = credential.access_token;
      return safe();
    } catch (error) {
      token = undefined;
      throw Error(/^[a-z_]+$/.test(error?.message || '') ? error.message : 'credential_acquisition_failed');
    } finally {
      if (run) { run.stdout = ''; run.stderr = ''; }
      if (parsed) { parsed.credential = undefined; parsed.configuration = undefined; }
    }
  }
  function assertCoversWindow(shutdownDeadlineMs) {
    const time = now();
    ensure(!closed && !rejected && !!token, 'usable_credential_required');
    ensure(Number.isFinite(time) && time >= obtainedAtMs && Number.isFinite(shutdownDeadlineMs)
      && shutdownDeadlineMs > time && shutdownDeadlineMs - time <= 45 * MINUTE
      && expiryMs >= shutdownDeadlineMs + 2 * MINUTE, 'credential_does_not_cover_shutdown');
  }
  return {
    acquire, assertCoversWindow,
    tokenForWindow(deadline) { assertCoversWindow(deadline); return token; },
    reject() { rejected = true; token = undefined; },
    close() { closed = true; token = undefined; },
    receipt: safe,
  };
}

function providerFailure(status, body) {
  // Only allowlisted codes leave this function. Never preserve Google's message,
  // request headers, resource names, tokens, or unknown error details.
  const allowed = new Set(['ACCESS_TOKEN_EXPIRED', 'ACCESS_TOKEN_INVALID', 'CREDENTIALS_MISSING', 'AUTH_TOKEN_EXPIRED']);
  const reasons = (Array.isArray(body?.error?.details) ? body.error.details : [])
    .map(item => item?.reason).filter(value => allowed.has(value));
  return {httpStatus: Number.isInteger(status) ? status : null,
    authenticationRejected: status === 401,
    category: status === 401 ? 'authentication_rejected' : 'provider_request_failed',
    providerReasons: [...new Set(reasons)], tokenExpiryProven: reasons.includes('ACCESS_TOKEN_EXPIRED') || reasons.includes('AUTH_TOKEN_EXPIRED')};
}
module.exports = {createCredentialLease, providerFailure};
