'use strict';
const {PROJECT} = require('../host/config.cjs');
const COLLECTIONS = Object.freeze({fences:'coachAiBillingEnrollments', queue:'coachAiBillingDeletionQueue', events:'coachAiBillingEvents', reviews:'coachAiInternalConfig/cleanupReviews/items', paidRequests:'coachAiPaidRequests'});
const FIELDS = ['state','status','attemptState','createdAt','fencedAt','attemptedAt','receivedAt','localCleanupCompletedAt','vendorCleanupRequired','closedAt','retentionDueAt','completedAt','approvedAtMs','consumedAt','expiresAt','retentionHold','legalHold','retentionException.nextReviewAt','startedAt','leaseUntilMs'];
// A projected inventory reader, not the console's read/write Firestore port.
// No doc(), transaction, commit, Auth, vendor or secret capability is constructed.
function createInventoryReader({projectId, core, send, getAccessToken, budget}) {
  if (projectId !== PROJECT) throw Error('cleanup_project_mismatch');
  if (JSON.stringify(core.CLEANUP_COLLECTIONS) !== JSON.stringify(COLLECTIONS)
    || JSON.stringify(core.CLEANUP_FIELDS) !== JSON.stringify(FIELDS) || core.CLEANUP_SCAN_LIMIT !== 500) throw Error('cleanup_observer_scope');
  const root = `projects/${projectId}/databases/(default)/documents`;
  function decode(value) {
    if (!value || typeof value !== 'object' || Object.keys(value).length !== 1) throw Error('cleanup_observer_value');
    if ('nullValue' in value) return null;
    if ('stringValue' in value && typeof value.stringValue === 'string') return value.stringValue;
    if ('booleanValue' in value && typeof value.booleanValue === 'boolean') return value.booleanValue;
    if ('integerValue' in value || 'doubleValue' in value) {
      const n = Number(value.integerValue ?? value.doubleValue);
      if (!Number.isFinite(n) || 'integerValue' in value && !Number.isSafeInteger(n)) throw Error('cleanup_observer_value');
      return n;
    }
    if ('timestampValue' in value) {
      if (typeof value.timestampValue !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value.timestampValue)) throw Error('cleanup_observer_value');
      const ms = Date.parse(value.timestampValue);
      if (!Number.isSafeInteger(ms)) throw Error('cleanup_observer_value');
      return Object.freeze({toMillis: () => ms});
    }
    if ('mapValue' in value) return fields(value.mapValue.fields || {});
    throw Error('cleanup_observer_value');
  }
  function fields(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('cleanup_observer_value');
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, decode(value)]));
  }
  return async () => {
    const token = await getAccessToken();
    const inventory = {};
    // Sequential reads stop at the first failure, with one credential attempt.
    for (const [kind, collection] of Object.entries(core.CLEANUP_COLLECTIONS)) {
      budget.check();
      const parts = collection.split('/'), id = parts.pop(), parent = parts.join('/');
      const url = `https://firestore.googleapis.com/v1/${root}${parent ? '/' + parent : ''}:runQuery`;
      const response = await send(url, {method: 'POST', headers: {authorization: 'Bearer ' + token}, body: {
        structuredQuery: {from: [{collectionId: id}], select: {fields: core.CLEANUP_FIELDS.map(fieldPath => ({fieldPath}))}, limit: core.CLEANUP_SCAN_LIMIT + 1,
          ...(kind==='paidRequests'?{where:{fieldFilter:{field:{fieldPath:'status'},op:'EQUAL',value:{stringValue:'processing'}}}}:{} )},
      }});
      if (response.status !== 200 || !Array.isArray(response.value) || response.value.length > core.CLEANUP_SCAN_LIMIT + 2) throw Error('cleanup_observer_read_stopped');
      if (response.value.some(row => !row || typeof row !== 'object' || row.error || row.skippedResults
        || !row.document && (typeof row.readTime !== 'string' || !Number.isFinite(Date.parse(row.readTime))))) throw Error('cleanup_observer_read_stopped');
      const seen = new Set();
      inventory[kind] = response.value.filter(row => row.document).map(row => {
        const document = row.document, prefix = root + '/' + collection + '/', key = document.name?.slice(prefix.length);
        if (typeof document.name !== 'string' || !document.name.startsWith(prefix) || !/^[A-Za-z0-9_-]{1,128}$/.test(key) || seen.has(key)) throw Error('cleanup_observer_read_stopped');
        seen.add(key);
        const data = fields(document.fields || {});
        if (Object.keys(data).some(k => !core.CLEANUP_FIELDS.some(field => field.split('.')[0] === k))
          || data.retentionException && Object.keys(data.retentionException).some(k => k !== 'nextReviewAt')) throw Error('cleanup_observer_projection');
        if(kind==='paidRequests' && data.status!=='processing')throw Error('cleanup_observer_projection');
        return {id: key, data};
      });
    }
    budget.check();
    return inventory;
  };
}
module.exports = {createInventoryReader};
