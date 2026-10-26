'use strict';
// Focused local-only Rules acceptance. No live project, provider or build.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, collection, collectionGroup, getDoc, getDocs, setDoc, updateDoc, deleteDoc } = require('firebase/firestore');
const projectId = 'demo-sideline-cleanup-rules';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8098');
const out = process.argv[2]; assert.ok(out);
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
const result = { passed: false, denied: 0, positiveControls: 0, projectId,
  rulesSha256: crypto.createHash('sha256').update(rules).digest('hex'), cases: [], liveRequests: 0, builds: 0, automaticRetries: 0 };
const save = () => fs.writeFileSync(path.join(out, 'rules-result.json'), JSON.stringify(result, null, 2));
fs.writeFileSync(path.join(out, 'rules-started.json'), '{}', {flag:'wx'});
async function main() {
  let environment;
  try {
    environment = await initializeTestEnvironment({projectId, firestore:{host:'127.0.0.1',port:8098,rules}});
    const paths = ['coachAiInternalConfig/cleanupOperators',
      'coachAiInternalConfig/cleanupReviews/items/11111111-1111-4111-8111-111111111111',
      'coachAiInternalConfig/cleanupReviews/items/11111111-1111-4111-8111-111111111111/privateEvidence/fixture'];
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const p of paths) await setDoc(doc(db,p), {status:'approved',reviewerUid:'fixture_primary',primaryUid:'fixture_primary',enabled:true});
      await setDoc(doc(db,'appConfig/cleanup_rules_control'), {fixture:true});
    });
    const identities = [
      ['anonymous', environment.unauthenticatedContext()],
      ['parent', environment.authenticatedContext('fixture_parent',{firebase:{sign_in_provider:'password'}})],
      ['forged_admin_claims', environment.authenticatedContext('fixture_other',{admin:true,moderator:true,aiCoachBillingTester:true})],
      ['pinned_primary_mfa', environment.authenticatedContext('fixture_primary',{email:'info@joinsidelinesocial.com',email_verified:true,firebase:{sign_in_provider:'password',sign_in_second_factor:'totp'}})],
    ];
    const clients = new Map();
    for (const [name,context] of identities) {
      const db = context.firestore();
      clients.set(name, db);
      for (const p of paths) {
        await assertFails(getDoc(doc(db,p))); result.denied++;
        await assertFails(setDoc(doc(db,p+'/attempts/new'),{approved:true})); result.denied++;
        await assertFails(setDoc(doc(db,p),{approved:true})); result.denied++;
        await assertFails(updateDoc(doc(db,p),{status:'consumed'})); result.denied++;
        await assertFails(deleteDoc(doc(db,p))); result.denied++;
      }
      for (const p of ['coachAiInternalConfig','coachAiInternalConfig/cleanupReviews/items']) {
        await assertFails(getDocs(collection(db,p))); result.denied++;
      }
      await assertFails(getDocs(collectionGroup(db,'items'))); result.denied++;
      result.cases.push({identity:name,denied:18}); save();
    }
    await assertSucceeds(getDoc(doc(clients.get('parent'),'appConfig/cleanup_rules_control')));
    result.positiveControls++;
    await environment.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      for (const p of paths) assert.equal((await getDoc(doc(db,p))).data().status,'approved');
    });
    result.positiveControls++; result.passed=true; save();
    console.log(JSON.stringify(result));
  } finally { if(environment) await environment.cleanup(); }
}
main().catch(error=>{result.error=String(error.code||error.message);save();console.error(result.error);process.exitCode=1;});
