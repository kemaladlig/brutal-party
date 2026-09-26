// Settings Sheet — menu-level preferences (same sheet language as pause).
// Same backing functions as the pause toggles (one truth, two UIs).
import { isBotEkleEnabled, setBotEkleEnabled } from '../core/slotManager.js';
import { isColorblindEnabled, setColorblindEnabled } from '../core/customizationManager.js';
import { isPersistent } from '../core/safeStorage.js';
import { getPreference, setPreference } from '../core/preferences.js';
import { toggleAudio, getIsMuted } from '../audio.js';
import { openOverlay, closeOverlay } from './overlayHost.js';
import { hydrateIconSlots } from './iconSlots.js';
import { showInstallToast } from './toast.js';
import { t, getLang, setLang, onLangChange } from '../i18n.js';
import {
  CONTROL_SURFACE,
  getControlSurface,
  getControlSurfacePreference,
  setControlSurface,
} from './tokens.js';

const settingsModal = document.getElementById('settings-modal');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsSound = document.getElementById('btn-settings-sound');
const btnSettingsBots = document.getElementById('btn-settings-bots');
const btnSettingsColorblind = document.getElementById('btn-settings-colorblind');
const btnSettingsHaptics = document.getElementById('btn-settings-haptics');
const btnSettingsPongInvertAuto = document.getElementById('btn-settings-pong-invert-auto');
const btnSettingsPongInvertOn = document.getElementById('btn-settings-pong-invert-on');
const btnSettingsPongInvertOff = document.getElementById('btn-settings-pong-invert-off');
const settingsPongSensitivity = document.getElementById('settings-pong-sensitivity');
const settingsPongSensitivityValue = document.getElementById('settings-pong-sensitivity-value');
const btnSettingsControlAuto = document.getElementById('btn-settings-control-auto');
const btnSettingsControlMobile = document.getElementById('btn-settings-control-mobile');
const btnSettingsControlTabletop = document.getElementById('btn-settings-control-tabletop');
const btnLangTr = document.getElementById('btn-lang-tr');
const btnLangEn = document.getElementById('btn-lang-en');
const settingsStorage = document.getElementById('settings-storage');

function setSwitch(el, on) {
  if (!el) return;
  el.classList.toggle('on', !!on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

export function refreshSettingsSwitches() {
  setSwitch(btnSettingsSound, !getIsMuted());
  setSwitch(btnSettingsBots, isBotEkleEnabled());
  setSwitch(btnSettingsColorblind, isColorblindEnabled());
  setSwitch(btnSettingsHaptics, getPreference('hapticsEnabled'));
  const pongInvert = getPreference('pongInvert');
  btnSettingsPongInvertAuto?.classList.toggle('selected', pongInvert === 'auto');
  btnSettingsPongInvertAuto?.setAttribute('aria-pressed', String(pongInvert === 'auto'));
  btnSettingsPongInvertOn?.classList.toggle('selected', pongInvert === 'on');
  btnSettingsPongInvertOn?.setAttribute('aria-pressed', String(pongInvert === 'on'));
  btnSettingsPongInvertOff?.classList.toggle('selected', pongInvert === 'off');
  btnSettingsPongInvertOff?.setAttribute('aria-pressed', String(pongInvert === 'off'));
  const sensitivity = getPreference('pongSensitivity');
  if (settingsPongSensitivity) settingsPongSensitivity.value = String(sensitivity);
  if (settingsPongSensitivityValue) settingsPongSensitivityValue.value = Number(sensitivity).toFixed(2);
  const preference = getControlSurfacePreference();
  const resolvedSurface = getControlSurface();
  const autoSelected = preference === CONTROL_SURFACE.AUTO;
  const mobileSelected = preference === CONTROL_SURFACE.MOBILE;
  const tabletopSelected = preference === CONTROL_SURFACE.TABLETOP;
  btnSettingsControlAuto?.classList.toggle('selected', autoSelected);
  btnSettingsControlAuto?.setAttribute('aria-pressed', String(autoSelected));
  btnSettingsControlMobile?.classList.toggle('selected', mobileSelected);
  btnSettingsControlMobile?.setAttribute('aria-pressed', String(mobileSelected));
  btnSettingsControlTabletop?.classList.toggle('selected', tabletopSelected);
  btnSettingsControlTabletop?.setAttribute('aria-pressed', String(tabletopSelected));
  btnSettingsControlAuto?.setAttribute('title', `${t('settings.controlAuto')} → ${resolvedSurface === CONTROL_SURFACE.MOBILE ? t('settings.controlMobile') : t('settings.controlTabletop')}`);
  const lang = getLang();
  btnLangTr?.classList.toggle('selected', lang === 'tr');
  btnLangEn?.classList.toggle('selected', lang === 'en');
  if (settingsStorage) {
    settingsStorage.textContent = isPersistent() ? t('settings.storageOk') : t('settings.storageSession');
  }
}

export function openSettingsModal() {
  refreshSettingsSwitches();
  settingsModal?.classList.remove('hidden');
  // Overlay kaydı: odak trap, Escape, backdrop kilidi ve shell girdi bırakması
  // tek yerden yönetilir (bkz. `overlayHost.js`).
  openOverlay('settings', { el: settingsModal, onClose: closeSettingsModal });
}

export function closeSettingsModal() {
  settingsModal?.classList.add('hidden');
  closeOverlay('settings');
}

export function isSettingsOpen() {
  return !!settingsModal && !settingsModal.classList.contains('hidden');
}

export function initSettingsModal({ onBotsToggled, onControlsChanged, onPreferencesChanged } = {}) {
  // Statik markup'taki ikon yuvaları bir kez doldurulur (ikon adı HTML'de,
  // çizim `tabletopIcons`tan gelir; AGENTS.md §7).
  hydrateIconSlots(settingsModal);

  btnSettingsClose?.addEventListener('click', closeSettingsModal);

  btnSettingsSound?.addEventListener('click', () => {
    const muted = toggleAudio();
    setSwitch(btnSettingsSound, !muted);
    showInstallToast(muted ? t('toast.soundOff') : t('toast.soundOn'));
  });

  btnSettingsBots?.addEventListener('click', () => {
    const next = !isBotEkleEnabled();
    setBotEkleEnabled(next);
    setSwitch(btnSettingsBots, next);
    showInstallToast(next ? t('toast.botsOn') : t('toast.botsOff'));
    if (typeof onBotsToggled === 'function') onBotsToggled(next);
  });

  btnSettingsColorblind?.addEventListener('click', () => {
    const next = !isColorblindEnabled();
    setColorblindEnabled(next);
    setSwitch(btnSettingsColorblind, next);
    showInstallToast(next ? t('toast.cbOn') : t('toast.cbOff'));
  });

  btnSettingsHaptics?.addEventListener('click', () => {
    const next = !getPreference('hapticsEnabled');
    setPreference('hapticsEnabled', next);
    setSwitch(btnSettingsHaptics, next);
    showInstallToast(next ? t('toast.hapticsOn') : t('toast.hapticsOff'));
    if (typeof onPreferencesChanged === 'function') onPreferencesChanged('hapticsEnabled', next);
  });

  const setPongInvert = (value) => {
    setPreference('pongInvert', value);
    refreshSettingsSwitches();
    if (typeof onPreferencesChanged === 'function') onPreferencesChanged('pongInvert', value);
  };
  btnSettingsPongInvertAuto?.addEventListener('click', () => setPongInvert('auto'));
  btnSettingsPongInvertOn?.addEventListener('click', () => setPongInvert('on'));
  btnSettingsPongInvertOff?.addEventListener('click', () => setPongInvert('off'));

  settingsPongSensitivity?.addEventListener('input', () => {
    const value = Number(settingsPongSensitivity.value);
    setPreference('pongSensitivity', value);
    if (settingsPongSensitivityValue) settingsPongSensitivityValue.value = value.toFixed(2);
    if (typeof onPreferencesChanged === 'function') onPreferencesChanged('pongSensitivity', value);
  });

  const applyControlSurface = (surface) => {
    if (getControlSurface() === surface) return;
    setControlSurface(surface);
    refreshSettingsSwitches();
    showInstallToast(surface === CONTROL_SURFACE.AUTO
      ? t('toast.controlsAuto')
      : surface === CONTROL_SURFACE.MOBILE
        ? t('toast.controlsMobile')
        : t('toast.controlsTabletop'));
    if (typeof onControlsChanged === 'function') onControlsChanged(surface);
  };

  btnSettingsControlAuto?.addEventListener('click', () => applyControlSurface(CONTROL_SURFACE.AUTO));
  btnSettingsControlMobile?.addEventListener('click', () => applyControlSurface(CONTROL_SURFACE.MOBILE));
  btnSettingsControlTabletop?.addEventListener('click', () => applyControlSurface(CONTROL_SURFACE.TABLETOP));

  btnLangTr?.addEventListener('click', () => setLang('tr'));
  btnLangEn?.addEventListener('click', () => setLang('en'));

  settingsModal?.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettingsModal();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isSettingsOpen()) closeSettingsModal();
  });

  onLangChange(() => {
    if (isSettingsOpen()) refreshSettingsSwitches();
  });
}
