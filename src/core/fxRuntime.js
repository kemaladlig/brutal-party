// FX çalışma-zamanı (MOTION_PLAN Faz 1): bir motor eşlikçisi. Olayları fxKit
// profilleriyle partikül + halka + pop + flaş + hit-stop'a çevirir; travmayı
// `traumaSink` üzerinden motora (BaseGame.addDirectionalTrauma) teslim eder —
// sarsıntının tek sahibi BaseGame kalır (§4), runtime yalnız olayı çevirir.
// Hit-stop TEK SAAT modelidir: host motorunun kare dt'sini kısa süre yavaşlatır;
// otorite değişmez (§2) ve kumandalar yalnız yayınlanan kareleri çizdiği için
// yüzeyler arası sapma imkânsızdır.

import { motionScale } from '../ui/motion.js';
import { UI_COLORS } from '../ui/tokens.js';
import {
  fxProfile,
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
    this.hitStop = 0;
    this.flash = 0;
  }

  /**
   * @param {import('./fxKit.js').FxKind} kind
   * @param {{ x: number, y: number, color?: string, dirX?: number, dirY?: number,
   *   ringRadius?: number | null, haptic?: boolean, size?: number, angle?: number }} event
   */
  emit(kind, event) {
    const profile = /** @type {any} */ (fxProfile(kind));
    const unit = this.unit;
    const color = event.color || UI_COLORS.inkDark;
    if (profile.burst) {
      fxSpawnBurst(this.particles, kind, { x: event.x, y: event.y, color, unit });
    }
    if (profile.ring) {
      fxSpawnRing(this.rings, kind, { x: event.x, y: event.y, color, unit, ringRadius: event.ringRadius ?? null });
    }
    if (kind === 'kill') {
      fxSpawnPop(this.pops, {
        x: event.x,
        y: event.y,
        size: event.size ?? 34,
        angle: event.angle ?? 0,
        color,
        unit,
      });
    }
    if (profile.hitStopMs && motionScale() > 0) {
      this.hitStop = Math.max(this.hitStop, profile.hitStopMs / 1000);
    }
    if (profile.flashSec && motionScale() > 0) {
      this.flash = Math.max(this.flash, profile.flashSec);
      this.flashPeak = Math.max(this.flashPeak, profile.flashSec);
    }
    if (profile.trauma && this.traumaSink) {
      const dir = fxNormalizedDir(event.dirX || 0, event.dirY || 0);
      this.traumaSink(profile.trauma, dir?.x || 0, dir?.y || 0);
    }
    if (event.haptic) fxHaptic(kind);
    return profile;
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
