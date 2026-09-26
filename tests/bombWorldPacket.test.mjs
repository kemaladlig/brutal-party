import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBombWorldPacket,
  isValidBombWorldFrame,
} from '../src/games/bombView.js';

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624 },
    pillars: [{ x: 300, y: 120, w: 40, h: 200 }],
    pickups: [{ x: 200, y: 220, type: 'TURBO', animTime: 1.2, size: 15 }],
    inkPuddles: [{ x: 400, y: 500, radius: 26 }],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      facingAngle: 0.5,
      radius: 14,
      stumbleTimer: 0,
      immunityTimer: 1.2,
      dashTimer: 0,
      turboTimer: 0,
      slipTimer: 0,
      slipAngle: 0,
      dashCooldown: 0,
      dashMaxCooldown: 2.2,
    }],
    particles: [{ x: 100, y: 100, size: 4, life: 0.6, maxLife: 1, color: '#1A1A1A' }],
    bombCarrierIndex: 0,
    bombTimer: 8.4,
    bombMaxTime: 15,
    scores: [1, 2, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('bomb world packet is compact, complete and monotonic', () => {
  const game = makeGame();
  const first = createBombWorldPacket(game);
  const second = createBombWorldPacket(game);

  assert.equal(first.mode, 'BOMB');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.arena, [16, 24, 816, 624]);
  assert.deepEqual(first.pillars[0], [300, 120, 40, 200]);
  assert.equal(first.ink[0][2], 26);
  assert.equal(first.pickups[0][2], 'TURBO');
  assert.equal(first.carrier, 0);
  assert.equal(first.players[0].immunity, 1.2);
  assert.equal(first.players[0].cdMax, 2.2);
  assert.equal(first.particles[0].color, '#1A1A1A');
  assert.equal(first.scores[1], 2);

  assert.ok(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('bomb world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createBombWorldPacket(game) };

  assert.equal(isValidBombWorldFrame(frame), true);
  assert.equal(isValidBombWorldFrame({ ...frame, arena: [0, 0, NaN, 100] }), false);
  assert.equal(isValidBombWorldFrame({ ...frame, players: [{ ...frame.players[0], slot: 9 }] }), false);
  assert.equal(isValidBombWorldFrame({ ...frame, carrier: 7 }), false);
  assert.equal(isValidBombWorldFrame({ ...frame, mode: 'SNAKE' }), false);
});

test('bomb blast travels as a single nullable 4-number event', () => {
  const idle = createBombWorldPacket(makeGame());
  assert.equal(idle.blast, null);
  assert.equal(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...idle }), true);

  const frame = createBombWorldPacket({ ...makeGame(), blast: { x: 400, y: 300, t: 0.24, max: 0.6 } });
  assert.deepEqual(frame.blast, { x: 400, y: 300, t: 0.2, max: 0.6 });
  assert.equal(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...frame }), true);
  assert.equal(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...frame, blast: { x: 1, y: 2, t: 3, max: 0.6 } }), false);
  assert.equal(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...frame, blast: { x: 1, y: 2, t: 0.1, max: 0 } }), false);
  assert.equal(isValidBombWorldFrame({ action: 'WORLD_FRAME', ...frame, blast: { x: NaN, y: 2, t: 0.1, max: 0.6 } }), false);
});
