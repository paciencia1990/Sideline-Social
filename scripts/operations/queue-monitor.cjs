'use strict';
// This observer never writes application data or invokes moderation workers.
const project='sideline-social-staging-2026';
const specs=[
 {key:'requests',collection:'moderationActionRequests',field:'status',states:['queuedForExecution','executing','retryPending']},
 {key:'outbox',collection:'moderationActionOutbox',field:'status',states:['pending','queuedForExecution','executing','retryPending']},
 {key:'alerts',collection:'moderationAlerts',field:'deliveryStatus',states:['queued','sending']},
 {key:'evidence',collection:'moderationEvidenceCaptureQueue',field:'captureState',states:['requested','capturing']},
];
const thresholdSeconds=600, queryLimit=501;
function query(spec){return {structuredQuery:{from:[{collectionId:spec.collection}],where:{fieldFilter:{field:{fieldPath:spec.field},op:'IN',value:{arrayValue:{values:spec.states.map(stringValue=>({stringValue}))}}}},select:{fields:['createdAt','updatedAt'].map(fieldPath=>({fieldPath}))},limit:queryLimit}};}
function summarize(rows,now=Date.now()){
 const docs=rows.filter(r=>r.document);let stale=0,invalid=0;
 for(const row of docs){const f=row.document.fields||{},raw=f.updatedAt?.timestampValue??f.createdAt?.timestampValue;const t=Date.parse(raw);if(!Number.isFinite(t)||t>now+60000)invalid++;else if(now-t>=thresholdSeconds*1000)stale++;}
 return {pending:docs.length,stale,invalid,overflow:docs.length>=queryLimit?1:0};
}
const expr=s=>'${'+s+'}';
function workflow(){
 const fields={};for(const s of specs){for(const metric of ['pending','stale','invalid','overflow'])fields[s.key+'_'+metric]=0;}
 const scan=[];
 for(const s of specs){
  const prefix=s.key;
  scan.push({[prefix+'_query']:{call:'http.post',args:{url:`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery`,auth:{type:'OAuth2'},timeout:30,body:query(s)},result:'reply'}});
  scan.push({[prefix+'_loop']:{for:{value:'row',in:expr('reply.body'),steps:[
   {[prefix+'_has_document']:{switch:[{condition:expr('map.get(row, "document") != null'),steps:[
    {[prefix+'_read_time']:{assign:[{['counts.'+prefix+'_pending']:expr('counts.'+prefix+'_pending + 1')},{stamp:expr('default(map.get(row, ["document", "fields", "updatedAt", "timestampValue"]), map.get(row, ["document", "fields", "createdAt", "timestampValue"]))')}]}},
    {[prefix+'_classify']:{switch:[
     {condition:expr('stamp == null'),assign:[{['counts.'+prefix+'_invalid']:expr('counts.'+prefix+'_invalid + 1')}]},
     {condition:expr('stamp != null'),steps:[
      {[prefix+'_parse_time']:{assign:[{seconds:expr('time.parse(stamp)')}]}},
      {[prefix+'_age']:{switch:[{condition:expr('seconds > now + 60'),assign:[{['counts.'+prefix+'_invalid']:expr('counts.'+prefix+'_invalid + 1')}]},{condition:expr('seconds <= now - '+thresholdSeconds),assign:[{['counts.'+prefix+'_stale']:expr('counts.'+prefix+'_stale + 1')}]}]}}
     ]}
    ]}}
   ]}]}}
  ]}}});
  scan.push({[prefix+'_limit']:{switch:[{condition:expr('counts.'+prefix+'_pending >= '+queryLimit),assign:[{['counts.'+prefix+'_overflow']:1}]}]}});
 }
 const issues=specs.flatMap(s=>['stale','invalid','overflow'].map(k=>'counts.'+s.key+'_'+k)).join(' + ');
 const log=(event,severity,payload)=>({call:'http.post',args:{url:'https://logging.googleapis.com/v2/entries:write',auth:{type:'OAuth2'},timeout:30,body:{logName:`projects/${project}/logs/sideline-operations-observer`,resource:{type:'global',labels:{project_id:project}},entries:[{severity,jsonPayload:{event,...payload}}]}},result:'logResult'});
 const definition={main:{steps:[
  {initialize:{assign:[{now:expr('sys.now()')},{counts:fields}]}},
  {observe:{try:{steps:scan},except:{as:'error',steps:[{failure:log('sideline_queue_probe_failed','ERROR',{reason:'read_or_validation_failed'})},{stop:{raise:'queue_probe_failed'}}]}}},
  {aggregate:{assign:[{issues:expr(issues)},{reply:null},{row:null}]}},
  {heartbeat:log('sideline_queue_health',expr('if(issues > 0, "WARNING", "INFO")'),{schema:1,issueCount:expr('issues'),counts:expr('counts'),thresholdSeconds})},
  {finish:{return:expr('counts')}}
 ]}};
 // Workflows switch branches accept nested steps, not inline assignments.
 let branch=0;function normalize(v){if(!v||typeof v!=='object')return;if(v.switch)for(const choice of v.switch){if(choice.assign){choice.steps=[{['branch_'+(++branch)]:{assign:choice.assign}}];delete choice.assign;}}for(const child of Object.values(v))normalize(child);}
 normalize(definition);return definition;
}
const caughtMessages=[
 'moderation_action_execution_failed','moderation_evidence_capture_failed',
 'moderation_image_derivative_failed','moderation_standing_projection_deferred',
 'apple_authorization_revocation_failed','trivia_game_unexpected_failure',
 'Team translation provider unavailable','Team translation backend unavailable',
 'team_lifecycle_reconciliation_incomplete','private_team_notification_deferred',
 'coach_ai_help_failed',
];
const caughtFilter='(resource.type="cloud_function" OR resource.type="cloud_run_revision") AND ('+
 caughtMessages.map(x=>'jsonPayload.message='+JSON.stringify(x)).join(' OR ')+
 ' OR (jsonPayload.message="moderation_alert_delivery_outcome" AND (jsonPayload.category="rejected" OR jsonPayload.category="ambiguous"))'+
 ' OR ((jsonPayload.message="moderation_execution_delivery" OR jsonPayload.message="moderation_standing_delivery") AND jsonPayload.outcome="threw"))';
module.exports={project,specs,thresholdSeconds,queryLimit,query,summarize,workflow,caughtFilter};
