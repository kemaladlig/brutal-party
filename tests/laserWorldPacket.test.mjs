import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLaserWorldPacket,
  isValidLaserWorldFrame,
  mapLaserPlayers,
} from '../src/games/laserView.js';

const TUNING = { maxActive: 3, maxAmmo: 2, maxHp: 3, reloadTime: 0.9, dashCd: 4.0 };

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624, size: 600, cx: 416, cy: 324 },
    obstacles: [{ x: 300, y: 120, w: 40, h: 200 }],
    movingWalls: [{ x: 400, y: 300, w: 60, h: 20, axis: 'x', minX: 350, maxX: 450, minY: 300, maxY: 300 }],
    pickups: [{ x: 200, y: 220, type: 'SHIELD', animTime: 1.2, size: 30 }],
    lasers: [{
      x: 420, y: 300, color: '#D84727',
      history: [{ x: 400, y: 300 }, { x: 410, y: 300 }],
    }],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      angle: 0,
      hp: 2,
      ammo: 1,
      reloadTimer: 0,
      shotCooldown: 0,
      dashCooldown: 2,
      shield: true,
      tripleTimer: 0,
      fastTimer: 0,
      invulnTimer: 0,
      respawnTimer: 0,
      isAiming: true,
    }],
    particles: [{ x: 100, y: 100, radius: 4, alpha: 0.7, color: '#FFDE59' }],
    floatingTexts: [{ x: 400, y: 280, text: '+1 KILL', alpha: 0.9, color: '#2D6A4F' }],
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
    traceAim(p) {
      return [{ x: p.x, y: p.y }, { x: p.x + 50, y: p.y }];
    },
  };
}

test('laser world packet is declarative, complete and monotonic', () => {
  const game = makeGame();
  const first = createLaserWorldPacket(game, TUNING);
  const second = createLaserWorldPacket(game, TUNING);

  assert.equal(first.mode, 'LASER');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.obstacles[0], [300, 120, 40, 200]);
  assert.equal(first.walls[0].axis, 'x');
  assert.deepEqual(first.pickups[0], [200, 220, 'SHIELD', 1.2, 30]);
  assert.equal(first.lasers[0].trail.length, 2);
  const p = first.players[0];
  assert.equal(p.hp, 2);
  assert.equal(p.hpMax, 3);
  assert.equal(p.shield, true);
  assert.equal(p.aiming, true);
  assert.equal(p.ready, true);
  assert.deepEqual(p.aim[1], [450, 300]);
  assert.equal(first.texts[0].text, '+1 KILL');

  assert.ok(isValidLaserWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidLaserWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('laser world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createLaserWorldPacket(game, TUNING) };

  assert.equal(isValidLaserWorldFrame(frame), true);
  assert.equal(isValidLaserWorldFrame({ ...frame, walls: [{ ...frame.walls[0], axis: 'z' }] }), false);
  assert.equal(isValidLaserWorldFrame({ ...frame, lasers: [{ ...frame.lasers[0], trail: [[0]] }] }), false);
  assert.equal(isValidLaserWorldFrame({ ...frame, players: [{ ...frame.players[0], hp: 1.5 }] }), false);
  assert.equal(isValidLaserWorldFrame({ ...frame, mode: 'NINJA' }), false);
});

test('laser player mapping is shared between render and snapshot', () => {
  const game = makeGame();
  const mapped = mapLaserPlayers(game.players, game.lasers, TUNING, (p) => game.traceAim(p), true);

  assert.equal(mapped[0].ready, true);
  assert.equal(mapped[0].dash, 0.5);
  assert.equal(mapped[0].reload, 1);
  assert.deepEqual(mapped[0].aim[0], [400, 300]);

  const lobby = mapLaserPlayers(game.players, game.lasers, TUNING, (p) => game.traceAim(p), false);
  assert.deepEqual(lobby[0].aim, []);
});
