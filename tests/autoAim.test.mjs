import test from 'node:test';
import assert from 'node:assert/strict';
import { findAutoAimTarget, angleToTarget } from '../src/core/autoAim.js';

const points = [
  { id: 'up', x: 0, y: -100 },
  { id: 'near-right', x: 40, y: 10 },
  { id: 'far-right', x: 900, y: 0 },
];

test('auto-aim picks the nearest valid candidate and reports its angle', () => {
  const hit = findAutoAimTarget({ x: 0, y: 0 }, points, {
    valid: (p) => p.id !== 'near-right',
  });
  assert.equal(hit.target.id, 'up');
  assert.ok(Math.abs(hit.angle - angleToTarget({ x: 0, y: 0 }, { x: 0, y: -100 })) < 1e-9);

  const all = findAutoAimTarget({ x: 0, y: 0 }, points, {});
  assert.equal(all.target.id, 'near-right');
});

test('auto-aim respects the range budget and denies a self-only field', () => {
  assert.equal(findAutoAimTarget({ x: 0, y: 0 }, points, { maxRange: 50 }).target.id, 'near-right');
  assert.equal(findAutoAimTarget({ x: 0, y: 0 }, points, { maxRange: 20 }), null);
  assert.equal(findAutoAimTarget({ x: 0, y: 0 }, [null], {}), null);
});
