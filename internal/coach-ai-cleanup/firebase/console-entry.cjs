'use strict';
const functions = require('firebase-functions/v1');
const {createFirebaseConsole} = require('./console.cjs');
const {replyStopped} = require('./request.cjs');
const {PROJECT, REGION, CONSOLE} = require('./config.cjs');

let pendingHandler;
// These declarations keep a blind CLI deployment private and inactive. The
// reviewed API deployment must explicitly pin any later secret binding to
// version 1. No SecretParam/latest binding or public invoker is implicit here.
exports[CONSOLE] = functions.region(REGION).runWith({timeoutSeconds: 30, memory: '512MB',
  minInstances: 0, maxInstances: 1, invoker: 'private',
  serviceAccount: `coach-ai-cleanup-operator@${PROJECT}.iam.gserviceaccount.com`,
}).https.onRequest(async (req, res) => {
  try {
    // Cache rejection too: a failed initialization is never retried in this
    // instance. An operator must reconcile/configure explicitly before use.
    if (!pendingHandler) pendingHandler = Promise.resolve().then(() => createFirebaseConsole(process.env));
    await (await pendingHandler)(req, res);
  } catch (error) {replyStopped(res, error);}
});
