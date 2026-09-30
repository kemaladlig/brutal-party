// Ayarların tek listesi: hangi satır hangi sekmede, hangi tipte çizilecek ve
// hangi eylemi çağıracak. Yeni ayar = buraya bir satır + `settingsActions`a
// bir eylem; üç yüzeyle (ana menü / lobi / oyun içi) ayrıca ilgilenilmez.
//
// Dikey alan bütçesi (yatay telefon 844×390): sekme başına 4 satır, sheet
// gövdesi kaydırmasız sığar. Satır sayısını 5'te tutmak bir sonraki ayarın
// neden bir sekme açtığını düşündürmelidir.

/** @typedef {'general'|'control'|'system'} SettingsTabId */

/** @type {Array<{ id: SettingsTabId, labelKey: string }>} */
export const SETTINGS_TABS = [
  { id: 'general', labelKey: 'settings.tabGeneral' },
  { id: 'control', labelKey: 'settings.tabControl' },
  { id: 'system', labelKey: 'settings.tabSystem' },
];

export const DEFAULT_SETTINGS_TAB = SETTINGS_TABS[0].id;

/**
 * @typedef {Object} SettingsRow
 * @property {SettingsTabId} tab
 * @property {string} id
 * @property {'switch'|'choice'|'slider'|'static'|'action'} type
 * @property {string} action `settingsActions` anahtarı
 * @property {string} labelKey
 * @property {string} [icon] statik ikon
 * @property {{on: string, off: string}|string} [iconOn] switch: duruma göre ikon
 * @property {Array<{ value: string, labelKey: string }>} [options] choice
 * @property {string} [ariaKey] choice grubunun erişilebilir adı
 * @property {number} [min] @property {number} [max] @property {number} [step] slider
 * @property {string} [hintKey] action satırının alt notu
 * @property {boolean} [dynamicLabel] action etiketi `action.get()`ten gelir
 * @property {boolean} [quick] oyun içi hızlı sette de çizilir
 */

/** @type {SettingsRow[]} */
export const SETTINGS_ROWS = [
  // ── GENEL ──────────────────────────────────────────────────────────────
  {
    tab: 'general', id: 'sound', type: 'switch', action: 'sound', quick: true,
    labelKey: 'settings.sound', iconOn: { on: 'volume_2', off: 'volume_x' },
  },
  {
    tab: 'general', id: 'haptics', type: 'switch', action: 'haptics',
    labelKey: 'settings.haptics', icon: 'zap',
  },
  {
    tab: 'general', id: 'bots', type: 'switch', action: 'bots',
    labelKey: 'settings.bots', icon: 'bot',
  },
  {
    // Bot tepkileri: yalnız masada bot varken anlamlı — bot ekleme kapalıyken
    // satır ÇİZİLMEZ (§8), dolayısıyla varsayılan durumda GENEL 5 satır kalır.
    // Bot ekleme açıkken 6 satır çizilir; §8 ayar panelinde dikey kaydırmaya
    // izin verir, bu yüzden satır alt sınırın (44px) üstünde kalır ve kabul edilir.
    tab: 'general', id: 'botReactions', type: 'switch', action: 'botReactions',
    labelKey: 'settings.botReactions', icon: 'message_square',
  },
  {
    tab: 'general', id: 'colorblind', type: 'switch', action: 'colorblind', quick: true,
    labelKey: 'settings.colorblind', icon: 'eye',
  },
  {
    // Yalnız tam ekranın anlamlı olduğu yüzeyde: APIsiz ortamda anahtar gürültü.
    tab: 'general', id: 'fullscreen', type: 'switch', action: 'fullscreen', quick: true,
    labelKey: 'settings.fullscreen', iconOn: { on: 'minimize_2', off: 'maximize_2' },
  },

  // ── KONTROL ────────────────────────────────────────────────────────────
  {
    tab: 'control', id: 'controlSurface', type: 'choice', action: 'controlSurface',
    labelKey: 'settings.controlSurface', ariaKey: 'settings.controlSurface',
    options: [
      { value: 'auto', labelKey: 'settings.controlAuto' },
      { value: 'mobile', labelKey: 'settings.controlMobile' },
      { value: 'tabletop', labelKey: 'settings.controlTabletop' },
    ],
  },
  {
    tab: 'control', id: 'controllerLayout', type: 'action', action: 'controllerLayout',
    labelKey: 'controllerLayout.open', hintKey: 'controllerLayout.pauseHint', icon: 'pencil',
  },
  {
    tab: 'control', id: 'pongInvert', type: 'choice', action: 'pongInvert',
    labelKey: 'settings.pongInvert', ariaKey: 'settings.pongInvert',
    options: [
      { value: 'auto', labelKey: 'settings.pongInvertAuto' },
      { value: 'on', labelKey: 'settings.pongInvertOn' },
      { value: 'off', labelKey: 'settings.pongInvertOff' },
    ],
  },
  {
    tab: 'control', id: 'pongSensitivity', type: 'slider', action: 'pongSensitivity',
    labelKey: 'settings.pongSensitivity', min: 0.5, max: 1.5, step: 0.05,
  },

  // ── SİSTEM ─────────────────────────────────────────────────────────────
  {
    tab: 'system', id: 'language', type: 'choice', action: 'language',
    labelKey: 'settings.language', ariaKey: 'settings.language',
    options: [
      { value: 'tr', labelKey: 'settings.langTr' },
      { value: 'en', labelKey: 'settings.langEn' },
    ],
  },
  {
    // Faz 4.3 — sakin mod: hareket kısılır + FX kademesi low (termal/bateri).
    tab: 'system', id: 'calm', type: 'switch', action: 'calm',
    labelKey: 'settings.calm', iconOn: { on: 'moon', off: 'zap' },
  },
  { tab: 'system', id: 'version', type: 'static', action: 'version', labelKey: 'settings.version' },
  { tab: 'system', id: 'storage', type: 'static', action: 'storage', labelKey: 'settings.storage' },
  {
    tab: 'system', id: 'update', type: 'action', action: 'update', dynamicLabel: true,
    labelKey: 'settings.updateCheck', hintKey: 'settings.updateHint', icon: 'reload',
  },
];

/** @param {SettingsTabId} tab */
export function rowsOfTab(tab) {
  return SETTINGS_ROWS.filter((row) => row.tab === tab);
}

/** Oyun içi yüzeyde çizilen az sayıda satır (duraklarken tek dokunuş). */
export function quickRows() {
  return SETTINGS_ROWS.filter((row) => row.quick);
}
