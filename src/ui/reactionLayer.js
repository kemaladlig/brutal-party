// Tepki balonları — TEK görsel katman (lobi + oyun içi, host + kumanda).
//
// Yüzeyler hiçbir şey bilmez: konum, o yüzeyin `data-reaction-anchor="<slot>"`
// işaretli öğesinden okunur (lobi koltuk kartı, kumanda koltuk düğmesi, skor
// çipi). Oyun içi saha koordinatı gerekiyorsa host `setReactionFieldAnchor`
// ile tek bir sağlayıcı kaydeder (motor varlıkları arena = viewport px).
//
// Katman `pointer-events: none`: hiçbir dokunuşu yemez, sadece görsel (aynı
// zamanda `role="status"` canlı bölge). Balon yükselme/sönme animasyonunu
// CSS'ten alır, konumu ise canlı varlığı takip etmek için rAF ile yenilenir.

import { normalizeReactionKey, reactionGlyph, REACTIONS } from '../core/reactions.js';
import { UI_COLORS } from './tokens.js';
import { t } from '../i18n.js';

const MAX_BUBBLES = 8;
const BUBBLE_GAP = 30;
// CSS animasyon süresi (2.6 sn) üstü güvenlik payı: animasyon olayı gelmezse
// balon yine de düşer.
const CLEANUP_GRACE_MS = 4200;

let layerEl = null;
const bubbles = [];
let rafId = 0;
let fieldAnchorProvider = null;

/** Oyun içi saha koordinatı sağlayıcısı: `(slotIndex) => {x, y} | null`. */
export function setReactionFieldAnchor(fn) {
  fieldAnchorProvider = typeof fn === 'function' ? fn : null;
}

function ensureLayer() {
  if (layerEl?.isConnected) return layerEl;
  layerEl = document.createElement('div');
  layerEl.id = 'reaction-layer';
  layerEl.className = 'reaction-layer';
  // Görsel balonların ekran okuyucu karşılığı: `role="img"` + etiketli balon
  // yumuşak (polite) canlı bölgede duyurulur.
  layerEl.setAttribute('role', 'status');
  layerEl.setAttribute('aria-live', 'polite');
  document.body.appendChild(layerEl);
  return layerEl;
}

function visibleRect(el) {
  if (!el || el.getClientRects().length === 0) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  return rect;
}

/**
 * Koltuk çapası: `data-reaction-anchor="<slot>"` taşıyan İLK GÖRÜNÜR öğe.
 * Aynı belgede gizli kopyalar da olabilir (host lobi kartı index.html'de kalır,
 * kumanda ekranında görünmez), bu yüzden tek eşleşmeye bakmak yanlış olurdu.
 */
function anchorRectOf(slotIndex) {
  if (!Number.isInteger(slotIndex) || slotIndex < 0) return null;
  const nodes = document.querySelectorAll(`[data-reaction-anchor="${slotIndex}"]`);
  for (const node of nodes) {
    const rect = visibleRect(node);
    if (rect) return { x: rect.left + rect.width / 2, y: rect.top - 4 };
  }
  return null;
}

function anchorFor(slotIndex) {
  const dom = anchorRectOf(slotIndex);
  if (dom) return dom;
  const field = fieldAnchorProvider?.(slotIndex);
  if (field && Number.isFinite(field.x) && Number.isFinite(field.y)) {
    return { x: field.x, y: field.y };
  }
  // Yedek ray: sağ kenarda dikey sütun (P etiketi sağa taşar, bu yüzden
  // kenardan içeride durur). Kimlik etiketi balonun kendisinde.
  return {
    x: window.innerWidth - 52,
    y: Math.round(window.innerHeight * 0.36) + bubbles.length * BUBBLE_GAP,
  };
}

function positionBubble(bubble) {
  const anchor = anchorFor(bubble.slotIndex);
  bubble.el.style.setProperty('--rx', `${Math.round(anchor.x)}px`);
  bubble.el.style.setProperty('--ry', `${Math.round(anchor.y)}px`);
}

function tick() {
  rafId = 0;
  for (const bubble of bubbles) positionBubble(bubble);
  if (bubbles.length) rafId = requestAnimationFrame(tick);
}

function startLoop() {
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function dropBubble(bubble) {
  const index = bubbles.indexOf(bubble);
  if (index >= 0) bubbles.splice(index, 1);
  clearTimeout(bubble.timer);
  bubble.el.remove();
  if (!bubbles.length) {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function labelFor(key) {
  const labelKey = REACTIONS.find((r) => r.key === key)?.labelKey;
  return labelKey ? t(labelKey) : '';
}

function buildBubble(key, slotIndex, color, label) {
  const el = document.createElement('div');
  el.className = 'reaction-bubble';
  el.style.setProperty('--accent', color);
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  const tag = Number.isInteger(slotIndex) && slotIndex >= 0
    ? `<span class="reaction-bubble-tag">P${slotIndex + 1}</span>`
    : '';
  // Dış eleman yalnız KONUM taşır (rAF ile güncellenir), iç eleman animasyonu
  // oynatır — ikisi aynı `transform` üzerinde yarışmaz.
  el.innerHTML = `
    <div class="reaction-bubble-body">
      <span class="reaction-bubble-glyph">${reactionGlyph(key)}</span>
      ${tag}
    </div>`;
  return el;
}

/**
 * Tepki balonu gösterir.
 * @param {object} opts
 * @param {string} opts.key          — `REACTIONS` içinden anahtar (ya da legacy emoji)
 * @param {number} [opts.slotIndex]  — koltuk; -1/null ise etiketsiz (host, koltukta değil)
 * @param {string} [opts.color]      — oyuncu rengi; yoksa koltuk paletinden
 */
export function showReaction({ key, slotIndex = -1, color = null } = {}) {
  const reactionKey = normalizeReactionKey(key);
  if (!reactionKey) return false;
  if (typeof document === 'undefined') return false;

  const slot = Number.isInteger(slotIndex) ? slotIndex : -1;
  const accent = color || UI_COLORS.players[slot] || UI_COLORS.gold;
  const label = slot >= 0
    ? `${labelFor(reactionKey)}, P${slot + 1}`
    : labelFor(reactionKey);
  const layer = ensureLayer();
  const el = buildBubble(reactionKey, slot, accent, label);
  layer.appendChild(el);

  const bubble = { el, slotIndex: slot, timer: 0 };
  bubble.timer = setTimeout(() => dropBubble(bubble), CLEANUP_GRACE_MS);
  const body = el.firstElementChild;
  // İç elemanın animasyonu biter bitmez düşer; dış konum güncellemesi
  // (aynı hedefte) çalışmaya devam eder.
  body?.addEventListener('animationend', () => dropBubble(bubble), { once: true });
  bubbles.push(bubble);
  while (bubbles.length > MAX_BUBBLES) dropBubble(bubbles[0]);

  positionBubble(bubble);
  startLoop();
  return true;
}

/** Lobiye dönüşte/oda kapanırken katmanı boşaltır. */
export function clearReactions() {
  for (const bubble of [...bubbles]) dropBubble(bubble);
}
