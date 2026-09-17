// Local Party Games Suite - Main Application Controller & State Machine
import { Game as PongGame } from './game.js';
import { TanksGame } from './tanks.js';
import { CurveGame } from './curve.js';
import { BombGame } from './bomb.js';
import { HeistGame } from './heist.js';
import { DuelGame } from './duel.js';
import { TouchManager } from './touchManager.js';
import { toggleAudio, getIsMuted } from './audio.js';

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

function setupBannerActions() {
  const btnCreateTv = document.getElementById('btn-create-tv-room');
  const btnJoinController = document.getElementById('btn-join-as-controller');
  const btnCreateOnline = document.getElementById('btn-create-online-room');
  const btnEnterRoom = document.getElementById('btn-enter-room-code');

  btnCreateTv?.addEventListener('click', () => {
    showInstallToast('📺 TV Host Modu: Faz 2.2 WebSocket oda sunucusu hazırlanıyor...');
  });
  btnJoinController?.addEventListener('click', () => {
    showInstallToast('📱 Gamepad Modu: Oda kodunu girin veya TV ekranındaki QR kodu taratın.');
  });
  btnCreateOnline?.addEventListener('click', () => {
    showInstallToast('🌐 Online Oda: WhatsApp linki üretiliyor...');
  });
  btnEnterRoom?.addEventListener('click', () => {
    showInstallToast('🔗 Online Katılım: 4 haneli oda kodunu girin.');
  });
}

addTapListener(tabModeLocal, () => updatePlatformMode('LOCAL'));
addTapListener(tabModeTv, () => updatePlatformMode('TV_CONSOLE'));
addTapListener(tabModeOnline, () => updatePlatformMode('ONLINE'));

addTapListener(btnSelectPong, () => setGameMode('PONG'));
addTapListener(btnSelectTanks, () => setGameMode('TANKS'));
addTapListener(btnSelectCurve, () => setGameMode('CURVE'));
addTapListener(btnSelectBomb, () => setGameMode('BOMB'));
addTapListener(btnSelectHeist, () => setGameMode('HEIST'));
addTapListener(btnSelectDuel, () => setGameMode('DUEL'));

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

// Master Animation Loop (requestAnimationFrame)
function loop(timestamp) {
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

