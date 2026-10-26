'use strict';
(function(){
 const $=id=>document.getElementById(id),config=window.cleanupLoginConfig;
 if(!config){$('loginStatus').textContent='Sign-in is disabled until the host is configured and approved.';return;}
 let session;try{session=CleanupLogin.createSession({config,fetch:window.fetch.bind(window)});}catch{$('loginStatus').textContent='Sign-in configuration unavailable.';return;}
 window.sidelineCleanupSession=session;
 function render(){const s=session.state();$('loginSubmit').disabled=s.busy||s.active;$('totpSubmit').disabled=s.busy||!s.awaitingTotp;$('signOut').disabled=!s.active&&!s.busy&&!s.awaitingTotp;$('totpSection').hidden=!s.awaitingTotp;}
 session.subscribe(()=>{render();const s=session.state();if(s.active)$('loginStatus').textContent='Signed in. Reauthentication required within 15 minutes.';else if(!s.busy&&!s.awaitingTotp)$('loginStatus').textContent='Session ended. Sign in again when ready.';});$('loginStatus').textContent='Sign in with your operator account and authenticator.';render();
 $('loginSubmit').onclick=async()=>{const email=$('loginEmail').value,password=$('loginPassword').value;$('loginPassword').value='';try{await session.signIn(email,password);$('loginStatus').textContent='Enter your authenticator code.';}catch{$('loginStatus').textContent='Sign-in stopped. No retry was sent. Start again when ready.';}finally{render();}};
 $('totpSubmit').onclick=async()=>{const code=$('totpCode').value;$('totpCode').value='';try{await session.confirm(code);}catch{$('loginStatus').textContent='Verification stopped. Start a fresh sign-in; no retry was sent.';}finally{render();}};
 $('signOut').onclick=()=>{session.signOut();$('loginPassword').value='';$('totpCode').value='';$('loginStatus').textContent='Signed out.';render();};
 window.addEventListener('pagehide',()=>session.signOut());
})();
