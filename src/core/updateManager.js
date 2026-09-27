// src/core/updateManager.js
// PWA Güncelleme Yöneticisi: Service Worker yaşam döngüsü, manuel denetim ve onaylı aktivasyon.
// AGENTS.md §4: src/core tek kaynaktır.

import { showInstallToast } from '../ui/toast.js';
import { t } from '../i18n.js';
import { reportError } from './errorReporter.js';

let registration = null;
let updateAvailable = false;
let isRefreshing = false;
const statusListeners = new Set();

/**
 * Güncelleme hazır olup olmadığını bildirir.
 * @returns {boolean}
 */
export function isUpdateAvailable() {
  return updateAvailable;
}

/**
 * Güncelleme durumu değiştiğinde (yeni sürüm indiğinde / uygulandığında) tetiklenen dinleyici.
 * @param {(available: boolean) => void} callback
 * @returns {() => void} Abonelikten çıkma fonksiyonu
 */
export function onUpdateStatusChange(callback) {
  statusListeners.add(callback);
  return () => statusListeners.delete(callback);
}

function notifyListeners() {
  for (const cb of statusListeners) {
    try {
      cb(updateAvailable);
    } catch (err) {
      reportError(err, 'updateManager.notifyListeners', { warnOnly: true });
    }
  }
}

/**
 * Bekleyen yeni sürümü aktif eder (skipWaiting) ve sayfayı yeniler.
 */
export function applyUpdate() {
  if (typeof window === 'undefined') return;

  if (registration?.waiting) {
    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
}

/**
 * Manuel güncelleme denetimi tetikler.
 * @param {{ silent?: boolean }} [options]
 * @returns {Promise<{ status: 'ready' | 'up-to-date' | 'checked' | 'unsupported' | 'error' }>}
 */
export async function checkForUpdates({ silent = false } = {}) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    if (!silent) showInstallToast(t('toast.swUnsupported') || 'Tarayıcıda güncelleme desteklenmiyor.');
    return { status: 'unsupported' };
  }

  // Eğer zaten indirilmiş bekleyen bir güncelleme varsa doğrudan uygula
  if (updateAvailable) {
    applyUpdate();
    return { status: 'ready' };
  }

  if (!silent) {
    showInstallToast(t('toast.checkingUpdate') || 'Güncellemeler kontrol ediliyor...', 'reload');
  }

  try {
    if (!registration) {
      registration = await navigator.serviceWorker.getRegistration();
    }

    if (!registration) {
      if (!silent) showInstallToast(t('toast.upToDate') || 'Uygulama güncel.', 'check');
      return { status: 'up-to-date' };
    }

    await registration.update();

    // Kısa bir gecikmeyle durum kontrolü
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (updateAvailable) {
      return { status: 'ready' };
    }

    if (!silent) {
      showInstallToast(t('toast.upToDate') || 'Uygulama güncel.', 'check');
    }
    return { status: 'checked' };
  } catch (err) {
    reportError(err, 'updateManager.checkForUpdates', { warnOnly: true });
    if (!silent) {
      showInstallToast(t('toast.updateCheckFail') || 'Güncelleme denetlenemedi.', 'alert_triangle');
    }
    return { status: 'error' };
  }
}

/**
 * Service Worker kaydını ve güncelleme kancalarını kurar.
 */
export function initUpdateManager() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // Yeni servis çalışanı aktifleştiğinde sayfayı bir kez yenile
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      registration = reg;

      const markUpdateReady = () => {
        updateAvailable = true;
        notifyListeners();
        showInstallToast(
          t('toast.updateReady') || 'Yeni sürüm hazır — yenilemek için dokunun.',
          'reload',
          () => applyUpdate()
        );
      };

      if (reg.waiting) {
        markUpdateReady();
      }

      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            markUpdateReady();
          }
        });
      });

      // Arka planda periyodik kontrol (60 dakikada bir)
      setInterval(() => {
        reg.update().catch(() => {});
      }, 60 * 60 * 1000);

    } catch (err) {
      reportError(err, 'updateManager.register', { warnOnly: true });
    }
  });
}
