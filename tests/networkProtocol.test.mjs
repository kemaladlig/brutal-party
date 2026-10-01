import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidNetworkInput,
  generateRoomCode,
  normalizeRoomCode,
  isValidRoomCode,
  normalizeStateSync,
} from '../src/core/networkProtocol.js';
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
  for (const action of ['SNAKE_DIR', 'ARCHER_CHARGE', 'ARCHER_CHARGE_END', 'HORDE_FIRE', 'HORDE_FIRE_RELEASE']) {
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

test('generateRoomCode produces 3-digit numeric codes', () => {
  for (let i = 0; i < 50; i++) {
    const code = generateRoomCode();
    assert.equal(typeof code, 'string');
    assert.match(code, /^\d{3}$/, `code ${code} should be 3 digits`);
    assert.equal(isValidRoomCode(code), true);
  }
});

test('normalizeRoomCode trims and uppercases code', () => {
  assert.equal(normalizeRoomCode('  a4x9  '), 'A4X9');
  assert.equal(normalizeRoomCode(123), '123');
  assert.equal(normalizeRoomCode(null), '');
  assert.equal(normalizeRoomCode(undefined), '');
});

// 8 Hz STATE_SYNC paketi iki transport'ta aynı şekilde gitmeli: discriminator
// en üstte, yük düz. TV_CONSOLE bir zamanlar `{type, state:{…}}` kovası yolluyordu
// ve kumanda en-üst-seviye alanları okuduğu için faz/sk_or/sayaç sessizce düşüyordu.
// Kilit: iki şekil de aynı düz pakete indirgenmeli.
test('normalizeStateSync flattens both transport shapes to one envelope', () => {
  const flat = {
    type: 'HOST_STATE_SYNC',
    gameMode: 'PONG',
    phase: 'GAME',
    scores: [3, 1, 0, 2],
    names: ['AYŞE', 'FATMA', null, null],
    roundGap: 0,
  };
  const nested = { type: 'HOST_STATE_SYNC', state: { ...flat, type: undefined } };

  const fromFlat = normalizeStateSync(flat);
  const fromNested = normalizeStateSync(nested);

  for (const [label, out] of [['düz', fromFlat], ['kovalı', fromNested]]) {
    assert.equal(out.phase, 'GAME', `${label}: faz en üstte olmalı`);
    assert.equal(out.gameMode, 'PONG', `${label}: gameMode en üstte olmalı`);
    assert.deepEqual(out.scores, [3, 1, 0, 2], `${label}: skor en üstte olmalı`);
    assert.deepEqual(out.names, flat.names, `${label}: isimler en üstte olmalı`);
    assert.equal(out.roundGap, 0, `${label}: roundGap en üstte olmalı`);
    assert.equal(out.state, undefined, `${label}: iç içe kova kalmamalı`);
  }
  // İki transport aynı tüketicinin gördüğü paketin aynı olmasını sağlar.
  assert.deepEqual(
    { ...fromFlat }, { ...fromNested },
    'düz ve kovalı zarf aynı pakete indirgenmeli',
  );
});

// ONLINE zarfı `action` ayırıcısı taşır; normalleştirici onu korumalı
// (sunucu/kumanda `msg.action` ile ayırıcıyı eşler).
test('normalizeStateSync keeps the transport discriminator', () => {
  const out = normalizeStateSync({
    action: 'STATE_SYNC',
    state: { phase: 'COUNTDOWN', gameMode: 'BOMB', t: 2 },
  });
  assert.equal(out.action, 'STATE_SYNC', 'ONLINE ayırıcısı korunur');
  assert.equal(out.phase, 'COUNTDOWN');
  assert.equal(out.t, 2, 'sayaç sayısı en üstte');
  assert.equal(out.state, undefined);
});

// Motor HUD'ının `state` alanı bir STRING'dir ve 8 Hz pakette bilerek yoktur
// (stateSync.js). Normalleştirici nesne olmayan / yabancı `state` alanına
// dokunmamalı, yoksa oyun durumu paketin üstüne yazılır.
test('normalizeStateSync leaves non-envelope state fields alone', () => {
  const withStringState = { type: 'HOST_STATE_SYNC', phase: 'GAME', state: 'MATCH_OVER' };
  assert.equal(normalizeStateSync(withStringState), withStringState, 'string state açılmaz');

  const withObjectState = { type: 'HOST_STATE_SYNC', phase: 'GAME', state: { scores: [1, 0, 0, 0] } };
  assert.equal(normalizeStateSync(withObjectState), withObjectState, 'phase/gameMode yoksa açılmaz');

  for (const junk of [null, undefined, 0, '', 'x', []]) {
    assert.equal(normalizeStateSync(junk), null, `${JSON.stringify(junk)} null dönmeli`);
  }
});

test('isValidRoomCode validates 3-6 char alphanumeric codes', () => {
  assert.equal(isValidRoomCode('A4X9'), true);
  assert.equal(isValidRoomCode('123'), true); // 3 haneli sayısal kod
  assert.equal(isValidRoomCode('ABCDEF'), true);
  assert.equal(isValidRoomCode('ab'), false); // too short
  assert.equal(isValidRoomCode('ABCDEFG'), false); // too long (7)
  assert.equal(isValidRoomCode('A4-9'), false); // special char
  assert.equal(isValidRoomCode(null), false);
  assert.equal(isValidRoomCode(''), false);
});

