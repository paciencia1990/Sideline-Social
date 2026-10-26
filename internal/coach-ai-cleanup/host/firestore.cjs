'use strict';
// Restricted Firestore REST port for the reviewed workflow. No SDK RPC retries.
function createFirestorePort({projectId,send,getAccessToken,budget,Timestamp,emulatorOrigin}){
 if(projectId!=='sideline-social-staging-2026'&&!/^demo-[a-z0-9-]+$/.test(projectId))throw Error('cleanup_project_mismatch');
 if(emulatorOrigin&&(!projectId.startsWith('demo-')||!/^http:\/\/127\.0\.0\.1:\d+$/.test(emulatorOrigin)))throw Error('cleanup_emulator_boundary');
 const base=`${emulatorOrigin||'https://firestore.googleapis.com'}/v1/projects/${projectId}/databases/(default)/documents`,name=`projects/${projectId}/databases/(default)/documents`;
 const roots=new Set(['coachAiInternalConfig','coachAiBillingEnrollments','coachAiBillingDeletionQueue','coachAiBillingEvents','users','publicUserProfiles','coachAiBillingAccounts','coachAiPaidRequests','coachAiBillingRateLimits','coachAiBillingVerificationRates','coachAiRequests']);
 function valid(p,document){if(typeof p!=='string'||p.length>1024||!p.split('/').every(s=>/^[A-Za-z0-9_-]+$/.test(s))||!roots.has(p.split('/')[0])||p.split('/').length%2!==(document?0:1))throw Error('cleanup_firestore_path');return p;}
 function encode(v){
  if(v===null)return {nullValue:null};if(typeof v==='string')return {stringValue:v};if(typeof v==='boolean')return {booleanValue:v};
  if(typeof v==='number'&&Number.isFinite(v))return Number.isSafeInteger(v)?{integerValue:String(v)}:{doubleValue:v};
  if(v&&typeof v.toMillis==='function'){const seconds=v.seconds,nanos=v.nanoseconds;if(!Number.isInteger(seconds)||!Number.isInteger(nanos))throw Error('cleanup_timestamp');return {timestampValue:new Date(seconds*1000).toISOString().replace('.000Z','.'+String(nanos).padStart(9,'0')+'Z')};}
  if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
  if(v&&typeof v==='object')return {mapValue:{fields:fields(v)}};throw Error('cleanup_firestore_value');
 }
 function fields(v){return Object.fromEntries(Object.entries(v).map(([k,value])=>[k,encode(value)]));}
 function decode(v){
  if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;
  if('integerValue'in v){const n=Number(v.integerValue);if(!Number.isSafeInteger(n))throw Error('cleanup_integer');return n;}
  if('doubleValue'in v){if(typeof v.doubleValue!=='number'||!Number.isFinite(v.doubleValue))throw Error('cleanup_number');return v.doubleValue;}
  if('timestampValue'in v){const m=/^(.*?)(?:\.(\d{1,9}))?Z$/.exec(v.timestampValue);if(!m)throw Error('cleanup_timestamp');return new Timestamp(Date.parse(m[1]+'Z')/1000,Number((m[2]||'').padEnd(9,'0')));}
  if('arrayValue'in v)return (v.arrayValue.values||[]).map(decode);if('mapValue'in v)return fromFields(v.mapValue.fields||{});
  if('referenceValue'in v)return {referenceValue:v.referenceValue};if('bytesValue'in v)return {bytesValue:v.bytesValue};if('geoPointValue'in v)return {geoPointValue:v.geoPointValue};
  throw Error('cleanup_unknown_firestore_value');
 }
 function fromFields(v){return Object.fromEntries(Object.entries(v).map(([k,value])=>[k,decode(value)]));}
 async function rpc(suffix,body){budget.check();const token=await getAccessToken();budget.check();const r=await send(base+suffix,{method:'POST',headers:{authorization:'Bearer '+token},body});budget.check();if(r.status!==200)throw Error('cleanup_firestore_stopped');return r.value;}
 function snapshot(reference,document){return {exists:!!document,id:reference.id,ref:reference,data:()=>document?fromFields(document.fields||{}):undefined};}
 function doc(p){valid(p,true);const ref={path:p,id:p.split('/').at(-1),get:()=>get(ref)};return ref;}
 function collection(p,filters=[],selected=null,bound=500){valid(p,false);return {path:p,query:true,filters,selected,bound,where(field,op,value){if(!/^[A-Za-z0-9_.]+$/.test(field)||!['==','array-contains'].includes(op))throw Error('cleanup_query');return collection(p,[...filters,{field,op,value}],selected,bound);},select(...names){if(!names.every(n=>/^[A-Za-z0-9_.]+$/.test(n)))throw Error('cleanup_projection');return collection(p,filters,names,bound);},limit(n){if(!Number.isInteger(n)||n<1||n>501)throw Error('cleanup_query_limit');return collection(p,filters,selected,n);},get(){return get(this);}};}
 async function get(ref,transaction){
  if(ref.query){valid(ref.path,false);const parts=ref.path.split('/'),id=parts.pop(),parent=parts.join('/');
   const query={from:[{collectionId:id}],limit:ref.bound};if(ref.selected)query.select={fields:ref.selected.map(fieldPath=>({fieldPath}))};
   const filters=ref.filters.map(f=>({fieldFilter:{field:{fieldPath:f.field},op:f.op==='=='?'EQUAL':'ARRAY_CONTAINS',value:encode(f.value)}}));
   if(filters.length)query.where=filters.length===1?filters[0]:{compositeFilter:{op:'AND',filters}};
   const rows=await rpc((parent?'/'+parent:'')+':runQuery',{structuredQuery:query,...(transaction?{transaction}:{})});if(!Array.isArray(rows))throw Error('cleanup_query_response');
   const docs=rows.filter(r=>r.document).map(r=>{if(!r.document.name.startsWith(name+'/'))throw Error('cleanup_document_response');const ref=doc(r.document.name.slice(name.length+1));return snapshot(ref,r.document);});return {docs,size:docs.length,empty:docs.length===0};
  }
  valid(ref.path,true);const rows=await rpc(':batchGet',{documents:[name+'/'+ref.path],...(transaction?{transaction}:{})});
  if(!Array.isArray(rows)||rows.length!==1||!(rows[0].found?.name===name+'/'+ref.path||rows[0].missing===name+'/'+ref.path))throw Error('cleanup_document_response');return snapshot(ref,rows[0].found);
 }
 async function runTransaction(fn,options){
  if(options?.maxAttempts!==1)throw Error('cleanup_single_transaction_required');budget.check();
  const begun=await rpc(':beginTransaction',{options:{readWrite:{}}});if(typeof begun.transaction!=='string'||!begun.transaction)throw Error('cleanup_transaction_response');
  const writes=[];let writing=false;
  function write(ref,data,kind){budget.check();valid(ref.path,true);writing=true;
   // The port cannot write profiles, ordinary app data or billing consumption.
   if(!/^(coachAiBillingEnrollments|coachAiBillingDeletionQueue|coachAiBillingEvents)\/[A-Za-z0-9_-]+$/.test(ref.path)&&!/^coachAiInternalConfig\/cleanupReviews\/items\/[A-Za-z0-9_-]+$/.test(ref.path))throw Error('cleanup_write_path');
   const n=name+'/'+ref.path;if(kind==='delete')writes.push({delete:n});else {const value={update:{name:n,fields:fields(data)}};if(kind==='create')value.currentDocument={exists:false};if(kind==='update'){value.currentDocument={exists:true};value.updateMask={fieldPaths:Object.keys(data)};}writes.push(value);}return tx;
  }
  const tx={get(ref){if(writing)throw Error('cleanup_read_after_write');return get(ref,begun.transaction);},set:(r,d)=>write(r,d,'set'),create:(r,d)=>write(r,d,'create'),update:(r,d)=>write(r,d,'update'),delete:r=>write(r,null,'delete')};
  // On any failure, stop. Never resend commit or automatically rollback/repair.
  // An uncommitted server transaction expires; an unclear commit needs reconciliation.
  const result=await fn(tx);budget.check();await rpc(':commit',{transaction:begun.transaction,writes});return result;
 }
 return {projectId,doc,collection,runTransaction,codec:{encode,fields,decode}};
}
module.exports={createFirestorePort};
