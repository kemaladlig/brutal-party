import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HORDE_VIEW_LIMITS,
  createHordeWorldPacket,
  hordeSceneFromFrame,
  isValidHordeWorldFrame,
} from '../src/games/hordeView.js';
import { createWorldViewRenderer } from '../src/ui/hordeWorldView.js';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get(target, key) {
    return key in target ? target[key] : noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

function makeGame() {
  return {
    state: 'PLAYING',
    roundId: 2,
    round: 2,
    wave: 3,
    waveTimer: 41.5,
    waveTimedOut: false,
    isBossWave: false,
    matchResult: null,
    arena: { left: 20, top: 30, right: 780, bottom: 570, width: 760, height: 540, size: 540, cx: 400, cy: 300 },
    scores: [7, 4, 0, 0],
    roundWinner: null,
    matchWinner: null,
    players: [0, 1, 2, 3].map((index) => ({
      index,
      x: 300 + index * 40,
      y: 260 + index * 20,
      angle: index * 0.4,
      color: ['#D84727', '#1D5D8A', '#D99B26', '#2D6A4F'][index],
      isJoined: index < 2,
      isAlive: index !== 1,
      hp: index === 1 ? 0 : 4,
      dashCooldown: index * 0.5,
      dashTimer: 0,
      invulnTimer: index === 0 ? 0.2 : 0,
      spawnProt: 0,
      shield: index === 0,
      fastTimer: index === 0 ? 3 : 0,
      tripleTimer: 0,
      isAiming: index === 0,
      expression: 'FOCUS',
      accessory: 'NONE',
      pattern: 'SOLID',
    })),
    enemies: [
      { id: 1, x: 500, y: 300, radius: 18, angle: 1, hp: 3, maxHp: 3, type: 'chaser', isBoss: false, hitTimer: 0 },
      { id: 2, x: 600, y: 360, radius: 28, angle: 0, hp: 20, maxHp: 32, type: 'shooter', isBoss: true, hitTimer: 0.1 },
    ],
    projectiles: Array.from({ length: 70 }, (_, index) => ({
      id: index + 1,
      x: 200 + index,
      y: 220,
      vx: 400,
      vy: 0,
      radius: 6,
      isEnemy: index % 2 === 0,
      color: index % 2 === 0 ? '#E63946' : '#D84727',
    })),
    tombs: [{ x: 260, y: 340, ownerIndex: 1, timer: 1.5 }],
    portal: { x: 400, y: 300, radius: 44, timer: 1.2 },
    pickups: [{ x: 500, y: 220, type: 'TRIPLE', animTime: 1.3, size: 30 }],
    particles: [],
    floatingTexts: [{ x: 300, y: 200, text: '+3', alpha: 0.8, color: '#D84727' }],
  };
}

test('horde world packet is complete, monotonic and capped', () => {
  const game = makeGame();
  game.enemies = [...game.enemies, ...Array.from({ length: 40 }, (_, index) => ({
    id: index + 3,
    x: 250 + index * 10,
    y: 260,
    radius: 16,
    angle: 0,
    hp: 2,
    maxHp: 3,
    type: 'chaser',
    isBoss: false,
    hitTimer: 0,
  }))];
  const first = createHordeWorldPacket(game);
  const second = createHordeWorldPacket(game);

  assert.equal(first.mode, 'HORDE');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);
  assert.equal(first.bullets.length, HORDE_VIEW_LIMITS.bullets);
  assert.equal(first.enemies[1].boss, true);
  assert.equal(first.players[0].shield, true);
  assert.deepEqual(first.tombs[0], [260, 340, 1, 0.5]);
  assert.equal(first.portal.length, 4);
  assert.ok(JSON.stringify(first).length < 24_000);
  assert.ok(isValidHordeWorldFrame({ action: 'WORLD_FRAME', ...first }));
});

test('horde world validation rejects malformed entities and hostile counts', () => {
  const frame = { action: 'WORLD_FRAME', ...createHordeWorldPacket(makeGame()) };
  assert.equal(isValidHordeWorldFrame(frame), true);
  assert.equal(isValidHordeWorldFrame({ ...frame, mode: 'LASER' }), false);
  assert.equal(isValidHordeWorldFrame({ ...frame, enemies: [{ ...frame.enemies[0], hp: 1.5 }] }), false);
  assert.equal(isValidHordeWorldFrame({ ...frame, bullets: [[0, 0, 0]] }), false);
  assert.equal(isValidHordeWorldFrame({ ...frame, round: 0 }), false);
  assert.equal(isValidHordeWorldFrame({ ...frame, matchResult: 'draw' }), false);
});

test('client-only renderer draws a validated horde frame without simulation', () => {
  const frame = { action: 'WORLD_FRAME', ...createHordeWorldPacket(makeGame()) };
  const renderer = createWorldViewRenderer();
  assert.doesNotThrow(() => renderer.render(context, frame, 800, 450, [], 1000));
  assert.doesNotThrow(() => renderer.renderPlaceholder(context, 800, 450));
  assert.doesNotThrow(() => renderer.renderStale(context, 800, 450));
});

test('client scene reconstruction keeps identity and render-only data separate', () => {
  const frame = { action: 'WORLD_FRAME', ...createHordeWorldPacket(makeGame()) };
  const scene = hordeSceneFromFrame(frame);
  assert.equal(scene.players.length, 4);
  assert.equal(scene.enemies.length, 2);
  assert.equal(scene.bullets.length, HORDE_VIEW_LIMITS.bullets);
  assert.equal(scene.portal.progress, 0.4);
  assert.equal(scene.pickups[0].type, 'TRIPLE');
  assert.equal(scene.texts[0].text, '+3');
});
