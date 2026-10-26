'use strict';
const https=require('node:https'),http=require('node:http');
function createBudget({now=Date.now,milliseconds=25000,signal}={}){
 const controller=new AbortController(),end=now()+milliseconds;
 const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const timer=setTimeout(abort,milliseconds);timer.unref?.();
 return {signal:controller.signal,check(){if(controller.signal.aborted||now()>=end)throw Error('cleanup_deadline');},remaining(){return Math.max(0,end-now());},cancel:abort,close(){clearTimeout(timer);signal?.removeEventListener('abort',abort);}};
}
function createJsonTransport({budget,allow,requestImpl,maximumBytes=4*1024*1024}){
 // No SDK, redirect, redirect-following agent, retry or automatic credential refresh.
 return async function send(url,{method='GET',headers={},body}={}){
  budget.check();const target=new URL(url);if(!allow(target,method)||target.username||target.password||target.hash)throw Error('cleanup_transport_destination');
  const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
  return new Promise((resolve,reject)=>{
   let req,done=false,timer;
   const fail=()=>finish(Error('cleanup_transport_stopped'));
   const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);budget.signal.removeEventListener('abort',fail);if(error){req?.destroy();reject(error);}else resolve(value);};
   const request=requestImpl||(target.protocol==='https:'?https.request:http.request);
   req=request(target,{method,agent:false,headers:{accept:'application/json',...headers,...(bytes?{'content-type':'application/json','content-length':bytes.length}:{})}},res=>{
    const chunks=[];let count=0;
    res.on('data',chunk=>{count+=chunk.length;if(count>maximumBytes)fail();else chunks.push(chunk);});res.on('error',fail);res.on('aborted',fail);
    res.on('end',()=>{try{budget.check();if(res.statusCode>=300&&res.statusCode<400)throw Error();const value=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');finish(null,{status:res.statusCode,headers:res.headers,value});}catch{fail();}});
   });
   req.on('error',fail);budget.signal.addEventListener('abort',fail,{once:true});timer=setTimeout(fail,Math.max(1,budget.remaining()));req.end(bytes);
   if(budget.signal.aborted)fail();
  });
 };
}
function metadataCredential(send,budget){
 let pending;
 return ()=>{budget.check();if(!pending)pending=(async()=>{const r=await send('http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',{headers:{'Metadata-Flavor':'Google'}});
  if(r.status!==200||r.headers['metadata-flavor']!=='Google'||typeof r.value.access_token!=='string'||r.value.token_type!=='Bearer'||!(r.value.expires_in>60))throw Error('cleanup_credential_unavailable');return r.value.access_token;
 })();return pending;}; // Rejected promise stays rejected for this operation.
}
module.exports={createBudget,createJsonTransport,metadataCredential};
