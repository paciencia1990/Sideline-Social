'use strict';
const assert=require('node:assert/strict');
const eas=require('../eas.json');
const {resolveStagingNativeFirebaseTarget:target}=require('../config/firebaseNativeConfig');
const profile=eas.build['coach-ai-billing-beta'];
assert.equal(profile.extends,'external-testing');
assert.equal(profile.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED,'true');
assert.equal(eas.build['external-testing'].env.EXPO_PUBLIC_FIREBASE_ENVIRONMENT,'staging');
for(const platform of ['ios','android']){
 assert.equal(target({externalTestingBuild:true,easBuildProfile:'coach-ai-billing-beta',easBuildPlatform:platform}),platform);
 assert.equal(target({externalTestingBuild:true,easBuildProfile:'external-testing',easBuildPlatform:platform}),platform);
}
assert.throws(()=>target({externalTestingBuild:true,easBuildProfile:'unapproved-profile',easBuildPlatform:'android'}),/conflicting/);
assert.throws(()=>target({externalTestingBuild:true,easBuildProfile:'coach-ai-production-beta',easBuildPlatform:'ios'}),/conflicting/);
assert.throws(()=>target({stagingAcceptanceBuild:true,easBuildProfile:'coach-ai-billing-beta',easBuildPlatform:'android'}),/conflicting/);
assert.throws(()=>target({externalTestingBuild:true,easBuildProfile:'coach-ai-billing-beta',easBuildPlatform:'web'}),/Android and iOS/);
assert.throws(()=>target({externalTestingBuild:true,easBuildProfile:'coach-ai-billing-beta'}),/incomplete/);
assert.equal(eas.build['external-testing'].env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED,undefined);
assert.equal(eas.build.production.env.EXPO_PUBLIC_COACH_AI_BILLING_ENABLED,undefined);
console.log(JSON.stringify({passed:true,cases:9,builds:0,networkRequests:0}));
