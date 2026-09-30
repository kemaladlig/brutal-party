// Bot tepki YÖNETMENİ — host tarafı, maç/raunt olaylarını izleyen TEK wiring
// noktası (AGENTS §2: yetki hostta; §9: çekirdeğe moda özel dal yasak).
//
// Motorların AI'sına veya gövdesine DOKUNMAZ: her karede zaten normalize
// edilmiş alanların (`state`, `roundWinner`, `matchWinner`, `matchDraw`,
// `matchResult`, `scores[]`, `slotTypes[]`) FARKINI okur. Bu alanlar 15 oyunun
// tamamında ortaktır (BaseGame sözleşmesi + roundLifecycle), dolayısıyla tek
// modül tüm oyunları kapsar. Kural kararı `botBanter.js`te, durum takibi
// buradadır; ikisi de DOM/ağ bilmez — sink enjekte edilir.
//
// Co-op istisnası (HORDE): kazanan slot yoktur, `matchResult` ('win'|'loss')
// okunur; tüm bot koltukları takım tepkisi verir.

import {
  BOT_BANTER_COOLDOWN_MS,
  BOT_BANTER_EVENTS,
  isCriticalBanter,
  pickBotReaction,
} from './botBanter.js';
import { getBotPersona } from './customizationManager.js';

const BOT_TYPES = new Set(['bot_normal', 'bot_god']);

/** @param {unknown} type */
function isBotType(type) {
  return typeof type === 'string' && BOT_TYPES.has(type);
}

/** Kazanan `{ index }` nesnesi ya da düz sayı olabilir (PONG/LASER vb.). */
function slotIndexOf(winner) {
  if (Number.isInteger(winner)) return Number(winner);
  if (winner && Number.isInteger(/** @type {any} */ (winner).index)) {
    return Number(/** @type {any} */ (winner).index);
  }
  return null;
}

/** @param {any} value */
function clampSlot(value) {
  return Number.isInteger(value) && value >= 0 && value < 4 ? Number(value) : null;
}

/** @param {any} engine */
function snapshotOf(engine) {
  return {
    state: typeof engine.state === 'string' ? engine.state : '',
    roundWinner: slotIndexOf(engine.roundWinner),
    matchWinner: slotIndexOf(engine.matchWinner),
    matchDraw: engine.matchDraw === true,
    matchResult: typeof engine.matchResult === 'string' ? engine.matchResult : null,
    scores: Array.isArray(engine.scores) ? engine.scores.map((n) => Number(n) || 0) : null,
    slotTypes: Array.isArray(engine.slotTypes) ? engine.slotTypes.slice() : [],
  };
}

export class BotReactionDirector {
  /**
   * @param {{ emit?: ((key: string, slotIndex: number, meta: { event: string }) => void) | null,
   *           isEnabled?: (() => boolean) | null,
   *           rng?: () => number }} [options]
   */
  constructor(options = {}) {
    /** Tepkiyi yayan sink (host main.js: `showReaction` + oda yayını). */
    this.emit = typeof options.emit === 'function' ? options.emit : null;
    /** Kapı: ayar tercihi (`getPreference('botReactions')`). */
    this.isEnabled = typeof options.isEnabled === 'function' ? options.isEnabled : null;
    this.rng = typeof options.rng === 'function' ? options.rng : Math.random;
    /** @type {any} */
    this.engine = null;
    /** @type {ReturnType<typeof snapshotOf> | null} */
    this.snapshot = null;
    /** @type {Map<number, number>} */
    this.lastAt = new Map();
    this.lastGlobalAt = 0;
  }

  reset() {
    this.snapshot = null;
    this.lastAt.clear();
    this.lastGlobalAt = 0;
  }

  /**
   * Bir kare ilerletir. `now`, rAF/worker damgasıdır (ms).
   * @param {any} engine aktif motor (host otoritesi)
   * @param {number} [now]
   */
  tick(engine, now = 0) {
    if (!engine || typeof engine !== 'object') {
      this.engine = null;
      this.snapshot = null;
      return;
    }
    // Motor örneği değişince (mod geçişi) geçmiş fark sıfırlanır.
    if (this.engine !== engine) {
      this.engine = engine;
      this.snapshot = null;
    }
    const next = snapshotOf(engine);
    const prev = this.snapshot;
    this.snapshot = next;
    if (!prev) return;
    if (!this.emit || (this.isEnabled && !this.isEnabled())) return;
    // Lobiye dönüşte fark birikmesin; yeni maç cooldown devralmaz.
    if (next.state === 'LOBBY') {
      this.lastAt.clear();
      this.lastGlobalAt = 0;
      return;
    }

    if (prev.state !== 'MATCH_OVER' && next.state === 'MATCH_OVER') {
      this._matchEnd(next, now);
      return;
    }
    if (prev.state !== 'ROUND_OVER' && next.state === 'ROUND_OVER') {
      this._roundEnd(next, now);
      return;
    }
    if (next.state === 'PLAYING' && prev.state === 'PLAYING') {
      this._score(next, prev, now);
    }
  }

  /** @param {ReturnType<typeof snapshotOf>} snap */
  _botSlots(snap) {
    /** @type {number[]} */
    const out = [];
    for (let i = 0; i < 4; i += 1) {
      if (isBotType(snap.slotTypes[i])) out.push(i);
    }
    return out;
  }

  /**
   * Tek bot konuşturur; cooldown/global taban burada uygulanır.
   * @param {number} slot
   * @param {string} event
   * @param {number} now
   * @returns {boolean}
   */
  _fire(slot, event, now) {
    if (!this.emit) return false;
    const idx = clampSlot(slot);
    if (idx === null) return false;
    const critical = isCriticalBanter(event);
    const gap = critical ? BOT_BANTER_COOLDOWN_MS.botCritical : BOT_BANTER_COOLDOWN_MS.bot;
    const floor = critical ? BOT_BANTER_COOLDOWN_MS.globalCritical : BOT_BANTER_COOLDOWN_MS.global;
    // Kaydı olmayan bot HAZIRDIR (aksi hâlde sayfa açılışından sonraki ilk
    // saniyelerde — `now` küçükken — `now - 0 < gap` herkesi sustururdu).
    const last = this.lastAt.get(idx);
    if (last !== undefined && now - last < gap) return false;
    if (this.lastGlobalAt && now - this.lastGlobalAt < floor) return false;
    const type = this.snapshot?.slotTypes?.[idx];
    if (!isBotType(type)) return false;
    const god = type === 'bot_god';
    const persona = getBotPersona(idx, god);
    const key = pickBotReaction({ event, expression: persona?.expression, god, rng: this.rng });
    if (!key) return false;
    this.lastAt.set(idx, now);
    this.lastGlobalAt = now;
    this.emit(key, idx, { event });
    return true;
  }

  /**
   * Cooldown'ı en açık botu seçer (yoksa rastgele) — berabere/temsilci anları.
   * @param {number[]} bots @param {number} now
   */
  _pickSpeaker(bots, now) {
    if (!bots.length) return null;
    const ready = bots.filter((slot) => {
      const last = this.lastAt.get(slot);
      return last === undefined || now - last >= BOT_BANTER_COOLDOWN_MS.bot;
    });
    const pool = ready.length ? ready : bots;
    return pool[Math.floor(this.rng() * pool.length) % pool.length];
  }

  /**
   * Yenilen bot temsilcisi: skoru en yüksek (kaybetmesi en acı) olan.
   * @param {number[]} bots @param {number|null} winner
   * @param {ReturnType<typeof snapshotOf>} snap
   */
  _pickLoser(bots, winner, snap) {
    const losers = bots.filter((slot) => slot !== winner);
    if (!losers.length) return null;
    if (snap.scores) {
      let best = losers[0];
      for (const slot of losers) {
        if ((snap.scores[slot] || 0) > (snap.scores[best] || 0)) best = slot;
      }
      return best;
    }
    return losers[Math.floor(this.rng() * losers.length) % losers.length];
  }

  /** @param {ReturnType<typeof snapshotOf>} snap @param {number} now */
  _roundEnd(snap, now) {
    const bots = this._botSlots(snap);
    if (!bots.length) return;
    const winner = clampSlot(snap.roundWinner);
    if (winner !== null && isBotType(snap.slotTypes[winner])) {
      this._fire(winner, BOT_BANTER_EVENTS.ROUND_WIN, now);
    } else if (winner === null) {
      const speaker = this._pickSpeaker(bots, now);
      if (speaker !== null) this._fire(speaker, BOT_BANTER_EVENTS.ROUND_DRAW, now);
      return;
    }
    const loser = this._pickLoser(bots, winner, snap);
    if (loser !== null) this._fire(loser, BOT_BANTER_EVENTS.ROUND_LOSS, now);
  }

  /** @param {ReturnType<typeof snapshotOf>} snap @param {number} now */
  _matchEnd(snap, now) {
    const bots = this._botSlots(snap);
    if (!bots.length) return;
    const winner = clampSlot(snap.matchWinner);
    if (winner !== null && isBotType(snap.slotTypes[winner])) {
      this._fire(winner, BOT_BANTER_EVENTS.MATCH_WIN, now);
    } else if (snap.matchResult === 'win') {
      // Co-op (HORDE): kazanan slot yok, takım kazandı. Genel taban aynı
      // karede birden çok kutlamayı bastırabilir (tek balon yeter).
      for (const slot of bots) this._fire(slot, BOT_BANTER_EVENTS.MATCH_WIN, now);
      return;
    } else if (snap.matchResult === 'loss') {
      for (const slot of bots) this._fire(slot, BOT_BANTER_EVENTS.MATCH_LOSS, now);
      return;
    } else if (winner === null) {
      const speaker = this._pickSpeaker(bots, now);
      if (speaker !== null) this._fire(speaker, BOT_BANTER_EVENTS.MATCH_DRAW, now);
      return;
    }
    const loser = this._pickLoser(bots, winner, snap);
    if (loser !== null) this._fire(loser, BOT_BANTER_EVENTS.MATCH_LOSS, now);
  }

  /**
   * Oyun içi sayı artışı (CLONE/COLLAPSE/NINJA puanları, PONG golü).
   * @param {ReturnType<typeof snapshotOf>} snap
   * @param {ReturnType<typeof snapshotOf>} prev
   * @param {number} now
   */
  _score(snap, prev, now) {
    if (!snap.scores || !prev.scores) return;
    for (const slot of this._botSlots(snap)) {
      if ((snap.scores[slot] || 0) > (prev.scores[slot] || 0)) {
        this._fire(slot, BOT_BANTER_EVENTS.SCORED, now);
      }
    }
  }
}

/** @returns {BotReactionDirector} */
export function createBotReactionDirector(options = {}) {
  return new BotReactionDirector(options);
}
