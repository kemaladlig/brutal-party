import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCurveWorldPacket,
  isValidCurveWorldFrame,
  packCurveFieldMask,
  unpackCurveFieldMask,
  packCurveGapMask,
  unpackCurveGapMask,
  CURVE_FIELD_TILES,
  CURVE_GAP_MASK_TILES,
  CURVE_TOTAL_NEAR_CAP,
} from '../src/games/curveView.js';

function makeGame() {
  const segments = [];
  for (let i = 0; i < 300; i++) {
    segments.push({
      x1: 100 + i * 2, y1: 100, x2: 102 + i * 2, y2: 100,
      isGap: i % 7 === 0,
      owner: i % 4,
      shrink: i % 5 === 0,
      thick: i % 11 === 0,
    });
  }
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624, size: 600 },
    field: { x: 16, y: 24, s: 600 },
    segments,
    players: [{
      index: 0, isJoined: true, isAlive: true,
      x: 400, y: 300, angle: 0.5,
      shrinkTimer: 0, thickTimer: 1, ghostTimer: 0,
      freezeTimer: 0, turboTimer: 0,
      isGap: false, gapTimer: 1,
    }],
    pickups: [{ x: 200, y: 220, size: 24, type: 'TURBO' }],
    particles: [{ x: 100, y: 100, size: 4, life: 0.3, maxLife: 0.6, color: '#D84727' }],
    floatingTexts: [{ x: 400, y: 280, text: 'TURBO', life: 0.5, maxLife: 1, color: '#FFD122' }],
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('curve field mask round-trips owner bits', () => {
  const field = { x: 0, y: 0, s: 240 };
  const segments = [
    { x1: 10, y1: 10, x2: 10, y2: 10, isGap: false, owner: 0 },
    { x1: 120, y1: 120, x2: 120, y2: 120, isGap: false, owner: 2 },
    { x1: 200, y1: 200, x2: 200, y2: 200, isGap: true, owner: 3 },
  ];
  const hex = packCurveFieldMask(segments, field);
  const bits = unpackCurveFieldMask(hex);

  assert.equal(hex.length, (CURVE_FIELD_TILES * CURVE_FIELD_TILES) / 2);
  const cell = 240 / CURVE_FIELD_TILES;
  const at = (x, y) => bits[Math.floor(y / cell) * CURVE_FIELD_TILES + Math.floor(x / cell)];
  assert.equal(at(10, 10), 1);     // owner 0 → 1
  assert.equal(at(120, 120), 3);   // owner 2 → 3
  assert.equal(at(200, 200), 0);   // isGap segmentleri hiçbir hücreyi kirletmez

  const gapMask = unpackCurveGapMask(packCurveGapMask(segments, field));
  assert.equal(gapMask[Math.floor(200 / cell) * CURVE_GAP_MASK_TILES + Math.floor(200 / cell)], 1);
});

test('curve world packet caps near segments and carries flags', () => {
  const game = makeGame();
  const first = createCurveWorldPacket(game);
  const second = createCurveWorldPacket(game);

  assert.equal(first.mode, 'CURVE');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.ok(first.near.length > 0);
  assert.ok(first.near.length <= CURVE_TOTAL_NEAR_CAP);
  assert.equal(first.field.length, (CURVE_FIELD_TILES * CURVE_FIELD_TILES) / 2);
  assert.equal(first.gaps.length, (CURVE_GAP_MASK_TILES * CURVE_GAP_MASK_TILES) / 4);

  // Oyuncu başına en fazla son 220 segment gönderilir
  const perOwner = new Map();
  for (const s of first.near) perOwner.set(s[0], (perOwner.get(s[0]) || 0) + 1);
  for (const count of perOwner.values()) assert.ok(count <= 220);

  const p = first.players[0];
  assert.equal(p.thick, true);
  assert.equal(p.gap, false);
  assert.equal(p.confused, false);
  assert.equal(p.gapTimer, 1);
  assert.equal(first.pickups[0].type, 'TURBO');
  assert.equal(first.texts[0].alpha, 0.5);

  assert.ok(isValidCurveWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidCurveWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('curve world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createCurveWorldPacket(game) };

  assert.equal(isValidCurveWorldFrame(frame), true);
  assert.equal(isValidCurveWorldFrame({ ...frame, field: 'zz' }), false);
  assert.equal(isValidCurveWorldFrame({ ...frame, gaps: 'zz' }), false);
  assert.equal(isValidCurveWorldFrame({ ...frame, field: frame.field.slice(0, -1) }), false);
  assert.equal(isValidCurveWorldFrame({ ...frame, near: [[0, 1, 2, 3, 4, 99]] }), false);
  assert.equal(isValidCurveWorldFrame({ ...frame, near: [[9, 1, 2, 3, 4, 0]] }), false);
  assert.equal(isValidCurveWorldFrame({ ...frame, players: [{ ...frame.players[0], thick: 1 }] }), false);
  assert.equal(isValidCurveWorldFrame({ ...frame, mode: 'ZONE' }), false);
});

test('curve world packet stays bounded with 24k segments', () => {
  const game = makeGame();
  game.segments = [];
  for (let i = 0; i < 24000; i++) {
    game.segments.push({
      x1: 20 + (i % 400), y1: 30 + Math.floor(i / 400) * 2,
      x2: 20 + (i % 400), y2: 32 + Math.floor(i / 400) * 2,
      isGap: false, owner: i % 4, shrink: false, thick: false,
    });
  }
  const packet = createCurveWorldPacket(game);
  const json = JSON.stringify(packet);

  assert.ok(packet.near.length <= CURVE_TOTAL_NEAR_CAP);
  assert.ok(json.length < 120000, `frame must stay small, got ${json.length}`);
  assert.ok(isValidCurveWorldFrame({ action: 'WORLD_FRAME', ...packet }));
});
