// Overlay Host — açık diyalogların TEK sahibi.
//
// Shell (`appShell.js`) `document` seviyesinde ok tuşlarını dinler; bir modal
// açıkken bu dinleme odak arkasına kaçırıyordu. Buradaki tek kayıt sayesinde:
//   · Açık diyalog varsa shell girdi sahipliğini bırakır (`suspend`).
//   · Odak diyalog içinde hapsolur (focus trap) ve açılışta içeri alınır.
//   · Escape / Enter kayıt sırasına göre en üstteki diyaloğa gider.
//   · Sayfa kayması kilitlenir, `<html data-overlay>` ile CSS de tepki verir.
//
// Yeni modal eklerken: `openOverlay(id, { el, onClose, closeOnBackdrop })`
// çağır, açılışta/ kapanışta `closeOverlay(id)` çağır. Başka hiçbir modül
// kendi overlay kilidi tutmaz.

const stack = [];
let suspendShell = null;

/** Shell'in girdi sahipliğini bırakması için geri çağrı (appShell kaydeder). */
export function setShellInputSuspender(fn) {
  suspendShell = typeof fn === 'function' ? fn : null;
}

function syncShellSuspension() {
  suspendShell?.(stack.length > 0);
}

function syncDocumentState() {
  const root = document.documentElement;
  if (stack.length) root.dataset.overlay = stack[stack.length - 1].id;
  else delete root.dataset.overlay;
  root.classList.toggle('is-overlay-open', stack.length > 0);
}

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusablesOf(el) {
  if (!el) return [];
  return Array.from(el.querySelectorAll(FOCUSABLE))
    .filter((node) => node.offsetParent !== null || node.getClientRects().length > 0);
}

/** Diyalog içinde döngüsel odak: Tab/Shift+Tab dışarı çıkamaz. */
function trapTab(entry, e) {
  if (e.key !== 'Tab' || !entry.el) return;
  const items = focusablesOf(entry.el);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || !entry.el.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !entry.el.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

function onKeyDown(e) {
  const entry = stack[stack.length - 1];
  if (!entry) return;

  trapTab(entry, e);
  if (e.key !== 'Escape') return;
  if (entry.onEscape?.() === false) return;
  e.stopPropagation();
  e.preventDefault();
  closeOverlay(entry.id);
}

let backdropBound = null;

function bindBackdrop() {
  if (backdropBound) return;
  backdropBound = (e) => {
    const entry = stack[stack.length - 1];
    if (!entry || entry.closeOnBackdrop === false) return;
    // Yalnız katmanın kendisine tıklanınca kapanır (k içi tıklama kapatmaz).
    if (e.target !== entry.el) return;
    closeOverlay(entry.id);
  };
  document.addEventListener('click', backdropBound, true);
}

/**
 * @param {string} id — Aynı id iki kez açılmamalı; ikinci çağrı yok sayılır.
 * @param {object} opts
 *   el              — diyalog kökü (focus trap + backdrop hedefi).
 *   onClose         — kapanışta çağrılır (kendi animasyonunu temizlesin).
 *   onEscape        — `false` dönerse Escape bu diyaloğu kapatmaz.
 *   closeOnBackdrop — false ise dışarı tıklama kapatmaz.
 */
export function openOverlay(id, { el = null, onClose = null, onEscape = null, closeOnBackdrop = true } = {}) {
  if (stack.some((entry) => entry.id === id)) return;
  stack.push({ id, el, onClose, onEscape, closeOnBackdrop });
  bindBackdrop();
  document.addEventListener('keydown', onKeyDown, true);
  syncDocumentState();
  syncShellSuspension();

  // Odak içeri alınır: kaydırılan panelin ilk anlamlı öğesi, yoksa kap.
  window.requestAnimationFrame(() => {
    const items = focusablesOf(el);
    (items[0] || el)?.focus?.({ preventScroll: true });
  });
}

export function closeOverlay(id) {
  const index = stack.findIndex((entry) => entry.id === id);
  if (index < 0) return false;
  const [entry] = stack.splice(index, 1);
  try { entry.onClose?.(); } catch (err) { console.error('[overlay] onClose', err); }
  if (!stack.length) {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', backdropBound, true);
    backdropBound = null;
  }
  syncDocumentState();
  syncShellSuspension();
  return true;
}

export function isOverlayOpen(id = null) {
  return id ? stack.some((entry) => entry.id === id) : stack.length > 0;
}

/** En üstteki diyaloğa odak döndürür (odak kaçtıysa). */
export function refocusTopOverlay() {
  const entry = stack[stack.length - 1];
  const items = focusablesOf(entry?.el);
  (items[0] || entry?.el)?.focus?.({ preventScroll: true });
}
