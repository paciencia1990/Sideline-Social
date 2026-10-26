import { createHash } from 'node:crypto'

// Pure policy/operation logic. This module has no Firebase initialization or I/O.
export const RETENTION_POLICY = 'moderation-retention-v1'
export const DAY_MS = 86_400_000
export type RecordData = Record<string, any>
export type RetentionEvent = 'open' | 'resolve' | 'preserve' | 'release' | 'touch'
export type Phase = 'evidence' | 'decision'
export type Kind = 'case' | 'evidence' | 'report' | 'note' | 'appeal' | 'action' |
  'request' | 'outbox' | 'idempotency' | 'enforcement' | 'audit' | 'link' | 'queue' | 'grant' | 'notice' | 'hold' | 'receipt'
export class RetentionBlocked extends Error {
  constructor(public readonly category: string) { super(category); this.name = 'RetentionBlocked' }
}
export function millis(value: unknown): number | null {
  const n = typeof value === 'number' ? value : value && typeof (value as any).toMillis === 'function'
    ? (value as any).toMillis() : NaN
  return Number.isSafeInteger(n) && n > 0 && n <= 8_640_000_000_000_000 ? n : null
}
export function anniversary12Months(at: number): number {
  if (millis(at) === null) throw new RetentionBlocked('invalid_resolution_time')
  const d = new Date(at)
  const year = d.getUTCFullYear() + 1
  const month = d.getUTCMonth()
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate())
  const result = Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())
  if (millis(result) === null) throw new RetentionBlocked('invalid_anniversary')
  return result
}
export function lifecyclePatch(data: RecordData, event: RetentionEvent, at: number, reference: string): RecordData {
  if (event === 'touch') return {}
  if (millis(at) === null || !reference || reference.length > 600) throw new RetentionBlocked('invalid_resolution_event')
  const revision = data.retentionRevision == null ? 0 : data.retentionRevision
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) throw new RetentionBlocked('invalid_retention_revision')
  const patch: RecordData = { retentionPolicyId: RETENTION_POLICY, retentionRevision: revision + 1,
    retentionIntentAtMs: at, retentionIntentReference: reference }
  // Preserve an uncertain operation reference: no clock/lease may make it replayable.
  if (data.retentionDispositionId) patch.retentionInterruptedDispositionId = data.retentionDispositionId
  if (event === 'open') return { ...patch, retentionState: 'open', finalResolutionAtMs: null,
    finalResolutionEventReference: null, evidenceDueAtMs: null, decisionDueAtMs: null, retentionExpiresAt: null }
  if (event === 'preserve') return { ...patch, retentionState: 'protected' }
  if (event === 'release') return { ...patch, retentionState: millis(data.finalResolutionAtMs) === null ? 'reviewRequired' : 'resolved' }
  const previous = millis(data.finalResolutionAtMs)
  const anchor = Math.max(previous ?? 0, at)
  if (anchor + 90 * DAY_MS > 8_640_000_000_000_000) throw new RetentionBlocked('invalid_due_time')
  return { ...patch, retentionState: 'resolved', finalResolutionAtMs: anchor,
    finalResolutionEventReference: previous != null && previous > at ? data.finalResolutionEventReference : reference,
    evidenceDueAtMs: anchor + 90 * DAY_MS, decisionDueAtMs: anniversary12Months(anchor), retentionExpiresAt: null }
}
export function fingerprint(value: unknown): string {
  function normalize(v: any): any {
    if (v === undefined) return null
    if (v === null || typeof v !== 'object') return v
    if (typeof v.toMillis === 'function') return { timestampMillis: v.toMillis() }
    if (Buffer.isBuffer(v)) return { bytesSha256: createHash('sha256').update(v).digest('hex') }
    if (Array.isArray(v)) return v.map(normalize)
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, normalize(v[k])]))
  }
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}
export function writerAllowed(data: RecordData): boolean {
  return data.accountDeletedAt == null && data.retentionEvidenceDisposedAtMs == null &&
    !['disposingEvidence', 'disposingDecision', 'uncertain', 'decisionDisposed'].includes(data.retentionState)
}
export function suppressionActive(data: RecordData | undefined): boolean {
  return data != null && (data.accountDeletedAt != null || data.deletionState === 'inProgress' || data.deletionState === 'complete')
}
export function validPreservation(input: RecordData, at: number): boolean {
  return typeof input.basisReference === 'string' && input.basisReference.trim().length >= 10 &&
    typeof input.responsibleUid === 'string' && input.responsibleUid.length > 0 &&
    millis(input.reviewAtMs) !== null && input.reviewAtMs > at &&
    Array.isArray(input.scope) && input.scope.length > 0 && input.scope.length <= 200 &&
    input.scope.every((item: any) => typeof item === 'string' && item.length > 0 && item.length <= 600) &&
    typeof input.releaseConditions === 'string' && input.releaseConditions.trim().length >= 10
}
export interface InventoryDocument { path: string; kind: Kind; data: RecordData; keepForActiveEnforcement?: boolean }
export interface BoundObject { bucket: string; path: string; generation: string }
export interface Scope {
  schemaVersion: 1; caseId: string; phase: Phase; revision: number; caseFingerprint: string
  approvedBy: string; approvalReference: string; providerInventoryReference: string
  approvedAtMs: number; validUntilMs: number; complete: boolean; unsettledWork: boolean
  copiesReviewed: boolean; preservationReviewed: boolean; activeChainReviewed: boolean
  documents: InventoryDocument[]; objects: BoundObject[]; coverage: string[]
}
export const REQUIRED_COVERAGE = ['caseChildren', 'reportsAndLinks', 'captureAndDerivativeQueues',
  'actionRequestsApprovalsOutboxIdempotency', 'standingAndEnforcement', 'auditAlertsNoticesGrants',
  'preservationAndRelease', 'sourceMediaAndControlledCopies'] as const

const COMMON = ['caseId', 'reportId', 'actionId', 'requestId', 'outboxId', 'appealId', 'eventId', 'enforcementId',
  'receiptNumber', 'schemaVersion', 'source', 'sourceCollection', 'sourceReportId', 'reportIds', 'reportCount',
  'status', 'reason', 'reasonCode', 'severity', 'targetType', 'type', 'action', 'decision', 'outcome', 'eventType', 'operation',
  'createdAt', 'updatedAt', 'completedAt', 'closedAt', 'resolvedAt', 'decidedAt', 'effectiveAt', 'expiresAt',
  'appliedBy', 'actorId', 'requestedBy', 'requestedByRole', 'resolvedBy', 'decisionBy', 'assignedModeratorId',
  'assignedModeratorIds', 'appealState', 'caseVersion', 'revision', 'standingRevision', 'expectedCaseVersion',
  'workflowVersion', 'approvalId', 'outboxId', 'attemptCount', 'simulationOnly', 'durationHours',
  'internalStatus', 'reporterVisibleStatus', 'evidenceAvailable', 'evidenceCleanedAt', 'evidenceCaptureStatus',
  'retentionPolicyId', 'retentionRevision', 'retentionState', 'finalResolutionAtMs', 'finalResolutionEventReference',
  'evidenceDueAtMs', 'decisionDueAtMs', 'retentionEvidenceDisposedAtMs', 'retentionDecisionDisposedAtMs',
  'retentionDispositionId', 'retentionInterruptedDispositionId', 'retentionIntentAtMs', 'retentionIntentReference',
  'legalHoldIds', 'activeExecutionRequestId', 'pendingActionRequestIds', 'accountDeletedAt',
  'retentionReviewRequired', 'retentionReviewAtMs']
const ACTIVE = ['targetUserId', 'reportedUserId', 'submittedBy', 'subjectUserId', 'caseId', 'actionReference',
  'originalActionReference', 'resolutionActionReference', 'messagingRestricted', 'enforcementId',
  'reversedAt', 'reversedBy', 'reversalActionReference', 'recoveryRequired', 'failureCode', 'executionToken']
export function minimized(kind: Kind, data: RecordData, active: boolean): RecordData | null {
  if (['evidence', 'note', 'queue', 'grant', 'link'].includes(kind)) return null
  const allowed = new Set([...COMMON, ...(active ? ACTIVE : [])])
  const result = Object.fromEntries(Object.entries(data).filter(([key]) => allowed.has(key)))
  // Never let unbounded metadata or an old note hash become a second evidence store.
  if (kind === 'case') { result.evidenceAvailable = false; result.retentionExpiresAt = null }
  result.retentionPolicyId = RETENTION_POLICY
  return result
}
function safeDocument(item: InventoryDocument, caseId: string, reportIds: string[]): boolean {
  const p = item.path.split('/')
  if (p.length % 2 !== 0 || p.some(x => !x || x === '.' || x === '..')) return false
  if (p[0] === 'moderationCases') return p[1] === caseId &&
    (p.length === 2 ? item.kind === 'case' : p.length === 4 && ['notes', 'actions', 'appeals', 'activeActionRequests'].includes(p[2]))
  if (p[0] === 'moderationEvidence') return p[1] === caseId && (p.length === 2 || p.length === 4 && p[2] === 'reports') && item.kind === 'evidence'
  if (p[0] === 'userEnforcements') return p.length === 4 && p[2] === 'events' && item.kind === 'enforcement' &&
    [item.data.actionReference, item.data.originalActionReference].some(ref => typeof ref === 'string' && ref.startsWith(`moderationCases/${caseId}/actions/`))
  if (p[0] === 'moderationRetentionDispositions') return item.kind === 'receipt' &&
    (p.length === 2 && item.data.caseId === caseId || p.length === 4 && p[2] === 'steps' && item.data.caseId === caseId)
  const top = ['moderationReports', 'chatModerationReports', 'contentModerationReports', 'moderationReporterLinks',
    'moderationEvidenceCaptureQueue', 'moderationImageDerivativeQueue', 'moderationActionRequests',
    'moderationActionApprovals', 'moderationActionOutbox', 'moderationIdempotency', 'moderationAuditEvents',
    'moderationAlerts', 'moderationPlaybackGrants', 'moderationUserNotices', 'moderationLegalHolds',
    'moderationLegalHoldReleaseRequests', 'moderationLegalHoldReleaseApprovals', 'moderationDedupKeys', 'moderationRetentionScopes',
    'moderationRetentionReviewReceipts']
  // UID-keyed standing and source content are intentionally not delete targets.
  // Their bounded deletion/suppression handling belongs to the account-deletion path.
  return p.length === 2 && top.includes(p[0]) && (item.data.caseId === caseId ||
    ['moderationReports', 'chatModerationReports', 'contentModerationReports', 'moderationReporterLinks',
      'moderationEvidenceCaptureQueue', 'moderationDedupKeys'].includes(p[0]) && reportIds.includes(item.data.reportId ?? p[1]))
}
export function eligibility(data: RecordData, scope: Scope, now: number): string | null {
  if (scope.schemaVersion !== 1 || !['evidence', 'decision'].includes(scope.phase) ||
      !scope.caseId || scope.caseId.includes('/') || millis(now) === null) return 'invalid_scope'
  if (data.retentionPolicyId !== RETENTION_POLICY || data.retentionRevision !== scope.revision ||
      fingerprint(data) !== scope.caseFingerprint) return 'stale_scope'
  if (!['closed', 'dismissed'].includes(data.status) || data.appealState === 'submitted' ||
      data.activeExecutionRequestId != null || scope.unsettledWork) return 'case_not_final'
  if (data.severity === 'critical') return 'critical_case'
  if (data.retentionReviewRequired === true) return 'staff_review_required'
  if ((Array.isArray(data.legalHoldIds) && data.legalHoldIds.length) || data.retentionState === 'protected') return 'active_preservation'
  if (Object.keys(data.retentionWriters ?? {}).length) return 'unfinished_writer'
  if (data.retentionDispositionId || data.retentionInterruptedDispositionId || data.retentionState === 'uncertain') return 'operation_requires_reconciliation'
  const anchor = millis(data.finalResolutionAtMs)
  if (anchor === null || !data.finalResolutionEventReference) return 'resolution_unset'
  const due = scope.phase === 'evidence' ? anchor + 90 * DAY_MS : anniversary12Months(anchor)
  if (data[scope.phase === 'evidence' ? 'evidenceDueAtMs' : 'decisionDueAtMs'] !== due) return 'invalid_due_time'
  if (due > now) return 'not_due'
  if (scope.phase === 'decision' && millis(data.retentionEvidenceDisposedAtMs) === null) return 'evidence_disposition_pending'
  if (!scope.approvedBy || !scope.approvalReference || !scope.providerInventoryReference ||
      millis(scope.approvedAtMs) === null || scope.approvedAtMs > now || millis(scope.validUntilMs) === null ||
      scope.validUntilMs <= now || scope.validUntilMs - scope.approvedAtMs > DAY_MS) return 'approval_required'
  if (!scope.complete || !scope.copiesReviewed || !scope.preservationReviewed || !scope.activeChainReviewed ||
      !REQUIRED_COVERAGE.every(category => scope.coverage.includes(category))) return 'incomplete_inventory'
  if (scope.documents.some(item => item.data.recoveryRequired === true ||
      ['request', 'outbox', 'queue'].includes(item.kind) &&
      !['completed', 'captured', 'ready', 'rejected', 'blockedByConfiguration', 'failed', 'executionFailed'].includes(String(item.data.status ?? item.data.captureState)))) return 'unsettled_inventory_work'
  if (scope.documents.length === 0 || scope.documents.length > 2000 || scope.objects.length > 2000) return 'inventory_capacity'
  if (new Set(scope.documents.map(x => x.path)).size !== scope.documents.length ||
      !scope.documents.every(item => safeDocument(item, scope.caseId, Array.isArray(data.reportIds) ? data.reportIds : []))) return 'unsafe_document_scope'
  if (scope.documents.some(x => (x.data.legalHoldIds?.length ?? 0) > 0)) return 'active_preservation'
  if (!scope.documents.some(item => item.path === `moderationCases/${scope.caseId}` && item.kind === 'case')) return 'missing_case'
  const objectKeys = scope.objects.map(x => `${x.bucket}/${x.path}@${x.generation}`)
  if (new Set(objectKeys).size !== objectKeys.length || scope.objects.some(x => !x.bucket ||
      !x.path.startsWith(`moderationEvidence/${scope.caseId}/`) || x.path.split('/').some(p => !p || p === '..') ||
      !/^[1-9][0-9]*$/.test(x.generation))) return 'incomplete_object_binding'
  if (scope.phase === 'decision' && scope.objects.length) return 'unexpected_decision_objects'
  if (scope.phase === 'evidence') {
    const expected = new Set<string>()
    for (const item of scope.documents.filter(x => x.kind === 'evidence')) {
      const row = item.data
      if (row.sourceAttachmentPresent && row.captureState !== 'captured') return 'capture_incomplete'
      const attachments = Array.isArray(row.capturedAttachments) ? row.capturedAttachments : []
      const bindings: Array<{ path: any; generation: any; bucket?: any }> = [...attachments.map((x: RecordData) => ({ path: x.storagePath, generation: x.storageGeneration, bucket: x.storageBucket })),
        ...(row.storagePath ? [{ path: row.storagePath, generation: row.storageGeneration }] : []),
        ...(row.imageDerivative ? [{ path: row.imageDerivative.path, generation: row.imageDerivative.generation }] : [])]
      for (const binding of bindings) {
        const match = scope.objects.find(x => x.path === binding.path && x.generation === binding.generation && (!binding.bucket || x.bucket === binding.bucket))
        if (!match) return 'incomplete_object_binding'
        expected.add(`${match.bucket}/${match.path}@${match.generation}`)
      }
    }
    // Additional orphan generations require their own reviewed reconciliation,
    // never an arbitrary object appended to a valid evidence manifest.
    if (expected.size !== scope.objects.length) return 'unbound_object'
  }
  return null
}
export function makeSteps(scope: Scope): Array<{ key: string; object?: BoundObject; document?: InventoryDocument; replacement?: RecordData | null }> {
  // Case summary is last. All other steps have durable individual receipts.
  const docs = [...scope.documents].sort((a, b) => Number(a.kind === 'case') - Number(b.kind === 'case') || a.path.localeCompare(b.path))
  return [
    ...scope.objects.map(object => ({ key: fingerprint(object), object })),
    ...docs.map(document => ({ key: fingerprint(document.path), document,
      replacement: scope.phase === 'decision' && !document.keepForActiveEnforcement ? null : minimized(document.kind, document.data, document.keepForActiveEnforcement === true) })),
  ]
}
export interface OperationAdapter {
  claim(scope: Scope, operationId: string): Promise<void>
  begin(operationId: string, key: string): Promise<void>
  object(value: BoundObject): Promise<void>
  document(value: InventoryDocument, replacement: RecordData | null): Promise<void>
  complete(operationId: string, key: string): Promise<void>
  finish(operationId: string): Promise<void>
  uncertain(operationId: string, category: string): Promise<void>
}
export async function disposeOnce(scope: Scope, operationId: string, adapter: OperationAdapter): Promise<void> {
  await adapter.claim(scope, operationId)
  try {
    for (const step of makeSteps(scope)) {
      await adapter.begin(operationId, step.key)
      if (step.object) await adapter.object(step.object)
      else await adapter.document(step.document!, step.replacement ?? null)
      await adapter.complete(operationId, step.key)
    }
    await adapter.finish(operationId)
  } catch (error) {
    await adapter.uncertain(operationId, error instanceof RetentionBlocked ? error.category : 'external_outcome_uncertain')
    throw error // No retry, catch-and-continue or lease-based replay.
  }
}
export function restorePermitted(record: RecordData, at: number): boolean {
  if (suppressionActive(record) || !writerAllowed(record)) return false
  const due = millis(record.evidenceDueAtMs)
  return due == null || due > at
}

// Read-only inventory primitive. A full page never implies completeness.
export async function collectInventoryPages<T extends { id: string }>(
  fetch: (cursor: string | null, limit: number) => Promise<T[]>, maximum = 2000,
): Promise<T[]> {
  const rows: T[] = []; const seen = new Set<string>(); let cursor: string | null = null
  for (;;) {
    const page = await fetch(cursor, 100)
    if (page.length > 100) throw new RetentionBlocked('inventory_page_overflow')
    for (const row of page) {
      if (!row.id || seen.has(row.id)) throw new RetentionBlocked('inventory_cursor_not_advancing')
      rows.push(row); seen.add(row.id)
      if (rows.length > maximum) throw new RetentionBlocked('inventory_capacity')
    }
    if (page.length < 100) return rows
    cursor = page[page.length - 1].id
  }
}
