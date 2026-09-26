// PWA Install Prompt & Toast Notification Manager
import { t } from '../i18n.js';

const installToast = document.getElementById('install-toast');
const connectionBanner = document.getElementById('connection-banner');

// Yükleme düğmesi birden çok yerde yaşar (profil kartı + ana menü simgesi)
// ve shell tarafından sonradan üretilebilir. Bu yüzden `id` değil, TEK bir
// davranış özniteliği (`data-install-app`) tek kaynaktır: iki düğme aynı anda
// id taşıyamaz, ama ikisi de aynı tıklama davranışını alabilir.
const INSTALL_SELECTOR = '[data-install-app]';

let deferredInstallPrompt = null;

export function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

export function updateInstallButtonVisibility() {
  const standalone = isStandaloneApp();
  document.querySelectorAll(INSTALL_SELECTOR).forEach((btn) => {
    btn.classList.toggle('hidden', standalone);
  });
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
    document.querySelectorAll(INSTALL_SELECTOR).forEach((btn) => btn.classList.add('available'));
    updateInstallButtonVisibility();
  });

  // Düğmeler shell tarafından üretilip sonradan eklenebildiği için olay
  // delegasyonu kullanılır (doğrudan addEventListener erken bağlansa null'da
  // kalırdı ve buton hiç çalışmazdı).
  document.addEventListener('click', async (e) => {
    const btn = e.target?.closest?.(INSTALL_SELECTOR);
    if (!btn) return;
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        showInstallToast(t('pwa.added'));
      }
      deferredInstallPrompt = null;
      btn.classList.remove('available');
      return;
    }

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showInstallToast(isIos ? t('pwa.ios') : t('pwa.other'));
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallButtonVisibility();
    showInstallToast(t('pwa.added'));
  });
}
