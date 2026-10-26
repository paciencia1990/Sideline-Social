'use strict';
const {createJsonTransport,metadataCredential}=require('./transport.cjs');
const {createFirestorePort}=require('./firestore.cjs');
const {createAuthPort,CERTS}=require('./auth.cjs');
// Dependency injection only. No default credentials, listener, env lookup or live action.
function createCleanupRuntime({projectId,origin,operatorPins,verificationKey,Timestamp,createAdapter,requestImpl}){
 if(projectId!=='sideline-social-staging-2026'&&!/^demo-[a-z0-9-]+$/.test(projectId))throw Error('cleanup_project_mismatch');
 const pins=Object.freeze({...operatorPins});if(![pins.primaryUid,pins.backupUid].every(v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v))||pins.primaryUid===pins.backupUid)throw Error('cleanup_operator_pins_required');
 return budget=>{
  const authRoot=`/v1/projects/${projectId}/accounts`,dbRoot=`/v1/projects/${projectId}/databases/(default)/documents`;
  const send=createJsonTransport({budget,requestImpl,allow:(u,method)=>
   u.href===CERTS&&method==='GET'||u.href==='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'&&method==='GET'
   ||u.protocol==='https:'&&u.hostname==='identitytoolkit.googleapis.com'&&(u.pathname===authRoot+':lookup'&&method==='POST'||u.pathname===authRoot+':batchGet'&&u.search==='?maxResults=1000'&&method==='GET')
   ||u.protocol==='https:'&&u.hostname==='firestore.googleapis.com'&&u.pathname.startsWith(dbRoot)&&method==='POST'&&/:(batchGet|beginTransaction|commit|runQuery)$/.test(u.pathname)&&!u.search
   ||u.protocol==='https:'&&u.hostname==='api.revenuecat.com'&&method==='GET'&&/^\/v2\/projects\/projec5f2a61\/customers(?:\/[A-Za-z0-9_-]{1,128})?$/.test(u.pathname)&&(!u.search||u.search==='?limit=1')});
  const getAccessToken=metadataCredential(send,budget),db=createFirestorePort({projectId,send,getAccessToken,budget,Timestamp}),auth=createAuthPort({projectId,send,getAccessToken,budget});
  const fetcher=async(url,options)=>{budget.check();if(options?.method!=='GET'||options?.redirect!=='error'||options.signal?.aborted)throw Error('cleanup_vendor_request');const r=await send(url,{method:'GET',headers:options.headers});return new Response(JSON.stringify(r.value),{status:r.status});};
  return createAdapter({db,auth,origin,operatorPins:pins,verificationKey,fetcher});
 };
}
module.exports={createCleanupRuntime};
