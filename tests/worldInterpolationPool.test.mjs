// Havuzlu sunum blenderi (`createWorldFrameBlender`) saf `blendWorldFrames` ile
// BİREBİR aynı değerleri üretmeli ve girdi karelerini mutasyona uğratmamalıdır.
// Bu test bir corpus üzerinde ikisini karşılaştırır; sapma = kare başına tahsis
// optimizasyonunun sunum davranışını bozması demektir.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendWorldFrames,
  createWorldFrameBlender,
  selectBufferedWorldFrame,
} from '../src/core/worldInterpolation.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const num = (r, lo, hi) => lo + (hi - lo) * r();

function makeFrame(r, seq, mode) {
  const frame = {
    version: 1,
    mode,
    seq,
    roundId: 1,
    gameState: 'PLAYING',
    hostId: 'h',
    sentAt: seq * 33,
  };

  frame.players = [];
  const playerCount = 1 + Math.floor(r() * 4);
  for (let i = 0; i < playerCount; i += 1) {
    const player = {
      slot: i,
      x: num(r, -200, 200),
      y: num(r, -200, 200),
      angle: num(r, -Math.PI, Math.PI),
      alive: r() > 0.3,
    };
    if (r() > 0.5) {
      player.trail = [];
      const n = 1 + Math.floor(r() * 5);
      for (let j = 0; j < n; j += 1) player.trail.push([num(r, -200, 200), num(r, -200, 200)]);
    }
    if (r() > 0.7) {
      player.history = [];
      const n = 1 + Math.floor(r() * 4);
      for (let j = 0; j < n; j += 1) player.history.push([num(r, -200, 200), num(r, -200, 200)]);
    }
    if (r() > 0.6) player.swim = r() > 0.5;
    frame.players.push(player);
  }

  if (r() > 0.3) {
    frame.enemies = [];
    const n = Math.floor(r() * 6);
    for (let i = 0; i < n; i += 1) {
      const enemy = {
        id: i + 1,
        x: num(r, -200, 200),
        y: num(r, -200, 200),
        angle: num(r, -3, 3),
        hp: Math.floor(r() * 5),
      };
      if (r() > 0.7) enemy.trail = [[num(r, -9, 9), num(r, -9, 9)], [num(r, -9, 9), num(r, -9, 9)]];
      frame.enemies.push(enemy);
    }
  }

  if (r() > 0.5) {
    frame.tracers = [];
    const n = Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      const tracer = { id: i + 1, x: num(r, -9, 9), y: num(r, -9, 9) };
      if (r() > 0.3) tracer.history = [[num(r, -9, 9), num(r, -9, 9)], [num(r, -9, 9), num(r, -9, 9)]];
      frame.tracers.push(tracer);
    }
  }

  if (r() > 0.4) {
    frame.walls = [];
    const n = Math.floor(r() * 4);
    const asArray = r() > 0.5;
    for (let i = 0; i < n; i += 1) {
      if (asArray) frame.walls.push([num(r, -9, 9), num(r, -9, 9), num(r, 1, 20), num(r, 1, 20)]);
      else {
        frame.walls.push({
          id: i + 1, x: num(r, -9, 9), y: num(r, -9, 9), w: num(r, 1, 20), h: num(r, 1, 20),
        });
      }
    }
  }

  for (const kind of ['arrows', 'bullets', 'tombs', 'pickups', 'loot', 'steps']) {
    if (r() <= 0.5) continue;
    frame[kind] = [];
    const n = Math.floor(r() * 5);
    for (let i = 0; i < n; i += 1) {
      const id = i + 1;
      if (kind === 'arrows') frame[kind].push([num(r, -9, 9), num(r, -9, 9), num(r, -3, 3), num(r, -3, 3), '#fff', id]);
      else if (kind === 'bullets') frame[kind].push([num(r, -9, 9), num(r, -9, 9), num(r, -3, 3), num(r, -3, 3), 4, 0, id]);
      else if (kind === 'tombs') frame[kind].push([num(r, -9, 9), num(r, -9, 9), id]);
      else frame[kind].push([num(r, -9, 9), num(r, -9, 9), num(r, 0, 1)]);
    }
  }

  if (r() > 0.5) {
    frame.near = [];
    const n = Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      frame.near.push([0, num(r, -9, 9), num(r, -9, 9), num(r, -9, 9), num(r, -9, 9), 0, i + 1, num(r, -9, 9)]);
    }
  }

  if (r() > 0.5) frame.piggy = { x: num(r, -9, 9), y: num(r, -9, 9), hp: Math.floor(r() * 3) };
  if (r() > 0.4) frame.portal = [num(r, -9, 9), num(r, -9, 9), 8, num(r, 0, 1)];

  for (const kind of ['texts', 'ghosts', 'decals', 'slashes', 'impacts', 'waves', 'relics', 'loadoutCrates']) {
    if (r() <= 0.75) continue;
    frame[kind] = [];
    const n = Math.floor(r() * 3);
    for (let i = 0; i < n; i += 1) {
      frame[kind].push({ id: i + 1, x: num(r, -9, 9), y: num(r, -9, 9), life: num(r, 0, 1) });
    }
  }

  if (r() > 0.8) frame.snapTrail = true;
  return frame;
}

const MODES = ['TANKS', 'SNAKE', 'HORDE', 'ZONE', 'CROWN', 'NINJA', 'BOMB', 'HEIST', 'ARCHER', 'PONG', 'CURVE', 'COLLAPSE', 'COLOSSUS'];

test('pooled blender matches pure blendWorldFrames across a varied corpus', () => {
  const r = mulberry32(0x5eed);
  const pooled = createWorldFrameBlender();
  for (let iter = 0; iter < 500; iter += 1) {
    const mode = MODES[iter % MODES.length];
    const previous = makeFrame(r, iter, mode);
    const current = makeFrame(r, iter + 1, mode);
    // Blend kapısı aynı olsun: discrete alanları eşitle.
    current.version = previous.version;
    current.roundId = previous.roundId;
    current.gameState = previous.gameState;
    current.hostId = previous.hostId;

    for (const alpha of [0, 0.001, 0.13, 0.5, 0.87, 0.999, 1]) {
      const pure = blendWorldFrames(previous, current, alpha);
      const got = pooled(previous, current, alpha);
      assert.deepEqual(got, pure, `iter ${iter} alpha ${alpha} mode ${mode}`);
    }
  }
});

test('pooled blender never mutates its input frames', () => {
  const r = mulberry32(0xc0ffee);
  const pooled = createWorldFrameBlender();
  const previous = makeFrame(r, 1, 'HORDE');
  const current = makeFrame(r, 2, 'HORDE');
  const previousCopy = structuredClone(previous);
  const currentCopy = structuredClone(current);

  for (let i = 0; i < 30; i += 1) pooled(previous, current, 0.2 + i * 0.02);

  assert.deepEqual(previous, previousCopy);
  assert.deepEqual(current, currentCopy);
});

test('pooled blender refreshes values across consecutive reused frames', () => {
  const pooled = createWorldFrameBlender();
  const make = (seq, x) => ({
    version: 1,
    mode: 'T',
    seq,
    roundId: 1,
    gameState: 'PLAYING',
    hostId: 'h',
    players: [{ slot: 0, x, y: 0, angle: 0, alive: true }],
  });
  for (let i = 0; i < 60; i += 1) {
    const previous = make(i, i * 10);
    const current = make(i + 1, (i + 1) * 10);
    const got = pooled(previous, current, 0.5);
    assert.deepEqual(got, blendWorldFrames(previous, current, 0.5));
    assert.equal(got.players[0].x, i * 10 + 5);
  }
});

test('pooled blender preserves reference semantics at the blend boundaries', () => {
  const pooled = createWorldFrameBlender();
  const a = {
    version: 1, mode: 'X', seq: 1, roundId: 1, gameState: 'PLAYING', hostId: 'h', players: [],
  };
  const b = { ...a, seq: 2 };

  assert.equal(pooled(a, b, 0), a, 'alpha 0 → previous referansı');
  assert.equal(pooled(a, b, 1), b, 'alpha 1 → current referansı');
  assert.equal(pooled(a, b, 0.5), pooled(a, b, 0.5), 'gövde kare başına tek nesneyi yeniden kullanır');
  assert.equal(pooled(a, { ...b, roundId: 2 }, 0.5).roundId, 2, 'blend sınırı aşılırsa current döner');
});

test('selectBufferedWorldFrame integrates with the pooled blender', () => {
  const pooled = createWorldFrameBlender();
  const first = {
    version: 1, mode: 'T', seq: 1, roundId: 1, gameState: 'PLAYING', hostId: 'h',
    players: [{ slot: 0, x: 0, y: 0, angle: 0 }],
  };
  const second = { ...first, seq: 2, players: [{ slot: 0, x: 20, y: 0, angle: 0 }] };
  const sample = selectBufferedWorldFrame(
    [{ frame: first, receivedAt: 0 }, { frame: second, receivedAt: 33 }],
    16.5,
    100,
    pooled,
  );

  assert.equal(sample.alpha, 0.5);
  assert.equal(sample.frame.players[0].x, 10);
});
