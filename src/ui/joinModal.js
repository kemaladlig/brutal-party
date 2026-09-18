// Join Modal & Hero Code Input Controller
import { getStoredPlayerName } from '../net.js';
import { showInstallToast } from './toast.js';

const joinRoomModal = document.getElementById('join-room-modal');
const inputRoomCode = document.getElementById('input-room-code');
const inputPlayerName = document.getElementById('input-player-name');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnPasteRoomCode = document.getElementById('btn-paste-room-code');

const heroInputCode = document.getElementById('hero-input-code');
const btnHeroJoin = document.getElementById('btn-hero-join');
const btnHeroPaste = document.getElementById('btn-hero-paste');

export function openJoinModal(prefilledCode = '') {
  if (inputRoomCode) {
    inputRoomCode.value = prefilledCode.toUpperCase();
  }
  if (inputPlayerName && !inputPlayerName.value) {
    inputPlayerName.value = getStoredPlayerName();
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
        const match = text.match(/join=([A-Za-z0-9]{4})/i) || text.match(/\b([A-Za-z0-9]{4})\b/);
        inputRoomCode.value = (match ? match[1] : text.slice(0, 4)).toUpperCase();
        showInstallToast('✓ Oda kodu yapıştırıldı!');
      }
    } catch (err) {
      showInstallToast('Pano okunamadı.');
    }
  });

  btnCancelJoin?.addEventListener('click', closeJoinModal);

  btnSubmitJoin?.addEventListener('click', () => {
    const code = inputRoomCode?.value?.trim().toUpperCase();
    const name = (inputPlayerName?.value || getStoredPlayerName() || 'OYUNCU').toUpperCase();
    if (!code || code.length < 4) {
      showInstallToast('Geçerli 4 haneli oda kodunu girin.');
      return;
    }
    closeJoinModal();
    onExecuteJoin(code, name);
  });

  inputPlayerName?.addEventListener('input', (e) => {
    e.target.value = (e.target.value || '').toUpperCase();
  });

  inputRoomCode?.addEventListener('input', (e) => {
    const code = (e.target.value || '').trim().toUpperCase();
    e.target.value = code;
    if (code.length === 4) {
      closeJoinModal();
      onExecuteJoin(code, (inputPlayerName?.value || getStoredPlayerName() || 'OYUNCU').toUpperCase());
    }
  });

  // Hero Quick Join
  btnHeroJoin?.addEventListener('click', () => {
    const code = heroInputCode?.value?.trim().toUpperCase();
    if (!code || code.length < 4) {
      openJoinModal(code);
      return;
    }
    onExecuteJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
  });

  heroInputCode?.addEventListener('input', (e) => {
    const code = (e.target.value || '').trim().toUpperCase();
    e.target.value = code;
    if (code.length === 4) {
      onExecuteJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
    }
  });

  heroInputCode?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = heroInputCode?.value?.trim().toUpperCase();
      if (code && code.length === 4) {
        onExecuteJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
      }
    }
  });

  btnHeroPaste?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && heroInputCode) {
        const match = text.match(/join=([A-Za-z0-9]{4})/i) || text.match(/\b([A-Za-z0-9]{4})\b/);
        const code = (match ? match[1] : text.slice(0, 4)).toUpperCase();
        heroInputCode.value = code;
        if (code.length === 4) {
          onExecuteJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
        }
      }
    } catch (err) {
      showInstallToast('Pano okunamadı, kodu elle yazabilirsiniz.');
    }
  });
}
