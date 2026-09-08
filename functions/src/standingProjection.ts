// Keep this pure reducer identical in the Safety and Mobile backends.
export type StandingProjection = {
  status: string; messagingRestricted?: boolean; expiresAt: number | null;
  revision: number; updatedAt: number; version?: string; deleted?: boolean;
};

function version(value: string): bigint {
  const match = /^(0|[1-9]\d{0,11}):(\d{1,9})$/.exec(value);
  if (!match || Number(match[2]) >= 1e9) throw new Error('standing_version_invalid');
  return BigInt(match[1]) * 1000000000n + BigInt(match[2]);
}

function valid(value: unknown): asserts value is StandingProjection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('standing_projection_invalid');
  const row = value as StandingProjection;
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) throw new Error('standing_revision_invalid');
  if (row.version !== undefined) version(row.version);
}

export function orderedStandingProjection(current: unknown, next: StandingProjection): StandingProjection | undefined {
  valid(next);
  if (current != null) {
    valid(current);
    // Firestore update times also order delete/recreate. Legacy records retain
    // their revision floor until a current write wins; unknown data fails closed.
    const order = current.version && next.version ?
      (version(next.version) > version(current.version) ? 1 : version(next.version) < version(current.version) ? -1 : 0) :
      Math.sign(next.revision - current.revision);
    if (order < 0 || order === 0 && (current.deleted || !next.deleted)) return undefined;
  }
  return next;
}

export function deleteStandingProjection(current: unknown, deletedRevision: number, deletedVersion: string): StandingProjection | undefined {
  // Keep ordering and default active state at the existing path. Removing this
  // marker would let a delayed projection resurrect a deleted restriction.
  return orderedStandingProjection(current, {
    status: 'active', messagingRestricted: false, expiresAt: null,
    revision: deletedRevision, version: deletedVersion, deleted: true, updatedAt: Date.now(),
  });
}
