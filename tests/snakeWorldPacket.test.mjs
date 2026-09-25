import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSnakeWorldPacket,
  isValidSnakeWorldFrame,
  sampleSnakeTrail,
} from '../src/games/snakeView.js';

function makeSegments(count, step = 5) {
  const segments = [];
  let x = 0;
  for (let i = 0; i < count; i += 1) {
    const nextX = x + step;
    segments.push({ x1: x, y1: 0, x2: nextX, y2: 0 });
    x = nextX;
  }
  return { segments, headX: x };
}

test('snake trail sampling is distance based, ordered and bounded', () => {
  const { segments, headX } = makeSegments(500, 5);
  const trail = sampleSnakeTrail(segments, headX, 0);

  assert.ok(trail.length <= 48);
  assert.ok(trail.length > 30);
  assert.deepEqual(trail[0], [0, 0]);
  assert.deepEqual(trail[trail.length - 1], [2500, 0]);

  for (let i = 1; i < trail.length; i += 1) {
    assert.ok(trail[i][0] >= trail[i - 1][0]);
  }
});

test('snake world packet is compact, complete and monotonic', () => {
  const { segments, headX } = makeSegments(20, 5);
  const game = {
    state: 'PLAYING',
    roundId: 3,
    arena: { left: 10, top: 20, right: 810, bottom: 620 },
    walls: [{ x: 100, y: 120, w: 40, h: 50 }],
    foods: [{ x: 200, y: 220, type: 'APPLE', size: 13 }],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: headX,
      y: 0,
      angle: 0.5,
      isBoost: true,
      boostEnergy: 72,
      boostLocked: false,
      segments,
    }],
    scores: [2, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };

  const first = createSnakeWorldPacket(game);
  const second = createSnakeWorldPacket(game);

  assert.equal(first.mode, 'SNAKE');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);
  assert.equal(first.players[0].energy, 72);
  assert.equal(first.players[0].trail.at(-1)[0], headX);
  assert.ok(isValidSnakeWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidSnakeWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('world frame validation rejects oversized malformed trails', () => {
  const base = {
    action: 'WORLD_FRAME',
    version: 1,
    mode: 'SNAKE',
    seq: 1,
    roundId: 1,
    gameState: 'PLAYING',
    scores: [0, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
    matchDraw: false,
    arena: [0, 0, 100, 100],
    walls: [],
    foods: [],
    particles: [],
    players: [{
      slot: 0,
      joined: true,
      alive: true,
      x: 1,
      y: 1,
      angle: 0,
      boost: false,
      energy: 100,
      locked: false,
      trail: [[0, 0], [1, 1]],
    }],
  };

  assert.equal(isValidSnakeWorldFrame(base), true);
  assert.equal(isValidSnakeWorldFrame({
    ...base,
    players: [{ ...base.players[0], trail: Array.from({ length: 49 }, () => [0, 0]) }],
  }), false);
  assert.equal(isValidSnakeWorldFrame({ ...base, arena: [0, 0, NaN, 100] }), false);
});
