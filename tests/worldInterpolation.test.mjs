import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendWorldFrames,
  canBlendWorldFrames,
  selectBufferedWorldFrame,
} from '../src/core/worldInterpolation.js';

function frame(seq, x, extra = {}) {
  return {
    version: 1,
    mode: 'TANKS',
    seq,
    roundId: 1,
    gameState: 'PLAYING',
    hostId: 'host-1',
    players: [{ slot: 0, x, y: 10, angle: 0, alive: true }],
    ...extra,
  };
}

test('blends stable players without mutating discrete state', () => {
  const previous = frame(1, 0, { players: [{ slot: 0, x: 0, y: 10, angle: Math.PI, alive: true, shield: true }] });
  const current = frame(2, 20, { players: [{ slot: 0, x: 20, y: 30, angle: 0, alive: false, shield: false }] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.players[0].x, 10);
  assert.equal(blended.players[0].y, 20);
  assert.equal(blended.players[0].angle, Math.PI / 2);
  assert.equal(blended.players[0].alive, false);
  assert.equal(blended.players[0].shield, false);
  assert.equal(previous.players[0].x, 0);
  assert.equal(current.players[0].x, 20);
});

test('matches arrows and projectiles by stable id when list order changes', () => {
  const previous = frame(1, 0, {
    arrows: [[0, 0, 10, 0, '#fff', 7], [100, 100, 0, 10, '#fff', 8]],
    bullets: [[0, 0, 1, 0, 4, 0, 21], [100, 100, 0, 1, 4, 0, 22]],
  });
  const current = frame(2, 0, {
    arrows: [[120, 120, 0, 10, '#fff', 8], [20, 20, 10, 0, '#fff', 7]],
    bullets: [[120, 120, 0, 1, 4, 0, 22], [20, 20, 1, 0, 4, 0, 21]],
  });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.arrows.find((arrow) => arrow[5] === 7)[0], 10);
  assert.equal(blended.arrows.find((arrow) => arrow[5] === 8)[1], 110);
  assert.equal(blended.bullets.find((bullet) => bullet[6] === 21)[0], 10);
  assert.equal(blended.bullets.find((bullet) => bullet[6] === 22)[1], 110);
});

test('normalizes point trails when a sampled body changes length', () => {
  const previous = frame(1, 0, { players: [{ slot: 0, x: 0, y: 0, trail: [[0, 0], [10, 0]] }] });
  const current = frame(2, 20, { players: [{ slot: 0, x: 20, y: 0, trail: [[0, 0], [5, 0], [10, 0], [20, 0]] }] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.players[0].trail.length, 4);
  assert.deepEqual(blended.players[0].trail[0], [0, 0]);
  assert.deepEqual(blended.players[0].trail[3], [15, 0]);
});

test('blends moving world objects and singleton hazards', () => {
  const previous = frame(1, 0, {
    enemies: [{ id: 4, x: 0, y: 20, angle: 0, hp: 3 }],
    lasers: [{ id: 9, x: 10, y: 0, history: [[0, 0], [10, 0]] }],
    walls: [{ id: 2, x: 100, y: 200 }],
    piggy: { x: 50, y: 60, hp: 2 },
    portal: [20, 30, 8, 0.5],
  });
  const current = frame(2, 0, {
    enemies: [{ id: 4, x: 20, y: 40, angle: Math.PI, hp: 2 }],
    lasers: [{ id: 9, x: 30, y: 20, history: [[20, 0], [30, 20]] }],
    walls: [{ id: 2, x: 140, y: 260 }],
    piggy: { x: 70, y: 80, hp: 1 },
    portal: [40, 50, 8, 0.75],
  });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.enemies[0].x, 10);
  assert.equal(blended.enemies[0].y, 30);
  assert.equal(blended.lasers[0].x, 20);
  assert.deepEqual(blended.lasers[0].history, [[10, 0], [20, 10]]);
  assert.equal(blended.walls[0].x, 120);
  assert.equal(blended.piggy.x, 60);
  assert.deepEqual(blended.portal, [30, 40, 8, 0.75]);
});

test('does not blend across round or game-state boundaries', () => {
  const previous = frame(1, 0);
  const roundChanged = frame(2, 20, { roundId: 2 });
  const stateChanged = frame(2, 20, { gameState: 'ROUND_OVER' });

  assert.equal(canBlendWorldFrames(previous, roundChanged), false);
  assert.equal(blendWorldFrames(previous, roundChanged, 0.5), roundChanged);
  assert.equal(blendWorldFrames(previous, stateChanged, 0.5), stateChanged);
});

test('uses host-clock playback timestamps when receive jitter is present', () => {
  const first = frame(1, 0);
  const second = frame(2, 20);
  const sample = selectBufferedWorldFrame([
    { frame: first, receivedAt: 500, playbackAt: 100 },
    { frame: second, receivedAt: 550, playbackAt: 133 },
  ], 116.5);

  assert.equal(sample.alpha, 0.5);
  assert.equal(sample.frame.players[0].x, 10);
});

test('delayed buffer interpolates, holds on loss, and never extrapolates', () => {
  const first = frame(1, 0);
  const second = frame(2, 20);
  const third = frame(3, 40);
  const samples = [
    { frame: first, receivedAt: 100 },
    { frame: second, receivedAt: 133 },
    { frame: third, receivedAt: 166 },
  ];

  const early = selectBufferedWorldFrame(samples, 80);
  assert.equal(early.frame, first);

  const middle = selectBufferedWorldFrame(samples, 116.5);
  assert.equal(middle.alpha, 0.5);
  assert.equal(middle.frame.players[0].x, 10);

  const held = selectBufferedWorldFrame(samples, 500);
  assert.equal(held.frame, third);
  assert.equal(held.alpha, 1);

  const lost = selectBufferedWorldFrame([
    { frame: first, receivedAt: 100 },
    { frame: third, receivedAt: 300 },
  ], 200);
  assert.equal(lost.frame, first);
  assert.equal(lost.alpha, 0);
});
