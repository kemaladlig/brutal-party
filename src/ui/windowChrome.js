import { isFullscreen, toggleFullscreen, onFullscreenChange, canToggleFullscreen, armStandaloneFullscreen } from './fullscreen.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { t, onLangChange } from '../i18n.js';
import { showInstallToast } from './toast.js';
import { initUpdateManager } from '../core/updateManager.js';
import { playMenuTick } from '../audio.js';

const MAX_CANVAS_PIXELS = 2_100_000;

function effectiveDpr(width, height) {
  const raw = Math.min(window.devicePixelRatio || 1, 2.5);
  const pixels = width * height * raw * raw;
  if (pixels <= MAX_CANVAS_PIXELS) return raw;
  return Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
}

export function isTextEntryActive() {
  const el = /** @type {HTMLElement} */ (document.activeElement);
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}

export function measureViewport() {
  let width = window.innerWidth;
  let height = window.innerHeight;
  const vv = window.visualViewport;
  if (vv && !isTextEntryActive()) {
    width = Math.min(width, vv.width);
    height = Math.min(height, vv.height);
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
}

export function setupWindowChrome({
  canvas,
  touchManager,
  forEachEngine,
  neutralizeTransientInput,
  resumeMatchChrome,
  acquireWakeLock,
  getCurrentMode,
  activeNet,
  hideConnectionBanner
}) {
  function resizeCanvas() {
    const { width, height } = measureViewport();
    const dpr = effectiveDpr(width, height);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    if (touchManager) touchManager.setDimensions(width, height, dpr);

    forEachEngine((mode, entry) => entry.game.resize(width, height));
  }

  let resizeFrame = 0;
  function scheduleResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      resizeCanvas();
    });
  }

  window.addEventListener('resize', scheduleResize);
  window.visualViewport?.addEventListener('resize', scheduleResize);
  
  window.addEventListener('orientationchange', () => {
    neutralizeTransientInput();
    setTimeout(resizeCanvas, 150);
  });
  
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      neutralizeTransientInput();
      return;
    }
    if (getCurrentMode() !== 'MENU') {
      resumeMatchChrome();
      acquireWakeLock();
    }
  });
  
  window.addEventListener('blur', () => {
    if (getCurrentMode() !== 'MENU') neutralizeTransientInput();
  });

  // Quick Fullscreen UI
  const btnQuickFullscreen = document.getElementById('btn-quick-fullscreen');
  const quickFullscreenIcon = document.getElementById('quick-fullscreen-icon');
  // Tam ekranın pause içi karşılığı hızlı şeritteki switch'tir
  // (`settingsSchema` → `settingsActions.fullscreen`); ad-hoc ikinci düğme
  // kaldırıldı — durum TEK kaynaktan yalnız buradaki çipte tutulur.

  function updateQuickFullscreen(active) {
    const isFs = typeof active === 'boolean' ? active : isFullscreen();
    const label = isFs ? t('menu.exitFullscreen') : t('menu.fullscreen');
    const offerable = canToggleFullscreen();
    btnQuickFullscreen?.classList.toggle('hidden', !offerable);
    if (quickFullscreenIcon) {
      quickFullscreenIcon.innerHTML = getTabletopIconSvg(
        isFs ? 'minimize-2' : 'maximize-2',
        { size: 19 },
      );
    }
    btnQuickFullscreen?.classList.toggle('active', isFs);
    btnQuickFullscreen?.setAttribute('title', label);
    btnQuickFullscreen?.setAttribute('aria-label', label);
    btnQuickFullscreen?.setAttribute('aria-pressed', String(isFs));
  }
  
  updateQuickFullscreen();
  onFullscreenChange(updateQuickFullscreen);
  onLangChange(() => updateQuickFullscreen());
  // Kurulu PWA: ilk gerçek dokunuşta doğrudan tam ekrana gir (jest şart).
  armStandaloneFullscreen();
  
  if (btnQuickFullscreen) {
    let lastTransitionTime = 0;
    const onFullscreenTap = () => {
      const now = performance.now();
      if (now - lastTransitionTime < 80) return;
      lastTransitionTime = now;
      playMenuTick();
      toggleFullscreen();
    };
    btnQuickFullscreen.addEventListener('click', onFullscreenTap);
  }

  // Service Worker & Güncelleme Yöneticisi
  initUpdateManager();

  return { resizeCanvas, scheduleResize };
}
