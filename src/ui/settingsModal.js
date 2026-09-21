// Settings Sheet — menu-level preferences (same sheet language as pause).
// Same backing functions as the pause toggles (one truth, two UIs).
import { isBotEkleEnabled, setBotEkleEnabled } from '../core/slotManager.js';
import { isColorblindEnabled, setColorblindEnabled } from '../core/customizationManager.js';
import { isPersistent } from '../core/safeStorage.js';
import { toggleAudio, getIsMuted } from '../audio.js';
import { showInstallToast } from './toast.js';
import { t, getLang, setLang, onLangChange } from '../i18n.js';

const settingsModal = document.getElementById('settings-modal');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsSound = document.getElementById('btn-settings-sound');
const btnSettingsBots = document.getElementById('btn-settings-bots');
const btnSettingsColorblind = document.getElementById('btn-settings-colorblind');
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
}

export function closeSettingsModal() {
  settingsModal?.classList.add('hidden');
}

export function isSettingsOpen() {
  return !!settingsModal && !settingsModal.classList.contains('hidden');
}

export function initSettingsModal({ onBotsToggled } = {}) {
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
