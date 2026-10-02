import test from 'node:test';
import assert from 'node:assert/strict';
import { drawStatusChip, drawRadialArc, drawCompactVitals, STATUS_STATE } from '../src/core/entityStatus.js';
import { emitFloatingText } from '../src/core/fxKit.js';

function makeMockCtx() {
  const calls = [];
  return {
    calls,
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    beginPath: () => calls.push('beginPath'),
    arc: (...args) => calls.push(`arc(${args.map(a => typeof a === 'number' ? Math.round(a * 10) / 10 : a).join(',')})`),
    rect: (...args) => calls.push(`rect(${args.join(',')})`),
    roundRect: (...args) => calls.push(`roundRect(${args.join(',')})`),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    fillRect: (...args) => calls.push(`fillRect(${args.map(a => typeof a === 'number' ? Math.round(a * 10) / 10 : a).join(',')})`),
    strokeRect: (...args) => calls.push(`strokeRect(${args.map(a => typeof a === 'number' ? Math.round(a * 10) / 10 : a).join(',')})`),
    fillText: (...args) => calls.push(`fillText(${args[0]})`),
    clip: () => calls.push('clip'),
    measureText: () => ({ width: 20 }),
  };
}

test('drawStatusChip: returns null when transient is true and status is READY', () => {
  const ctx = makeMockCtx();
  const res = drawStatusChip(ctx, {
    x: 100,
    y: 100,
    progress: 1.0,
    transient: true,
  });
  assert.equal(res, null);
  assert.equal(ctx.calls.length, 0);
});

test('drawStatusChip: renders chip when charging even if transient is true', () => {
  const ctx = makeMockCtx();
  const res = drawStatusChip(ctx, {
    x: 100,
    y: 100,
    progress: 0.45,
    transient: true,
  });
  assert.ok(res !== null);
  assert.ok(res.w > 0);
  assert.ok(res.h > 0);
  assert.ok(ctx.calls.includes('fill'));
  assert.ok(ctx.calls.includes('stroke'));
});

test('drawRadialArc: renders arc cleanly without heap allocations', () => {
  const ctx = makeMockCtx();
  drawRadialArc(ctx, {
    x: 150,
    y: 150,
    radius: 20,
    progress: 0.75,
    lineWidth: 3,
  });
  const arcCalls = ctx.calls.filter(c => c.startsWith('arc'));
  assert.ok(arcCalls.length >= 2, 'Should render track arc and progress arc');
  assert.ok(ctx.calls.includes('stroke'));
});

test('drawCompactVitals: transient mode hides when hp and ammo are 100% full', () => {
  const ctx = makeMockCtx();
  const res = drawCompactVitals(ctx, {
    x: 200,
    y: 200,
    radius: 25,
    hp: 5,
    maxHp: 5,
    ammo: 10,
    maxAmmo: 10,
    reloading: false,
    transient: true,
  });
  assert.equal(res, null);
  assert.equal(ctx.calls.length, 0);
});

test('drawCompactVitals: renders micro-pips when damaged in transient mode', () => {
  const ctx = makeMockCtx();
  const res = drawCompactVitals(ctx, {
    x: 200,
    y: 200,
    radius: 25,
    hp: 3,
    maxHp: 5,
    ammo: 10,
    maxAmmo: 10,
    reloading: false,
    transient: true,
  });
  assert.ok(res !== null);
  assert.ok(ctx.calls.some(c => c.startsWith('fillRect')));
});

test('drawCompactVitals: renders reload ray when reloading', () => {
  const ctx = makeMockCtx();
  const res = drawCompactVitals(ctx, {
    x: 200,
    y: 200,
    radius: 25,
    hp: 5,
    maxHp: 5,
    ammo: 0,
    maxAmmo: 6,
    reloading: true,
    reloadProgress: 0.6,
    transient: true,
  });
  assert.ok(res !== null);
  assert.ok(ctx.calls.some(c => c.startsWith('fillRect')));
});

test('emitFloatingText: pushes text items with proper caps and physics values', () => {
  const list = [];
  emitFloatingText(list, {
    x: 50,
    y: 80,
    text: '+100',
    color: '#FFB020',
    dist: 40,
    maxLife: 1.0,
    cap: 3,
  });

  assert.equal(list.length, 1);
  assert.equal(list[0].text, '+100');
  assert.equal(list[0].vy, -40);
  assert.equal(list[0].alpha, 1);

  // Push beyond cap
  emitFloatingText(list, { x: 50, y: 80, text: 'BLOCKED!', cap: 3 });
  emitFloatingText(list, { x: 50, y: 80, text: 'PARRY!', cap: 3 });
  emitFloatingText(list, { x: 50, y: 80, text: 'CRIT!', cap: 3 });

  assert.equal(list.length, 3);
  assert.equal(list[0].text, 'BLOCKED!');
  assert.equal(list[2].text, 'CRIT!');
});
