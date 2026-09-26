// İkon yuvaları — DOM'daki `[data-icon]` / `[data-lobby-icon]` yuva adlarını
// Lucide SVG'ye bağlar.
//
// Neden ayrı bir modül: `index.html` ve view dosyaları ikonu elle yazmaz,
// yalnız YERINI işaretler. Boyut `data-icon-size` ile, ikon adı tek kaynaktan
// (`src/core/tabletopIcons.js`) gelir. Böylece bir ikon ailesi hem lobi hem
// sheet hem view'da aynı yolla üretilir; ham OS emojisi UI'a girmez
// (AGENTS.md §7).
//
// Kullanım:
//   hydrateIconSlots(root)                              → [data-icon], 16px
//   hydrateIconSlots(root, 'lobbyIcon', { size: 18 })   → [data-lobby-icon]

import { getTabletopIconSvg } from '../core/tabletopIcons.js';

const toAttr = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/**
 * @param {ParentNode} root
 * @param {string} attr — yuva özniteliğinin camelCase adı (`icon`, `lobbyIcon`)
 * @param {{size?: number, strokeWidth?: number}} [defaults] — öznitelik yoksa
 */
export function hydrateIconSlots(root = document, attr = 'icon', defaults = {}) {
  if (!root?.querySelectorAll) return;
  const dataAttr = `data-${toAttr(attr)}`;
  for (const slot of root.querySelectorAll(`[${dataAttr}]`)) {
    const name = slot.getAttribute(dataAttr);
    if (!name) continue;
    slot.innerHTML = getTabletopIconSvg(name, {
      size: Number(slot.getAttribute('data-icon-size')) || defaults.size || 16,
      strokeWidth: Number(slot.getAttribute('data-icon-stroke')) || defaults.strokeWidth || 2.2,
    });
  }
}
