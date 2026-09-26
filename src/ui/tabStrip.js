// Merkezi sekme şeridi — OYUNLAR kategori filtresi ve KARAKTER düzenleyicisi
// (RENK / İFADE) AYNI bileşeni kullanır. Stil `scene.css` içindeki `.tab-strip`
// ailesidir; ikinci bir sekme uygulaması açmak yasaktır (AGENTS.md §2 DRY).
//
// Kullanım:
//   const tabs = createTabStrip({ items: [{ id, label, icon?, count? }] });
//   tabs.node → DOM'a ekle; tabs.setActive(id); tabs.onChange = fn.
//   Odak router'ı düğmeleri `data-focus="tab"` ile toplar.

import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { playMenuTick } from '../audio.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

/**
 * @param {object} opts
 *   items    — [{ id, label, icon?, count? }]
 *   onChange — sekme id'si ile çağrılır (kullanıcı seçimi)
 * @returns {{ node: HTMLElement, setActive: (id: string) => void,
 *             setCount: (id: string, n: number|string) => void,
 *             setLabel: (id: string, text: string) => void }}
 */
export function createTabStrip({ items = [], onChange = null } = {}) {
  const node = el('div', 'tab-strip');
  node.setAttribute('role', 'tablist');

  let activeId = items.length ? items[0].id : null;
  const buttons = new Map();

  for (const item of items) {
    const btn = el('button', 'tab-btn');
    btn.type = 'button';
    btn.dataset.focus = 'tab';
    btn.tabIndex = -1;
    btn.dataset.tab = item.id;
    btn.setAttribute('role', 'tab');
    if (item.icon) btn.innerHTML = getTabletopIconSvg(item.icon, { size: 13, strokeWidth: 2.3 });
    const label = el('span');
    label.textContent = item.label;
    btn.append(label);
    const count = el('i');
    count.textContent = item.count != null ? String(item.count) : '';
    count.hidden = item.count == null;
    btn.append(count);
    btn.addEventListener('click', () => {
      if (btn.dataset.tab === activeId) return;
      playMenuTick();
      setActive(btn.dataset.tab);
      onChange?.(btn.dataset.tab);
    });
    buttons.set(item.id, { btn, label, count });
    node.append(btn);
  }

  function setActive(id) {
    activeId = id;
    buttons.forEach(({ btn }, key) => {
      const on = key === id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-selected', String(on));
    });
  }

  function setCount(id, n) {
    const entry = buttons.get(id);
    if (!entry) return;
    entry.count.textContent = n == null ? '' : String(n);
    entry.count.hidden = n == null;
  }

  function setLabel(id, text) {
    const entry = buttons.get(id);
    if (entry) entry.label.textContent = text;
  }

  setActive(activeId);

  return { node, setActive, setCount, setLabel, get active() { return activeId; } };
}
