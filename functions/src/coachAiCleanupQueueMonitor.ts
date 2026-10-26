// Read-only core: no writer, Auth, vendor client, scheduler or deployment binding.
export const CLEANUP_COLLECTIONS = {
  fences: 'coachAiBillingEnrollments', queue: 'coachAiBillingDeletionQueue',
  events: 'coachAiBillingEvents', reviews: 'coachAiInternalConfig/cleanupReviews/items',
  paidRequests: 'coachAiPaidRequests',
} as const;
export type CleanupKind = keyof typeof CLEANUP_COLLECTIONS;
export type CleanupRow = { id: string; data: Record<string, unknown> };
export type CleanupInventory = Record<CleanupKind, CleanupRow[]>;
export const CLEANUP_SCAN_LIMIT = 500;
export const CLEANUP_FIELDS = ['state','status','attemptState','createdAt','fencedAt','attemptedAt','receivedAt',
  'localCleanupCompletedAt','vendorCleanupRequired','closedAt','retentionDueAt','completedAt','approvedAtMs',
  'consumedAt','expiresAt','retentionHold','legalHold','retentionException.nextReviewAt','startedAt','leaseUntilMs'];
export function cleanupMillis(value: unknown): number | null {
  let n: unknown = value;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') n = value.toMillis();
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
}
const fmt = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function localParts(ms: number) {
  const p = Object.fromEntries(fmt.formatToParts(ms).map(x => [x.type,x.value]));
  return { day: Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day)), hour:Number(p.hour), minute:Number(p.minute) };
}
function weekday(day: number) { const d=new Date(day).getUTCDay(); return d!==0 && d!==6; }
// End of next business day (4 PM Eastern); weekends first enter Monday's queue.
// Holidays are not configured: this is the approved Monday-Friday schedule.
export function cleanupReviewOverdue(created: number, now: number, businessDays = 1) {
  const start=localParts(created), current=localParts(now); let due=start.day, remaining=businessDays;
  while(remaining>0) { due+=86400000; if(weekday(due)) remaining--; }
  return current.day>due || current.day===due && current.hour>=16;
}
export function cleanupNoticeWindow(now: number) {
  const p=localParts(now); return weekday(p.day) && (p.hour===9 || p.hour===16) && p.minute===0;
}
export async function readCleanupInventory(db: FirebaseFirestore.Firestore): Promise<CleanupInventory> {
  const id: unknown = 'projectId' in db ? db.projectId : undefined;
  if (typeof id!=='string' || id!=='sideline-social-staging-2026' && !id.startsWith('demo-')) throw Error('cleanup_project_mismatch');
  const entries = await Promise.all((Object.keys(CLEANUP_COLLECTIONS) as CleanupKind[]).map(async kind => {
    const collection = db.collection(CLEANUP_COLLECTIONS[kind]);
    const query = kind==='paidRequests' ? collection.where('status','==','processing') : collection;
    const snap = await query.select(...CLEANUP_FIELDS).limit(CLEANUP_SCAN_LIMIT+1).get();
    return [kind, snap.docs.map(doc => ({id:doc.id,data:doc.data()}))] as const;
  }));
  return Object.fromEntries(entries) as CleanupInventory;
}
export function summarizeCleanupQueue(inventory: CleanupInventory, now: number) {
  const counts = {pendingCleanup:0,pendingEvents:0,held:0,overdueReview:0,technicalEscalation:0,
    dueReceipts:0,dueReviews:0,overdueExceptions:0,inconsistent:0,malformed:0,stalledGeneration:0};
  if (!Number.isSafeInteger(now) || now<=0) throw Error('invalid_monitor_clock');
  if ((Object.keys(CLEANUP_COLLECTIONS) as CleanupKind[]).some(k => !Array.isArray(inventory[k]) || inventory[k].length>CLEANUP_SCAN_LIMIT)) {
    return {health:'unknown',reason:'inventory_limit',counts:null,noticeWindow:cleanupNoticeWindow(now)};
  }
  const queues=new Map(inventory.queue.map(r=>[r.id,r.data])), fences=new Map(inventory.fences.map(r=>[r.id,r.data]));
  const held=(d:Record<string,unknown>)=>d.legalHold===true || d.retentionHold===true;
  const timestamp=(v:unknown)=>{const t=cleanupMillis(v);if(t===null || t>now){counts.malformed++;return null;}return t;};
  const pending=(d:Record<string,unknown>, fields:string[])=>{
    if(held(d))counts.held++;
    const times=fields.filter(f=>d[f]!=null).map(f=>timestamp(d[f]));
    if(!times.length){counts.malformed++;return;}
    if(times.some(t=>t===null))return;
    const oldest=Math.min(...times as number[]);
    if(cleanupReviewOverdue(oldest,now))counts.overdueReview++;
    if(cleanupReviewOverdue(oldest,now,5))counts.technicalEscalation++;
  };
  const due=(v:unknown)=>{const t=cleanupMillis(v);if(t===null){counts.malformed++;return false;}return now>=t;};
  for(const {id,data:d} of inventory.fences){
    if(d.state==='enrolled')continue;
    if(d.state!=='deleting'){counts.malformed++;continue;}
    const q=queues.get(id);
    if(q?.status==='closed') {
      const closed=timestamp(q.closedAt),fclosed=timestamp(d.closedAt),qd=cleanupMillis(q.retentionDueAt),fd=cleanupMillis(d.retentionDueAt);
      if(!closed || qd===null || fd===null || closed!==fclosed || qd!==closed+90*86400000 || fd!==qd){counts.inconsistent++;continue;}
      if(held(d)||held(q))counts.held++;
      else if(now>=qd)counts.dueReceipts++;
    } else {
      counts.pendingCleanup++; pending({...d,createdAt:q?.createdAt,attemptedAt:q?.attemptedAt,
        retentionHold:held(d)||!!q&&held(q)},['fencedAt','createdAt','attemptedAt']);
      if(typeof d.vendorCleanupRequired!=='boolean' || d.vendorCleanupRequired===true&&!q)counts.inconsistent++;
    }
  }
  for(const {id,data:d} of inventory.queue){
    if(!fences.has(id)){counts.inconsistent++;if(d.status!=='closed'){counts.pendingCleanup++;pending(d,['createdAt','attemptedAt']);}}
    if(!['processing','deletion_requested','needs_review','closed'].includes(String(d.status)))counts.malformed++;
    if(d.status!=='closed' && fences.has(id)) {
      // Original queue age can precede a repeated fence write; it must not be hidden.
      const times=[cleanupMillis(d.createdAt),cleanupMillis(d.attemptedAt)].filter((t):t is number=>t!==null);
      if(!times.length)counts.malformed++;
      else if(times.some(t=>t>now))counts.malformed++;
    }
  }
  for(const {data:d} of inventory.events){
    if(d.status==='completed' && d.attemptState==='completed'){
      const t=timestamp(d.completedAt);if(held(d))counts.held++;else if(t && now>=t+90*86400000)counts.dueReceipts++;
    }else if(d.status==='needs_review'||d.status==='processing'||d.attemptState==='processing'){
      counts.pendingEvents++;pending(d,['receivedAt','createdAt']);
    }else counts.malformed++;
  }
  for(const {data:d} of inventory.reviews){
    if(held(d)){counts.held++;continue;}
    if(d.status==='approved'){const t=timestamp(d.approvedAtMs);if(t && now>=t+15*60000)counts.dueReviews++;}
    else if(d.status==='consumed'){const t=timestamp(d.consumedAt);if(t && cleanupMillis(d.retentionDueAt)===t+90*86400000){if(due(d.retentionDueAt))counts.dueReviews++;}else counts.malformed++;}
    else counts.malformed++;
  }
  for(const {data:d} of inventory.paidRequests){
    if(d.status==='completed' || d.status==='failed')continue;
    if(d.status!=='processing'){counts.malformed++;continue;}
    const started=timestamp(d.startedAt),lease=cleanupMillis(d.leaseUntilMs);
    // A live lease is expected. Expiry identifies an uncertain outcome; it is
    // never permission to repeat generation, release quota or delete a result.
    if(started===null)continue;
    if(lease===null || lease<started || lease-started>5*60000){counts.malformed++;continue;}
    if(now>=lease){counts.stalledGeneration++;pending(d,['startedAt']);}
  }
  for(const rows of Object.values(inventory))for(const {data:d} of rows){
    const ex=d.retentionException;
    if(ex && typeof ex==='object' && 'nextReviewAt' in ex && due(ex.nextReviewAt))counts.overdueExceptions++;
  }
  return {health:counts.malformed||counts.inconsistent?'unknown':Object.values(counts).some(n=>n>0)?'attention':'healthy',
    reason:counts.malformed||counts.inconsistent?'records_need_review':'scan_complete',counts,noticeWindow:cleanupNoticeWindow(now)};
}
export function createCleanupQueueMonitor(read: () => Promise<CleanupInventory>, now = Date.now) {
  return async () => {
    try { return {schema:1,checkedAtMs:now(),...summarizeCleanupQueue(await read(),now())}; }
    catch { return {schema:1,checkedAtMs:now(),health:'unknown',reason:'read_or_validation_failed',counts:null,noticeWindow:cleanupNoticeWindow(now())}; }
  };
}
