// In-Game Command Sheet (slide-over panel / bottom sheet) & Seat Switcher.
// Same public API as the old pause modal: initPauseModal, openPauseModal,
// closePauseModal, renderPauseSeats, getIsPaused, setIsPaused — main.js untouched.
import { hostPlayerSlots, isBotEkleEnabled, setBotEkleEnabled } from '../core/slotManager.js';
import { CARTRIDGES, getControllerMeta } from '../core/engineRegistry.js';
import { isColorblindEnabled, setColorblindEnabled } from '../core/customizationManager.js';
import { showInstallToast } from './toast.js';
import { toggleAudio, getIsMuted } from '../audio.js';
import { t, onLangChange } from '../i18n.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from './fullscreen.js';
import {
  CONTROL_SURFACE,
  getControlSurface,
  setControlSurface,
} from './tokens.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { getControllerGuide } from '../controllers/controllerGuide.js';
import { getSlotKeys, KEY_LABELS } from '../core/inputMaps.js';

const pauseModal = document.getElementById('pause-modal');
const pauseGameTitle = document.getElementById('pause-game-title');
const pauseControlsSection = document.getElementById('pause-controls-section');
const pauseControlsBody = document.getElementById('pause-controls-body');
const pauseControlsTouch = document.getElementById('pause-controls-touch');
const btnPauseClose = document.getElementById('btn-pause-close');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnResetMatch = document.getElementById('btn-reset-match');
const btnTvLobby = document.getElementById('btn-tv-lobby');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
const btnToggleBots = document.getElementById('btn-toggle-bots');
const btnToggleColorblind = document.getElementById('btn-toggle-colorblind');
const btnToggleTouchControls = document.getElementById('btn-toggle-touch-controls');
const btnControllerLayout = document.getElementById('btn-controller-layout');
const btnExitToMenu = document.getElementById('btn-exit-to-menu');
const btnPauseRotateSeats = document.getElementById('btn-pause-rotate-seats');

let pauseSelectedSlot = null;
let isPaused = false;
let lastSwapCallback = null;

export function getIsPaused() {
  return isPaused;
}

export function setIsPaused(val) {
  isPaused = val;
}

// ---------------------------------------------------------------------------
// Kontrol referansı (tek butonun menüsü)
// ---------------------------------------------------------------------------
// Oynarken üstte sürekli duran kontrol şeridi kaldırıldı: telefon yatayda saha
// kısa olduğu için şerit sahanın ~%7'sini kapatıyordu. Aynı bilgi artık tek
// butonun açtığı bu menüde yaşıyor. Metin kopyalanmaz — `CONTROL_DEFS` +
// `getControllerGuide` + `getSlotKeys` tek kaynaklarından türetilir.

function keyboardSlotLabel(index) {
  const keys = getSlotKeys(index);
  if (!keys) return '';
  const axis = [keys.l, keys.u, keys.r, keys.d].filter(Boolean).length;
  const dir = axis === 4 ? `${keys.l}/${keys.u}/${keys.r}/${keys.d}` : '';
  const action = KEY_LABELS.action?.[index] || keys.action || '';
  return dir ? `${dir} + ${action}` : action;
}

export function renderPauseControls(mode) {
  if (!pauseControlsSection || !pauseControlsBody) return;
  const meta = getControllerMeta(mode);
  const schema = meta?.schema;
  const guide = getControllerGuide(mode, schema);
  if (!guide) {
    pauseControlsSection.hidden = true;
    return;
  }
  pauseControlsSection.hidden = false;

  // Dokunmatik taraf: kontroller gibi SADECE ikon (ham OS emojisi yasak —
  // bkz. AGENTS.md §8). controllerTemplates ile aynı ikon kaynağı kullanılır.
  const schemaActions = Array.isArray(schema?.actions) ? schema.actions : [];
  const actionIcons = schemaActions.map((a) => getTabletopIconSvg(
    a.icon || (a.action === 'DASH' ? 'zap' : 'flame'),
    { size: 18, color: '#141414', strokeWidth: 2.2 },
  ));
  if (pauseControlsTouch) {
    pauseControlsTouch.innerHTML = [
      `<span class="pc-touch-icon">${getTabletopIconSvg('gamepad_2', { size: 16, color: '#55514a', strokeWidth: 2.2 })}</span>`,
      ...actionIcons,
    ].join('');
  }

  // Klavye tarafı: tuş yazısı metin olarak (ikon değil) — tuş kapağı metindir.
  const keyboardSlots = [0, 1, 2, 3]
    .map((i) => `<li><span class="pc-slot">P${i + 1}</span><span class="pc-keys">${keyboardSlotLabel(i)}</span></li>`)
    .join('');

  const aimRow = guide.aim
    ? `<li><span class="pc-slot">${t('pause.aimShort')}</span><span class="pc-keys">${t('pause.aimHint')}</span></li>`
    : '';

  pauseControlsBody.innerHTML = `
    <ul class="pause-controls-keyboard">${keyboardSlots}${aimRow}</ul>
  `;
}

function setSwitch(el, on) {
  if (!el) return;
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
  const badge = el.querySelector('.toggle-state-badge');
  if (badge) {
    badge.textContent = on ? t('pause.on') : t('pause.off');
  }
  if (el === btnToggleSound) {
    const iconSpan = el.querySelector('.toggle-icon');
    if (iconSpan) {
      iconSpan.innerHTML = getTabletopIconSvg(on ? 'volume-2' : 'volume-x', { size: 16 });
    }
  } else if (el === btnToggleFullscreen) {
    const iconSpan = el.querySelector('.toggle-icon');
    if (iconSpan) {
      iconSpan.innerHTML = getTabletopIconSvg(on ? 'minimize-2' : 'maximize-2', { size: 16 });
    }
  }
}

function setControlsSwitch(el) {
  if (!el) return;
  const mobile = getControlSurface() === CONTROL_SURFACE.MOBILE;
  const badge = el.querySelector('.toggle-state-badge');
  el.classList.toggle('on', mobile);
  el.setAttribute('aria-checked', mobile ? 'true' : 'false');
  if (badge) badge.textContent = mobile ? t('pause.on') : t('pause.off');
}

function refreshControllerLayoutButton() {
  if (!btnControllerLayout) return;
  const icon = btnControllerLayout.querySelector('[data-controller-layout-icon]');
  if (icon) icon.innerHTML = getTabletopIconSvg('settings', { size: 16 });
  btnControllerLayout.setAttribute('aria-label', t('controllerLayout.open'));
  btnControllerLayout.setAttribute('title', t('controllerLayout.open'));
}

export function refreshPauseSwitches() {
  setSwitch(btnToggleSound, !getIsMuted());
  setSwitch(btnToggleFullscreen, isFullscreen());
  setSwitch(btnToggleBots, isBotEkleEnabled());
  setSwitch(btnToggleColorblind, isColorblindEnabled());
  setControlsSwitch(btnToggleTouchControls);
  refreshControllerLayoutButton();
}

export function renderPauseSeats(onSwapCallback) {
  const grid = document.getElementById('pause-seats-grid');
  if (!grid) return;

  const slotLabels = [
    `P1 (${t('pause.slotBottom')})`,
    `P2 (${t('pause.slotTop')})`,
    `P3 (${t('pause.slotLeft')})`,
    `P4 (${t('pause.slotRight')})`,
  ];
  const fallbackColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

  grid.innerHTML = [0, 1, 2, 3]
    .map((idx) => {
      const slot = hostPlayerSlots[idx];
      const name = slot?.name || t('pause.empty');
      const isHost = !!slot?.isHost;
      const isSelected = pauseSelectedSlot === idx;
      // Display rengi: host override → oyuncu avatarı → kanonik koltuk rengi
      const seatColor = slot?.displayColor || slot?.avatar?.color || fallbackColors[idx];
      return `
        <button type="button" class="pause-seat-btn ${isSelected ? 'selected-for-swap' : ''}${isHost ? ' is-host-seat' : ''}" data-slot="${idx}" style="--seat-color: ${seatColor}"${isHost ? ' disabled aria-disabled="true"' : ''}>
          <div class="pause-seat-color-badge" style="background: ${seatColor}"></div>
          <div class="pause-seat-info">
            <span class="pause-seat-slot-label">${slotLabels[idx]}</span>
            <span class="pause-seat-player-name">${name}</span>
          </div>
          ${isSelected ? `<span class="pause-swap-indicator">${t('pause.selected') || 'SEÇİLDİ'}</span>` : ''}
        </button>
      `;
    })
    .join('');

  grid.querySelectorAll('.pause-seat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const slotIdx = parseInt(btn.dataset.slot, 10);
      if (pauseSelectedSlot === null) {
        pauseSelectedSlot = slotIdx;
        renderPauseSeats(onSwapCallback);
      } else if (pauseSelectedSlot === slotIdx) {
        pauseSelectedSlot = null;
        renderPauseSeats(onSwapCallback);
      } else {
        const slotA = pauseSelectedSlot;
        const slotB = slotIdx;
        pauseSelectedSlot = null;
        const didSwap = typeof onSwapCallback === 'function'
          ? onSwapCallback(slotA, slotB)
          : true;
        renderPauseSeats(onSwapCallback);
        if (didSwap !== false) {
          showInstallToast(t('toast.swapped', slotA + 1, slotB + 1));
        }
      }
    });
  });
}

export function openPauseModal({ currentMode, isHosting, onSwapCallback, controllerLayoutAvailable = true }) {
  if (currentMode === 'MENU') return;
  isPaused = true;
  lastSwapCallback = (typeof onSwapCallback === 'function') ? onSwapCallback : null;
  pauseModal?.classList.remove('hidden');
  btnControllerLayout?.classList.toggle('hidden', !controllerLayoutAvailable);

  if (pauseGameTitle) {
    pauseGameTitle.textContent = CARTRIDGES[currentMode]?.title || currentMode;
  }
  if (btnTvLobby) {
    btnTvLobby.classList.toggle('hidden', !isHosting);
  }
  if (btnExitToMenu) {
    const textEl = btnExitToMenu.querySelector('.btn-text');
    const exitText = t('pause.exit');
    if (textEl) {
      textEl.textContent = exitText;
    } else {
      btnExitToMenu.textContent = isHosting ? `🚪 ${exitText}` : exitText;
    }
  }
  refreshPauseSwitches();
  pauseSelectedSlot = null;
  renderPauseSeats(lastSwapCallback);
  renderPauseControls(currentMode);
}

export function closePauseModal(onCloseCallback) {
  pauseModal?.classList.add('hidden');
  isPaused = false;
  if (typeof onCloseCallback === 'function') {
    onCloseCallback();
  }
}

export function initPauseModal({
  getCurrentMode,
  getIsHosting,
  onSwapSeats,
  onRotateSeats,
  onResume,
  onReset,
  onExitMenu,
  onTvLobby,
  onBotsToggled,
  onControlsToggled,
  onControllerLayout,
}) {
  btnResumeGame?.addEventListener('click', () => {
    closePauseModal(onResume);
  });

  btnPauseClose?.addEventListener('click', () => {
    closePauseModal(onResume);
  });

  btnResetMatch?.addEventListener('click', () => {
    closePauseModal(onReset);
  });

  btnToggleSound?.addEventListener('click', () => {
    const muted = toggleAudio();
    setSwitch(btnToggleSound, !muted);
    showInstallToast(muted ? t('toast.soundOff') : t('toast.soundOn'));
  });

  btnToggleFullscreen?.addEventListener('click', () => {
    const active = toggleFullscreen();
    setSwitch(btnToggleFullscreen, active);
  });

  onFullscreenChange((active) => {
    setSwitch(btnToggleFullscreen, active);
  });

  btnToggleBots?.addEventListener('click', () => {
    const next = !isBotEkleEnabled();
    setBotEkleEnabled(next);
    setSwitch(btnToggleBots, next);
    showInstallToast(next ? t('toast.botsOn') : t('toast.botsOff'));
    if (typeof onBotsToggled === 'function') {
      onBotsToggled(next);
    }
  });

  btnToggleColorblind?.addEventListener('click', () => {
    const next = !isColorblindEnabled();
    setColorblindEnabled(next);
    setSwitch(btnToggleColorblind, next);
    showInstallToast(next ? t('toast.cbOn') : t('toast.cbOff'));
  });

  btnToggleTouchControls?.addEventListener('click', () => {
    const next = getControlSurface() === CONTROL_SURFACE.MOBILE
      ? CONTROL_SURFACE.TABLETOP
      : CONTROL_SURFACE.MOBILE;
    setControlSurface(next);
    setControlsSwitch(btnToggleTouchControls);
    showInstallToast(next === CONTROL_SURFACE.MOBILE
      ? t('toast.controlsMobile')
      : t('toast.controlsTabletop'));
    if (typeof onControlsToggled === 'function') {
      onControlsToggled(next);
    }
  });

  btnControllerLayout?.addEventListener('click', () => {
    closePauseModal();
    if (typeof onControllerLayout === 'function') onControllerLayout();
  });

  // Çıkış çift-bas onay (host odası kapanacağı için; misafir tek basışta çıkar)
  let exitArmedTimer = null;
  btnExitToMenu?.addEventListener('click', () => {
    const textEl = btnExitToMenu.querySelector('.btn-text');
    if (getIsHosting?.() && !btnExitToMenu.dataset.armed) {
      btnExitToMenu.dataset.armed = '1';
      const origLabel = textEl ? textEl.textContent : btnExitToMenu.textContent;
      if (textEl) {
        textEl.textContent = t('pause.exitArmed');
      } else {
        btnExitToMenu.textContent = t('pause.exitArmed');
      }
      exitArmedTimer = window.setTimeout(() => {
        delete btnExitToMenu.dataset.armed;
        if (textEl) {
          textEl.textContent = origLabel;
        } else {
          btnExitToMenu.textContent = origLabel;
        }
      }, 3000);
      return;
    }
    window.clearTimeout(exitArmedTimer);
    delete btnExitToMenu.dataset.armed;
    onExitMenu();
  });
  btnTvLobby?.addEventListener('click', onTvLobby);

  // Kapatma jestleri: backdrop dokunuş + ESC + (dokunmatikte) aşağı kaydırma.
  // Hepsi DEVAM ET ile aynı kapıdan çıkar (yanlışlıkla sıfırlama/çıkış yok).
  pauseModal?.addEventListener('click', (e) => {
    if (e.target === pauseModal) btnResumeGame?.click();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pauseModal && !pauseModal.classList.contains('hidden')) {
      btnResumeGame?.click();
    }
  });
  const pauseSheet = pauseModal?.querySelector('.pause-sheet');
  let sheetStartY = null;
  pauseSheet?.addEventListener('touchstart', (e) => {
    if (e.touches[0]) sheetStartY = e.touches[0].clientY;
  }, { passive: true });
  pauseSheet?.addEventListener('touchend', (e) => {
    if (sheetStartY === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? sheetStartY) - sheetStartY;
    sheetStartY = null;
    if (dy > 90) btnResumeGame?.click();
  }, { passive: true });

  btnPauseRotateSeats?.addEventListener('click', () => {
    if (typeof onRotateSeats === 'function') {
      onRotateSeats();
    }
    pauseSelectedSlot = null;
    renderPauseSeats(onSwapSeats);
    showInstallToast(t('toast.rotated'));
  });

  // Dil değişiminde açık sheet anında yenilenir.
  onLangChange(() => {
    if (!pauseModal || pauseModal.classList.contains('hidden')) return;
    refreshPauseSwitches();
    renderPauseSeats(lastSwapCallback);
  });
}
