// Fullscreen Manager: Cross-browser helpers and reactive state
import { t } from '../i18n.js';
import { showInstallToast } from './toast.js';

export function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

export function requestFullscreen() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) {
      const p = el.requestFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
      el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
      el.msRequestFullscreen();
    }
  } catch {}
}

export function exitFullscreen() {
  try {
    if (document.exitFullscreen) {
      const p = document.exitFullscreen();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  } catch {}
}

export function toggleFullscreen(showToast = true) {
  const active = isFullscreen();
  if (active) {
    exitFullscreen();
    if (showToast) showInstallToast(t('toast.fullscreenExit'));
    return false;
  } else {
    requestFullscreen();
    if (showToast) showInstallToast(t('toast.fullscreenEnter'));
    return true;
  }
}

export function tryFullscreen() {
  if (!isFullscreen()) {
    requestFullscreen();
  }
}

const listeners = new Set();
export function onFullscreenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyChange() {
  const active = isFullscreen();
  listeners.forEach((fn) => {
    try { fn(active); } catch (e) { console.error(e); }
  });
}

document.addEventListener('fullscreenchange', notifyChange);
document.addEventListener('webkitfullscreenchange', notifyChange);
document.addEventListener('mozfullscreenchange', notifyChange);
document.addEventListener('MSFullscreenChange', notifyChange);
