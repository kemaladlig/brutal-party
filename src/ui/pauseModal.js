// In-Game Command Sheet (slide-over panel / bottom sheet) & Seat Switcher.
// Same public API as the old pause modal: initPauseModal, openPauseModal,
// closePauseModal, renderPauseSeats, getIsPaused, setIsPaused — main.js untouched.
//
// AYARLAR BURADA ÇİZİLMEZ. Duraklatma bir önce kendi ses/bot/renk körü/tam
// ekran anahtarlarını tutuyordu — ana menüdeki ayar sheet'inin ikinci, paralel
// bir kopyası. Artık yalnız merkezi şemanın `quick` işaretli satırlarını
// gömer ve "TÜM AYARLAR" ile aynı sheet'i üstüne açar: bir ayar, bir eylem.
import { hostPlayerSlots } from '../core/slotManager.js';
import { CARTRIDGES, getControllerMeta } from '../core/engineRegistry.js';
import { openOverlay, closeOverlay } from './overlayHost.js';
import { showInstallToast } from './toast.js';
import { t, onLangChange } from '../i18n.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { getControllerGuide } from '../controllers/controllerGuide.js';
import { getSlotKeys, KEY_LABELS, getKeyCapLabel } from '../core/inputMaps.js';
import { createQuickSettingsPanel } from './settings/settingsPanel.js';
import { openSettingsSheet } from './settings/settingsSheet.js';

const pauseModal = document.getElementById('pause-modal');
const pauseGameTitle = document.getElementById('pause-game-title');
const pauseControlsSection = document.getElementById('pause-controls-section');
const pauseControlsBody = document.getElementById('pause-controls-body');
const pauseControlsTouch = document.getElementById('pause-controls-touch');
const pauseSettingsSlot = document.getElementById('pause-settings-slot');
const btnPauseClose = document.getElementById('btn-pause-close');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnResetMatch = document.getElementById('btn-reset-match');
const btnTvLobby = document.getElementById('btn-tv-lobby');
const btnExitToMenu = document.getElementById('btn-exit-to-menu');
const btnPauseRotateSeats = document.getElementById('btn-pause-rotate-seats');

// `quick` satırları + "TÜM AYARLAR" bir kez kurulur: slot boşaltılıp
// yeniden kurulursa panelin tercih/dil abonelikleri katlanır.
/** @type {ReturnType<typeof createQuickSettingsPanel> | null} */
let quickPanel = null;

function mountPauseSettings() {
  if (!pauseSettingsSlot || quickPanel) return;
  quickPanel = createQuickSettingsPanel({});
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'pause-btn settings-all-btn';
  all.innerHTML = `<span class="btn-symbol">${getTabletopIconSvg('settings', { size: 16 })}</span><span class="btn-text"></span>`;
  all.querySelector('.btn-text').textContent = t('pause.allSettings');
  all.addEventListener('click', () => openSettingsSheet({ tab: 'general' }));
  pauseSettingsSlot.append(quickPanel.bodyNode, all);
  pauseSettingsSlot.hidden = false;
  onLangChange(() => { all.querySelector('.btn-text').textContent = t('pause.allSettings'); });
}

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
  const cap = (code) => getKeyCapLabel(code);
  // Yön ekseni: fiziksel dizilişin okunduğu sıra (yukarı, sol, aşağı, sağ) —
  // harflerde W A S D, ok tuşlarında ↑ ← ↓ → olarak görünür.
  const order = [keys.u, keys.l, keys.d, keys.r];
  const dir = order.every(Boolean) ? order.map(cap).join(' ') : '';
  const action = KEY_LABELS.action?.[index] || cap(keys.action);
  return dir ? `${dir}  +  ${action}` : action;
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

  /** @type {NodeListOf<HTMLButtonElement>} */ (grid.querySelectorAll('.pause-seat-btn')).forEach((btn) => {
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

export function openPauseModal({ currentMode, isHosting, onSwapCallback }) {
  if (currentMode === 'MENU') return;
  isPaused = true;
  lastSwapCallback = (typeof onSwapCallback === 'function') ? onSwapCallback : null;
  pauseModal?.classList.remove('hidden');
  openOverlay('pause', { el: pauseModal, onClose: closePauseModal });
  mountPauseSettings();
  quickPanel?.refresh();

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
      btnExitToMenu.textContent = isHosting ? `${getTabletopIconSvg('log_out', { size: 14 })} ${exitText}` : exitText;
    }
  }
  pauseSelectedSlot = null;
  renderPauseSeats(lastSwapCallback);
  renderPauseControls(currentMode);
}

export function closePauseModal(onCloseCallback) {
  pauseModal?.classList.add('hidden');
  closeOverlay('pause');
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
  const pauseSheet = /** @type {HTMLElement} */ (pauseModal?.querySelector('.pause-sheet'));
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

  // Dil değişiminde açık sheet anında yenilenir. Ayar satırları kendi
  // dil aboneliklerinden tazelenir (panel), burada yeniden çizilmez.
  onLangChange(() => {
    if (!pauseModal || pauseModal.classList.contains('hidden')) return;
    renderPauseSeats(lastSwapCallback);
  });
}
