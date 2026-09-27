// Tepki seçici — TEK uygulama (lobi, oyun içi HUD, kumanda başlığı).
//
// Yüzeyler yalnızca markup işaretler; bu modül tek kayıt noktasıdır:
//   <button data-reaction-open data-reaction-send="host|pad">
// Gönderici kaydı `setReactionSender('host' | 'pad', fn)` ile yapılır, yüzey
// modülleri arasında sıra/kimlik bağımlılığı doğmaz.
//
// Modal semantiği `overlayHost`'un sahipliğindedir (odak trap, Escape, scrim).

import { openOverlay, closeOverlay } from './overlayHost.js';
import { REACTIONS } from '../core/reactions.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../net.js';
import { vibrate } from '../core/haptics.js';
import { playMenuPop } from '../audio.js';

const OVERLAY_ID = 'reaction-picker';
const DEFAULT_SENDER = 'host';

const senders = new Map();
let pickerEl = null;
let triggerBound = false;

function sendFor(name) {
  const fn = senders.get(name || DEFAULT_SENDER);
  return typeof fn === 'function' ? fn : null;
}

/** İçerik her açılışta kurulur: dil değişimi etiketleri bayatlatmaz. */
function renderContent(el) {
  el.setAttribute('aria-label', t('react.title'));
  el.innerHTML = `
    <div class="reaction-picker-card">
      <div class="reaction-picker-title">${escapeHtml(t('react.title'))}</div>
      <div class="reaction-picker-grid">
        ${REACTIONS.map((r) => `
          <button class="reaction-pick" type="button" data-reaction="${r.key}"
            aria-label="${escapeHtml(t(r.labelKey))}" title="${escapeHtml(t(r.labelKey))}">
            ${getTabletopIconSvg(r.key, { size: 26, color: 'currentColor', strokeWidth: 2.4 })}
          </button>`).join('')}
      </div>
    </div>`;
}

function buildPicker() {
  if (pickerEl?.isConnected) return pickerEl;
  const el = document.createElement('div');
  el.id = OVERLAY_ID;
  el.className = 'reaction-picker';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  renderContent(el);
  el.addEventListener('click', (e) => {
    const pick = e.target.closest?.('[data-reaction]');
    if (pick) {
      sendFor(el.dataset.reactionSend)?.(pick.dataset.reaction);
      playMenuPop();
      vibrate(18);
      closeOverlay(OVERLAY_ID);
      return;
    }
    if (e.target === el) closeOverlay(OVERLAY_ID);
  });
  document.body.appendChild(el);
  return el;
}

function openReactionPicker(senderName = DEFAULT_SENDER) {
  // Gönderici yoksa (LOCAL, oda kapalı) sessizce açılmaz.
  if (!sendFor(senderName)) return false;
  const el = buildPicker();
  el.dataset.reactionSend = senderName;
  renderContent(el);
  // Yeniden açılışta giriş animasyonu tekrar oynasın.
  void el.offsetWidth;
  el.classList.add('is-open');
  openOverlay(OVERLAY_ID, {
    el,
    onClose: () => el.classList.remove('is-open'),
  });
  return true;
}

function bindTriggers() {
  if (triggerBound) return;
  triggerBound = true;
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest?.('[data-reaction-open]');
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    openReactionPicker(trigger.dataset.reactionSend);
  });
}

/** Gönderici kaydı: `host` (main.js) veya `pad` (GamepadManager.init). */
export function setReactionSender(name, fn) {
  if (typeof fn === 'function') senders.set(name, fn);
  else senders.delete(name);
}

/** Yüzeyler yalnız `data-reaction-open` işaretler; dinleyici burada bağlanır. */
export function ensureReactionTriggers() {
  bindTriggers();
}
