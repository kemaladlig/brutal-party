import test from 'node:test';
import assert from 'node:assert/strict';
import { strictRecorder } from './helpers/recorder.mjs';

const { groundRect, queuePlayers } = await import('../src/core/sceneKit.js');
const { sceneBegin, sceneEnd } = await import('../src/core/arenaKit.js');

/** Projeksiyonu kimlik olan sahte projector (z yalnız kaydedilir). */
function fakeProj() {
  const calls = [];
  const proj = {
    view: { scale: 1 },
    calls,
    proj: (x, y, z = 0) => { calls.push([x, y, z]); return { x, y, d: 1 }; },
    quad: (ctx, a, b, c, d, fill) => ctx.tag(`quad:${fill}`),
    strokePoly: (ctx, pts, color) => ctx.tag(`stroke:${color}:${pts.length}`),
  };
  return proj;
}

function tags(log) { return log.filter((e) => e.startsWith('tag(')).map((e) => e.slice(4, -1)); }

test('groundRect: 4 projekte köşe (tl,tr,br,bl) + dolgu/kontur sırası', () => {
  const ctx = strictRecorder('zemin');
  const proj = fakeProj();
  const pts = groundRect(ctx, proj, { x: 10, y: 20, w: 30, h: 40 }, {
    fill: '#111111', stroke: '#222222', lineWidth: 3,
  });
  assert.deepEqual(pts.map((p) => [p.x, p.y]), [[10, 20], [40, 20], [40, 60], [10, 60]]);
  assert.deepEqual(tags(ctx.log), ['quad:#111111', 'stroke:#222222:4']);
});

test('groundRect: yalnız kontur (fill yok) → tek çizim', () => {
  const ctx = strictRecorder('zemin');
  groundRect(ctx, fakeProj(), { x: 0, y: 0, w: 10, h: 10 }, { stroke: '#333333' });
  assert.deepEqual(tags(ctx.log), ['stroke:#333333:4']);
});

test('queuePlayers: taban-Y sırasına göre dizer (açık sahne), görünmeyeni atlar', () => {
  const ctx = strictRecorder('kuyruk');
  const state = { tag: 'ST' };
  sceneBegin();
  queuePlayers(ctx, [{ y: 100 }, { y: 50 }, { y: 0, hidden: true }], {
    state,
    drawItem: (c, p, st) => c.tag(`${p.y}:${st.tag}`),
    radiusOf: () => 10,
    visible: (p) => !p.hidden,
  });
  sceneEnd(ctx);
  assert.deepEqual(tags(ctx.log), ['50:ST', '100:ST'], 'Y artan sırayla; görünmeyen yok');
});

test('queuePlayers: radiusOf verilmezse player.radius kullanılır (çökmemeli)', () => {
  const ctx = strictRecorder('kuyruk');
  sceneBegin();
  queuePlayers(ctx, [{ y: 10, radius: 24 }], { state: {}, drawItem: (c) => c.tag('ok') });
  sceneEnd(ctx);
  assert.deepEqual(tags(ctx.log), ['ok']);
});
