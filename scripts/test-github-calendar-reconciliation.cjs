"use strict";
// Only reconciliation behavior: actual pure modules, fictional data, mocked SDK.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function load(file,modules={}){
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}});
 assert.deepEqual((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error),[],file);
 const module={exports:{}};
 new Function('require','module','exports',result.outputText)(name=>{assert.ok(Object.hasOwn(modules,name),'unmocked_dependency:'+name);return modules[name];},module,module.exports);
 return module.exports;
}
function actualFunctions(file,names,scope={}){
 const text=fs.readFileSync(path.join(root,file),'utf8');
 const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 assert.equal(source.parseDiagnostics.length,0,file);
 const declarations=names.map(name=>{const node=source.statements.find(value=>ts.isFunctionDeclaration(value)&&value.name?.text===name);assert.ok(node,'missing_function:'+name);return node.getText(source).replace(/^export\s+/u,'');});
 const code=ts.transpileModule(declarations.join('\n')+'\nmodule.exports={'+names.join(',')+'};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('module',...Object.keys(scope),code)(module,...Object.values(scope));return module.exports;
}
const calendar=load('functions/src/teamCalendarCore.ts',{'node:crypto':require('node:crypto'),'node:net':{isIP:require('node:net').isIP}});
const display=load('utils/teamScheduleDisplay.ts');
const calendarDisplay=load('utils/teamCalendarDisplay.ts');
const personal=load('utils/teamScheduleCalendarCore.ts');
class FakeTimestamp{constructor(ms){this.ms=ms;}static fromDate(date){return new FakeTimestamp(date.getTime());}static fromMillis(ms){return new FakeTimestamp(ms);}toDate(){return new Date(this.ms);}toMillis(){return this.ms;}}
const backend=actualFunctions('functions/src/teamCalendar.ts',['externalEventFields','previewEvents','calendarNotes','safeString','formatDate'],{Timestamp:FakeTimestamp});
function normalize(raw){
 let emit,output,stops=0;
 const opaque=(...parts)=>parts;
 const sdk={collection:opaque,doc:opaque,documentId:()=>'(documentId)',where:opaque,orderBy:opaque,limit:opaque,query:opaque,Timestamp:FakeTimestamp,onSnapshot(_query,next){emit=next;return ()=>{stops++;};}};
 const service=load('services/teamScheduleService.ts',{'expo-crypto':{},'firebase/firestore':sdk,'firebase/functions':{},'@/config/firebase':{auth:{currentUser:{uid:'fictional_coach'}},db:{},functions:{}},'@/constants/teamHistoryPagination':{TEAM_HISTORY_PAGE_SIZES:{upcomingSchedule:10}},'@/utils/teamScheduleCore':{},'@/utils/teamCalendarDisplay':calendarDisplay});
 const stop=service.subscribeToUpcomingTeamSchedule('fictional_team',(page)=>{output=page.events[0];},error=>{throw error;});
 emit({docs:[{id:'fictional_event',data:()=>raw}],size:1,metadata:{fromCache:false}});stop();assert.equal(stops,1);assert.ok(output);
 return {event:output,service};
}
const input={teamId:'fictional_team',actorUserId:'fictional_coach',integrationId:'fictional_integration',sourceType:'ics-file'};
const now=FakeTimestamp.fromMillis(Date.parse('2027-03-01T00:00:00Z'));
function ics({zone='',start='20270314T180000Z',end='20270314T200000Z',allDay=false,description='Source field notes'}={}){
 return ['BEGIN:VCALENDAR','VERSION:2.0',...(zone?['X-WR-TIMEZONE:'+zone]:[]),'BEGIN:VEVENT','UID:fictional_merge_event',(allDay?'DTSTART;VALUE=DATE:':'DTSTART:')+start,(allDay?'DTEND;VALUE=DATE:':'DTEND:')+end,'SUMMARY:Fictional merge event','DESCRIPTION:'+description,'END:VEVENT','END:VCALENDAR',''].join('\r\n');
}
const parsed=options=>{const result=calendar.parseTeamCalendarIcs(ics(options));assert.equal(result.events.length,1);return result.events[0];};
const fields=(event,existing=null)=>backend.externalEventFields(input,event,existing,now);
const payload=event=>personal.buildTeamScheduleCalendarPayload(event,'Cancelled');
const groups=[];
async function test(name,run){await run();groups.push(name);}
async function main(){
 await test('utc_import_metadata_survives_normalization_without_rewriting_edit_or_export_zone',()=>{
  const imported=parsed(),raw=fields(imported),{event,service}=normalize(raw);
  assert.equal(imported.displayInViewerTimezone,true);assert.equal(raw.displayInViewerTimezone,true);assert.equal(event.displayInViewerTimezone,true);
  assert.equal(event.timezone,'UTC');assert.equal(event.startAt.getTime(),Date.parse('2027-03-14T18:00:00Z'));
  assert.equal(service.scheduleDraftFromEvent(event).timezone,'UTC');assert.equal(service.scheduleDraftFromEvent(event).startTime,'18:00');
  assert.equal(payload(event).timeZone,'UTC');assert.equal(payload(event).startDate.getTime(),event.startAt.getTime());
 });
 await test('declared_calendar_zone_retains_utc_instant_while_latest_ui_uses_phone_zone',()=>{
  const imported=parsed({zone:'America/New_York'}),{event,service}=normalize(fields(imported));
  assert.equal(imported.startAtMillis,Date.parse('2027-03-14T18:00:00Z'));assert.equal(imported.displayInViewerTimezone,false);
  assert.equal(event.timezone,'America/New_York');assert.equal(event.displayInViewerTimezone,false);
  assert.equal(service.scheduleDraftFromEvent(event).startTime,'14:00');assert.equal(payload(event).timeZone,'America/New_York');
  assert.equal(display.scheduleDisplayTimeZone(event,'America/Los_Angeles'),'America/Los_Angeles');
  const preview={startAtMillis:imported.startAtMillis,timezone:event.timezone,isAllDay:false};
  assert.match(display.formatSchedulePreview(preview,'en-US','America/Los_Angeles'),/11:00/);
 });
 await test('all_day_source_date_remains_fixed_across_phone_zones_and_personal_export',()=>{
  const imported=parsed({zone:'Asia/Tokyo',start:'20270315',end:'20270316',allDay:true}),{event}=normalize(fields(imported));
  assert.equal(imported.displayInViewerTimezone,false);assert.equal(event.timezone,'Asia/Tokyo');assert.equal(event.isAllDay,true);
  const preview={startAtMillis:imported.startAtMillis,timezone:event.timezone,isAllDay:true};
  const expected=display.formatSchedulePreview(preview,'en-US','Asia/Tokyo');assert.match(expected,/Mar 15, 2027/);
  for(const phone of ['America/Los_Angeles','America/New_York','Pacific/Honolulu'])assert.equal(display.formatSchedulePreview(preview,'en-US',phone),expected);
  assert.equal(payload(event).allDay,true);assert.equal(payload(event).timeZone,'Asia/Tokyo');
 });
 await test('source_and_coach_notes_remain_distinct_and_are_deduplicated_in_exports',()=>{
  const raw=fields(parsed(),{notes:'Coach instructions'}),{event}=normalize(raw);
  assert.equal(event.sourceDescription,'Source field notes');assert.equal(event.notes,'Coach instructions');
  assert.equal(payload(event).notes,'Source field notes\n\nCoach instructions');assert.equal(backend.calendarNotes(raw),payload(event).notes);
  const same={...event,notes:event.sourceDescription};assert.equal(payload(same).notes,'Source field notes');
  const exportText=calendar.serializeTeamScheduleIcs({calendarName:'Fictional calendar',domain:'example.invalid',events:[{id:'fictional_event',title:event.title,startAtMillis:event.startAt.getTime(),endAtMillis:event.endAt.getTime(),timezone:event.timezone,isAllDay:event.isAllDay,notes:backend.calendarNotes(raw),updatedAtMillis:now.toMillis()}]});
  assert.equal(calendar.parseTeamCalendarIcs(exportText).events[0].description,'Source field notes\n\nCoach instructions');
 });
 await test('preview_transport_keeps_remote_metadata_and_current_phone_formatting_path',()=>{
  const imported=parsed(),preview=backend.previewEvents([imported])[0];
  assert.equal(preview.displayInViewerTimezone,true);assert.equal(preview.timezone,'UTC');assert.equal(preview.startAtMillis,imported.startAtMillis);
  const ny=display.formatSchedulePreview(preview,'en-US','America/New_York'),la=display.formatSchedulePreview(preview,'en-US','America/Los_Angeles');
  assert.match(ny,/2:00/);assert.match(la,/11:00/);assert.notEqual(ny,la);assert.equal(preview.timezone,'UTC');
 });
 await test('merged_preview_screens_keep_device_hook_and_shared_formatter',()=>{
  for(const file of ['app/teams/[teamId]/schedule/connect.tsx','app/teams/[teamId]/schedule/import-ics.tsx']){
   const text=fs.readFileSync(path.join(root,file),'utf8'),source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);assert.equal(source.parseDiagnostics.length,0,file);
   let hook=false,formatter=false;function visit(node){if(ts.isCallExpression(node)){if(node.expression.getText(source)==='useDeviceTimeZone')hook=true;if(node.expression.getText(source)==='formatSchedulePreview')formatter=node.arguments.map(v=>v.getText(source)).join('|')==='event|i18n.language|deviceTimeZone';}ts.forEachChild(node,visit);}visit(source);
   assert.equal(hook,true,file);assert.equal(formatter,true,file);assert.equal(text.includes('timeZone: displayCalendarTimezone('),false,file);
  }
 });
 await test('detail_and_translations_retain_calendar_notes_after_phone_zone_merge',()=>{
  const text=fs.readFileSync(path.join(root,'app/teams/[teamId]/schedule/[eventId].tsx'),'utf8');
  assert.match(text,/event\.sourceDescription\s*&&\s*event\.sourceDescription\s*!==\s*event\.notes/);assert.match(text,/schedule\.form\.sourceNotes/);assert.match(text,/scheduleDisplayTimeZone\(event, deviceTimeZone\)/);
  const i18n=fs.readFileSync(path.join(root,'i18n/index.ts'),'utf8');assert.match(i18n,/sourceNotes:\s*'Calendar notes'/);assert.match(i18n,/sourceNotes:\s*'Notas del calendario'/);
 });
 return {status:'PASS',groups:groups.length,cases:groups,networkRequests:0,deviceCommands:0,builds:0,deployments:0,retries:0};
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:'FAIL',completed:groups,message:error.message}));process.exitCode=1;});
module.exports={main};
