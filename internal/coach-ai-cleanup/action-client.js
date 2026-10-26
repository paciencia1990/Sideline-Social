(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CleanupActionClient=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const FACTS=Object.freeze(['ordinaryCleanupComplete','aliasesReconciled','sdkWorkSettled','holdsClear','backupsClear','identityReuseBlocked','relatedWorkClear']);
 const KEY=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 function manifest(raw,now){
  const data=typeof raw==='string'&&raw.length<=4096?JSON.parse(raw):raw;
  const names=['schemaVersion','operation','targetKind','key','expectedRevision','preparedAtMs','attemptLimit'];
  if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==names.length||Object.keys(data).some(k=>!names.includes(k))
   ||data.schemaVersion!==1||data.attemptLimit!==1||!['close','expire_cleanup','expire_event','expire_review'].includes(data.operation)
   ||data.targetKind!==(data.operation==='expire_review'?'review':data.operation==='expire_event'?'event':'cleanup')
   ||typeof data.key!=='string'||!(data.targetKind==='review'?ID:KEY).test(data.key)||typeof data.expectedRevision!=='string'||!KEY.test(data.expectedRevision)
   ||!Number.isSafeInteger(data.preparedAtMs)||data.preparedAtMs<=0||data.preparedAtMs>now||now-data.preparedAtMs>900000)throw Error('invalid_case');
  return Object.freeze(Object.fromEntries(names.map(k=>[k,data[k]])));
 }
 function facts(value){
  if(!value||Object.keys(value).length!==FACTS.length||FACTS.some(k=>typeof value[k]!=='boolean'))throw Error('facts_required');
  return Object.fromEntries(FACTS.map(k=>[k,value[k]]));
 }
 function createTransport({origin,getToken,fetch}){
  const url=new URL('/internal/coach-ai-cleanup-action',origin);
  if(url.origin!==origin||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('invalid_origin');
  return async body=>{
   const token=await getToken();if(typeof token!=='string'||!token||/\s/.test(token))throw Error('session_required');
   const response=await fetch(url.href,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',
    headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
   const value=await response.json();if(!response.ok)throw Error('request_stopped');return value;
  };
 }
 function createController(send,{now=Date.now}={}){
  let selected=null,draft=null,phase='empty',busy=false,terminal=false,uncertain=false,last=null;
  const attempted=new Set();
  function state(){return {manifest:selected,draft,phase,busy,terminal,uncertain,last,reconcileAttempted:attempted.has('reconcile')};}
  return {state,load(raw){if(selected||busy||terminal)throw Error('case_already_loaded');selected=manifest(raw,now());phase='ready';return state();},
   async call(step,payload={}){
    if(busy)throw Error('request_in_progress');
    if(!selected||!['inspect','draft','approve','execute','expire_review','reconcile'].includes(step))throw Error('invalid_step');
    if(attempted.has(step)||step!=='reconcile'&&terminal)throw Error('already_attempted');
    let body={manifest:selected};
    if(step==='reconcile'){
     if(!terminal)throw Error('reconciliation_not_needed');
     body={...body,action:'detail',reconcile:true,...(draft?{reviewId:draft.reviewId}:{})};
    }else if(step==='inspect'){if(phase!=='ready')throw Error('invalid_step');body.action='detail';}
    else if(step==='draft'){if(phase!=='inspected'||selected.operation==='expire_review')throw Error('invalid_step');body.action='draft';}
    else if(step==='approve'){
     if(phase!=='drafted'||payload.confirmed!==true)throw Error('confirmation_required');
     body={...body,action:'approve',draft,facts:facts(payload.facts),confirmed:true};
    }else if(step==='execute'){
     if(phase!=='approved'||payload.confirmed!==true)throw Error('confirmation_required');
     body={...body,action:'execute',reviewId:draft.reviewId,confirmed:true};
    }else{
     if(phase!=='inspected'||selected.operation!=='expire_review'||payload.confirmed!==true||typeof payload.backupsClear!=='boolean')throw Error('confirmation_required');
     body={...body,action:'expire_review',clearance:{backupsClear:payload.backupsClear},confirmed:true};
    }
    attempted.add(step);busy=true;
    try{
     const answer=await send(body);
     if(step==='inspect'&&answer?.revision!==selected.expectedRevision)throw Error('response_scope');
     if(step==='draft'){
      const d=answer?.draft;
      if(!d||Object.keys(d).length!==5||d.operation!==selected.operation||d.key!==selected.key||d.revision!==selected.expectedRevision
       ||typeof d.reviewId!=='string'||!ID.test(d.reviewId)||!Number.isSafeInteger(d.draftedAtMs))throw Error('response_scope');
      draft=Object.freeze({...d});
     }
     if(step==='approve'&&answer?.status!=='approved')throw Error('response_scope');
     if(['execute','expire_review'].includes(step)&&!['closed','expired','retained','not_due','absent','already_closed'].includes(answer?.status))throw Error('response_scope');
     last=answer;
     if(step==='inspect')phase='inspected';else if(step==='draft')phase='drafted';else if(step==='approve')phase='approved';
     else if(step!=='reconcile'){phase='finished';terminal=true;}
     return answer;
    }catch{terminal=true;uncertain=true;phase='stopped';throw Error('request_stopped_no_retry');}
    finally{busy=false;}
   }
  };
 }

 // Read-only case selection is separate from the existing one-action controller.
 function createPicker(send,{now=Date.now}={}){
  let busy=false,stopped=false,listed=false,prepared=false;
  const state=()=>({busy,stopped,listed,prepared});
  async function run(kind,payload){
   if(busy)throw Error('request_in_progress');
   if(stopped||prepared||kind==='cases'&&listed||kind==='prepare'&&!listed)throw Error('already_attempted');
   if(kind==='cases')listed=true;else prepared=true;
   busy=true;
   try{
    const answer=await send({action:kind,...payload});
    if(kind==='cases'){
     if(!Array.isArray(answer?.records)||answer.records.length>2500||!Number.isSafeInteger(answer.checkedAtMs)||answer.checkedAtMs<=0||!['healthy','attention','unknown'].includes(answer.health?.health))throw Error('response_scope');
    }else{
     const m=manifest(answer?.manifest,now());
     const expected=m.targetKind==='cleanup'?['fences','queue']:m.targetKind==='event'?['events']:['reviews'];
     if(m.key!==payload.key||m.operation!==payload.operation||m.targetKind!==payload.targetKind||answer.checkedAtMs!==m.preparedAtMs
       ||!Array.isArray(answer.records)||answer.records.length!==expected.length
       ||expected.some(kind=>answer.records.filter(r=>r?.kind===kind&&r.key===m.key&&typeof r.exists==='boolean').length!==1))throw Error('response_scope');
     return {...answer,manifest:m};
    }
    return answer;
   }catch{stopped=true;throw Error('request_stopped_no_retry');}
   finally{busy=false;}
  }
  return {state,list:()=>run('cases',{}),prepare:target=>run('prepare',{targetKind:target.targetKind,key:target.key,operation:target.operation})};
 }
 return {FACTS,parseManifest:manifest,createTransport,createController,createPicker};
});
