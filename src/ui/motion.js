// Azaltılmış hareket desteği — tek bayrak, her yerde aynı davranış.
// Oyun mekaniği olan nabızlar (sinyal, telegraf) korunur; sadece UI cilası
// (ekran sarsıntısı, vinyet nabzı) statik duruma iner.

let mq = null;

// Faz 4.3: "sakin mod" tercihi OS `prefers-reduced-motion` ile AYNI kapıdan
// geçer — tek okuma noktası burasıdır, tüm motion çağrıları otomatik uyar.
import { getPreference } from '../core/preferences.js';

function media() {
  if (!mq && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  }
  return mq;
}

export function prefersReducedMotion() {
  if (media()?.matches) return true;
  try {
    return getPreference('calmMode') === true;
  } catch {
    return false;
  }
}

// Sarsıntı çarpanı: normalde 1, azaltılmış harekette 0.
export function motionScale() {
  return prefersReducedMotion() ? 0 : 1;
}

// UI nabzı: normalde base + sin(t)*amp, azaltılmış harekette sabit base.
export function pulse(base, amp, speed = 0.015) {
  if (prefersReducedMotion()) return base;
  return base + Math.sin(performance.now() * speed) * amp;
}
