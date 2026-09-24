// Join Modal & Hero Code Input Controller
// İsim sorulmaz: cihazın tek nick'i (ensureStoredNick) ile katılınır.
// İsim düzenleme noktası ana menüdeki karakter kartıdır.
import { ensureStoredNick } from '../net.js';
import { showInstallToast } from './toast.js';
import { t, onLangChange } from '../i18n.js';

const joinRoomModal = document.getElementById('join-room-modal');
const inputRoomCode = document.getElementById('input-room-code');
const joinAsName = document.getElementById('join-as-name');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnPasteRoomCode = document.getElementById('btn-paste-room-code');

const heroInputCode = document.getElementById('hero-input-code');
const btnHeroJoin = document.getElementById('btn-hero-join');
const btnHeroPaste = document.getElementById('btn-hero-paste');
const onlineHeroInputCode = document.getElementById('online-input-code');
const btnOnlineHeroJoin = document.getElementById('btn-online-join');
const btnClearRoomCode = document.getElementById('btn-clear-room-code');
const btnClearHeroCode = document.getElementById('btn-clear-hero-code');
const btnClearOnlineHeroCode = document.getElementById('btn-clear-online-code');

// Modal metinleri platform moduna göre değişir: TV_CONSOLE'de telefon kumandadır
// (TV sahadır), ONLINE'da ise oyuncudur (P2-P4, telefonda görüp oynar).
// applyI18nToDOM sabit data-i18n metinlerini geri yazdığı için bu override
// hem modal açılışında hem de dil değişiminden sonra yeniden uygulanır.
const joinBadge = joinRoomModal?.querySelector('.join-badge');
const joinTitle = joinRoomModal?.querySelector('.join-title');
const joinCodeLabel = joinRoomModal?.querySelector('.join-label');
const joinAsYou = joinRoomModal?.querySelector('.join-as-badge span[data-i18n="join.asYou"]');
const joinHint = joinRoomModal?.querySelector('.join-as-hint');

let joinModalMode = null;

function applyJoinModeCopy(mode) {
  const suffix = mode === 'ONLINE' ? 'Player' : 'Controller';
  if (joinBadge) joinBadge.textContent = t(`join.badge${suffix}`);
  if (joinTitle) joinTitle.textContent = t('join.title');
  if (joinCodeLabel) joinCodeLabel.textContent = t('join.codeLabel');
  if (joinAsYou) joinAsYou.textContent = t(`join.asYou${suffix}`);
  if (joinHint) joinHint.textContent = t(`join.hint${suffix}`);
  if (btnSubmitJoin) btnSubmitJoin.textContent = t(`join.submit${suffix}`);
}

onLangChange(() => {
  if (joinRoomModal && !joinRoomModal.classList.contains('hidden')) {
    applyJoinModeCopy(joinModalMode);
  }
});

// × temizleme: değer varken görünür, basınca auto-join tetiklemez
function bindClearButton(btn, input) {
  if (!btn || !input) return;
  const refresh = () => btn.classList.toggle('hidden', !(input.value && input.value.length > 0));
  input.addEventListener('input', refresh);
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    input.value = '';
    refresh();
    input.focus();
  });
  refresh();
}
bindClearButton(btnClearRoomCode, inputRoomCode);
bindClearButton(btnClearHeroCode, heroInputCode);
bindClearButton(btnClearOnlineHeroCode, onlineHeroInputCode);

export function openJoinModal(prefilledCode = '', mode = null) {
  joinModalMode = mode;
  applyJoinModeCopy(mode);
  if (inputRoomCode) {
    inputRoomCode.value = prefilledCode.toUpperCase();
  }
  if (joinAsName) {
    joinAsName.textContent = ensureStoredNick();
  }
  joinRoomModal?.classList.remove('hidden');
}

export function closeJoinModal() {
  joinRoomModal?.classList.add('hidden');
}

export function initJoinModal({ onExecuteJoin }) {
  btnPasteRoomCode?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && inputRoomCode) {
        const match = text.match(/join=([A-Za-z0-9]{3})/i) || text.match(/\b([A-Za-z0-9]{3})\b/);
        inputRoomCode.value = (match ? match[1] : text.slice(0, 3)).toUpperCase();
        showInstallToast(t('join.pasted'));
      }
    } catch (err) {
      showInstallToast(t('join.clipFail'));
    }
  });

  btnCancelJoin?.addEventListener('click', closeJoinModal);

  // Kapatma jestleri: backdrop + ESC + aşağı kaydırma (katılım tetiklemez)
  joinRoomModal?.addEventListener('click', (e) => {
    if (e.target === joinRoomModal) closeJoinModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && joinRoomModal && !joinRoomModal.classList.contains('hidden')) {
      closeJoinModal();
    }
  });
  const joinCard = joinRoomModal?.querySelector('.join-room-card');
  let joinStartY = null;
  joinCard?.addEventListener('touchstart', (e) => {
    if (e.touches[0]) joinStartY = e.touches[0].clientY;
  }, { passive: true });
  joinCard?.addEventListener('touchend', (e) => {
    if (joinStartY === null) return;
    const dy = (e.changedTouches[0]?.clientY ?? joinStartY) - joinStartY;
    joinStartY = null;
    if (dy > 90) closeJoinModal();
  }, { passive: true });

  btnSubmitJoin?.addEventListener('click', () => {
    const code = inputRoomCode?.value?.trim().toUpperCase();
    if (!code || code.length < 3) {
      showInstallToast(t('join.needCode'));
      return;
    }
    closeJoinModal();
    onExecuteJoin(code, ensureStoredNick(), joinModalMode);
  });

  inputRoomCode?.addEventListener('input', (e) => {
    const code = (e.target.value || '').trim().toUpperCase();
    e.target.value = code;
    if (code.length === 3) {
      closeJoinModal();
      onExecuteJoin(code, ensureStoredNick(), joinModalMode);
    }
  });

  // Hero Quick Join — TV ve ONLINE kartları aynı yardımcıyı paylaşır.
  const joinFromHeroInput = (input, mode) => {
    const code = input?.value?.trim().toUpperCase();
    if (!code || code.length < 3) {
      openJoinModal(code, mode);
      return;
    }
    onExecuteJoin(code, ensureStoredNick(), mode);
  };

  const bindHeroInput = (input, button, mode) => {
    button?.addEventListener('click', () => joinFromHeroInput(input, mode));
    input?.addEventListener('input', (e) => {
      const code = (e.target.value || '').trim().toUpperCase();
      e.target.value = code;
      if (code.length === 3) onExecuteJoin(code, ensureStoredNick(), mode);
    });
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = input?.value?.trim().toUpperCase();
        if (code && code.length === 3) onExecuteJoin(code, ensureStoredNick(), mode);
      }
    });
  };

  bindHeroInput(heroInputCode, btnHeroJoin, 'TV_CONSOLE');
  bindHeroInput(onlineHeroInputCode, btnOnlineHeroJoin, 'ONLINE');

  btnHeroPaste?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && heroInputCode) {
        const match = text.match(/join=([A-Za-z0-9]{3})/i) || text.match(/\b([A-Za-z0-9]{3})\b/);
        const code = (match ? match[1] : text.slice(0, 3)).toUpperCase();
        heroInputCode.value = code;
        if (code.length === 3) {
          onExecuteJoin(code, ensureStoredNick(), 'TV_CONSOLE');
        }
      }
    } catch (err) {
      showInstallToast(t('join.clipHint'));
    }
  });
}
