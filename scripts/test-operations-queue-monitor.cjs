'use strict';
const assert=require('node:assert/strict');
const {specs,query,summarize,workflow,caughtFilter}=require('./operations/queue-monitor.cjs');
const now=Date.parse('2026-10-12T21:00:00Z');
const row=(age,field='updatedAt')=>({document:{fields:{[field]:{timestampValue:new Date(now-age*1000).toISOString()}}}});
assert.deepEqual(summarize([{readTime:new Date(now).toISOString()}],now),{pending:0,stale:0,invalid:0,overflow:0});
assert.deepEqual(summarize([row(599),row(600),row(3600,'createdAt')],now),{pending:3,stale:2,invalid:0,overflow:0});
assert.equal(summarize([row(-61),{document:{fields:{}}},{document:{fields:{updatedAt:{timestampValue:'bad'}}}}],now).invalid,3);
assert.equal(summarize(Array.from({length:501},()=>row(0)),now).overflow,1);
for(const s of specs){const q=query(s).structuredQuery;assert.equal(q.limit,501);assert.deepEqual(q.select.fields.map(x=>x.fieldPath),['createdAt','updatedAt']);assert.ok(!q.where.fieldFilter.value.arrayValue.values.some(v=>['completed','providerAccepted','captured'].includes(v.stringValue)));}
const definition=workflow(),calls=[];function walk(v){if(!v||typeof v!=='object')return;assert.ok(!Object.hasOwn(v,'retry'),'No automatic retry policy');if(v.call)calls.push(v);for(const x of Object.values(v))walk(x);}walk(definition);
assert.equal(calls.length,6);for(const c of calls){assert.equal(c.call,'http.post');assert.ok(c.args.url.endsWith('/documents:runQuery')||c.args.url==='https://logging.googleapis.com/v2/entries:write');assert.equal(c.args.timeout,30);}
assert.equal(calls.filter(c=>c.args.url.endsWith('/documents:runQuery')).length,4);
assert.ok(!JSON.stringify(definition).includes('googleapis.firestore'),'Use HTTP to avoid connector default retries');
assert.ok(!JSON.stringify(definition).includes('evidenceSnapshot'));assert.ok(caughtFilter.includes('jsonPayload.category="ambiguous"'));
console.log('Operations observer: boundary ages, unknown timestamps, saturation, projections, terminal exclusion and no-write/no-retry transport passed.');
