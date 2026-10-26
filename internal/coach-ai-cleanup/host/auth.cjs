'use strict';
const crypto=require('node:crypto');
const CERTS='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
function createAuthPort({projectId,send,getAccessToken,budget,now=Date.now}){
 if(projectId!=='sideline-social-staging-2026'&&!/^demo-[a-z0-9-]+$/.test(projectId))throw Error('cleanup_project_mismatch');
 const base=`https://identitytoolkit.googleapis.com/v1/projects/${projectId}`,validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);
 let certRequest;
 async function request(suffix,method,body){budget.check();const access=await getAccessToken();budget.check();const r=await send(base+suffix,{method,headers:{authorization:'Bearer '+access},body});budget.check();if(r.status!==200)throw Error('cleanup_auth_unavailable');return r.value;}
 async function rawUser(uid){if(!validUid(uid))throw Error('cleanup_auth_identity');const r=await request('/accounts:lookup','POST',{localId:[uid]});if(!Array.isArray(r.users)||!r.users.length)throw Object.assign(Error('cleanup_auth_absent'),{code:'auth/user-not-found'});if(r.users.length!==1||r.users[0].localId!==uid)throw Error('cleanup_auth_response');return r.users[0];}
 function normalize(u){return {uid:u.localId,email:u.email,emailVerified:u.emailVerified===true,disabled:u.disabled===true};}
 return {app:{options:{projectId}},async getUser(uid){return normalize(await rawUser(uid));},async listUsers(limit){
  if(limit!==1000)throw Error('cleanup_auth_bound');const r=await request('/accounts:batchGet?maxResults=1000','GET');if(r.users!==undefined&&!Array.isArray(r.users))throw Error('cleanup_auth_response');if((r.users||[]).some(u=>!validUid(u.localId)))throw Error('cleanup_auth_response');return {users:(r.users||[]).map(normalize),pageToken:r.nextPageToken};
 },async verifyIdToken(token,revocation){
  budget.check();if(revocation!==true||typeof token!=='string'||token.length>8192)throw Error('cleanup_token');const parts=token.split('.');if(parts.length!==3||parts.some(s=>!s||!/^[A-Za-z0-9_-]+$/.test(s)))throw Error('cleanup_token');
  const h=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8')),p=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')),seconds=Math.floor(now()/1000);
  if(h.alg!=='RS256'||typeof h.kid!=='string'||h.kid.length>256||h.crit!==undefined||p.aud!==projectId||p.iss!==`https://securetoken.google.com/${projectId}`||!validUid(p.sub)||p.firebase?.tenant!==undefined
   ||![p.iat,p.exp,p.auth_time].every(Number.isSafeInteger)||p.iat>seconds||p.auth_time>seconds||p.exp<=seconds||p.auth_time<=0||p.exp<=p.iat||seconds-p.auth_time>900)throw Error('cleanup_token');
  if(!certRequest)certRequest=send(CERTS).then(r=>{if(r.status!==200||!r.value||typeof r.value!=='object')throw Error('cleanup_certificates');return r.value;});
  const certs=await certRequest;budget.check();if(!Object.hasOwn(certs,h.kid)||typeof certs[h.kid]!=='string')throw Error('cleanup_certificate_missing');
  const key=crypto.createPublicKey(certs[h.kid]);if(key.asymmetricKeyType!=='rsa'||(key.asymmetricKeyDetails?.modulusLength||0)<2048||!crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),key,Buffer.from(parts[2],'base64url')))throw Error('cleanup_signature');
  const u=await rawUser(p.sub);const since=u.validSince===undefined?0:Number(u.validSince);
  if(!Number.isSafeInteger(since)||since<0||p.auth_time<since||u.disabled===true)throw Error('cleanup_token_revoked');budget.check();return {...p,uid:p.sub};
 }};
}
module.exports={createAuthPort,CERTS};
