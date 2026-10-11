'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const admin=require('../functions/node_modules/firebase-admin');
const {initializeApp,deleteApp}=require('firebase/app');
const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword}=require('firebase/auth');
const {getFirestore,connectFirestoreEmulator,doc,getDocFromServer,onSnapshot}=require('firebase/firestore');
const {getDatabase,connectDatabaseEmulator,get,ref}=require('firebase/database');
const {getFunctions,connectFunctionsEmulator,httpsCallable}=require('firebase/functions');
const {getCanonicalSpotScene}=require('../functions/lib/spotDifferenceCore');
const project=process.env.GCLOUD_PROJECT??'';
for(const key of ['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST','FIREBASE_DATABASE_EMULATOR_HOST']){
  assert.ok(project.startsWith('demo-')&&/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[key]??''),'Only an isolated demo project and explicitly local emulators are allowed');
}
const databaseURL=`https://${project}.firebaseio.com`;
if(!admin.apps.length)admin.initializeApp({projectId:project,databaseURL});
const db=admin.firestore(),rtdb=admin.database(),squadId='release-journey-squad';
const compiled={exports:{}};
new Function('module','exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../utils/gameStartSynchronization.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(compiled,compiled.exports);
const {normalizeGameStartState,deriveGameStartVisiblePhase}=compiled.exports;
const reason=value=>error=>error?.details?.reason===value||error?.details?.details?.reason===value||String(error?.message).includes(value);
const apps=[];
async function loadLocalDatabaseRules(){
  const rules=JSON.parse(fs.readFileSync(path.join(__dirname,'../database.rules.json'),'utf8'));
  // Demo Functions use the project-name database instance. The CLI may preload
  // Rules only for its default-rtdb instance, leaving a second instance open.
  // Install the repository's exact policy on the instance this test exercises.
  const endpoint=`http://127.0.0.1:9000/.settings/rules.json?ns=${encodeURIComponent(project)}`;
  const headers={authorization:'Bearer owner','content-type':'application/json'};
  const saved=await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify(rules),redirect:'error',signal:AbortSignal.timeout(10000)});
  assert.equal(saved.ok,true,'Local emulator Rules load must succeed');
  const checked=await fetch(endpoint,{headers,redirect:'error',signal:AbortSignal.timeout(10000)});
  assert.equal(checked.ok,true);assert.deepEqual(await checked.json(),rules,'Verify the exact policy before testing client access');
}
async function client(index){
  const app=initializeApp({apiKey:'demo-key',projectId:project,databaseURL},`release-journey-${index}`);apps.push(app);
  const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  const uid=(await createUserWithEmailAndPassword(auth,`release-journey-${index}@example.test`,'EmulatorOnly123!')).user.uid;
  const firestore=getFirestore(app);connectFirestoreEmulator(firestore,'127.0.0.1',8080);
  const database=getDatabase(app);connectDatabaseEmulator(database,'127.0.0.1',9000);
  const functions=getFunctions(app,'us-central1');connectFunctionsEmulator(functions,'127.0.0.1',5001);
  await Promise.all([db.collection('users').doc(uid).set({firstName:`Player ${index}`,lastName:'Synthetic'}),db.collection('squadMemberships').doc(`${squadId}__${uid}`).set({squadId,userId:uid,membershipStatus:'active'})]);
  return {uid,firestore,database,call:(name,data)=>httpsCallable(functions,name)(data).then(r=>r.data)};
}
async function synchronize(gameType,lobby,players){
  const host=players[0];
  const readyName=gameType==='triviaBlitz'?'setTriviaPlayerReady':'setRealtimeGamePlayerReady';
  await Promise.all(players.slice(0,-1).map(p=>p.call(readyName,{sessionId:lobby.sessionId,ready:true})));
  await assert.rejects(()=>host.call('prepareSynchronizedGameStart',{gameType,sessionId:lobby.sessionId}),reason('participants_not_ready'));
  await players.at(-1).call(readyName,{sessionId:lobby.sessionId,ready:true});
  const seen=players.map(()=>[]),unsubscribers=[];
  for(const [i,p]of players.entries()){
    unsubscribers.push(onSnapshot(doc(p.firestore,'gameStartStates',`${gameType}__${lobby.sessionId}`),snapshot=>{
      if(snapshot.exists()){const state=normalizeGameStartState(snapshot.data());assert.ok(state,'Every client accepts the server start schema');seen[i].push(state);}
    },error=>{throw error;}));
  }
  try{
    const prepared=await host.call('prepareSynchronizedGameStart',{gameType,sessionId:lobby.sessionId});
    assert.equal(prepared.phase,'preparing');assert.equal(prepared.participantCount,players.length);
    assert.equal((await host.call('prepareSynchronizedGameStart',{gameType,sessionId:lobby.sessionId})).startAttemptId,prepared.startAttemptId);
    for(const p of players){await p.call('acknowledgeSynchronizedGameStart',{gameType,sessionId:lobby.sessionId,startAttemptId:prepared.startAttemptId});}
    const all=await Promise.all(players.map(p=>getDocFromServer(doc(p.firestore,'gameStartStates',`${gameType}__${lobby.sessionId}`))));
    const scheduled=all.map(snapshot=>normalizeGameStartState(snapshot.data()));
    assert.ok(scheduled.every(s=>s.phase==='scheduled'&&s.acknowledgedCount===players.length));
    assert.ok(scheduled.every(s=>s.gameplayStartsAtMs===scheduled[0].gameplayStartsAtMs&&s.countdownStartsAtMs===scheduled[0].countdownStartsAtMs),'Every participant receives one shared timeline');
    const duplicate=await players[0].call('acknowledgeSynchronizedGameStart',{gameType,sessionId:lobby.sessionId,startAttemptId:prepared.startAttemptId});
    assert.equal(duplicate.startAttemptId,prepared.startAttemptId);assert.equal(duplicate.acknowledgedCount,players.length);
    const phases=new Set();
    while(Date.now()<scheduled[0].gameplayStartsAtMs+120){
      const now=Date.now(),visible=scheduled.map(s=>deriveGameStartVisiblePhase(s,now));
      assert.ok(visible.every(phase=>phase===visible[0]),'Clients advance together');phases.add(visible[0]);
      await new Promise(resolve=>setTimeout(resolve,75));
    }
    assert.ok(['3','2','1','go','active'].every(phase=>phases.has(phase)),'Real server timing reaches the complete countdown without changing test clocks or deadlines');
    assert.ok(seen.every(states=>states.some(s=>s.phase==='scheduled')),'All authenticated realtime listeners observe the scheduled start');
    return scheduled[0];
  }finally{unsubscribers.forEach(unsubscribe=>unsubscribe());}
}
async function open(gameType,players){
  const lobby=await players[0].call('createGameLobby',{gameType,squadId,idempotencyKey:`release-${gameType}`});
  for(const p of players.slice(1))await p.call('joinGameLobbyById',{gameType,squadId,lobbyId:lobby.lobbyId});
  return lobby;
}
async function rematchAndLeave(gameType,lobby,players){
  const next=await players[0].call('startGameLobbyRematch',{lobbyId:lobby.lobbyId});
  assert.equal(next.lobbyId,lobby.lobbyId);assert.equal(next.joinCode,lobby.joinCode);assert.notEqual(next.sessionId,lobby.sessionId);
  for(const p of players){const membership=(await db.collection('activeGameLobbyMemberships').doc(p.uid).get()).data();assert.equal(membership.sessionId,next.sessionId,'Play Again preserves membership in a fresh round');}
  if(gameType==='triviaBlitz'){
    const roster=await db.collection('sessions').doc(next.sessionId).collection('games').doc('triviaBlitz').collection('players').get();assert.ok(roster.docs.every(p=>p.data().ready===false));
  }else{
    const roster=(await rtdb.ref(`gameSessions/${next.sessionId}/players`).get()).val();assert.ok(Object.values(roster).every(p=>p.isReady===false));
  }
  for(const p of players){await p.call('leaveGameLobby',{lobbyId:lobby.lobbyId});assert.equal((await db.collection('activeGameLobbyMemberships').doc(p.uid).get()).exists,false);}
  await players[0].call('leaveGameLobby',{lobbyId:lobby.lobbyId});
}
async function bomb(players){
  const lobby=await open('bombDefusal',players);await synchronize('bombDefusal',lobby,players);
  for(let index=0;index<6;index++){
    const views=await Promise.all(players.map(p=>p.call('getBombDefusalPlayerView',{sessionId:lobby.sessionId,locale:'en'})));
    const defuser=views.findIndex(v=>v.role==='defuser');assert.notEqual(defuser,-1);assert.equal(views.filter(v=>v.role==='expert').length,1);
    const command=(await rtdb.ref(`gameSessionSecrets/${lobby.sessionId}/bombSteps/${index}`).get()).val();
    const value=command.validation?.kind==='word'?command.validation.answer.en:command.validation?.kind==='cipher'?command.validation.decoded.en:null;
    const action=command.responseMode==='text'?{value}:{optionId:command.correctOptionId};
    const payload={sessionId:lobby.sessionId,commandId:views[defuser].commandId,action,submissionId:`release-bomb-${index}`};
    const result=await players[defuser].call('submitBombDefusalStep',payload);assert.equal(result.correct,true);assert.equal(result.outcome,index===5?'defused':'playing');
    if(index===0)assert.deepEqual(await players[defuser].call('submitBombDefusalStep',payload),result,'A repeated answer cannot apply twice');
  }
  const view=await players[0].call('getBombDefusalPlayerView',{sessionId:lobby.sessionId});assert.equal(view.outcome,'defused');assert.equal(view.correctCommandCount,6);
  await rematchAndLeave('bombDefusal',lobby,players);return {game:'Bomb Defusal',players:players.length,commands:6,countdown:'passed',round:'defused',rematch:true,leave:true};
}
async function trivia(players){
  const lobby=await open('triviaBlitz',players);await synchronize('triviaBlitz',lobby,players);
  const parent=db.collection('sessions').doc(lobby.sessionId),game=parent.collection('games').doc('triviaBlitz');
  const questions=(await db.collection('triviaGameSecrets').doc(lobby.sessionId).get()).data().selectedQuestions;
  for(let index=0;index<questions.length;index++){
    const state=(await game.get()).data();assert.equal(state.questionIndex,index);assert.equal('answer' in state.currentQuestion,false);
    const player=players[state.turnIndex];assert.ok(player);
    const answer=index===1?(questions[index].answer+1)%questions[index].options_en.length:questions[index].answer;
    const result=await player.call('submitTriviaAnswer',{sessionId:lobby.sessionId,questionIndex:index,answerIndex:answer,submissionId:`release-trivia-${index}`});assert.equal(result.correct,answer===questions[index].answer);
    await players[0].call('advanceTriviaGameSession',{sessionId:lobby.sessionId,questionIndex:index});
  }
  const state=(await game.get()).data();assert.equal(state.status,'results');assert.equal(state.answeredQuestions,10);assert.equal(state.currentQuestion,null);
  const scores=await game.collection('players').get();assert.ok(scores.docs.every(p=>p.data().score===state.totalPoints));
  await rematchAndLeave('triviaBlitz',lobby,players);return {game:'Trivia Blitz',players:players.length,questions:10,countdown:'passed',round:'results',correctAndIncorrectAnswers:true,scores:true,rematch:true,leave:true};
}
async function spot(players){
  const lobby=await open('spotTheDifferences',players);await synchronize('spotTheDifferences',lobby,players);
  const session=(await rtdb.ref(`gameSessions/${lobby.sessionId}`).get()).val();
  const scene=getCanonicalSpotScene(session.gameState.sceneId);assert.ok(scene&&scene.differences.length===10);
  const hostTeam=session.players[players[0].uid].teamId;
  const opponent=players.find(p=>session.players[p.uid].teamId!==hostTeam);assert.ok(opponent);
  const first=scene.differences[0];
  await assert.rejects(()=>get(ref(opponent.database,`gameSessionTeamState/${lobby.sessionId}/${hostTeam}`)),error=>/permission.denied|PERMISSION_DENIED/i.test(String(error?.message)),'Opponents cannot read the other team discoveries during gameplay');
  assert.equal((await opponent.call('recordSpotDifferenceFound',{sessionId:lobby.sessionId,x:first.x,y:first.y})).found,true);
  for(const [index,difference] of scene.differences.entries()){
    const payload={sessionId:lobby.sessionId,x:difference.x,y:difference.y};
    const found=await players[0].call('recordSpotDifferenceFound',payload);assert.equal(found.found,true);assert.equal(found.foundCount,index+1);
    if(index===0){const duplicate=await players[0].call('recordSpotDifferenceFound',payload);assert.equal(duplicate.alreadyFound,true);assert.equal(duplicate.foundCount,1);}
  }
  const finished=(await rtdb.ref(`gameSessions/${lobby.sessionId}`).get()).val();assert.equal(finished.status,'completed');assert.equal(finished.gameState.result.winnerTeamId,hostTeam);
  assert.equal((await get(ref(opponent.database,`gameSessionTeamState/${lobby.sessionId}/${hostTeam}`))).exists(),true,'After completion participants may review the round results');
  await rematchAndLeave('spotTheDifferences',lobby,players);return {game:'Spot the Differences',players:players.length,differences:10,countdown:'passed',round:'completed',teamWin:true,rematch:true,leave:true};
}
(async()=>{
  await loadLocalDatabaseRules();
  await db.collection('squads').doc(squadId).set({venueName:'Synthetic Release Field',isActive:true});
  const players=await Promise.all([0,1,2,3].map(client));
  const results=[];
  results.push(await bomb(players.slice(0,3)));console.log(JSON.stringify(results.at(-1)));
  results.push(await trivia(players.slice(0,3)));console.log(JSON.stringify(results.at(-1)));
  results.push(await spot(players));console.log(JSON.stringify(results.at(-1)));
  console.log(JSON.stringify({verified:true,project,games:results,liveWrites:0,appBuilds:0,artificialCountdownChanges:0}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await Promise.all(apps.map(app=>deleteApp(app)));await admin.app().delete();process.exit(process.exitCode??0);});
