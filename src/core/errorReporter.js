// src/core/errorReporter.js
// Global Hata Gözlemi (Client-side Error Reporter)
// window.onerror + window.onunhandledrejection + kontrollü toast bildirimi.
// Ağ telemetry'si YOK (offline/gizlilik/bütçe ilkesi — AGENTS.md §6).

import { showInstallToast } from '../ui/toast.js';
import { t } from '../i18n.js';

let initialized = false;
let lastToastTime = 0;
const TOAST_THROTTLE_MS = 6000;

/**
 * Konsola ve gerektiğinde arayüze (toast) kontrollü hata bildirimi gönderir.
 * @param {Error|any} error - Hata nesnesi veya mesajı
 * @param {string} [context] - Hatanın kaynaklandığı modül/işlem (örn. 'roomFlow', 'net', 'engine')
 * @param {Object} [options]
 * @param {boolean} [options.notifyUser=false] - Kullanıcıya toast gösterilsin mi
 * @param {boolean} [options.warnOnly=false] - console.error yerine console.warn kullanılsın mı
 */
export function reportError(error, context = '', { notifyUser = false, warnOnly = false } = {}) {
  const prefix = context ? `[ErrorReporter:${context}]` : '[ErrorReporter]';
  if (warnOnly) {
    console.warn(prefix, error);
  } else {
    console.error(prefix, error);
  }

  if (notifyUser && typeof window !== 'undefined') {
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now - lastToastTime > TOAST_THROTTLE_MS) {
      lastToastTime = now;
      try {
        const msg = t('error.generic') || 'Beklenmeyen bir hata oluştu.';
        showInstallToast(msg, 'alert_triangle');
      } catch {
        // UI veya i18n hazır değilse sessizce geç
      }
    }
  }
}

/**
 * Fonksiyonu güvenli bir şekilde çalıştırır; hata durumunda raporlar ve varsa fallback döndürür.
 * @template T
 * @param {() => T} fn
 * @param {string} context
 * @param {T} [fallback]
 * @returns {T}
 */
export function safeCall(fn, context, fallback = undefined) {
  try {
    return fn();
  } catch (err) {
    reportError(err, context);
    return fallback;
  }
}

/**
 * Global unhandled error ve rejection dinleyicilerini kurar.
 */
export function initErrorReporter() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('error', (event) => {
    // Tarayıcı eklentileri veya harici script hatalarını ayıkla
    const filename = event.filename || '';
    if (filename && window.location?.origin) {
      const isOurCode = filename.includes(window.location.origin) ||
                        filename.includes('localhost') ||
                        filename.includes('127.0.0.1');
      if (!isOurCode) return;
    }

    reportError(event.error || event.message, 'window.onerror', { notifyUser: true });
  });

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, 'unhandledrejection', { notifyUser: true });
  });
}
