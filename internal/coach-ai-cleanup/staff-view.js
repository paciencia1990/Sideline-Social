(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CleanupStaffView=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const DAY=86400000,KEY=/^[a-f0-9]{64}$/,ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
 const GROUPS=[['review','Needs review'],['waiting','Waiting for verification'],['retained','No action due yet'],['technical','Technical help needed']];
 const OPERATIONS={close:'Verify completion and close this follow-up',expire_cleanup:'Review removal of old cleanup records',expire_event:'Review removal of an old billing receipt',expire_review:'Review removal of an old approval'};
 const REASONS={retention_hold:'A retention hold needs review.',local_cleanup_incomplete:'App-data removal has not been verified.',reconciliation_incomplete:'Related records still need verification.',vendor_completion_unverified:'Billing-provider removal has not been verified.',closure_unverified:'Completion has not been verified.',backup_dependency:'Backup or recovery dependencies need technical review.',identity_reuse_unverified:'Protection against reuse of the deleted identity needs verification.',local_records_remain:'Related app records may remain.',inventory_limit:'The inventory is incomplete.',event_unresolved:'The billing update remains unresolved.'};
 function date(record,key){const n=record?.dates?.[key];return Number.isSafeInteger(n)&&n>0?n:null;}
 function when(ms){return Number.isSafeInteger(ms)&&ms>0?new Date(ms).toLocaleString('en-US',{timeZone:'America/New_York',timeZoneName:'short'}):'Not established';}
 function cases(records,at){
  if(!Array.isArray(records)||!Number.isSafeInteger(at)||at<=0)throw Error('incomplete_inventory');
  const buckets=new Map();
  for(const r of records){
   if(!r||!['fences','queue','events','reviews','paidRequests'].includes(r.kind)||typeof r.key!=='string'||!(r.kind==='reviews'?ID:KEY).test(r.key)||typeof r.exists!=='boolean')throw Error('incomplete_inventory');
   const kind=['fences','queue'].includes(r.kind)?'cleanup':r.kind==='events'?'event':r.kind==='reviews'?'review':'request',id=kind+':'+r.key;
   if(!buckets.has(id))buckets.set(id,{id,kind,key:r.key,records:[]});
   const item=buckets.get(id);if(item.records.some(old=>old.kind===r.kind))throw Error('duplicate_inventory_record');item.records.push(r);
  }
  return [...buckets.values()].map(item=>{
   let group='technical',title='This case needs technical review',explanation='The available records do not establish a safe next step.',next='Ask the technical operator to inspect this reference.',operation=null,dueAt=null;
   const rows=item.records.filter(r=>r.exists),f=rows.find(r=>r.kind==='fences'),q=rows.find(r=>r.kind==='queue'),r=rows[0];
   const set=(g,t,e,n,op=null,due=null)=>{group=g;title=t;explanation=e;next=n;operation=op;dueAt=due;};
   if(!rows.length)set('retained','Record is no longer present','The status read found no record at this reference.','Record the observation; no action is offered.');
   else if(rows.some(x=>x.held))set('technical','A hold prevents cleanup','This record must be kept while the hold applies.','Ask the authorized technical operator to review the hold; do not remove it here.');
   else if(rows.some(x=>x.reason||x.retentionReviewAt))set('technical','Additional verification is required',rows.map(x=>REASONS[x.reason]).filter(Boolean).join(' ')||'The record has a retention exception.','Ask the technical operator for the supporting evidence and next review date.');
   else if(item.kind==='cleanup'){
    if(f?.status==='deleting'&&q?.status==='closed'){
     const closed=date(f,'closedAt'),due=date(f,'retentionDueAt');
     if(closed&&closed<=at&&date(q,'closedAt')===closed&&due===closed+90*DAY&&date(q,'retentionDueAt')===due){
      if(at>=due)set('review','Old cleanup records are due for review','Completion was recorded and the 90-day review date has arrived.','Review evidence and dependencies before authorizing permanent removal.','expire_cleanup',due);
      else set('retained','Account follow-up is closed','Keep the small completion records until their review date.','No action now. Review when due.',null,due);
     }
    }else if(f?.status==='deleting'&&typeof f.vendorCleanupRequired==='boolean'&&(!q||['processing','deletion_requested','needs_review'].includes(q.status))){
     if(f.vendorCleanupRequired&&!q)set('technical','Deletion tracking is incomplete','A required billing-provider follow-up record is missing.','Ask the technical operator to reconcile this exact case.');
     else if(!f.vendorCleanupRequired&&q)set('technical','Deletion tracking needs reconciliation','These related records do not match the account follow-up type.','Ask the technical operator to reconcile this exact case.');
     else if(!f.localCleanupComplete)set('technical','App-data removal needs verification','A completion marker for ordinary app-data removal is missing.','Ask the technical operator to verify the original deletion; do not repeat it here.');
     else set('waiting','Account-removal follow-up awaits verification','App cleanup has a completion marker. Billing-provider and related-work checks may still be needed.','Obtain the supporting evidence, then review completion. An unconfirmed provider result does not prove data is still present.','close');
    }
   }else if(item.kind==='event'){
    const completed=date(r,'completedAt');
    if(r.status==='completed'&&r.attemptState==='completed'&&completed&&completed<=at){
     dueAt=completed+90*DAY;
     if(at>=dueAt)set('review','Old billing receipt is due for review','The subscription update completed and its 90-day review date has arrived.','Review dependencies before authorizing removal of this receipt.','expire_event',dueAt);
     else set('retained','Subscription update completed','This is a retained receipt, not an unresolved cancellation or payment.','No action now. Keep until its review date.',null,dueAt);
    }else if(['processing','needs_review'].includes(r.status))set('technical','Subscription update is unconfirmed','A billing notification has not reached a confirmed completed state.','Ask for technical investigation of this update. Do not refund, restore or resend it from this page.');
   }else if(item.kind==='review'){
    if(r.status==='approved'){
     const approved=date(r,'approvedAtMs');
     if(approved&&approved<=at){
      dueAt=approved+15*60000;
      if(at>=dueAt)set('review','Unused approval is due for removal','A permission to act was not used within its normal lifetime.','Review expiry of this approval only. This does not delete a customer account.','expire_review',dueAt);
      else set('retained','An unused approval is still within its lifetime','No expiry is due yet.','Leave it unchanged; do not use an old approval for a different case.',null,dueAt);
     }
    }else if(r.status==='consumed'){
     const consumed=date(r,'consumedAt'),due=date(r,'retentionDueAt');
     if(consumed&&consumed<=at&&due===consumed+90*DAY){
      if(at>=due)set('review','Old approval receipt is due for review','The completed action retained this receipt for 90 days.','Verify related records and backup dependencies before removal.','expire_review',due);
      else set('retained','Completed action receipt is being retained','The approval was already used.','No action now. Keep until its review date.',null,due);
     }
    }
   }else if(item.kind==='request'&&r.status==='processing'){
    const start=date(r,'startedAt'),lease=date(r,'leaseUntilMs');
    if(start&&start<=at&&lease&&lease>=start&&lease-start<=5*60000){
     if(at>=lease)set('technical','AI request outcome is uncertain','The original processing window ended without a confirmed final result.','Ask for review of this same request. Do not generate another response or reset allowance here.');
     else set('retained','AI request is still processing','Its recorded processing window has not ended.','No cleanup action now.',null,lease);
    }
   }
   const ages=rows.flatMap(x=>['createdAt','fencedAt','receivedAt','startedAt'].map(k=>date(x,k))).filter(n=>n&&n<=at);
   return {...item,group,title,explanation,next,operation,dueAt,oldestAt:ages.length?Math.min(...ages):null,checkedAtMs:at};
  });
 }
 function counts(items){return Object.fromEntries(GROUPS.map(([key])=>[key,items.filter(c=>c.group===key).length]));}
 function healthText(response,items){
  const c=counts(items);
  if(!response||!['healthy','attention'].includes(response.health?.health))return 'This check is incomplete or uncertain. Do not record an empty or all-clear result. Review the technical-help items.';
  if(!items.length)return 'Check complete: no cleanup items were found.';
  return 'Check complete: '+c.review+' need review; '+c.waiting+' await verification; '+c.technical+' need technical help; '+c.retained+' need no action yet.';
 }
 function factsReady(operation,values){
  const keys=['ordinaryCleanupComplete','aliasesReconciled','sdkWorkSettled','holdsClear','backupsClear','identityReuseBlocked','relatedWorkClear'];
  return keys.every(key=>typeof values[key]==='boolean'&&(operation==='close'&&key==='backupsClear'||values[key]===true));
 }
 function impact(operation){return {
  close:'Verify that the original account-removal follow-up is complete, then keep minimal completion records for 90 days. This does not cancel a subscription or send another provider deletion.',
  expire_cleanup:'Permanently remove only this eligible pair of old cleanup records. Backup, hold and related-work checks still apply.',
  expire_event:'Permanently remove only this eligible completed billing receipt. This does not change a subscription.',
  expire_review:'Permanently remove only this eligible approval or approval receipt. Other customer records are unchanged.'
 }[operation]||'This situation needs technical review; no cleanup action is offered.';}
 function outcome(status){
  return {approved:'Review approved. The action has not been performed.',closed:'Completion verified; this follow-up is closed.',already_closed:'This follow-up was already closed. No second closure was performed.',
   expired:'The eligible record was removed.',retained:'Nothing was removed. A required check or retention condition still prevents the action.',not_due:'Nothing was removed. The record is not due yet.',absent:'The record is no longer present. This observation does not identify who removed it.',
   unconfirmed:'The outcome is unconfirmed. Do not repeat the action; ask for technical help.'}[status]||'The request completed without a confirmed action outcome. Ask for technical review.';
 }
 function journal({operator,checkedAtMs,items=[],complete=false,item=null,result=null,reviewId=null}){
  const name=typeof operator==='string'?operator.trim().replace(/[\r\n\t]/g,' ').slice(0,80):'';
  if(!name)throw Error('operator_name_required');
  const c=counts(items),safeResult=['approved','closed','expired','retained','not_due','absent','already_closed','unconfirmed'].includes(result)?result:null;
  const safeId=typeof reviewId==='string'&&ID.test(reviewId)?reviewId:null;
  return ['Coach AI cleanup check — '+when(checkedAtMs),'Operator: '+name,
   'Check result: '+(complete?(items.length?'complete; see recorded counts':'complete-empty'):'unavailable/incomplete; outstanding work not established'),
   complete?'Cases: '+c.review+' review; '+c.waiting+' waiting; '+c.technical+' technical help; '+c.retained+' no action due yet.':null,
   item?'Restricted case reference: '+item.id:null,item?'Next step: '+item.next:null,
   item?.dueAt?'Review date: '+when(item.dueAt):null,safeResult?'Action observation: '+outcome(safeResult):null,
   safeId?'Review receipt: '+safeId:null,'Keep this entry in the existing Restricted Operations journal.'].filter(Boolean).join('\n');
 }
 function reconciliation(manifest,answer){
  const known=['closed','expired','retained','not_due','absent','already_closed'];
  if(known.includes(answer?.review?.result))return answer.review.result;
  if(Array.isArray(answer?.records)&&answer.records.length&&answer.records.every(r=>r.exists===false))return 'absent';
  return 'unconfirmed';
 }
 function renderCases(document,container,items,{choose=null,note=null,blocked=false,empty='No cases to display.'}={}){
  container.replaceChildren();
  if(!items.length){const p=document.createElement('p');p.textContent=empty;container.append(p);return;}
  for(const [group,label]of GROUPS){
   const selected=items.filter(c=>c.group===group);if(!selected.length)continue;
   const section=document.createElement(group==='retained'?'details':'div');section.className='case-group';
   const heading=document.createElement(group==='retained'?'summary':'h3');heading.textContent=label+' ('+selected.length+')';section.append(heading);
   for(const item of selected){
    const card=document.createElement('article');card.className='case-card';
    const h=document.createElement('h4');h.textContent=item.title;card.append(h);
    for(const line of [item.explanation,'Next step: '+item.next,'Last checked: '+when(item.checkedAtMs),item.oldestAt?'Recorded since: '+when(item.oldestAt):null,item.dueAt?'Review/check date: '+when(item.dueAt):null]){
     if(line){const p=document.createElement('p');p.textContent=line;card.append(p);}
    }
    const details=document.createElement('details'),summary=document.createElement('summary'),ref=document.createElement('p');
    summary.textContent='Restricted case reference';ref.textContent=item.id;details.append(summary,ref);card.append(details);
    if(choose&&item.operation){const button=document.createElement('button');button.textContent='Review this case';button.disabled=blocked;button.onclick=()=>{if(!button.disabled)return choose(item);};card.append(button);}
    else if(item.operation&&!blocked){const link=document.createElement('a');link.href='/action.html';link.textContent='Open guided action page and select this case';card.append(link);}
    if(note){const button=document.createElement('button');button.textContent='Prepare journal entry for this case';button.onclick=()=>note(item);card.append(button);}
    section.append(card);
   }
   container.append(section);
  }
 }
 return {GROUPS,cases,counts,when,healthText,factsReady,impact,outcome,journal,reconciliation,renderCases};
});
