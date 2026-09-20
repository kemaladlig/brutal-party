// In-Game Pause Modal & Seat Switcher Manager
import { hostPlayerSlots, isBotEkleEnabled, setBotEkleEnabled } from '../core/slotManager.js';
import { showInstallToast } from './toast.js';
import { toggleAudio } from '../audio.js';

const pauseModal = document.getElementById('pause-modal');
const pauseGameTitle = document.getElementById('pause-game-title');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnResetMatch = document.getElementById('btn-reset-match');
const btnTvLobby = document.getElementById('btn-tv-lobby');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnToggleBots = document.getElementById('btn-toggle-bots');
const btnExitToMenu = document.getElementById('btn-exit-to-menu');
const btnPauseRotateSeats = document.getElementById('btn-pause-rotate-seats');

let pauseSelectedSlot = null;
let isPaused = false;

export function getIsPaused() {
  return isPaused;
}

export function setIsPaused(val) {
  isPaused = val;
}

export function renderPauseSeats(onSwapCallback) {
  const grid = document.getElementById('pause-seats-grid');
  if (!grid) return;

  const slotLabels = ['P1 (ALT)', 'P2 (ÜST)', 'P3 (SOL)', 'P4 (SAĞ)'];
  const slotColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

  grid.innerHTML = [0, 1, 2, 3]
    .map((idx) => {
      const slot = hostPlayerSlots[idx];
      const name = slot?.name || 'BOŞ';
      const isSelected = pauseSelectedSlot === idx;
      return `
        <button type="button" class="pause-seat-btn ${isSelected ? 'selected-for-swap' : ''}" data-slot="${idx}" style="--seat-color: ${slotColors[idx]}">
          <div class="pause-seat-color-badge" style="background: ${slotColors[idx]}"></div>
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
        showInstallToast(`🔄 P${slotA + 1} ve P${slotB + 1} takas edildi!`);
      }
    });
  });
}

export function openPauseModal({ currentMode, isHosting, onSwapCallback }) {
  if (currentMode === 'MENU') return;
  isPaused = true;
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
  };
  if (pauseGameTitle) {
    pauseGameTitle.textContent = `${titles[currentMode] || currentMode} // DURAKLATILDI`;
  }
  if (btnTvLobby) {
    btnTvLobby.classList.toggle('hidden', !isHosting);
  }
  if (btnExitToMenu) {
    btnExitToMenu.textContent = isHosting ? '🚪 ODAYI KAPAT & ANA MENÜYE DÖN' : '⌂ ANA MENÜYE DÖN';
  }
  if (btnToggleBots) {
    btnToggleBots.textContent = isBotEkleEnabled() ? '🤖 BOT EKLEME: AÇIK' : '🤖 BOT EKLEME: KAPALI';
  }
  pauseSelectedSlot = null;
  renderPauseSeats(onSwapCallback);
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

  btnResetMatch?.addEventListener('click', () => {
    closePauseModal(onReset);
  });

  btnToggleSound?.addEventListener('click', () => {
    const muted = toggleAudio();
    btnToggleSound.textContent = muted ? '🔇 SES: KAPALI' : '🔊 SES: AÇIK';
  });

  btnToggleBots?.addEventListener('click', () => {
    const next = !isBotEkleEnabled();
    setBotEkleEnabled(next);
    btnToggleBots.textContent = next ? '🤖 BOT EKLEME: AÇIK' : '🤖 BOT EKLEME: KAPALI';
    if (typeof onBotsToggled === 'function') {
      onBotsToggled(next);
    }
  });

  // Çıkış çift-bas onay (host odası kapanacağı için; misafir tek basışta çıkar)
  let exitArmedTimer = null;
  btnExitToMenu?.addEventListener('click', () => {
    if (getIsHosting?.() && !btnExitToMenu.dataset.armed) {
      btnExitToMenu.dataset.armed = '1';
      const origLabel = btnExitToMenu.textContent;
      btnExitToMenu.textContent = 'EMİN MİSİN? TEKRAR BAS';
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
  const pauseCard = pauseModal?.querySelector('.pause-card');
  let sheetStartY = null;
  pauseCard?.addEventListener('touchstart', (e) => {
    if (e.touches[0]) sheetStartY = e.touches[0].clientY;
  }, { passive: true });
  pauseCard?.addEventListener('touchend', (e) => {
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
    showInstallToast('🔄 Koltuklar saat yönünde 90° döndürüldü!');
  });
}
