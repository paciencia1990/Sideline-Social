'use strict';
process.env.COACH_AI_LOCAL_MEMORY_FIXTURE = 'true';
process.env.GCLOUD_PROJECT = 'demo-sideline-coach-billing';
require('./test-coach-ai-billing-emulator.cjs');
