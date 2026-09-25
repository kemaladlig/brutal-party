// DOM shell/presenter for the mobile controller. GamepadManager owns
// lifecycle and bindings; this module owns only stable markup and labels.

import { escapeHtml } from '../net.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { t } from '../i18n.js';

function renderLayoutButton() {
  const label = t('controllerLayout.open');
  return `<button class="btn-controller-layout" data-controller-layout-open type="button" data-i18n-aria="controllerLayout.open" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${getTabletopIconSvg('settings', { size: 17, color: '#141414', strokeWidth: 2.3 })}</button>`;
}

export function renderLocalGamepadShell(gameMode) {
  return `
    <div class="local-gamepad-status-stack">
      <div class="mobile-gamepad-toolbar">
        ${renderLayoutButton()}
      </div>
    </div>
    <div class="local-mobile-workspace" id="local-mobile-workspace"></div>
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
        <button class="emoji-reaction-btn" id="btn-toggle-emoji" type="button" data-i18n-aria="pad.reactTitle" aria-label="${escapeHtml(t('pad.reactTitle'))}" title="${escapeHtml(t('pad.reactTitle'))}">${getTabletopIconSvg('message_square', { size: 18, color: '#141414', strokeWidth: 2.3 })}</button>
        ${showLayoutEditor ? renderLayoutButton() : ''}
        <button class="btn-fullscreen-toggle" id="btn-fullscreen-toggle" type="button" aria-label="${escapeHtml(t('pad.fullscreen'))}" title="${escapeHtml(t('pad.fullscreen'))}">${getTabletopIconSvg('maximize_2', { size: 16, color: '#141414', strokeWidth: 2.3 })}</button>
        <button class="btn-leave-gamepad btn-leave-icon" id="btn-leave-gamepad" type="button" aria-label="${escapeHtml(t('pad.leave'))}" title="${escapeHtml(t('pad.leave'))}">${getTabletopIconSvg('log_out', { size: 17, color: '#141414', strokeWidth: 2.3 })}</button>
      </div>
    </div>

    <div class="score-strip hidden" id="score-strip"></div>
    <div class="gamepad-workspace" id="gamepad-workspace"></div>

    <div class="emoji-wheel-modal hidden" id="emoji-wheel-modal">
      <button class="emoji-wheel-item" data-emoji="🔥">🔥</button>
      <button class="emoji-wheel-item" data-emoji="💀">💀</button>
      <button class="emoji-wheel-item" data-emoji="😂">😂</button>
      <button class="emoji-wheel-item" data-emoji="🏆">🏆</button>
      <button class="emoji-wheel-item" data-emoji="😱">😱</button>
    </div>
  `;
}
