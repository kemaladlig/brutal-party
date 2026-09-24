// PWA Install Prompt & Toast Notification Manager
import { t } from '../i18n.js';

const installToast = document.getElementById('install-toast');
const connectionBanner = document.getElementById('connection-banner');
const btnInstallApp = document.getElementById('btn-install-app');

let deferredInstallPrompt = null;

export function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function updateInstallButtonVisibility() {
  if (isStandaloneApp()) {
    btnInstallApp?.classList.add('hidden');
  } else {
    btnInstallApp?.classList.remove('hidden');
  }
}

export function showInstallToast(message) {
  if (!installToast) return;
  installToast.textContent = message;
  installToast.classList.add('visible');
  window.clearTimeout(showInstallToast.timer);
  showInstallToast.timer = window.setTimeout(() => {
    installToast.classList.remove('visible');
  }, 5000);
}

// ── Kalıcı bağlantı durum bandı (Sticky Connection Banner) ──
// Tek kaybolan toast'tan farklı: offline/reconnecting süresince ekranda kalır.
// state: 'online' (yeşil, 2sn flash → gizle) · 'reconnecting' (amber, kalıcı) ·
// 'offline' (kırmızı, kalıcı). Bağlantı dışı hatalar bu banda değil,
// showInstallToast'a gider (yönlendirme main.js tarafındadır).
export function showConnectionBanner(state, message) {
  if (!connectionBanner || !['online', 'reconnecting', 'offline'].includes(state)) return;
  connectionBanner.textContent = message || '';
  connectionBanner.dataset.state = state;
  connectionBanner.classList.add('visible');
  window.clearTimeout(showConnectionBanner.timer);
  if (state === 'online') {
    showConnectionBanner.timer = window.setTimeout(() => {
      connectionBanner.classList.remove('visible');
    }, 2000);
  }
}

export function hideConnectionBanner() {
  if (!connectionBanner) return;
  window.clearTimeout(showConnectionBanner.timer);
  showConnectionBanner.timer = null;
  connectionBanner.classList.remove('visible');
}

export function initToastAndInstall() {
  updateInstallButtonVisibility();

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
        showInstallToast(t('pwa.added'));
      }
      deferredInstallPrompt = null;
      btnInstallApp.classList.remove('available');
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showInstallToast(isIos ? t('pwa.ios') : t('pwa.other'));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    btnInstallApp?.classList.add('hidden');
    showInstallToast(t('pwa.added'));
  });
}
