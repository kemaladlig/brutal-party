// FX çalışma-zamanı (MOTION_PLAN Faz 1): bir motor eşlikçisi. Olayları fxKit
// profilleriyle partikül + halka + pop + flaş + hit-stop'a çevirir; travmayı
// `traumaSink` üzerinden motora (BaseGame.addDirectionalTrauma) teslim eder —
// sarsıntının tek sahibi BaseGame kalır (§4), runtime yalnız olayı çevirir.
// Hit-stop TEK SAAT modelidir: host motorunun kare dt'sini kısa süre yavaşlatır;
// otorite değişmez (§2) ve kumandalar yalnız yayınlanan kareleri çizdiği için
// yüzeyler arası sapma imkânsızdır.

import { motionScale } from '../ui/motion.js';
import { UI_COLORS } from '../ui/tokens.js';
import { fxParticleScale } from './perfMonitor.js';
// Zemin çatışma izleri (ARENA_ELEVATION_PLAN Faz 2): olay → iz eşlemesi
// `fieldDecals`'ta yaşar; burada yalnız tek satırlık bir üretim var. İz,
// olayın ZATEN taşıdığı veriden türer → §6 ağ bütçesi sıfır, motorlarda kod yok.
import { emitFxScar } from './fieldDecals.js';
import { emitFxLight } from './fieldLights.js';
import {
  fxProfile,
  fxPower,
  fxSpawnBurst,
  fxSpawnRing,
  fxSpawnPop,
  fxUpdateParticles,
  fxUpdateRings,
  fxUpdatePops,
  fxHaptic,
  fxNormalizedDir,
  advanceHitStop,
} from './fxKit.js';

/** Olay kuyruğu üst sınırı: taşan EN ESKİ olay düşer (anlık yol bütçesi). */
export const FX_EVENT_QUEUE_CAP = 24;

const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;

export class FxRuntime {
  /** @param {{ arenaProvider?: () => any, traumaSink?: (amount: number, dirX: number, dirY: number) => void }} [options] */
  constructor(options = {}) {
    /** arena/unit kaynağı; motor `() => this.arena` verir (ölçek §4). */
    this.arenaProvider = typeof options.arenaProvider === 'function' ? options.arenaProvider : null;
    /** Travma kanalı — BaseGame'e bağlıysa profil travması oradan geçer. */
    this.traumaSink = typeof options.traumaSink === 'function' ? options.traumaSink : null;
    /** worldCore partikül konvansiyonu — motor `this.particles` alias'lar. */
    this.particles = [];
    /** @type {any[]} */ this.rings = [];
    /** @type {any[]} */ this.pops = [];
    /** Kalan hit-stop süresi (sn). Yalnız SUNUM zamanını yavaşlatır. */
    this.hitStop = 0;
    /** Kalan tam-saha flaş süresi (sn). */
    this.flash = 0;
    /** Paketleme-tarafı alpha türetme tabanı (en son görülen flaş süresi). */
    this.flashPeak = 0.06;
    /**
     * Anlık güvenilir yol için bekleyen olay kayıtları (MOTION_PLAN 2.2):
     * `stateSync.flushFxEvents` damgalayıp yayınlar. Token BURADA basılmaz —
     * damga oturum sayaçları networkProtocol'dedir.
     * @type {any[]}
     */
    this.events = [];
  }

  get arena() {
    return this.arenaProvider ? this.arenaProvider() || null : null;
  }

  get unit() {
    const u = this.arena?.unit;
    return Number.isFinite(u) && u > 0 ? u : 1;
  }

  /** Raunt/resize sıfırlaması: dizileri YERİNDE boşaltır (alias'lar bozulmaz). */
  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.pops.length = 0;
    this.events.length = 0;
    this.hitStop = 0;
    this.flash = 0;
  }

  /**
   * @param {import('./fxKit.js').FxKind} kind
   * @param {{ x: number, y: number, color?: string, dirX?: number, dirY?: number,
   *   ringRadius?: number | null, haptic?: boolean, size?: number, angle?: number,
   *   slot?: number, unit?: number }} event
   * @param {{ hitStop?: boolean, traumaScale?: number, flash?: boolean }} [opts]
   *   Çok-ölümlü akışlar (HORDE) için sunum freni: `hitStop:false` zamanı
   *   dondurmaz (burst/halka/pop yine çıkar), `traumaScale` sarsıntıyı kısar
   *   (0 = yok), `flash:false` perdeyi kapatır. Varsayılan profili birebir uygular.
   */
  emit(kind, event, opts = {}) {
    const profile = /** @type {any} */ (fxProfile(kind));
    const unit = Number.isFinite(event.unit) && /** @type {number} */ (event.unit) > 0
      ? /** @type {number} */ (event.unit)
      : this.unit;
    const color = event.color || UI_COLORS.inkDark;
    if (profile.burst) {
      // Kademe çarpanı TEK yerde uygulanır (2.3): buradaki `count` dışında
      // hiçbir yer partikül sayısına dokunmaz.
      const burstCount = Math.max(1, Math.round(/** @type {any} */ (profile.burst).count * fxParticleScale()));
      fxSpawnBurst(this.particles, kind, { x: event.x, y: event.y, color, unit, count: burstCount });
    }
    if (profile.ring) {
      fxSpawnRing(this.rings, kind, { x: event.x, y: event.y, color, unit, ringRadius: event.ringRadius ?? null });
    }
    if (kind === 'kill' || kind === 'slay') {
      fxSpawnPop(this.pops, {
        x: event.x,
        y: event.y,
        size: event.size ?? 34,
        angle: event.angle ?? 0,
        color,
        unit,
      });
    }
    // Zemin izi (ARENA_ELEVATION_PLAN Faz 2): olay → imza eşlemesi ve havuz
    // `fieldDecals`'ta. Sunum-only — partiküller gibi simülasyona dokunmaz,
    // pakete alan eklemez, çizimi `fieldKit.drawField` yapar.
    emitFxScar(kind, event, unit);
    // Zemin ışık parıltısı (Faz 3): aynı disiplin — olay kind'inden türer,
    // paket alanı yok, çizimi `fieldKit.drawField` yapar.
    emitFxLight(kind, event, unit);
    if (profile.hitStopMs && motionScale() > 0 && opts.hitStop !== false) {
      this.hitStop = Math.max(this.hitStop, profile.hitStopMs / 1000);
    }
    if (profile.flashSec && motionScale() > 0 && opts.flash !== false) {
      this.flash = Math.max(this.flash, profile.flashSec);
      this.flashPeak = Math.max(this.flashPeak, profile.flashSec);
    }
    const traumaScale = Number.isFinite(opts.traumaScale) ? Number(opts.traumaScale) : 1;
    if (profile.trauma && traumaScale > 0 && this.traumaSink) {
      const dir = fxNormalizedDir(event.dirX || 0, event.dirY || 0);
      this.traumaSink(profile.trauma * traumaScale, dir?.x || 0, dir?.y || 0);
    }
    if (event.haptic) fxHaptic(kind);
    this._recordEvent(kind, event, unit, traumaScale);
    return profile;
  }

  /**
   * Olayı kablosuz kayıt biçimine çevirir (token SONRA basılır). Sayılar
   * 1 ondalığa yuvarlanır — dünya paketi round1 konvansiyonuyla aynı.
   * @param {import('./fxKit.js').FxKind} kind
   * @param {any} event
   * @param {number} unit
   * @param {number} [traumaScale]
   */
  _recordEvent(kind, event, unit, traumaScale = 1) {
    if (this.events.length >= FX_EVENT_QUEUE_CAP) this.events.shift();
    const scale = Number.isFinite(traumaScale) ? Math.max(0, Math.min(1, Number(traumaScale))) : 1;
    /** @type {Record<string, any>} */
    const rec = {
      fx: kind,
      x: r1(event.x),
      y: r1(event.y),
      u: r1(unit),
      power: fxPower(kind) * scale,
    };
    if (Number.isInteger(event.slot) && event.slot >= 0 && event.slot <= 3) rec.slot = event.slot;
    if (typeof event.color === 'string') rec.color = event.color;
    if (Number.isFinite(event.dirX) && Number.isFinite(event.dirY)) {
      rec.dirX = r1(event.dirX);
      rec.dirY = r1(event.dirY);
    }
    if (Number.isFinite(event.angle)) rec.angle = r1(event.angle);
    if (Number.isFinite(event.size)) rec.size = r1(event.size);
    if (Number.isFinite(event.ringRadius)) rec.ringRadius = r1(event.ringRadius);
    this.events.push(rec);
  }

  /**
   * Bekleyen olayları boşaltır (stateSync her karede çağırır — anlık yol).
   * @returns {any[]} kopyasız çıkışı; boş dizi = bu karede olay yok
   */
  drainEvents() {
    if (!this.events.length) return [];
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  /**
   * Kare dt'sini hit-stop ölçeğiyle geçirir. Host otorite olduğundan ve
   * kumandalar yalnız yayınlanan snapshot'ı gördüğünden, ölçek tek yerde
   * (host) uygulanır — kumanda ayrı donma bütçesi bilmez, sapma imkânsızdır.
   */
  tick(rawDt) {
    const result = advanceHitStop(this.hitStop, rawDt);
    this.hitStop = result.timer;
    return result.dt;
  }

  /** FX dünyasını (hit-stop'lu) dt ile ilerletir. */
  update(dt) {
    fxUpdateParticles(this.particles, dt);
    fxUpdateRings(this.rings, dt);
    fxUpdatePops(this.pops, dt);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt);
  }
}

/** @returns {FxRuntime} */
export function createFxRuntime(options = {}) {
  return new FxRuntime(options);
}
