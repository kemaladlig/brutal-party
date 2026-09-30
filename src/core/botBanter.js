// Bot tepkileri (banter) — TEK karar kaynağı. SAF: DOM, ağ ve zaman yok.
//
// Botların emoji göndermesi taktiksel bir AI kararı DEĞİLDİR: `src/ai/*.js`
// yalnız hareket/ateş kararı verir, tepki ise maç/raunt OLAYINA bağlıdır
// (raundu aldım / yedim, maçı aldım / kaybettim, sayı aldım). Bu yüzden
// 15 motorun AI'ına dokunmadan tek tablodan beslenir (AGENTS §4).
//
// Tel değeri yine `reactions.js` anahtarıdır (`laugh|flame|…`); burada ham
// emoji YOKTUR (AGENTS §8 / K5 kuralı — tek istisna `reactions.js`).
//
// `pickBotReaction` kişilik (temper) + god katmanına göre beyaz listeden
// seçim yapar. Rastgelelik host tarafındadır (sunum) — determinizm gerekmez,
// tıpkı `pongAI` hata ofseti gibi.

import { isReactionKey } from './reactions.js';

export const BOT_BANTER_EVENTS = Object.freeze({
  ROUND_WIN: 'round-win',
  ROUND_LOSS: 'round-loss',
  ROUND_DRAW: 'round-draw',
  MATCH_WIN: 'match-win',
  MATCH_LOSS: 'match-loss',
  MATCH_DRAW: 'match-draw',
  SCORED: 'scored',
});

/**
 * Olay önceliği: 3 → kritik (kendi raundunda cooldown kısalır, global tabanı
 * kısa bir zemine kadar delebilir); 2 → raunt sonucu; 1 → akış olayı.
 */
export const BOT_BANTER_PRIORITY = Object.freeze({
  [BOT_BANTER_EVENTS.ROUND_WIN]: 2,
  [BOT_BANTER_EVENTS.ROUND_LOSS]: 2,
  [BOT_BANTER_EVENTS.ROUND_DRAW]: 1,
  [BOT_BANTER_EVENTS.MATCH_WIN]: 3,
  [BOT_BANTER_EVENTS.MATCH_LOSS]: 3,
  [BOT_BANTER_EVENTS.MATCH_DRAW]: 1,
  [BOT_BANTER_EVENTS.SCORED]: 1,
});

/**
 * Cooldown bütçesi (ms). Sunucudaki host tepki hız kapısı 1 sn'dir
 * (`roomManager._rateOk(room, 'r_HOST_REACTION', 1000)`); global taban onu
 * aşmayacak şekilde altında tutulur.
 */
export const BOT_BANTER_COOLDOWN_MS = Object.freeze({
  /** Akış/raunt olayları için bot başına taban. */
  bot: 3800,
  /** Maç sonu gibi kritik anda bot başına kısa taban. */
  botCritical: 1400,
  /** Aynı anda birden çok bot konuşmasın diye genel taban. */
  global: 900,
  /** Kritik olayın delebileceği en alt genel taban. */
  globalCritical: 200,
});

export function isCriticalBanter(event) {
  return (BOT_BANTER_PRIORITY[event] || 0) >= 3;
}

/** Bot yüzü → kişilik (temper). Bilinmeyen yüz `stoic`e düşer. */
const TEMPER_BY_EXPRESSION = Object.freeze({
  ANGRY: 'brute',
  GRIN: 'troll',
  WINK: 'troll',
  HEART: 'troll',
  DERP: 'clown',
  STAR: 'clown',
  CYBORG: 'cold',
  SHADES: 'cold',
  CYCLOPS: 'cold',
  ZOMBIE: 'cold',
  FOCUS: 'stoic',
  SLEEPY: 'stoic',
});

/**
 * Kişilik → olay → tercih sırası. İlk eleman ilk tercihtir; seçim ağırlıklı
 * yapılır (öndeki eleman daha sık). Değerler `reactions.js` beyaz listesindedir.
 * @type {Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>}
 */
const BANTER_BY_TEMPER = Object.freeze({
  brute: Object.freeze({
    [BOT_BANTER_EVENTS.ROUND_WIN]: Object.freeze(['flame', 'zap', 'thumbsup']),
    [BOT_BANTER_EVENTS.MATCH_WIN]: Object.freeze(['crown', 'flame', 'zap']),
    [BOT_BANTER_EVENTS.ROUND_LOSS]: Object.freeze(['skull', 'flame', 'zap']),
    [BOT_BANTER_EVENTS.MATCH_LOSS]: Object.freeze(['skull', 'flame', 'zap']),
    [BOT_BANTER_EVENTS.ROUND_DRAW]: Object.freeze(['zap', 'skull']),
    [BOT_BANTER_EVENTS.MATCH_DRAW]: Object.freeze(['skull', 'zap']),
    [BOT_BANTER_EVENTS.SCORED]: Object.freeze(['flame', 'zap']),
  }),
  troll: Object.freeze({
    [BOT_BANTER_EVENTS.ROUND_WIN]: Object.freeze(['laugh', 'kiss', 'thumbsup']),
    [BOT_BANTER_EVENTS.MATCH_WIN]: Object.freeze(['laugh', 'crown', 'star']),
    [BOT_BANTER_EVENTS.ROUND_LOSS]: Object.freeze(['laugh', 'cry', 'skull']),
    [BOT_BANTER_EVENTS.MATCH_LOSS]: Object.freeze(['laugh', 'cry', 'skull']),
    [BOT_BANTER_EVENTS.ROUND_DRAW]: Object.freeze(['laugh', 'kiss']),
    [BOT_BANTER_EVENTS.MATCH_DRAW]: Object.freeze(['laugh', 'cry']),
    [BOT_BANTER_EVENTS.SCORED]: Object.freeze(['kiss', 'laugh']),
  }),
  clown: Object.freeze({
    [BOT_BANTER_EVENTS.ROUND_WIN]: Object.freeze(['star', 'laugh', 'kiss']),
    [BOT_BANTER_EVENTS.MATCH_WIN]: Object.freeze(['star', 'crown', 'laugh']),
    [BOT_BANTER_EVENTS.ROUND_LOSS]: Object.freeze(['cry', 'ghost', 'laugh']),
    [BOT_BANTER_EVENTS.MATCH_LOSS]: Object.freeze(['cry', 'ghost', 'laugh']),
    [BOT_BANTER_EVENTS.ROUND_DRAW]: Object.freeze(['ghost', 'star']),
    [BOT_BANTER_EVENTS.MATCH_DRAW]: Object.freeze(['ghost', 'cry']),
    [BOT_BANTER_EVENTS.SCORED]: Object.freeze(['star', 'kiss']),
  }),
  cold: Object.freeze({
    [BOT_BANTER_EVENTS.ROUND_WIN]: Object.freeze(['thumbsup', 'star', 'zap']),
    [BOT_BANTER_EVENTS.MATCH_WIN]: Object.freeze(['crown', 'thumbsup', 'zap']),
    [BOT_BANTER_EVENTS.ROUND_LOSS]: Object.freeze(['skull', 'sleepy']),
    [BOT_BANTER_EVENTS.MATCH_LOSS]: Object.freeze(['skull', 'sleepy', 'zap']),
    [BOT_BANTER_EVENTS.ROUND_DRAW]: Object.freeze(['sleepy', 'skull']),
    [BOT_BANTER_EVENTS.MATCH_DRAW]: Object.freeze(['sleepy', 'skull']),
    [BOT_BANTER_EVENTS.SCORED]: Object.freeze(['zap', 'thumbsup']),
  }),
  stoic: Object.freeze({
    [BOT_BANTER_EVENTS.ROUND_WIN]: Object.freeze(['thumbsup', 'star']),
    [BOT_BANTER_EVENTS.MATCH_WIN]: Object.freeze(['crown', 'thumbsup', 'star']),
    [BOT_BANTER_EVENTS.ROUND_LOSS]: Object.freeze(['skull', 'sleepy']),
    [BOT_BANTER_EVENTS.MATCH_LOSS]: Object.freeze(['skull', 'sleepy', 'cry']),
    [BOT_BANTER_EVENTS.ROUND_DRAW]: Object.freeze(['sleepy', 'thumbsup']),
    [BOT_BANTER_EVENTS.MATCH_DRAW]: Object.freeze(['sleepy', 'skull']),
    [BOT_BANTER_EVENTS.SCORED]: Object.freeze(['thumbsup', 'star']),
  }),
});

/**
 * God katmanı: kibirli, nadiren üzgün. Kazanırken taç/zafer, kaybederken
 * gözyaşı yerine öfke. Tanımsız olay = kişilik tablosu geçerli.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const GOD_OVERLAY = Object.freeze({
  [BOT_BANTER_EVENTS.MATCH_WIN]: Object.freeze(['crown', 'star', 'zap']),
  [BOT_BANTER_EVENTS.ROUND_WIN]: Object.freeze(['crown', 'zap']),
  [BOT_BANTER_EVENTS.MATCH_LOSS]: Object.freeze(['skull', 'flame']),
  [BOT_BANTER_EVENTS.ROUND_LOSS]: Object.freeze(['skull', 'flame']),
});

/**
 * Ağırlıklı seçim: öndeki eleman daha olası (ağırlık = uzunluk - i).
 * @param {readonly string[]} keys
 * @param {() => number} rng
 * @returns {string|null}
 */
function weightedPick(keys, rng) {
  if (!Array.isArray(keys) || keys.length === 0) return null;
  if (keys.length === 1) return keys[0];
  const weights = keys.map((_, i) => keys.length - i);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng() * total;
  for (let i = 0; i < keys.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return keys[i];
  }
  return keys[keys.length - 1];
}

/**
 * Bot tepkisini seçer. Bilinmeyen olay/anahtar → null (gönderen düşürür).
 *
 * @param {object} ctx
 * @param {string} ctx.event  `BOT_BANTER_EVENTS` değeri
 * @param {string} [ctx.expression] bot yüzü (`BOT_PERSONAS[].expression`)
 * @param {boolean} [ctx.god] god bot
 * @param {() => number} [ctx.rng] 0..1 üreteci (test enjekte eder)
 * @returns {string|null} tepki anahtarı
 */
export function pickBotReaction(ctx = /** @type {any} */ ({})) {
  const { event, expression = '', god = false, rng = Math.random } = ctx;
  if (!BOT_BANTER_PRIORITY[event]) return null;
  const temper = god ? 'brute' : botTemper(expression);
  const table = BANTER_BY_TEMPER[temper] || BANTER_BY_TEMPER.stoic;
  const overlay = god ? GOD_OVERLAY[event] : null;
  const candidates = overlay && overlay.length ? overlay : table[event];
  const key = weightedPick(candidates || [], rng);
  return isReactionKey(key) ? key : null;
}


export function botTemper(expression) {
  return TEMPER_BY_EXPRESSION[expression] || 'stoic';
}
