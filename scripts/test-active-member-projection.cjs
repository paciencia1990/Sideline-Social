'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const filename=path.resolve(__dirname,'../functions/src/index.ts');
const source=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true);
const statement=source.statements.find(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(d=>d.name.getText(source)==='updateActiveMemberCount'));
assert.ok(statement,'Test the actual exported handler, not a duplicate implementation');
const compiled=ts.transpileModule(statement.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function exercise({exists=true,deleteAtCommit=false,canonical=[],legacy=[],missingId=false,queryError=false}={}){
 let queryCount=0;let stored=exists?{name:'Retained squad',memberIds:['a','b']}:null;let writes=0;let attempts=0;
 const db={collection(name){
  if(name==='squadMemberships'){const query={where(){return query;},async get(){if(queryError)throw Error('query_unavailable');const records=queryCount++===0?canonical:legacy;return {docs:records.map(userId=>({data:()=>({userId})}))};}};return query;}
  assert.equal(name,'squads');return {doc:id=>{assert.equal(id,'squad');return {id};}};
 },async runTransaction(callback){
  let staged;
  const transaction={async get(){return {exists:stored!==null};},update(ref,fields){assert.ok(stored,'Missing squads must never be recreated');staged=fields;},set(){throw Error('merge_set_would_recreate_deleted_squad');}};
  attempts++;let result=await callback(transaction);
  if(deleteAtCommit){stored=null;staged=undefined;attempts++;result=await callback(transaction);}
  if(staged){stored={...stored,...staged};writes++;}return result;
 }};
 const exported={};const context={exports:exported,getFirestore:()=>db,THREE_HOURS_MS:10800000,Timestamp:{now:()=>123},console:{log(){},warn(){}},functions:{firestore:{document:name=>{assert.equal(name,'squadMemberships/{membershipId}');return {onWrite:handler=>handler};}}}};
 vm.runInNewContext(compiled,context,{filename});
 const data=missingId?{}:{squadId:'squad'};
 await exported.updateActiveMemberCount({after:{exists:false},before:{exists:true,data:()=>data}});
 return {stored,writes,queryCount,attempts};
}
(async()=>{
 const existing=await exercise({canonical:['a','b'],legacy:['b',null]});
 assert.equal(existing.stored.activeMemberCount,2);assert.equal(existing.stored.name,'Retained squad');assert.equal(existing.writes,1);
 const empty=await exercise();assert.equal(empty.stored.activeMemberCount,0);assert.equal(empty.stored.lastActivityAt,null);
 const missing=await exercise({exists:false,canonical:['a']});assert.equal(missing.stored,null);assert.equal(missing.writes,0);
 const deleted=await exercise({deleteAtCommit:true,canonical:['a']});assert.equal(deleted.stored,null);assert.equal(deleted.writes,0);assert.equal(deleted.attempts,2);
 const malformed=await exercise({missingId:true});assert.equal(malformed.queryCount,0);assert.equal(malformed.writes,0);
 await assert.rejects(exercise({queryError:true}),/query_unavailable/);
 console.log('Actual active-member handler preserves existing squads, deduplicates users, and cannot recreate a squad deleted before or during its transaction.');
})().catch(e=>{console.error(e);process.exitCode=1;});
