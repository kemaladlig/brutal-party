// Local Party Games Suite - Main Application Controller & State Machine
import QRCode from 'qrcode';
import { Game as PongGame } from './game.js';
import { TanksGame } from './tanks.js';
import { CurveGame } from './curve.js';
import { BombGame } from './bomb.js';
import { HeistGame } from './heist.js';
import { DuelGame } from './duel.js';
import { TouchManager } from './touchManager.js';
import { toggleAudio, getIsMuted, playJoin } from './audio.js';
import { partyNetwork } from './network.js';
import { GamepadManager } from './gamepad.js';
import { PUBLIC_URL, HAS_SUPABASE_CONFIG, isPublicOrigin, getActiveNetwork, disconnectInactiveNetwork, getStoredPlayerName, storePlayerName } from './net.js';

// DOM Elements
const canvas = document.getElementById('game-canvas');
const menuOverlay = document.getElementById('menu-overlay');
const inGameHud = document.getElementById('in-game-hud');
const btnQuickTvLobby = document.getElementById('btn-quick-tv-lobby');
const btnOpenOptions = document.getElementById('btn-open-options');
const btnInstallApp = document.getElementById('btn-install-app');
const installToast = document.getElementById('install-toast');

// Pause & Options Modal
const pauseModal = document.getElementById('pause-modal');
const pauseGameTitle = document.getElementById('pause-game-title');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnResetMatch = document.getElementById('btn-reset-match');
const btnTvLobby = document.getElementById('btn-tv-lobby');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnExitToMenu = document.getElementById('btn-exit-to-menu');

const btnSelectPong = document.getElementById('btn-select-pong');
const btnSelectTanks = document.getElementById('btn-select-tanks');
const btnSelectCurve = document.getElementById('btn-select-curve');
const btnSelectBomb = document.getElementById('btn-select-bomb');
const btnSelectHeist = document.getElementById('btn-select-heist');
const btnSelectDuel = document.getElementById('btn-select-duel');

// Hero Action Elements
const heroInputCode = document.getElementById('hero-input-code');
const btnHeroJoin = document.getElementById('btn-hero-join');
const btnHeroPaste = document.getElementById('btn-hero-paste');
const btnHeroCreateRoom = document.getElementById('btn-hero-create-room');

// Platform / Match Mode: 'LOCAL' | 'TV_CONSOLE' | 'ONLINE'
let platformMode = isPublicOrigin() ? 'ONLINE' : 'TV_CONSOLE';

// Aktif moda göre network: TV_CONSOLE → lokal WebSocket / Supabase, ONLINE → Supabase Broadcast
function activeNet() {
  return getActiveNetwork(platformMode);
}

// State Machine: 'MENU' | 'PONG' | 'TANKS' | 'CURVE' | 'BOMB' | 'HEIST' | 'DUEL'
let currentMode = 'MENU';
let isPaused = false;
let lastTransitionTime = 0;
let deferredInstallPrompt = null;

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function updateInstallButtonVisibility() {
  if (isStandaloneApp()) {
    btnInstallApp?.classList.add('hidden');
  }
}

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

// High-DPI & Responsive 1:1 Canvas Resizing
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Set internal resolution for crisp rendering
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);

  // Set CSS viewport dimensions
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  // Scale context to DPR
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Update touch manager with exact logical dimensions
  touchManager.setDimensions(width, height, dpr);

  // Resize active engines
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
  isPaused = false;
  pauseModal.classList.add('hidden');
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
  } else if (mode === 'TANKS') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(tanksGame);
    tanksGame.resetMatch();
    tanksGame.lastTime = now;
    tanksGame.resize(window.innerWidth, window.innerHeight);
  } else if (mode === 'CURVE') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(curveGame);
    curveGame.resetMatch();
    curveGame.lastTime = now;
    curveGame.resize(window.innerWidth, window.innerHeight);
  } else if (mode === 'BOMB') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(bombGame);
    bombGame.resetMatch();
    bombGame.lastTime = now;
    bombGame.resize(window.innerWidth, window.innerHeight);
  } else if (mode === 'HEIST') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(heistGame);
    heistGame.resetMatch();
    heistGame.lastTime = now;
    heistGame.resize(window.innerWidth, window.innerHeight);
  } else if (mode === 'DUEL') {
    menuOverlay.classList.add('hidden');
    inGameHud.classList.remove('hidden');
    touchManager.setHandler(duelGame);
    duelGame.reset();
    duelGame.lastTime = now;
    duelGame.resize(window.innerWidth, window.innerHeight);
  }
}

// Pause Modal Functions
function openPauseModal() {
  if (currentMode === 'MENU') return;
  isPaused = true;
  pauseModal.classList.remove('hidden');
  pauseGameTitle.textContent =
    currentMode === 'PONG'
      ? '01 // BRUTAL PONG'
      : currentMode === 'TANKS'
      ? '02 // MICRO-TANKS'
      : currentMode === 'CURVE'
      ? '03 // BRUTAL CURVE'
      : currentMode === 'BOMB'
      ? '04 // BRUTAL BOMB'
      : currentMode === 'HEIST'
      ? '05 // BRUTAL HEIST'
      : '06 // QUICK DRAW';
  btnToggleSound.textContent = getIsMuted() ? '🔇 SES: KAPALI' : '🔊 SES: AÇIK';
  if (btnTvLobby) {
    btnTvLobby.classList.toggle('hidden', !activeNet().isHosting);
  }
  if (btnExitToMenu) {
    btnExitToMenu.textContent = activeNet().isHosting ? '🚪 ODAYI KAPAT & ANA MENÜYE DÖN' : '⌂ ANA MENÜYE DÖN';
  }
  touchManager.resetTouches();
}

function closePauseModal() {
  markTransition();
  pauseModal.classList.add('hidden');
  isPaused = false;
  touchManager.resetTouches();

  // Refresh active game lastTime to prevent physics delta jump after pause
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
}

function resetActiveGame() {
  closePauseModal();
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

// Ultra-responsive Tap/Click Listeners for Mobile & Desktop
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
      // Trigger immediately if movement < 14px and tap < 450ms
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

function updatePlatformMode(newMode) {
  platformMode = newMode;
}

// TV Host & Controller Modals
const tvHostModal = document.getElementById('tv-host-modal');
const hostRoomCode = document.getElementById('host-room-code');
const hostJoinUrl = document.getElementById('host-join-url');
const qrCanvas = document.getElementById('qr-canvas');
const btnHostLaunchGame = document.getElementById('btn-host-launch-game');
const btnHostClose = document.getElementById('btn-host-close');
const btnHostCopyLink = document.getElementById('btn-host-copy-link');
const btnHostWhatsappShare = document.getElementById('btn-host-whatsapp-share');

const joinRoomModal = document.getElementById('join-room-modal');
const inputRoomCode = document.getElementById('input-room-code');
const inputPlayerName = document.getElementById('input-player-name');
const btnSubmitJoin = document.getElementById('btn-submit-join');
const btnCancelJoin = document.getElementById('btn-cancel-join');
const btnPasteRoomCode = document.getElementById('btn-paste-room-code');

const gamepadOverlay = document.getElementById('gamepad-overlay');
const gamepadManager = new GamepadManager(gamepadOverlay, partyNetwork);

let currentHostGameMode = 'PONG';

function getActiveGameEngine() {
  if (currentMode === 'PONG') return pongGame;
  if (currentMode === 'TANKS') return tanksGame;
  if (currentMode === 'CURVE') return curveGame;
  if (currentMode === 'BOMB') return bombGame;
  if (currentMode === 'HEIST') return heistGame;
  if (currentMode === 'DUEL') return duelGame;
  return null;
}

const hostPlayerSlots = [null, null, null, null];

// Host lobisinde ping göstergesi (özellikle ONLINE modda gecikmeyi gösterir)
let hostPingTimer = null;
function startHostPingBadge() {
  stopHostPingBadge();
  const badge = document.querySelector('.tv-host-badge');
  if (!badge) return;
  const baseText = platformMode === 'ONLINE' ? '🌐 ONLINE LOBİ' : '📺 TV HOST PARTİ LOBİSİ';
  const tick = () => {
    const ping = activeNet().ping || 0;
    badge.textContent = (platformMode === 'ONLINE' || isPublicOrigin()) && ping > 0
      ? `${baseText} • ${ping}ms`
      : baseText;
  };
  tick();
  hostPingTimer = window.setInterval(tick, 2000);
}
function stopHostPingBadge() {
  if (hostPingTimer) {
    window.clearInterval(hostPingTimer);
    hostPingTimer = null;
  }
}

function updateHostSlot(slotIndex, isConnected, name = '', isReady = false) {
  const slotEl = document.getElementById(`slot-p${slotIndex + 1}`);
  const readyTag = document.getElementById(`ready-tag-p${slotIndex + 1}`);
  if (!slotEl) return;

  const nameEl = slotEl.querySelector('.slot-name');
  if (isConnected) {
    hostPlayerSlots[slotIndex] = { name, isReady };
    slotEl.classList.add('connected');
    slotEl.classList.toggle('ready', isReady); // green border glow
    if (nameEl) nameEl.textContent = name;
    if (readyTag) {
      readyTag.textContent = isReady ? '✓ HAZIR' : '⏳ BEKLİYOR';
      readyTag.classList.toggle('ready', isReady);
    }
  } else {
    hostPlayerSlots[slotIndex] = null;
    slotEl.classList.remove('connected', 'ready');
    if (nameEl) nameEl.textContent = 'BEKLENİYOR...';
    if (readyTag) {
      readyTag.textContent = '— BOŞ';
      readyTag.classList.remove('ready');
    }
  }

  const connectedCount = hostPlayerSlots.filter((p) => p !== null).length;
  const readyCount = hostPlayerSlots.filter((p) => p?.isReady).length;
  const readyCounter = document.getElementById('lobby-ready-counter');
  if (readyCounter) {
    if (connectedCount === 0) {
      readyCounter.textContent = 'OYUNCU BEKLENİYOR';
    } else if (readyCount === connectedCount) {
      readyCounter.textContent = `✓ ${readyCount}/${connectedCount} HAZIR — BAŞLATILABILIR`;
    } else {
      readyCounter.textContent = `${connectedCount} BAĞLANDI • ${readyCount} HAZIR`;
    }
  }
}

let detectedLanIp = null;
fetch('/api/lan-ip')
  .then((res) => res.json())
  .then((data) => {
    if (data?.ip) detectedLanIp = `${data.ip}:${data.port || 5173}`;
  })
  .catch(() => {});

function getEffectiveJoinUrl(roomCode) {
  // ONLINE modda davet linki her zaman public URL'den çıkar (uzaktaki oyuncu için).
  // TV_CONSOLE modunda aynı Wi-Fi'deki cihazlar için LAN IP kullanılır.
  if (platformMode === 'ONLINE' || isPublicOrigin()) {
    return `${PUBLIC_URL}/?join=${roomCode}`;
  }
  let baseOrigin = window.location.origin;
  if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && detectedLanIp) {
    baseOrigin = `http://${detectedLanIp}`;
  }
  return `${baseOrigin}/?join=${roomCode}`;
}

async function openHostLobby(gameMode = 'PONG') {
  // Public sitede Supabase yoksa oda açılamaz
  if (isPublicOrigin() && !HAS_SUPABASE_CONFIG) {
    showInstallToast('⚠️ Supabase yapılandırması eksik. Vercel Environment Variables ayarlarını kontrol edin.');
    return;
  }

  currentHostGameMode = gameMode;
  const net = activeNet();

  // Halihazırda aktif bir oda host ediliyorsa (maç ortasında veya sonrasında lobiye dönüldüyse)
  // odayı kapatma / yeniden kurma; mevcut odayı ve bağlı kumandaları koru
  if (net.isHosting && net.roomCode) {
    net.setHostGameMode(gameMode);
    net.returnToLobby();

    // Sync lobby game chips UI
    document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
      chip.classList.toggle('active', chip.dataset.game === currentHostGameMode);
    });

    const launchBtn = document.getElementById('btn-host-launch-game');
    if (launchBtn) {
      launchBtn.textContent = `▶ ${currentHostGameMode} BAŞLAT`;
    }

    // Refresh slots UI from current hostPlayerSlots
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      if (slot) {
        updateHostSlot(i, true, slot.name, slot.isReady);
      } else {
        updateHostSlot(i, false);
      }
    }

    const channelCodeEl = document.getElementById('host-channel-code');
    if (channelCodeEl && net.roomCode) channelCodeEl.textContent = net.roomCode;

    tvHostModal?.classList.remove('hidden');
    startHostPingBadge();
    return;
  }

  for (let i = 0; i < 4; i++) updateHostSlot(i, false);

  // Mod değişiminde diğer transportun hayalet bağlantısını kapat
  disconnectInactiveNetwork(platformMode);

  // Sync lobby game chips UI
  document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.game === currentHostGameMode);
  });

  const launchBtn = document.getElementById('btn-host-launch-game');
  if (launchBtn) {
    launchBtn.textContent = `▶ ${currentHostGameMode} BAŞLAT`;
  }

  try {
    await net.hostRoom(gameMode, {
      onRoomCreated: (roomCode) => {
        if (hostRoomCode) hostRoomCode.textContent = roomCode;
        const channelCodeEl = document.getElementById('host-channel-code');
        if (channelCodeEl) channelCodeEl.textContent = roomCode;
        const joinUrl = getEffectiveJoinUrl(roomCode);
        if (hostJoinUrl) hostJoinUrl.textContent = joinUrl;

        if (qrCanvas) {
          QRCode.toCanvas(qrCanvas, joinUrl, {
            width: 140,
            margin: 1,
            color: { dark: '#1A1A1A', light: '#FFFFFF' },
          });
        }
        tvHostModal?.classList.remove('hidden');
        startHostPingBadge();
      },
      onPlayerJoined: (msg) => {
        playJoin();
        updateHostSlot(msg.slotIndex, true, msg.name, false);
        showInstallToast(`🎮 ${msg.name} kumanda olarak bağlandı!`);
      },
      onPlayerLeft: (msg) => {
        updateHostSlot(msg.slotIndex, false);
        showInstallToast(`🚪 ${msg.name} odadan ayrıldı.`);
      },
      onPlayerReadyStatus: (slotIndex, isReady) => {
        if (hostPlayerSlots[slotIndex]) {
          updateHostSlot(slotIndex, true, hostPlayerSlots[slotIndex].name, isReady);
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
        showInstallToast(`🔄 Slot P${slotA + 1} ve P${slotB + 1} yer değiştirdi.`);
      },
      onPlayerInput: (slotIndex, data) => {
        // Handle name change from controller
        if (data.action === 'SET_NAME' && data.name) {
          const slot = hostPlayerSlots[slotIndex];
          if (slot) {
            slot.name = data.name.slice(0, 12).toUpperCase();
            updateHostSlot(slotIndex, true, slot.name, slot.isReady);
          }
          return; // Don't forward name change to game engine
        }
        // Handle slot switch requested by controller
        if (data.action === 'SWITCH_SLOT' && typeof data.targetSlot === 'number') {
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

// Game selector chips in Host Lobby
document.querySelectorAll('.lobby-game-chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.lobby-game-chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    currentHostGameMode = chip.dataset.game;
    activeNet().setHostGameMode(currentHostGameMode);
    const launchBtn = document.getElementById('btn-host-launch-game');
    if (launchBtn) {
      launchBtn.textContent = `▶ ${currentHostGameMode} BAŞLAT`;
    }
  });
});

// Slot swap buttons in Host Lobby
document.querySelectorAll('.slot-swap-btn').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const slotA = parseInt(btn.dataset.slot, 10);
    const slotB = (slotA + 1) % 4;
    activeNet().swapSlots(slotA, slotB);
  });
});

btnHostLaunchGame?.addEventListener('click', () => {
  tvHostModal?.classList.add('hidden');
  stopHostPingBadge();
  activeNet().startGame(currentHostGameMode);
  setGameMode(currentHostGameMode);
});

btnHostClose?.addEventListener('click', () => {
  const confirmed = window.confirm('Lobi kapatılsın mı? Tüm bağlı kumandaların bağlantısı kesilecektir.');
  if (!confirmed) return;
  tvHostModal?.classList.add('hidden');
  stopHostPingBadge();
  for (let i = 0; i < 4; i++) updateHostSlot(i, false);
  activeNet().disconnect();
  setGameMode('MENU');
});

btnHostCopyLink?.addEventListener('click', async () => {
  const code = hostRoomCode?.textContent?.trim() || '';
  const joinUrl = getEffectiveJoinUrl(code);
  try {
    await navigator.clipboard.writeText(joinUrl);
    showInstallToast('✓ Bağlantı panoya kopyalandı!');
  } catch (err) {
    showInstallToast(`Bağlantı: ${joinUrl}`);
  }
});

btnHostWhatsappShare?.addEventListener('click', () => {
  const code = hostRoomCode?.textContent?.trim() || '';
  const joinUrl = getEffectiveJoinUrl(code);
  const text = encodeURIComponent(`🎮 BRUTAL PARTY // 4P odasına katıl!\nOda Kodu: #${code}\nBağlantı: ${joinUrl}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
});

function openJoinModal(prefilledCode = '') {
  if (inputRoomCode) {
    inputRoomCode.value = prefilledCode.toUpperCase();
  }
  // İsmi hatırlıyorsak önceden doldur
  if (inputPlayerName && !inputPlayerName.value) {
    inputPlayerName.value = getStoredPlayerName();
  }
  joinRoomModal?.classList.remove('hidden');
}

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

btnCancelJoin?.addEventListener('click', () => {
  joinRoomModal?.classList.add('hidden');
});

async function executeJoin(rawCode, rawName) {
  const code = (rawCode || '').trim().toUpperCase();
  const name = (rawName || '').trim().toUpperCase() || 'OYUNCU';

  if (!code || code.length < 4) {
    showInstallToast('Lütfen 4 haneli geçerli bir oda kodu girin.');
    return;
  }

  // İsmi hatırla — yanlışlıkla kapanırsa tekrar yazmak gerekmez
  storePlayerName(name);

  showInstallToast(`⏳ #${code} odasına bağlanılıyor...`);

  // Katılım da mod bazlı: ONLINE → Supabase, TV → lokal WebSocket
  disconnectInactiveNetwork(platformMode);
  const net = activeNet();
  // Gamepad input'ları aktif transporta gitsin
  gamepadManager.network = net;

  try {
    await net.joinRoom(code, name, {
      onJoinedSuccess: (msg) => {
        joinRoomModal?.classList.add('hidden');
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
        gamepadManager.renderGameController(mode);
        showInstallToast(`▶ Oyun başladı: ${mode}`);
      },
      onReturnedToLobby: (mode) => {
        gamepadManager.selectedHostGame = mode || 'PONG';
        gamepadManager.renderGameController('LOBBY');
        showInstallToast(`📺 Lobiye dönüldü.`);
      },
      onSlotChanged: (slotIndex, color) => {
        gamepadManager.updateSlot(slotIndex, color);
        showInstallToast(`💺 Koltuğunuz değişti: P${slotIndex + 1}`);
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

btnSubmitJoin?.addEventListener('click', () => {
  executeJoin(inputRoomCode?.value, inputPlayerName?.value);
});

inputPlayerName?.addEventListener('input', (e) => {
  e.target.value = (e.target.value || '').toUpperCase();
});

inputRoomCode?.addEventListener('input', (e) => {
  const code = (e.target.value || '').trim().toUpperCase();
  e.target.value = code;
  if (code.length === 4) {
    executeJoin(code, (inputPlayerName?.value || getStoredPlayerName() || 'OYUNCU').toUpperCase());
  }
});

// Hero Actions (Primary Controller Join & Big Screen TV Host)
btnHeroJoin?.addEventListener('click', () => {
  const code = heroInputCode?.value?.trim().toUpperCase();
  if (!code || code.length < 4) {
    openJoinModal(code);
    return;
  }
  executeJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
});

heroInputCode?.addEventListener('input', (e) => {
  const code = (e.target.value || '').trim().toUpperCase();
  e.target.value = code;
  if (code.length === 4) {
    executeJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
  }
});

heroInputCode?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const code = heroInputCode?.value?.trim().toUpperCase();
    if (code && code.length === 4) {
      executeJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
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
        executeJoin(code, (getStoredPlayerName() || 'OYUNCU').toUpperCase());
      }
    }
  } catch (err) {
    showInstallToast('Pano okunamadı, kodu elle yazabilirsiniz.');
  }
});

btnHeroCreateRoom?.addEventListener('click', () => {
  openHostLobby('PONG');
});

function handleGameCardClick(mode) {
  if (activeNet().isHosting) {
    openHostLobby(mode);
  } else {
    setGameMode(mode);
  }
}

addTapListener(btnSelectPong, () => handleGameCardClick('PONG'));
addTapListener(btnSelectTanks, () => handleGameCardClick('TANKS'));
addTapListener(btnSelectCurve, () => handleGameCardClick('CURVE'));
addTapListener(btnSelectBomb, () => handleGameCardClick('BOMB'));
addTapListener(btnSelectHeist, () => handleGameCardClick('HEIST'));
addTapListener(btnSelectDuel, () => handleGameCardClick('DUEL'));

function returnHostToLobby() {
  if (!activeNet().isHosting) {
    setGameMode('MENU');
    return;
  }
  closePauseModal();
  setGameMode('MENU');
  activeNet().returnToLobby();
  openHostLobby(currentHostGameMode);
}

addTapListener(btnQuickTvLobby, returnHostToLobby);
addTapListener(btnTvLobby, returnHostToLobby);
addTapListener(btnOpenOptions, openPauseModal);
addTapListener(btnResumeGame, closePauseModal);
addTapListener(btnResetMatch, resetActiveGame);
addTapListener(btnToggleSound, () => {
  const muted = toggleAudio();
  btnToggleSound.textContent = muted ? '🔇 SES: KAPALI' : '🔊 SES: AÇIK';
});
addTapListener(btnExitToMenu, () => {
  if (activeNet().isHosting) {
    const confirmed = window.confirm('Odayı kapatmak ve ana menüye dönmek istiyor musunuz? Tüm bağlı kumandaların bağlantısı kesilecektir.');
    if (!confirmed) return;
    closePauseModal();
    tvHostModal?.classList.add('hidden');
    stopHostPingBadge();
    for (let i = 0; i < 4; i++) updateHostSlot(i, false);
    activeNet().disconnect();
    setGameMode('MENU');
  } else {
    closePauseModal();
    setGameMode('MENU');
  }
});

function showInstallToast(message) {
  if (!installToast) return;
  installToast.textContent = message;
  installToast.classList.add('visible');
  window.clearTimeout(showInstallToast.timer);
  showInstallToast.timer = window.setTimeout(() => {
    installToast.classList.remove('visible');
  }, 5000);
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  btnInstallApp?.classList.add('available');
  updateInstallButtonVisibility();
});

btnInstallApp?.addEventListener('click', async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      showInstallToast('BRUTAL PARTY ana ekrana eklendi.');
    }
    deferredInstallPrompt = null;
    btnInstallApp.classList.remove('available');
    return;
  }

  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showInstallToast(
    isIos
      ? 'Safari: Paylaş → Ana Ekrana Ekle seçeneğini kullan.'
      : 'Tarayıcı menüsünden "Ana ekrana ekle" veya "Uygulamayı yükle" seçeneğini kullan.'
  );
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  btnInstallApp?.classList.add('hidden');
  showInstallToast('BRUTAL PARTY ana ekrana eklendi.');
});

updateInstallButtonVisibility();

// Initial Setup
resizeCanvas();
setGameMode('MENU');

// Public sitede Supabase bilgileri build'e gömülmemişse ONLINE çalışmaz —
// bunu oda açmaya çalışmadan, daha sayfa açılırken söyle.
if (isPublicOrigin() && !HAS_SUPABASE_CONFIG) {
  showInstallToast('⚠️ ONLINE çalışmaz: Vercel Environment Variables eksik. 3 değişkeni ekleyip cache\'siz Redeploy yapın.');
}

// Check URL query parameters for automatic controller join (QR scan or link)
const urlParams = new URLSearchParams(window.location.search);
const autoJoinCode = urlParams.get('join');
if (autoJoinCode) {
  // Public URL'den gelen davet = ONLINE mod (Supabase relay üzerinden katıl)
  if (isPublicOrigin()) {
    updatePlatformMode('ONLINE');
  }
  openJoinModal(autoJoinCode);
  executeJoin(autoJoinCode, getStoredPlayerName() || 'OYUNCU');
}

// Sayfa kapanırken host/oyuncu tarafına best-effort veda mesajı.
// (TV/WS modunda sunucu socket kapanışını zaten algılar; bu özellikle
//  Supabase ONLINE modu içindir — gönderim garanti değildir ama çoğunlukla ulaşır.)
function sendGoodbyeBeacon() {
  try {
    activeNet().disconnect();
  } catch {
    // kapanış anı — sessiz geç
  }
}
window.addEventListener('pagehide', sendGoodbyeBeacon);
window.addEventListener('beforeunload', sendGoodbyeBeacon);

// Service Worker Management
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update();
        console.log('[PWA] ServiceWorker registered:', reg.scope);
      })
      .catch((err) => {
        console.warn('[PWA] ServiceWorker registration failed:', err);
      });
  });
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

  if (currentMode === 'PONG') {
    if (!isPaused) {
      pongGame.update(timestamp);
    }
    pongGame.render();
  } else if (currentMode === 'TANKS') {
    if (!isPaused) {
      tanksGame.update(timestamp);
    }
    tanksGame.render();
  } else if (currentMode === 'CURVE') {
    if (!isPaused) {
      curveGame.update(timestamp);
    }
    curveGame.render();
  } else if (currentMode === 'BOMB') {
    if (!isPaused) {
      bombGame.update(timestamp);
    }
    bombGame.render();
  } else if (currentMode === 'HEIST') {
    if (!isPaused) {
      heistGame.update(timestamp);
    }
    heistGame.render();
  } else if (currentMode === 'DUEL') {
    if (!isPaused) {
      duelGame.update(timestamp);
    }
    duelGame.render();
  } else if (currentMode === 'MENU') {
    // Subtle background render under menu
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.restore();
  }

  // Draw responsive brutalist touch feedback overlay
  if (currentMode !== 'MENU') {
    const ctx = canvas.getContext('2d');
    touchManager.renderOverlay(ctx);
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

