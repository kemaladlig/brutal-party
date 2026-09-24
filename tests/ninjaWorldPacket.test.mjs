import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNinjaWorldPacket,
  isValidNinjaWorldFrame,
} from '../src/games/ninjaView.js';

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624 },
    obstacles: [{ x: 300, y: 120, w: 40, h: 200 }],
    lanterns: [{ x: 400, y: 300, radius: 60, active: true }],
    footsteps: [{ x: 390, y: 290, alpha: 0.4 }],
    cutDecals: [{ x: 400, y: 300, angle: 0.5, length: 220, color: '#D84727', life: 0.07, maxLife: 0.44, maxWidth: 5.5 }],
    afterimages: [{ x: 395, y: 295, angle: 0.5, alpha: 0.75, color: '#D84727' }],
    slashWaves: [{
      x: 400, y: 300, angle: 0.5, color: '#D84727', life: 0.1, maxLife: 0.52,
      maxDist: 220, outerRadius: 68, innerRadius: 22, arcSpan: 2.5,
      waves: [
        { delay: 0, scale: 1, aura: '#D84727', width: 4.5 },
        { delay: 0.07, scale: 0.85, aura: '#FFFFFF', width: 3.2 },
      ],
    }],
    impactCuts: [{ x: 410, y: 300, angle: 0.5, color: '#D84727', life: 0.1, maxLife: 0.35 }],
    particles: [
      { x: 100, y: 100, radius: 4, alpha: 0.7, color: '#888888' },
      { type: 'shockRing', x: 200, y: 200, radius: 12, alpha: 0.9, color: '#D84727' },
    ],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      angle: 0.5,
      alpha: 1,
      strikeTimer: 0.1,
      strikeCooldown: 0.6,
      smokeCooldown: 0,
    }],
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('ninja world packet is declarative, complete and monotonic', () => {
  const game = makeGame();
  const first = createNinjaWorldPacket(game);
  const second = createNinjaWorldPacket(game);

  assert.equal(first.mode, 'NINJA');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.obstacles[0], [300, 120, 40, 200]);
  assert.equal(first.lanterns[0].active, true);
  assert.deepEqual(first.steps[0], [390, 290, 0.4]);
  assert.equal(first.decals[0].life, 0.07);
  assert.equal(first.ghosts[0].alpha, 0.75);
  assert.equal(first.slashes[0].waves[1].delay, 0.07);
  assert.equal(first.impacts[0].maxLife, 0.35);
  assert.equal(first.fx[1].ring, true);
  const p = first.players[0];
  assert.equal(p.strike, true);
  assert.ok(p.strikeProg > 0 && p.strikeProg < 1);
  assert.equal(p.smokeProg, null);

  assert.ok(isValidNinjaWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidNinjaWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('ninja world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createNinjaWorldPacket(game) };

  assert.equal(isValidNinjaWorldFrame(frame), true);
  assert.equal(isValidNinjaWorldFrame({ ...frame, slashes: [{ ...frame.slashes[0], waves: [1, 2, 3, 4, 5] }] }), false);
  assert.equal(isValidNinjaWorldFrame({ ...frame, fx: [{ ...frame.fx[0], ring: 1 }] }), false);
  assert.equal(isValidNinjaWorldFrame({ ...frame, players: [{ ...frame.players[0], alpha: NaN }] }), false);
  assert.equal(isValidNinjaWorldFrame({ ...frame, mode: 'CLONE' }), false);
});
