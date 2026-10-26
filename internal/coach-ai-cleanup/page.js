'use strict';
(function(){
 const $=id=>document.getElementById(id),view=CleanupStaffView,session=window.sidelineCleanupSession;
 let controller=null,scan=null,items=[],epoch=0,stopped=false,busy=false,checked=false,observedAt=null,journalCase=null;
 const active=()=>!!session&&typeof session.isActive==='function'&&session.isActive();
 function buttons(){$('refresh').disabled=!active()||busy||stopped;$('copyJournal').disabled=!active()||busy||!checked;}
 function draw(){
  const term=$('search').value.trim().toLowerCase();
  view.renderCases(document,$('records'),items.filter(c=>(c.id+' '+c.title+' '+c.explanation+' '+c.next).toLowerCase().includes(term)),{blocked:scan?.health?.health==='unknown',note:item=>{
   if(!active()||!checked)return;journalCase=item;
   try{$('journalText').value=view.journal({operator:$('operatorName').value,checkedAtMs:observedAt,items,complete:!!scan&&scan.health.health!=='unknown',item});$('journalText').focus();}
   catch{$('journalStatus').textContent='Enter the actual operator name or initials, then prepare the case entry.';}
  },empty:scan?'No cases match this view.':'Load the queue to see the current cases.'});
 }
 function clear(){
  epoch++;controller=null;scan=null;items=[];stopped=false;busy=false;checked=false;observedAt=null;journalCase=null;
  $('records').replaceChildren();$('health').textContent='';$('search').value='';$('operatorName').value='';$('journalText').value='';
  $('connection').textContent='Signed out. A new private sign-in is required.';
  $('journalStatus').textContent='The journal is not updated automatically.';$('status').textContent='Sign in privately before making a new check.';buttons();
 }
 function connect(){
  if(!active()){clear();return;}
  if(!controller)controller=CleanupClient.createController(CleanupClient.createTransport({origin:location.origin,getToken:()=>session.getToken(),fetch:window.fetch.bind(window)}));
  $('connection').textContent='Signed in. This daily queue is read-only. Select Load queue once when ready.';buttons();
 }
 $('refresh').onclick=async()=>{
  if(!active()||busy||stopped||!controller)return;
  const token=epoch,c=controller;busy=true;scan=null;items=[];checked=false;journalCase=null;$('journalText').value='';$('records').replaceChildren();$('health').textContent='Reading the current queue…';buttons();
  try{
   const answer=await c.call('list',{});
   if(token!==epoch||!active())return;
   const parsed=view.cases(answer.records,answer.checkedAtMs);
   if(!['healthy','attention','unknown'].includes(answer.health?.health))throw Error('incomplete_inventory');
   scan=answer;items=parsed;observedAt=answer.checkedAtMs;checked=true;$('health').textContent=view.healthText(scan,items);
   $('status').textContent='Last check: '+view.when(observedAt)+'. Loading the queue performed no cleanup action.';draw();
  }catch{
   if(token!==epoch||!active())return;
   stopped=true;checked=true;observedAt=Date.now();scan=null;items=[];$('records').replaceChildren();
   $('health').textContent='Check unavailable or incomplete. Outstanding work has not been established.';
   $('status').textContent='Request stopped without retry. Record the problem and ask for technical help; do not record an empty queue.';
  }finally{if(token===epoch&&active()){busy=false;buttons();}}
 };
 $('search').oninput=draw;
 $('copyJournal').onclick=async()=>{
  if(!active()||busy||!checked)return;
  const token=epoch;
  try{
   const text=view.journal({operator:$('operatorName').value,checkedAtMs:observedAt,items,complete:!!scan&&scan.health.health!=='unknown',item:journalCase});
   $('journalText').value=text;
   if(window.navigator?.clipboard?.writeText){await window.navigator.clipboard.writeText(text);if(token===epoch&&active())$('journalStatus').textContent='Copied. Paste into the existing restricted journal; sharing stays unchanged.';}
   else{$('journalText').focus();$('journalText').select();$('journalStatus').textContent='Select and copy the entry above, then paste it into the restricted journal.';}
  }catch{if(token===epoch&&active())$('journalStatus').textContent='Enter the actual operator name or initials. If copying is unavailable, copy the displayed entry manually.';}
 };
 if(session&&typeof session.subscribe==='function')session.subscribe(connect);
 connect();
})();
