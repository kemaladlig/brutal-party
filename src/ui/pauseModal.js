// In-Game Command Sheet (slide-over panel / bottom sheet) & Seat Switcher.
// Same public API as the old pause modal: initPauseModal, openPauseModal,
// closePauseModal, renderPauseSeats, getIsPaused, setIsPaused — main.js untouched.
import { hostPlayerSlots, isBotEkleEnabled, setBotEkleEnabled } from '../core/slotManager.js';
import { isColorblindEnabled, setColorblindEnabled } from '../core/customizationManager.js';
import { showInstallToast } from './toast.js';
import { toggleAudio, getIsMuted } from '../audio.js';
import { t, onLangChange } from '../i18n.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from './fullscreen.js';

const pauseModal = document.getElementById('pause-modal');
const pauseGameTitle = document.getElementById('pause-game-title');
const btnPauseClose = document.getElementById('btn-pause-close');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnResetMatch = document.getElementById('btn-reset-match');
const btnTvLobby = document.getElementById('btn-tv-lobby');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnToggleFullscreen = document.getElementById('btn-toggle-fullscreen');
const btnToggleBots = document.getElementById('btn-toggle-bots');
const btnToggleColorblind = document.getElementById('btn-toggle-colorblind');
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

function setSwitch(el, on) {
  if (!el) return;
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

export function refreshPauseSwitches() {
  setSwitch(btnToggleSound, !getIsMuted());
  setSwitch(btnToggleFullscreen, isFullscreen());
  setSwitch(btnToggleBots, isBotEkleEnabled());
  setSwitch(btnToggleColorblind, isColorblindEnabled());
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
      const isSelected = pauseSelectedSlot === idx;
      // Display rengi: host override → oyuncu avatarı → kanonik koltuk rengi
      const seatColor = slot?.displayColor || slot?.avatar?.color || fallbackColors[idx];
      return `
        <button type="button" class="pause-seat-btn ${isSelected ? 'selected-for-swap' : ''}" data-slot="${idx}" style="--seat-color: ${seatColor}">
          <div class="pause-seat-color-badge" style="background: ${seatColor}"></div>
          <div class="pause-seat-info">
            <span class="pause-seat-slot-label">${slotLabels[idx]}</span>
            <span class="pause-seat-player-name">${name}</span>
          </div>
        </button>
      `;
    })
    .join('');

  grid.querySelectorAll('.pause-seat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
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
        if (typeof onSwapCallback === 'function') {
          onSwapCallback(slotA, slotB);
        }
        renderPauseSeats(onSwapCallback);
        showInstallToast(t('toast.swapped', slotA + 1, slotB + 1));
      }
    });
  });
}

export function openPauseModal({ currentMode, isHosting, onSwapCallback }) {
  if (currentMode === 'MENU') return;
  isPaused = true;
  lastSwapCallback = (typeof onSwapCallback === 'function') ? onSwapCallback : null;
  pauseModal?.classList.remove('hidden');

  const titles = {
    PONG: 'BRUTAL PONG',
    TANKS: 'MICRO-TANKS',
    CURVE: 'BRUTAL CURVE',
    BOMB: 'BRUTAL BOMB',
    HEIST: 'BRUTAL HEIST',
    DUEL: 'QUICK DRAW',
    CROWN: 'BRUTAL CROWN',
    SNAKE: 'BRUTAL SNAKE',
    LASER: 'BRUTAL LASER',
    CLONE: 'BRUTAL CLONE',
    COLLAPSE: 'BRUTAL COLLAPSE',
    NINJA: 'BRUTAL NINJA',
  };
  if (pauseGameTitle) {
    pauseGameTitle.textContent = `${titles[currentMode] || currentMode} // ${t('pause.badge')}`;
  }
  if (btnTvLobby) {
    btnTvLobby.classList.toggle('hidden', !isHosting);
  }
  if (btnExitToMenu) {
    btnExitToMenu.textContent = isHosting ? `🚪 ${t('pause.exit')}` : t('pause.exit');
  }
  refreshPauseSwitches();
  pauseSelectedSlot = null;
  renderPauseSeats(lastSwapCallback);
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

  // Çıkış çift-bas onay (host odası kapanacağı için; misafir tek basışta çıkar)
  let exitArmedTimer = null;
  btnExitToMenu?.addEventListener('click', () => {
    if (getIsHosting?.() && !btnExitToMenu.dataset.armed) {
      btnExitToMenu.dataset.armed = '1';
      const origLabel = btnExitToMenu.textContent;
      btnExitToMenu.textContent = t('pause.exitArmed');
      exitArmedTimer = window.setTimeout(() => {
        delete btnExitToMenu.dataset.armed;
        btnExitToMenu.textContent = origLabel;
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
