// Local Party Games Suite - Main Application Controller & State Machine
import { Game as PongGame } from './games/game.js';
import { TanksGame } from './games/tanks.js';
import { CurveGame } from './games/curve.js';
import { BombGame } from './games/bomb.js';
import { HeistGame } from './games/heist.js';
import { DuelGame } from './games/duel.js';
import { CrownGame } from './games/crown.js';
import { TouchManager } from './touchManager.js';
import {
  GAME_ORDER,
  registerEngine,
  getEngine,
  getEngineGame,
  forEachEngine,
} from './core/engineRegistry.js';
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
import { hostPlayerSlots, updateHostSlot, syncSlotsToEngine, swapEngineSlots, isBotEkleEnabled } from './core/slotManager.js';
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

// Platform / Match Mode: 'LOCAL' | 'TV_CONSOLE' | 'ONLINE'
let platformMode = isPublicOrigin() && HAS_SUPABASE_CONFIG ? 'ONLINE' : 'TV_CONSOLE';
export function updatePlatformMode(newMode) {
  platformMode = newMode;
}

export function activeNet() {
  return getActiveNetwork(platformMode);
}

// State Machine: 'MENU' + GAME_ORDER ('PONG' | 'TANKS' | 'CURVE' | 'BOMB' | 'HEIST' | 'DUEL')
let currentMode = 'MENU';
let lastTransitionTime = 0;

export function markTransition() {
  lastTransitionTime = performance.now();
}

// Engine Instances + Registry (yeni oyun = 1 registerEngine satırı)
const touchManager = new TouchManager(canvas);
const pongGame = new PongGame(canvas);
const tanksGame = new TanksGame(canvas);
const curveGame = new CurveGame(canvas);
const bombGame = new BombGame(canvas);
const heistGame = new HeistGame(canvas);
const duelGame = new DuelGame(canvas);
const crownGame = new CrownGame(canvas);

function touchStamp(game, now) {
  game.lastTime = now;
}

registerEngine('PONG', {
  game: pongGame,
  reset: () => pongGame.resetCurrentGame(),
  onEnter: (now) => { pongGame.lastTime = now; pongGame.accumulator = 0; },
  onResume: (now) => { pongGame.lastTime = now; pongGame.accumulator = 0; },
  start: () => pongGame.startNewMatch(),
  packet: () => ({ scores: pongGame.matchScores, rally: pongGame.ball?.rallyCount || 0 }),
});
registerEngine('TANKS', {
  game: tanksGame,
  reset: () => tanksGame.resetMatch(),
  onEnter: (now) => touchStamp(tanksGame, now),
  onResume: (now) => touchStamp(tanksGame, now),
  start: () => tanksGame.startRound(),
  packet: () => ({
    scores: tanksGame.scores,
    ammo: tanksGame.tanks.map((t) => {
      const v = tanksGame.ammoVisual(t);
      return { n: v.readyCount, load: Math.round(v.progress * 100) / 100 };
    }),
    alive: tanksGame.tanks.map((t) => t.isAlive),
  }),
});
registerEngine('CURVE', {
  game: curveGame,
  reset: () => curveGame.resetMatch(),
  onEnter: (now) => touchStamp(curveGame, now),
  onResume: (now) => touchStamp(curveGame, now),
  start: () => curveGame.startRound(),
  packet: () => ({ scores: curveGame.scores, alive: curveGame.players.map((p) => p.alive) }),
});
registerEngine('BOMB', {
  game: bombGame,
  reset: () => bombGame.resetMatch(),
  onEnter: (now) => touchStamp(bombGame, now),
  onResume: (now) => touchStamp(bombGame, now),
  start: () => bombGame.startNewRound(),
  packet: () => ({
    scores: bombGame.scores,
    carrier: bombGame.bombCarrierIndex,
    bombTime: Math.ceil(bombGame.bombTimer || 0),
  }),
});
registerEngine('HEIST', {
  game: heistGame,
  reset: () => heistGame.resetMatch(),
  onEnter: (now) => touchStamp(heistGame, now),
  onResume: (now) => touchStamp(heistGame, now),
  start: () => heistGame.startNewRound(),
  packet: () => ({
    scores: heistGame.scores,
    gemCarrier: heistGame.gemCarrierIndex,
    timeLeft: Math.ceil(heistGame.roundTimer || 0),
  }),
});
registerEngine('DUEL', {
  game: duelGame,
  reset: () => duelGame.reset(),
  onEnter: (now) => touchStamp(duelGame, now),
  onResume: (now) => touchStamp(duelGame, now),
  start: () => duelGame.startNewMatch(),
  packet: () => ({ scores: duelGame.scores, duelState: duelGame.state, winner: duelGame.roundWinner }),
});
registerEngine('CROWN', {
  game: crownGame,
  reset: () => crownGame.resetMatch(),
  onEnter: (now) => touchStamp(crownGame, now),
  onResume: (now) => touchStamp(crownGame, now),
  start: () => crownGame.startNewRound(),
  packet: () => ({
    scores: crownGame.scores,
    king: crownGame.crown.carrierIndex,
    crownTimes: crownGame.players.map((p) => p.crownHoldTime),
  }),
});

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
  } else {
    const entry = getEngine(mode);
    if (entry) {
      menuOverlay.classList.add('hidden');
      inGameHud.classList.remove('hidden');
      touchManager.setHandler(entry.game);
      entry.reset();
      entry.onEnter(now);
      entry.game.resize(window.innerWidth, window.innerHeight);
      syncSlotsToEngine(entry.game, currentMode, activeNet().isHosting);
    }
  }
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

// Mobil tam ekran: kullanıcı dokunuşuyla (jest bağlamı) durum çubuğunu gizle.
// Kurulu PWA'da manifest (fullscreen) işi zaten yapar; bu, tarayıcıdan açanlar içindir.
function tryFullscreen() {
  try {
    if (!document.fullscreenElement && typeof document.documentElement.requestFullscreen === 'function') {
      const p = document.documentElement.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  } catch {}
}

// TV Host Room Creation
async function openHostLobby(gameMode = 'PONG') {
  tryFullscreen();
  setCurrentHostGameMode(gameMode);
  try {
    await activeNet().hostRoom(gameMode, {
      onRoomCreated: (roomCode) => {
        const joinUrl = getEffectiveJoinUrl(roomCode, platformMode);
        showHostLobbyModal(roomCode, joinUrl);
        startHostPingBadge(() => activeNet().ping, platformMode);
        setSeatTapHook();
        refreshHostSlotCards();
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
      onPlayerUpdated: (msg) => {
        const slot = hostPlayerSlots[msg.slotIndex];
        if (slot && slot.kind !== 'bot') {
          slot.name = msg.name;
          updateHostSlot(msg.slotIndex, true, msg.name, slot.isReady, slot.kind);
          refreshStagingBar();
          const engine = getActiveGameEngine();
          if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
          renderPauseSeats(handleSeatSwap);
        }
      },
      onPlayerReadyStatus: (slotIndex, isReady) => {
        if (hostPlayerSlots[slotIndex]) {
          updateHostSlot(slotIndex, true, hostPlayerSlots[slotIndex].name, isReady, hostPlayerSlots[slotIndex].kind);
          refreshStagingBar();
        }
      },
      onSlotsSwapped: (slotA, slotB) => {
        const temp = hostPlayerSlots[slotA];
        hostPlayerSlots[slotA] = hostPlayerSlots[slotB];
        hostPlayerSlots[slotB] = temp;
        if (hostPlayerSlots[slotA]) updateHostSlot(slotA, true, hostPlayerSlots[slotA].name, hostPlayerSlots[slotA].isReady, hostPlayerSlots[slotA].kind);
        else updateHostSlot(slotA, false);
        if (hostPlayerSlots[slotB]) updateHostSlot(slotB, true, hostPlayerSlots[slotB].name, hostPlayerSlots[slotB].isReady, hostPlayerSlots[slotB].kind);
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
  tryFullscreen();
  const code = (rawCode || '').trim().toUpperCase();
  const name = (rawName || '').trim().toUpperCase() || 'OYUNCU';

  if (!code || code.length < 3) {
    showInstallToast('Lütfen 3 haneli geçerli bir oda kodu girin.');
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
        gamepadManager.resetReady();
        gamepadManager.renderGameController(mode);
        showInstallToast(`▶ Oyun başladı: ${mode}`);
      },
      onStagingStarted: (mode) => {
        gamepadManager.enterStaging(mode);
        // Saha açılırken hazır da sıfırlanır (host tarafıyla aynı kural; geç kalmış
        // bayrak bir sonraki turun sayacına sızamaz)
        gamepadManager.resetReady();
        showInstallToast('🏟 Saha açıldı! Koltuğunu seç ve hazır ol.');
      },
      onCountdown: (t) => {
        gamepadManager.showCountdown(t);
      },
      onReturnedToLobby: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.resetReady();
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
    for (let i = 0; i < 4; i++) updateHostSlot(i, false);
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

function refreshStagingBar() {
  if (!stagingMode) return;
  const humans = hostPlayerSlots.filter((p) => p !== null && p.kind !== 'bot');
  const connected = humans.length;
  const ready = humans.filter((p) => p?.isReady).length;
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
  getEngine(mode)?.start();
}

// BAŞLAT #1: sahayı aç — motor LOBBY'de arena gösterir, koltuk seçimi başlar
function enterStaging(mode) {
  tryFullscreen();
  stagingMode = mode;
  seatsLocked = false;
  // Lobiden çıkışta herkes BEKLE'ye çekilir (yerel sıfırlama, ekstra çağrı yok —
  // aksi halde eski turun bayrağı yeni turun sayacına sızar)
  for (let i = 0; i < 4; i++) {
    const e = hostPlayerSlots[i];
    if (e) updateHostSlot(i, true, e.name, false, e.kind);
  }
  refreshStagingBar();
  setGameMode(mode);
  // Saha açılırken koltuklar bir kez daha yazılır (kurucu varsayılan botları ezilir)
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, mode, activeNet().isHosting);
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
const BOT_SEAT_NAMES = ['BOT // KIRMIZI', 'BOT // MAVİ', 'BOT // SARI', 'BOT // YEŞİL'];

function handleLobbySeatTap(index) {
  if (!activeNet().isHosting) return;
  // Bot ekleme kapalıysa normal akış: sadece oyuncu eklenir/çıkarılır
  if (!isBotEkleEnabled()) return;
  if (seatsLocked) {
    showInstallToast('⏳ Sayaç sırasında koltuk değiştirilemez.');
    return;
  }
  const entry = hostPlayerSlots[index];
  if (entry && entry.kind === 'bot') {
    removeBotSlot(index);
  } else if (!entry) {
    addBotSlot(index);
  } else {
    showInstallToast(`P${index + 1} dolu.`);
  }
}

function addBotSlot(index) {
  const name = BOT_SEAT_NAMES[index] || `BOT // P${index + 1}`;
  activeNet().setSlotBot?.(index, name);
  updateHostSlot(index, true, name, false, 'bot');
  refreshStagingBar();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  renderPauseSeats(handleSeatSwap);
  showInstallToast(`P${index + 1}: BOT eklendi.`);
}

function removeBotSlot(index) {
  activeNet().clearSlotBot?.(index);
  updateHostSlot(index, false);
  refreshStagingBar();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  renderPauseSeats(handleSeatSwap);
  showInstallToast(`P${index + 1} boşaltıldı.`);
}

// Motorların LOBBY tap'lerini host'a yönlendir (sadece host iken aktif)
function setSeatTapHook() {
  const fn = activeNet().isHosting ? handleLobbySeatTap : null;
  forEachEngine((mode, entry) => { entry.game.onLobbySeatTap = fn; });
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
    setSeatTapHook();
    setGameMode('MENU');
  },
  onSwapSlots: (slotA, slotB) => {
    activeNet().swapSlots(slotA, slotB);
  },
  onToggleBotSlot: (slotIndex) => {
    handleLobbySeatTap(slotIndex);
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
    showInstallToast(enabled ? '🤖 Bot ekleme AÇIK.' : 'Bot ekleme KAPALI.');
  },
});

// Menu Card Tap Listeners (buton id kuralı: btn-select-<lowercase mode>)
btnHeroCreateRoom?.addEventListener('click', () => openHostLobby('PONG'));
for (const mode of GAME_ORDER) {
  addTapListener(document.getElementById(`btn-select-${mode.toLowerCase()}`), () => handleGameCardClick(mode));
}

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

// Service Worker Management (with auto update & cache busting)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
        console.log('[PWA] ServiceWorker registered and updated:', reg.scope);
      })
      .catch((err) => console.warn('[PWA] ServiceWorker registration failed:', err));
  });
}

// Warning for public site missing Supabase config
if (isPublicOrigin() && !HAS_SUPABASE_CONFIG) {
  showInstallToast('⚠️ ONLINE çalışmaz: Vercel Environment Variables eksik.');
}

// Throttled Host State Broadcaster: 8Hz taban + değişiklikte anında gönderim.
// Kirlenme kontrolü güvenli — pakette timestamp/random yok (PING ayrı yolda).
// Skor/taşıyıcı/sinyal gibi kritik değişimler throttle beklemez (refleks korunur),
// sakin anlarda tekrar yayın yapılmaz (kota korunur).
let lastBroadcastTime = 0;
let lastBroadcastJson = '';
let lastCountdownT = 0;
function broadcastGameStateIfNeeded(now) {
  if (!activeNet().isHosting) return;

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

  const json = JSON.stringify(packet);
  const intervalElapsed = now - lastBroadcastTime >= 125;
  if (json === lastBroadcastJson && !intervalElapsed) return;

  lastBroadcastTime = now;
  lastBroadcastJson = json;
  activeNet().broadcastHostState(packet);
}

// Master Animation Loop (requestAnimationFrame)
function loop(timestamp) {
  broadcastGameStateIfNeeded(timestamp);

  const isPaused = getIsPaused();

  const loopEntry = getEngine(currentMode);
  if (loopEntry) {
    if (!isPaused) loopEntry.game.update(timestamp);
    loopEntry.game.render();
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
