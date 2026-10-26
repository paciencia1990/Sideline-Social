'use strict';
const {PROJECT} = require('../host/config.cjs');
const {createJsonTransport, metadataCredential} = require('../host/transport.cjs');
const {JWKS, createSchedulerVerifier} = require('./auth.cjs');
const {createInventoryReader} = require('./firestore.cjs');
function createObserverRuntime({config, core, requestImpl, now = Date.now}) {
  if (config.projectId !== PROJECT) throw Error('cleanup_project_mismatch');
  const root = `/v1/projects/${PROJECT}/databases/(default)/documents`;
  return budget => {
    const send = createJsonTransport({budget, requestImpl, allow: (url, method) =>
      url.href === JWKS && method === 'GET'
      || url.href === 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token' && method === 'GET'
      || url.protocol === 'https:' && url.hostname === 'firestore.googleapis.com' && !url.port && !url.search
        && [root + ':runQuery', root + '/coachAiInternalConfig/cleanupReviews:runQuery'].includes(url.pathname) && method === 'POST',
    });
    const authenticate = createSchedulerVerifier({audience: config.audience, email: config.schedulerEmail, subject: config.schedulerSubject, send, budget, now});
    // Credentials and data are fetched only after the host authenticates and claims a slot.
    const read = createInventoryReader({projectId: config.projectId, core, send, getAccessToken: metadataCredential(send, budget), budget});
    return {authenticate, scan: core.createCleanupQueueMonitor(read, now)};
  };
}
module.exports = {createObserverRuntime};
