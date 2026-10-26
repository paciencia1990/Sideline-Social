(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CleanupLogin=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Direct Auth REST calls, never SDK refresh/retry. Only ID token lives in memory.
 function createSession({config,fetch,now=Date.now,schedule=setTimeout,unschedule=clearTimeout}){
  if(!config||typeof config.apiKey!=='string'||!/^[-A-Za-z0-9_]{10,150}$/.test(config.apiKey)||config.projectId!=='sideline-social-staging-2026'&&!/^demo-[a-z0-9-]+$/.test(config.projectId))throw Error('login_configuration');
  const project=config.projectId,key=config.apiKey;let token=null,expires=0,pending=null,busy=false,generation=0,timer=null,aborter=null;
  const listeners=new Set();const notify=()=>listeners.forEach(fn=>fn());
  function clear(){generation++;token=null;pending=null;expires=0;if(timer)unschedule(timer);timer=null;aborter?.abort();notify();}
  function active(){if(token&&now()>=expires)clear();return !!token;}
  async function post(path,body){aborter=new AbortController();const stop=schedule(()=>aborter?.abort(),15000);try{
   // Google's browser-key allowlist needs a referrer. Send only this HTTPS
   // origin for these two fixed Auth endpoints; other page requests retain
   // the site's no-referrer policy. No page path or query is disclosed.
   const r=await fetch('https://identitytoolkit.googleapis.com/'+path+'?key='+encodeURIComponent(key),{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'strict-origin',signal:aborter.signal,body:JSON.stringify(body)});
   if(!r.ok)throw Error('login_stopped');const value=await r.json();return value;
  }finally{unschedule(stop);aborter=null;}}
  async function signIn(email,password){if(busy)throw Error('login_in_progress');clear();busy=true;const epoch=generation;notify();try{
   if(!['info@joinsidelinesocial.com','joann@joinsidelinesocial.com'].includes(email.trim().toLowerCase())||typeof password!=='string'||!password||password.length>1024)throw Error('login_stopped');
   const r=await post('v1/accounts:signInWithPassword',{email:email.trim().toLowerCase(),password,returnSecureToken:true});
   if(epoch!==generation)throw Error('login_cancelled');const factors=(r.mfaInfo||[]).filter(f=>f.totpInfo!==undefined);
   if(typeof r.mfaPendingCredential!=='string'||factors.length!==1||typeof factors[0].mfaEnrollmentId!=='string')throw Error('totp_required');
   pending={credential:r.mfaPendingCredential,enrollment:factors[0].mfaEnrollmentId,at:now()};return 'totp_required';
  }catch{clear();throw Error('login_stopped');}finally{busy=false;notify();}}
  async function confirm(code){if(busy)throw Error('login_in_progress');if(!pending||now()-pending.at>300000||!/^\d{6}$/.test(code)){clear();throw Error('login_stopped');}
   busy=true;const epoch=generation,p=pending;pending=null;notify();try{
    const r=await post('v2/accounts/mfaSignIn:finalize',{mfaPendingCredential:p.credential,mfaEnrollmentId:p.enrollment,totpVerificationInfo:{verificationCode:code}});
    if(epoch!==generation||typeof r.idToken!=='string'||r.idToken.length>8192)throw Error('login_stopped');
    const parts=r.idToken.split('.');if(parts.length!==3)throw Error('login_stopped');const claims=JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/'))),seconds=Math.floor(now()/1000);
    // UI eligibility only: server independently verifies signature/revocation/pins.
    if(claims.aud!==project||claims.iss!=='https://securetoken.google.com/'+project||!claims.firebase?.sign_in_second_factor||!Number.isSafeInteger(claims.auth_time)||!Number.isSafeInteger(claims.exp)||claims.auth_time>seconds||claims.auth_time<=0||claims.exp<=seconds||seconds-claims.auth_time>=900)throw Error('login_stopped');
    expires=Math.min(claims.exp,claims.auth_time+900)*1000;token=r.idToken;
    timer=schedule(clear,Math.max(1,expires-now()));return 'signed_in';
   }catch{clear();throw Error('login_stopped');}finally{busy=false;notify();}}
  return {signIn,confirm,signOut:clear,isActive:active,getToken:async()=>{if(!active())throw Error('session_required');return token;},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},state:()=>({active:active(),busy,awaitingTotp:!!pending})};
 }
 return {createSession};
});
