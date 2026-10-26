'use strict';
const {createPublicKey, verify} = require('node:crypto');
const JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
// Request-scoped Google OIDC verification. No tokeninfo call, key refresh or retry.
function createSchedulerVerifier({audience, email, subject, send, budget, now = Date.now}) {
  let keys;
  return async authorization => {
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization || '');
    if (!match || authorization.length > 8192) throw Error('cleanup_scheduler_denied');
    const parts = match[1].split('.');
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const time = Math.floor(now() / 1000);
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid)
      || header.crit !== undefined || header.jku !== undefined || header.jwk !== undefined || header.x5u !== undefined
      || !['accounts.google.com', 'https://accounts.google.com'].includes(claims?.iss)
      || claims.aud !== audience || claims.email !== email || claims.email_verified !== true || claims.sub !== subject
      || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat)
      || claims.exp <= time || claims.iat > time + 30 || claims.iat < time - 3600
      || claims.exp <= claims.iat || claims.exp - claims.iat > 3600
      || claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > time)) throw Error('cleanup_scheduler_denied');
    budget.check();
    if (!keys) keys = (async () => {
      const response = await send(JWKS);
      if (response.status !== 200 || !Array.isArray(response.value?.keys) || response.value.keys.length > 20) throw Error('cleanup_scheduler_denied');
      return response.value.keys;
    })();
    const candidates = (await keys).filter(key => key.kid === header.kid);
    if (candidates.length !== 1) throw Error('cleanup_scheduler_denied');
    const jwk = candidates[0];
    if (jwk.kty !== 'RSA' || jwk.alg !== 'RS256' || jwk.use !== 'sig' || jwk.d !== undefined) throw Error('cleanup_scheduler_denied');
    const key = createPublicKey({key: jwk, format: 'jwk'});
    if (key.asymmetricKeyDetails?.modulusLength < 2048 || !verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, Buffer.from(parts[2], 'base64url'))) throw Error('cleanup_scheduler_denied');
    budget.check();
    return true;
  };
}
module.exports = {JWKS, createSchedulerVerifier};
