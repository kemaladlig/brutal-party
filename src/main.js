// Local Party Games Suite - Main Application Controller & State Machine
import { initErrorReporter, reportError } from './core/errorReporter.js';
import { TouchManager } from './touchManager.js';
import {
  initEngineRegistry,
  ensureEngine,
  getEngine,
  getControllerMeta,
  getEngineGame,
  forEachEngine,
} from './core/engineRegistry.js';
import { playJoin, toggleAudio, getIsMuted } from './audio.js';
import { partyNetwork } from './network.js';
import { GamepadManager } from './gamepad.js';
import { createStateSync } from './core/stateSync.js';
import {
  HAS_SUPABASE_CONFIG,
  isPublicOrigin,
  getActiveNetwork,
  ensureActiveNetwork,
  disconnectInactiveNetwork,
  getStoredPlayerName,
  storePlayerName,
  cleanPlayerName,
  ensureStoredNick,
  supabaseRelay,
} from './net.js';

import { initToastAndInstall, showInstallToast, showConnectionBanner, hideConnectionBanner } from './ui/toast.js';
import {
  UI_COLORS,
  uiFont,
  CONTROL_MODE,
} from './ui/tokens.js';
import { subscribePreferences } from './core/preferences.js';
import { hostPlayerSlots, updateHostSlot, syncSlotsToEngine, swapEngineSlots, clearRemoteSlot, clearAllRemoteSlots, clearRemoteMove, clearRemoteAim, isBotEkleEnabled, getColorClashIndices, refreshSlotCard, refreshAllHostSlots } from './core/slotManager.js';
import { getAvatarProfile, sanitizeAvatar, pickFreeColor, setSlotAvatar, clearSlotAvatar, loadLocalSeatColors, ensureLocalSeatColorsForTypes, getLocalSeatColors } from './core/customizationManager.js';
import {
  initPauseModal,
  openPauseModal,
  closePauseModal,
  renderPauseSeats,
  getIsPaused,
  setIsPaused,
} from './ui/pauseModal.js';
import { initJoinModal, openJoinModal } from './ui/joinModal.js';
import { initSettingsSheet, openSettingsSheet } from './ui/settings/settingsSheet.js';
import { hydrateIconSlots } from './ui/iconSlots.js';
import {
  mountAppShell,
  openView,
  revealAppShell,
  hideAppShell,
  setShellInputOwner,
  setShellPlatformMode,
  lockLandscape,
  unlockOrientation,
  beginMatchChrome,
  resumeMatchChrome,
} from './ui/appShell.js';
// Görünümler yan etki olarak kayıt olur (src/ui/views/registry.js tek kayıt noktası).
import './ui/views/homeView.js';
import './ui/views/roomView.js';
import './ui/views/lobbyView.js';
import './ui/views/gamesView.js';
import './ui/views/profileView.js';
import { applyI18nToDOM, onLangChange, t, getLang, setLang } from './i18n.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange, fullscreenOfferable } from './ui/fullscreen.js';
import { getTabletopIconSvg, drawTabletopIcon } from './core/tabletopIcons.js';
import { getSlotSwapError } from './core/slotRules.js';
import { showReaction, clearReactions, setReactionFieldAnchor } from './ui/reactionLayer.js';
import { ensureReactionTriggers, setReactionSender } from './ui/reactionPicker.js';
import { getControlDescriptor } from './core/controlDescriptor.js';
import { InputIntentRouter } from './core/inputRouter.js';
import { acquireWakeLock, releaseWakeLock } from './core/wakeLock.js';
import {
  initHostLobby,
  showHostLobbyModal,
  hideHostLobbyModal,
  startHostPingBadge,
  stopHostPingBadge,
  getEffectiveJoinUrl,
  getCurrentHostGameMode,
  setCurrentHostGameMode,
  setHostPlayerButtonState,
  openHostSeatEditor,
} from './ui/hostLobby.js';

// DOM Elements
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("game-canvas"));
// Eski `#menu-overlay` sayfası silindi; menü yüzeyi `src/ui/appShell.js`.
const inGameHud = document.getElementById('in-game-hud');
const btnQuickTvLobby = document.getElementById('btn-quick-tv-lobby');
const btnQuickFullscreen = document.getElementById('btn-quick-fullscreen');
const quickFullscreenIcon = document.getElementById('quick-fullscreen-icon');
const btnQuickReact = document.getElementById('btn-quick-react');
const btnOpenOptions = document.getElementById('btn-open-options');
// LOCAL DOM yüzeyinin kumanda-düzeni çipi: tek yüzen kümenin (`#in-game-hud`)
// parçasıdır; eski `mobile-gamepad-toolbar` bu kümeyle çakışıyordu.
const btnLayoutEditor = document.getElementById('btn-layout-editor');

// Platform / Match Mode: 'LOCAL' | 'TV_CONSOLE' | 'ONLINE'
let platformMode = isPublicOrigin() && HAS_SUPABASE_CONFIG ? 'ONLINE' : 'TV_CONSOLE';
export function updatePlatformMode(newMode) {
  if (!['LOCAL', 'TV_CONSOLE', 'ONLINE'].includes(newMode) || newMode === platformMode) return;
  platformMode = newMode;
  // Mod değişiminde eski ağ singleton'ı temizlenir; yeni mod kendi ağını seçer.
  disconnectInactiveNetwork(platformMode);
  roomFlow.setConnectionWasDown(false);
  hideConnectionBanner();
  setShellPlatformMode(newMode);
  // Platform modu yüzey kararının girdisidir (LOCAL/ONLINE host'u yerel
  // oyuncudur); geçişte motor bayrakları ve DOM yüzeyi yeniden türetilir.
  applyControlSurfacePreference();
  window.dispatchEvent(new CustomEvent('brutal_platform_mode_changed', { detail: { mode: platformMode } }));
}

export function activeNet() {
  return getActiveNetwork(platformMode);
}

// ── Tepkiler (lobi + oyun içi) ────────────────────────────────────────────
// Tek görsel katman, tek gönderici. Yüzeyler yalnız `data-reaction-open`
// işaretler; balonların konumu `data-reaction-anchor` ya da aşağıdaki saha
// çapasıyla bulunur. Oyun içi saha = viewport px (canvas fixed 0,0 tam ekran),
// dolayısıyla motor varlık koordinatı doğrudan ekran koordinatıdır.
setReactionFieldAnchor((slotIndex) => {
  const engine = getActiveGameEngine();
  const entity = engine?.getEntitiesList?.()?.[slotIndex];
  if (!entity || !Number.isFinite(entity.x) || !Number.isFinite(entity.y)) return null;
  // Baş üstü göstergelerin (cephane/can/halka) ÜSTÜNDE kalsın.
  return { x: entity.x, y: entity.y - (entity.radius || 18) - 28 };
});

ensureReactionTriggers();

setReactionSender('host', (key) => {
  const net = activeNet();
  if (!net.isHosting) return false;
  const seat = getCurrentHostSeat();
  const slotIndex = Number.isInteger(seat) ? seat : -1;
  const sent = net.sendHostReaction?.(slotIndex, key) === true;
  // Kendi tepkimiz sunucudan dönmez; yerel geri besleme anlıktır.
  showReaction({ key, slotIndex, color: net.players?.[slotIndex]?.color || null });
  return sent;
});

function updateReactionButtons(hosting) {
  // Tepki gönderimi yalnız odada anlamlı: LOCAL'de alıcı yok.
  btnQuickReact?.classList.toggle('hidden', !hosting);
}

function onNetworkReaction(slotIndex, key) {
  const color = activeNet().players?.[slotIndex]?.color || null;
  showReaction({ key, slotIndex, color });
}


// Engine Instances & Cartridge Registry (code-split: engines load on demand)
const touchManager = new TouchManager(canvas);
initEngineRegistry(canvas);

export function getActiveGameEngine() {
  return getEngineGame(roomFlow.getCurrentMode());
}

// Gamepad Controller Manager
const gamepadOverlay = document.getElementById('gamepad-overlay');

import { createRoomFlow } from './core/roomFlow.js';

// LOCAL one-player mobile surface uses the same declarative controller templates,
// but its input is routed directly to the local authoritative engine.
const localMobileOverlay = document.getElementById('local-mobile-controls');
const localGamepadManager = new GamepadManager(localMobileOverlay, {
  roomCode: null,
  reservedHostSlot: null,
  supportsWorldFrames: false,
  sendInput(data) {
    const engine = getActiveGameEngine();
    if (engine && typeof engine.handleRemoteInput === 'function') {
      const slot = getLocalControlSlot(engine);
      if (slot >= 0) inputRouter.dispatch(slot, data, 'local');
    }
  },
}, { localMode: true });

const gamepadManager = new GamepadManager(gamepadOverlay, partyNetwork);

// Faz 2.4: LOCAL sonuç ekranı butonları yetkili host eylemlerine bağlanır.
// Uzak kumanda bu bağı kullanmaz (host yetkisi dokunulmaz).
localGamepadManager.onLocalResultAction = (action) => {
  if (action === 'replay') {
    try { getEngine(roomFlow.getCurrentMode())?.start?.(); } catch (err) { reportError(err, 'main.onLocalResultAction.start'); }
  } else if (action === 'lobby') {
    try { getEngine(roomFlow.getCurrentMode())?.reset?.(); } catch (err) { reportError(err, 'main.onLocalResultAction.reset'); }
  }
};

const inputRouter = new InputIntentRouter({
  getDescriptor: () => getControlDescriptor(roomFlow.getCurrentMode(), getControllerMeta(roomFlow.getCurrentMode())?.schema),
  getEngine: getActiveGameEngine,
});

// Oda akışı, üstteki kumanda/rotalar HAZIR olduktan SONRA kurulur: `deps`
// kısayolları TDZ'de okunamaz (main.js'i bir daha yüklenemez yapıyordu).
// Değişebilen tek bağımlılık olan platform modu FONKSİYON olarak verilir:
// `createRoomFlow` deps'ı destructuring ile okur, dolayısıyla getter özelliği
// bir kez kopyalanıp donardı (LOCAL'de hiç kontrol yüzeyi doğmuyordu).
export const roomFlow = createRoomFlow({
  activeNet,
  getPlatformMode: () => platformMode,
  updatePlatformMode,
  canvas,
  onNetworkReaction,
  touchManager,
  localGamepadManager,
  gamepadManager,
  inputRouter,
  inGameHud,
  btnQuickTvLobby,
  getActiveGameEngine,
  updateReactionButtons: (h) => updateReactionButtons(h),
  disconnectInactiveNetwork,
  partyNetwork,
});

// Oda akışının dışarı açtığı eylemler. `roomFlow` tek sahibi; buradaki
// yerel adlar yalnızca okunabilirlik için (çekirdek dosyaya `else if`
// dalları yazılmaz).
const {
  getCurrentHostSeat,
  markConnectionRestored,
  toggleHostPlayer,
  applyHostPlayerState,
  handleSeatSwap,
  handleRotateSeats,
  onResumeAfterPause,
  resetActiveGame,
  handleExitToMenu,
  returnHostToLobby,
  handleGameCardClick,
  executeJoin,
} = roomFlow;

function neutralizeTransientInput() {
  touchManager.resetTouches();
  gamepadManager.neutralizeInput();
  localGamepadManager.neutralizeInput();
}

import { setupWindowChrome } from './ui/windowChrome.js';

// Setup Window Chrome (High-DPI Resize, Fullscreen UI, Service Worker, visibility)
const { resizeCanvas, scheduleResize } = setupWindowChrome({
  canvas,
  touchManager,
  forEachEngine,
  neutralizeTransientInput,
  resumeMatchChrome,
  acquireWakeLock,
  getCurrentMode: () => roomFlow.getCurrentMode(),
  activeNet,
  hideConnectionBanner
});

// State Management
// Mode switches are async: game engines load on demand (code-splitting).

// Çift-tap debounce penceresi. Oda geçiş işaretinden (`roomFlow.markTransition`)
// ayrı bir kaygı: bu, aynı düğmeye iki parmağın/seri dokunuşun tek eyleme
// çökmesini engeller.
let lastTapAcceptedAt = 0;
const TAP_DEBOUNCE_MS = 80;

// Responsive Tap Listener
function addTapListener(el, callback) {
  if (!el) return;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let touchHandled = false;

  el.addEventListener('touchstart', (e) => {
    if (e.touches && e.touches.length > 0) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startTime = performance.now();
      touchHandled = false;
    }
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (e.changedTouches && e.changedTouches.length > 0) {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dist = Math.hypot(endX - startX, endY - startY);
      const elapsed = performance.now() - startTime;
      if (dist < 14 && elapsed < 450) {
        touchHandled = true;
        const now = performance.now();
        if (now - lastTapAcceptedAt < TAP_DEBOUNCE_MS) return;
        lastTapAcceptedAt = now;
        e.preventDefault();
        callback(e);
      }
    }
  }, { passive: false });

  el.addEventListener('click', (e) => {
    if (touchHandled) {
      touchHandled = false;
      return;
    }
    const now = performance.now();
    if (now - lastTapAcceptedAt < TAP_DEBOUNCE_MS) return;
    lastTapAcceptedAt = now;
    callback(e);
  });
}


let lastLocalControlSyncAt = 0;
// Görünürlüğün TEK kaynağı overlay'in `hidden` sınıfıdır (`GamepadManager.hide`
// / `initLocal` yazar); ikinci bir boolean bayrak bayat kalıp yüzeyi bir daha
// açılmamak üzere kapatabiliyordu.
const localMobileControlsVisible = () => !localMobileOverlay.classList.contains('hidden');

function getLocalControlSlot(engine = getActiveGameEngine()) {
  if (roomFlow.getHostPlayerActive() && roomFlow.getHostPlayerSlot() !== null) return roomFlow.getHostPlayerSlot();
  const entities = typeof engine?.getEntitiesList === 'function'
    ? engine.getEntitiesList()
    : (engine?.players || engine?.tanks || engine?.paddles || []);
  return entities.findIndex((entity) => entity?.isJoined && entity?.slotType === 'human');
}

function syncLocalMobileControls(now = performance.now()) {
  const engine = getActiveGameEngine();
  const localSlot = getLocalControlSlot(engine);
  // Faz 2.4: MATCH_OVER'da yüzey açık kalır (sonuç ekranı state paketini alır).
  const activeState = engine?.state === 'PLAYING' || engine?.state === 'MATCH_OVER';
  const shouldShow = roomFlow.getLocalControlMode().mode === CONTROL_MODE.DOM
    && roomFlow.getCurrentMode() !== 'MENU'
    && activeState
    && localSlot >= 0
    && !getIsPaused();

  if (shouldShow && (
    !localMobileControlsVisible()
    || localGamepadManager.gameMode !== roomFlow.getCurrentMode()
    || localGamepadManager.playerIndex !== localSlot
  )) {
    const localColors = getLocalSeatColors();
    localGamepadManager.initLocal({
      slotIndex: localSlot,
      name: ensureStoredNick(),
      color: localColors[localSlot] || UI_COLORS.players[localSlot] || '#D84727',
    }, roomFlow.getCurrentMode());
    lastLocalControlSyncAt = 0;
  } else if (!shouldShow && localMobileControlsVisible()) {
    localGamepadManager.hide();
    lastLocalControlSyncAt = 0;
  }
  // Düzen çipi yalnız DOM yüzeyi ayakta iken kümede yer kaplar.
  btnLayoutEditor?.classList.toggle('hidden', !localMobileControlsVisible());

  if (!localMobileControlsVisible() || now - lastLocalControlSyncAt < 125) return;
  const entry = getEngine(roomFlow.getCurrentMode());
  if (!entry || typeof entry.packet !== 'function') return;
  const packet = { ...entry.packet(), gameMode: roomFlow.getCurrentMode(), phase: roomFlow.roomPhase() };
  // Geri sayım tik'i yerel kumandaya da taşınır: perde sayıyı bu alandan okur.
  if (roomFlow.getCountdownTimer()) packet.t = roomFlow.getLastCountdownT();
  // Faz 2.4: LOCAL sonuç ekranı için state + skor tablosu verisi. Bu paket
  // yalnız local kumandaya gider; uzak 8Hz protokolü değiştirilmez.
  const game = entry.game;
  if (game) {
    packet.state = game.state;
    if (Array.isArray(game.players)) {
      packet.names = game.players.map((p) => p?.name || '');
      packet.colors = game.players.map((p) => p?.color || '');
    }
    const mw = game.matchWinner;
    packet.winner = (mw && Number.isInteger(mw.index))
      ? { index: mw.index, name: mw.name || '', color: mw.color || '' }
      : null;
  }
  localGamepadManager.handleStateSync(packet);
  lastLocalControlSyncAt = now;
}

// Ayar değişti: motor bayrakları + yerel DOM kumandası aynı karede tazelenir.
// Tek yol `subscribePreferences` — iki sheet de aynı gerçekten yazar, ikisi de
// aynı abonelikten okur (mükerrer `onControls*` geri çağrısı yok).
function applyControlSurfacePreference() {
  roomFlow.setSeatTapHook();
  syncLocalMobileControls();
}

function applyDevicePreferenceChange(prefs) {
  if (roomFlow.getCurrentMode() !== 'PONG') return;
  gamepadManager.resetPongInvert();
  localGamepadManager.resetPongInvert();
  if (gamepadManager.gameMode === 'PONG') gamepadManager.renderGameController('PONG');
  if (localMobileControlsVisible() && localGamepadManager.gameMode === 'PONG') {
    localGamepadManager.renderGameController('PONG');
  }
}

let lastPongPrefs = null;
subscribePreferences((prefs) => {
  applyControlSurfacePreference();
  const pongChanged = !lastPongPrefs
    || lastPongPrefs.pongInvert !== prefs.pongInvert
    || lastPongPrefs.pongSensitivity !== prefs.pongSensitivity;
  lastPongPrefs = { pongInvert: prefs.pongInvert, pongSensitivity: prefs.pongSensitivity };
  if (pongChanged) applyDevicePreferenceChange(prefs);
});

// Initialise UI Submodules
ensureStoredNick();
initToastAndInstall();
// Tarayıcı çevrimdışı/çevrimiçi geçişleri (uçak modu, Wi-Fi kopuşu): kumanda
// tarafında anlık bant bildirimi. Relay mesajları aynı banda yazar.
window.addEventListener('offline', () => {
  roomFlow.setConnectionWasDown(true);
  showConnectionBanner('offline', t('net.offline'));
});
window.addEventListener('online', () => {
  markConnectionRestored(t('net.onlineBack'), true);
});
initJoinModal({ onExecuteJoin: executeJoin });
// Tercih yazımları `subscribePreferences` aboneliğinden akıyor; sheet'ler
// yalnızca `setPreference` çağırır (etki uygulamasının ikinci yolu yok).
// AYARLARIN TEK YÜZEYİ: ana menü, lobi ve duraklatma bu sheet'i açar.
initSettingsSheet({
  onBotsToggled: (enabled) => {
    // Kapatılınca mevcut botlar temizlenir; açılınca kartlar butonları gösterir
    if (!enabled) {
      for (let i = 0; i < 4; i++) {
        if (hostPlayerSlots[i]?.kind === 'bot') {
          activeNet().clearSlotBot?.(i);
          updateHostSlot(i, false);
        }
      }
      const engine = getActiveGameEngine();
      if (engine) syncSlotsToEngine(engine, roomFlow.getCurrentMode(), activeNet().isHosting);
    }
    refreshAllHostSlots();
  },
  openControllerLayout: openControllerLayoutFromPause,
  canOpenControllerLayout: isControllerLayoutAvailable,
});
applyI18nToDOM();
// Dil değişiminde TV lobi kartları anında yeniden çizilir (BOŞ/HAZIR etiketleri).
onLangChange(() => {
  try { refreshAllHostSlots(); } catch (err) { reportError(err, 'main.onLangChange.refreshAllHostSlots'); }
  setHostPlayerButtonState(roomFlow.getHostPlayerActive(), platformMode);
});
// Ayar düğmesi artık shell üst şeridinde: `mountAppShell({ actions.openSettings })`.
initHostLobby({
  getActiveNet: () => activeNet(),
  getPlatformMode: () => platformMode,
  onStageGame: (mode) => {
    roomFlow.enterStaging(mode);
  },
  onToggleHostPlayer: () => toggleHostPlayer(),
  onCloseLobby: () => {
    roomFlow.exitStagingToLobby();
    for (let i = 0; i < 4; i++) {
      clearSlotAvatar(i);
      updateHostSlot(i, false);
    }
    applyHostPlayerState({ active: false });
    hideConnectionBanner();
    roomFlow.setConnectionWasDown(false);
    activeNet().disconnect();
    roomFlow.setSeatTapHook();
    roomFlow.setGameMode('MENU');
  },
  onSwapSlots: (slotA, slotB) => roomFlow.handleSeatSwap(slotA, slotB),
  getSlot: (slotIndex) => hostPlayerSlots[slotIndex],
  isSeatSwapLocked: () => roomFlow.getSeatsLocked(),
  onToggleBotSlot: (slotIndex) => {
    roomFlow.handleLobbySeatTap(slotIndex);
  },
  onSetSlotColor: (slotIndex, hex) => {
    const entry = hostPlayerSlots[slotIndex];
    if (!entry || entry.kind === 'bot' || entry.kind === 'bot_god') return;
    entry.displayColor = hex;
    try {
      activeNet().setSlotColor?.(slotIndex, hex);
    } catch {}
    refreshSlotCard(slotIndex);
    roomFlow.refreshStagingBar();
    const engine = getActiveGameEngine();
    if (engine) syncSlotsToEngine(engine, roomFlow.getCurrentMode(), activeNet().isHosting);
    renderPauseSeats(handleSeatSwap);
  },
  onRandomizeSlotColor: (slotIndex) => {
    const entry = hostPlayerSlots[slotIndex];
    if (!entry || entry.kind === 'bot' || entry.kind === 'bot_god') return;
    const taken = hostPlayerSlots
      .filter((p, i) => p && p.kind !== 'bot' && p.kind !== 'bot_god' && i !== slotIndex)
      .map((p) => p.displayColor || p.avatar?.color || p.color)
      .filter(Boolean);
    const hex = pickFreeColor(taken);
    entry.displayColor = hex;
    try {
      activeNet().setSlotColor?.(slotIndex, hex);
    } catch {}
    refreshSlotCard(slotIndex);
    roomFlow.refreshStagingBar();
    const engine = getActiveGameEngine();
    if (engine) syncSlotsToEngine(engine, roomFlow.getCurrentMode(), activeNet().isHosting);
    showInstallToast(t('toast.seatColor', slotIndex + 1));
  },
});

// Staging bar (BAŞLAT #2 + lobiye dönüş)
document.getElementById('btn-staging-edit-seats')?.addEventListener('click', () => {
  openHostSeatEditor();
});
document.getElementById('btn-staging-launch')?.addEventListener('click', () => {
  roomFlow.runCountdown();
});
document.getElementById('btn-staging-lobby')?.addEventListener('click', () => {
  roomFlow.returnHostToLobby();
});
initPauseModal({
  getCurrentMode: () => roomFlow.getCurrentMode(),
  getIsHosting: () => activeNet().isHosting,
  onSwapSeats: handleSeatSwap,
  onRotateSeats: handleRotateSeats,
  onResume: onResumeAfterPause,
  onReset: resetActiveGame,
  onExitMenu: handleExitToMenu,
  onTvLobby: returnHostToLobby,
});

// Oyun seçimi artık shell'in `games` görünümünde: kartlar orada üretiliyor ve
// `preloadEngine` tetiklemesi `gamesView.js` içinde. Eski menü sayfasının kart
// döngüsü, picker modalı, showcase carousel'ı ve hero banner dropzone'ı silindi.
addTapListener(btnQuickTvLobby, returnHostToLobby);

// Maç sonu kartının ikinci eylemi motorun değil kabuğun işidir: motor yalnız
// niyet bildirir, oda/koltuk/relay kararını `returnHostToLobby` verir.
window.addEventListener('brutal_return_to_lobby', () => roomFlow.returnHostToLobby());



// Yerinde düzenlenecek bir kumanda var mı: ya bu cihazda DOM mobil kontrolleri
// (bir koltuğa bağlı) ya da bağlı bir telefon kumandası. Ayar sheet'i bu
// yükleme göre satırı çizer ya da çizmez.
function isControllerLayoutAvailable() {
  const engine = getActiveGameEngine();
  const localLayoutAvailable = roomFlow.getLocalControlMode().mode === CONTROL_MODE.DOM
    && getLocalControlSlot(engine) >= 0;
  const remoteLayoutAvailable = !gamepadOverlay.classList.contains('hidden')
    && gamepadManager.gameMode !== 'LOBBY';
  return localLayoutAvailable || remoteLayoutAvailable;
}

function openControllerLayoutFromPause() {
  // Ayar sheet'i kendi kabuğunu kapatır; duraklatma altta kalırdı.
  if (getIsPaused()) closePauseModal();
  if (roomFlow.getLocalControlMode().mode === CONTROL_MODE.DOM) {
    syncLocalMobileControls();
    if (localGamepadManager.openControllerLayoutEditor()) return;
  }
  if (gamepadManager.openControllerLayoutEditor()) return;
  showInstallToast(t('controllerLayout.unavailable'));
}

addTapListener(btnOpenOptions, () => {
  openPauseModal({
    currentMode: roomFlow.getCurrentMode(),
    isHosting: activeNet().isHosting,
    onSwapCallback: handleSeatSwap,
  });
});

addTapListener(btnLayoutEditor, () => {
  openControllerLayoutFromPause();
});

// Check URL query parameters for automatic controller join (QR scan or link)
const urlParams = new URLSearchParams(window.location.search);
const autoJoinCode = urlParams.get('join');
if (autoJoinCode) {
  const requestedJoinMode = urlParams.get('mode');
  const autoJoinMode = requestedJoinMode === 'tv' || requestedJoinMode === 'TV_CONSOLE'
    ? 'TV_CONSOLE'
    : (requestedJoinMode === 'online' || requestedJoinMode === 'ONLINE' || isPublicOrigin()
      ? 'ONLINE'
      : 'TV_CONSOLE');
  updatePlatformMode(autoJoinMode);
  openJoinModal(autoJoinCode, autoJoinMode);
  roomFlow.executeJoin(autoJoinCode, ensureStoredNick(), autoJoinMode);
}





// Warning for public site missing Supabase config
if (isPublicOrigin() && !HAS_SUPABASE_CONFIG) {
  showInstallToast(t('toast.noOnlineEnv'));
}

// Host → kumanda durum yayını (8 Hz + dirty-check) ve ONLINE dünya kareleri
// (30 Hz) core/stateSync.js'te; oda akışı (roomPhase/sayaç) burada kalır.
const stateSync = createStateSync({
  getMode: () => roomFlow.getCurrentMode(),
  getNet: () => activeNet(),
  getRoomPhase: () => roomFlow.roomPhase(),
  getCountdown: () => (roomFlow.getCountdownTimer() ? { t: roomFlow.getLastCountdownT() } : null),
});
const broadcastGameStateIfNeeded = (now) => stateSync.broadcastGameStateIfNeeded(now);
const broadcastWorldStateIfNeeded = (now) => stateSync.broadcastWorldStateIfNeeded(now);

// Duraklatma göstergesi: donmuş karenin üstünde canvas-içi rozet
// (DOM modal zaten açık; TV'de "oyun mu bozuldu" belirsizliğini giderir).
function renderPauseOverlay(ctx) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const label = t('pause.badge');
  const iconSize = 22;
  const iconGap = 10;
  const pillH = 56;

  ctx.save();
  ctx.font = uiFont('button');
  const textW = ctx.measureText(label).width;
  const pillW = Math.ceil(textW + iconSize + iconGap + 48);
  const pillX = w / 2 - pillW / 2;
  const pillY = h / 2 - pillH / 2;

  ctx.fillStyle = 'rgba(26, 26, 26, 0.45)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX + 4, pillY + 4, pillW, pillH);
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = UI_COLORS.paperWarm;
  ctx.lineWidth = 3;
  ctx.strokeRect(pillX, pillY, pillW, pillH);

  const groupX = w / 2 - (iconSize + iconGap + textW) / 2;
  drawTabletopIcon(ctx, 'pause', groupX + iconSize / 2, pillY + pillH / 2, iconSize, { color: UI_COLORS.white });
  ctx.fillStyle = UI_COLORS.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, groupX + iconSize + iconGap, pillY + pillH / 2);
  ctx.restore();
}

// Master Animation Loop (requestAnimationFrame) - Safe Execution Sandbox & Error Boundary
const ctx2d = canvas.getContext('2d');
let consecutiveEngineErrors = 0;
let lastEngineError = null;

function renderEngineCrashOverlay(ctx, error) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  ctx.save();
  ctx.fillStyle = 'rgba(26, 26, 26, 0.88)';
  ctx.fillRect(0, 0, w, h);

  const cardW = Math.min(480, w * 0.9);
  const cardH = 172;
  const cx = w / 2;
  const cy = h / 2;

  ctx.fillStyle = '#D84727';
  ctx.fillRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.strokeRect(cx - cardW / 2, cy - cardH / 2, cardW, cardH);

  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 16px "Space Grotesk", sans-serif';
  ctx.fillText(t('crash.title'), cx, cy - 44);

  ctx.font = '800 12px "JetBrains Mono", monospace';
  ctx.fillText(String(error?.message || t('crash.default')).slice(0, 50), cx, cy - 14);

  // TODO(teşhis): HEIST motor hatasının kök satırı. Kullanıcı bu satırı
  // okuduktan sonra kalıcı düzeltme yapılacak ve burası kaldırılacak.
  const frame = String(error?.stack || '')
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.startsWith('at '));
  ctx.font = '700 10px "JetBrains Mono", monospace';
  ctx.fillText(frame ? frame.replace(/^at\s+/, '').slice(0, 62) : t('crash.default'), cx, cy + 8);

  ctx.font = '900 13px "Space Grotesk", sans-serif';
  ctx.fillText(t('crash.action'), cx, cy + 48);
  ctx.restore();
}

// Perf: menüde oyun canvas'ı boş — 60 Hz rAF GPU'yu gereksiz uyandırır.
// Menüde 4 fps yeterli (animasyon DOM tarafında), oyuna geçince tam hız.
/** @type {ReturnType<typeof setTimeout> | 0} */
let _menuIdleTimer = 0;

function loop(timestamp) {
  // Menu idle guard: canvas oyun dışı, DOM shell aktif.
  if (roomFlow.getCurrentMode() === 'MENU' && !getEngine(roomFlow.getCurrentMode())) {
    ctx2d.save();
    ctx2d.fillStyle = UI_COLORS.bg || '#14101F';
    ctx2d.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx2d.restore();
    // Hosting sırasında broadcast yine çalışmalı (lobi paketi)
    try { broadcastGameStateIfNeeded(timestamp); } catch (err) { reportError(err, 'main.loop.menuBroadcast'); }
    // 4 fps idle — GPU neredeyse hiç uyanmaz
    if (!_menuIdleTimer) {
      _menuIdleTimer = setTimeout(() => { _menuIdleTimer = 0; requestAnimationFrame(loop); }, 250);
    }
    return;
  }

  syncLocalMobileControls(timestamp);

  try {
    broadcastGameStateIfNeeded(timestamp);
  } catch (err) {
    reportError(err, 'main.loop.broadcast', { warnOnly: true });
  }

  const isPaused = getIsPaused();
  const loopEntry = getEngine(roomFlow.getCurrentMode());

  if (loopEntry) {
    try {
      if (!isPaused && consecutiveEngineErrors < 5) {
        loopEntry.game.update(timestamp);
      }
      broadcastWorldStateIfNeeded(timestamp);
      loopEntry.game.render();
      consecutiveEngineErrors = 0;
    } catch (err) {
      consecutiveEngineErrors++;
      lastEngineError = err;
      reportError(err, `main.loop.engine:${roomFlow.getCurrentMode()}`);
      if (consecutiveEngineErrors >= 5) {
        renderEngineCrashOverlay(ctx2d, lastEngineError);
      }
    }

    if (isPaused) {
      try {
        renderPauseOverlay(ctx2d);
      } catch (err) { reportError(err, 'main.loop.renderPauseOverlay'); }
    }
  }

  if (roomFlow.getCurrentMode() !== 'MENU') {
    try {
      touchManager.renderOverlay(ctx2d);
    } catch (err) {
      reportError(err, 'main.loop.touchOverlay', { warnOnly: true });
    }
  }

  requestAnimationFrame(loop);
}

// Initial Setup
resizeCanvas();
setShellPlatformMode(platformMode);
hydrateIconSlots(document);
hydrateIconSlots(document, 'lobbyIcon', { size: 18, strokeWidth: 2.3 });
mountAppShell({
  platformMode,
  actions: {
    onGameSelect: (mode) => handleGameCardClick(mode),
    // Oda ekranından gelen adım: odayı aç VE shell'i lobi ekranında göster.
    openHostLobby: () => {
      revealAppShell();
      roomFlow.openHostLobby(getCurrentHostGameMode());
    },
    openJoin: (code, mode) => openJoinModal(code || '', mode || 'TV_CONSOLE'),
    setPlatformMode: (mode) => updatePlatformMode(mode),
    getPlatformMode: () => platformMode,
    openSettings: () => openSettingsSheet(),
    onLobbyShown: () => refreshAllHostSlots(),
    // Lobi ekranından ayrılırken oda da kapanır: geri düğmesi "odadan çık"
    // demektir, "oda ekranına geri dön" değil (bkz. lobbyView `backToRoot`).
    onLobbyExit: () => {
      if (!activeNet().isHosting) return;
      for (let i = 0; i < 4; i++) {
        clearSlotAvatar(i);
        updateHostSlot(i, false);
      }
      hideConnectionBanner();
      roomFlow.setConnectionWasDown(false);
      activeNet().disconnect();
      roomFlow.setGameMode('MENU');
    },
  },
});
roomFlow.setGameMode('MENU');
refreshAllHostSlots();
requestAnimationFrame(loop);
