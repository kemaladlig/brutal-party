// Ayar paneli — sekmeli tam yüzey ve oyun içi hızlı set.
//
// İKİ KULLANICI, TEK GÖVDE:
//   · `createSettingsPanel()` → sekme şeridi + seçili sekmenin satırları
//     (ana menü / lobi / pause'un "TÜM AYARLAR"ı ile açılan sheet).
//   · `createQuickSettingsPanel()` → `quick` işaretli satırlar, sekmesiz
//     (duraklatma sheetine gömülür; duraklarken tek dokunuş hedefi).
//
// Panel hiçbir yere sabitlenmez ve overlay kaydı tutmaz: kabuğu
// `settingsSheet.js` kurar, gömülü kullanıcı kendi kabını verir.

import { createTabStrip } from '../tabStrip.js';
import { onLangChange, t } from '../../i18n.js';
import { subscribePreferences } from '../../core/preferences.js';
import { DEFAULT_SETTINGS_TAB, SETTINGS_TABS, quickRows, rowsOfTab } from './settingsSchema.js';
import { createSettingRow } from './settingsRow.js';
import { prefersReducedMotion } from '../motion.js';
import { settingsActions } from './settingsActions.js';

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Satır listesini bir kaba çizer. Abonelikler BURADA ve BİR KEZ alınır:
 * sekme değişimi yeniden `mountRows` değil `repaint` çağırır, yoksa her
 * sekme geçişi bir yeni dil/tercih dinleyicisi biriktirirdi.
 * @param {HTMLElement} host
 * @param {() => import('./settingsSchema.js').SettingsRow[]} readRows
 * @param {{ close?: (() => void) | null }} ctx
 */
function mountRows(host, readRows, ctx) {
  /** @type {Array<{ refresh: () => void }>} */
  let handles = [];

  const repaint = () => {
    host.textContent = '';
    handles = [];
    for (const row of readRows()) {
      const handle = createSettingRow(row, ctx);
      host.append(handle.node);
      handles.push(handle);
    }
  };

  const sync = () => handles.forEach((handle) => handle.refresh());

  repaint();
  // Dil kopyayı değiştirir → yeniden çiz. Tercih yazımı yalnız durumu
  // değiştirir → DOKUNMATİK SÜRÜKLEMENİN KOPMAMASI için düğümler
  // yeniden kurulmaz, yalnız senkron edilir (slider `input` sırasında
  // düğümün yerini değiştirmek sürüklemeyi sıfırlıyordu).
  onLangChange(repaint);
  subscribePreferences(sync);
  for (const action of Object.values(settingsActions)) {
    if (typeof action.subscribe === 'function') action.subscribe(sync);
  }

  return { repaint, sync };
}

/**
 * @param {{ initialTab?: string, ctx?: { close?: (() => void) | null } }} [opts]
 * @returns {{ tabsNode: HTMLElement, bodyNode: HTMLElement, setTab: (id: string) => void,
 *             refresh: () => void, activeTab: () => string }}
 */
export function createSettingsPanel({ initialTab = DEFAULT_SETTINGS_TAB, ctx = {} } = {}) {
  const bodyNode = el('div', 'settings-body');
  /** @type {string} */
  let active = initialTab;

  const tabs = createTabStrip({
    items: SETTINGS_TABS.map((tab) => ({ id: tab.id, label: t(tab.labelKey) })),
    onChange: (id) => setTab(id),
  });

  const mounted = mountRows(bodyNode, () => rowsOfTab(/** @type {any} */ (active)), ctx);

  function setTab(id) {
    if (id === active) return;
    active = id;
    tabs.setActive(id);
    // Satırlar sekme değişiminde yeniden çizilir: görünmeyen sekmede bayat
    // durum kalmaz, tek kaynak her zaman canlı değerdir.
    mounted.repaint();
    if (!prefersReducedMotion()) {
      bodyNode.classList.remove('is-swapping');
      void bodyNode.offsetWidth;
      bodyNode.classList.add('is-swapping');
    }
  }

  tabs.setActive(active);
  onLangChange(() => {
    for (const tab of SETTINGS_TABS) tabs.setLabel(tab.id, t(tab.labelKey));
  });

  return {
    tabsNode: tabs.node,
    bodyNode,
    setTab,
    refresh: mounted.sync,
    activeTab: () => active,
  };
}

/**
 * Duraklatma sheetine gömülen az satırlık set: sekme şeridi yok, tek bakış.
 * @param {{ ctx?: { close?: (() => void) | null } }} [opts]
 */
export function createQuickSettingsPanel({ ctx = {} } = {}) {
  const bodyNode = el('div', 'settings-body is-quick');
  const mounted = mountRows(bodyNode, quickRows, ctx);
  return { bodyNode, refresh: mounted.sync };
}
