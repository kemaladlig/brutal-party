import { isFullscreen, toggleFullscreen, onFullscreenChange, fullscreenOfferable } from './fullscreen.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { t, onLangChange } from '../i18n.js';
import { showInstallToast } from './toast.js';

const MAX_CANVAS_PIXELS = 2_100_000;

function effectiveDpr(width, height) {
  const raw = Math.min(window.devicePixelRatio || 1, 2.5);
  const pixels = width * height * raw * raw;
  if (pixels <= MAX_CANVAS_PIXELS) return raw;
  return Math.max(1, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
}

export function isTextEntryActive() {
  const el = document.activeElement;
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

  function updateQuickFullscreen(active) {
    const isFs = typeof active === 'boolean' ? active : isFullscreen();
    const label = isFs ? t('menu.exitFullscreen') : t('menu.fullscreen');
    btnQuickFullscreen?.classList.toggle('hidden', !fullscreenOfferable());
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
  
  if (btnQuickFullscreen) {
    let lastTransitionTime = 0;
    btnQuickFullscreen.addEventListener('click', (e) => {
      const now = performance.now();
      if (now - lastTransitionTime < 80) return;
      lastTransitionTime = now;
      toggleFullscreen();
    });
  }

  // Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          reg.update();
          console.log('[PWA] ServiceWorker registered and updated:', reg.scope);
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

  return { resizeCanvas, scheduleResize };
}
