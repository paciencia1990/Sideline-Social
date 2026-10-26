'use strict';
// Execute the emitted step graph with synthetic HTTP responses. This is not a
// replacement for Google's workflow compiler or cloud identity verification.
const assert=require('node:assert/strict'),vm=require('node:vm');
const {workflow,summarize}=require('./operations/queue-monitor.cjs');
const now=Date.parse('2026-10-12T21:00:00Z'),document=age=>({document:{fields:{createdAt:{timestampValue:new Date(now-age*1000).toISOString()}}}});
async function execute(responses,failAt){
 const ctx={sys:{now:()=>now/1000},map:{get:(o,keys)=>{for(const k of Array.isArray(keys)?keys:[keys]){o=o?.[k];}return o??null;}},time:{parse:s=>{const n=Date.parse(s)/1000;if(!Number.isFinite(n))throw Error('bad_time');return n;}},defaultValue:(a,b)=>a??b,choose:(a,b,c)=>a?b:c};
 const logs=[];let queryIndex=0,result;
 const ev=v=>{if(typeof v==='string'&&v.startsWith('${'))return vm.runInNewContext(v.slice(2,-1).replaceAll('default(','defaultValue(').replaceAll('if(','choose('),ctx,{timeout:200});if(Array.isArray(v))return v.map(ev);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,ev(x)]));return v;};
 async function steps(list){for(const item of list){const s=Object.values(item)[0];if(s.assign){for(const a of s.assign){const [k,v]=Object.entries(a)[0],ks=k.split('.');let o=ctx;while(ks.length>1)o=o[ks.shift()];o[ks[0]]=ev(v);}}else if(s.call){assert.equal(s.call,'http.post');const a=ev(s.args);if(a.url.endsWith('documents:runQuery')){if(queryIndex===failAt)throw Error('synthetic_secret_must_not_leak');ctx[s.result]={body:responses[queryIndex++]??[{readTime:'now'}]};}else {logs.push(a.body);ctx[s.result]={body:{}};}}else if(s.for){for(const row of ev(s.for.in)){ctx[s.for.value]=row;await steps(s.for.steps);}}else if(s.switch){for(const c of s.switch){assert.ok(!c.assign);if(ev(c.condition)){await steps(c.steps||[]);break;}}}else if(s.try){try{await steps(s.try.steps);}catch(e){ctx[s.except.as]=e;await steps(s.except.steps);}}else if(s.raise)throw Error(ev(s.raise));else if(s.return)result=ev(s.return);else throw Error('unknown_step');}}
 let error;try{await steps(workflow().main.steps);}catch(e){error=e.message;}return {result,logs,error,queryIndex};
}
(async()=>{
 const rows=[document(599),document(600),document(900),document(-70),{document:{fields:{}}}],r=await execute([rows]);
 const want=summarize(rows,now);for(const [key,value]of Object.entries(want))assert.equal(r.result['requests_'+key],value);assert.equal(r.logs[0].entries[0].severity,'WARNING');assert.equal(r.logs[0].entries[0].jsonPayload.issueCount,4);
 const empty=await execute([]);assert.equal(empty.logs[0].entries[0].severity,'INFO');assert.equal(empty.queryIndex,4);
 const full=await execute([Array.from({length:501},()=>document(1))]);assert.equal(full.result.requests_overflow,1);
 const fail=await execute([],1);assert.equal(fail.error,'queue_probe_failed');assert.equal(fail.logs.length,1);assert.equal(fail.queryIndex,1);assert.ok(!JSON.stringify(fail.logs).includes('synthetic_secret'));
 const malformed=await execute([[{document:{fields:{updatedAt:{timestampValue:'bad'}}}}]]);assert.equal(malformed.error,'queue_probe_failed');
 console.log('Emitted workflow synthetic execution passed: all queues, stale/unknown/saturated states, redacted failure and no repeated query.');
})().catch(e=>{console.error(e);process.exitCode=1;});
