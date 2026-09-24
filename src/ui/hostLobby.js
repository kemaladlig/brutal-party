// TV Host Party Lobby Controller & QR Code Generator
import QRCode from 'qrcode';
import { PUBLIC_URL, isPublicOrigin } from '../net.js';
import { showInstallToast } from './toast.js';
import { getActivePalettes, paletteName } from '../core/customizationManager.js';
import { t } from '../i18n.js';

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
    btnHostLaunchGame.textContent = t('host.stage');
  }
}

export function getEffectiveJoinUrl(code, platformMode) {
  const modeParam = platformMode === 'TV_CONSOLE' ? 'tv' : 'online';
  if (platformMode === 'ONLINE' || isPublicOrigin()) {
    const base = PUBLIC_URL.replace(/\/$/, '');
    return `${base}/?join=${encodeURIComponent(code)}&mode=${modeParam}`;
  }
  const port = window.location.port || '3000';
  const host = detectedLanIp || window.location.hostname;
  return `http://${host}:${port}/?join=${encodeURIComponent(code)}&mode=${modeParam}`;
}

export function startHostPingBadge(getPing, platformMode) {
  stopHostPingBadge();
  const badge = document.querySelector('.tv-host-badge');
  if (!badge) return;
  const tick = () => {
    // Dil anlık çözülür: dil değişimi 2sn içinde rozete yansır.
    const baseText = platformMode === 'ONLINE' ? t('host.onlineLobby') : t('host.tvLobby');
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
  onSetSlotColor,
  onRandomizeSlotColor,
}) {
  // Game selector chips in Host Lobby
  document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.lobby-game-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentHostGameMode = chip.dataset.game;
      getActiveNet().setHostGameMode?.(currentHostGameMode);
      if (btnHostLaunchGame) {
        btnHostLaunchGame.textContent = t('host.stage');
      }
    });
  });

  // Koltuk hızlı renk düğmeleri: mini palet popover + 🎲 boş rastgele renk.
  // (Yüz/aksesuar her oyuncunun kendi cihazındadır; host sadece display rengini yönetir.)
  const closePalette = () => {
    document.getElementById('slot-palette-pop')?.remove();
  };

  const openPalette = (anchorBtn, idx) => {
    closePalette();
    const pop = document.createElement('div');
    pop.id = 'slot-palette-pop';
    pop.className = 'slot-palette-pop';
    pop.innerHTML = `
      <div class="slot-palette-title">${t('host.seatColor', idx + 1)}</div>
      <div class="slot-palette-grid">
        ${getActivePalettes().map((p) => `
          <button class="slot-palette-swatch" data-hex="${p.hex}" style="background-color: ${p.hex}" title="${paletteName(p)}" type="button"></button>
        `).join('')}
      </div>
      <button class="slot-palette-dice" type="button">${t('host.diceFree')}</button>
    `;
    document.body.appendChild(pop);
    const r = anchorBtn.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 220, r.left + window.scrollX - 60))}px`;
    pop.style.top = `${r.bottom + window.scrollY + 6}px`;

    pop.querySelectorAll('.slot-palette-swatch').forEach((sw) => {
      sw.addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof onSetSlotColor === 'function') onSetSlotColor(idx, sw.dataset.hex);
        closePalette();
      });
    });
    pop.querySelector('.slot-palette-dice')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onRandomizeSlotColor === 'function') onRandomizeSlotColor(idx);
      closePalette();
    });
    setTimeout(() => {
      const dismiss = (e) => {
        if (!pop.contains(e.target)) {
          closePalette();
          document.removeEventListener('click', dismiss);
        }
      };
      document.addEventListener('click', dismiss);
    }, 0);
  };

  document.querySelectorAll('.slot-color-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.slot, 10);
      if (Number.isNaN(idx)) return;
      if (document.getElementById('slot-palette-pop')) closePalette();
      else openPalette(btn, idx);
    });
  });

  // Sert renk engeli: çakışma varken SAHAYA GEÇ görsel olarak kilitlenir
  // (gerçek kapı main.js enterStaging içindedir).
  const launchBtn = document.getElementById('btn-host-launch-game');
  const paintLaunchGuard = (clashCount) => {
    if (!launchBtn) return;
    launchBtn.classList.toggle('blocked', clashCount > 0);
    launchBtn.textContent = clashCount > 0 ? t('stage.split') : t('host.stage');
  };
  window.addEventListener('brutal_color_clash', (e) => {
    paintLaunchGuard(e.detail?.clash?.length || 0);
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
  let closeArmedTimer = null;
  btnHostClose?.addEventListener('click', () => {
    if (!btnHostClose.dataset.armed) {
      btnHostClose.dataset.armed = '1';
      btnHostClose.textContent = t('pause.exitArmed');
      closeArmedTimer = window.setTimeout(() => {
        delete btnHostClose.dataset.armed;
        btnHostClose.textContent = t('host.close');
      }, 3000);
      return;
    }
    window.clearTimeout(closeArmedTimer);
    delete btnHostClose.dataset.armed;
    btnHostClose.textContent = t('host.close');
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
      showInstallToast(t('host.copied'));
    } catch (err) {
      showInstallToast(t('host.link', joinUrl));
    }
  });

  // Oda kodu kopyalama (simge butonu)
  document.getElementById('btn-host-copy-code')?.addEventListener('click', async () => {
    const code = hostRoomCode?.textContent?.trim() || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      showInstallToast(t('host.codeCopied', code));
    } catch (err) {
      showInstallToast(t('host.code', code));
    }
  });

  btnHostWhatsappShare?.addEventListener('click', () => {
    const code = hostRoomCode?.textContent?.trim() || '';
    const joinUrl = getEffectiveJoinUrl(code, getPlatformMode());
    const text = encodeURIComponent(t('host.share', code, joinUrl));
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  });
}
