import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTanksWorldPacket,
  isValidTanksWorldFrame,
  getTankAmmoVisual,
} from '../src/games/tanksView.js';

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624 },
    obstacles: [{ x: 300, y: 120, w: 40, h: 200 }],
    tanks: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      angle: 0.5,
      size: 20,
      isDriving: true,
      muzzleFlashTimer: 0.06,
      slotType: 'human',
      hasShield: false,
      shield: false,
      stunTimer: 0,
      chamber: 1,
      maxBullets: 2,
      reloadTimer: 0.5,
      reloadCooldown: 1.1,
      hasTripleShot: false,
    }],
    bullets: [{ x: 420, y: 300, radius: 4.5, owner: 0 }],
    shotTracers: [{ x1: 400, y1: 300, x2: 446, y2: 300, life: 0.06, color: '#D84727' }],
    crates: [{ x: 200, y: 220, size: 22, type: 'SHIELD' }],
    particles: [{ x: 100, y: 100, size: 4, life: 0.3, maxLife: 0.65, color: '#1A1A1A' }],
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
    suddenDeath: false,
    suddenDeathRadius: 0,
  };
}

test('tanks world packet is declarative, complete and monotonic', () => {
  const game = makeGame();
  const first = createTanksWorldPacket(game);
  const second = createTanksWorldPacket(game);

  assert.equal(first.mode, 'TANKS');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.obstacles[0], [300, 120, 40, 200]);
  assert.deepEqual(first.bullets[0], [420, 300, 4.5, 0, 0, 0, 1]);
  assert.equal(first.tracers[0].life, 0.1);
  assert.deepEqual(first.crates[0], [200, 220, 22, 'SHIELD']);
  assert.equal(first.suddenDeath.active, false);
  assert.equal(first.suddenDeath.radius, 0);
  assert.equal(first.intro.active, false);
  assert.equal(first.intro.time, 0);
  const tk = first.players[0];
  assert.equal(tk.driving, true);
  assert.equal(tk.chamber, 1);
  assert.equal(tk.maxAmmo, 2);
  assert.equal(tk.triple, false);

  assert.ok(isValidTanksWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidTanksWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('tanks world packet keeps a full legal triple-shot burst', () => {
  const game = makeGame();
  game.bullets = Array.from({ length: 16 }, (_, i) => ({
    x: 100 + i, y: 100, radius: 4.5, owner: i % 4,
  }));
  const frame = createTanksWorldPacket(game);
  assert.equal(frame.bullets.length, 16);
  assert.equal(isValidTanksWorldFrame({ action: 'WORLD_FRAME', ...frame }), true);
});

test('tanks world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createTanksWorldPacket(game) };

  assert.equal(isValidTanksWorldFrame(frame), true);
  assert.equal(isValidTanksWorldFrame({ ...frame, bullets: [[0, 0, 4, 9]] }), false);
  assert.equal(isValidTanksWorldFrame({ ...frame, tracers: [{ x1: 0, y1: 0, x2: 1, y2: 1 }] }), false);
  assert.equal(isValidTanksWorldFrame({ ...frame, players: [{ ...frame.players[0], chamber: 1.5 }] }), false);
  assert.equal(isValidTanksWorldFrame({ ...frame, suddenDeath: { ...frame.suddenDeath, radius: -1 } }), false);
  assert.equal(isValidTanksWorldFrame({ ...frame, mode: 'HEIST' }), false);
});

test('tank ammo visual is shared between HUD packet and world draw', () => {
  const hostTank = makeGame().tanks[0];
  const snapTank = createTanksWorldPacket(makeGame()).players[0];

  const fromHost = getTankAmmoVisual(hostTank);
  const fromSnap = getTankAmmoVisual(snapTank);

  assert.equal(fromHost.readyCount, 1);
  assert.equal(fromSnap.readyCount, 1);
  assert.ok(Math.abs(fromHost.progress - fromSnap.progress) < 0.06);
  assert.deepEqual(getTankAmmoVisual({}), { readyCount: 2, progress: 0 });
});
