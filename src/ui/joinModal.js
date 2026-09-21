// Join Modal & Hero Code Input Controller
// İsim sorulmaz: cihazın tek nick'i (ensureStoredNick) ile katılınır.
// İsim düzenleme noktası ana menüdeki karakter kartıdır.
import { ensureStoredNick } from '../net.js';
import { showInstallToast } from './toast.js';
import { t } from '../i18n.js';

const joinRoomModal = document.getElementById('join-room-modal');
const inputRoomCode = document.getElementById('input-room-code');
const joinAsName = document.getElementById('join-as-name');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnPasteRoomCode = document.getElementById('btn-paste-room-code');

const heroInputCode = document.getElementById('hero-input-code');
const btnHeroJoin = document.getElementById('btn-hero-join');
const btnHeroPaste = document.getElementById('btn-hero-paste');
const btnClearRoomCode = document.getElementById('btn-clear-room-code');
const btnClearHeroCode = document.getElementById('btn-clear-hero-code');

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

export function openJoinModal(prefilledCode = '') {
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
    onExecuteJoin(code, ensureStoredNick());
  });

  inputRoomCode?.addEventListener('input', (e) => {
    const code = (e.target.value || '').trim().toUpperCase();
    e.target.value = code;
    if (code.length === 3) {
      closeJoinModal();
      onExecuteJoin(code, ensureStoredNick());
    }
  });

  // Hero Quick Join
  btnHeroJoin?.addEventListener('click', () => {
    const code = heroInputCode?.value?.trim().toUpperCase();
    if (!code || code.length < 3) {
      openJoinModal(code);
      return;
    }
    onExecuteJoin(code, ensureStoredNick());
  });

  heroInputCode?.addEventListener('input', (e) => {
    const code = (e.target.value || '').trim().toUpperCase();
    e.target.value = code;
    if (code.length === 3) {
      onExecuteJoin(code, ensureStoredNick());
    }
  });

  heroInputCode?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = heroInputCode?.value?.trim().toUpperCase();
      if (code && code.length === 3) {
        onExecuteJoin(code, ensureStoredNick());
      }
    }
  });

  btnHeroPaste?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && heroInputCode) {
        const match = text.match(/join=([A-Za-z0-9]{3})/i) || text.match(/\b([A-Za-z0-9]{3})\b/);
        const code = (match ? match[1] : text.slice(0, 3)).toUpperCase();
        heroInputCode.value = code;
        if (code.length === 3) {
          onExecuteJoin(code, ensureStoredNick());
        }
      }
    } catch (err) {
      showInstallToast(t('join.clipHint'));
    }
  });
}
