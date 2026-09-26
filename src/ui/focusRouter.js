// Odak yönlendiricisi — shell'in gezinme motoru.
//
// Sayfa akışı yerine **odak** hareketi: ok tuşları / D-pad / gamepad aktif
// öğeyi taşır, öğe görünür alana (yatay) kaydırılır. Konsol arayüzünün
// (Steam Big Picture, Wild Rift) temel davranışı — TV'de kaydırma çubuğu yok,
// dolayısıyla odak tek gezinme yoludur.
//
// Uygulama: `[data-focus]` taşıyan öğeler roving tabindex ile yönetilir
// (yalnız aktif öğe Tab'e girer), yön seçimi 2D en-yakın komşu skorlamasıyla
// yapılır. `prefersReducedMotion` kaydırmayı ve geçişleri sabitler.

import { prefersReducedMotion } from './motion.js';

const FOCUS_SELECTOR = '[data-focus]:not([disabled]):not([aria-hidden="true"])';

// Bileşik yön tablosu: ana eksen işareti + yan eksen cezası.
const AXES = {
  left: { primary: 'x', sign: -1 },
  right: { primary: 'x', sign: 1 },
  up: { primary: 'y', sign: -1 },
  down: { primary: 'y', sign: 1 },
};

const MIN_TRAVEL = 8;      // bu kadarın altındaki komşu "yok sayılır"
const CROSS_PENALTY = 0.4; // yan eksen sapması ana mesafeye eklenir

function centerOf(rect) {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function createFocusRouter({ getScope, getTrack = null, onFocusChange = null }) {
  let items = [];
  let index = -1;

  function collect() {
    const scope = getScope?.();
    if (!scope) return [];
    return Array.from(scope.querySelectorAll(FOCUS_SELECTOR))
      .filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
  }

  function applyRoving() {
    items.forEach((el, i) => {
      const active = i === index;
      el.tabIndex = active ? 0 : -1;
      el.classList.toggle('is-focused', active);
    });
  }

  /** Öğeyi yatay track içinde ortala. Dikey akış shell'da yok. */
  function ensureVisible(el) {
    const track = el?.closest?.('[data-h-track]');
    if (!track || !el) return;
    const trackRect = track.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    // Zaten görünür alandaysa dokunma — her odak değişiminde titreme yapmasın.
    if (rect.left >= trackRect.left + 8 && rect.right <= trackRect.right - 8) return;
    const delta = (rect.left - trackRect.left) - (track.clientWidth - rect.width) / 2;
    const max = Math.max(0, track.scrollWidth - track.clientWidth);
    track.scrollTo({
      left: Math.min(max, Math.max(0, track.scrollLeft + delta)),
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  function currentTrack() {
    return items[index]?.closest?.('[data-h-track]') || getTrack?.() || null;
  }

  function setIndex(next, { focus = true, force = false } = {}) {
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, next));
    if (clamped === index && focus && !force) return;
    index = clamped;
    applyRoving();
    const el = items[index];
    if (focus && el) {
      try { el.focus({ preventScroll: true }); } catch { el.focus(); }
      ensureVisible(el);
    }
    onFocusChange?.(el, index);
  }

  /** Yönlü 2D komşu: ana eksende ilerleyen, yan eksende en az sapan aday. */
  function move(direction) {
    const axis = AXES[direction];
    if (!axis || !items.length) return;
    if (index < 0) { setIndex(0); return; }

    const from = centerOf(items[index].getBoundingClientRect());
    let best = -1;
    let bestScore = Infinity;

    items.forEach((el, i) => {
      if (i === index) return;
      const to = centerOf(el.getBoundingClientRect());
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const primary = axis.primary === 'x' ? dx : dy;
      const cross = axis.primary === 'x' ? dy : dx;
      if (primary * axis.sign < MIN_TRAVEL) return;
      const score = primary + Math.abs(cross) * CROSS_PENALTY;
      if (score < bestScore) { bestScore = score; best = i; }
    });

    if (best >= 0) setIndex(best);
  }

  /** Sayfa çevirme — kumandada PageUp/PageDown, telefonda iki parmak kaydırma. */
  function page(direction) {
    const track = currentTrack();
    if (!track) return;
    const max = Math.max(0, track.scrollWidth - track.clientWidth);
    const next = Math.min(max, Math.max(0, track.scrollLeft + direction * track.clientWidth));
    track.scrollTo({ left: next, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    // Sayfa değişince ilk görünür öğeye odaklan (kumandada boşluk tuşu işe yarasın).
    const trackRect = track.getBoundingClientRect();
    const target = items.findIndex((el) => el.getBoundingClientRect().left >= trackRect.left - 1);
    if (target >= 0) setIndex(target);
  }

  function activate() {
    const el = items[index];
    if (!el) return;
    el.click();
  }

  function refresh({ keep = true } = {}) {
    const previous = index >= 0 ? items[index] : null;
    items = collect();
    const next = previous ? items.indexOf(previous) : -1;
    index = next;
    applyRoving();
    if (!keep || index < 0) setIndex(items.length ? 0 : -1, { focus: false });
  }

  return {
    move,
    page,
    activate,
    refresh,
    // Görünüm açılışı: index zaten 0 olsa bile DOM odağı taşınmalı.
    focusFirst: () => setIndex(Math.max(0, index), { force: true }),
    clear: () => { items = []; index = -1; },
    get current() { return index >= 0 ? items[index] : null; },
    get count() { return items.length; },
  };
}
