// Raunt/maç yaşam döngüsünün TEK sahibi (AGENTS.md §4 — çekirdek mantığı
// motora kopyalama yasak).
//
// Oyun başına elle seçilmiş 15 ayrı "raunt bitti, X saniye sonra devam" değeri
// vardı (1.8 – 2.8 s) ve 15 motorun kendi `if (state === 'ROUND_OVER')` bloğu
// bunu sayıyordu. Tempo, OYUNUN değil OLAYIN özelliğidir: kazandı / berabere /
// maç bitti. Aşağıdaki `ROUND_GAP` tablosu tek kaynaktır.
//
// `tickRoundFlow` tek geçiş noktasıdır. Motor `update()`'te:
//
//     if (tickRoundFlow(this, dt)) return;
//
// yazar ve simülasyonu atlar. Böylece "kaç saniye", "kim sonraki rauntu başlatır"
// ve "maç bitti mi" kararları motorun değil çekirdeğindir.

import { playRoundCall } from '../audio.js';

export const DEFAULT_DRAW_TRANSITION = 1.6;

/**
 * Raunt sonu boşluğu (saniye). Eski değerler motor başına 1.8–2.8 arasında
 * dağınıktı; aynı olay (bir raunttun) farklı oyunda farklı uzunlukta
 * duruyordu, kumandadaki `roundGap` rozeti de o yüzden oyundan oyuna
 * farklı sayıyordu.
 */
export const ROUND_GAP = Object.freeze({
  /** Raunt kazanıldı, sıradaki raunt başlıyor. */
  WIN: 2.6,
  /** Berabere / zaman aşımı — kazanan yok, sahne daha çabuk toparlanır. */
  DRAW: DEFAULT_DRAW_TRANSITION,
  /** Son raunttu: boşluk biter bitmez maç sonu kartı açılır. */
  MATCH_END: 2.6,
});

/**
 * Sayı gibi çevrilebilen mi? `Number.isFinite` YALNIZ gerçek sayıyı kabul
 * eder; paket JSON'dan geldiği için normalde string olmaz, ama alanı
 * dönüştürmek ücretsiz ve `roundGap` okumasını tootlamak yerine üstü kapalı
 * tutar. `NaN`/`null`/`''` sayı DEĞİLDİR — çözümleyici onları reddeder.
 * @param {unknown} value
 */
function isNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

/**
 * Sayacın motorlar arasında farklı adlarda tutulması tek bir sözleşme ihlali:
 * PONG `roundOverTimer`'ı, geri kalanı `roundTransitionTimer`'ı kullanıyor.
 * Alan adı burada tek kapıdan çözülür — her motora ayrı paket dalı yazmamak
 * için (AGENTS.md §8).
 * @param {{roundTransitionTimer?: number, roundOverTimer?: number}} game
 * @returns {'roundTransitionTimer'|'roundOverTimer'|null}
 */
export function roundTimerField(game) {
  if (!game) return null;
  if (isNumeric(game.roundTransitionTimer)) return 'roundTransitionTimer';
  if (isNumeric(game.roundOverTimer)) return 'roundOverTimer';
  return null;
}

/** Raunttan sonraki rauntu başlatan motor metodu. Sözleşme adı `startNewRound`. */
function startNextRound(game) {
  if (typeof game.startNewRound === 'function') game.startNewRound();
  else if (typeof game.startRound === 'function') game.startRound();
  try {
    const roundNum = (Number(game?.roundId) || 0) + 1;
    playRoundCall(roundNum);
  } catch {}
}

/**
 * Boşluk sayacına yazar — alan adı `roundTimerField` ile çözülür.
 *
 * Gerekçe: PONG sayacı `roundOverTimer` adıyla taşıyor ve `touchFlow`in
 * atla-yol kısayolu da o adı veriyor. Alan adını motorun içine yazmak yerine
 * buradan yazarsak tek doğru yer burası kalır; `beginDrawRound` gibi üreticiler
 * de aynı alanı kullanır, okuyan taraflar (`roundGapSeconds`, `tickRoundFlow`,
 * `roundOverSkipGuard`) tek kaynaktan çözer.
 *
 * @param {any} game
 * @param {number} seconds
 * @returns {string|null} yazılan alan
 */
export function setRoundTimer(game, seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  // Alan hiç çözülemezse (motor henüz reset/runmadı) ortak ada düş: boşluğa
  // yazılamazsa sayac hiç ilerlemez ve oyun ASILIR — sessiz takılma, hata
  // günlüğünden kötü. `roundTimerField` okuyan taraflar zaten bu ada bakar.
  const field = roundTimerField(game) || 'roundTransitionTimer';
  game[field] = value;
  return field;
}

/**
 * Beraberlik/çıkmaz raunt sonu → ROUND_OVER.
 *
 * Maç sonucu TUTULMAZ. `matchDraw` YALNIZ "maç berabere bitti" demektir;
 * boşluk dolunca `tickRoundFlow` maç bittiyse MATCH_OVER'a, bitmediyse
 * `startNewRound` çağırır. Raunt beraberliği `roundDrew` ile anlatılır —
 * bant "berabere" yazar, kazanan adını yazmaz.
 *
 * Ölçülen hata: burada `matchDraw = true` yazılıyordu. `hasMatchResult`
 * `matchDraw`'ı okuduğu için boşluk dolunca akış `startNewRound` yerine
 * MATCH_OVER'a geçiyordu; yani BOMB/CURVE/SNAKE'de 90-120 saniyelik
 * normal bir beraberlik tüm maçı bitiriyordu, COLLAPSE/HEIST/ZONE'de
 * `MAX_TIED_ROUNDS` sayacı hiç işe yaramıyordu.
 *
 * Gerçekten berabere biten MAÇ isteyen motor `endMatch(game, null, reason)`
 * çağırır.
 *
 * @param {any} game
 * @param {string} [reason] tanılama etiketi (paket/log için)
 * @param {number} [transition] boşluk; verilmezse `ROUND_GAP.DRAW`
 */
export function beginDrawRound(game, reason = 'draw', transition = ROUND_GAP.DRAW) {
  game.state = 'ROUND_OVER';
  game.roundWinner = null;
  game.matchWinner = null;
  game.matchDraw = false;
  game.roundDrew = true;
  game.roundResolutionReason = reason;
  setRoundTimer(game, transition);
  return game;
}

/**
 * Kazanılmış raunt sonu → ROUND_OVER.
 *
 * Skor artışı ve hedef kontrolü burada DEĞİL: motor `handleRoundEnd(winner)`
 * içinde kendi skor kuralını uygular (her oyunda hedef farklı). Bu fonksiyon
 * yalnız "raunt bitti, boşluğa gir" durumunu kurar; boşluk dolunca maç bittiyse
 * `tickRoundFlow` MATCH_OVER'a geçer, bitmediyse `startNewRound` çağırır.
 *
 * @param {any} game
 * @param {any} winner kazanan varlık (ya da null → berabere yolu)
 * @param {string} [reason]
 * @param {number} [gap] boşluk; verilmezse `ROUND_GAP.WIN`
 */
export function beginRound(game, winner, reason = 'round', gap = ROUND_GAP.WIN) {
  game.state = 'ROUND_OVER';
  game.roundWinner = winner || null;
  game.matchDraw = false;
  game.roundDrew = !winner;
  game.roundResolutionReason = reason;
  setRoundTimer(game, gap);
  return game;
}

/**
 * Berabere biten MAÇ, boşluğa girerek (son rauntu görsel olarak "solmaya"
 * bırakan motorlar için).
 *
 * Neden ayrı: boşluğu doldurmak `beginRound`'in, beraberliği MAÇ sonu saymak
 * `endMatch`'in işidir. Elle `beginRound(null)` + `matchDraw = true` yazmak
 * çalışır ama SIRAYA BAĞLIDIR — `beginRound` `matchDraw`'ı temizlediği için
 * iki çağrının yer değiştirilmesi sessizce maçı yeniden oynanabilir kılar.
 * Burada tek kapı var.
 *
 * @param {any} game
 * @param {string} [reason]
 * @param {number} [gap] boşluk; verilmezse `ROUND_GAP.MATCH_END`
 */
export function endMatchInGap(game, reason = 'draw-match', gap = ROUND_GAP.MATCH_END) {
  beginRound(game, null, reason, gap);
  game.matchDraw = true;
  return game;
}

/**
 * Maç sonu → doğrudan MATCH_OVER.
 *
 * `winner` null ise maç BERABERE biter (`matchDraw = true`). Boşluk isteyen
 * motor `endMatchInGap` kullanır.
 *
 * @param {any} game
 * @param {any} winner kazanan varlık, ya da null (berabere maç)
 * @param {string} [reason]
 */
export function endMatch(game, winner, reason = 'match') {
  game.state = 'MATCH_OVER';
  game.matchWinner = winner || null;
  game.matchDraw = !winner;
  game.roundDrew = false;
  game.roundResolutionReason = reason;
  return game;
}

export function hasMatchResult(game) {
  return !!(game.matchWinner || game.matchDraw);
}

/** Boşluğa giren raunt berabere mi bitti? Bant ve kumanda bundan okur. */
export function roundWasDraw(game) {
  return !!game?.roundDrew;
}

export function roundTimedOut(timer, limit) {
  return Number.isFinite(limit) && limit > 0 && Number(timer) >= limit;
}

/**
 * Raunt/maç akışının TEK geçiş bloğu.
 *
 * `ROUND_OVER` dışındaysa `false` döner ve motor kendi simülasyonuna devam eder.
 * `ROUND_OVER`'daysa sayacı işletir; dolunca maç sonu varsa MATCH_OVER'a, yoksa
 * `startNewRound` çağırır — ve her iki durumda da `true` döner, motor o karede
 * simülasyonu atlamak zorundadır.
 *
 * @param {any} game
 * @param {number} dt
 * @returns {boolean} motorun bu karede simülasyonu atlaması gerekiyorsa true
 */
export function tickRoundFlow(game, dt) {
  if (!game || game.state !== 'ROUND_OVER') return false;

  // PONG yalnız `roundOverTimer` taşır; alan yoksa ortak ada düşülür
  // (aksi hâlde sayac hiç işlemez ve oyun takılırdı).
  const field = roundTimerField(game) || 'roundTransitionTimer';
  const left = (Number(game[field]) || 0) - (Number(dt) || 0);
  game[field] = Math.max(0, left);
  if (left > 0) return true;

  if (hasMatchResult(game)) {
    game.state = 'MATCH_OVER';
    return true;
  }
  startNextRound(game);
  return true;
}

/**
 * Raunt boşluğunun kalan saniyesi — 8 Hz paketin `roundGap` alanının TEK
 * kaynağı. Boşluk, raunt sonucunun ekranda durduğu süredir; kumanda bunu
 * bilmediğinde ekran bir sonraki raunta atladığı anda değişir ve oyuncuya
 * "bam diye başladı" gibi görünür.
 *
 * Alan adı `roundTimerField` ile tek kapıdan okunur (PONG kendi
 * `roundOverTimer`'ını taşıyor, geri kalanı ortak `roundTransitionTimer`).
 *
 * 0.5 sn'lik kova: paket JSON dirty-check'i ile taşır. Daha ince kova boşluk
 * boyunca her karede fark üretirdi (8 Hz sabit bütçe).
 *
 * @param {any} game
 * @returns {number}
 */
export function roundGapSeconds(game) {
  if (!game || game.state !== 'ROUND_OVER') return 0;
  const field = roundTimerField(game);
  const left = field ? Number(game[field]) : 0;
  if (!Number.isFinite(left) || left <= 0) return 0;
  return Math.ceil(left * 2) / 2;
}
