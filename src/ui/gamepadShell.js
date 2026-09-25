// DOM shell/presenter for the mobile controller. GamepadManager owns
// lifecycle and bindings; this module owns only stable markup and labels.

import { escapeHtml } from '../net.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { t } from '../i18n.js';

export function renderLocalGamepadShell(gameMode) {
  return `
    <div class="local-gamepad-status-stack" aria-live="polite">
      <div class="gamepad-hud">
        <span class="header-game-chip" id="hud-game-tag">${escapeHtml(gameMode)}</span>
        <span class="hud-live-status" id="hud-live-status"></span>
        <span class="tactical-role-text" id="tactical-role-text"></span>
      </div>
      <div class="gamepad-control-guide" id="gamepad-control-guide" hidden></div>
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
}) {
  return `
    <div class="gamepad-header">
      <div class="header-left-group">
        <span class="player-slot-chip" id="header-seat-tag" style="background-color: ${playerColor}">${seatLabel}</span>
        <span class="player-name-label" id="header-player-name">${escapeHtml(playerName)}</span>
        <span class="header-game-chip" id="hud-game-tag">${escapeHtml(gameTag)}</span>
      </div>
      <div class="header-right-group">
        <span class="gamepad-room-info">#${escapeHtml(roomCode || '---')}</span>
        <button class="emoji-reaction-btn" id="btn-toggle-emoji" type="button" data-i18n-aria="pad.reactTitle" aria-label="${escapeHtml(t('pad.reactTitle'))}" title="${escapeHtml(t('pad.reactTitle'))}">${getTabletopIconSvg('message_square', { size: 18, color: '#141414', strokeWidth: 2.3 })}</button>
        <button class="btn-fullscreen-toggle" id="btn-fullscreen-toggle" type="button" aria-label="${escapeHtml(t('pad.fullscreen'))}" title="${escapeHtml(t('pad.fullscreen'))}">${getTabletopIconSvg('maximize_2', { size: 16, color: '#141414', strokeWidth: 2.3 })}</button>
        <button class="btn-leave-gamepad" id="btn-leave-gamepad" type="button">${t('pad.leave')}</button>
      </div>
    </div>

    <div class="gamepad-hud" aria-live="polite">
      <span class="hud-live-status" id="hud-live-status"></span>
      <span class="tactical-role-text" id="tactical-role-text"></span>
    </div>
    <div class="gamepad-control-guide" id="gamepad-control-guide" hidden></div>

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
