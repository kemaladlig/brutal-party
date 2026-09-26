// Oyuncu isim alanı — görünür isim + kalem (düzenle) + zar (rastgele).
//
// İki yerde kullanılır (ana menü rozeti ve profil kartı); tekrarı önlemek için
// davranış burada yaşar. `src/ui/customizeModal.js` yalnız avatar sahnesi ve
// ifade çipleriyle ilgilenir, isim düzenlemesine dokunmaz.
//
// Kalıcı depolama `net.js`in tek kaynağında: `storePlayerName` her yerde
// (lobi, kumanda, relay) aynı ismi okur.

import { getStoredPlayerName, storePlayerName, cleanPlayerName, generateNick } from '../net.js';
import { t } from '../i18n.js';
import { playMenuTick, playMenuPop } from '../audio.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export const DEFAULT_NAME_IDS = Object.freeze({
  viewRow: 'menu-name-view-row',
  name: 'menu-avatar-name',
  edit: 'btn-edit-menu-name',
  reroll: 'btn-reroll-menu-name',
  inputRow: 'menu-name-input-row',
  input: 'input-menu-name',
  save: 'btn-save-menu-name',
});

/**
 * @param {object} opts
 *   ids       — DOM id'leri (varsayılan: eski profil kartı id'leri).
 *   prefix    — sınıf ön eki (`home-` / ``).
 *   onChange  — isim kalıcı olarak değiştiğinde çağrılır.
 * @returns {{ el: HTMLElement, setName: (s: string) => void, focusEdit: () => void, destroy: () => void }}
 */
export function createPlayerNameField({ ids = {}, prefix = '', onChange = null } = {}) {
  const id = { ...DEFAULT_NAME_IDS, ...ids };

  const root = el('div', `${prefix}name-field`);

  // ── Görünür hâl ──
  const viewRow = el('div', `${prefix}name-view`);
  viewRow.id = id.viewRow;
  const nameEl = el('span', `${prefix}name-text`);
  nameEl.id = id.name;

  const editBtn = el('button', `${prefix}name-action`);
  editBtn.type = 'button';
  editBtn.id = id.edit;
  editBtn.setAttribute('aria-label', t('menu.editName'));
  editBtn.title = t('menu.editName');
  editBtn.dataset.focus = 'name';
  editBtn.innerHTML = getTabletopIconSvg('pencil', { size: 14 });

  const rerollBtn = el('button', `${prefix}name-action`);
  rerollBtn.type = 'button';
  rerollBtn.id = id.reroll;
  rerollBtn.setAttribute('aria-label', t('menu.rerollName'));
  rerollBtn.title = t('menu.rerollName');
  rerollBtn.dataset.focus = 'name';
  rerollBtn.innerHTML = getTabletopIconSvg('dice', { size: 14 });

  viewRow.append(nameEl, editBtn, rerollBtn);

  // ── Düzenleme hâli ──
  const inputRow = el('div', `${prefix}name-edit hidden`);
  inputRow.id = id.inputRow;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `${prefix}name-input`;
  input.id = id.input;
  input.maxLength = 12;
  input.placeholder = t('menu.nickPh');
  input.setAttribute('autocapitalize', 'characters');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', t('menu.editName'));
  input.dataset.focus = 'name';

  const saveBtn = el('button', `${prefix}name-save`, '✓');
  saveBtn.type = 'button';
  saveBtn.id = id.save;
  saveBtn.setAttribute('aria-label', t('menu.saveName'));
  saveBtn.title = t('menu.saveName');
  saveBtn.dataset.focus = 'name';

  inputRow.append(input, saveBtn);
  root.append(viewRow, inputRow);

  // ── Davranış ──
  function currentName() {
    try { return getStoredPlayerName() || ''; } catch { return ''; }
  }

  function setName(text) {
    nameEl.textContent = text || 'OYUNCU';
  }

  function closeEdit() {
    inputRow.classList.add('hidden');
    viewRow.classList.remove('hidden');
  }

  function commit(raw) {
    const base = currentName();
    const clean = cleanPlayerName(raw) || base || generateNick(base);
    storePlayerName(clean);
    setName(clean);
    closeEdit();
    onChange?.(clean);
  }

  function openEdit() {
    input.value = currentName();
    viewRow.classList.add('hidden');
    inputRow.classList.remove('hidden');
    try { input.focus(); input.select(); } catch {}
  }

  editBtn.addEventListener('click', (e) => { e.stopPropagation(); playMenuTick(); openEdit(); });

  rerollBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    playMenuPop();
    commit(generateNick(currentName()));
  });

  saveBtn.addEventListener('click', (e) => { e.stopPropagation(); commit(input.value); });

  input.addEventListener('click', (e) => e.stopPropagation());
  // Mobil klavye: odak alanının içine tıklamak kabuk odağını kaçırmasın.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') commit(input.value);
    else if (e.key === 'Escape') closeEdit();
  });
  input.addEventListener('input', () => {
    input.value = (input.value || '').toUpperCase();
  });

  setName(currentName());

  return {
    el: root,
    setName,
    /** Dil değişiminde yeniden okuma (yer tutucu/erişilebilirlik metinleri). */
    refresh() { setName(currentName()); },
    focusEdit: openEdit,
    closeEdit,
    destroy() {
      // Dinleyiciler `el` ağacı DOM'dan ayrıldığında GC'yle toplanır; açık
      // düzenleme durumunda kalmaması için güvenli kapatma.
      if (!inputRow.classList.contains('hidden')) closeEdit();
    },
  };
}
