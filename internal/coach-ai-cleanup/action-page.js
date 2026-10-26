'use strict';
(function(){
 const $=id=>document.getElementById(id),session=window.sidelineCleanupSession,view=CleanupStaffView;
 if(location.search||location.hash||!session){$('actionStatus').textContent='Private action session unavailable. No request was sent.';return;}
 let picker=null,controller=null,scan=null,items=[],selected=null,epoch=0,selectionBusy=false,result=null,observedAt=null;
 const active=()=>session.isActive();
 function checkedFacts(){return Object.fromEntries(CleanupActionClient.FACTS.map(key=>[key,$('fact_'+key).value==='true'?true:$('fact_'+key).value==='false'?false:null]));}
 function clear(){
  epoch++;picker=null;controller=null;scan=null;items=[];selected=null;selectionBusy=false;result=null;observedAt=null;
  for(const id of ['caseChoices','caseSummary'])$(id).replaceChildren();
  for(const id of ['pickerHealth','caseDetail','systemEvidence','actionImpact','actionReceipt','receiptReference'])$(id).textContent='';
  for(const key of CleanupActionClient.FACTS)$('fact_'+key).value='';
  for(const id of ['approveConfirm','executeConfirm','expiryConfirm'])$(id).checked=false;
  $('reviewBackupsClear').value='';$('journalText').value='';$('operatorName').value='';
  $('journalStatus').textContent='The journal is not updated automatically.';$('actionStatus').textContent='Sign in privately, then load the cases when ready.';
 }
 function drawPicker(){view.renderCases(document,$('caseChoices'),items,{choose:selectCase,blocked:selectionBusy||!active()||!scan||scan.health.health==='unknown'||picker?.state().prepared||picker?.state().stopped});}
 function render(){
  const p=picker?.state(),s=controller?.state(),ready=active()&&!selectionBusy&&!s?.busy;
  $('loadCases').disabled=!ready||!picker||p.listed||p.stopped;
  $('selectedSection').hidden=!selected;
  $('inspectCase').disabled=!ready||s?.phase!=='ready'||s.terminal;
  $('draftCase').disabled=!ready||s?.phase!=='inspected'||s.terminal||s.manifest.operation==='expire_review';
  $('factsSection').hidden=!s?.draft;$('actionFacts').disabled=!ready||s?.phase!=='drafted'||s.terminal;
  const facts=checkedFacts(),evidenceReady=s&&view.factsReady(s.manifest.operation,facts);
  $('approveCase').disabled=!ready||s?.phase!=='drafted'||s.terminal||!evidenceReady||!$('approveConfirm').checked;
  $('factsHelp').textContent=s?.phase==='drafted'&&!evidenceReady?'Evidence is missing or unconfirmed. Ask the technical operator for help; no action is authorized.':'Review the supporting evidence for this exact action.';
  $('executionSection').hidden=!s||s.manifest.operation==='expire_review'||!['approved','finished'].includes(s.phase);
  $('execute').disabled=!ready||s?.phase!=='approved'||s.terminal||!$('executeConfirm').checked;
  const expiry=s?.manifest.operation==='expire_review'&&s.phase!=='ready';
  $('reviewExpirySection').hidden=!expiry;
  const review=selected?.records.find(r=>r.kind==='reviews'),unused=review?.status==='approved';
  $('expiryHelp').textContent=unused?'This is normal expiry of an unused approval after its lifetime. It does not remove 90-day customer records; Not verified is allowed for backup clearance here.':'This is an old retained approval receipt. Verify backup/retention clearance and related work before removal.';
  const backup=$('reviewBackupsClear').value,backupAllowed=backup==='true'||unused&&backup==='false';
  $('expireReview').disabled=!ready||!expiry||s.phase!=='inspected'||s.terminal||!backupAllowed||!$('expiryConfirm').checked;
  $('reconcileCase').disabled=!ready||!s?.terminal||s.reconcileAttempted;
  $('copyJournal').disabled=!ready||!selected;
 }
 function connect(){
  if(!active()){clear();render();return;}
  if(!picker)picker=CleanupActionClient.createPicker(CleanupActionClient.createTransport({origin:location.origin,getToken:()=>session.getToken(),fetch:window.fetch.bind(window)}));
  render();
 }
 $('loadCases').onclick=async()=>{
  if(!active()||!picker||selectionBusy||picker.state().listed)return;
  const token=epoch,p=picker;selectionBusy=true;render();
  try{
   const answer=await p.list();if(token!==epoch||!active())return;
   items=view.cases(answer.records,answer.checkedAtMs);scan=answer;observedAt=answer.checkedAtMs;
   $('pickerHealth').textContent=view.healthText(scan,items);$('actionStatus').textContent='Cases read. No cleanup action has been requested.';drawPicker();
  }catch{if(token===epoch&&active()){$('pickerHealth').textContent='Case list unavailable or incomplete. Stop and ask for technical help; no empty result is established.';$('caseChoices').replaceChildren();}}
  finally{if(token===epoch&&active()){selectionBusy=false;drawPicker();render();}}
 };
 async function selectCase(item){
  if(!active()||!picker||selectionBusy||!scan||scan.health.health==='unknown'||picker.state().prepared||picker.state().stopped||!item.operation)return;
  const token=epoch,p=picker;selectionBusy=true;drawPicker();render();
  try{
   const answer=await p.prepare({targetKind:item.kind,key:item.key,operation:item.operation});
   if(token!==epoch||!active())return;
   controller=CleanupActionClient.createController(CleanupActionClient.createTransport({origin:location.origin,getToken:()=>session.getToken(),fetch:window.fetch.bind(window)}));
   controller.load(answer.manifest);
   selected={...item,records:answer.records,checkedAtMs:answer.checkedAtMs};observedAt=answer.checkedAtMs;
   view.renderCases(document,$('caseSummary'),[selected],{blocked:true});
   $('actionImpact').textContent=view.impact(answer.manifest.operation);
   $('systemEvidence').textContent='The server read this exact case and prepared its current version at '+view.when(observedAt)+'. Its record/date/hold checks permitted preparation only. Supporting evidence and final server checks are still required.';
   $('actionStatus').textContent='Case prepared automatically. No review was approved and no cleanup action was performed.';
   $('selectedSection').hidden=false;$('caseHeading').focus();
  }catch{if(token===epoch&&active())$('actionStatus').textContent='This case could not be prepared. It may have changed or need further verification. Stop and ask for technical review; no cleanup action was sent.';}
  finally{if(token===epoch&&active()){selectionBusy=false;drawPicker();render();}}
 }
 async function request(step,payload={}){
  if(!active()||!controller||controller.state().busy||controller.state().terminal&&step!=='reconcile'||step==='reconcile'&&controller.state().reconcileAttempted)return;
  const token=epoch,c=controller;
  try{
   const promise=c.call(step,payload);render();const answer=await promise;
   if(token!==epoch||!active()||c!==controller)return;
   observedAt=Date.now();
   if(step==='inspect'){$('caseDetail').textContent='The current case matches the prepared version. Review the evidence and impact before proceeding.';$('actionStatus').textContent='Current case checked. No action performed.';}
   else if(step==='draft'){$('caseDetail').textContent='Evidence review is ready. No answers are selected for you.';$('actionStatus').textContent='Review prepared. No approval or action submitted.';}
   else{
    result=step==='reconcile'?view.reconciliation(c.state().manifest,answer):answer.status;
    $('actionReceipt').textContent=view.outcome(result)+(step==='reconcile'?' This was a read-only status check; no action was resubmitted.':'');
    $('actionStatus').textContent=view.outcome(result);
   }
   const s=c.state();$('receiptReference').textContent='Restricted case reference: '+selected.id+(s.draft?' · Review receipt: '+s.draft.reviewId:s.manifest.operation==='expire_review'?' · Review reference: '+s.manifest.key:'');
  }catch{if(token===epoch&&active()&&c===controller){result='unconfirmed';$('actionStatus').textContent='Request stopped without retry. The case may have changed or the result may be unclear. Use the single status-only check, then ask for technical help.';$('actionReceipt').textContent=view.outcome(result);}}
  finally{if(token===epoch&&active()&&c===controller){for(const id of ['approveConfirm','executeConfirm','expiryConfirm'])$(id).checked=false;render();}}
 }
 $('inspectCase').onclick=()=>request('inspect');
 $('draftCase').onclick=()=>request('draft');
 $('approveCase').onclick=()=>{const facts=checkedFacts();if(!controller||!view.factsReady(controller.state().manifest.operation,facts)||!$('approveConfirm').checked)return;return request('approve',{facts,confirmed:true});};
 $('execute').onclick=()=>{if($('executeConfirm').checked)return request('execute',{confirmed:true});};
 $('expireReview').onclick=()=>{if(!$('expireReview').disabled)return request('expire_review',{backupsClear:$('reviewBackupsClear').value==='true',confirmed:$('expiryConfirm').checked});};
 $('reconcileCase').onclick=()=>request('reconcile');
 for(const id of ['approveConfirm','executeConfirm','expiryConfirm'])$(id).onchange=render;
 $('reviewBackupsClear').onchange=()=>{$('expiryConfirm').checked=false;render();};
 for(const key of CleanupActionClient.FACTS)$('fact_'+key).onchange=()=>{$('approveConfirm').checked=false;render();};
 $('copyJournal').onclick=async()=>{
  if(!active()||!selected||!controller||controller.state().busy)return;
  const token=epoch,s=controller.state();
  try{
   const text=view.journal({operator:$('operatorName').value,checkedAtMs:observedAt,items:[selected],complete:!!scan&&scan.health.health!=='unknown',item:selected,result,reviewId:s.draft?.reviewId??(s.manifest.operation==='expire_review'?s.manifest.key:null)});
   $('journalText').value=text;
   if(window.navigator?.clipboard?.writeText){await window.navigator.clipboard.writeText(text);if(token===epoch&&active())$('journalStatus').textContent='Copied. Paste into the existing restricted journal.';}
   else{$('journalText').focus();$('journalText').select();$('journalStatus').textContent='Copy the displayed entry into the existing restricted journal.';}
  }catch{if(token===epoch&&active())$('journalStatus').textContent='Enter the actual operator name or initials. If copying is unavailable, copy the displayed entry manually.';}
 };
 session.subscribe(connect);connect();
})();
