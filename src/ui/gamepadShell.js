// DOM shell/presenter for the mobile controller. GamepadManager owns
// lifecycle and bindings; this module owns only stable markup and labels.
// Üst çiplerin TANIMI tek kaynaktır (`quickChrome.js`); burası yalnız yüzeye
// yerleştirir.

import { renderPadHeader } from './quickChrome.js';

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
// çipleri taşır (solda tepki; sağda taç + ⋮ menüsü). Düzen kaydı `quickChrome`.
export function renderRemoteGamepadShell({ showLayoutEditor = true } = {}) {
  const { left, right } = renderPadHeader({ showLayoutEditor });
  return `
    <div class="gamepad-header gamepad-header-compact">
      <div class="header-left-group">${left}</div>
      <div class="header-right-group">${right}</div>
    </div>

    <div class="score-strip hidden" id="score-strip" aria-hidden="true"></div>
    <div class="gamepad-workspace" id="gamepad-workspace"></div>
    ${renderHudContainers()}
  `;
}
