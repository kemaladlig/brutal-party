// tests/roundLifecycle.test.mjs
// Raunt/maç akışının TEK sahibi (`core/roundLifecycle`). İki kapı:
//
//   1. Davranış — boşluk tablosu, geçiş sırası, `roundGap` okuması.
//   2. KİLİT — hiçbir motor kendi ROUND_OVER geçiş bloğunu yazmamalı. 15 motor
//      aynı 6 satırlık bloğu kopyalamıştı, her biri kendi temposunu seçiyordu;
//      kopyalar temizlendi, geri gelmesin diye bu kilit var.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ROUND_GAP,
  beginDrawRound,
  beginRound,
  endMatch,
  hasMatchResult,
  roundGapSeconds,
  roundTimedOut,
  roundTimerField,
  tickRoundFlow,
} from '../src/core/roundLifecycle.js';

const GAMES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'games');

function fakeGame(overrides = {}) {
  return {
    state: 'PLAYING',
    roundWinner: null,
    matchWinner: null,
    matchDraw: false,
    roundResolutionReason: null,
    roundTransitionTimer: 0,
    ...overrides,
  };
}

test('boşluk tablosu: kazanma ve maç sonu aynı, beraberlik daha kısa', () => {
  assert.equal(ROUND_GAP.WIN, ROUND_GAP.MATCH_END);
  assert.ok(ROUND_GAP.DRAW < ROUND_GAP.WIN, 'beraberlik sahneyi daha çabuk toparlamalı');
});

test('sayac alanı tek kapıdan çözülür (PONG ayrı ad taşır)', () => {
  assert.equal(roundTimerField({ roundTransitionTimer: 2 }), 'roundTransitionTimer');
  assert.equal(roundTimerField({ roundOverTimer: 2, roundTransitionTimer: 0 }), 'roundTransitionTimer');
  // PONG yalnız kendi alanını tutar.
  assert.equal(roundTimerField({ roundOverTimer: 2 }), 'roundOverTimer');
  assert.equal(roundTimerField({}), null);
  assert.equal(roundTimerField(null), null);
});

test('PLAYING dışında tick akışı devralmaz', () => {
  const game = fakeGame({ state: 'LOBBY' });
  assert.equal(tickRoundFlow(game, 0.5), false);
  assert.equal(tickRoundFlow(fakeGame({ state: 'MATCH_OVER' }), 0.5), false);
});

test('boşluk dolmadan motor simülasyonu atlar, geçiş yapmaz', () => {
  const game = fakeGame();
  let started = 0;
  game.startNewRound = () => { started += 1; };
  beginRound(game, { index: 0, name: 'AYSE' });

  assert.equal(tickRoundFlow(game, 0.1), true);
  assert.equal(started, 0);
  assert.equal(game.state, 'ROUND_OVER');
  assert.ok(game.roundTransitionTimer < ROUND_GAP.WIN);
});

test('boşluk bitince maç sonu yoksa startNewRound çağrılır', () => {
  const game = fakeGame();
  let started = 0;
  game.startNewRound = () => { started += 1; game.state = 'PLAYING'; };
  beginRound(game, { index: 1, name: 'CAN' }, 'kill');

  // Sayacı doğrudan sıfırla: süreyi kare kare beklemek testi yavaşlatır.
  game.roundTransitionTimer = 0;
  assert.equal(tickRoundFlow(game, 0.016), true);
  assert.equal(started, 1);
  assert.equal(game.state, 'PLAYING');
});

test('boşluk bitince maç sonu varsa MATCH_OVER, startNewRound ÇAĞRILMAZ', () => {
  const game = fakeGame();
  let started = 0;
  game.startNewRound = () => { started += 1; };
  beginRound(game, { index: 0, name: 'AYSE' });
  game.matchWinner = { index: 0, name: 'AYSE' };
  game.roundTransitionTimer = 0;

  assert.equal(tickRoundFlow(game, 0.016), true);
  assert.equal(game.state, 'MATCH_OVER');
  assert.equal(started, 0, 'maç bittiyse yeni raunt başlatılmaz');
});

test('sayaç negatife düşmez (lost-frame clamp)', () => {
  const game = fakeGame();
  game.startNewRound = () => {};
  beginRound(game, { index: 0 });
  tickRoundFlow(game, 99);
  assert.ok(game.roundTransitionTimer >= 0);
});

test('eski `startRound` motorları da desteklenir', () => {
  const game = fakeGame();
  let started = 0;
  game.startRound = () => { started += 1; game.state = 'PLAYING'; };
  beginRound(game, { index: 2 });
  game.roundTransitionTimer = 0;
  tickRoundFlow(game, 0.016);
  assert.equal(started, 1);
});

test('beginDrawRound maç sonucu YAZMAZ — beraberlik bir RAUNTtur, maç değil', () => {
  const game = fakeGame({ matchWinner: { index: 0 }, matchDraw: false });
  beginDrawRound(game, 'timeout');

  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.roundWinner, null);
  assert.equal(game.matchWinner, null, 'önceki maç sonucu sızmamalı');
  // KRİTİK: berabere raunt maçı bitirmez. `matchDraw` yalnız "maç berabere
  // bitti" demektir; `hasMatchResult` onu okuduğu için burada `true` yazmak
  // boşluk dolunca akışı MATCH_OVER'a kaçırıyor ve raunt bitmiyordu.
  assert.equal(game.matchDraw, false, 'berabere raunt maç sonucu yazmaz');
  assert.equal(game.roundDrew, true, 'beraberlik ayrı alanda okunur');
  assert.equal(hasMatchResult(game), false, 'berabere raunt maç sonucu DEĞİLDİR');
  assert.equal(game.roundTransitionTimer, ROUND_GAP.DRAW);
});

test('berabere raunt boşluktan sonra sonraki rauntu başlatır', () => {
  const game = fakeGame();
  let started = 0;
  game.startNewRound = () => { started += 1; game.state = 'PLAYING'; };
  beginDrawRound(game, 'timeout');
  game.roundTransitionTimer = 0;

  assert.equal(tickRoundFlow(game, 0.016), true);
  assert.equal(started, 1, 'berabere raunttan sonra oyun DEVAM eder');
  assert.equal(game.state, 'PLAYING');
});

test('endMatch(null) boşluğa girmeden maçı berabere bitirir', () => {
  const game = fakeGame();
  endMatch(game, null, 'tied-out');
  assert.equal(game.state, 'MATCH_OVER');
  assert.equal(game.matchDraw, true);
  assert.ok(hasMatchResult(game));
});

test('roundDrew motor sonraki raunda sızmaz (beginRound temizler)', () => {
  const game = fakeGame();
  beginDrawRound(game, 'tie');
  assert.equal(game.roundDrew, true);
  beginRound(game, { index: 0, name: 'AYSE' }, 'kill');
  assert.equal(game.roundDrew, false, 'kazanan raunt beraberlik bayrağını temizler');
});

test('beginRound kazananı yazar, beraberlik bayrağını temizler', () => {
  const game = fakeGame({ matchDraw: true });
  const winner = { index: 3, name: 'DENİZ' };
  beginRound(game, winner, 'kill');

  assert.equal(game.roundWinner, winner);
  assert.equal(game.matchDraw, false);
  assert.equal(game.roundResolutionReason, 'kill');
  assert.equal(game.roundTransitionTimer, ROUND_GAP.WIN);
});

test('endMatch doğrudan MATCH_OVER, beraberlikte kazanan yok', () => {
  const won = fakeGame();
  endMatch(won, { index: 1 }, 'target-kills');
  assert.equal(won.state, 'MATCH_OVER');
  assert.equal(won.matchDraw, false);
  assert.ok(hasMatchResult(won));

  const tied = fakeGame();
  endMatch(tied, null, 'timeout-tie');
  assert.equal(tied.state, 'MATCH_OVER');
  assert.equal(tied.matchDraw, true);
  assert.ok(hasMatchResult(tied), 'berabere maç da sonuçtur');
});

test('roundGap yalnız ROUND_OVER boşluğunda okur, 0.5 sn kovaya yuvarlanır', () => {
  assert.equal(roundGapSeconds(fakeGame({ state: 'PLAYING', roundTransitionTimer: 2 })), 0);
  assert.equal(roundGapSeconds(fakeGame({ state: 'MATCH_OVER', roundTransitionTimer: 2 })), 0);
  assert.equal(roundGapSeconds(fakeGame({ state: 'ROUND_OVER', roundTransitionTimer: 2.6 })), 3);
  assert.equal(roundGapSeconds(fakeGame({ state: 'ROUND_OVER', roundTransitionTimer: 2.4 })), 2.5);
  // 0.1 → Math.ceil(0.2)/2 = 0.5. Kova 0'a inmez: elde kalan 0.1 sn "yok"
  // olsaydı kumanda boşluğu baştan gösterirdi, sonra geri sayardı.
  assert.equal(roundGapSeconds(fakeGame({ state: 'ROUND_OVER', roundTransitionTimer: 0.4 })), 0.5);
  assert.equal(roundGapSeconds(fakeGame({ state: 'ROUND_OVER', roundTransitionTimer: 0.1 })), 0.5);
  assert.equal(roundGapSeconds(fakeGame({ state: 'ROUND_OVER', roundTransitionTimer: 0 })), 0);
  // PONG'un kendi sayacı da okunur.
  assert.equal(roundGapSeconds({ state: 'ROUND_OVER', roundOverTimer: 2.2 }), 2.5);
});

test('roundTimedOut yalnız geçerli bir üst sınırda çalışır', () => {
  assert.equal(roundTimedOut(95, 90), true);
  assert.equal(roundTimedOut(90, 90), true);
  assert.equal(roundTimedOut(89, 90), false);
  assert.equal(roundTimedOut(999, 0), false, 'süresiz oyunda zaman aşımı yok');
});

// ── KİLİT ────────────────────────────────────────────────────────────────

test('KİLİT: hiçbir motor kendi raunt geçiş bloğunu yazmıyor', () => {
  const offenders = [];
  for (const file of readdirSync(GAMES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(join(GAMES_DIR, file), 'utf8');
    // Geçiş BLOĞU: sayacı kendi indiren ROUND_OVER dalı. Motorun
    // `state === 'ROUND_OVER'` okuması tek başına suç değil (dokunma/atlayış
    // koruması, render dalları); sayacı indirmesi suç.
    if (/state\s*===\s*'ROUND_OVER'[\s\S]{0,400}?(roundTransitionTimer|roundOverTimer)\s*[-+*]=/.test(source)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `raunt geçiş sayacı motorda kalmamalı — core/roundLifecycle.tickRoundFlow kullan:\n  ${offenders.join('\n  ')}`,
  );
});

test('KİLİT: motorlar `tickRoundFlow` çağırıyor', () => {
  const offenders = [];
  for (const file of readdirSync(GAMES_DIR)) {
    if (!file.endsWith('.js')) continue;
    const source = readFileSync(join(GAMES_DIR, file), 'utf8');
    if (!/state\s*===\s*'ROUND_OVER'/.test(source)) continue;
    if (!source.includes('tickRoundFlow')) offenders.push(file);
  }
  assert.deepEqual(offenders, [], `bu motorlar ortak akışı kullanmıyor:\n  ${offenders.join('\n  ')}`);
});
