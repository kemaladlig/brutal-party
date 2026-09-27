// Fullscreen Manager: Cross-browser helpers and reactive state
//
// Krom politikasının TEK sahibi. Tam ekran kullanıcıyındır: uygulama onu
// yalnızca maç başındaki gerçek bir dokunuşun içinde TEKLİF eder ve kullanıcı
// bir kez bıraktıysa (buton, Escape, sistem) sekme boyunca bir daha istemez.
// Kurulmuş/PWA yüzeyde hiç istenmez — orada çubuk tanım gereği yoktur ve
// iPhone/standalone'da Fullscreen API ya hiç yoktur ya da kapalıdır.
import { t } from '../i18n.js';
import { isTouchDevice } from './tokens.js';
import { showInstallToast, isStandaloneApp } from './toast.js';

// Niyet oturumluk: bu, SEKME ile kurulan krom ilişkisinin kaydıdır. Sayfa
// yenilenirse teklif bir kez daha edilmelidir; kalıcı ceza yanlış olur.
const FS_AUTO_KEY = 'brutal_party_fs_auto_offered';
const FS_USER_EXIT_KEY = 'brutal_party_fs_user_exit';

function readIntent(key) {
  try { return window.sessionStorage.getItem(key) === '1'; } catch { return false; }
}

function writeIntent(key, on) {
  try {
    if (on) window.sessionStorage.setItem(key, '1');
    else window.sessionStorage.removeItem(key);
  } catch { /* private mode: niyet hatırlanmaz — varsayılan davranış yeterince iyi */ }
}

export function isFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

/** Tarayıcı bu yüzeyde tam ekrana izin veriyor mu? iPhone Safari'de ve çoğu
 *  standalone çalıştırmada hayır — o zaman düğmeyi göstermek de yanlış. */
export function fullscreenSupported() {
  const el = document.documentElement;
  return !!(
    el.requestFullscreen
    || el.webkitRequestFullscreen
    || el.mozRequestFullScreen
    || el.msRequestFullscreen
  );
}

/** Tam ekran TEKLİFİ gösterilebilir mi (düğme/anahtar)? */
export function fullscreenOfferable() {
  return !isStandaloneApp() && fullscreenSupported();
}

/** Maç başında otomatik tam ekran istenebilir mi? */
export function shouldOfferFullscreen() {
  if (!fullscreenOfferable()) return false;
  // Kullanıcı bu sekmede bıraktıysa bir daha kendiliğinden alınmaz.
  if (readIntent(FS_USER_EXIT_KEY)) return false;
  return true;
}

/**
 * Bu sekmede tam ekranı uygulama maç başında kendisi mi almıştı? Sekme
 * dönüşünde YALNIZ bu doğruysa yeniden denenir: `visibilitychange` bir
 * kullanıcı jesti değildir ve masaüstü/TV tarayıcısı izni zaten reddeder —
 * denememek hem gürültüyü hem sessiz başarısızlığı keser.
 */
export function matchFullscreenEngaged() {
  return readIntent(FS_AUTO_KEY);
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

/**
 * BAŞLAT dokunuşunun İÇİNDEN çağrılır (tarayıcı yalnız gerçek bir jestte izin
 * verir). Toast üretmez: maç açılışında gürültü değil, sessiz bir iyileştirme
 * istenir. Kullanıcı zaten tam ekrandaysa hiçbir şey yapılmaz.
 *
 * Dokunmatikle sınırlıdır: masaüstü/TV'de pencereyi ele geçirmek değil,
 * kullanıcıya kalmış bir tercihtir (düğme orada da görünür).
 */
export function requestMatchFullscreen() {
  if (!isTouchDevice() || !shouldOfferFullscreen() || isFullscreen()) return false;
  writeIntent(FS_AUTO_KEY, true);
  requestFullscreen();
  return true;
}

/**
 * Sekme/uygulama dönüşünde tam ekranı YENİDEN iste. Koşul burada, çünkü krom
 * NİYETİNİN sahibi burasıdır: uygulama bu sekmede kendisi almış olmalı ve
 * kullanıcı bırakmamış olmalı. `visibilitychange` bir kullanıcı jesti değildir;
 * masaüstü/TV'de tarayıcı izin vermese de denemeyi gereksiz kılan asıl sebep,
 * kullanıcının bırakma hakkıdır.
 */
export function resumeMatchFullscreen() {
  if (!shouldOfferFullscreen() || !matchFullscreenEngaged() || isFullscreen()) return false;
  requestFullscreen();
  return true;
}

export function toggleFullscreen(showToast = true) {
  const active = isFullscreen();
  if (active) {
    exitFullscreen();
    if (showToast) showInstallToast(t('toast.fullscreenExit'));
    return false;
  }
  requestFullscreen();
  if (showToast) showInstallToast(t('toast.fullscreenEnter'));
  return true;
}

const listeners = new Set();
export function onFullscreenChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notifyChange() {
  const active = isFullscreen();
  // Niyet tek yönlü okunur: tam ekrana girildiyse kullanıcı istiyor demektir;
  // çıkıldıysa ve bunu uygulama maç başında kendisi aldıysa, bırakmak
  // kullanıcının kararıdır. Escape / sistem / buton hepsi aynı olayı üretir,
  // bu yüzden ayrı bir dinleyici gerekmez.
  if (active) writeIntent(FS_USER_EXIT_KEY, false);
  else if (readIntent(FS_AUTO_KEY)) writeIntent(FS_USER_EXIT_KEY, true);
  listeners.forEach((fn) => {
    try { fn(active); } catch (e) { console.error(e); }
  });
}

document.addEventListener('fullscreenchange', notifyChange);
document.addEventListener('webkitfullscreenchange', notifyChange);
document.addEventListener('mozfullscreenchange', notifyChange);
document.addEventListener('MSFullscreenChange', notifyChange);
