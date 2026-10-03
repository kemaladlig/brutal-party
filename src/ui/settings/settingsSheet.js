// Ayarlar sheeti — merkezi ayar yüzeyinin tek kabuğu.
//
// Ana menü, lobi ve duraklatma AYNI sheeti açar; fark yalnız hangi sekmeyle
// açıldığıdır. Kayıt/odak/Escape/backdrop `overlayHost`tan gelir (elle
// `keydown`/`click` dinleyicisi yok — eskiden hem burada hem overlayHostta
// iki Escape sahibi vardı).

import { t } from '../../i18n.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { closeOverlay, openOverlay } from '../overlayHost.js';
import { bindSettingsHooks } from './settingsActions.js';
import { createSettingsPanel } from './settingsPanel.js';
import { playMenuTick } from '../../audio.js';

const SCRIM_ID = 'settings-modal';

/** @type {HTMLElement | null} */
let scrim = null;
/** @type {ReturnType<typeof createSettingsPanel> | null} */
let panel = null;

function build() {
  const root = document.createElement('div');
  root.id = SCRIM_ID;
  root.className = 'settings-scrim hidden';

  const sheet = document.createElement('div');
  sheet.className = 'settings-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  // Başlık şeridi YOK: sekme şeridi başlığın yerine geçer. "AYARLAR" sözü
  // hiçbir şeyi seçtirmiyordu, yüzde yirmi dikey yer yiyordu; erişilebilir
  // ad artık kapsayıcıda.
  const head = document.createElement('div');
  head.className = 'settings-head';

  panel = createSettingsPanel({ ctx: { close: () => closeSettingsSheet() } });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'sheet-close';
  close.innerHTML = getTabletopIconSvg('close', { size: 16, strokeWidth: 2.6 });
  close.addEventListener('click', () => { playMenuTick(); closeSettingsSheet(); });

  // `.tab-strip` merkezi bileşenin sınıfıdır; `.settings-tabs` yalnız bu
  // yüzeyin yerleşim varyantıdır (eşit üç dilim, kaydırmasız).
  panel.tabsNode.classList.add('settings-tabs');
  head.append(panel.tabsNode, close);

  const scroll = document.createElement('div');
  scroll.className = 'settings-scroll';
  scroll.append(panel.bodyNode);

  sheet.append(head, scroll);
  root.append(sheet);
  document.body.append(root);
  scrim = root;
}

/**
 * @param {{ onBotsToggled?: (enabled: boolean) => void,
 *           openControllerLayout?: () => void,
 *           canOpenControllerLayout?: () => boolean }} hooks `main.js` bağlar.
 */
export function initSettingsSheet(hooks) {
  bindSettingsHooks(hooks);
}

/** @param {{ tab?: string }} [opts] */
export function openSettingsSheet(opts = {}) {
  if (!scrim || !panel) build();
  if (!scrim || !panel) return;
  scrim.classList.remove('hidden');
  const dialog = scrim.querySelector('.settings-sheet');
  dialog?.setAttribute('aria-label', t('settings.title'));
  if (opts.tab) panel.setTab(opts.tab);
  panel.refresh();
  openOverlay('settings', { el: scrim, onClose: () => closeSettingsSheet() });
}

export function closeSettingsSheet() {
  scrim?.classList.add('hidden');
  closeOverlay('settings');
}
