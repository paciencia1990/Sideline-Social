import assert from 'node:assert/strict';
import test from 'node:test';
import { orderedStandingProjection, deleteStandingProjection } from './standingProjection';

test('delayed duplicate and out-of-order projections preserve newer reversal', () => {
  const old = { status: 'messagingRestricted', revision: 1, expiresAt: null, updatedAt: 1 };
  const next = { status: 'active', revision: 2, expiresAt: null, updatedAt: 2 };
  assert.deepEqual(orderedStandingProjection(null, old), old);
  assert.deepEqual(orderedStandingProjection(old, next), next);
  assert.equal(orderedStandingProjection(next, old), undefined);
  assert.equal(orderedStandingProjection(next, next), undefined);
  assert.equal(deleteStandingProjection(next, 1, '100:1'), undefined);
  const marker = deleteStandingProjection(next, 2, '100:2');
  assert.equal(marker?.deleted, true);
  assert.equal(orderedStandingProjection(marker, { ...old, version: '100:1' }), undefined);
  assert.equal(orderedStandingProjection(marker, { ...next, version: '100:2' }), undefined);
  assert.equal(orderedStandingProjection(marker, { ...old, version: '101:1' })?.revision, 1);
  assert.throws(() => orderedStandingProjection({ revision: 'unknown' }, next));
});

test('timestamp ordering fails closed on malformed versions and preserves an unrelated newer restriction', () => {
  const newer = { status: 'banned', revision: 3, expiresAt: null, updatedAt: 3, version: '100:3' };
  assert.equal(deleteStandingProjection(newer, 2, '100:2'), undefined);
  for (const version of ['unknown', '1:1000000000', '-1:0', '1.0:1']) {
    assert.throws(() => deleteStandingProjection(newer, 4, version));
  }
});
