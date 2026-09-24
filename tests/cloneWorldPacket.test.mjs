import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCloneWorldPacket,
  isValidCloneWorldFrame,
} from '../src/games/cloneView.js';

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624 },
    taskPoints: [{ id: 'treasury', name: 'HAZİNE SANDIĞI', icon: '💎', color: '#1D5D8A', x: 200, y: 200, radius: 40 }],
    walls: [{ x: 300, y: 120, w: 40, h: 200 }],
    npcClones: [{
      ownerIndex: 0, color: '#D84727', x: 500, y: 300, angle: 1.1,
      state: 'TASK', taskWaitTimer: 2, active: true,
    }],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      angle: 0.5,
      dashTimer: 0.2,
      slowTimer: 0,
      taskTimer: 0.8,
    }],
    particles: [{ x: 100, y: 100, radius: 4, alpha: 0.7, color: '#1A1A1A' }],
    floatingTexts: [{ x: 400, y: 280, text: '+1', alpha: 0.9, color: '#2D6A4F' }],
    roundTime: 42.5,
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('clone world packet is declarative, complete and monotonic', () => {
  const game = makeGame();
  const first = createCloneWorldPacket(game);
  const second = createCloneWorldPacket(game);

  assert.equal(first.mode, 'CLONE');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.walls[0], [300, 120, 40, 200]);
  assert.equal(first.stations[0].icon, 'gem');
  assert.equal(first.stations[0].name, 'HAZİNE SANDIĞI');
  assert.equal(first.clones[0].owner, 0);
  assert.equal(first.clones[0].task, 1);
  const p = first.players[0];
  assert.equal(p.dash, true);
  assert.equal(p.slow, false);
  assert.equal(p.task, 0.8);
  assert.equal(first.particles[0].life, 0.7);
  assert.equal(first.texts[0].alpha, 0.9);
  assert.equal(first.roundTime, 42.5);

  assert.ok(isValidCloneWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidCloneWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('clone world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createCloneWorldPacket(game) };

  assert.equal(isValidCloneWorldFrame(frame), true);
  assert.equal(isValidCloneWorldFrame({ ...frame, clones: [{ ...frame.clones[0], owner: 9 }] }), false);
  assert.equal(isValidCloneWorldFrame({ ...frame, stations: [{ ...frame.stations[0], icon: 5 }] }), false);
  assert.equal(isValidCloneWorldFrame({ ...frame, players: [{ ...frame.players[0], dash: 1 }] }), false);
  assert.equal(isValidCloneWorldFrame({ ...frame, mode: 'TANKS' }), false);
});
