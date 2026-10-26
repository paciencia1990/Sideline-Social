(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CleanupClient = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createTransport(options) {
    const endpoint = new URL('/internal/coach-ai-cleanup', options.origin);
    if (!/^https?:$/.test(endpoint.protocol) || endpoint.origin !== options.origin) throw Error('invalid_origin');
    return async function (action, payload) {
      const token = await options.getToken();
      if (typeof token !== 'string' || !token || /\s/.test(token)) throw Error('session_required');
      const reply = await options.fetch(endpoint.href, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(Object.assign({}, payload, { action })),
        signal: AbortSignal.timeout(30000)
      });
      const body = await reply.json();
      if (!reply.ok) throw Error(body?.error === 'cleanup_identity_required' ? 'identity_required' : 'request_stopped');
      return body;
    };
  }
  function createController(send) {
    const state = { busy: false, uncertain: false, reconciled: false, identityRequired: false };
    const sent = new Set();
    return {
      state,
      async call(action, payload) {
        if (state.busy) throw Error('request_in_progress');
        const mutation = ['approve','execute','expire_review'].includes(action);
        if (mutation && state.uncertain) throw Error('reconcile_required');
        const id = action + ':' + (payload?.draft?.reviewId || payload?.target?.reviewId || payload?.reviewId || '');
        if (mutation && sent.has(id)) throw Error('already_attempted');
        state.busy = true;
        if (mutation) sent.add(id);
        try {
          const response = await send(action, payload || {});
          if (action === 'detail' && state.uncertain) state.reconciled = true;
          return response;
        } catch (error) {
          state.identityRequired = error?.message === 'identity_required';
          if (mutation) { state.uncertain = true; state.reconciled = false; }
          throw Error(mutation ? 'outcome_unclear_reconcile' : 'request_stopped');
        } finally { state.busy = false; }
      },
      beginNewReview() {
        if (state.busy || state.uncertain && !state.reconciled) throw Error('reconcile_required');
        state.uncertain = false; state.reconciled = false; state.identityRequired = false;
      }
    };
  }
  return { createTransport, createController };
});
