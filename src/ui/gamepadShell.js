// DOM shell/presenter for the mobile controller. GamepadManager owns
// lifecycle and bindings; this module owns only stable markup and labels.

import { escapeHtml } from '../net.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { reactionGlyph } from '../core/reactions.js';
import { t } from '../i18n.js';

function renderMenuLayoutItem() {
  const label = t('controllerLayout.open');
  return `<button class="gamepad-menu-item" data-controller-layout-open type="button" data-i18n-aria="controllerLayout.open" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('settings', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(label)}</span></button>`;
}

function renderMenuButton() {
  const label = t('pad.menu');
  return `<button class="gamepad-menu-btn" id="btn-gamepad-menu" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('more_vertical', { size: 18, color: '#141414', strokeWidth: 2.3 })}</button>`;
}

// Skor göz atma: sahada kalıcı bant yok, skor bu düğmenin peek'iyle istenir
// (bant `hidden` başlar, `gamepad.js` yönetir). Menü düğmesiyle aynı 44px çip.
function renderScorePeekButton() {
  const label = t('pad.scoreboard');
  return `<button class="gamepad-menu-btn gamepad-score-btn" id="btn-score-peek" type="button" hidden aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('crown', { size: 18, color: '#141414', strokeWidth: 2.3 })}</button>`;
}

function renderMenuPanel({ showLayoutEditor = true }) {
  const fullscreenLabel = t('pad.fullscreen');
  const leaveLabel = t('pad.leave');
  return `
    <div class="gamepad-menu-panel hidden" id="gamepad-menu-panel">
      ${showLayoutEditor ? renderMenuLayoutItem() : ''}
      <button class="gamepad-menu-item" id="btn-fullscreen-toggle" type="button" aria-label="${escapeHtml(fullscreenLabel)}" title="${escapeHtml(fullscreenLabel)}">${getTabletopIconSvg('maximize_2', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(fullscreenLabel)}</span></button>
      <button class="gamepad-menu-item is-danger" id="btn-leave-gamepad" type="button" aria-label="${escapeHtml(leaveLabel)}" title="${escapeHtml(leaveLabel)}">${getTabletopIconSvg('log_out', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(leaveLabel)}</span></button>
    </div>
  `;
}

// Tepki düğmesi: lobi ve oyun içi aynı yer (başlık solu). Davranış
// `reactionPicker`ın tek kayıt noktasında; burada yalnız markup var.
function renderReactButton() {
  const label = t('pad.reactTitle');
  return `<button class="gamepad-react-btn" type="button" data-reaction-open data-reaction-send="pad" data-i18n-aria="pad.reactTitle" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}"><span class="reaction-glyph" aria-hidden="true">${reactionGlyph('laugh')}</span></button>`;
}

// Oyun sırasındaki tek üst metin: süre / can / cephane / taşıyıcı (skor değil —
// skor taç peek'indedir). Kutu, gölge ve etiket yok — çıplak satır sahanın üst
// kenarında durur, `gamepad.js` doldurur. LOCAL yüzeyde satır ÇİZİLMEZ: orada
// oyuncu canvas'ı görüyor ve motorun HUD'u (üst şerit skorbord + oyun HUD'u)
// tek otoritedir; aynı metni DOM'da tekrarlamak iki skor yüzeyi doğururdu.
function renderHudContainers({ status = true } = {}) {
  return `
    ${status ? `<div class="gamepad-status" id="gamepad-status">
      <span class="hud-live-status" id="hud-live-status" aria-live="polite"></span>
    </div>` : ''}
    <div class="gamepad-killfeed" id="gamepad-killfeed" aria-live="polite"></div>
    <div class="gamepad-result" id="gamepad-result" aria-hidden="true"></div>
  `;
}

export function renderLocalGamepadShell() {
  return `
    <div class="local-mobile-workspace" id="local-mobile-workspace"></div>
    ${renderHudContainers({ status: false })}
  `;
}

// Kimlik/oda verisi bilinçli parametre değildir: kompakt başlık yalnız yüzen
// çipleri taşır (tepki solda; taç + menü sağda).
export function renderRemoteGamepadShell({ showLayoutEditor = true } = {}) {
  return `
    <div class="gamepad-header gamepad-header-compact">
      <div class="header-left-group">
        ${renderReactButton()}
      </div>
      <div class="header-right-group">
        ${renderScorePeekButton()}
        <div class="gamepad-menu" id="gamepad-menu">
          ${renderMenuButton()}
          ${renderMenuPanel({ showLayoutEditor })}
        </div>
      </div>
    </div>

    <div class="score-strip hidden" id="score-strip" aria-hidden="true"></div>
    <div class="gamepad-workspace" id="gamepad-workspace"></div>
    ${renderHudContainers()}
  `;
}
