import test from 'node:test';
import assert from 'node:assert/strict';
import { createPongWorldPacket, isValidPongWorldFrame } from '../src/games/pongView.js';
import { createCrownWorldPacket, isValidCrownWorldFrame } from '../src/games/crownView.js';
import { createSnakeWorldPacket, isValidSnakeWorldFrame } from '../src/games/snakeView.js';
import { createWorldViewRenderer as pongRenderer } from '../src/ui/pongWorldView.js';
import { createWorldViewRenderer as crownRenderer } from '../src/ui/crownWorldView.js';
import { createWorldViewRenderer as snakeRenderer } from '../src/ui/snakeWorldView.js';
import { blendWorldFrames } from '../src/core/worldInterpolation.js';
import { CARTRIDGES, GAME_ORDER } from '../src/core/engineRegistry.js';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get(target, key) { return key in target ? target[key] : noop; },
  set(target, key, value) { target[key] = value; return true; },
});

function pongGame() {
  return {
    state: 'PLAYING', roundId: 2, roundLimit: 120, roundPlayTimer: 4,
    setScores: [1, 0, 0, 0], winner: null, roundWinner: null,
    arena: { left: 20, top: 30, right: 780, bottom: 570 },
    paddles: [
      { index: 0, isJoined: true, isEliminated: false, coord: 400, fixedPerpendicular: 540, side: 'bottom', axis: 'horizontal', length: 90, thickness: 16, lives: 3, isBot: false, spinCharge: 0 },
      { index: 1, isJoined: true, isEliminated: false, coord: 400, fixedPerpendicular: 60, side: 'top', axis: 'horizontal', length: 90, thickness: 16, lives: 2, isBot: true, spinCharge: 4 },
      { index: 2, isJoined: false, isEliminated: true, coord: 0, fixedPerpendicular: 0, side: 'left', axis: 'vertical', length: 90, thickness: 16, lives: 0, isBot: false, spinCharge: 0 },
      { index: 3, isJoined: false, isEliminated: true, coord: 0, fixedPerpendicular: 0, side: 'right', axis: 'vertical', length: 90, thickness: 16, lives: 0, isBot: false, spinCharge: 0 },
    ],
    ball: { x: 400, y: 300, radius: 11, spin: 0, rallyCount: 5, isSmash: false, isDead: false, trail: [], shockwaves: [] },
    getGoalBounds: () => ({ goalMin: 260, goalMax: 540 }),
  };
}

function crownGame() {
  return {
    state: 'PLAYING', roundId: 1, arena: { left: 20, top: 30, right: 780, bottom: 570 },
    scores: [0, 0, 0, 0], roundWinner: null, matchWinner: null, roundTimer: 30,
    players: [
      { index: 0, isJoined: true, isAlive: true, x: 200, y: 300, radius: 18, hasCrown: true, crownHoldTime: 1, turboTimer: 0, slipTimer: 0 },
      { index: 1, isJoined: true, isAlive: true, x: 260, y: 340, radius: 18, hasCrown: false, crownHoldTime: 0, turboTimer: 0, slipTimer: 0 },
      { index: 2, isJoined: false, isAlive: false, x: 0, y: 0, radius: 18, hasCrown: false, crownHoldTime: 0, turboTimer: 0, slipTimer: 0 },
      { index: 3, isJoined: false, isAlive: false, x: 0, y: 0, radius: 18, hasCrown: false, crownHoldTime: 0, turboTimer: 0, slipTimer: 0 },
    ],
    crown: { x: 200, y: 270, radius: 20, carrierIndex: 0 },
    pillars: [], conveyors: [], bumpers: [], movingHazards: [], bananaPeels: [], inkPuddles: [], speedPads: [], pickups: [], particles: [],
  };
}

function snakeGame() {
  const segments = Array.from({ length: 8 }, (_, i) => ({ x1: i * 5, y1: 0, x2: (i + 1) * 5, y2: 0 }));
  return {
    state: 'PLAYING', roundId: 1, arena: { left: 16, top: 24, right: 816, bottom: 624 },
    walls: [{ x: 300, y: 120, w: 40, h: 200 }],
    foods: [{ x: 200, y: 220, type: 'APPLE', radius: 15 }],
    players: [{ index: 0, isJoined: true, isAlive: true, x: 40, y: 0, angle: 0.5, isBoost: false, boostEnergy: 90, boostLocked: false, segments }],
    particles: [],
    scores: [0, 0, 0, 0], roundWinner: null, matchWinner: null,
  };
}

test('PONG/CROWN packets validate and preserve essential state', () => {
  const pong = createPongWorldPacket(pongGame());
  const crown = createCrownWorldPacket(crownGame());
  assert.equal(pong.mode, 'PONG');
  assert.equal(crown.crown.carrier, 0);
  assert.ok(isValidPongWorldFrame({ action: 'WORLD_FRAME', ...pong }));
  assert.ok(isValidCrownWorldFrame({ action: 'WORLD_FRAME', ...crown }));
  assert.equal(isValidPongWorldFrame({ ...pong, ball: { ...pong.ball, radius: -1 } }), false);
  assert.equal(isValidCrownWorldFrame({ ...crown, crown: { ...crown.crown, carrier: 9 } }), false);
});

test('PONG/CROWN client renderers draw without importing simulation', () => {
  for (const [createRenderer, frame] of [
    [pongRenderer, createPongWorldPacket(pongGame())],
    [crownRenderer, createCrownWorldPacket(crownGame())],
  ]) {
    const renderer = createRenderer();
    assert.equal(renderer.validate({ action: 'WORLD_FRAME', ...frame }), true);
    assert.doesNotThrow(() => renderer.render(context, { action: 'WORLD_FRAME', ...frame }, 800, 450, [], 1000));
    assert.doesNotThrow(() => renderer.renderPlaceholder(context, 800, 450));
    assert.doesNotThrow(() => renderer.renderStale(context, 800, 450));
  }
});

test('packed-wall world views render an interpolated frame without throwing', () => {
  // SNAKE `walls` alanını paketlenmiş dizi olarak yollar. Client 30 Hz
  // kareleri enterpolasyonla sunduğu için blend bu listeyi nesneye yayıyor,
  // view'ın `([x, y, w, h]) => ...` destructuring'i TypeError atıyor ve
  // GamepadWorldView placeholder'a düşüyordu (SNAKE beyaz ekran).
  // Üretim yolunun kendisi (paket → blend → render) kilit altında.
  for (const [createRenderer, createPacket, validate, game] of [
    [snakeRenderer, createSnakeWorldPacket, isValidSnakeWorldFrame, snakeGame()],
  ]) {
    const first = { action: 'WORLD_FRAME', ...createPacket(game) };
    const second = { action: 'WORLD_FRAME', ...createPacket(game) };
    const renderer = createRenderer();
    const interpolated = blendWorldFrames(first, second, 0.5);

    assert.ok(Array.isArray(interpolated.walls[0]), 'paketlenmiş walls dizi kalmalı');
    assert.equal(validate(interpolated), true, 'enterpolasyon sonrası kare geçerli');
    assert.doesNotThrow(() => renderer.render(context, interpolated, 800, 450, [], 1000));
    // Uç kareler de (alpha 0/1 paketi olduğu gibi döner) çizilebilmeli.
    assert.doesNotThrow(() => renderer.render(context, first, 800, 450, [], 1000));
    assert.doesNotThrow(() => renderer.render(context, second, 800, 450, [], 1000));
  }
});

test('every registered cartridge exposes the generic world-view contract', () => {
  assert.equal(GAME_ORDER.length, 12);
  for (const id of GAME_ORDER) {
    assert.equal(typeof CARTRIDGES[id]?.worldView?.load, 'function', `${id} worldView.load`);
  }
});
