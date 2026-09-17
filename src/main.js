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

// DOM Elements
const canvas = document.getElementById('game-canvas');
const menuOverlay = document.getElementById('menu-overlay');
const inGameHud = document.getElementById('in-game-hud');
const btnOpenOptions = document.getElementById('btn-open-options');
const btnInstallApp = document.getElementById('btn-install-app');
const installToast = document.getElementById('install-toast');

// Pause & Options Modal
const pauseModal = document.getElementById('pause-modal');
const pauseGameTitle = document.getElementById('pause-game-title');
const btnResumeGame = document.getElementById('btn-resume-game');
const btnResetMatch = document.getElementById('btn-reset-match');
const btnToggleSound = document.getElementById('btn-toggle-sound');
const btnExitToMenu = document.getElementById('btn-exit-to-menu');

const btnSelectPong = document.getElementById('btn-select-pong');
const btnSelectTanks = document.getElementById('btn-select-tanks');
const btnSelectCurve = document.getElementById('btn-select-curve');
const btnSelectBomb = document.getElementById('btn-select-bomb');
const btnSelectHeist = document.getElementById('btn-select-heist');
const btnSelectDuel = document.getElementById('btn-select-duel');

// Mode Switcher Elements
const tabModeLocal = document.getElementById('tab-mode-local');
const tabModeTv = document.getElementById('tab-mode-tv');
const tabModeOnline = document.getElementById('tab-mode-online');
const modeActionBanner = document.getElementById('mode-action-banner');

// Platform / Match Mode: 'LOCAL' | 'TV_CONSOLE' | 'ONLINE'
let platformMode = 'LOCAL';

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
  tabModeLocal?.classList.toggle('active', newMode === 'LOCAL');
  tabModeLocal?.setAttribute('aria-selected', newMode === 'LOCAL');

  tabModeTv?.classList.toggle('active', newMode === 'TV_CONSOLE');
  tabModeTv?.setAttribute('aria-selected', newMode === 'TV_CONSOLE');

  tabModeOnline?.classList.toggle('active', newMode === 'ONLINE');
  tabModeOnline?.setAttribute('aria-selected', newMode === 'ONLINE');

  if (!modeActionBanner) return;

  modeActionBanner.className = 'mode-banner';
  if (newMode === 'LOCAL') {
    modeActionBanner.classList.add('local-banner');
    modeActionBanner.innerHTML = `
      <div class="banner-badge">📱 MASADA OYNA</div>
      <div class="banner-content">
        <div class="banner-title">Masa Ortası Tek Cihaz Modu Aktif</div>
        <div class="banner-desc">Telefonu veya tableti masanın ortasına koyun, bir oyun seçip hemen başlayın. İnternet gerekmez!</div>
      </div>
    `;
  } else if (newMode === 'TV_CONSOLE') {
    modeActionBanner.classList.add('tv-banner');
    modeActionBanner.innerHTML = `
      <div class="banner-badge">📺 TV + TELEFON</div>
      <div class="banner-content">
        <div class="banner-title">TV Konsol Modu (AirConsole & Jackbox Modeli)</div>
        <div class="banner-desc">Bu ekranı TV'ye yansıtıp Host yapın veya telefonunuzu kumanda olarak bağlayın.</div>
        <div class="banner-actions">
          <button class="banner-action-btn" id="btn-create-tv-room" type="button">📺 BU EKRANI TV HOST YAP</button>
          <button class="banner-action-btn secondary" id="btn-join-as-controller" type="button">📱 KUMANDA OLARAK KATIL</button>
        </div>
      </div>
    `;
    setupBannerActions();
  } else if (newMode === 'ONLINE') {
    modeActionBanner.classList.add('online-banner');
    modeActionBanner.innerHTML = `
      <div class="banner-badge">🌐 UZAKTAN MAÇ</div>
      <div class="banner-content">
        <div class="banner-title">Online Çok Oyunculu Mod (İstanbul <-> Ankara)</div>
        <div class="banner-desc">Farklı şehirlerden arkadaşlarınızla WhatsApp oda linkiyle bağlanın.</div>
        <div class="banner-actions">
          <button class="banner-action-btn" id="btn-create-online-room" type="button">🌐 YENİ ONLINE ODA AÇ</button>
          <button class="banner-action-btn secondary" id="btn-enter-room-code" type="button">🔗 ODA KODU İLE KATIL</button>
        </div>
      </div>
    `;
    setupBannerActions();
  }
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

function updateHostSlot(slotIndex, isConnected, name = '') {
  const slotEl = document.getElementById(`slot-p${slotIndex + 1}`);
  if (!slotEl) return;
  const nameEl = slotEl.querySelector('.slot-name');
  if (nameEl) {
    if (isConnected) {
      nameEl.textContent = `✓ ${name} [P${slotIndex + 1} - BAĞLANDI]`;
      slotEl.style.borderColor = '#2F6A4F';
      slotEl.style.backgroundColor = '#F0F9F4';
    } else {
      nameEl.textContent = `P${slotIndex + 1} // BEKLENİYOR...`;
      slotEl.style.borderColor = '#1A1A1A';
      slotEl.style.backgroundColor = '#FFFFFF';
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
  let baseOrigin = window.location.origin;
  if ((window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && detectedLanIp) {
    baseOrigin = `http://${detectedLanIp}`;
  }
  return `${baseOrigin}/?join=${roomCode}`;
}

async function openHostLobby(gameMode = 'PONG') {
  currentHostGameMode = gameMode;
  for (let i = 0; i < 4; i++) updateHostSlot(i, false);

  try {
    await partyNetwork.hostRoom(gameMode, {
      onRoomCreated: (roomCode) => {
        if (hostRoomCode) hostRoomCode.textContent = roomCode;
        const joinUrl = getEffectiveJoinUrl(roomCode);
        if (hostJoinUrl) hostJoinUrl.textContent = joinUrl;

        if (qrCanvas) {
          QRCode.toCanvas(qrCanvas, joinUrl, {
            width: 150,
            margin: 1,
            color: { dark: '#1A1A1A', light: '#FFFFFF' },
          });
        }
        tvHostModal?.classList.remove('hidden');
      },
      onPlayerJoined: (msg) => {
        playJoin();
        updateHostSlot(msg.slotIndex, true, msg.name);
        showInstallToast(`🎮 ${msg.name} kumanda olarak bağlandı!`);
      },
      onPlayerLeft: (msg) => {
        updateHostSlot(msg.slotIndex, false);
        showInstallToast(`🚪 ${msg.name} odadan ayrıldı.`);
      },
      onPlayerInput: (slotIndex, data) => {
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
    showInstallToast('Host odası açılamadı. Sunucu bağlantısını kontrol edin.');
  }
}

btnHostLaunchGame?.addEventListener('click', () => {
  tvHostModal?.classList.add('hidden');
  setGameMode(currentHostGameMode);
  partyNetwork.broadcastHostState({ gameMode: currentHostGameMode });
});

btnHostClose?.addEventListener('click', () => {
  tvHostModal?.classList.add('hidden');
  partyNetwork.disconnect();
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
  const name = (rawName || '').trim() || 'OYUNCU';

  if (!code || code.length < 4) {
    showInstallToast('Lütfen 4 haneli geçerli bir oda kodu girin.');
    return;
  }

  showInstallToast(`⏳ #${code} odasına bağlanılıyor...`);

  try {
    await partyNetwork.joinRoom(code, name, {
      onJoinedSuccess: (msg) => {
        joinRoomModal?.classList.add('hidden');
        menuOverlay?.classList.add('hidden');
        gamepadManager.init(msg, msg.gameMode);
        showInstallToast(`✓ ${msg.roomCode} odasına bağlandı!`);
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
    showInstallToast('Odaya bağlanılamadı. Kodun doğruluğunu kontrol edin.');
  }
}

btnSubmitJoin?.addEventListener('click', () => {
  executeJoin(inputRoomCode?.value, inputPlayerName?.value);
});

inputRoomCode?.addEventListener('input', (e) => {
  const code = (e.target.value || '').trim().toUpperCase();
  e.target.value = code;
  if (code.length === 4) {
    executeJoin(code, inputPlayerName?.value || 'OYUNCU');
  }
});

const btnQuickJoinMobile = document.getElementById('btn-quick-join-mobile');
btnQuickJoinMobile?.addEventListener('click', () => openJoinModal());

function setupBannerActions() {
  const btnCreateTv = document.getElementById('btn-create-tv-room');
  const btnJoinController = document.getElementById('btn-join-as-controller');
  const btnCreateOnline = document.getElementById('btn-create-online-room');
  const btnEnterRoom = document.getElementById('btn-enter-room-code');

  btnCreateTv?.addEventListener('click', () => openHostLobby('PONG'));
  btnJoinController?.addEventListener('click', () => openJoinModal());
  btnCreateOnline?.addEventListener('click', () => openHostLobby('PONG'));
  btnEnterRoom?.addEventListener('click', () => openJoinModal());
}

addTapListener(tabModeLocal, () => updatePlatformMode('LOCAL'));
addTapListener(tabModeTv, () => updatePlatformMode('TV_CONSOLE'));
addTapListener(tabModeOnline, () => updatePlatformMode('ONLINE'));

function handleGameCardClick(mode) {
  if (platformMode === 'TV_CONSOLE' || platformMode === 'ONLINE') {
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

addTapListener(btnOpenOptions, openPauseModal);
addTapListener(btnResumeGame, closePauseModal);
addTapListener(btnResetMatch, resetActiveGame);
addTapListener(btnToggleSound, () => {
  const muted = toggleAudio();
  btnToggleSound.textContent = muted ? '🔇 SES: KAPALI' : '🔊 SES: AÇIK';
});
addTapListener(btnExitToMenu, () => setGameMode('MENU'));

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

// Check URL query parameters for automatic controller join (QR scan or link)
const urlParams = new URLSearchParams(window.location.search);
const autoJoinCode = urlParams.get('join');
if (autoJoinCode) {
  openJoinModal(autoJoinCode);
  executeJoin(autoJoinCode, 'OYUNCU');
}

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
  if (!partyNetwork.isHosting || currentMode === 'MENU') return;
  if (now - lastBroadcastTime < 60) return;
  lastBroadcastTime = now;

  let packet = { gameMode: currentMode };
  if (currentMode === 'PONG') {
    packet.scores = pongGame.matchScores;
    packet.rally = pongGame.ball?.rallyCount || 0;
  } else if (currentMode === 'TANKS') {
    packet.scores = tanksGame.scores;
    packet.ammo = tanksGame.tanks.map((t) => t.ammo);
    packet.alive = tanksGame.tanks.map((t) => t.alive);
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

  partyNetwork.broadcastHostState(packet);
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

