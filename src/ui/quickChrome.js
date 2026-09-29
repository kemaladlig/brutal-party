// Üst yüzen "quick chrome" çiplerinin TEK kayıt noktası.
//
// Sunum yüzeyleri (host `#in-game-hud` DOM'u ve kumanda başlığı) bu tanımdan
// ÜRETİLİR; markup iki yere kopyalanmaz. Yeni bir üst çip = buraya bir kayıt.
// Davranış sahipleri değişmez: her çip `domId` (ya da `attrs` çapası) ile kendi
// yüzeyinde bağlanır (host: main.js/windowChrome.js, kumanda: gamepad.js).
//
// Katman ayrımı bilinçlidir: TANIM burada tekildir, SUNUM yüzey başına ayrıdır
// (host canvas kenarı, kumanda telefon DOM'u). Host'a özel eylemler
// `surface: 'host'`, kumandaya özel olanlar `surface: 'pad'` ile işaretlenir —
// bu, "eylem yetkisi hostta" kuralını çiğnemez.
//
// `group`: 'left' | 'right' (üst küme) | 'menu' (kumanda açılır menüsü)
// `kind`:  'text' (ikon + etiket) | 'icon' | 'reaction' | 'menu' (buton + panel)
import { t } from '../i18n.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { reactionGlyph } from '../core/reactions.js';

const DEFAULT_ICON_SIZE = 18;
const DEFAULT_MENU_ICON_SIZE = 16;

/**
 * @typedef {'host' | 'pad'} QuickSurface
 * @typedef {'left' | 'right' | 'menu'} QuickGroup
 * @typedef {'text' | 'icon' | 'reaction' | 'menu'} QuickKind
 *
 * @typedef {object} QuickChip
 * @property {string} id
 * @property {QuickSurface} surface
 * @property {QuickGroup} group
 * @property {number} order
 * @property {QuickKind} kind
 * @property {string} labelKey
 * @property {string} [domId]
 * @property {string} [cls]
 * @property {string} [icon]
 * @property {number} [iconSize]
 * @property {string} [iconWrapId]
 * @property {string} [iconWrapCls]
 * @property {boolean} [hidden]
 * @property {'class' | 'attr'} [hiddenAs]
 * @property {'host' | 'pad'} [send]
 * @property {string} [attrs]
 * @property {boolean} [menuGate]
 */

/** @type {QuickChip[]} */
export const QUICK_CHIPS = [
  // ── Host yüzeyi (`#in-game-hud`) ─────────────────────────────────────────
  {
    id: 'host-lobby', surface: 'host', group: 'right', order: 10, kind: 'text',
    domId: 'btn-quick-tv-lobby', cls: 'btn-quick-tv-lobby', icon: 'tv',
    labelKey: 'host.backToLobby', hidden: true,
  },
  {
    id: 'host-layout', surface: 'host', group: 'right', order: 20, kind: 'icon',
    domId: 'btn-layout-editor', cls: 'btn-layout-editor', icon: 'settings',
    labelKey: 'controllerLayout.open', hidden: true,
  },
  {
    id: 'host-fullscreen', surface: 'host', group: 'right', order: 30, kind: 'icon',
    domId: 'btn-quick-fullscreen', cls: 'btn-quick-fullscreen', icon: 'maximize_2',
    iconWrapId: 'quick-fullscreen-icon', iconWrapCls: 'fs-icon',
    labelKey: 'pad.fullscreen',
  },
  {
    id: 'host-react', surface: 'host', group: 'right', order: 40, kind: 'reaction',
    domId: 'btn-quick-react', cls: 'btn-quick-react', labelKey: 'pad.reactTitle',
    send: 'host', hidden: true,
  },
  {
    id: 'host-options', surface: 'host', group: 'right', order: 50, kind: 'icon',
    domId: 'btn-open-options', icon: 'more_vertical', labelKey: 'pad.menu',
  },

  // ── Kumanda üst kümesi ───────────────────────────────────────────────────
  // Küme SAĞDA tek sırada: taç · tepki · ⋮. Tepki bilinçli olarak ⋮'nin solunda
  // durur — başparmak tek elle tepkiye de menüye de erişir, yol kısa kalır.
  // Host yüzeyinde de aynı sıra geçerli (`host-react` 40 < `host-options` 50).
  {
    id: 'pad-score', surface: 'pad', group: 'right', order: 10, kind: 'icon',
    domId: 'btn-score-peek', cls: 'gamepad-menu-btn gamepad-score-btn', icon: 'crown',
    labelKey: 'pad.scoreboard', hidden: true, hiddenAs: 'attr',
  },
  {
    id: 'pad-react', surface: 'pad', group: 'right', order: 20, kind: 'reaction',
    cls: 'gamepad-react-btn', labelKey: 'pad.reactTitle', send: 'pad',
  },
  {
    id: 'pad-menu', surface: 'pad', group: 'right', order: 30, kind: 'menu',
    domId: 'btn-gamepad-menu', cls: 'gamepad-menu-btn', icon: 'more_vertical',
    labelKey: 'pad.menu',
  },

  // ── Kumanda açılır menüsü (⋮ paneli) ────────────────────────────────────
  {
    id: 'pad-menu-layout', surface: 'pad', group: 'menu', order: 10, kind: 'text',
    cls: 'gamepad-menu-item', icon: 'settings', iconSize: DEFAULT_MENU_ICON_SIZE,
    labelKey: 'controllerLayout.open', attrs: 'data-controller-layout-open',
    menuGate: true,
  },
  {
    id: 'pad-menu-fullscreen', surface: 'pad', group: 'menu', order: 20, kind: 'text',
    domId: 'btn-fullscreen-toggle', cls: 'gamepad-menu-item', icon: 'maximize_2',
    iconSize: DEFAULT_MENU_ICON_SIZE, labelKey: 'pad.fullscreen',
  },
  {
    id: 'pad-menu-leave', surface: 'pad', group: 'menu', order: 30, kind: 'text',
    domId: 'btn-leave-gamepad', cls: 'gamepad-menu-item is-danger', icon: 'log_out',
    iconSize: DEFAULT_MENU_ICON_SIZE, labelKey: 'pad.leave',
  },
];

/** @param {string} name @param {number} [size] */
function iconSvg(name, size) {
  return getTabletopIconSvg(name, { size: size || DEFAULT_ICON_SIZE });
}

// Tüm çip değerleri bu dosyadaki statik sabitlerdir (kullanıcı verisi yok),
// bu yüzden öznitelik kaçışı gerekmez; `t()` yalnız sözlükten gelir.
/** @param {string} name @param {string | number | undefined} value */
function attr(name, value) {
  return value == null || value === '' ? '' : ` ${name}="${String(value)}"`;
}

/**
 * @param {QuickChip} chip
 * @param {{ showLayoutEditor?: boolean }} ctx
 * @returns {string}
 */
function renderChip(chip, ctx) {
  if (chip.menuGate && ctx.showLayoutEditor === false) return '';
  const label = t(chip.labelKey);
  const classes = [chip.cls, chip.hidden && (chip.hiddenAs || 'class') === 'class' ? 'hidden' : '']
    .filter(Boolean)
    .join(' ');
  const classAttr = classes ? ` class="${classes}"` : '';
  const idAttr = attr('id', chip.domId);
  const extra = chip.attrs ? ` ${chip.attrs}` : '';
  const hiddenAttr = chip.hidden && chip.hiddenAs === 'attr' ? ' hidden' : '';
  const aria = `${attr('data-i18n-aria', chip.labelKey)}${attr('aria-label', label)}${attr('title', label)}`;
  const icon = iconSvg(chip.icon || 'circle', chip.iconSize);

  if (chip.kind === 'reaction') {
    const send = chip.send || 'pad';
    return `<button${classAttr}${idAttr} type="button"${hiddenAttr} data-reaction-open data-reaction-send="${send}"${aria}>`
      + `<span class="reaction-glyph" aria-hidden="true">${reactionGlyph('laugh')}</span></button>`;
  }

  if (chip.kind === 'menu') {
    const items = renderGroup('pad', 'menu', ctx);
    return `<div class="gamepad-menu" id="gamepad-menu">`
      + `<button${classAttr}${idAttr} type="button"${aria}>${icon}</button>`
      + `<div class="gamepad-menu-panel hidden" id="gamepad-menu-panel">${items}</div>`
      + `</div>`;
  }

  if (chip.kind === 'text') {
    const iconWrap = `<span aria-hidden="true">${icon}</span>`;
    return `<button${classAttr}${idAttr}${extra} type="button"${hiddenAttr}${aria}>`
      + `${iconWrap}<span${attr('data-i18n', chip.labelKey)}>${label}</span></button>`;
  }

  // kind === 'icon'
  const block = chip.iconWrapId
    ? `<span${attr('id', chip.iconWrapId)}${classAttr ? attr('class', chip.iconWrapCls) : ''}>${icon}</span>`
    : icon;
  return `<button${classAttr}${idAttr} type="button"${hiddenAttr}${aria}>${block}</button>`;
}

/**
 * @param {QuickSurface} surface
 * @param {QuickGroup} group
 * @param {{ showLayoutEditor?: boolean }} [ctx]
 * @returns {string}
 */
function renderGroup(surface, group, ctx = {}) {
  return QUICK_CHIPS
    .filter((chip) => chip.surface === surface && chip.group === group)
    .sort((a, b) => a.order - b.order)
    .map((chip) => renderChip(chip, ctx))
    .join('');
}

/** Host yüzen kümesi (`#in-game-hud`) gövdesi. */
export function renderHostQuickBar() {
  return renderGroup('host', 'right');
}

/**
 * Kumanda üst kümesi: sol grup (boş) + sağ grup (taç, tepki, ⋮ menüsü).
 * @param {{ showLayoutEditor?: boolean }} [ctx]
 */
export function renderPadHeader(ctx = {}) {
  return {
    left: renderGroup('pad', 'left', ctx),
    right: renderGroup('pad', 'right', ctx),
  };
}
