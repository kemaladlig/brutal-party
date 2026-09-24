// Local Party Games Suite - Main Application Controller & State Machine
import { TouchManager } from './touchManager.js';
import {
  GAME_ORDER,
  initEngineRegistry,
  ensureEngine,
  preloadEngine,
  isEngineLoaded,
  getEngine,
  getControllerMeta,
  getEngineGame,
  forEachEngine,
} from './core/engineRegistry.js';
import { playJoin, toggleAudio, getIsMuted } from './audio.js';
import { partyNetwork } from './network.js';
import { GamepadManager } from './gamepad.js';
import {
  HAS_SUPABASE_CONFIG,
  isPublicOrigin,
  getActiveNetwork,
  disconnectInactiveNetwork,
  getStoredPlayerName,
  storePlayerName,
  cleanPlayerName,
  ensureStoredNick,
  supabaseRelay,
} from './net.js';

import { initToastAndInstall, showInstallToast, showConnectionBanner, hideConnectionBanner } from './ui/toast.js';
import { UI_COLORS, uiFont } from './ui/tokens.js';
import { openCustomizeModal, initMenuAvatarCard } from './ui/customizeModal.js';
import { hostPlayerSlots, updateHostSlot, syncSlotsToEngine, swapEngineSlots, clearRemoteSlot, clearAllRemoteSlots, isBotEkleEnabled, getColorClashIndices, refreshAllHostSlots } from './core/slotManager.js';
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
import { initSettingsModal, openSettingsModal } from './ui/settingsModal.js';
import { initMainMenu } from './ui/menuManager.js';
import { applyI18nToDOM, onLangChange, t, getLang, setLang } from './i18n.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from './ui/fullscreen.js';
import {
  initHostLobby,
  showHostLobbyModal,
  hideHostLobbyModal,
  startHostPingBadge,
  stopHostPingBadge,
  getEffectiveJoinUrl,
  getCurrentHostGameMode,
  setCurrentHostGameMode,
} from './ui/hostLobby.js';

// DOM Elements
const canvas = document.getElementById('game-canvas');
const menuOverlay = document.getElementById('menu-overlay');
const inGameHud = document.getElementById('in-game-hud');
const btnQuickTvLobby = document.getElementById('btn-quick-tv-lobby');
const btnQuickFullscreen = document.getElementById('btn-quick-fullscreen');
const quickFullscreenIcon = document.getElementById('quick-fullscreen-icon');
const btnOpenOptions = document.getElementById('btn-open-options');
const btnHeroCreateRoom = document.getElementById('btn-hero-create-room');

// Platform / Match Mode: 'LOCAL' | 'TV_CONSOLE' | 'ONLINE'
let platformMode = isPublicOrigin() && HAS_SUPABASE_CONFIG ? 'ONLINE' : 'TV_CONSOLE';
export function updatePlatformMode(newMode) {
  platformMode = newMode;
}

export function activeNet() {
  return getActiveNetwork(platformMode);
}

// State Machine: 'MENU' + GAME_ORDER ('PONG' | 'TANKS' | 'CURVE' | 'BOMB' | 'HEIST' | 'ARCHER')
let currentMode = 'MENU';
let lastTransitionTime = 0;

export function markTransition() {
  lastTransitionTime = performance.now();
}

// Engine Instances & Cartridge Registry (code-split: engines load on demand)
const touchManager = new TouchManager(canvas);
initEngineRegistry(canvas);

export function getActiveGameEngine() {
  return getEngineGame(currentMode);
}

// Gamepad Controller Manager
const gamepadOverlay = document.getElementById('gamepad-overlay');
const gamepadManager = new GamepadManager(gamepadOverlay, partyNetwork);

// High-DPI & Responsive 1:1 Canvas Resizing
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = window.innerWidth;
  const height = window.innerHeight;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  touchManager.setDimensions(width, height, dpr);

  forEachEngine((mode, entry) => entry.game.resize(width, height));
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 150);
});

// State Management
// Mode switches are async: game engines load on demand (code-splitting).
// A token guard drops stale switches (user taps A then quickly B).
let modeSwitchToken = 0;
export async function setGameMode(mode) {
  markTransition();
  modeSwitchToken += 1;
  const token = modeSwitchToken;
  // Error boundary kurtarma: mod değişiminde hata sayacı sıfırlanır, yoksa
  // çöken motordan dönülünce yeni motorun update() döngüsü kilitli kalırdı.
  consecutiveEngineErrors = 0;
  lastEngineError = null;
  setIsPaused(false);
  closePauseModal();
  touchManager.resetTouches();

  if (mode === 'MENU') {
    currentMode = mode;
    // Klavye sahipliği: yalnızca aktif motor dinler, diğerlerinin basılı tuş
    // haritası temizlenir (mod değişiminde takılı tuş kalmasın)
    forEachEngine((engineMode, entry) => {
      entry.game.isLocalInputActive = engineMode === mode;
      if (engineMode !== mode && entry.game.keys) entry.game.keys = {};
    });

    if (btnQuickTvLobby) {
      btnQuickTvLobby.classList.add('hidden');
    }

    menuOverlay.classList.remove('hidden');
    inGameHud.classList.add('hidden');
    touchManager.setHandler(null);
    return;
  }

  // Oyun yolu: motoru istenirse yükle (dinamik import + kurulum).
  // Yükleme bildirimi sadece ilk indirmede gösterilir (önbellekteyse anlıktır).
  if (!isEngineLoaded(mode)) {
    showInstallToast(t('toast.loading', getControllerMeta(mode)?.lobbyTitle || mode));
  }
  let entry = null;
  try {
    entry = await ensureEngine(mode);
  } catch (err) {
    console.error(`[Engine Load: ${mode}]`, err);
    showInstallToast(t('toast.loadFail'));
    return;
  }
  if (token !== modeSwitchToken || !entry) return;
  currentMode = mode;

  // Klavye sahipliği: yalnızca aktif motor dinler, diğerlerinin basılı tuş
  // haritası temizlenir (mod değişiminde takılı tuş kalmasın)
  forEachEngine((engineMode, loaded) => {
    loaded.game.isLocalInputActive = engineMode === mode;
    if (engineMode !== mode && loaded.game.keys) loaded.game.keys = {};
  });

  const now = performance.now();

  if (btnQuickTvLobby) {
    btnQuickTvLobby.classList.toggle('hidden', !activeNet().isHosting);
  }

  menuOverlay.classList.add('hidden');
  inGameHud.classList.remove('hidden');
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    try { document.activeElement.blur(); } catch {}
  }
  try { canvas.focus(); } catch {}
  touchManager.setHandler(entry.game);
  // LOCAL: kayıtlı koltuk renkleri reset ÖNCESİ deftere yüklenir (init renkleri
  // doğru kurulsun), reset sonrası varsayılan insan koltuklarına boş renk atanır.
  if (!activeNet().isHosting) {
    loadLocalSeatColors();
  }
  entry.reset();
  if (!activeNet().isHosting) {
    ensureLocalSeatColorsForTypes(entry.game.slotTypes);
    // Reset'te kurulan oyuncu renklerini LOCAL koltuk renkleriyle eşitle
    const locals = getLocalSeatColors();
    for (let i = 0; i < 4; i++) {
      if (locals[i] && typeof entry.game.applyLocalSeatColor === 'function') {
        entry.game.applyLocalSeatColor(i, locals[i]);
      }
    }
  }
  entry.onEnter(now);
  entry.game.resize(window.innerWidth, window.innerHeight);
  syncSlotsToEngine(entry.game, currentMode, activeNet().isHosting);
  setSeatTapHook();
}

function resetActiveGame() {
  const now = performance.now();
  getEngine(currentMode)?.reset();
  touchManager.resetTouches();
}

function onResumeAfterPause() {
  const now = performance.now();
  getEngine(currentMode)?.onResume(now);
  touchManager.resetTouches();
}

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
        if (now - lastTransitionTime < 80) return;
        lastTransitionTime = now;
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
    if (now - lastTransitionTime < 80) return;
    lastTransitionTime = now;
    callback(e);
  });
}

// Host Room Creation (TV_CONSOLE TV host / ONLINE P1 phone host)
async function openHostLobby(gameMode = 'PONG') {
  setCurrentHostGameMode(gameMode);
  let hostAvatar = null;
  try { hostAvatar = getAvatarProfile(); } catch { hostAvatar = null; }
  const hostIdentity = { name: ensureStoredNick(), avatar: hostAvatar };
  try {
    await activeNet().hostRoom(gameMode, {
      onRoomCreated: (roomCode) => {
        const joinUrl = getEffectiveJoinUrl(roomCode, platformMode);
        showHostLobbyModal(roomCode, joinUrl);
        startHostPingBadge(() => activeNet().ping, platformMode);
        setSeatTapHook();
        // LOCAL koltuk renkleri relay odasına sızmasın (gelen avatarlar yazar)
        for (let i = 0; i < 4; i++) {
          clearSlotAvatar(i);
          updateHostSlot(i, false);
        }
        // ONLINE odada host cihaz aynı zamanda P1 oyuncusudur.
        const onlineHostPlayer = platformMode === 'ONLINE' ? activeNet().players?.[0] : null;
        if (onlineHostPlayer) {
          setSlotAvatar(0, onlineHostPlayer.avatar);
          updateHostSlot(
            0,
            true,
            onlineHostPlayer.name,
            true,
            'human',
            onlineHostPlayer.avatar,
            onlineHostPlayer.color
          );
        }
        refreshHostSlotCards();
      },
      onPlayerJoined: (msg) => {
        playJoin();
        // Cihaz-başı avatar: relay'den gelir; yoksa/geçersizse boş rastgele renk.
        let av = null;
        try {
          av = msg.avatar ? sanitizeAvatar(msg.avatar, { keepColor: true }) : null;
        } catch { av = null; }
        if (!av) {
          const taken = hostPlayerSlots
            .filter((p, i) => p && p.kind !== 'bot' && p.kind !== 'bot_god' && i !== msg.slotIndex)
            .map((p) => p.displayColor || p.avatar?.color || p.color)
            .filter(Boolean);
          av = sanitizeAvatar({ color: pickFreeColor(taken) }, { keepColor: true });
        }
        setSlotAvatar(msg.slotIndex, av);
        updateHostSlot(msg.slotIndex, true, msg.name, false, 'human', av, msg.color || av.color);
        refreshStagingBar();
        // Staging/sayaç sırasında katılan geç kalanı mevcut faza sok
        // (STAGING_STARTED geçmişte kaldı, yoksa bekleme ekranında takılır).
        // Sayaçtaysa STAGING + güncel tik + koltuklar yeniden basılır —
        // katılan odaya girdiği için yayın ona da ulaşır.
        if (stagingMode && !countdownTimer) {
          activeNet().startStaging(stagingMode);
        } else if (stagingMode && countdownTimer) {
          activeNet().startStaging(stagingMode);
          activeNet().broadcastCountdown(lastCountdownT);
        }
        const engine = getActiveGameEngine();
        if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
        showInstallToast(t('toast.ctrlJoined', msg.name));
      },
      onPlayerLeft: (msg) => {
        // Önce latch'i nötrle (hayalet sürüş/dönüş kalmasın), sonra koltuğu boşa çıkar
        const engineLeft = getActiveGameEngine();
        if (engineLeft) clearRemoteSlot(engineLeft, currentMode, msg.slotIndex);
        delete lastRemoteInputAt[msg.slotIndex];
        delete lastAvatarAt[msg.slotIndex];
        clearSlotAvatar(msg.slotIndex);
        updateHostSlot(msg.slotIndex, false);
        refreshStagingBar();
        const engine = getActiveGameEngine();
        if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
        showInstallToast(t('toast.ctrlLeft', msg.name));
      },
      onPlayerUpdated: (msg) => {
        const slot = hostPlayerSlots[msg.slotIndex];
        if (slot && slot.kind !== 'bot') {
          slot.name = msg.name;
          if (msg.avatar) {
            try {
              const clean = sanitizeAvatar(msg.avatar, { keepColor: true });
              slot.avatar = clean;
              slot.displayColor = msg.color || clean.color;
              setSlotAvatar(msg.slotIndex, clean);
            } catch {}
          }
          updateHostSlot(msg.slotIndex, true, msg.name, slot.isReady, slot.kind);
          refreshStagingBar();
          const engine = getActiveGameEngine();
          if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
          renderPauseSeats(handleSeatSwap);
        }
      },
      onPlayerReadyStatus: (slotIndex, isReady) => {
        // Sayaç anında gelen READY yeni turun sayacına sızmasın
        if (seatsLocked) return;
        if (hostPlayerSlots[slotIndex]) {
          updateHostSlot(slotIndex, true, hostPlayerSlots[slotIndex].name, isReady, hostPlayerSlots[slotIndex].kind);
          refreshStagingBar();
        }
      },
      onSlotsSwapped: (slotA, slotB) => {
        const temp = hostPlayerSlots[slotA];
        hostPlayerSlots[slotA] = hostPlayerSlots[slotB];
        hostPlayerSlots[slotB] = temp;
        // Avatar kayıt defteri koltuk-bazlıdır: takas sonrası iki koltuğu yeniden yaz
        setSlotAvatar(slotA, hostPlayerSlots[slotA]?.avatar || null);
        setSlotAvatar(slotB, hostPlayerSlots[slotB]?.avatar || null);
        if (hostPlayerSlots[slotA]) updateHostSlot(slotA, true, hostPlayerSlots[slotA].name, hostPlayerSlots[slotA].isReady, hostPlayerSlots[slotA].kind);
        else updateHostSlot(slotA, false);
        if (hostPlayerSlots[slotB]) updateHostSlot(slotB, true, hostPlayerSlots[slotB].name, hostPlayerSlots[slotB].isReady, hostPlayerSlots[slotB].kind);
        else updateHostSlot(slotB, false);
        refreshStagingBar();

        const engine = getActiveGameEngine();
        if (engine) {
          swapEngineSlots(engine, currentMode, activeNet().isHosting, slotA, slotB);
        }

        showInstallToast(t('toast.slotsSwapped', slotA + 1, slotB + 1));
        renderPauseSeats(handleSeatSwap);
      },
      onPlayerInput: (slotIndex, data) => {
        // Kumanda kendi karakterini güncelledi: avatar + display tazelenir,
        // host override sıfırlanır (çakışırsa lobi uyarısı yeniden doğar).
        if (data.action === 'AVATAR_UPDATE' && data.avatar) {
          const slot = hostPlayerSlots[slotIndex];
          if (slot && slot.kind !== 'bot' && slot.kind !== 'bot_god') {
            const nowAv = performance.now();
            if (!lastAvatarAt[slotIndex] || nowAv - lastAvatarAt[slotIndex] > 1000) {
              lastAvatarAt[slotIndex] = nowAv;
              try {
                const clean = sanitizeAvatar(data.avatar, { keepColor: true });
                slot.avatar = clean;
                slot.displayColor = clean.color;
                setSlotAvatar(slotIndex, clean);
                updateHostSlot(slotIndex, true, slot.name, slot.isReady, slot.kind, clean, clean.color);
                refreshStagingBar();
                const engineAv = getActiveGameEngine();
                if (engineAv) syncSlotsToEngine(engineAv, currentMode, activeNet().isHosting);
                renderPauseSeats(handleSeatSwap);
              } catch {}
            }
          }
          return;
        }
        if (data.action === 'SET_NAME' && data.name) {
          const slot = hostPlayerSlots[slotIndex];
          if (slot) {
            slot.name = cleanPlayerName(data.name);
            updateHostSlot(slotIndex, true, slot.name, slot.isReady, slot.kind);
            refreshStagingBar();
            activeNet().setPlayerName?.(slotIndex, slot.name);
            const engine = getActiveGameEngine();
            if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
            renderPauseSeats(handleSeatSwap);
          }
          return;
        }
        if (data.action === 'SWITCH_SLOT' && typeof data.targetSlot === 'number') {
          if (seatsLocked) return; // sayaç sırasında koltuklar kilitli
          const t = data.targetSlot;
          // Koltuk gaspı kapısı: aralık dışı, bot hedef/kaynak reddedilir
          // (istemcideki guard atlatılsa bile host son sözü söyler)
          if (!Number.isInteger(t) || t < 0 || t > 3) return;
          if (activeNet().players?.[t]?.isHost) return;
          if (hostPlayerSlots[t]?.kind === 'bot') return;
          if (hostPlayerSlots[slotIndex]?.kind === 'bot') return;
          activeNet().swapSlots(slotIndex, t);
          return;
        }
        if (typeof slotIndex !== 'number' || slotIndex < 0 || slotIndex > 3) return;
        // Analog sessizlik süpürücüsü için son-girdi damgası (sürekli akış takibi)
        if (data.action === 'JOYSTICK_MOVE' || data.action === 'PADDLE_MOVE'
          || data.action === 'TANK_DRIVE' || data.action === 'CURVE_STEER' || data.action === 'SNAKE_STEER') {
          lastRemoteInputAt[slotIndex] = performance.now();
        }
        const engine = getActiveGameEngine();
        if (engine && typeof engine.handleRemoteInput === 'function') {
          engine.handleRemoteInput(slotIndex, data);
        }
      },
      onPlayerReaction: (slotIndex, emoji) => {
        showInstallToast(`P${slotIndex + 1}: ${emoji}`);
      },
    }, hostIdentity);
  } catch (err) {
    console.error('[Host] Oda açılamadı:', err);
    if (activeNet() === supabaseRelay) {
      console.warn('[Host] Supabase subscription failed, falling back to local WebSocket...');
      showInstallToast(t('toast.supabaseFallback'));
      updatePlatformMode('TV_CONSOLE');
      setTimeout(() => {
        openHostLobby(gameMode);
      }, 500);
    } else {
      const detail = err?.message ? ` Sebep: ${err.message}` : '';
      showInstallToast(t('toast.hostOpenFail', detail));
    }
  }
}

// Controller Join Room Execution
// Bağlantı vs uygulama hatası yönlendirici: reconnect/kopuş mesajları kalıcı
// banda, diğer hatalar (oda bulunamadı, kod çakışması vb.) kaybolan toast'a.
// Kopuş sonrası ilk oyun durumu geldiğinde online flash'i için bayrak tutulur.
let connectionWasDown = false;
function routeConnectionMessage(err) {
  let msg = String(err?.message || err || '');
  // Sunucudan gelen bilinen hata kodları istemci diline çevrilir (kablo sabit).
  if (/ODA DOLU|ROOM FULL/.test(msg)) msg = t('net.roomFull');
  if (/yeniden bağlanılıyor|reconnecting/i.test(msg)) {
    connectionWasDown = true;
    showConnectionBanner('reconnecting', msg);
  } else if (/BAĞLANTI KOPTU|CONNECTION LOST/i.test(msg)) {
    connectionWasDown = true;
    showConnectionBanner('offline', msg);
  } else {
    showInstallToast(`❌ ${msg}`);
  }
}

async function executeJoin(rawCode, rawName) {
  const code = (rawCode || '').trim().toUpperCase();
  const name = (rawName || '').trim().toUpperCase() || ensureStoredNick();

  if (!code || code.length < 3) {
    showInstallToast(t('toast.enterCode'));
    return;
  }

  storePlayerName(name);
  showInstallToast(t('toast.joining', code));

  disconnectInactiveNetwork(platformMode);
  const net = activeNet();
  gamepadManager.network = net;

  try {
    let joinAvatar = null;
    try { joinAvatar = getAvatarProfile(); } catch { joinAvatar = null; }
    await net.joinRoom(code, name, {
      onJoinedSuccess: (msg) => {
        menuOverlay?.classList.add('hidden');
        gamepadManager.init(msg, 'LOBBY');
        hideConnectionBanner();
        showInstallToast(t('toast.joined', msg.roomCode));
      },
      onGameModeChanged: (newMode) => {
        gamepadManager.selectedHostGame = newMode;
        if (gamepadManager.gameMode === 'LOBBY') {
          gamepadManager.renderGameController('LOBBY');
        }
        showInstallToast(t('toast.modeChanged', newMode));
      },
      onGameStarted: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.resetReady();
        gamepadManager.renderGameController(mode);
        showInstallToast(t('toast.gameStarted', mode));
      },
      onStagingStarted: (mode) => {
        gamepadManager.enterStaging(mode);
        // Saha açılırken hazır da sıfırlanır (host tarafıyla aynı kural; geç kalmış
        // bayrak bir sonraki turun sayacına sızamaz)
        gamepadManager.resetReady();
        showInstallToast(t('toast.stagingOpen'));
      },
      onCountdown: (t) => {
        gamepadManager.showCountdown(t);
      },
      onReturnedToLobby: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.resetReady();
        gamepadManager.selectedHostGame = mode || 'PONG';
        gamepadManager.renderGameController('LOBBY');
        showInstallToast(t('toast.backToLobby'));
      },
      onSlotChanged: (slotIndex, color) => {
        gamepadManager.updateSlot(slotIndex, color);
        showInstallToast(t('toast.slotChanged', slotIndex + 1));
      },
      onSlotsUpdate: (slots) => {
        gamepadManager.updateSlots(slots);
      },
      onGameState: (data) => {
        if (connectionWasDown) {
          connectionWasDown = false;
          showConnectionBanner('online', t('net.reconnected'));
        }
        gamepadManager.handleStateSync(data);
      },
      onWorldFrame: (frame) => {
        gamepadManager.handleWorldFrame(frame);
      },
      onError: (err) => {
        routeConnectionMessage(err);
      },
      onHostDisconnected: (msg) => {
        showConnectionBanner('offline', String(msg || t('net.hostLost')));
        gamepadManager.hide();
        menuOverlay?.classList.remove('hidden');
      },
    }, joinAvatar);
  } catch (err) {
    console.error('[Join] Odaya bağlanılamadı:', err);
    if (net === supabaseRelay) {
      console.warn('[Join] Supabase connection failed, falling back to local WebSocket...');
      showInstallToast(t('toast.supabaseFallback'));
      updatePlatformMode('TV_CONSOLE');
      gamepadManager.network = partyNetwork;
      setTimeout(() => {
        executeJoin(rawCode, rawName);
      }, 500);
    } else {
      const detail = err?.message ? ` Sebep: ${err.message}` : '';
      showInstallToast(t('toast.joinFail', detail));
    }
  }
}

function handleSeatSwap(slotA, slotB) {
  activeNet().swapSlots(slotA, slotB);
  if (!activeNet().isHosting) {
    const temp = hostPlayerSlots[slotA];
    hostPlayerSlots[slotA] = hostPlayerSlots[slotB];
    hostPlayerSlots[slotB] = temp;
    const engine = getActiveGameEngine();
    if (engine) swapEngineSlots(engine, currentMode, activeNet().isHosting, slotA, slotB);
  }
}

function handleRotateSeats() {
  if (activeNet().isHosting && activeNet().players?.some((player) => player?.isHost)) return;
  // Skor permütasyonu (relay'deki [2,3,1,0] ile aynı sonuç)
  const rotateScoresLocally = () => {
    const engine = getActiveGameEngine();
    if (engine) {
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 0, 2);
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 2, 1);
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 1, 3);
    }
  };
  if (!activeNet().isHosting) {
    const p0 = hostPlayerSlots[0];
    const p1 = hostPlayerSlots[1];
    const p2 = hostPlayerSlots[2];
    const p3 = hostPlayerSlots[3];
    hostPlayerSlots[0] = p3;
    hostPlayerSlots[2] = p0;
    hostPlayerSlots[1] = p2;
    hostPlayerSlots[3] = p1;
    rotateScoresLocally();
    return;
  }
  // Host: skorları yerelde döndür, koltukları relay'de atomik döndür
  // (tek yayın — ara flicker/yanlış koltuk yok). Bot varsa iptal (relay de iptal eder).
  if (hostPlayerSlots.some((s) => s?.kind === 'bot' || s?.kind === 'bot_god')) {
    showInstallToast(t('toast.botLockRotate'));
    return;
  }
  rotateScoresLocally();
  if (typeof activeNet().rotateSeats === 'function') {
    activeNet().rotateSeats();
    // Relay aynı permütasyonu uygular; host tablosu + avatar kayıt defteri de
    // yerelde döner (yoksa isimler/yüzler yanlış koltukta kalır).
    const order = [2, 3, 1, 0];
    const oldEntries = [hostPlayerSlots[0], hostPlayerSlots[1], hostPlayerSlots[2], hostPlayerSlots[3]];
    for (let i = 0; i < 4; i++) {
      hostPlayerSlots[i] = oldEntries[order[i]];
      setSlotAvatar(i, hostPlayerSlots[i]?.avatar || null);
    }
    refreshHostSlotCards();
    renderPauseSeats(handleSeatSwap);
  } else {
    activeNet().swapSlots(0, 2);
    activeNet().swapSlots(2, 1);
    activeNet().swapSlots(1, 3);
  }
}

// Host lobi kartlarını state'ten yeniden çiz (butonlar + rozetler tutarlı olsun)
function refreshHostSlotCards() {
  for (let i = 0; i < 4; i++) {
    const e = hostPlayerSlots[i];
    if (e) updateHostSlot(i, true, e.name, e.isReady, e.kind);
    else updateHostSlot(i, false);
  }
  // Bot ipucu sadece ayar açıksa görünür
  document.getElementById('host-slot-hint')?.classList.toggle('hidden', !isBotEkleEnabled());
}

function returnHostToLobby() {
  exitStagingToLobby();
  if (!activeNet().isHosting) {
    setGameMode('MENU');
    return;
  }
  closePauseModal();
  // Lobiye dönüşte latch'ler nötrlenir (maç-sonu hayaleti lobiye/staging'e sızmasın)
  const engineLobby = getActiveGameEngine();
  if (engineLobby) clearAllRemoteSlots(engineLobby, currentMode);
  for (let i = 0; i < 4; i++) delete lastRemoteInputAt[i];
  setGameMode('MENU');
  activeNet().returnToLobby();
  // Lobiye dönüşte botlar temizlenir — koltuklar insanlara kalır
  for (let i = 0; i < 4; i++) {
    if (hostPlayerSlots[i]?.kind === 'bot') {
      activeNet().clearSlotBot?.(i);
      updateHostSlot(i, false);
    }
  }
  // Oda korunur: hostRoom tekrar çağrılmaz (yeni kod üretip koltukları siliyordu —
  // kumandalar eski kanalda asılı kalıp STAGING_STARTED'i kaçırıyordu).
  const roomCode = activeNet().roomCode;
  if (roomCode) {
    const joinUrl = getEffectiveJoinUrl(roomCode, platformMode);
    showHostLobbyModal(roomCode, joinUrl);
    startHostPingBadge(() => activeNet().ping, platformMode);
    setSeatTapHook();
    refreshHostSlotCards();
  } else {
    openHostLobby(getCurrentHostGameMode());
  }
}

function handleExitToMenu() {
  if (activeNet().isHosting) {
    closePauseModal();
    exitStagingToLobby();
    hideHostLobbyModal();
    for (let i = 0; i < 4; i++) {
      clearSlotAvatar(i);
      updateHostSlot(i, false);
    }
    activeNet().disconnect();
    setSeatTapHook();
    setGameMode('MENU');
  } else {
    closePauseModal();
    setGameMode('MENU');
  }
}

function handleGameCardClick(mode) {
  if (activeNet().isHosting) {
    openHostLobby(mode);
  } else {
    setGameMode(mode);
  }
}

// ── İki kademeli başlatma: LOBİ → STAGING (saha+koltuk) → sayaç → OYUN ──
let stagingMode = null;
let seatsLocked = false;
let countdownTimer = null;

// Uzak-girdi canlılık damgaları: analog sessizlik süpürücüsü için.
// Koltuk politikası değişmez — sadece latch nötrlenir, koltuk dolu kalır.
const lastRemoteInputAt = {};
// Kumanda avatar-güncelleme kısması (slot başına 1sn sel koruması)
const lastAvatarAt = {};
const STALE_ANALOG_MS = 1500;
setInterval(() => {
  if (!activeNet().isHosting) return;
  if (currentMode === 'MENU' || stagingMode || countdownTimer) return;
  const engine = getActiveGameEngine();
  if (!engine) return;
  const now = performance.now();
  for (let i = 0; i < 4; i++) {
    const last = lastRemoteInputAt[i];
    if (last === undefined) continue;
    if (now - last >= STALE_ANALOG_MS) {
      clearRemoteSlot(engine, currentMode, i);
      delete lastRemoteInputAt[i];
    }
  }
}, 500);

function refreshStagingBar() {
  if (!stagingMode) return;
  const humans = hostPlayerSlots.filter((p) => p !== null && p.kind !== 'bot');
  const connected = humans.length;
  const ready = humans.filter((p) => p?.isReady).length;
  const clash = activeNet().isHosting ? getColorClashIndices() : [];
  const pill = document.getElementById('staging-ready-pill');
  if (pill) {
    pill.textContent = connected === 0 ? t('lobby.waiting') : t('lobby.connected', connected, ready);
    if (clash.length > 0) pill.textContent += ` • ${t('lobby.clash')}`;
    pill.classList.toggle('clash', clash.length > 0);
  }
  const btn = document.getElementById('btn-staging-launch');
  if (btn) {
    btn.textContent = clash.length > 0 ? t('stage.split') : t('stage.start', ready, connected);
    btn.classList.toggle('blocked', clash.length > 0);
  }
}

function showStagingBar() {
  document.getElementById('staging-bar')?.classList.remove('hidden');
  refreshStagingBar();
}

function hideStagingBar() {
  document.getElementById('staging-bar')?.classList.add('hidden');
}

function showCountdownOverlay(t) {
  const ov = document.getElementById('countdown-overlay');
  const num = document.getElementById('countdown-overlay-number');
  if (!ov || !num) return;
  num.textContent = t > 0 ? String(t) : t('count.go');
  ov.classList.remove('hidden');

  // Force layout reflow and retrigger CSS animation on each tick
  num.classList.remove('animate');
  void num.offsetWidth;
  num.classList.add('animate');
}

function hideCountdownOverlay() {
  document.getElementById('countdown-overlay')?.classList.add('hidden');
}

function cancelCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  hideCountdownOverlay();
}

function startEngineNow(mode) {
  // Maç başı reset motorun oyuncu renklerini yeniden kurar; host display
  // renkleri (override dahil) hemen ardından tekrar yazılır.
  const engine = getEngine(mode);
  engine?.start();
  const active = getActiveGameEngine();
  if (active) syncSlotsToEngine(active, mode, activeNet().isHosting);
}

// BAŞLAT #1: sahayı aç — motor LOBBY'de arena gösterir, koltuk seçimi başlar
async function enterStaging(mode) {
  // Sert renk engeli: aynı display rengine sahip iki insan koltuğu varken
  // sahaya geçilemez (LOCAL'de koltuklar boş → küme boş → engel yok).
  if (activeNet().isHosting && getColorClashIndices().length > 0) {
    showInstallToast(t('toast.clashLobby'));
    return;
  }
  await setGameMode(mode);
  // Yükleme başarısızsa veya araya yeni geçiş girdiyse saha açılmaz.
  if (currentMode !== mode) return;
  stagingMode = mode;
  seatsLocked = false;
  // Lobiden çıkışta herkes BEKLE'ye çekilir (yerel sıfırlama, ekstra çağrı yok —
  // aksi halde eski turun bayrağı yeni turun sayacına sızar)
  for (let i = 0; i < 4; i++) {
    const e = hostPlayerSlots[i];
    const isReady = platformMode === 'ONLINE' && i === 0;
    if (e) updateHostSlot(i, true, e.name, isReady, e.kind);
  }
  refreshStagingBar();
  // Saha açılırken koltuklar bir kez daha yazılır (kurucu varsayılan botları ezilir)
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, mode, activeNet().isHosting);
  activeNet().startStaging(mode);
  showStagingBar();
  showInstallToast(t('toast.stagingOpenHost'));
}

// BAŞLAT #2: 3-2-1 → oyun (koltuklar kilitli)
function runCountdown() {
  if (!stagingMode || countdownTimer) return;
  // Staging sırasında avatar değişimi çakışma doğurmuş olabilir → sayaç kapısı
  if (activeNet().isHosting && getColorClashIndices().length > 0) {
    showInstallToast(t('toast.clashCountdown'));
    return;
  }
  const mode = stagingMode;
  // Sayaç başında yarım kalmış latch taşınmasın (önceki turun hayaleti)
  const enginePre = getActiveGameEngine();
  if (enginePre) clearAllRemoteSlots(enginePre, mode);
  for (let i = 0; i < 4; i++) delete lastRemoteInputAt[i];
  seatsLocked = true;
  let t = 3;
  const tick = () => {
    if (t > 0) {
      showCountdownOverlay(t);
      lastCountdownT = t;
      activeNet().broadcastCountdown(t);
      t -= 1;
    } else {
      cancelCountdown();
      seatsLocked = false;
      hideStagingBar();
      stagingMode = null;
      activeNet().startGame(mode);
      startEngineNow(mode);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function exitStagingToLobby() {
  cancelCountdown();
  seatsLocked = false;
  stagingMode = null;
  hideStagingBar();
  hideCountdownOverlay();
}

// ── Tek koltuk gerçeği: TV sahasından koltuğa dokununca bot ekle/çıkar ──
const BOT_SEAT_NAMES = ['BOT · 1', 'BOT · 2', 'BOT · 3', 'BOT · 4'];

function handleLobbySeatTap(index) {
  if (!activeNet().isHosting) return;
  // Bot ekleme kapalıysa normal akış: sadece oyuncu eklenir/çıkarılır
  if (!isBotEkleEnabled()) return;
  if (seatsLocked) {
    showInstallToast(t('toast.countdownLock'));
    return;
  }
  const entry = hostPlayerSlots[index];
  if (entry && entry.kind === 'bot') {
    addBotGodSlot(index);
  } else if (entry && entry.kind === 'bot_god') {
    removeBotSlot(index);
  } else if (!entry) {
    addBotSlot(index, 'bot');
  } else {
    showInstallToast(t('toast.seatFull', index + 1));
  }
}

function addBotSlot(index, kind = 'bot') {
  const name = kind === 'bot_god' ? `⚡ GOD · ${index + 1}` : (BOT_SEAT_NAMES[index] || `BOT · ${index + 1}`);
  activeNet().setSlotBot?.(index, name, kind);
  updateHostSlot(index, true, name, false, kind);
  refreshStagingBar();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  renderPauseSeats(handleSeatSwap);
  showInstallToast(kind === 'bot_god' ? t('toast.godAdded', index + 1) : t('toast.botAdded', index + 1));
}

function addBotGodSlot(index) {
  addBotSlot(index, 'bot_god');
}

function removeBotSlot(index) {
  activeNet().clearSlotBot?.(index);
  updateHostSlot(index, false);
  refreshStagingBar();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  renderPauseSeats(handleSeatSwap);
  showInstallToast(t('toast.seatCleared', index + 1));
}

// Motorların LOBBY tap'lerini host'a yönlendir (sadece host iken aktif)
// + canvas MAÇI BAŞLAT butonunu host'ta gizle: TV akışı tek yoldan
// (DOM staging çubuğu → sayaç) yürür, çift başlat düğmesi kalmaz.
function setSeatTapHook() {
  const hosting = activeNet().isHosting;
  const onlinePhoneHost = hosting && platformMode === 'ONLINE';
  const fn = hosting ? handleLobbySeatTap : null;
  forEachEngine((mode, entry) => {
    entry.game.onLobbySeatTap = fn;
    entry.game.hideLobbyStartButton = hosting;
    entry.game.suppressVirtualControls = hosting && !onlinePhoneHost;
    entry.game.localControlSlot = onlinePhoneHost ? 0 : null;
  });
}

// Initialise UI Submodules
ensureStoredNick();
initToastAndInstall();
// Tarayıcı çevrimdışı/çevrimiçi geçişleri (uçak modu, Wi-Fi kopuşu): kumanda
// tarafında anlık bant bildirimi. Relay mesajları aynı banda yazar.
window.addEventListener('offline', () => {
  connectionWasDown = true;
  showConnectionBanner('offline', t('net.offline'));
});
window.addEventListener('online', () => {
  showConnectionBanner('online', t('net.onlineBack'));
});
initJoinModal({ onExecuteJoin: executeJoin });
initSettingsModal();
applyI18nToDOM();
// Dil değişiminde TV lobi kartları anında yeniden çizilir (BOŞ/HAZIR etiketleri).
onLangChange(() => {
  try { refreshAllHostSlots(); } catch {}
});
document.getElementById('btn-open-settings')?.addEventListener('click', openSettingsModal);
initHostLobby({
  getActiveNet: () => activeNet(),
  getPlatformMode: () => platformMode,
  onStageGame: (mode) => {
    enterStaging(mode);
  },
  onCloseLobby: () => {
    exitStagingToLobby();
    for (let i = 0; i < 4; i++) {
      clearSlotAvatar(i);
      updateHostSlot(i, false);
    }
    activeNet().disconnect();
    setSeatTapHook();
    setGameMode('MENU');
  },
  onSwapSlots: (slotA, slotB) => {
    activeNet().swapSlots(slotA, slotB);
  },
  onToggleBotSlot: (slotIndex) => {
    handleLobbySeatTap(slotIndex);
  },
  onSetSlotColor: (slotIndex, hex) => {
    const entry = hostPlayerSlots[slotIndex];
    if (!entry || entry.kind === 'bot' || entry.kind === 'bot_god') return;
    entry.displayColor = hex;
    try {
      activeNet().setSlotColor?.(slotIndex, hex);
    } catch {}
    updateHostSlot(slotIndex, true, entry.name, entry.isReady, entry.kind);
    refreshStagingBar();
    const engine = getActiveGameEngine();
    if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
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
    updateHostSlot(slotIndex, true, entry.name, entry.isReady, entry.kind);
    refreshStagingBar();
    const engine = getActiveGameEngine();
    if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
    showInstallToast(t('toast.seatColor', slotIndex + 1));
  },
});

// Staging bar (BAŞLAT #2 + lobiye dönüş)
document.getElementById('btn-staging-launch')?.addEventListener('click', () => {
  runCountdown();
});
document.getElementById('btn-staging-lobby')?.addEventListener('click', () => {
  returnHostToLobby();
});
initPauseModal({
  getCurrentMode: () => currentMode,
  getIsHosting: () => activeNet().isHosting,
  onSwapSeats: handleSeatSwap,
  onRotateSeats: handleRotateSeats,
  onResume: onResumeAfterPause,
  onReset: resetActiveGame,
  onExitMenu: handleExitToMenu,
  onTvLobby: returnHostToLobby,
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
      if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
    }
    refreshHostSlotCards();
    showInstallToast(enabled ? t('toast.botsOn') : t('toast.botsOff'));
  },
});

// Menu Card Tap Listeners (buton id kuralı: btn-select-<lowercase mode>)
const gamePickerModal = document.getElementById('game-picker-modal');
const btnCloseGamePicker = document.getElementById('btn-close-game-picker');

function openGamePicker() {
  gamePickerModal?.classList.remove('hidden');
}

function closeGamePicker() {
  gamePickerModal?.classList.add('hidden');
}

btnHeroCreateRoom?.addEventListener('click', () => openHostLobby('PONG'));
addTapListener(document.getElementById('btn-hero-browse-games'), openGamePicker);
addTapListener(btnCloseGamePicker, closeGamePicker);

gamePickerModal?.addEventListener('click', (e) => {
  if (e.target === gamePickerModal) closeGamePicker();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !gamePickerModal?.classList.contains('hidden')) {
    closeGamePicker();
  }
});

// Local 2-Card Showcase Slide Controls & Quick Play Tap
const carouselTrack = document.getElementById('local-carousel-track');
const carouselViewport = document.getElementById('local-carousel-viewport');
const btnCarouselPrev = document.getElementById('btn-carousel-prev');
const btnCarouselNext = document.getElementById('btn-carousel-next');
const pageIndicator = document.getElementById('local-carousel-page-num');

let currentSlideIndex = 0;
const totalSlides = 7;

function updateCarouselSlide(newIndex) {
  currentSlideIndex = (newIndex + totalSlides) % totalSlides;
  if (carouselTrack) {
    carouselTrack.style.transform = `translateX(-${currentSlideIndex * 100}%)`;
  }
  if (pageIndicator) {
    pageIndicator.textContent = `${currentSlideIndex + 1} / ${totalSlides}`;
  }
}

if (btnCarouselPrev && btnCarouselNext) {
  addTapListener(btnCarouselPrev, () => updateCarouselSlide(currentSlideIndex - 1));
  addTapListener(btnCarouselNext, () => updateCarouselSlide(currentSlideIndex + 1));
}

// Touch swipe support on carousel
if (carouselViewport) {
  let touchStartX = 0;
  let touchStartY = 0;
  carouselViewport.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  }, { passive: true });

  carouselViewport.addEventListener('touchend', (e) => {
    if (e.changedTouches.length === 1) {
      const diffX = e.changedTouches[0].clientX - touchStartX;
      const diffY = e.changedTouches[0].clientY - touchStartY;
      if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(diffY)) {
        if (diffX < 0) {
          updateCarouselSlide(currentSlideIndex + 1);
        } else {
          updateCarouselSlide(currentSlideIndex - 1);
        }
      }
    }
  }, { passive: true });
}

document.querySelectorAll('.local-showcase-card[data-game]').forEach((card) => {
  addTapListener(card, () => {
    const game = card.getAttribute('data-game');
    if (game) handleGameCardClick(game);
  });
});

const btnHeroShowcaseAll = document.getElementById('btn-hero-showcase-all');
if (btnHeroShowcaseAll) {
  addTapListener(btnHeroShowcaseAll, openGamePicker);
}
addTapListener(document.getElementById('btn-menu-customize'), () => openCustomizeModal());
initMenuAvatarCard();

function initHeroMediaDropzones() {
  const tvImg = document.querySelector('.tv-media-box img');
  const localImg = document.querySelector('.local-media-box img');

  const savedTv = localStorage.getItem('bp_tv_banner');
  if (savedTv && tvImg) tvImg.src = savedTv;

  const savedLocal = localStorage.getItem('bp_local_banner');
  if (savedLocal && localImg) localImg.src = savedLocal;

  function bindDrop(box, storageKey, targetImg) {
    if (!box || !targetImg) return;
    box.addEventListener('dragover', (e) => {
      e.preventDefault();
      box.style.borderColor = '#1d5d8a';
    });
    box.addEventListener('dragleave', () => {
      box.style.borderColor = '';
    });
    box.addEventListener('drop', (e) => {
      e.preventDefault();
      box.style.borderColor = '';
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const dataUri = evt.target?.result;
          if (typeof dataUri === 'string') {
            targetImg.src = dataUri;
            try { localStorage.setItem(storageKey, dataUri); } catch {}
          }
        };
        reader.readAsDataURL(file);
      }
    });
  }

  bindDrop(document.querySelector('.tv-media-box'), 'bp_tv_banner', tvImg);
  bindDrop(document.querySelector('.local-media-box'), 'bp_local_banner', localImg);
}
initHeroMediaDropzones();

// SaaS Main Menu Setup: Navbar controls, Quick Lang/Sound, Search & Bento Grid Filters
initMainMenu({
  isOnline: platformMode === 'ONLINE',
  onGameSelect: (mode) => {
    closeGamePicker();
    handleGameCardClick(mode);
  },
});

for (const mode of GAME_ORDER) {
  addTapListener(document.getElementById(`btn-select-${mode.toLowerCase()}`), () => {
    closeGamePicker();
    handleGameCardClick(mode);
  });
  // Hover/touchstart ön-yükleme: kullanıcı karta bakarken chunk arka planda
  // iner, dokunuş anında motor çoğunlukla hazırdır (seçim akışı değişmez).
  const cardEl = document.getElementById(`btn-select-${mode.toLowerCase()}`);
  cardEl?.addEventListener('mouseenter', () => preloadEngine(mode));
  cardEl?.addEventListener('touchstart', () => preloadEngine(mode), { passive: true });
}

addTapListener(btnQuickTvLobby, returnHostToLobby);

function updateQuickFullscreen(active) {
  const isFs = typeof active === 'boolean' ? active : isFullscreen();
  if (quickFullscreenIcon) quickFullscreenIcon.textContent = isFs ? '🗗' : '⛶';
  btnQuickFullscreen?.classList.toggle('active', isFs);
  btnQuickFullscreen?.setAttribute('title', isFs ? t('menu.exitFullscreen') : t('menu.fullscreen'));
  btnQuickFullscreen?.setAttribute('aria-pressed', String(isFs));
}
updateQuickFullscreen();
onFullscreenChange(updateQuickFullscreen);
onLangChange(() => updateQuickFullscreen());
addTapListener(btnQuickFullscreen, () => toggleFullscreen());

addTapListener(btnOpenOptions, () => {
  openPauseModal({
    currentMode,
    isHosting: activeNet().isHosting,
    onSwapCallback: handleSeatSwap,
  });
});

// Check URL query parameters for automatic controller join (QR scan or link)
const urlParams = new URLSearchParams(window.location.search);
const autoJoinCode = urlParams.get('join');
if (autoJoinCode) {
  if (isPublicOrigin()) {
    updatePlatformMode('ONLINE');
  }
  openJoinModal(autoJoinCode);
  executeJoin(autoJoinCode, ensureStoredNick());
}

// Best-effort goodbye beacon on page hide
function sendGoodbyeBeacon() {
  try {
    activeNet().disconnect();
  } catch {}
}
window.addEventListener('pagehide', sendGoodbyeBeacon);
window.addEventListener('beforeunload', sendGoodbyeBeacon);

// Service Worker Management (with auto update & cache busting)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
        console.log('[PWA] ServiceWorker registered and updated:', reg.scope);
        // Yeni sürüm hazırsa kullanıcıya bildir (sayfayı yenilesin)
        const notifyUpdate = () => showInstallToast(t('toast.updateReady'));
        if (reg.waiting) notifyUpdate();
        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              notifyUpdate();
            }
          });
        });
      })
      .catch((err) => console.warn('[PWA] ServiceWorker registration failed:', err));
  });
}

// Warning for public site missing Supabase config
if (isPublicOrigin() && !HAS_SUPABASE_CONFIG) {
  showInstallToast(t('toast.noOnlineEnv'));
}

// Throttled Host State Broadcaster: 8Hz taban + değişiklikte anında gönderim.
// Kirlenme kontrolü güvenli — pakette timestamp/random yok (PING ayrı yolda).
// Skor/taşıyıcı/sinyal gibi kritik değişimler throttle beklemez (refleks korunur);
// değişiklik yoksa 125ms tabanında aynı paket tekrar gider (kumanda faz-uzlaşması).
let lastBroadcastTime = 0;
let lastBroadcastJson = '';
let lastBroadcastPacket = null;
let lastWorldBroadcastTime = 0;
let lastCountdownT = 0;

const WORLD_FRAME_INTERVAL_MS = 1000 / 30;

// Sığ paket karşılaştırma: stringify maliyetine girmeden kirlenme tespiti.
// Davranış aynı (değişiklikte anında + 125ms taban), sadece sakin karelerde
// JSON.stringify çalışmaz.
function samePacket(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) {
        const ea = va[i];
        const eb = vb[i];
        if (ea && typeof ea === 'object') {
          if (JSON.stringify(ea) !== JSON.stringify(eb)) return false;
        } else if (ea !== eb) return false;
      }
    } else if (va !== vb) return false;
  }
  return true;
}

function broadcastGameStateIfNeeded(now) {
  if (!activeNet().isHosting) return;

  const intervalElapsed = now - lastBroadcastTime >= 125;
  // Paket her karede kurulur (değişiklik tespiti için şart) ama pahalı
  // stringify yalnızca kirlenme varsa veya 125ms taban dolduysa çalışır.
  let packet;
  if (currentMode === 'MENU') {
    // Boşta tiny paket: kirlenme kontrollü olduğu için ~1 kez gider, sonra susar.
    // Kumandalar kaçırdıkları LOBBY dönüşünü buradan yakalar.
    packet = { gameMode: 'MENU', phase: 'LOBBY' };
  } else {
    packet = { gameMode: currentMode };
    const entry = getEngine(currentMode);
    if (entry) Object.assign(packet, entry.packet());
    packet.phase = countdownTimer ? 'COUNTDOWN' : (stagingMode ? 'STAGING' : 'GAME');
    if (countdownTimer) packet.t = lastCountdownT;
  }
  packet.names = hostPlayerSlots.map((p) => (p ? p.name : null));

  if (samePacket(packet, lastBroadcastPacket) && !intervalElapsed) return;

  const json = JSON.stringify(packet);
  if (json === lastBroadcastJson && !intervalElapsed) return;

  lastBroadcastTime = now;
  lastBroadcastJson = json;
  lastBroadcastPacket = packet;
  activeNet().broadcastHostState(packet);
}

function broadcastWorldStateIfNeeded(now) {
  const net = activeNet();
  if (!net.isHosting || typeof net.broadcastWorldFrame !== 'function') return;
  if (currentMode === 'MENU' || now - lastWorldBroadcastTime < WORLD_FRAME_INTERVAL_MS) return;

  const entry = getEngine(currentMode);
  if (!entry || typeof entry.worldPacket !== 'function') return;
  if (entry.game.state === 'LOBBY') return;

  const frame = entry.worldPacket();
  if (!frame) return;
  lastWorldBroadcastTime = now;
  net.broadcastWorldFrame(frame);
}

// Duraklatma göstergesi: donmuş karenin üstünde canvas-içi rozet
// (DOM modal zaten açık; TV'de "oyun mu bozuldu" belirsizliğini giderir).
function renderPauseOverlay(ctx) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const pillW = 260;
  const pillH = 56;
  const pillX = w / 2 - pillW / 2;
  const pillY = h / 2 - pillH / 2;

  ctx.save();
  ctx.fillStyle = 'rgba(26, 26, 26, 0.45)';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX + 4, pillY + 4, pillW, pillH);
  ctx.fillStyle = UI_COLORS.ink;
  ctx.fillRect(pillX, pillY, pillW, pillH);
  ctx.strokeStyle = UI_COLORS.paperWarm;
  ctx.lineWidth = 3;
  ctx.strokeRect(pillX, pillY, pillW, pillH);
  ctx.fillStyle = UI_COLORS.white;
  ctx.font = uiFont('button');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('⏸ DURAKLATILDI', w / 2, pillY + pillH / 2);
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
  const cardH = 140;
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
  ctx.fillText(t('crash.title'), cx, cy - 25);

  ctx.font = '800 12px "JetBrains Mono", monospace';
  ctx.fillText(String(error?.message || t('crash.default')).slice(0, 50), cx, cy + 5);

  ctx.font = '900 13px "Space Grotesk", sans-serif';
  ctx.fillText(t('crash.action'), cx, cy + 38);
  ctx.restore();
}

function loop(timestamp) {
  try {
    broadcastGameStateIfNeeded(timestamp);
  } catch (err) {
    console.warn('[Broadcast] Error:', err);
  }

  const isPaused = getIsPaused();
  const loopEntry = getEngine(currentMode);

  if (loopEntry) {
    try {
      if (!isPaused && consecutiveEngineErrors < 5) {
        loopEntry.game.update(timestamp);
        broadcastWorldStateIfNeeded(timestamp);
      }
      loopEntry.game.render();
      consecutiveEngineErrors = 0;
    } catch (err) {
      consecutiveEngineErrors++;
      lastEngineError = err;
      console.error(`[Engine Error: ${currentMode}]`, err);
      if (consecutiveEngineErrors >= 5) {
        renderEngineCrashOverlay(ctx2d, lastEngineError);
      }
    }

    if (isPaused) {
      try {
        renderPauseOverlay(ctx2d);
      } catch (_) {}
    }
  } else if (currentMode === 'MENU') {
    ctx2d.save();
    ctx2d.fillStyle = '#F4F4F0';
    ctx2d.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx2d.restore();
  }

  if (currentMode !== 'MENU') {
    try {
      touchManager.renderOverlay(ctx2d);
    } catch (err) {
      console.warn('[Touch Overlay] Error:', err);
    }
  }

  requestAnimationFrame(loop);
}

// Initial Setup
resizeCanvas();
setGameMode('MENU');
refreshHostSlotCards();
requestAnimationFrame(loop);
