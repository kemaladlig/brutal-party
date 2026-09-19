// TV Host Party Lobby Controller & QR Code Generator
import QRCode from 'qrcode';
import { PUBLIC_URL, isPublicOrigin } from '../net.js';
import { showInstallToast } from './toast.js';

const tvHostModal = document.getElementById('tv-host-modal');
const hostRoomCode = document.getElementById('host-room-code');
const hostJoinUrl = document.getElementById('host-join-url');
const qrCanvas = document.getElementById('qr-canvas');
const btnHostLaunchGame = document.getElementById('btn-host-launch-game');
const btnHostClose = document.getElementById('btn-host-close');
const btnHostCopyLink = document.getElementById('btn-host-copy-link');
const btnHostWhatsappShare = document.getElementById('btn-host-whatsapp-share');

let currentHostGameMode = 'PONG';
let hostPingTimer = null;
let detectedLanIp = null;

// Fetch LAN IP for offline WiFi/LAN party mode
fetch('/api/lan-ip')
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (data?.ip) detectedLanIp = data.ip;
  })
  .catch(() => {});

export function getCurrentHostGameMode() {
  return currentHostGameMode;
}

export function setCurrentHostGameMode(mode) {
  currentHostGameMode = mode;
  document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.game === mode);
  });
  if (btnHostLaunchGame) {
    btnHostLaunchGame.textContent = `▶ SAHAYA GEÇ`;
  }
}

export function getEffectiveJoinUrl(code, platformMode) {
  if (platformMode === 'ONLINE' || isPublicOrigin()) {
    const base = PUBLIC_URL.replace(/\/$/, '');
    return `${base}/?join=${code}`;
  }
  const port = window.location.port || '3000';
  const host = detectedLanIp || window.location.hostname;
  return `http://${host}:${port}/?join=${code}`;
}

export function startHostPingBadge(getPing, platformMode) {
  stopHostPingBadge();
  const badge = document.querySelector('.tv-host-badge');
  if (!badge) return;
  const baseText = platformMode === 'ONLINE' ? '🌐 ONLINE LOBİ' : '📺 TV HOST PARTİ LOBİSİ';
  const tick = () => {
    const ping = getPing?.() || 0;
    badge.textContent = (platformMode === 'ONLINE' || isPublicOrigin()) && ping > 0
      ? `${baseText} • ${ping}ms`
      : baseText;
  };
  tick();
  hostPingTimer = window.setInterval(tick, 2000);
}

export function stopHostPingBadge() {
  if (hostPingTimer) {
    window.clearInterval(hostPingTimer);
    hostPingTimer = null;
  }
}

export function showHostLobbyModal(code, joinUrl) {
  if (hostRoomCode) hostRoomCode.textContent = code;
  const channelCode = document.getElementById('host-channel-code');
  if (channelCode) channelCode.textContent = code;
  if (hostJoinUrl) hostJoinUrl.textContent = joinUrl.replace(/^https?:\/\//, '');
  if (qrCanvas) {
    QRCode.toCanvas(qrCanvas, joinUrl, {
      width: 140,
      margin: 1,
      color: { dark: '#1A1A1A', light: '#FFFFFF' },
    });
  }
  tvHostModal?.classList.remove('hidden');
}

export function hideHostLobbyModal() {
  tvHostModal?.classList.add('hidden');
  stopHostPingBadge();
}

export function initHostLobby({
  getActiveNet,
  getPlatformMode,
  onStageGame,
  onCloseLobby,
  onSwapSlots,
  onToggleBotSlot,
}) {
  // Game selector chips in Host Lobby
  document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.lobby-game-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentHostGameMode = chip.dataset.game;
      getActiveNet().setHostGameMode?.(currentHostGameMode);
      if (btnHostLaunchGame) {
        btnHostLaunchGame.textContent = `▶ SAHAYA GEÇ`;
      }
    });
  });

  // Slot swap buttons in Host Lobby
  document.querySelectorAll('.slot-swap-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slotA = parseInt(btn.dataset.slot, 10);
      const slotB = (slotA + 1) % 4;
      if (typeof onSwapSlots === 'function') {
        onSwapSlots(slotA, slotB);
      }
    });
  });

  // Açık bot butonu: boş koltukta "+ BOT" ekler, bot kartında "✕" kaldırır.
  // (Eskiden kart gövdesine dokunuluyordu — ne yaptığı belli değildi.)
  document.querySelectorAll('.slot-bot-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.slot, 10);
      if (Number.isNaN(idx)) return;
      if (typeof onToggleBotSlot === 'function') {
        onToggleBotSlot(idx);
      }
    });
  });

  // BAŞLAT #1: sahayı aç (staging). Oyun başlamaz; koltuk seçimi başlar.
  btnHostLaunchGame?.addEventListener('click', () => {
    hideHostLobbyModal();
    if (typeof onStageGame === 'function') {
      onStageGame(currentHostGameMode);
    }
  });

  // Çift-bas onay: ilk dokunuş kurar, 3sn içinde ikinci dokunuş kapatır
  const CLOSE_LABEL = '⌂ LOBİYİ KAPAT';
  let closeArmedTimer = null;
  btnHostClose?.addEventListener('click', () => {
    if (!btnHostClose.dataset.armed) {
      btnHostClose.dataset.armed = '1';
      btnHostClose.textContent = 'EMİN MİSİN? TEKRAR BAS';
      closeArmedTimer = window.setTimeout(() => {
        delete btnHostClose.dataset.armed;
        btnHostClose.textContent = CLOSE_LABEL;
      }, 3000);
      return;
    }
    window.clearTimeout(closeArmedTimer);
    delete btnHostClose.dataset.armed;
    btnHostClose.textContent = CLOSE_LABEL;
    hideHostLobbyModal();
    if (typeof onCloseLobby === 'function') {
      onCloseLobby();
    }
  });

  btnHostCopyLink?.addEventListener('click', async () => {
    const code = hostRoomCode?.textContent?.trim() || '';
    const joinUrl = getEffectiveJoinUrl(code, getPlatformMode());
    try {
      await navigator.clipboard.writeText(joinUrl);
      showInstallToast('✓ Bağlantı panoya kopyalandı!');
    } catch (err) {
      showInstallToast(`Bağlantı: ${joinUrl}`);
    }
  });

  // Oda kodu kopyalama (simge butonu)
  document.getElementById('btn-host-copy-code')?.addEventListener('click', async () => {
    const code = hostRoomCode?.textContent?.trim() || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showInstallToast(`✓ Oda kodu kopyalandı: #${code}`);
    } catch (err) {
      showInstallToast(`Oda kodu: #${code}`);
    }
  });

  btnHostWhatsappShare?.addEventListener('click', () => {
    const code = hostRoomCode?.textContent?.trim() || '';
    const joinUrl = getEffectiveJoinUrl(code, getPlatformMode());
    const text = encodeURIComponent(`🎮 BRUTAL PARTY // 4P odasına katıl!\nOda Kodu: #${code}\nBağlantı: ${joinUrl}`);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  });
}
