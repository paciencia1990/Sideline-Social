'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createCleanupApplication}=require('../internal/coach-ai-cleanup/host/application.cjs');
const {createSession}=require('../internal/coach-ai-cleanup/login.js');
const root=path.resolve(__dirname,'..'),out=process.argv[2];assert.ok(out);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/attempt.json','{}',{flag:'wx'});
const result={passed:false,cases:[],liveRequests:0,builds:0,automaticRetries:0};
async function test(name,fn){await fn();result.cases.push({name,passed:true});}
async function get(h,url){const req=new PassThrough();Object.assign(req,{url,method:'GET',headers:{},complete:true});const res=new EventEmitter();Object.assign(res,{writableEnded:false,writeHead(s,h){this.status=s;this.headers=h;},end(v){this.body=v;this.writableEnded=true;}});const p=h(req,res);req.end();await p;return res;}
async function main(){
 await test('assembly_stays_disabled_without_credentials_and_serves_only_static_shell',async()=>{let constructed=0;const h=createCleanupApplication({origin:'https://fixture.invalid',projectId:'demo-host',createAdapter:()=>{constructed++;throw Error();}});assert.equal((await get(h,'/')).status,200);assert.equal((await get(h,'/login-config.js')).body,'window.cleanupLoginConfig=null;');assert.equal((await get(h,'/host/application.cjs')).status,404);assert.equal(constructed,0);});
 await test('assembly_rejects_mismatched_auth_project_and_nonboolean_flags',async()=>{assert.throws(()=>createCleanupApplication({origin:'https://fixture.invalid',projectId:'demo-one',publicAuthConfig:{projectId:'demo-two'}}),/mismatch/);assert.throws(()=>createCleanupApplication({origin:'https://fixture.invalid',projectId:'demo-one',readsEnabled:'false'}),/configuration/);});
 await test('enabled_login_config_exposes_only_public_auth_fields',async()=>{const h=createCleanupApplication({origin:'https://fixture.invalid',projectId:'demo-one',loginEnabled:true,publicAuthConfig:{projectId:'demo-one',apiKey:'fake-public-key',privateField:'do-not-publish'}});const r=await get(h,'/login-config.js');assert.ok(r.body.includes('fake-public-key'));assert.ok(!r.body.includes('do-not-publish'));assert.match(r.headers['Content-Security-Policy'],/identitytoolkit.googleapis.com/);assert.ok(!r.headers['Content-Security-Policy'].includes('unsafe-inline'));});
 await test('login_dom_clears_private_inputs_and_connects_memory_session',async()=>{
  const ids=['loginStatus','loginSubmit','totpSubmit','signOut','totpSection','loginEmail','loginPassword','totpCode'];const elements=Object.fromEntries(ids.map(id=>[id,{value:'',textContent:'',disabled:true,hidden:false}]));
  let active=false,pending=false,passwordSeen,codeSeen,subscriber;
  const fake={state:()=>({active,busy:false,awaitingTotp:pending}),isActive:()=>active,subscribe:fn=>{subscriber=fn;},signIn:async(email,password)=>{passwordSeen=password;assert.equal(elements.loginPassword.value,'');pending=true;subscriber();},confirm:async code=>{codeSeen=code;assert.equal(elements.totpCode.value,'');pending=false;active=true;subscriber();},signOut:()=>{active=false;pending=false;subscriber();}};
  const window={cleanupLoginConfig:{},fetch:()=>{throw Error('network');},addEventListener:()=>{}},context={window,document:{getElementById:id=>elements[id]},CleanupLogin:{createSession:()=>fake}};
  vm.runInNewContext(fs.readFileSync(root+'/internal/coach-ai-cleanup/login-page.js','utf8'),context);
  elements.loginEmail.value='info@joinsidelinesocial.com';elements.loginPassword.value='synthetic-password';await elements.loginSubmit.onclick();assert.equal(passwordSeen,'synthetic-password');assert.equal(elements.totpSection.hidden,false);
  elements.totpCode.value='123456';await elements.totpSubmit.onclick();assert.equal(codeSeen,'123456');assert.equal(window.sidelineCleanupSession,fake);assert.match(elements.loginStatus.textContent,/Signed in/);elements.signOut.onclick();assert.equal(active,false);assert.equal(elements.loginPassword.value,'');assert.equal(elements.totpCode.value,'');
 });
 await test('failed_totp_requires_fresh_signin_and_never_resubmits_pending_credential',async()=>{let calls=0;const s=createSession({config:{projectId:'demo-one',apiKey:'synthetic-only'},schedule:()=>1,unschedule:()=>{},fetch:async()=>{calls++;return calls===1?{ok:true,json:async()=>({mfaPendingCredential:'pending',mfaInfo:[{totpInfo:{},mfaEnrollmentId:'factor'}]})}:{ok:false};}});await s.signIn('info@joinsidelinesocial.com','synthetic');await assert.rejects(s.confirm('123456'));await assert.rejects(s.confirm('123456'));assert.equal(calls,2);assert.equal(s.state().active,false);});
 await test('logout_during_queue_load_does_not_restore_private_results',async()=>{
  class E{constructor(){this.value='';this.textContent='';this.children=[];this.checked=false;}replaceChildren(){this.children=[];}append(c){this.children.push(c);}querySelectorAll(){return [];}}
  const html=fs.readFileSync(root+'/internal/coach-ai-cleanup/index.html','utf8'),elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new E()]));let active=true,subscriber,resolve;
  const session={isActive:()=>active,getToken:async()=> 'synthetic',subscribe:fn=>{subscriber=fn;}};
  const window={sidelineCleanupSession:session,fetch:async()=>new Promise(r=>resolve=r)};
  const context={window,document:{getElementById:id=>elements[id],createElement:()=>new E()},location:{origin:'https://fixture.invalid',protocol:'https:'},CleanupClient:require('../internal/coach-ai-cleanup/client.js')};
  vm.runInNewContext(fs.readFileSync(root+'/internal/coach-ai-cleanup/page.js','utf8'),context);
  const pending=elements.refresh.onclick();await Promise.resolve();active=false;subscriber();resolve({ok:true,json:async()=>({records:[{kind:'fences',key:'private-hash',status:'deleting'}],health:{health:'attention',reason:'scan_complete'}})});await pending;assert.equal(elements.records.children.length,0);assert.equal(elements.refresh.disabled,true);
 });
 result.passed=true;
}
main().catch(e=>{result.error=e.message;process.exitCode=1;}).finally(()=>{fs.writeFileSync(out+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));});
