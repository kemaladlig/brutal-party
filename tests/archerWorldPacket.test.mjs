import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArcherWorldPacket,
  isValidArcherWorldFrame,
} from '../src/games/archerView.js';

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 2,
    arena: { left: 16, top: 24, right: 816, bottom: 624 },
    obstacles: [{ x: 100, y: 120, w: 40, h: 50 }],
    pickups: [{ x: 200, y: 220, type: 'TURBO', animTime: 1.2, size: 15 }],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      angle: 0.5,
      charging: true,
      charge: 0.7,
      swayPhase: 1.3,
      shield: 1,
      stun: 0,
      reloadCooldown: 0.4,
    }],
    arrows: [{ x: 410, y: 300, vx: 300, vy: 0, color: '#D84727' }],
    particles: [{ x: 100, y: 100, radius: 3, alpha: 0.8, color: '#FFFFFF' }],
    scores: [2, 1, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('archer world packet is compact, complete and monotonic', () => {
  const game = makeGame();
  const first = createArcherWorldPacket(game);
  const second = createArcherWorldPacket(game);

  assert.equal(first.mode, 'ARCHER');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.arena, [16, 24, 816, 624]);
  assert.deepEqual(first.obstacles[0], [100, 120, 40, 50]);
  assert.equal(first.pickups[0][2], 'TURBO');
  assert.equal(first.players[0].charge, 0.7);
  assert.equal(first.players[0].charging, true);
  assert.equal(first.players[0].shield, 1);
  assert.equal(first.arrows[0][2], 300);
  assert.equal(first.scores[0], 2);

  assert.ok(isValidArcherWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidArcherWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('archer world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createArcherWorldPacket(game) };

  assert.equal(isValidArcherWorldFrame(frame), true);
  assert.equal(isValidArcherWorldFrame({ ...frame, arena: [0, 0, NaN, 100] }), false);
  assert.equal(isValidArcherWorldFrame({ ...frame, players: [{ ...frame.players[0], slot: 9 }] }), false);
  assert.equal(isValidArcherWorldFrame({ ...frame, mode: 'SNAKE' }), false);
});
