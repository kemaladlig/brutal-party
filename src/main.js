// Local Party Games Suite - Main Application Controller & State Machine
import { Game as PongGame } from './games/game.js';
import { TanksGame } from './games/tanks.js';
import { CurveGame } from './games/curve.js';
import { BombGame } from './games/bomb.js';
import { HeistGame } from './games/heist.js';
import { DuelGame } from './games/duel.js';
import { TouchManager } from './touchManager.js';
import { playJoin } from './audio.js';
import { partyNetwork } from './network.js';
import { GamepadManager } from './gamepad.js';
import {
  HAS_SUPABASE_CONFIG,
  isPublicOrigin,
  getActiveNetwork,
  disconnectInactiveNetwork,
  getStoredPlayerName,
  storePlayerName,
} from './net.js';

import { initToastAndInstall, showInstallToast } from './ui/toast.js';
import { hostPlayerSlots, updateHostSlot, syncSlotsToEngine, swapEngineSlots } from './core/slotManager.js';
import {
  initPauseModal,
  openPauseModal,
  closePauseModal,
  renderPauseSeats,
  getIsPaused,
  setIsPaused,
} from './ui/pauseModal.js';
import { initJoinModal, openJoinModal } from './ui/joinModal.js';
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
const btnOpenOptions = document.getElementById('btn-open-options');
const btnHeroCreateRoom = document.getElementById('btn-hero-create-room');

const btnSelectPong = document.getElementById('btn-select-pong');
const btnSelectTanks = document.getElementById('btn-select-tanks');
const btnSelectCurve = document.getElementById('btn-select-curve');
const btnSelectBomb = document.getElementById('btn-select-bomb');
const btnSelectHeist = document.getElementById('btn-select-heist');
const btnSelectDuel = document.getElementById('btn-select-duel');

// Platform / Match Mode: 'LOCAL' | 'TV_CONSOLE' | 'ONLINE'
let platformMode = isPublicOrigin() ? 'ONLINE' : 'TV_CONSOLE';
export function updatePlatformMode(newMode) {
  platformMode = newMode;
}

export function activeNet() {
  return getActiveNetwork(platformMode);
}

// State Machine: 'MENU' | 'PONG' | 'TANKS' | 'CURVE' | 'BOMB' | 'HEIST' | 'DUEL'
let currentMode = 'MENU';
let lastTransitionTime = 0;

export function markTransition() {
  lastTransitionTime = performance.now();
}

// Engine Instances
const touchManager = new TouchManager(canvas);
const pongGame = new PongGame(canvas);
const tanksGame = new TanksGame(canvas);
const curveGame = new CurveGame(canvas);
const bombGame = new BombGame(canvas);
const heistGame = new HeistGame(canvas);
const duelGame = new DuelGame(canvas);

export function getActiveGameEngine() {
  if (currentMode === 'PONG') return pongGame;
  if (currentMode === 'TANKS') return tanksGame;
  if (currentMode === 'CURVE') return curveGame;
  if (currentMode === 'BOMB') return bombGame;
  if (currentMode === 'HEIST') return heistGame;
  if (currentMode === 'DUEL') return duelGame;
  return null;
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

  pongGame.resize(width, height);
  tanksGame.resize(width, height);
  curveGame.resize(width, height);
  bombGame.resize(width, height);
  heistGame.resize(width, height);
  duelGame.resize(width, height);
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 150);
});

// State Management
export function setGameMode(mode) {
  markTransition();
  currentMode = mode;
  setIsPaused(false);
  closePauseModal();
  touchManager.resetTouches();

  const now = performance.now();

  if (btnQuickTvLobby) {
    if (mode === 'MENU') {
      btnQuickTvLobby.classList.add('hidden');
    } else {
      btnQuickTvLobby.classList.toggle('hidden', !activeNet().isHosting);
    }
  }

  if (mode === 'MENU') {
    menuOverlay.classList.remove('hidden');
    inGameHud.classList.add('hidden');
    touchManager.setHandler(null);
  } else if (mode === 'PONG') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(pongGame);
    pongGame.resetCurrentGame();
    pongGame.lastTime = now;
    pongGame.accumulator = 0;
    pongGame.resize(window.innerWidth, window.innerHeight);
    syncSlotsToEngine(pongGame, currentMode, activeNet().isHosting);
  } else if (mode === 'TANKS') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(tanksGame);
    tanksGame.resetMatch();
    tanksGame.lastTime = now;
    tanksGame.resize(window.innerWidth, window.innerHeight);
    syncSlotsToEngine(tanksGame, currentMode, activeNet().isHosting);
  } else if (mode === 'CURVE') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(curveGame);
    curveGame.resetMatch();
    curveGame.lastTime = now;
    curveGame.resize(window.innerWidth, window.innerHeight);
    syncSlotsToEngine(curveGame, currentMode, activeNet().isHosting);
  } else if (mode === 'BOMB') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(bombGame);
    bombGame.resetMatch();
    bombGame.lastTime = now;
    bombGame.resize(window.innerWidth, window.innerHeight);
    syncSlotsToEngine(bombGame, currentMode, activeNet().isHosting);
  } else if (mode === 'HEIST') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(heistGame);
    heistGame.resetMatch();
    heistGame.lastTime = now;
    heistGame.resize(window.innerWidth, window.innerHeight);
    syncSlotsToEngine(heistGame, currentMode, activeNet().isHosting);
  } else if (mode === 'DUEL') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(duelGame);
    duelGame.reset();
    duelGame.lastTime = now;
    duelGame.resize(window.innerWidth, window.innerHeight);
    syncSlotsToEngine(duelGame, currentMode, activeNet().isHosting);
  }
}

function resetActiveGame() {
  const now = performance.now();
  if (currentMode === 'PONG') {
    pongGame.resetCurrentGame();
  } else if (currentMode === 'TANKS') {
    tanksGame.resetMatch();
  } else if (currentMode === 'CURVE') {
    curveGame.resetMatch();
  } else if (currentMode === 'BOMB') {
    bombGame.resetMatch();
  } else if (currentMode === 'HEIST') {
    heistGame.resetMatch();
  } else if (currentMode === 'DUEL') {
    duelGame.reset();
  }
  touchManager.resetTouches();
}

function onResumeAfterPause() {
  const now = performance.now();
  if (currentMode === 'PONG') {
    pongGame.lastTime = now;
    pongGame.accumulator = 0;
  } else if (currentMode === 'TANKS') {
    tanksGame.lastTime = now;
  } else if (currentMode === 'CURVE') {
    curveGame.lastTime = now;
  } else if (currentMode === 'BOMB') {
    bombGame.lastTime = now;
  } else if (currentMode === 'HEIST') {
    heistGame.lastTime = now;
  } else if (currentMode === 'DUEL') {
    duelGame.lastTime = now;
  }
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

// TV Host Room Creation
async function openHostLobby(gameMode = 'PONG') {
  setCurrentHostGameMode(gameMode);
  try {
    await activeNet().hostRoom(gameMode, {
      onRoomCreated: (roomCode) => {
        const joinUrl = getEffectiveJoinUrl(roomCode, platformMode);
        showHostLobbyModal(roomCode, joinUrl);
        startHostPingBadge(() => activeNet().ping, platformMode);
      },
      onPlayerJoined: (msg) => {
        playJoin();
        updateHostSlot(msg.slotIndex, true, msg.name, false);
        refreshStagingBar();
        // Staging/sayaç sırasında katılan geç kalanı mevcut faza sok
        // (STAGING_STARTED geçmişte kaldı, yoksa bekleme ekranında takılır)
        if (stagingMode && !countdownTimer) {
          activeNet().startStaging(stagingMode);
        }
        const engine = getActiveGameEngine();
        if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
        showInstallToast(`🎮 ${msg.name} kumanda olarak bağlandı!`);
      },
      onPlayerLeft: (msg) => {
        updateHostSlot(msg.slotIndex, false);
        refreshStagingBar();
        const engine = getActiveGameEngine();
        if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
        showInstallToast(`🚪 ${msg.name} odadan ayrıldı.`);
      },
      onPlayerReadyStatus: (slotIndex, isReady) => {
        if (hostPlayerSlots[slotIndex]) {
          updateHostSlot(slotIndex, true, hostPlayerSlots[slotIndex].name, isReady);
          refreshStagingBar();
        }
      },
      onSlotsSwapped: (slotA, slotB) => {
        const temp = hostPlayerSlots[slotA];
        hostPlayerSlots[slotA] = hostPlayerSlots[slotB];
        hostPlayerSlots[slotB] = temp;
        if (hostPlayerSlots[slotA]) updateHostSlot(slotA, true, hostPlayerSlots[slotA].name, hostPlayerSlots[slotA].isReady);
        else updateHostSlot(slotA, false);
        if (hostPlayerSlots[slotB]) updateHostSlot(slotB, true, hostPlayerSlots[slotB].name, hostPlayerSlots[slotB].isReady);
        else updateHostSlot(slotB, false);
        refreshStagingBar();

        const engine = getActiveGameEngine();
        if (engine) {
          swapEngineSlots(engine, currentMode, activeNet().isHosting, slotA, slotB);
        }

        showInstallToast(`🔄 Slot P${slotA + 1} ve P${slotB + 1} yer değiştirdi.`);
        renderPauseSeats(handleSeatSwap);
      },
      onPlayerInput: (slotIndex, data) => {
        if (data.action === 'SET_NAME' && data.name) {
          const slot = hostPlayerSlots[slotIndex];
          if (slot) {
            slot.name = data.name.slice(0, 12).toUpperCase();
            updateHostSlot(slotIndex, true, slot.name, slot.isReady);
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
          activeNet().swapSlots(slotIndex, data.targetSlot);
          return;
        }
        const engine = getActiveGameEngine();
        if (engine && typeof engine.handleRemoteInput === 'function') {
          engine.handleRemoteInput(slotIndex, data);
        }
      },
      onPlayerReaction: (slotIndex, emoji) => {
        showInstallToast(`P${slotIndex + 1}: ${emoji}`);
      },
    });
  } catch (err) {
    console.error('[Host] Oda açılamadı:', err);
    const detail = err?.message ? ` Sebep: ${err.message}` : '';
    showInstallToast(`Host odası açılamadı.${detail}`);
  }
}

// Controller Join Room Execution
async function executeJoin(rawCode, rawName) {
  const code = (rawCode || '').trim().toUpperCase();
  const name = (rawName || '').trim().toUpperCase() || 'OYUNCU';

  if (!code || code.length < 4) {
    showInstallToast('Lütfen 4 haneli geçerli bir oda kodu girin.');
    return;
  }

  storePlayerName(name);
  showInstallToast(`⏳ #${code} odasına bağlanılıyor...`);

  disconnectInactiveNetwork(platformMode);
  const net = activeNet();
  gamepadManager.network = net;

  try {
    await net.joinRoom(code, name, {
      onJoinedSuccess: (msg) => {
        menuOverlay?.classList.add('hidden');
        gamepadManager.init(msg, 'LOBBY');
        showInstallToast(`✓ ${msg.roomCode} odasına bağlandı!`);
      },
      onGameModeChanged: (newMode) => {
        gamepadManager.selectedHostGame = newMode;
        if (gamepadManager.gameMode === 'LOBBY') {
          gamepadManager.renderGameController('LOBBY');
        }
        showInstallToast(`🎯 Host oyunu değiştirdi: ${newMode}`);
      },
      onGameStarted: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.renderGameController(mode);
        showInstallToast(`▶ Oyun başladı: ${mode}`);
      },
      onStagingStarted: (mode) => {
        gamepadManager.enterStaging(mode);
        showInstallToast('🏟 Saha açıldı! Koltuğunu seç ve hazır ol.');
      },
      onCountdown: (t) => {
        gamepadManager.showCountdown(t);
      },
      onReturnedToLobby: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.selectedHostGame = mode || 'PONG';
        gamepadManager.renderGameController('LOBBY');
        showInstallToast(`📺 Lobiye dönüldü.`);
      },
      onSlotChanged: (slotIndex, color) => {
        gamepadManager.updateSlot(slotIndex, color);
        showInstallToast(`💺 Koltuğunuz değişti: P${slotIndex + 1}`);
      },
      onSlotsUpdate: (slots) => {
        gamepadManager.updateSlots(slots);
      },
      onGameState: (data) => {
        gamepadManager.handleStateSync(data);
      },
      onError: (err) => {
        showInstallToast(`❌ ${err}`);
      },
      onHostDisconnected: (msg) => {
        showInstallToast(msg);
        gamepadManager.hide();
        menuOverlay?.classList.remove('hidden');
      },
    });
  } catch (err) {
    console.error('[Join] Odaya bağlanılamadı:', err);
    const detail = err?.message ? ` Sebep: ${err.message}` : '';
    showInstallToast(`Odaya bağlanılamadı. Kodun doğruluğunu kontrol edin.${detail}`);
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
  activeNet().swapSlots(0, 2);
  activeNet().swapSlots(2, 1);
  activeNet().swapSlots(1, 3);
  if (!activeNet().isHosting) {
    const p0 = hostPlayerSlots[0];
    const p1 = hostPlayerSlots[1];
    const p2 = hostPlayerSlots[2];
    const p3 = hostPlayerSlots[3];
    hostPlayerSlots[0] = p3;
    hostPlayerSlots[2] = p0;
    hostPlayerSlots[1] = p2;
    hostPlayerSlots[3] = p1;
    const engine = getActiveGameEngine();
    if (engine) {
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 0, 2);
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 2, 1);
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 1, 3);
    }
  }
}

function returnHostToLobby() {
  exitStagingToLobby();
  if (!activeNet().isHosting) {
    setGameMode('MENU');
    return;
  }
  closePauseModal();
  setGameMode('MENU');
  activeNet().returnToLobby();
  openHostLobby(getCurrentHostGameMode());
}

function handleExitToMenu() {
  if (activeNet().isHosting) {
    const confirmed = window.confirm('Odayı kapatmak ve ana menüye dönmek istiyor musunuz? Tüm bağlı kumandaların bağlantısı kesilecektir.');
    if (!confirmed) return;
    closePauseModal();
    exitStagingToLobby();
    hideHostLobbyModal();
    for (let i = 0; i < 4; i++) updateHostSlot(i, false);
    activeNet().disconnect();
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

function refreshStagingBar() {
  if (!stagingMode) return;
  const connected = hostPlayerSlots.filter((p) => p !== null).length;
  const ready = hostPlayerSlots.filter((p) => p?.isReady).length;
  const pill = document.getElementById('staging-ready-pill');
  if (pill) pill.textContent = connected === 0 ? 'OYUNCU BEKLENİYOR' : `${connected} BAĞLANDI • ${ready} HAZIR`;
  const btn = document.getElementById('btn-staging-launch');
  if (btn) btn.textContent = `▶ MAÇI BAŞLAT (${ready}/${connected} HAZIR)`;
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
  num.textContent = t > 0 ? String(t) : 'BAŞLA!';
  ov.classList.remove('hidden');
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
  if (mode === 'PONG') pongGame.startGame();
  else if (mode === 'TANKS') tanksGame.startRound();
  else if (mode === 'CURVE') curveGame.startRound();
  else if (mode === 'BOMB') bombGame.startNewRound();
  else if (mode === 'HEIST') heistGame.startNewRound();
  else if (mode === 'DUEL') duelGame.startMatch();
}

// BAŞLAT #1: sahayı aç — motor LOBBY'de arena gösterir, koltuk seçimi başlar
function enterStaging(mode) {
  stagingMode = mode;
  seatsLocked = false;
  setGameMode(mode);
  activeNet().startStaging(mode);
  showStagingBar();
  showInstallToast('🏟 Saha açıldı! Herkes koltuğuna yerleşsin.');
}

// BAŞLAT #2: 3-2-1 → oyun (koltuklar kilitli)
function runCountdown() {
  if (!stagingMode || countdownTimer) return;
  const mode = stagingMode;
  seatsLocked = true;
  let t = 3;
  const tick = () => {
    if (t > 0) {
      showCountdownOverlay(t);
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

// Initialise UI Submodules
initToastAndInstall();
initJoinModal({ onExecuteJoin: executeJoin });
initHostLobby({
  getActiveNet: () => activeNet(),
  getPlatformMode: () => platformMode,
  onStageGame: (mode) => {
    enterStaging(mode);
  },
  onCloseLobby: () => {
    exitStagingToLobby();
    for (let i = 0; i < 4; i++) updateHostSlot(i, false);
    activeNet().disconnect();
    setGameMode('MENU');
  },
  onSwapSlots: (slotA, slotB) => {
    activeNet().swapSlots(slotA, slotB);
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
});

// Menu Card Tap Listeners
btnHeroCreateRoom?.addEventListener('click', () => openHostLobby('PONG'));
addTapListener(btnSelectPong, () => handleGameCardClick('PONG'));
addTapListener(btnSelectTanks, () => handleGameCardClick('TANKS'));
addTapListener(btnSelectCurve, () => handleGameCardClick('CURVE'));
addTapListener(btnSelectBomb, () => handleGameCardClick('BOMB'));
addTapListener(btnSelectHeist, () => handleGameCardClick('HEIST'));
addTapListener(btnSelectDuel, () => handleGameCardClick('DUEL'));

addTapListener(btnQuickTvLobby, returnHostToLobby);
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
  executeJoin(autoJoinCode, getStoredPlayerName() || 'OYUNCU');
}

// Best-effort goodbye beacon on page hide
function sendGoodbyeBeacon() {
  try {
    activeNet().disconnect();
  } catch {}
}
window.addEventListener('pagehide', sendGoodbyeBeacon);
window.addEventListener('beforeunload', sendGoodbyeBeacon);

// Service Worker Management
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => console.log('[PWA] ServiceWorker registered:', reg.scope))
      .catch((err) => console.warn('[PWA] ServiceWorker registration failed:', err));
  });
}

// Warning for public site missing Supabase config
if (isPublicOrigin() && !HAS_SUPABASE_CONFIG) {
  showInstallToast('⚠️ ONLINE çalışmaz: Vercel Environment Variables eksik.');
}

// Throttled Host State Broadcaster (~16Hz)
let lastBroadcastTime = 0;
function broadcastGameStateIfNeeded(now) {
  if (!activeNet().isHosting || currentMode === 'MENU') return;
  if (now - lastBroadcastTime < 60) return;
  lastBroadcastTime = now;

  let packet = { gameMode: currentMode };
  if (currentMode === 'PONG') {
    packet.scores = pongGame.matchScores;
    packet.rally = pongGame.ball?.rallyCount || 0;
  } else if (currentMode === 'TANKS') {
    packet.scores = tanksGame.scores;
    packet.ammo = tanksGame.tanks.map((t) =>
      Math.max(0, (t.maxBullets || 2) - tanksGame.bullets.filter((b) => b.owner === t.index).length)
    );
    packet.alive = tanksGame.tanks.map((t) => t.isAlive);
  } else if (currentMode === 'CURVE') {
    packet.scores = curveGame.scores;
    packet.alive = curveGame.players.map((p) => p.alive);
  } else if (currentMode === 'BOMB') {
    packet.scores = bombGame.scores;
    packet.carrier = bombGame.bombCarrierIndex;
    packet.bombTime = Math.ceil(bombGame.bombTimer || 0);
  } else if (currentMode === 'HEIST') {
    packet.scores = heistGame.scores;
    packet.gemCarrier = heistGame.gemCarrierIndex;
    packet.timeLeft = Math.ceil(heistGame.roundTimer || 0);
  } else if (currentMode === 'DUEL') {
    packet.scores = duelGame.scores;
    packet.duelState = duelGame.state;
    packet.winner = duelGame.roundWinner;
  }

  activeNet().broadcastHostState(packet);
}

// Master Animation Loop (requestAnimationFrame)
function loop(timestamp) {
  broadcastGameStateIfNeeded(timestamp);

  const isPaused = getIsPaused();

  if (currentMode === 'PONG') {
    if (!isPaused) pongGame.update(timestamp);
    pongGame.render();
  } else if (currentMode === 'TANKS') {
    if (!isPaused) tanksGame.update(timestamp);
    tanksGame.render();
  } else if (currentMode === 'CURVE') {
    if (!isPaused) curveGame.update(timestamp);
    curveGame.render();
  } else if (currentMode === 'BOMB') {
    if (!isPaused) bombGame.update(timestamp);
    bombGame.render();
  } else if (currentMode === 'HEIST') {
    if (!isPaused) heistGame.update(timestamp);
    heistGame.render();
  } else if (currentMode === 'DUEL') {
    if (!isPaused) duelGame.update(timestamp);
    duelGame.render();
  } else if (currentMode === 'MENU') {
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.restore();
  }

  if (currentMode !== 'MENU') {
    const ctx = canvas.getContext('2d');
    touchManager.renderOverlay(ctx);
  }

  requestAnimationFrame(loop);
}

// Initial Setup
resizeCanvas();
setGameMode('MENU');
requestAnimationFrame(loop);
