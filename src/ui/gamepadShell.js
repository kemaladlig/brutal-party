// DOM shell/presenter for the mobile controller. GamepadManager owns
// lifecycle and bindings; this module owns only stable markup and labels.

import { escapeHtml } from '../net.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { t } from '../i18n.js';

function renderLayoutButton() {
  const label = t('controllerLayout.open');
  return `<button class="btn-controller-layout" data-controller-layout-open type="button" data-i18n-aria="controllerLayout.open" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('settings', { size: 17, color: '#141414', strokeWidth: 2.3 })}</button>`;
}

function renderMenuLayoutItem() {
  const label = t('controllerLayout.open');
  return `<button class="gamepad-menu-item" data-controller-layout-open type="button" data-i18n-aria="controllerLayout.open" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('settings', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(label)}</span></button>`;
}

function renderMenuButton() {
  const label = t('pad.menu');
  return `<button class="gamepad-menu-btn" id="btn-gamepad-menu" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('more_vertical', { size: 18, color: '#141414', strokeWidth: 2.3 })}</button>`;
}

function renderMenuPanel({ showLayoutEditor = true }) {
  const reactLabel = t('pad.reactTitle');
  const fullscreenLabel = t('pad.fullscreen');
  const leaveLabel = t('pad.leave');
  return `
    <div class="gamepad-menu-panel hidden" id="gamepad-menu-panel">
      <button class="gamepad-menu-item" id="btn-toggle-emoji" type="button" data-i18n-aria="pad.reactTitle" aria-label="${escapeHtml(reactLabel)}" title="${escapeHtml(reactLabel)}">${getTabletopIconSvg('message_square', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(reactLabel)}</span></button>
      ${showLayoutEditor ? renderMenuLayoutItem() : ''}
      <button class="gamepad-menu-item" id="btn-fullscreen-toggle" type="button" aria-label="${escapeHtml(fullscreenLabel)}" title="${escapeHtml(fullscreenLabel)}">${getTabletopIconSvg('maximize_2', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(fullscreenLabel)}</span></button>
      <button class="gamepad-menu-item is-danger" id="btn-leave-gamepad" type="button" aria-label="${escapeHtml(leaveLabel)}" title="${escapeHtml(leaveLabel)}">${getTabletopIconSvg('log_out', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(leaveLabel)}</span></button>
    </div>
  `;
}

function renderHudContainers() {
  return `
    <div class="gamepad-hud" id="gamepad-hud">
      <span id="hud-game-tag"></span>
      <span class="hud-live-status" id="hud-live-status" aria-live="polite"></span>
      <span class="tactical-role-text" id="tactical-role-text"></span>
    </div>
    <div class="gamepad-killfeed" id="gamepad-killfeed" aria-live="polite"></div>
    <div class="gamepad-result" id="gamepad-result" aria-hidden="true"></div>
  `;
}

export function renderLocalGamepadShell(gameMode) {
  return `
    <div class="local-gamepad-status-stack">
      <div class="mobile-gamepad-toolbar">
        ${renderLayoutButton()}
      </div>
    </div>
    <div class="local-mobile-workspace" id="local-mobile-workspace"></div>
    ${renderHudContainers()}
  `;
}

export function renderRemoteGamepadShell({
  seatLabel,
  playerColor,
  playerName,
  gameTag,
  roomCode,
  showLayoutEditor = true,
}) {
  return `
    <div class="gamepad-header gamepad-header-compact">
      <div class="header-right-group">
        <div class="gamepad-menu" id="gamepad-menu">
          ${renderMenuButton()}
          ${renderMenuPanel({ showLayoutEditor })}
        </div>
      </div>
    </div>

    <div class="score-strip hidden" id="score-strip"></div>
    <div class="gamepad-workspace" id="gamepad-workspace"></div>
    ${renderHudContainers()}

    <div class="emoji-wheel-modal hidden" id="emoji-wheel-modal">
      <button class="emoji-wheel-item" data-emoji="🔥">🔥</button>
      <button class="emoji-wheel-item" data-emoji="💀">💀</button>
      <button class="emoji-wheel-item" data-emoji="😂">😂</button>
      <button class="emoji-wheel-item" data-emoji="🏆">🏆</button>
      <button class="emoji-wheel-item" data-emoji="😱">😱</button>
    </div>
  `;
}
