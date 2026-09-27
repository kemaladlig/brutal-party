import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidNetworkInput } from '../src/core/networkProtocol.js';
import { roundGapSeconds } from '../src/core/roundLifecycle.js';

test('accepts controller actions used by every online game schema', () => {
  const packets = [
    { action: 'JOYSTICK_MOVE', dx: 0, dy: 0, angle: 0, force: 0 },
    { action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: false, seq: 1 },
    { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 },
    { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 },
    { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1, tap: true },
    { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, tap: true, seq: 9 },
    { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1, cancelled: false },
    { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, cancelled: true },
    { action: 'PADDLE_MOVE', position: 0.5 },
    { action: 'CURVE_STEER', dir: -1 },
    { action: 'SNAKE_STEER', dir: 1 },
    { action: 'TANK_DRIVE', driving: true },
    { action: 'TANK_FIRE' },
    { action: 'DASH' },
    { action: 'TACKLE' },
    { action: 'SPIN' },
    { action: 'SNAKE_BOOST' },
    { action: 'SNAKE_BOOST_RELEASE' },
    { action: 'NINJA_SMOKE' },
    { action: 'SWITCH_SLOT', targetSlot: 2 },
    { action: 'SET_NAME', name: 'PLAYER' },
    { action: 'AVATAR_UPDATE', avatar: {} },
  ];

  for (const packet of packets) {
    assert.equal(isValidNetworkInput(packet), true, packet.action);
  }
});

test('rejects malformed or out-of-range network input', () => {
  assert.equal(isValidNetworkInput({ action: 'JOYSTICK_MOVE', dx: NaN, dy: 0, angle: 0, force: 0 }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, cancelled: 'yes' }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, seq: -1 }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: 'yes' }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, tap: 'yes' }), false);
  assert.equal(isValidNetworkInput({ action: 'PADDLE_MOVE', position: 1.2 }), false);
  assert.equal(isValidNetworkInput({ action: 'SNAKE_STEER', dir: 2 }), false);
  assert.equal(isValidNetworkInput({ action: 'SWITCH_SLOT', targetSlot: 4 }), false);
  assert.equal(isValidNetworkInput({ action: 'UNKNOWN' }), false);
  for (const action of ['SNAKE_DIR', 'ARCHER_CHARGE', 'ARCHER_CHARGE_END', 'LASER_AIM', 'LASER_FIRE', 'LASER_FIRE_RELEASE', 'HORDE_FIRE', 'HORDE_FIRE_RELEASE']) {
    assert.equal(isValidNetworkInput({ action }), false, `${action} artik kabul edilmemeli`);
  }
});

// `roundGap` 8 Hz paketin tek yeni alanı: kumanda raunt boşluğunun süresini
// buradan okur. Boşluk yoksa alan kesinlikle 0 olmalı — aksi hâlde rozet oyun
// ortasında belirir.
test('roundGap is zero outside the round-over gap', () => {
  assert.equal(roundGapSeconds(undefined), 0);
  assert.equal(roundGapSeconds(null), 0);
  assert.equal(roundGapSeconds({}), 0);
  for (const state of ['PLAYING', 'MATCH_OVER', 'LOBBY', 'ROUND_PAUSE']) {
    assert.equal(roundGapSeconds({ state, roundTransitionTimer: 2.4 }), 0, `${state} boşluk sayılmaz`);
  }
});

// Motorlar sayacı farklı adta tutuyor: ortak sözleşme `roundTransitionTimer`,
// PONG kendi `roundOverTimer`'ını taşıyor. Tek kapı ikisini de okur, yoksa
// her motora ayrı bir paket dalı yazılır (AGENTS §8).
test('roundGap reads both timer field names', () => {
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: 2.4 }), 2.5);
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundOverTimer: 1.8 }), 2);
  assert.equal(
    roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: 1.0, roundOverTimer: 9.9 }),
    1,
    'ortak sözleşme alanı kazanmalı',
  );
});

// 0.5 sn kovası §5 bütçesinin parçası: daha ince kova boşluk boyunca her karede
// farklı JSON üretir ve 8 Hz'de gereksiz taşıma yapardı.
test('roundGap quantizes to half seconds and never goes negative', () => {
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: 2.51 }), 3);
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: 2.5 }), 2.5);
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: 0 }), 0);
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: -1 }), 0);
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: NaN }), 0);
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundTransitionTimer: '2.4' }), 2.5);
});
