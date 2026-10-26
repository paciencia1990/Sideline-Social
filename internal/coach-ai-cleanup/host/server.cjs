'use strict';
const {createBudget}=require('./transport.cjs');
const CSP="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=(), geolocation=()','Content-Security-Policy':CSP,'Strict-Transport-Security':'max-age=31536000'};
function createCleanupHost({origin,readsEnabled=false,mutationsEnabled=false,loginEnabled=false,operatorActionsEnabled=false,publicAuthConfig=null,assets={},createAdapter,createActionAdapter,now=Date.now}){
 const parsed=new URL(origin);if(parsed.origin!==origin||parsed.protocol!=='https:'&&!(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)))throw Error('cleanup_host_origin');
 if(mutationsEnabled&&!readsEnabled)throw Error('cleanup_capability_configuration');
 if([readsEnabled,mutationsEnabled,loginEnabled].some(v=>typeof v!=='boolean'))throw Error('cleanup_capability_configuration');
 if(typeof operatorActionsEnabled!=='boolean'||operatorActionsEnabled&&(!readsEnabled||!loginEnabled||mutationsEnabled||typeof createActionAdapter!=='function'))throw Error('cleanup_capability_configuration');
 if(loginEnabled&&(!publicAuthConfig||publicAuthConfig.projectId!=='sideline-social-staging-2026'&&!/^demo-[a-z0-9-]+$/.test(publicAuthConfig.projectId)||!/^[-A-Za-z0-9_]{10,150}$/.test(publicAuthConfig.apiKey||'')))throw Error('cleanup_public_auth_config');
 const publicConfig=loginEnabled?{projectId:publicAuthConfig.projectId,apiKey:publicAuthConfig.apiKey}:null;
 const assetMap=Object.freeze({...assets}),allowed=new Set(['/','/index.html','/style.css','/staff-view.js','/client.js','/page.js','/login.js','/login-page.js']);
 const actionAssets=new Set(['/action.html','/action-client.js','/action-page.js']);
 return async function handle(req,res){
  const controller=new AbortController(),budget=createBudget({now,signal:controller.signal});
  const disconnect=()=>{if(!res.writableEnded)controller.abort();};req.once('aborted',disconnect);res.once('close',disconnect);
  const stopInput=()=>{if(!req.complete)req.destroy();};budget.signal.addEventListener('abort',stopInput,{once:true});
  const reply=(status,body,type='application/json')=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{...HEADERS,'Content-Type':type});res.end(type==='application/json'?JSON.stringify(body):body);};
  try{
   const url=new URL(req.url,origin);if(url.origin!==origin||url.search||url.hash)return reply(404,{error:'not_found'});
   if(req.method==='GET'&&url.pathname==='/healthz')return reply(200,{status:'up'});
   if(req.method==='GET'&&url.pathname==='/login-config.js')return reply(200,'window.cleanupLoginConfig='+JSON.stringify(publicConfig)+';','application/javascript');
   if(req.method==='GET'&&(allowed.has(url.pathname)||operatorActionsEnabled&&actionAssets.has(url.pathname))){const key=url.pathname==='/'?'/index.html':url.pathname,v=assetMap[key];if(typeof v!=='string')return reply(404,{error:'not_found'});return reply(200,v,key.endsWith('.html')?'text/html; charset=utf-8':key.endsWith('.css')?'text/css':'application/javascript');}
   const actionRoute=url.pathname==='/internal/coach-ai-cleanup-action';
   if((!actionRoute&&url.pathname!=='/internal/coach-ai-cleanup')||req.method!=='POST')return reply(404,{error:'not_found'});
   if(actionRoute&&!operatorActionsEnabled)return reply(503,{error:'cleanup_operator_actions_disabled'});
   if(!readsEnabled)return reply(503,{error:'cleanup_disabled'});
   if(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0].trim()!=='application/json'||req.headers['content-encoding']||req.headers.cookie||!/^Bearer [^\s]{1,8192}$/.test(req.headers.authorization||''))return reply(403,{error:'cleanup_request_denied'});
   const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>16384))return reply(413,{error:'request_too_large'});
   const chunks=[];let size=0;for await(const chunk of req){budget.check();size+=Buffer.byteLength(chunk);if(size>16384)return reply(413,{error:'request_too_large'});chunks.push(Buffer.from(chunk));}
   budget.check();let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'invalid_json'});}
   if(!body||typeof body!=='object'||Array.isArray(body)||!['list','cases','prepare','detail','draft','approve','execute','expire_review'].includes(body.action))return reply(400,{error:'invalid_action'});
   if(actionRoute&&!['cases','prepare','detail','draft','approve','execute','expire_review'].includes(body.action))return reply(400,{error:'invalid_action'});
   if(!actionRoute&&['cases','prepare'].includes(body.action))return reply(400,{error:'invalid_action'});
   if(!actionRoute&&!mutationsEnabled&&!['list','detail'].includes(body.action))return reply(403,{error:'cleanup_mutations_disabled'});
   const adapter=(actionRoute?createActionAdapter:createAdapter)(budget);const result=await adapter({method:'POST',origin:req.headers.origin,authorization:req.headers.authorization,contentType:req.headers['content-type'],body});
   budget.check();return reply(result.status,result.body);
  }catch{return reply(409,{error:'cleanup_action_stopped'});}
  finally{budget.signal.removeEventListener('abort',stopInput);budget.close();req.removeListener('aborted',disconnect);res.removeListener('close',disconnect);}
 };
}
module.exports={createCleanupHost,HEADERS};
