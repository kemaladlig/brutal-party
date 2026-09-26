// AvatarLife — menü karakterinin "yaşam" durum makinesi (tek kaynak).
//
// Ana menü kahramanı (`views/heroAvatar.js`) ve atölye kartı
// (`customizeModal.js`) aynı fiziki/ifade makinesini farklı preset'lerle
// kullanır; zıplama sabitleri iki yerde kopyalanmaz (AGENTS.md tek kaynak).
//
// Tasarım kuralları:
//   · Siluet daima TAM YUVARLAK kalır — hareket yalnız konum (yOffset),
//     yeknesak ölçek (scale) ve yüz (ifade/bakış) seviyesinde. Squash asla
//     eksensel değil; eski moda `squashX/squashY` ortalaması zaten yeknesak
//     ölçeğe iniyordu, burada doğrudan yeknesak `pop` olarak tutulur.
//   · Zaman tabanlı ve tek kalıcı çıktı nesnesi: kare başına allocation yok,
//     `setInterval` yok. Görünürlük kapısı döngüyü durdurduğunda makine de
//     durur; uyanışta dt clamp'li geldiği için eski tepkiler kuyruğa binmez.
//   · Birimler yarıçap cinsinden (r/s, r/s²): 68px telefon kutusu ile 320px
//     masaüstü kutusu aynı hissi verir.
//   · `prefers-reduced-motion`: zıplama/hop/salınım yok; poke yalnız ifade
//     patlaması + kıvılcım + halka parıltısı üretir (görsel geri bildirim
//     korunur, hareket bütçesi sıfırlanır).

import { spawnBoingSparks, stepSparks } from './avatarStage.js';

const PRESETS = {
  // Ana menü / oda sahnesi: karakter büyük (r≈163), tepki UZAKTAN okunmalı.
  // İfade olarak WINK yerine STAR — dolgulu altın yıldızlar silüeti
  // bozmadan uzaktan okunan tek ifade.
  home: {
    jumpImpulse: 1.8,
    idleImpulse: 1.1,
    gravity: 4.2,
    shadowDepthRef: 1.8,
    idleHopPeriod: 7.5,
    excitedExpression: 'STAR',
    excitedDuration: 0.9,
    hoverDuration: 0.5,
    hopExcitedDuration: 0.6,
    gazeHold: 1.4,
    swaySpeed: 1 / 1600,   // mevcut hero salınımıyla birebir: sin(now/1600)
    swayAmp: 0.12,
    breathSpeed: 0.0035,
    breathAmp: 0.05,
    blinkOpen: 2.6,
    blinkClosed: 0.11,     // blinkState(now,0) ritminin birikmeli karşılığı
    popPoke: 1.06,
    popLand: 0.985,
    popHover: 1.02,
    breathScale: 0.02,
  },
  // Atölye kartı — customizeModal'daki bugünkü davranışın sayısal karşılığı.
  modal: {
    jumpImpulse: 1.8,
    idleImpulse: 1.5,
    gravity: 4.2,
    shadowDepthRef: 1.8,
    idleHopPeriod: 4.8,
    excitedExpression: 'WINK',
    excitedDuration: 0.8,
    hoverDuration: 0.8,
    hopExcitedDuration: 0.6,
    gazeHold: 2.2,         // eski pencere-imleci hareketsizlik eşiği
    swaySpeed: 0.0014,
    swayAmp: 0.42,
    breathSpeed: 0.0035,
    breathAmp: 0.05,
    blinkOpen: 2.8,
    blinkClosed: 0.25,
    popPoke: 1.015,        // eski (0.88+1.15)/2 ortalaması
    popLand: 1.0,          // eski (1.18+0.82)/2
    popHover: 1.0,         // eski (0.92+1.08)/2
    breathScale: 0.02,
  },
};

const GAZE_LERP_RATE = 7.5; // sn⁻¹ — eski wrap'lı açısal interpolasyon hızı
const POP_EASE_RATE = 10;   // sn⁻¹ — eski squash→1 yakınsaması
const RING_DECAY_RATE = 2.2;

/**
 * @param {Object} [options]
 * @param {'home'|'modal'} [options.preset]
 * @param {() => boolean} [options.reducedMotion]
 */
export function createAvatarLife({ preset = 'home', reducedMotion = () => false } = {}) {
  const cfg = PRESETS[preset] || PRESETS.home;

  let jumpY = 0;    // ≤ 0 (zeminde 0)
  let jumpVy = 0;
  let pop = 1;      // yeknesak ölçek çarpanı (daire kalır)
  let excited = 0;  // sn
  let ringPulse = 0;
  let idleHopTimer = 0;
  let blinkTimer = 0;
  let blinkClosed = false;
  let facing = 0;
  let gazeTarget = 0;
  let gazeTtl = 0;

  const sparks = [];
  const out = {
    yOffset: 0,
    shadowScale: 1,
    scale: 1,
    facingAngle: 0,
    isBlinking: false,
    expression: '',
    ringPulse: 0,
    sparks,
  };

  /**
   * @param {number} now ms
   * @param {number} dt sn (çağıran clamp'ler)
   * @param {number} r gövde yarıçapı px
   * @param {{ expression?: string }} [base]
   */
  function step(now, dt, r, base = {}) {
    const still = reducedMotion();

    // ── Zıplama fiziği ──
    if (still) {
      jumpY = 0;
      jumpVy = 0;
    } else if (jumpY < 0 || jumpVy !== 0) {
      jumpVy += cfg.gravity * r * dt;
      jumpY += jumpVy * dt;
      if (jumpY >= 0) {
        jumpY = 0;
        jumpVy = 0;
        pop = cfg.popLand;
      }
    }

    // ── Periyodik mini hop (karakter kendi kendine de canlı) ──
    if (!still) {
      idleHopTimer += dt;
      if (idleHopTimer > cfg.idleHopPeriod && jumpY === 0 && jumpVy === 0) {
        idleHopTimer = 0;
        jumpVy = -cfg.idleImpulse * r;
        pop = cfg.popPoke;
        excited = Math.max(excited, cfg.hopExcitedDuration);
        ringPulse = Math.max(ringPulse, 0.4);
      }
    }

    // ── Yeknesak pop → 1'e yakınsar ──
    pop += (1 - pop) * Math.min(1, dt * POP_EASE_RATE);

    // ── Bakış: hedef varsa oraya, yoksa doğal salınım ──
    let desired;
    if (gazeTtl > 0) {
      gazeTtl -= dt;
      desired = gazeTarget;
    } else {
      desired = still ? 0 : Math.sin(now * cfg.swaySpeed) * cfg.swayAmp;
    }
    let angleDiff = desired - facing;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    facing += angleDiff * Math.min(1, dt * GAZE_LERP_RATE);

    // ── Nefes (zeminde hafif süzülme) ──
    const breath = still ? 0 : Math.sin(now * cfg.breathSpeed);

    // ── Göz kırpma ──
    blinkTimer += dt;
    if (!blinkClosed && blinkTimer > cfg.blinkOpen) blinkClosed = true;
    if (blinkClosed && blinkTimer > cfg.blinkOpen + cfg.blinkClosed) {
      blinkClosed = false;
      blinkTimer = 0;
    }

    // ── İfade coşkusu + halka sönümü ──
    if (excited > 0) excited = Math.max(0, excited - dt);
    if (ringPulse > 0) ringPulse = Math.max(0, ringPulse - dt * RING_DECAY_RATE);

    stepSparks(sparks, r, dt);

    out.yOffset = jumpY + (breath * r * cfg.breathAmp) - (still ? 0 : r * cfg.breathAmp);
    out.shadowScale = Math.max(0.4, 1 + jumpY / (cfg.shadowDepthRef * r));
    out.scale = pop * (1 + breath * cfg.breathScale);
    out.facingAngle = facing;
    out.isBlinking = blinkClosed;
    out.expression = excited > 0 ? cfg.excitedExpression : (base.expression || 'FOCUS');
    out.ringPulse = ringPulse;
    return out;
  }

  /**
   * Dokunma tepkisi. Koordinatlar canvas CSS px; açı dokunma noktasına göre
   * bakış hedefi olarak kurulur (uzaktan okunan en ucuz "beni fark etti" ipucu).
   * @param {{ x: number, y: number, centerX: number, centerY: number, radius: number, color?: string }} p
   * @param {number} [now]
   */
  function poke(p) {
    const r = Math.max(1, p.radius);
    if (!reducedMotion()) {
      jumpVy = -cfg.jumpImpulse * r;
      if (jumpY > 0) jumpY = 0;
      pop = cfg.popPoke;
    }
    excited = cfg.excitedDuration;
    ringPulse = 1;
    gazeTtl = cfg.gazeHold;
    gazeTarget = Math.atan2(p.y - p.centerY, p.x - p.centerX);
    sparks.push(...spawnBoingSparks(p.centerX, p.centerY, r, p.color || '#D84727'));
  }

  /** İmleç üstüne geldi: meraklı mini tepki (zıplama yok). */
  function hover() {
    excited = Math.max(excited, cfg.hoverDuration);
    pop = Math.max(pop, cfg.popHover);
    ringPulse = Math.max(ringPulse, 0.5);
  }

  /** @param {number} angle radyan (merkeze göre) */
  function gaze(angle, hold = cfg.gazeHold) {
    gazeTarget = angle;
    gazeTtl = hold;
  }

  function reset() {
    jumpY = 0;
    jumpVy = 0;
    pop = 1;
    excited = 0;
    ringPulse = 0;
    idleHopTimer = 0;
    blinkTimer = 0;
    blinkClosed = false;
    facing = 0;
    gazeTtl = 0;
    sparks.length = 0;
  }

  return { step, poke, hover, gaze, reset, sparks };
}
