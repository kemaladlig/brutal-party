// Ayar eylemlerinin TEK kaynağı. Ne satır tipi bilir ne yüzey ne dil: düz
// oku/yaz fonksiyonları. Sheet satırları, ana menü köşe kümesi ve lobi düğmesi
// AYNI nesneyi çağırır — hiçbir yüzey bir geri çağrıyı kendi kendine
// sarmalamaz. (Eski hâl: ses/bot/renk körü/tam ekran üç dosyada üç ayrı
// `addEventListener` gövdesi + üç ayrı DOM senkronuydu.)
import { isBotEkleEnabled, setBotEkleEnabled } from '../../core/slotManager.js';
import { isColorblindEnabled, setColorblindEnabled } from '../../core/customizationManager.js';
import { isPersistent } from '../../core/safeStorage.js';
import { getPreference, setPreference } from '../../core/preferences.js';
import { applyUpdate, checkForUpdates, isUpdateAvailable, onUpdateStatusChange } from '../../core/updateManager.js';
import { toggleAudio, getIsMuted } from '../../audio.js';
import { getLang, setLang, t } from '../../i18n.js';
import { showInstallToast } from '../toast.js';
import { CONTROL_SURFACE, getControlSurfacePreference, setControlSurface } from '../tokens.js';
import { canToggleFullscreen, isFullscreen, onFullscreenChange, toggleFullscreen } from '../fullscreen.js';

/**
 * Yüzey-özel kancalar: `main.js` tek noktadan bağlar. Eylemin sonucunun
 * odaya/kabukla nasıl yansıdığı ayar modülünün bilgisi değildir.
 * @type {{ onBotsToggled: ((enabled: boolean) => void) | null,
 *           openControllerLayout: (() => void) | null,
 *           canOpenControllerLayout: (() => boolean) | null }}
 */
const hooks = { onBotsToggled: null, openControllerLayout: null, canOpenControllerLayout: null };

export function bindSettingsHooks(next = {}) {
  for (const key of /** @type {const} */ (['onBotsToggled', 'openControllerLayout', 'canOpenControllerLayout'])) {
    if (typeof next[key] === 'function') hooks[key] = next[key];
  }
}

/**
 * Her eylem: `get()` → anlık değer, `set(v)` / `toggle()` → yazım,
 * `subscribe(fn)` → dışarıdan gelen değişim (OS tam ekran çıkışı vb.),
 * `available()` → bu cihazda/anlamda var mı.
 * @type {Record<string, any>}
 */
export const settingsActions = {
  sound: {
    get: () => !getIsMuted(),
    toggle: () => {
      const muted = toggleAudio();
      showInstallToast(muted ? t('toast.soundOff') : t('toast.soundOn'));
    },
  },

  haptics: {
    get: () => getPreference('hapticsEnabled'),
    toggle: () => {
      const next = !getPreference('hapticsEnabled');
      setPreference('hapticsEnabled', next);
      showInstallToast(next ? t('toast.hapticsOn') : t('toast.hapticsOff'));
    },
  },

  // Faz 4.3 — sakin mod: hareketi kısar + FX kademesini low'a sabitler.
  calm: {
    get: () => getPreference('calmMode'),
    toggle: () => {
      const next = !getPreference('calmMode');
      setPreference('calmMode', next);
      showInstallToast(next ? t('toast.calmOn') : t('toast.calmOff'));
    },
  },

  bots: {
    get: () => isBotEkleEnabled(),
    toggle: () => {
      const next = !isBotEkleEnabled();
      setBotEkleEnabled(next);
      hooks.onBotsToggled?.(next);
      showInstallToast(next ? t('toast.botsOn') : t('toast.botsOff'));
    },
  },

  colorblind: {
    get: () => isColorblindEnabled(),
    toggle: () => {
      const next = !isColorblindEnabled();
      setColorblindEnabled(next);
      showInstallToast(next ? t('toast.cbOn') : t('toast.cbOff'));
    },
  },

  fullscreen: {
    get: () => isFullscreen(),
    toggle: () => { toggleFullscreen(); },
    available: () => canToggleFullscreen(),
    subscribe: (fn) => onFullscreenChange(fn),
  },

  language: {
    get: () => getLang(),
    set: (value) => { setLang(value); },
  },

  controlSurface: {
    // TERCİH okunur, çözülmüş yüzey değil: `auto` bir telefonda zaten `mobile`
    // çözüyordu ve "Mobil"e dokunmak sessiz no-op'tu (seçim de kayda da
    // yansımıyordu).
    get: () => getControlSurfacePreference(),
    set: (value) => {
      if (getControlSurfacePreference() === value) return;
      setControlSurface(value);
      showInstallToast(value === CONTROL_SURFACE.AUTO
        ? t('toast.controlsAuto')
        : value === CONTROL_SURFACE.MOBILE
          ? t('toast.controlsMobile')
          : t('toast.controlsTabletop'));
    },
  },

  pongInvert: {
    get: () => getPreference('pongInvert'),
    set: (value) => { setPreference('pongInvert', value); },
  },

  pongSensitivity: {
    get: () => getPreference('pongSensitivity'),
    set: (value) => { setPreference('pongSensitivity', value); },
    format: (value) => Number(value).toFixed(2),
  },

  controllerLayout: {
    // Yerinde düzenlenecek bir kumanda yoksa satır çizilmez: "yok" bir satırı
    // basıp kullanıcıya "kullanılamıyor" demek, satırı hiç göstermemekten kötü.
    available: () => !!hooks.canOpenControllerLayout?.(),
    /** @param {{ close?: (() => void) | null }} [ctx] */
    run: (ctx = {}) => {
      ctx.close?.();
      hooks.openControllerLayout?.();
    },
  },

  update: {
    // Etiket durumdandır: denetle → (güncelleme indiğinde) uygulay.
    get: () => (isUpdateAvailable() ? t('settings.updateReady') : t('settings.updateCheck')),
    highlight: () => isUpdateAvailable(),
    // Service worker bildirimi satırı açılış beklemeden günceller.
    subscribe: (fn) => onUpdateStatusChange(fn),
    run: () => {
      if (isUpdateAvailable()) applyUpdate();
      else checkForUpdates();
    },
  },

  version: {
    get: () => `v${__APP_VERSION__}`,
  },

  storage: {
    get: () => (isPersistent() ? t('settings.storageOk') : t('settings.storageSession')),
  },
};
