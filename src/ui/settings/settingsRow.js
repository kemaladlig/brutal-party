// Ayar satırı üreticisi — tek satır DOM'u, tek satır durum senkronu.
// Satır ne sekme bilir ne konak: tam panel de pause'un hızlı seti de aynı
// `createSettingRow`den geçer, böylece bir ayarın iki yüzeyde farklı
// davranması yapısal olarak imkânsızlaşır.

import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { t } from '../../i18n.js';
import { playMenuTick } from '../../audio.js';
import { settingsActions } from './settingsActions.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

/** @param {any} value */
function text(value) {
  return value == null ? '' : String(value);
}

/**
 * @param {import('./settingsSchema.js').SettingsRow} row
 * @param {{ close?: (() => void) | null }} [ctx] `action` satırına verilir:
 *   düzenleyici gibi alt ekran açan satır kendi yüzeyini kapatır, yoksa
 *   alt ekran kapanınca ayarlar ölü bir katmanın altında kalır.
 * @returns {{ node: HTMLElement, refresh: () => void, available: () => boolean }}
 *   `refresh` görünürlüğü de yeniden ölçer (aşağıya bakın).
 */
export function createSettingRow(row, ctx = {}) {
  const action = /** @type {any} */ (settingsActions[/** @type {string} */ (row.action)]);
  if (!action) throw new Error(`[settings] eylemsiz satır: ${row.id}`);

  const read = () => (typeof action.get === 'function' ? action.get() : null);
  const available = () => (typeof action.available === 'function' ? !!action.available() : true);
  /** @param {boolean} on */
  const iconFor = (on) => {
    const icon = row.iconOn;
    const name = typeof icon === 'string' ? icon : (on ? icon?.on : icon?.off);
    return name || row.icon || 'settings';
  };

  /** @type {() => void} */
  let refresh = () => {};

  let node;
  if (row.type === 'switch') node = buildSwitch();
  else if (row.type === 'choice') node = buildChoice();
  else if (row.type === 'slider') node = buildSlider();
  else if (row.type === 'action') node = buildAction();
  else node = buildStatic();

  function buildSwitch() {
    const iconSlot = el('span', 'row-ico');
    const btn = el('button', 'setting-row is-switch');
    btn.type = 'button';
    btn.setAttribute('role', 'switch');
    btn.append(iconSlot, el('span', 'row-label', t(row.labelKey)), el('span', 'row-track', '<span class="row-knob"></span>'));
    btn.addEventListener('click', () => {
      playMenuTick();
      action.toggle();
      refresh();
    });
    refresh = () => {
      const on = !!read();
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
      iconSlot.innerHTML = getTabletopIconSvg(iconFor(on), { size: 16, strokeWidth: 2.3 });
    };
    refresh();
    return btn;
  }

  function buildChoice() {
    const wrap = el('div', 'setting-row is-choice');
    const group = el('div', 'row-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t(row.ariaKey || row.labelKey));
    /** @type {Map<string, HTMLButtonElement>} */
    const buttons = new Map();
    for (const option of row.options || []) {
      const btn = el('button', 'group-btn', t(option.labelKey));
      btn.type = 'button';
      btn.addEventListener('click', () => {
        playMenuTick();
        action.set(option.value);
        refresh();
      });
      buttons.set(option.value, btn);
      group.append(btn);
    }
    wrap.append(el('span', 'row-label', t(row.labelKey)), group);
    refresh = () => {
      const value = read();
      buttons.forEach((btn, key) => {
        const on = key === value;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', String(on));
      });
    };
    refresh();
    return wrap;
  }

  function buildSlider() {
    const wrap = el('div', 'setting-row is-slider');
    const output = el('output', 'slider-value');
    const input = /** @type {HTMLInputElement} */ (el('input', 'slider-input'));
    input.type = 'range';
    input.min = text(row.min);
    input.max = text(row.max);
    input.step = text(row.step);
    input.setAttribute('aria-label', t(row.labelKey));
    input.addEventListener('input', () => {
      action.set(Number(input.value));
      refresh();
    });
    const field = el('div', 'slider-field');
    field.append(input, output);
    wrap.append(el('span', 'row-label', t(row.labelKey)), field);
    refresh = () => {
      const value = read();
      input.value = text(value);
      output.textContent = typeof action.format === 'function' ? action.format(value) : text(value);
    };
    refresh();
    return wrap;
  }

  function buildAction() {
    const btn = el('button', 'setting-row is-action');
    btn.type = 'button';
    const label = el('span', 'row-label', t(row.labelKey));
    btn.append(
      el('span', 'row-ico', getTabletopIconSvg(row.icon || 'settings', { size: 16, strokeWidth: 2.3 })),
      label,
      el('span', 'row-hint', row.hintKey ? t(row.hintKey) : ''),
      el('span', 'row-chevron', '›'),
    );
    btn.addEventListener('click', () => {
      playMenuTick();
      action.run({ close: ctx.close || null });
    });
    refresh = () => {
      if (row.dynamicLabel) label.textContent = text(read()) || label.textContent;
      // `available()` satırı TAMAMEN kaldırır; `highlight()` satırı yerinde
      // vurgular (bekleyen güncelleme gizlenecek bir ayar değildir).
      btn.classList.toggle('is-hot', typeof action.highlight === 'function' && !!action.highlight());
    };
    refresh();
    return btn;
  }

  function buildStatic() {
    const wrap = el('div', 'setting-row is-static');
    const value = el('strong', 'row-value');
    wrap.append(el('span', 'row-label', t(row.labelKey)), value);
    refresh = () => { value.textContent = text(read()); };
    refresh();
    return wrap;
  }

  // Görünürlük HER senkronda yeniden ölçülür: tam ekran düğmesi ya da kumanda
  // satırı açılışta yoktu diye sonsuza dek gizli kalmaz (panel bir kez kurulur).
  const sync = () => {
    const present = available();
    if (node.hidden !== !present) node.hidden = !present;
    refresh();
  };
  sync();
  return { node, refresh: sync, available };
}
