// TV Host Party Lobby Controller & QR Code Generator
import QRCode from 'qrcode';
import { PUBLIC_URL, isPublicOrigin } from '../net.js';
import { showInstallToast } from './toast.js';
import { getActivePalettes, paletteName } from '../core/customizationManager.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { getSlotSwapError, isBotSlot } from '../core/slotRules.js';
import { t, onLangChange } from '../i18n.js';

const tvHostModal = document.getElementById('tv-host-modal');
const hostRoomCode = document.getElementById('host-room-code');
const hostJoinUrl = document.getElementById('host-join-url');
const qrCanvas = document.getElementById('qr-canvas');
const btnHostLaunchGame = document.getElementById('btn-host-launch-game');
const btnHostTogglePlayer = document.getElementById('btn-host-toggle-player');
const btnHostClose = document.getElementById('btn-host-close');
const btnHostCopyLink = document.getElementById('btn-host-copy-link');
const btnHostWhatsappShare = document.getElementById('btn-host-whatsapp-share');

function setButtonLabel(button, key) {
  const label = button?.querySelector('[data-i18n]');
  if (label) label.textContent = t(key);
  else if (button) button.textContent = t(key);
}

function renderLobbyIcons(root = document) {
  root.querySelectorAll('[data-lobby-icon]').forEach((slot) => {
    const icon = slot.dataset.lobbyIcon;
    if (!icon) return;
    slot.innerHTML = getTabletopIconSvg(icon, { size: 18, strokeWidth: 2.3 });
  });
  root.querySelectorAll('.chip-selected-icon').forEach((slot) => {
    slot.innerHTML = getTabletopIconSvg('check', { size: 12, strokeWidth: 3 });
  });
}

let currentHostGameMode = 'HORDE';
let hostPingTimer = null;
let detectedLanIp = null;
let seatSwapSource = null;
let seatEditorOpen = false;
let currentRoomCode = '';
let currentJoinUrl = '';
let getSlotState = () => null;
let isSeatSwapLocked = () => false;

function paintSeatSwapUi() {
  const buttons = document.querySelectorAll('.slot-swap-btn');
  const hint = document.getElementById('host-slot-hint');
  const subtitle = document.getElementById('tv-host-subtitle');
  const launchBtn = btnHostLaunchGame;
  if (seatEditorOpen || !launchBtn?.classList.contains('blocked')) {
    setButtonLabel(launchBtn, seatEditorOpen ? 'host.closeEditor' : 'host.stage');
  }
  const launchIcon = launchBtn?.querySelector('[data-lobby-icon]');
  if (launchIcon) {
    const icon = seatEditorOpen ? 'close' : 'play';
    launchIcon.dataset.lobbyIcon = icon;
    launchIcon.innerHTML = getTabletopIconSvg(icon, { size: 18, strokeWidth: 2.3 });
  }
  if (subtitle) subtitle.textContent = t(seatEditorOpen ? 'host.seatEditorHint' : 'host.lobbyHint');
  const locked = !!isSeatSwapLocked();
  if (locked && seatSwapSource !== null) seatSwapSource = null;
  if (seatSwapSource !== null) {
    const source = getSlotState(seatSwapSource);
    if (!source || isBotSlot(source)) seatSwapSource = null;
  }

  buttons.forEach((btn) => {
    const idx = parseInt(btn.dataset.slot, 10);
    const slot = getSlotState(idx);
    const selected = seatSwapSource === idx;
    const disabled = locked || isBotSlot(slot) || (seatSwapSource === null && !slot);
    btn.disabled = disabled;
    btn.classList.toggle('is-selected', selected);
    btn.classList.toggle('is-target', seatSwapSource !== null && !selected && !disabled);
    btn.setAttribute('aria-pressed', String(selected));
    const label = btn.querySelector('.slot-swap-label');
    const isTarget = seatSwapSource !== null && !selected && !disabled;
    if (label) label.textContent = selected
      ? t('host.swapSelected')
      : isTarget
        ? t('host.swapTargetAction')
        : t('host.swapAction');
    if (selected) {
      btn.setAttribute('aria-label', t('host.swapSource', idx + 1));
    } else if (disabled) {
      btn.setAttribute('aria-label', t('host.swapUnavailable', idx + 1));
    } else {
      btn.setAttribute('aria-label', t('host.swapTarget', idx + 1));
    }
  });

  if (hint) {
    hint.classList.remove('hidden');
    hint.textContent = seatSwapSource === null
      ? t('host.slotHint')
      : t('host.slotTargetHint', seatSwapSource + 1);
    hint.classList.toggle('is-targeting', seatSwapSource !== null);
  }
}

function resetSeatSwapSelection() {
  seatSwapSource = null;
  paintSeatSwapUi();
}

function getSeatSnapshot() {
  return [0, 1, 2, 3].map((idx) => getSlotState(idx));
}

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
    const active = chip.dataset.game === mode;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });
  setButtonLabel(btnHostLaunchGame, seatEditorOpen ? 'host.closeEditor' : 'host.stage');
}

export function setHostPlayerButtonState(active, platformMode) {
  if (!btnHostTogglePlayer) return;
  const isTvHost = platformMode === 'TV_CONSOLE';
  btnHostTogglePlayer.classList.toggle('hidden', !isTvHost);
  btnHostTogglePlayer.classList.toggle('active', !!active);
  btnHostTogglePlayer.disabled = !isTvHost;
  btnHostTogglePlayer.setAttribute('aria-pressed', String(!!active));
  setButtonLabel(btnHostTogglePlayer, active ? 'host.leavePlayer' : 'host.joinPlayer');
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
  const badgeText = badge?.querySelector('.host-badge-text');
  const modeIcon = badge?.querySelector('[data-lobby-icon]');
  if (!badge || !badgeText) return;
  const isOnline = platformMode === 'ONLINE';
  tvHostModal?.classList.toggle('is-online-room', isOnline);
  if (modeIcon) {
    modeIcon.dataset.lobbyIcon = isOnline ? 'globe' : 'tv';
    modeIcon.innerHTML = getTabletopIconSvg(isOnline ? 'globe' : 'tv', { size: 15, strokeWidth: 2.3 });
  }
  const tick = () => {
    // Dil anlık çözülür: dil değişimi 2sn içinde rozete yansır.
    const baseText = isOnline ? t('host.onlineLobby') : t('host.tvLobby');
    const ping = getPing?.() || 0;
    badgeText.textContent = (isOnline || isPublicOrigin()) && ping > 0
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

export function showHostLobbyModal(code, joinUrl, { seatEditor = false } = {}) {
  currentRoomCode = code || currentRoomCode;
  currentJoinUrl = joinUrl || currentJoinUrl;
  if (!seatEditor) seatSwapSource = null;
  seatEditorOpen = !!seatEditor;
  if (hostRoomCode) hostRoomCode.textContent = currentRoomCode;
  const channelCode = document.getElementById('host-channel-code');
  if (channelCode) channelCode.textContent = currentRoomCode;
  if (hostJoinUrl) hostJoinUrl.textContent = currentJoinUrl.replace(/^https?:\/\//, '');
  if (qrCanvas && !seatEditor) {
    QRCode.toCanvas(qrCanvas, currentJoinUrl, {
      width: 140,
      margin: 1,
      color: { dark: '#1A1A1A', light: '#FFFFFF' },
    });
  }
  tvHostModal?.classList.toggle('is-seat-editor', seatEditorOpen);
  tvHostModal?.classList.remove('hidden');
  tvHostModal?.setAttribute('aria-hidden', 'false');
  paintSeatSwapUi();
  window.requestAnimationFrame(() => {
    const target = seatEditorOpen
      ? document.querySelector('.slot-swap-btn:not(:disabled)')
      : btnHostLaunchGame;
    target?.focus({ preventScroll: true });
  });
}

export function openHostSeatEditor() {
  if (!currentRoomCode && !hostRoomCode?.textContent) return false;
  showHostLobbyModal(
    currentRoomCode || hostRoomCode?.textContent?.trim() || '',
    currentJoinUrl || hostJoinUrl?.textContent?.trim() || '',
    { seatEditor: true },
  );
  return true;
}

export function hideHostLobbyModal() {
  seatEditorOpen = false;
  resetSeatSwapSelection();
  tvHostModal?.classList.remove('is-seat-editor');
  tvHostModal?.classList.add('hidden');
  tvHostModal?.setAttribute('aria-hidden', 'true');
  stopHostPingBadge();
}

export function initHostLobby({
  getActiveNet,
  getPlatformMode,
  onStageGame,
  onToggleHostPlayer,
  onCloseLobby,
  onSwapSlots,
  onToggleBotSlot,
  onSetSlotColor,
  onRandomizeSlotColor,
  getSlot,
  isSeatSwapLocked: isSeatSwapLockedCallback,
}) {
  getSlotState = typeof getSlot === 'function' ? getSlot : getSlotState;
  isSeatSwapLocked = typeof isSeatSwapLockedCallback === 'function'
    ? isSeatSwapLockedCallback
    : isSeatSwapLocked;
  renderLobbyIcons(document);
  paintSeatSwapUi();
  window.addEventListener('brutal_host_slots_changed', paintSeatSwapUi);
  onLangChange(paintSeatSwapUi);

  // Game selector chips in Host Lobby
  document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
    const active = chip.dataset.game === currentHostGameMode;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
    chip.addEventListener('click', () => {
      setCurrentHostGameMode(chip.dataset.game);
      getActiveNet().setHostGameMode?.(currentHostGameMode);
    });
  });

  // Koltuk hızlı renk düğmeleri: mini palet popover + boş rastgele renk.
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
          <button class="slot-palette-swatch" data-hex="${p.hex}" style="background-color: ${p.hex}" title="${paletteName(p)}" aria-label="${paletteName(p)}" type="button"></button>
        `).join('')}
      </div>
      <button class="slot-palette-dice" type="button">
        <span>${getTabletopIconSvg('dice', { size: 16, strokeWidth: 2.3 })}</span>
        <span>${t('host.diceFree')}</span>
      </button>
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
    if (seatEditorOpen) {
      launchBtn.classList.remove('blocked');
      setButtonLabel(launchBtn, 'host.closeEditor');
      return;
    }
    launchBtn.classList.toggle('blocked', clashCount > 0);
    setButtonLabel(launchBtn, clashCount > 0 ? 'stage.split' : 'host.stage');
  };
  window.addEventListener('brutal_color_clash', (e) => {
    paintLaunchGuard(e.detail?.clash?.length || 0);
  });

  // Koltuk taşıma: önce oyuncunun kartı, sonra hedef koltuk seçilir.
  // Eski komşu koltukla döndürme modeli mobilde hangi oyuncunun taşındığını
  // görünmez kılıyordu; hedef artık açıkça seçiliyor.
  document.querySelectorAll('.slot-swap-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = parseInt(btn.dataset.slot, 10);
      if (Number.isNaN(slot)) return;
      if (isSeatSwapLocked()) {
        showInstallToast(t('toast.countdownLock'));
        return;
      }

      const source = getSlotState(slot);
      if (!source || isBotSlot(source)) return;

      if (seatSwapSource === null) {
        seatSwapSource = slot;
        paintSeatSwapUi();
        return;
      }
      if (seatSwapSource === slot) {
        resetSeatSwapSelection();
        return;
      }

      const from = seatSwapSource;
      const error = getSlotSwapError({
        from,
        to: slot,
        slots: getSeatSnapshot(),
        locked: false,
        remote: false,
      });
      if (error) {
        showInstallToast(error === 'bot' ? t('toast.botSeatLocked') : t('toast.swapBlocked'));
        paintSeatSwapUi();
        return;
      }

      const didSwap = typeof onSwapSlots === 'function' ? onSwapSlots(from, slot) : true;
      if (didSwap === false) {
        showInstallToast(t('toast.swapBlocked'));
        paintSeatSwapUi();
        return;
      }
      resetSeatSwapSelection();
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

  btnHostTogglePlayer?.addEventListener('click', () => {
    if (typeof onToggleHostPlayer === 'function') {
      onToggleHostPlayer();
    }
  });

  // BAŞLAT #1: sahayı aç (staging). Oyun başlamaz; koltuk seçimi başlar.
  btnHostLaunchGame?.addEventListener('click', () => {
    if (seatEditorOpen) {
      hideHostLobbyModal();
      return;
    }
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
      setButtonLabel(btnHostClose, 'pause.exitArmed');
      closeArmedTimer = window.setTimeout(() => {
        delete btnHostClose.dataset.armed;
        setButtonLabel(btnHostClose, 'host.close');
      }, 3000);
      return;
    }
    window.clearTimeout(closeArmedTimer);
    delete btnHostClose.dataset.armed;
    setButtonLabel(btnHostClose, 'host.close');
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
