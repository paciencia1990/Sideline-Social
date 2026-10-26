import { createHash } from 'node:crypto';
import { createCoachAiCleanupOperatorWorkflow } from './coachAiCleanupOperatorWorkflow';
import { billingCleanupRevision, BILLING_RETENTION_MS } from './coachAiBillingMaintenance';
import { CLEANUP_COLLECTIONS, CLEANUP_SCAN_LIMIT, cleanupMillis, readCleanupInventory, summarizeCleanupQueue, type CleanupKind } from './coachAiCleanupQueueMonitor';

// No Function export or live binding. A host must explicitly supply the fixed
// same-origin URL, runtime dependencies, signed-in operator session and pins.
type WorkflowOptions = Parameters<typeof createCoachAiCleanupOperatorWorkflow>[0];
type Request = {method:string;origin?:string;authorization?:string;contentType?:string;body:unknown};
const kinds = Object.keys(CLEANUP_COLLECTIONS) as CleanupKind[];
const operations = ['close','expire_cleanup','expire_event'] as const;
const keyPattern=/^[a-f0-9]{64}$/,reviewPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const states=['enrolled','deleting','processing','deletion_requested','needs_review','closed','completed','failed','approved','consumed','revoked'];
const reasons=['retention_hold','local_cleanup_incomplete','reconciliation_incomplete','vendor_completion_unverified',
  'closure_unverified','backup_dependency','identity_reuse_unverified','local_records_remain','inventory_limit','event_unresolved'];
function object(value:unknown): Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_cleanup_request');
  return value as Record<string,unknown>;
}

type StaffManifest = {
  schemaVersion: 1; operation: typeof operations[number] | 'expire_review';
  targetKind: 'cleanup' | 'event' | 'review'; key: string;
  expectedRevision: string; preparedAtMs: number; attemptLimit: 1;
};
function staffManifest(value: unknown, now: number, reconciliation: boolean): StaffManifest {
  const data = object(value);
  keys(data, ['schemaVersion','operation','targetKind','key','expectedRevision','preparedAtMs','attemptLimit']);
  const kind = data.operation === 'expire_review' ? 'review' : data.operation === 'expire_event' ? 'event' : 'cleanup';
  if (Object.keys(data).length !== 7 || data.schemaVersion !== 1 || data.attemptLimit !== 1
    || ![...operations, 'expire_review'].includes(data.operation as StaffManifest['operation'])
    || data.targetKind !== kind || typeof data.key !== 'string' || !(kind === 'review' ? reviewPattern : keyPattern).test(data.key)
    || typeof data.expectedRevision !== 'string' || !keyPattern.test(data.expectedRevision)
    || typeof data.preparedAtMs !== 'number' || !Number.isSafeInteger(data.preparedAtMs) || data.preparedAtMs <= 0
    || data.preparedAtMs > now || !reconciliation && now - data.preparedAtMs > 15 * 60_000) throw Error('invalid_cleanup_manifest');
  return data as unknown as StaffManifest;
}

// Separate, deliberately narrow factory. The old queue route never uses this.
export function createCoachAiCleanupActionInterface(options: WorkflowOptions & {origin: string}) {
  const expected = new URL(options.origin), db = options.db, now = options.now ?? Date.now;
  if (expected.origin !== options.origin || expected.protocol !== 'https:'
    && !(expected.protocol === 'http:' && ['localhost','127.0.0.1'].includes(expected.hostname))) throw Error('invalid_cleanup_origin');
  const workflow = createCoachAiCleanupOperatorWorkflow(options);
  async function snapshot(manifest: StaffManifest) {
    const selected: CleanupKind[] = manifest.targetKind === 'cleanup' ? ['fences','queue']
      : manifest.targetKind === 'event' ? ['events'] : ['reviews'];
    const values = await Promise.all(selected.map(kind => db.doc(CLEANUP_COLLECTIONS[kind] + '/' + manifest.key).get()));
    return {values: values.map(value => value.data()),
      records: values.map((value, i) => summary(selected[i], manifest.key, value.data())),
      revision: billingCleanupRevision(values.map(value => value.data()))};
  }
  return async (request: Request) => {
    const headers = {'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
    try {
      if (request.method !== 'POST' || request.origin !== expected.origin
        || request.contentType?.split(';')[0].trim() !== 'application/json') return {status:403,headers,body:{error:'cleanup_request_denied'}};
      const match = /^Bearer ([^\s]{1,8192})$/.exec(request.authorization ?? '');
      if (!match) return {status:401,headers,body:{error:'cleanup_operator_denied'}};
      const token = match[1]; await workflow.authorizeRead(token);
      const body = object(request.body);
      if (JSON.stringify(body).length > 16384) throw Error('invalid_cleanup_request');
      const action = body.action;
      if (action === 'cases') {
        keys(body, ['action']);
        return {status:200,headers,body:await readStaffQueue(db, now())};
      }
      if (action === 'prepare') {
        keys(body, ['action','targetKind','key','operation']);
        const operation = body.operation as StaffManifest['operation'];
        if (![...operations, 'expire_review'].includes(operation)) throw Error('invalid_cleanup_target');
        const targetKind = operation === 'expire_review' ? 'review' : operation === 'expire_event' ? 'event' : 'cleanup';
        if (body.targetKind !== targetKind) throw Error('invalid_cleanup_target');
        const t = target(targetKind === 'review' ? 'reviews' : targetKind === 'event' ? 'events' : 'fences', body.key);
        const preparedAtMs = now();
        const manifest: StaffManifest = {schemaVersion:1,operation,targetKind,key:t.key,
          expectedRevision:'',preparedAtMs,attemptLimit:1};
        const current = await snapshot(manifest);
        const [first, second] = current.values;
        const validDate = (value: unknown) => {
          const ms = cleanupMillis(value);
          return ms !== null && ms > 0 && ms <= preparedAtMs ? ms : null;
        };
        if (current.values.some(value => value?.legalHold === true || value?.retentionHold === true || value?.retentionException)) throw Error('cleanup_preparation_blocked');
        if (operation === 'close') {
          if (first?.state !== 'deleting' || second?.status === 'closed'
            || typeof first.vendorCleanupRequired !== 'boolean' || validDate(first.localCleanupCompletedAt) === null
            || !first.vendorCleanupRequired && second !== undefined
            || first.vendorCleanupRequired && !['processing','deletion_requested','needs_review'].includes(second?.status)) throw Error('cleanup_preparation_blocked');
        } else if (operation === 'expire_cleanup') {
          const closed = validDate(first?.closedAt), due = validDate(first?.retentionDueAt);
          if (first?.state !== 'deleting' || second?.status !== 'closed' || closed === null || due === null
            || due !== closed + BILLING_RETENTION_MS || validDate(second.closedAt) !== closed
            || validDate(second.retentionDueAt) !== due) throw Error('cleanup_preparation_blocked');
        } else if (operation === 'expire_event') {
          const completed = validDate(first?.completedAt);
          if (first?.status !== 'completed' || first.attemptState !== 'completed' || completed === null
            || preparedAtMs < completed + BILLING_RETENTION_MS) throw Error('cleanup_preparation_blocked');
        } else {
          const approved = validDate(first?.approvedAtMs), consumed = validDate(first?.consumedAt);
          if (first?.status === 'approved' ? approved === null || preparedAtMs < approved + 15 * 60_000
            : first?.status !== 'consumed' || consumed === null || validDate(first.retentionDueAt) !== consumed + BILLING_RETENTION_MS) throw Error('cleanup_preparation_blocked');
        }
        manifest.expectedRevision = current.revision;
        return {status:200,headers,body:{manifest,records:current.records,checkedAtMs:preparedAtMs}};
      }
      if (!['detail','draft','approve','execute','expire_review'].includes(action as string)) throw Error('invalid_cleanup_request');
      const reconcile = action === 'detail' && body.reconcile === true;
      const manifest = staffManifest(body.manifest, now(), reconcile);
      const allowed: Record<string,string[]> = {
        detail:['action','manifest','reviewId','reconcile'], draft:['action','manifest'],
        approve:['action','manifest','draft','facts','confirmed'], execute:['action','manifest','reviewId','confirmed'],
        expire_review:['action','manifest','clearance','confirmed'],
      };
      keys(body, allowed[action as string]);
      if (body.reconcile !== undefined && body.reconcile !== true
        || body.reviewId !== undefined && (typeof body.reviewId !== 'string' || !reviewPattern.test(body.reviewId))) throw Error('invalid_cleanup_request');
      if (['approve','execute','expire_review'].includes(action as string) && body.confirmed !== true) throw Error('cleanup_confirmation_required');
      const current = await snapshot(manifest);
      if (!reconcile && current.revision !== manifest.expectedRevision) throw Error('cleanup_review_stale');
      if (action === 'detail') {
        let review = null;
        if (body.reviewId !== undefined) {
          if (!reconcile || manifest.targetKind === 'review') throw Error('invalid_cleanup_request');
          const id = body.reviewId as string, data = (await db.doc(CLEANUP_COLLECTIONS.reviews + '/' + id).get()).data();
          if (data && (data.key !== manifest.key || data.operation !== manifest.operation)) throw Error('invalid_cleanup_review');
          review = {...summary('reviews', id, data), result: ['closed','expired','retained','not_due','absent','already_closed'].includes(data?.result) ? data!.result : null};
        }
        return {status:200,headers,body:{records:current.records,revision:current.revision,review}};
      }
      if (action === 'expire_review') {
        if (manifest.operation !== 'expire_review') throw Error('invalid_cleanup_target');
        const clearance = object(body.clearance); keys(clearance,['backupsClear']);
        if (Object.keys(clearance).length !== 1 || typeof clearance.backupsClear !== 'boolean') throw Error('invalid_cleanup_attestation');
        return {status:200,headers,body:{status:await workflow.expireReview(token, manifest.key,
          {expectedRevision:manifest.expectedRevision,backupsClear:clearance.backupsClear})}};
      }
      if (manifest.operation === 'expire_review') throw Error('invalid_cleanup_target');
      if (action === 'draft') {
        const draft = await workflow.draft(token, manifest.operation, manifest.key);
        if (draft.revision !== manifest.expectedRevision) throw Error('cleanup_review_stale');
        return {status:200,headers,body:{draft}};
      }
      if (action === 'approve') {
        const draft = object(body.draft); keys(draft,['operation','key','revision','reviewId','draftedAtMs']);
        if (draft.operation !== manifest.operation || draft.key !== manifest.key || draft.revision !== manifest.expectedRevision) throw Error('invalid_cleanup_review');
        await workflow.approve(token, draft as unknown as Parameters<typeof workflow.approve>[1],
          object(body.facts) as Parameters<typeof workflow.approve>[2]);
        return {status:200,headers,body:{status:'approved'}};
      }
      if (typeof body.reviewId !== 'string' || !reviewPattern.test(body.reviewId)) throw Error('invalid_cleanup_review');
      let uid: string | undefined;
      if (manifest.operation === 'close') {
        const [fence, queue] = current.values;
        if (fence?.vendorCleanupRequired === true) {
          if (typeof queue?.userId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(queue.userId)
            || createHash('sha256').update(queue.userId).digest('hex') !== manifest.key) throw Error('cleanup_identity_required');
          uid = queue.userId;
        } else if (fence?.vendorCleanupRequired !== false || queue !== undefined) throw Error('cleanup_identity_required');
      }
      const result = await workflow.execute(token, {operation:manifest.operation,key:manifest.key,reviewId:body.reviewId,...(uid ? {uid} : {})});
      return {status:200,headers,body:result};
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const known = ['cleanup_operator_denied','invalid_cleanup_manifest','invalid_cleanup_request','invalid_cleanup_target',
        'invalid_cleanup_review','invalid_cleanup_attestation','cleanup_review_stale','cleanup_review_changed',
        'cleanup_review_unapproved','cleanup_identity_required','cleanup_confirmation_required','cleanup_auth_inventory_limit',
        'cleanup_inventory_limit','cleanup_preparation_blocked'];
      return {status:message === 'cleanup_operator_denied' ? 403 : 409,headers,
        body:{error:known.includes(message) ? message : 'cleanup_action_stopped'}};
    }
  };
}
function keys(data:Record<string,unknown>, allowed:string[]) {if(Object.keys(data).some(k=>!allowed.includes(k)))throw Error('invalid_cleanup_request');}
function target(kind:unknown,key:unknown): {kind:CleanupKind;key:string} {
  if(!kinds.includes(kind as CleanupKind)||typeof key!=='string'||!(kind==='reviews'?reviewPattern:keyPattern).test(key))throw Error('invalid_cleanup_target');
  return {kind:kind as CleanupKind,key};
}
function summary(kind:CleanupKind,key:string,data:FirebaseFirestore.DocumentData|undefined) {
  if(!data)return {kind,key,exists:false};
  const dates:Record<string,number|null>={};
  for(const name of ['createdAt','fencedAt','attemptedAt','receivedAt','closedAt','retentionDueAt','completedAt','approvedAtMs','consumedAt','expiresAt','startedAt','leaseUntilMs'])dates[name]=cleanupMillis(data[name]);
  return {kind,key,exists:true,readOnly:kind==='paidRequests',status:states.includes(data.status)?data.status:states.includes(data.state)?data.state:'unknown',
    reason:reasons.includes(data.retentionException?.reason)?data.retentionException.reason:null,
    held:data.legalHold===true||data.retentionHold===true,
    attemptState:['processing','completed'].includes(data.attemptState)?data.attemptState:null,
    vendorCleanupRequired:typeof data.vendorCleanupRequired==='boolean'?data.vendorCleanupRequired:null,
    localCleanupComplete:cleanupMillis(data.localCleanupCompletedAt)!==null,
    retentionReviewAt:cleanupMillis(data.retentionException?.nextReviewAt),dates};
}
async function readStaffQueue(db: WorkflowOptions['db'], checkedAtMs: number) {
  const inventory = await readCleanupInventory(db);
  if (kinds.some(kind => inventory[kind].length > CLEANUP_SCAN_LIMIT)) throw Error('cleanup_inventory_limit');
  const records = kinds.flatMap(kind => inventory[kind]
    .filter(row => kind === 'paidRequests' ? row.data.status === 'processing' : kind !== 'fences' || row.data.state !== 'enrolled')
    .map(row => { target(kind, row.id); return summary(kind, row.id, row.data); }));
  return {records,health:summarizeCleanupQueue(inventory,checkedAtMs),checkedAtMs};
}
export function createCoachAiCleanupInterface(options: WorkflowOptions & {origin:string}) {
  const expected=new URL(options.origin);
  if(expected.origin!==options.origin || expected.protocol!=='https:' && !(['localhost','127.0.0.1'].includes(expected.hostname)&&expected.protocol==='http:'))throw Error('invalid_cleanup_origin');
  const workflow=createCoachAiCleanupOperatorWorkflow(options),db=options.db,now=options.now??Date.now;
  return async (request:Request) => {
    const headers={'Cache-Control':'no-store','Content-Type':'application/json','X-Content-Type-Options':'nosniff'};
    try {
      if(request.method!=='POST'||request.origin!==expected.origin||request.contentType?.split(';')[0].trim()!=='application/json')return {status:403,headers,body:{error:'cleanup_request_denied'}};
      const match=/^Bearer ([^\s]{1,8192})$/.exec(request.authorization??'');
      if(!match)return {status:401,headers,body:{error:'cleanup_operator_denied'}};
      const token=match[1];
      await workflow.authorizeRead(token);
      const body=object(request.body);if(JSON.stringify(body).length>16384)throw Error('invalid_cleanup_request');
      const action=body.action;
      if(action==='list') {
        keys(body,['action']);
        return {status:200,headers,body:await readStaffQueue(db,now())};
      }
      if(action==='detail') {
        keys(body,['action','kind','key','reviewId']);const t=target(body.kind,body.key);
        const paths=t.kind==='fences'||t.kind==='queue'?['fences','queue'] as CleanupKind[]:[t.kind];
        const records=await Promise.all(paths.map(async kind=>summary(kind,t.key,(await db.doc(CLEANUP_COLLECTIONS[kind]+'/'+t.key).get()).data())));
        let review=null;
        if(body.reviewId!==undefined){const rt=target('reviews',body.reviewId);review=summary(rt.kind,rt.key,(await db.doc(CLEANUP_COLLECTIONS.reviews+'/'+rt.key).get()).data());}
        return {status:200,headers,body:{records,review}};
      }
      if(action==='draft') {
        keys(body,['action','operation','key']);
        if(!operations.includes(body.operation as typeof operations[number]))throw Error('invalid_cleanup_target');
        const t=target(body.operation==='expire_event'?'events':'fences',body.key);
        const draft=await workflow.draft(token,body.operation as typeof operations[number],t.key);
        return {status:200,headers,body:{draft}};
      }
      if(action==='approve') {
        keys(body,['action','draft','facts']);const draft=object(body.draft);
        keys(draft,['operation','key','revision','reviewId','draftedAtMs']);
        await workflow.approve(token,draft as unknown as Parameters<typeof workflow.approve>[1],object(body.facts) as Parameters<typeof workflow.approve>[2]);
        return {status:200,headers,body:{status:'approved'}};
      }
      if(action==='execute') {
        keys(body,['action','target','confirmed']);const requested=object(body.target);
        keys(requested,['operation','key','reviewId','uid']);
        if(requested.operation!=='close' && body.confirmed!==true)throw Error('cleanup_confirmation_required');
        if(requested.operation==='close'){
          const t=target('queue',requested.key),queue=(await db.doc(CLEANUP_COLLECTIONS.queue+'/'+t.key).get()).data();
          // UID stays server-side when the unresolved queue already supplies it.
          const uid=queue?.userId??requested.uid;
          if(typeof uid!=='string'||createHash('sha256').update(uid).digest('hex')!==t.key)throw Error('cleanup_identity_required');
          requested.uid=uid;
        }
        const result=await workflow.execute(token,requested as unknown as Parameters<typeof workflow.execute>[1]);
        return {status:200,headers,body:result};
      }
      if(action==='expire_review'){
        keys(body,['action','reviewId','confirmed']);const t=target('reviews',body.reviewId);
        if(body.confirmed!==true)throw Error('cleanup_confirmation_required');
        return {status:200,headers,body:{status:await workflow.expireReview(token,t.key)}};
      }
      throw Error('invalid_cleanup_request');
    }catch(error){
      const known=['cleanup_operator_denied','cleanup_operator_pins_required','invalid_cleanup_target','invalid_cleanup_request',
        'invalid_cleanup_review','invalid_cleanup_attestation','cleanup_review_stale','cleanup_review_changed','cleanup_review_unapproved',
        'cleanup_inventory_limit','cleanup_identity_required','cleanup_confirmation_required'];
      const message=error instanceof Error?error.message:'';
      // No request/body/token/provider error logging or echo. Uncertainty stops the action.
      return {status:message==='cleanup_operator_denied'?403:409,headers,body:{error:known.includes(message)?message:'cleanup_action_stopped'}};
    }
  };
}
