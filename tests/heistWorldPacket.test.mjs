import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHeistWorldPacket,
  isValidHeistWorldFrame,
} from '../src/games/heistView.js';
import { isValidWorldBase, createWorldSnapshot } from '../src/games/worldCore.js';

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624 },
    pillars: [{ x: 300, y: 120, w: 40, h: 200 }],
    vaults: [{ x: 16, y: 24, w: 120, h: 90, playerIndex: 0 }],
    lootItems: [{ x: 400, y: 300, radius: 10, type: 'COIN' }],
    piggyBank: { x: 500, y: 300, radius: 18, hp: 2, maxHp: 3, animTime: 1.1 },
    floatingTexts: [{ x: 400, y: 280, text: '+3', life: 0.8, maxLife: 1, color: '#2D6A4F' }],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 320,
      facingAngle: 0.5,
      radius: 14,
      stumbleTimer: 0,
      isTackling: false,
      carriedGold: 6,
      vaultGold: 4,
      tackleCooldown: 1.2,
    }],
    particles: [{ x: 100, y: 100, size: 4, life: 0.6, maxLife: 1, color: '#1A1A1A' }],
    roundTimer: 32.5,
    goldRushActive: false,
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('heist world packet is declarative, complete and monotonic', () => {
  const game = makeGame();
  const first = createHeistWorldPacket(game);
  const second = createHeistWorldPacket(game);

  assert.equal(first.mode, 'HEIST');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.arena, [16, 24, 816, 624]);
  assert.deepEqual(first.pillars[0], [300, 120, 40, 200]);
  assert.deepEqual(first.vaults[0], [16, 24, 120, 90, 0]);
  assert.deepEqual(first.loot[0], [400, 300, 10, 'COIN']);
  assert.equal(first.piggy.hp, 2);
  assert.equal(first.texts[0].text, '+3');
  assert.equal(first.players[0].carried, 6);
  assert.equal(first.players[0].vault, 4);
  assert.equal(first.roundTimer, 32.5);

  assert.ok(isValidHeistWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidHeistWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('heist world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createHeistWorldPacket(game) };

  assert.equal(isValidHeistWorldFrame(frame), true);
  assert.equal(isValidHeistWorldFrame({ ...frame, vaults: [[0, 0, 10, 10, 9]] }), false);
  assert.equal(isValidHeistWorldFrame({ ...frame, piggy: { x: 1, y: 2 } }), false);
  assert.equal(isValidHeistWorldFrame({ ...frame, loot: [[0, 0, 5]] }), false);
  assert.equal(isValidHeistWorldFrame({ ...frame, players: [{ ...frame.players[0], carried: 1.5 }] }), false);
  assert.equal(isValidHeistWorldFrame({ ...frame, mode: 'BOMB' }), false);
});

test('worldCore base validator guards shared fields', () => {
  const game = makeGame();
  const snap = createWorldSnapshot(game, {
    mode: 'HEIST',
    mapPlayer: (p) => ({ slot: p.index, x: p.x, y: p.y }),
  });
  const frame = { action: 'WORLD_FRAME', ...snap };

  assert.equal(isValidWorldBase(frame, 'HEIST'), true);
  assert.equal(isValidWorldBase({ ...frame, seq: -1 }, 'HEIST'), false);
  assert.equal(isValidWorldBase({ ...frame, arena: [0, 0, 1] }, 'HEIST'), false);
  assert.equal(isValidWorldBase(null, 'HEIST'), false);
  assert.equal(createWorldSnapshot(null, { mode: 'X', mapPlayer: () => ({}) }), null);
});
