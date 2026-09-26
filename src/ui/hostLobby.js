// TV Host Party Lobby Controller & QR Code Generator
import QRCode from 'qrcode';
import { PUBLIC_URL, isPublicOrigin } from '../net.js';
import { showInstallToast } from './toast.js';
import { getActivePalettes, paletteName } from '../core/customizationManager.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { hydrateIconSlots } from './iconSlots.js';
import { getSlotSwapError, isBotSlot } from '../core/slotRules.js';
import { revealView, closeView } from './appShell.js';
import { openOverlay, closeOverlay, isOverlayOpen } from './overlayHost.js';
import { t, onLangChange } from '../i18n.js';

// Lobi artık MODAL değil, shell GÖRÜNÜMÜ (`views/lobbyView.js` bu düğümü
// devralır). Buradaki `show`/`hide` yalnız içeriği tazeler ve kabuktan ekranı
// ister/kapatır; görünürlüğün tek sahibi artık shell'dir (AGENTS.md §7).
//
// Durum sınıfları (`is-online-room`, `is-seat-editor`) KARTIN üzerine yazılır,
// kabuk düğümüne değil: kart devralınca kabuktan ayrılıyor, `#tv-host-modal.*`
// seçicileri bir daha eşleşmiyordu (koltuk düzenleyici görünümü ölüydü).
const tvHostModal = document.getElementById('tv-host-modal')?.querySelector('.tv-host-card')
  || document.getElementById('tv-host-modal');
const hostRoomCode = document.getElementById('host-room-code');
const hostJoinUrl = document.getElementById('host-join-url');
const qrCanvas = document.getElementById('qr-canvas');
const btnHostLaunchGame = document.getElementById('btn-host-launch-game');
const btnHostTogglePlayer = document.getElementById('btn-host-toggle-player');
const btnHostClose = document.getElementById('btn-host-close');
const btnHostCopyLink = document.getElementById('btn-host-copy-link');
const btnHostWhatsappShare = document.getElementById('btn-host-whatsapp-share');

// Sheet'ler (DAVET / koltuk) kartın içinde yaşar; görünürlük + Escape + odak
// trap tek sahibinden gider: `overlayHost.js`.
const lobbyInviteSheet = document.getElementById('lobby-invite-sheet');
const lobbySeatSheet = document.getElementById('lobby-seat-sheet');
const seatSheetTitle = document.getElementById('lobby-seat-sheet-title');
const seatSheetActions = document.getElementById('lobby-seat-sheet-actions');

const SHEET_ANIM_MS = 200;

function setButtonLabel(button, key) {
  const label = button?.querySelector('[data-i18n]');
  if (label) label.textContent = t(key);
  else if (button) button.textContent = t(key);
}

function renderLobbyIcons(root = document) {
  // Yuva doldurma tek uygulamada (`iconSlots.js`); lobi yalnız öznitelik adını
  // ve varsayılan ölçüyü söyler.
  hydrateIconSlots(root, 'lobbyIcon', { size: 18, strokeWidth: 2.3 });
  root.querySelectorAll('.chip-selected-icon').forEach((slot) => {
    slot.innerHTML = getTabletopIconSvg('check', { size: 12, strokeWidth: 3 });
  });
}

let currentHostGameMode = 'HORDE';
let hostPingTimer = null;
let detectedLanIp = null;
let seatSwapSource = null;
let seatEditorOpen = false;
// `hideHostLobbyModal` lobiyi yalnız GİZLER (TO ARENA, düzenleyici kapat, ✕
// kendi oda kapanışını açıkça çağırır). `lobbyView` bu pencerede `onLobbyExit`
// ile odayı KAPATMASIN — dispatch senkron olduğu için bayrak yeter.
let lobbyExitSuppressed = false;
let currentRoomCode = '';
let currentJoinUrl = '';
let getSlotState = () => null;
let isSeatSwapLocked = () => false;
let getActiveNet = () => null;

// ── Sheet altyapısı ───────────────────────────────────────────────────────
// `.lobby-sheet` kökü aynı zamanda backdrop'tur: `overlayHost` köke tıklamayı
// kapanış sayar. Aç/kapa sınıfları CSS geçişini (fade + slide) besler.

export function showLobbySheet(sheet, id, { onShow = null, onHide = null } = {}) {
  if (!sheet || sheet.classList.contains('is-open')) return;
  onShow?.();
  sheet.classList.remove('hidden');
  window.requestAnimationFrame(() => sheet.classList.add('is-open'));
  openOverlay(id, {
    el: sheet,
    onClose: () => {
      sheet.classList.remove('is-open');
      window.setTimeout(() => {
        sheet.classList.add('hidden');
        onHide?.();
      }, SHEET_ANIM_MS);
    },
  });
}

export function dismissLobbySheet(id) {
  closeOverlay(id);
}

export function isLobbySheetOpen(id) {
  return isOverlayOpen(id);
}

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
    // Çipin kendisi de hedef/ kaynak durumunu gösterir (buton sheet'in içinde
    // olabilir; çip her zaman listede durur).
    const chip = document.getElementById(`slot-p${idx + 1}`);
    if (chip) {
      chip.classList.toggle('is-swap-source', selected);
      chip.classList.toggle('is-swap-target', isTarget);
    }
  });

  if (hint) {
    hint.classList.remove('hidden');
    hint.textContent = seatSwapSource === null
      ? t('host.slotHint')
      : t('host.slotTargetHint', seatSwapSource + 1);
    hint.classList.toggle('is-targeting', seatSwapSource !== null);
  }
  if (isLobbySheetOpen('lobby-seat')) paintSeatSheetTitle();
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

/**
 * Yalnız YEREL seçimi değiştirir (relay'a göndermez). Oda kurulmadan ÖNCE
 * `main.js` tarafından kullanılır: ağ henüz yokken hatırlanacak mod budur.
 */
export function setCurrentHostGameMode(mode) {
  if (mode) currentHostGameMode = mode;
}

/**
 * Lobi oyun seçimini değiştirir ve gerekli tüm tarafları haberlendirir:
 * relay (`setHostGameMode`) ve karusel (`lobby:game` olayı).
 * Lobi 15 oyunu bir IZGARA olarak göstermez — mobilde tek kahraman kapak +
 * adım düğmeleri yeterlidir; tam ızgara sheet'i `views/lobbyView.js`'tedir.
 * Bu yüzden değişim tek fonksiyondan geçer; çağıran taraf yalnız niyetini söyler.
 */
export function setHostGameMode(mode) {
  if (!mode || mode === currentHostGameMode) return;
  setCurrentHostGameMode(mode);
  getActiveNet()?.setHostGameMode?.(mode);
  document.dispatchEvent(new CustomEvent('lobby:game', { detail: { mode } }));
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

// ── DAVET sheet'i ─────────────────────────────────────────────────────────

function paintInviteContent() {
  const channelCode = document.getElementById('host-channel-code');
  if (channelCode) channelCode.textContent = currentRoomCode;
  if (hostJoinUrl) hostJoinUrl.textContent = currentJoinUrl.replace(/^https?:\/\//, '');
  if (qrCanvas && currentJoinUrl) {
    QRCode.toCanvas(qrCanvas, currentJoinUrl, {
      width: 148,
      margin: 1,
      color: { dark: '#1A1A1A', light: '#FFFFFF' },
    });
  }
}

function openInviteSheet() {
  paintInviteContent();
  showLobbySheet(lobbyInviteSheet, 'lobby-invite');
}

// ── Koltuk sheet'i ────────────────────────────────────────────────────────
// Renk/bot/takas düğmeleri çipte DOĞAR (initHostLobby onlara bağlanır) ve
// sheet açılınca AYNI DÜĞÜMLER sheet'e taşınır; kapanınca çip geri alır.
// Kopya düğüm yok — tek kaynak, tek bağlama.

let seatSheetSlot = null;

function seatSheetHeadline(idx) {
  const entry = getSlotState(idx);
  const name = entry?.name ? ` · ${entry.name}` : '';
  return `${t('host.seat')} 0${idx + 1}${name}`;
}

function paintSeatSheetTitle() {
  if (seatSheetSlot === null || !seatSheetTitle) return;
  const entry = getSlotState(seatSheetSlot);
  seatSheetTitle.textContent = seatSheetHeadline(seatSheetSlot);
  // Boş koltukta takas anlamsız: düğme hiç gösterilmez (sayım kilidinde
  // dolu koltukta görünür kalır, dokununca toast neden söyler).
  lobbySeatSheet?.classList.toggle('is-empty-seat', !entry);
}

function openSeatSheet(idx) {
  showLobbySheet(lobbySeatSheet, 'lobby-seat', {
    onShow: () => {
      seatSheetSlot = idx;
      paintSeatSheetTitle();
      const chip = document.getElementById(`slot-p${idx + 1}`);
      const actions = chip?.querySelector('.slot-card-actions');
      if (actions && seatSheetActions) {
        seatSheetActions.append(actions);
        actions.classList.add('is-sheet-hosted');
      }
      paintSeatSwapUi();
    },
    onHide: () => {
      const actions = seatSheetActions?.querySelector('.slot-card-actions');
      if (actions) {
        document.getElementById(`slot-p${seatSheetSlot + 1}`)?.append(actions);
        actions.classList.remove('is-sheet-hosted');
      }
      seatSheetSlot = null;
    },
  });
}

export function showHostLobbyModal(code, joinUrl, { seatEditor = false } = {}) {
  currentRoomCode = code || currentRoomCode;
  currentJoinUrl = joinUrl || currentJoinUrl;
  if (!seatEditor) seatSwapSource = null;
  seatEditorOpen = !!seatEditor;
  if (hostRoomCode) hostRoomCode.textContent = currentRoomCode;
  // Sheet açıkken odaya yeni biri katılıp lobi yeniden çağrılabilir; sheet
  // arkadaki içerikten beslendiği için burada da tazele.
  paintInviteContent();
  // Kapanışa bırakılmayan eski sheet durumu oda değişiminden sızmasın.
  dismissLobbySheet('lobby-seat');
  dismissLobbySheet('lobby-invite');
  tvHostModal?.classList.toggle('is-seat-editor', seatEditorOpen);
  paintSeatSwapUi();
  // Görünürlük kabuğun: lobi ekranı gerekirse açılır, gerekirse yeniden
  // tazelenir (oda hâlâ açıksa `revealView` mevcut düğümü korur).
  revealView('lobby');
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
  dismissLobbySheet('lobby-seat');
  dismissLobbySheet('lobby-invite');
  tvHostModal?.classList.remove('is-seat-editor');
  stopHostPingBadge();
  // Ekranı kapatma kabuğun işi; oda açık kalmalı (`main.js` `onCloseLobby`
  // çağrısı odayı kapatır, ekran kapanması yalnız görünürlüktür).
  lobbyExitSuppressed = true;
  try { closeView('lobby'); } finally { lobbyExitSuppressed = false; }
}

export function isLobbyExitSuppressed() {
  return lobbyExitSuppressed;
}

async function copyRoomCode() {
  const code = hostRoomCode?.textContent?.trim() || '';
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showInstallToast(t('host.codeCopied', code));
  } catch {
    showInstallToast(t('host.code', code));
  }
}

export function initHostLobby({
  getActiveNet: getActiveNetCb,
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
  getActiveNet = typeof getActiveNetCb === 'function' ? getActiveNetCb : () => null;
  renderLobbyIcons(document);
  paintSeatSwapUi();
  window.addEventListener('brutal_host_slots_changed', paintSeatSwapUi);
  onLangChange(paintSeatSwapUi);

  // Sheet kabuğu: backdrop `overlayHost`'ta; buradaki X düğmeleri aynı
  // kapanış yolundan geçer (odak/Escape tek sahibi bozulmasın).
  document.querySelectorAll('[data-sheet-close]').forEach((btn) => {
    btn.addEventListener('click', () => dismissLobbySheet(`lobby-${btn.dataset.sheetClose}`));
  });
  document.getElementById('btn-lobby-invite')?.addEventListener('click', openInviteSheet);
  document.getElementById('btn-seat-sheet-invite')?.addEventListener('click', () => {
    dismissLobbySheet('lobby-seat');
    openInviteSheet();
  });

  // Koltuk çipleri: tek dokunuş sheet'i açar; takas hedefleme modunda ise
  // çip DOĞRUDAN hedef olur (gizli takas düğmesine tıklanır — mantık tek yer).
  document.querySelectorAll('.slot-chip-main').forEach((chipBtn) => {
    chipBtn.addEventListener('click', () => {
      const chip = chipBtn.closest('.host-player-slot');
      const slot = parseInt(chip?.dataset.slot ?? '', 10);
      if (Number.isNaN(slot)) return;
      if (seatSwapSource !== null) {
        if (seatSwapSource === slot) {
          resetSeatSwapSelection();
          return;
        }
        const swapBtn = chip.querySelector('.slot-swap-btn');
        if (swapBtn?.disabled) {
          showInstallToast(isBotSlot(getSlotState(slot)) ? t('toast.botSeatLocked') : t('toast.swapBlocked'));
          return;
        }
        swapBtn?.click();
        return;
      }
      openSeatSheet(slot);
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

  // Koltuk taşıma: önce oyuncunun sheet'inden KOLTUK DEĞİŞTİR seçilir, sheet
  // kapanır ve hedef çipe dokunulur. (Eski komşu koltukla döndürme modeli
  // mobilde hangi oyuncunun taşındığını görünmez kılıyordu.)
  document.querySelectorAll('.slot-swap-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const slot = parseInt(btn.dataset.slot, 10);
      if (Number.isNaN(slot)) return;
      if (isSeatSwapLocked()) {
        showInstallToast(t('toast.countdownLock'));
        return;
      }

      // KAYNAK seçimi insan ister; HEDEF boş olabilir (boş koltuğa taşıma)
      // — slotRules boş hedefi geçerli sayıyor, ipucu metni de bunu söylüyor.
      const entry = getSlotState(slot);
      if (seatSwapSource === null) {
        if (!entry || isBotSlot(entry)) return;
        seatSwapSource = slot;
        paintSeatSwapUi();
        // Hedef çip görünsün diye sheet kapanır; ipucu satırı hedeflemeyi söyler.
        dismissLobbySheet('lobby-seat');
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

  // Bot eylemi koltuk sheet'inin içinde: boş koltukta "+ BOT", bot çipinde
  // "BOT KALDIR" (slotManager etiketi ve görünürlüğü yönetir).
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

  // Çift-bas onay: ilk dokunuş kurar (kırmızı nabız + toast), 3sn içinde
  // ikinci dokunuş kapatır. Etiket yazmak butonun ikonunu yediği için
  // ikon-only düğümde durum sınıfı + toast kullanılır.
  // ✕ tek dokunuşla çıkar: lobi ekranı kapanır, oda kapanır (kullanıcı
  // kararı — çift onay kaldırılandı; tehlikeli onay pause panelinde kalır).
  btnHostClose?.addEventListener('click', () => {
    hideHostLobbyModal();
    if (typeof onCloseLobby === 'function') {
      onCloseLobby();
    }
  });

  // Oda kodu kopyalama: başlıktaki pil ve sheet içindeki düğme aynı eylem.
  document.getElementById('btn-host-copy-code')?.addEventListener('click', copyRoomCode);
  document.getElementById('btn-invite-copy-code')?.addEventListener('click', copyRoomCode);

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

  btnHostWhatsappShare?.addEventListener('click', () => {
    const code = hostRoomCode?.textContent?.trim() || '';
    const joinUrl = getEffectiveJoinUrl(code, getPlatformMode());
    const text = encodeURIComponent(t('host.share', code, joinUrl));
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
  });
}
