"use strict";
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname,'..');
const read = relative => fs.readFileSync(path.join(root,relative),'utf8');
const source = read('utils/friendChatCopyCore.ts');
const js = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText;
const loaded = {exports:{}};
new Function('module','exports','require',js)(loaded,loaded.exports,require);
const {copySelectedFriendChatText,friendChatSingleMessageEligibility} = loaded.exports;
const visible = crypto.randomBytes(16).toString('hex');
const hidden = crypto.randomBytes(16).toString('hex');
const message = (overrides={}) => ({messageType:'text',status:'active',isModerated:false,senderUserId:'self',text:visible,messageId:hidden,image:null,voiceMemo:null,storagePath:hidden,url:hidden,moderationMetadata:hidden,...overrides});
const eligible = (ids,messages,user='self',unavailable=[]) => friendChatSingleMessageEligibility(ids,messages,user,unavailable);
const own = message();
const incoming = message({senderUserId:'friend'});
assert.deepEqual(eligible(['a'],[own]),{reply:true,copy:true,report:false});
assert.deepEqual(eligible(['a'],[incoming]),{reply:true,copy:true,report:true});
for(const item of [message({messageType:'image',image:{fullPath:hidden}}),message({messageType:'voice',voiceMemo:{storagePath:hidden}})]) {
  assert.deepEqual(eligible(['a'],[item]),{reply:true,copy:false,report:false});
}
for(const item of [
  message({messageType:'image',image:{fullPath:hidden},senderUserId:'friend'}),
  message({messageType:'voice',voiceMemo:{storagePath:hidden},senderUserId:'friend'}),
]) {
  assert.deepEqual(eligible(['a'],[item]),{reply:true,copy:false,report:true});
}
assert.deepEqual(eligible(['a'],[message({messageType:'image',image:{fullPath:hidden}})],'self',[hidden]),{reply:false,copy:false,report:false});
for(const item of [
  message({messageType:'system'}),
  message({messageType:'image'}),
  message({messageType:'voice'}),
  message({status:'removed'}),
  message({isModerated:true}),
]) {
  assert.deepEqual(eligible(['a'],[item]),{reply:false,copy:false,report:false});
}
assert.deepEqual(eligible(['a'],[message({text:''})]),{reply:false,copy:false,report:false});
assert.deepEqual(eligible(['a'],[message({messageType:'image',image:{fullPath:hidden},senderUserId:'friend'})],'self',[hidden]),{reply:false,copy:false,report:false});
assert.deepEqual(eligible(['a','b'],[own,incoming]),{reply:false,copy:false,report:false});
assert.deepEqual(eligible(['a','b'],[own]),{reply:false,copy:false,report:false});
assert.deepEqual(eligible(['a'],[]),{reply:false,copy:false,report:false});
assert.deepEqual(eligible([],[]),{reply:false,copy:false,report:false});

const screen = read('app/(social)/chat/[chatId].tsx');
const menu = read('components/FriendChatSelectionOverflowMenu.tsx');
assert.match(screen,/if \(canCopySelection\) actions\.push\(\{ id: "copy", label: t\("chat\.copy"\)/);
assert.match(screen,/if \(canReplyToSelection\) actions\.push\(\{ id: "reply", label: t\("chat\.reply"\)/);
assert.match(screen,/if \(selectedIncoming\) actions\.push\(\{ id: "report", label: t\("moderation\.reportMessage"\)/);
assert.match(screen,/\{canReplyToSelection \? \([\s\S]*?accessibilityLabel=\{t\("chat\.reply"\)\}/);
assert.match(menu,/accessibilityLabel=\{action\.label\}/);
assert.doesNotMatch(screen,/chat\.(?:copyUnavailable|translateUnavailable|replyPrivatelyUnavailable)|id: "translate"|id: "reply-privately"/);
assert.doesNotMatch(screen,/id: "(?:copy|reply|pin|report)"[^\n]*disabled: true/);
assert.doesNotMatch(source,/console\.|analytics|fetch\(/);
assert.match(screen,/if \(result === "copied"\) \{[\s\S]*?clearSelection\(\);[\s\S]*?Alert\.alert\(t\("chat\.messageCopied"\)\)/u);
assert.match(screen,/else if \(result === "failed"\) \{[\s\S]*?Alert\.alert\(t\("chat\.copyFailed"\)\)/u);

const tree = ts.createSourceFile('i18n/index.ts',read('i18n/index.ts'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
function property(object,name) {
  assert(ts.isObjectLiteralExpression(object));
  const pair = object.properties.find(node=>ts.isPropertyAssignment(node) && node.name.getText(tree).replace(/^['"]|['"]$/g,'')===name);
  assert(pair,`Missing translation: ${name}`);
  return pair.initializer;
}
let resources;
for(const statement of tree.statements) {
  if(!ts.isVariableStatement(statement))continue;
  const declaration=statement.declarationList.declarations.find(node=>node.name.getText(tree)==='resources');
  if(declaration)resources=declaration.initializer;
}
assert(resources);
function translation(language,key) {
  let node=property(property(resources,language),'translation');
  for(const segment of key.split('.')) node=property(node,segment);
  assert(ts.isStringLiteral(node),`Expected string: ${language}.${key}`);
  const value=node.text;
  assert(value && value!==key && !/^chat\./.test(value),`Raw key displayed: ${language}.${key}`);
  return value;
}
assert.equal(translation('en','chat.reply'),'Reply');
assert.equal(translation('es','chat.reply'),'Responder');
assert.equal(translation('en','chat.copy'),'Copy');
assert.equal(translation('es','chat.copy'),'Copiar');
for(const language of ['en','es']) for(const key of ['chat.messageCopied','chat.copyFailed','chat.moreMessageActions','chat.dismissMessageActions','moderation.reportMessage']) translation(language,key);
const displayedKeys = new Set([...screen.matchAll(/\bt\("(chat\.[A-Za-z0-9_.]+)"/g)].map(match=>match[1]));
for(const key of displayedKeys) {translation('en',key);translation('es',key);}
assert(!/copyUnavailable|translateUnavailable|replyPrivatelyUnavailable/.test(read('i18n/index.ts')));

async function main(){
  let writes=0;
  const write=async text=>{writes++;assert.equal(text,visible);assert.notEqual(text,hidden);return true;};
  assert.equal(await copySelectedFriendChatText(['a'],[own],write),'copied');
  assert.equal(await copySelectedFriendChatText(['a'],[incoming],write),'copied');
  assert.equal(writes,2);
  for(const [ids,messages] of [
    [[],[]], [['a','b'],[own,incoming]], [['a','b'],[own]], [['a'],[message({messageType:'image'})]],
    [['a'],[message({messageType:'voice'})]], [['a'],[message({status:'removed'})]],
    [['a'],[message({isModerated:true})]], [['a'],[message({text:''})]], [['a'],[]],
  ]) assert.equal(await copySelectedFriendChatText(ids,messages,write),'ineligible');
  assert.equal(writes,2);
  assert.equal(await copySelectedFriendChatText(['a'],[own],async()=>false),'failed');
  assert.equal(await copySelectedFriendChatText(['a'],[own],async()=>{throw new Error(hidden); }),'failed');
  process.stdout.write('friend-chat selection menu: PASS\n');
}
main().catch(()=>{process.stderr.write('friend-chat selection menu: FAIL\n');process.exitCode=1;});
