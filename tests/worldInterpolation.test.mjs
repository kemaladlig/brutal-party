import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alignSourceClock,
  blendWorldFrames,
  canBlendWorldFrames,
  selectBufferedWorldFrame,
} from '../src/core/worldInterpolation.js';

function frame(seq, x, extra = {}) {
  return {
    version: 1,
    mode: 'TANKS',
    seq,
    roundId: 1,
    gameState: 'PLAYING',
    hostId: 'host-1',
    players: [{ slot: 0, x, y: 10, angle: 0, alive: true }],
    ...extra,
  };
}

test('blends stable players without mutating discrete state', () => {
  const previous = frame(1, 0, { players: [{ slot: 0, x: 0, y: 10, angle: Math.PI, alive: true, shield: true }] });
  const current = frame(2, 20, { players: [{ slot: 0, x: 20, y: 30, angle: 0, alive: false, shield: false }] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.players[0].x, 10);
  assert.equal(blended.players[0].y, 20);
  assert.equal(blended.players[0].angle, Math.PI / 2);
  assert.equal(blended.players[0].alive, false);
  assert.equal(blended.players[0].shield, false);
  assert.equal(previous.players[0].x, 0);
  assert.equal(current.players[0].x, 20);
});

test('matches arrows and projectiles by stable id when list order changes', () => {
  const previous = frame(1, 0, {
    arrows: [[0, 0, 10, 0, '#fff', 7], [100, 100, 0, 10, '#fff', 8]],
    bullets: [[0, 0, 1, 0, 4, 0, 21], [100, 100, 0, 1, 4, 0, 22]],
  });
  const current = frame(2, 0, {
    arrows: [[120, 120, 0, 10, '#fff', 8], [20, 20, 10, 0, '#fff', 7]],
    bullets: [[120, 120, 0, 1, 4, 0, 22], [20, 20, 1, 0, 4, 0, 21]],
  });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.arrows.find((arrow) => arrow[5] === 7)[0], 10);
  assert.equal(blended.arrows.find((arrow) => arrow[5] === 8)[1], 110);
  assert.equal(blended.bullets.find((bullet) => bullet[6] === 21)[0], 10);
  assert.equal(blended.bullets.find((bullet) => bullet[6] === 22)[1], 110);
});

test('normalizes point trails when a sampled body changes length', () => {
  const previous = frame(1, 0, { players: [{ slot: 0, x: 0, y: 0, trail: [[0, 0], [10, 0]] }] });
  const current = frame(2, 20, { players: [{ slot: 0, x: 20, y: 0, trail: [[0, 0], [5, 0], [10, 0], [20, 0]] }] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.players[0].trail.length, 4);
  assert.deepEqual(blended.players[0].trail[0], [0, 0]);
  assert.deepEqual(blended.players[0].trail[3], [15, 0]);
});

test('SNAKE trails snap instead of index-lerp (arc-resampled body)', () => {
  // Gövde her snapshot'ta yay-uzunluğuyla yeniden örneklenir; indeks-lerp
  // gövdeyi patika boyunca kaydırıp titreme çiziyordu. Bayrak karede taşınır.
  const snakeFrame = (seq, x, trail) => ({
    ...frame(seq, x, { players: [{ slot: 0, x, y: 0, heading: 0, trail }] }),
    mode: 'SNAKE',
    snapTrail: true,
  });
  const previous = snakeFrame(1, 0, [[0, 0], [10, 0], [20, 0]]);
  const current = snakeFrame(2, 5, [[2, 0], [12, 0], [22, 0]]);
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.deepEqual(blended.players[0].trail, [[2, 0], [12, 0], [22, 0]]);
  assert.equal(blended.players[0].x, 2.5);
});

test('trails index-lerp by default when the frame carries no snap flag', () => {
  const previous = frame(1, 0, { players: [{ slot: 0, x: 0, y: 0, trail: [[0, 0], [10, 0]] }] });
  const current = frame(2, 20, { players: [{ slot: 0, x: 20, y: 0, trail: [[0, 0], [5, 0], [10, 0], [20, 0]] }] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.players[0].trail.length, 4);
});

test('blends moving world objects and singleton hazards', () => {
  const previous = frame(1, 0, {
    enemies: [{ id: 4, x: 0, y: 20, angle: 0, hp: 3 }],
    lasers: [{ id: 9, x: 10, y: 0, history: [[0, 0], [10, 0]] }],
    walls: [{ id: 2, x: 100, y: 200 }],
    piggy: { x: 50, y: 60, hp: 2 },
    portal: [20, 30, 8, 0.5],
  });
  const current = frame(2, 0, {
    enemies: [{ id: 4, x: 20, y: 40, angle: Math.PI, hp: 2 }],
    lasers: [{ id: 9, x: 30, y: 20, history: [[20, 0], [30, 20]] }],
    walls: [{ id: 2, x: 140, y: 260 }],
    piggy: { x: 70, y: 80, hp: 1 },
    portal: [40, 50, 8, 0.75],
  });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(blended.enemies[0].x, 10);
  assert.equal(blended.enemies[0].y, 30);
  assert.equal(blended.lasers[0].x, 20);
  assert.deepEqual(blended.lasers[0].history, [[10, 0], [20, 10]]);
  assert.equal(blended.walls[0].x, 120);
  assert.equal(blended.piggy.x, 60);
  assert.deepEqual(blended.portal, [30, 40, 8, 0.75]);
});

test('keeps packed wall tuples packed (CLONE/SNAKE destructure them as tuples)', () => {
  // `walls` iki biçimde gidiyor: LASER hareketli duvarları NESNE, CLONE/SNAKE
  // statik duvarları `[x, y, w, h]` dizisi. Nesne tablosunda `{ ...current }`
  // diziyi `{0:x,1:y,2:w,3:h}` nesnesine çeviriyordu; view'lar
  // `frame.walls.map(([x, y, w, h]) => ...)` dediği için client her enterpolasyonlu
  // karede `TypeError: is not iterable` atıp beyaz ekrana düşüyordu.
  const previous = frame(1, 0, { mode: 'CLONE', walls: [[0, 0, 10, 20], [100, 100, 30, 40]] });
  const current = frame(2, 0, { mode: 'CLONE', walls: [[0, 0, 10, 20], [100, 100, 50, 40]] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.ok(Array.isArray(blended.walls[0]), 'paketlenmiş duvar nesneye yayılmaz');
  assert.deepEqual(blended.walls[0], [0, 0, 10, 20]);
  assert.deepEqual(blended.walls[1], [100, 100, 40, 40]);
  // View'ın destructuring'i artık patlamaz.
  assert.deepEqual(
    blended.walls.map(([x, y, w, h]) => ({ x, y, w, h }))[1],
    { x: 100, y: 100, w: 40, h: 40 },
  );
});

test('object walls keep the object blend path (LASER moving walls)', () => {
  const previous = frame(1, 0, { mode: 'LASER', walls: [{ id: 1, x: 0, y: 10, w: 20, h: 5 }] });
  const current = frame(2, 0, { mode: 'LASER', walls: [{ id: 1, x: 100, y: 10, w: 20, h: 5 }] });
  const blended = blendWorldFrames(previous, current, 0.5);

  assert.equal(Array.isArray(blended.walls[0]), false);
  assert.equal(blended.walls[0].x, 50);
  assert.equal(blended.walls[0].w, 20, 'ölçü alanları nesne yolunda aynen kalır');
});

test('alignSourceClock keeps already-aligned samples put when a late frame lands', () => {
  // Ham ofset (en yeni karenin `receivedAt - sentAt`) kullanılsaydı, geç gelen
  // tek bir kare TÜM zaman çizelgesini kaydırır ve playhead örneklemeler arasında
  // ileri-geri zıplayınca dünya titrer. Yumuşatılmış ofset aynı kareleri aynı
  // yere koyar: geç gelen kare yalnız kendi playbackAt'ini etkiler.
  const onTime = { frame: { seq: 1 }, receivedAt: 500, sentAt: 400 };
  const late = { frame: { seq: 2 }, receivedAt: 560, sentAt: 433 }; // 127 ms gidiş

  const first = alignSourceClock([onTime, late], 100);
  assert.deepEqual(first.map((s) => s.playbackAt), [500, 533]);

  // Aynı yumuşatılmış ofsetle bir kare daha geldi: eski oynatma zamanları SABİT.
  const withThird = alignSourceClock([onTime, late, { frame: { seq: 3 }, receivedAt: 593, sentAt: 466 }], 100);
  assert.equal(withThird[0].playbackAt, 500);
  assert.equal(withThird[1].playbackAt, 533);
  assert.equal(withThird[2].playbackAt, 566);

  // Ofset yalnız link özelliğidir: yeni host'ta sıfırlanır, ölçüm gelene kadar
  // çağıran ham ofseti kullanır (sıfır gecikme = temiz çizgi).
  assert.equal(Number.isFinite(alignSourceClock([onTime], 0)[0].playbackAt), true);
  assert.equal(alignSourceClock([onTime], Number.NaN).length, 1);
});

test('does not blend across round or game-state boundaries', () => {
  const previous = frame(1, 0);
  const roundChanged = frame(2, 20, { roundId: 2 });
  const stateChanged = frame(2, 20, { gameState: 'ROUND_OVER' });

  assert.equal(canBlendWorldFrames(previous, roundChanged), false);
  assert.equal(blendWorldFrames(previous, roundChanged, 0.5), roundChanged);
  assert.equal(blendWorldFrames(previous, stateChanged, 0.5), stateChanged);
});

test('uses host-clock playback timestamps when receive jitter is present', () => {
  const first = frame(1, 0);
  const second = frame(2, 20);
  const sample = selectBufferedWorldFrame([
    { frame: first, receivedAt: 500, playbackAt: 100 },
    { frame: second, receivedAt: 550, playbackAt: 133 },
  ], 116.5);

  assert.equal(sample.alpha, 0.5);
  assert.equal(sample.frame.players[0].x, 10);
});

test('delayed buffer interpolates, holds on loss, and never extrapolates', () => {
  const first = frame(1, 0);
  const second = frame(2, 20);
  const third = frame(3, 40);
  const samples = [
    { frame: first, receivedAt: 100 },
    { frame: second, receivedAt: 133 },
    { frame: third, receivedAt: 166 },
  ];

  const early = selectBufferedWorldFrame(samples, 80);
  assert.equal(early.frame, first);

  const middle = selectBufferedWorldFrame(samples, 116.5);
  assert.equal(middle.alpha, 0.5);
  assert.equal(middle.frame.players[0].x, 10);

  const held = selectBufferedWorldFrame(samples, 500);
  assert.equal(held.frame, third);
  assert.equal(held.alpha, 1);

  const lost = selectBufferedWorldFrame([
    { frame: first, receivedAt: 100 },
    { frame: third, receivedAt: 300 },
  ], 200);
  assert.equal(lost.frame, first);
  assert.equal(lost.alpha, 0);
});
