'use strict';
const functions = require('firebase-functions/v1');
const {createFirebaseObserver} = require('./observer.cjs');
const {replyStopped} = require('./request.cjs');
const {PROJECT, REGION, OBSERVER} = require('./config.cjs');

let pendingHandler;
exports[OBSERVER] = functions.region(REGION).runWith({timeoutSeconds: 30, memory: '512MB',
  minInstances: 0, maxInstances: 1, invoker: 'private',
  serviceAccount: `coach-ai-cleanup-observer@${PROJECT}.iam.gserviceaccount.com`,
}).https.onRequest(async (req, res) => {
  try {
    if (!pendingHandler) pendingHandler = Promise.resolve().then(() => createFirebaseObserver(process.env, {
      log: value => functions.logger.info('coach_ai_cleanup_observer', value),
    }));
    await (await pendingHandler)(req, res);
  } catch (error) {replyStopped(res, error);}
});
