'use strict';
// Prepared packaging acceptance, NOT RUN. Only for a later approved isolated
// --network=none image container. No cloud credentials, app data or auth tokens.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http'),cp=require('node:child_process');
const role=process.argv[2];
assert.ok(['console','observer'].includes(role));
const expected=JSON.parse(fs.readFileSync('/checks/runtime-inventory.review.json','utf8'));
const spec=expected.roles[role],sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function files(dir,prefix=''){
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const name=prefix+entry.name;
  if(role==='console'&&name==='functions/node_modules')return [];
  const full=path.join(dir,entry.name),stat=fs.lstatSync(full);
  assert.ok(!stat.isSymbolicLink(),'unexpected application symlink');
  assert.equal(stat.mode&0o222,0,'application file must be read-only');
  return entry.isDirectory()?files(full,name+'/'):[name];
 }).sort();
}
function oneRequest(method,url,body,parseJson=true){
 const bytes=body?Buffer.from(JSON.stringify(body)):undefined;
 return new Promise((resolve,reject)=>{
  const request=http.request({host:'127.0.0.1',port:8080,path:url,method,agent:false,headers:bytes?{'content-type':'application/json','content-length':bytes.length}:{}},res=>{
   const chunks=[];let size=0;
   res.on('data',chunk=>{size+=chunk.length;if(size>16384)request.destroy(Error('acceptance_response_limit'));else chunks.push(chunk);});
   res.on('error',reject);res.on('end',()=>{try{const text=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,body:parseJson?JSON.parse(text):text});}catch{reject(Error('acceptance_response_format'));}});
  });request.setTimeout(3000,()=>request.destroy(Error('acceptance_timeout')));request.on('error',reject);request.end(bytes);
 });
}
async function main(){
 const metadata=JSON.parse(fs.readFileSync('/checks/image.inspect.json','utf8'));
 assert.equal(metadata.length,1);const image=metadata[0];
 assert.equal(image.Os,'linux');assert.equal(image.Architecture,'amd64');
 assert.equal(image.Config.User,'1000:1000');assert.equal(image.Config.WorkingDir,'/app');
 assert.deepEqual(image.Config.Entrypoint,['node','internal/coach-ai-cleanup/host/bootstrap.cjs']);
 assert.deepEqual(image.Config.Cmd,[role]);assert.match(image.Id,/^sha256:[a-f0-9]{64}$/);
 assert.equal(process.cwd(),'/app');assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
 assert.equal(process.versions.node.split('.')[0],'22');assert.equal(process.getuid(),1000);assert.equal(process.getgid(),1000);
 for(const name of expected.flags)assert.equal(process.env[name],'false');
 assert.ok(!Object.keys(process.env).some(name=>/^(?:REVENUECAT_|GOOGLE_APPLICATION_CREDENTIALS$|CLEANUP_PRIMARY_UID$|CLEANUP_BACKUP_UID$|CLEANUP_FIREBASE_WEB_API_KEY$)/.test(name)));
 assert.deepEqual(files('/app'),spec.applicationFiles.slice().sort());
 for(const [file,digest]of Object.entries(spec.rawHashes))assert.equal(sha(fs.readFileSync('/app/'+file)),digest);
 for(const file of spec.compiledModules)assert.ok(require('/app/'+file),'compiled module load');
 let installedCount=0,inventoryHash=null;
 if(role==='observer')assert.ok(!fs.existsSync('/app/functions/node_modules'));
 else{
  const installed=JSON.parse(fs.readFileSync('/app/functions/node_modules/.package-lock.json','utf8')).packages;
  const actual=[];
  for(const [name,value]of Object.entries(installed)){
   const pinned=expected.lockInventory[name];assert.ok(pinned,'unreviewed installed vendor');
   assert.equal(value.version,pinned.version);assert.equal(value.integrity,pinned.integrity);assert.equal(value.resolved,pinned.resolved);
   actual.push({path:name,version:value.version,integrity:value.integrity});
  }
  for(const [name,version]of Object.entries(spec.rootDependencies))assert.equal(JSON.parse(fs.readFileSync('/app/functions/node_modules/'+name+'/package.json','utf8')).version,version);
  installedCount=actual.length;inventoryHash=sha(Buffer.from(JSON.stringify(actual.sort((a,b)=>a.path.localeCompare(b.path)))));
 }
 const child=cp.spawn(process.execPath,['internal/coach-ai-cleanup/host/bootstrap.cjs',role],{cwd:'/app',env:process.env,stdio:['ignore','pipe','pipe']});
 let ended=false;const closed=new Promise(resolve=>child.once('close',()=>{ended=true;resolve();}));
 try{
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('acceptance_startup_timeout')),5000);
   let stdout='';
   const exit=()=>{clearTimeout(timer);reject(Error('acceptance_startup_exit'));};
   child.once('error',exit);child.once('exit',exit);
   child.stdout.on('data',chunk=>{
    stdout+=chunk.toString('utf8');if(stdout.length>8192){clearTimeout(timer);return reject(Error('acceptance_startup_output'));}
    if(stdout.includes('"status":"listening"')){clearTimeout(timer);child.removeListener('exit',exit);resolve();}
   });
   // Do not forward arbitrary child error text into build logs.
   child.stderr.resume();
  });
  const health=await oneRequest('GET','/healthz');assert.equal(health.status,200);assert.equal(health.body.status,'up');
  if(role==='observer'){
   assert.equal(health.body.observerEnabled,false);
   const deny=await oneRequest('POST','/observe',{mode:'health'});assert.equal(deny.status,503);assert.equal(deny.body.error,'cleanup_observer_disabled');
  }else{
   const login=await oneRequest('GET','/login-config.js',undefined,false);
   assert.equal(login.status,200);assert.equal(login.body,'window.cleanupLoginConfig=null;');
   for(const action of ['list','execute']){
    const deny=await oneRequest('POST','/internal/coach-ai-cleanup',{action});assert.equal(deny.status,503);assert.equal(deny.body.error,'cleanup_disabled');
   }
  }
 }finally{
  if(!ended){child.kill('SIGTERM');await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(Error('acceptance_shutdown_timeout')),6000))]);}
 }
 process.stdout.write(JSON.stringify({packagingAcceptance:'PASS',role,imageConfigurationDigest:image.Id,applicationFiles:spec.applicationFiles.length,installedVendorCount:installedCount,installedInventorySha256:inventoryHash,capabilities:'all_off',automaticRetries:0})+'\n');
}
main().catch(()=>{process.stderr.write('cleanup_image_acceptance_stopped\n');process.exitCode=1;});
