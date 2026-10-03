// KARAKTER — cihazın karakteri: canlı avatar, isim, renk, yüz ifadesi ve halka.
//
// Bu ekran bir DÜZENLEYİCİDİR ve MERKEZİ sekme şeridini (`tabStrip.js`,
// OYUNLAR ile aynı bileşen) kullanır: RENK ve İFADE yan yana iki sütun yerine
// TEK PANEL olarak sırayla görünür — kısa telefon ekranına taşmadan sığar
// (kullanıcı kararı: "sığmamış ekrana, tablı olabilir").
//
// Veri kaynağı değişmedi: `customizationManager.js` (renk + ifade),
// `playerNameField.js` (isim). `initMenuAvatarCard` canlı sahneyi ve profil
// adını bağlar.

import { t, onLangChange } from '../../i18n.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { initMenuAvatarCard } from '../customizeModal.js';
import { createPlayerNameField } from '../playerNameField.js';
import { createTabStrip } from '../tabStrip.js';
import { registerView } from './registry.js';
import {
  getActivePalettes,
  AVATAR_EXPRESSIONS,
  AVATAR_RIMS,
  AVATAR_HEADWEAR,
  getAvatarProfile,
  saveAvatarProfile,
  resetAvatarProfile,
  paletteName,
  expressionName,
  rimName,
  headwearName,
} from '../../core/customizationManager.js';
import { playMenuTick } from '../../audio.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

/** Renk paleti: tek satır yuvarlak örnekler, seçili olan halka ile işaretli. */
function buildPaletteGrid(onPick) {
  const grid = el('div', 'profile-palette');
  for (const p of getActivePalettes()) {
    const sw = el('button', 'profile-swatch');
    sw.type = 'button';
    sw.dataset.hex = p.hex;
    sw.style.setProperty('--swatch', p.hex);
    sw.title = paletteName(p);
    sw.setAttribute('aria-label', paletteName(p));
    sw.addEventListener('click', () => onPick(p.hex));
    grid.append(sw);
  }
  return grid;
}

/** Yüz ifadeleri: ikon + ad, seçili olan altın kenarlı. */
function buildExpressionGrid(onPick) {
  const grid = el('div', 'profile-expressions');
  for (const exp of AVATAR_EXPRESSIONS) {
    const chip = el('button', 'profile-expression');
    chip.type = 'button';
    chip.dataset.id = exp.id;
    chip.setAttribute('aria-label', expressionName(exp.id, exp.name));
    // Çip ikonu ifadenin KENDİ vektörüdür (`AVATAR_EXPRESSIONS[].icon`) —
    // hepsini 'eye' çizmek 12 yüzü aynı gösteriyordu.
    chip.innerHTML = `<span class="profile-expression-face">${getTabletopIconSvg(exp.icon || 'eye', { size: 15, strokeWidth: 2.2 })}</span><span>${expressionName(exp.id, exp.name)}</span>`;
    chip.addEventListener('click', () => onPick(exp.id));
    grid.append(chip);
  }
  return grid;
}

/** Halka stilleri: halka rengi + içinde o anki gövde rengi (kombin önizlemesi). */
function buildRimGrid(onPick) {
  const grid = el('div', 'profile-rims');
  for (const rim of AVATAR_RIMS) {
    const btn = el('button', 'profile-rim');
    btn.type = 'button';
    btn.dataset.id = rim.id;
    btn.title = rimName(rim.id, rim.name);
    btn.setAttribute('aria-label', rimName(rim.id, rim.name));
    btn.style.setProperty('--rim', rim.hex);
    btn.innerHTML = `<span class="profile-rim-ring"></span><span>${rimName(rim.id, rim.name)}</span>`;
    btn.addEventListener('click', () => onPick(rim.id));
    grid.append(btn);
  }
  return grid;
}

/** Baş süsleri: ikon + ad, seçili olan altın kenarlı. */
function buildHeadwearGrid(onPick) {
  const grid = el('div', 'profile-headwears');
  for (const hw of AVATAR_HEADWEAR) {
    const chip = el('button', 'profile-headwear');
    chip.type = 'button';
    chip.dataset.id = hw.id;
    chip.setAttribute('aria-label', headwearName(hw.id, hw.name));
    chip.innerHTML = `<span class="profile-headwear-icon">${getTabletopIconSvg(hw.icon || 'sparkles', { size: 15, strokeWidth: 2.2 })}</span><span>${headwearName(hw.id, hw.name)}</span>`;
    chip.addEventListener('click', () => onPick(hw.id));
    grid.append(chip);
  }
  return grid;
}

function buildCard() {
  const card = el('article', 'profile-card');
  card.id = 'menu-customize-card';

  // ── Sol: canlı sahne ──
  const media = el('div', 'profile-media');
  const stage = el('div', 'profile-stage');
  stage.id = 'menu-avatar-stage';
  stage.setAttribute('role', 'button');
  stage.tabIndex = -1;
  stage.title = t('menu.boing');
  const canvas = document.createElement('canvas');
  canvas.id = 'menu-avatar-canvas';
  canvas.width = 300;
  canvas.height = 300;
  stage.append(canvas);
  media.append(stage, el('span', 'profile-stage-hint', t('menu.boing')));

  // ── Sağ kolon: başlık + kimlik + sekmeli editör ──
  const body = el('div', 'profile-body');

  const heading = el('div', 'profile-heading');
  heading.append(
    el('span', 'profile-heading-icon', getTabletopIconSvg('gamepad_2', { size: 18, strokeWidth: 2.4 })),
    (() => {
      const s = el('span', 'profile-eyebrow');
      s.textContent = t('menu.avatarBadge');
      return s;
    })(),
    el('h2', 'profile-title', t('menu.avatarTitle')),
  );
  body.append(heading);

  const identity = el('div', 'profile-identity');

  // İş + düzenleme tek bileşende (`playerNameField.js`): ana menü rozeti de
  // aynısını kullanır, iki yerde kopya davranış yok.
  const nameField = createPlayerNameField({ prefix: 'profile-' });
  const chips = el('div', 'profile-chips');
  chips.id = 'menu-avatar-equipped';
  identity.append(nameField.el, chips);
  body.append(identity);

  // ── Editör: MERKEZİ sekme şeridi — tek panel görünür ──
  const editor = el('div', 'profile-editor');

  const applyProfile = (mutate) => {
    const prof = getAvatarProfile();
    mutate(prof);
    saveAvatarProfile(prof);
    paintSelection(prof);
  };

  const colorPanel = el('section', 'profile-panel is-active');
  colorPanel.dataset.panel = 'color';
  colorPanel.append(buildPaletteGrid((hex) => {
    playMenuTick();
    applyProfile((p) => { p.color = hex; });
  }));

  const facePanel = el('section', 'profile-panel');
  facePanel.dataset.panel = 'face';
  facePanel.append(buildExpressionGrid((id) => {
    playMenuTick();
    applyProfile((p) => { p.expression = id; });
  }));

  const rimPanel = el('section', 'profile-panel');
  rimPanel.dataset.panel = 'rim';
  rimPanel.append(buildRimGrid((id) => {
    playMenuTick();
    applyProfile((p) => { p.rim = id; });
  }));

  const headwearPanel = el('section', 'profile-panel');
  headwearPanel.dataset.panel = 'headwear';
  headwearPanel.append(buildHeadwearGrid((id) => {
    playMenuTick();
    applyProfile((p) => { p.headwear = id; });
  }));

  const panels = el('div', 'profile-panels');
  panels.append(colorPanel, facePanel, rimPanel, headwearPanel);

  const tabs = createTabStrip({
    items: [
      { id: 'color', label: t('custom.tabColor'), icon: 'palette' },
      { id: 'face', label: t('custom.tabFace'), icon: 'eye' },
      { id: 'rim', label: t('custom.tabRim'), icon: 'circle_dot' },
      { id: 'headwear', label: t('custom.tabHeadwear'), icon: 'crown' },
    ],
    onChange: (id) => {
      colorPanel.classList.toggle('is-active', id === 'color');
      facePanel.classList.toggle('is-active', id === 'face');
      rimPanel.classList.toggle('is-active', id === 'rim');
      headwearPanel.classList.toggle('is-active', id === 'headwear');
    },
  });

  // ZARLA: rastgele renk + ifade.
  const diceBtn = el('button', 'scene-btn is-ghost profile-dice');
  diceBtn.type = 'button';
  diceBtn.dataset.focus = 'profile';
  diceBtn.innerHTML = `
    <span class="scene-btn-icon">${getTabletopIconSvg('dice', { size: 18, strokeWidth: 2.2 })}</span>
    <span class="scene-btn-copy"><span class="scene-btn-label"></span></span>`;
  diceBtn.querySelector('.scene-btn-label').textContent = t('custom.random');
  diceBtn.addEventListener('click', () => {
    playMenuTick();
    const prof = resetAvatarProfile();
    saveAvatarProfile(prof);
    paintSelection(prof);
  });

  // Dice sekme şeridiyle aynı satırda: kısa yatayda paneller küçülürken
  // buton akışın sonunda overflow:hidden altında kaybolmasın.
  const toolbar = el('div', 'profile-toolbar');
  toolbar.append(tabs.node, diceBtn);
  editor.append(toolbar, panels);
  body.append(editor);

  function paintSelection(prof) {
    colorPanel.querySelectorAll('.profile-swatch').forEach((sw) => {
      const on = prof.color.toLowerCase() === sw.dataset.hex.toLowerCase();
      sw.classList.toggle('is-active', on);
      sw.setAttribute('aria-pressed', String(on));
    });
    facePanel.querySelectorAll('.profile-expression').forEach((chip) => {
      const on = prof.expression === chip.dataset.id;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
    // Halka önizlemesinin göbeği o anki gövde rengidir — kombin canlı okunur.
    rimPanel.querySelectorAll('.profile-rim').forEach((btn) => {
      const on = prof.rim === btn.dataset.id;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', String(on));
      btn.style.setProperty('--dot', prof.color);
    });
    headwearPanel.querySelectorAll('.profile-headwear').forEach((chip) => {
      const on = (prof.headwear || 'NONE') === chip.dataset.id;
      chip.classList.toggle('is-active', on);
      chip.setAttribute('aria-pressed', String(on));
    });
  }

  // İlk seçim boyası (view `keepAlive` olduğu için yalnız kurulumda).
  paintSelection(getAvatarProfile());

  // Karakter başka bir yerden değişirse (TV lobisi, kumanda, atölye) seçim
  // ızgaraları da yenilenir. `saveAvatarProfile` bu olayı yayar.
  card.addEventListener('brutal_customization_changed', (e) => {
    paintSelection(e.detail?.customization || getAvatarProfile());
  });

  // Kart iskeleti en sonda birleşir: sol sahne + sağ gövde (grid sütunları).
  card.append(media, body);

  return card;
}

registerView('profile', {
  title: 'KARAKTER',
  rail: { icon: 'gamepad_2', label: 'KARAKTER', order: 2 },
  keepAlive: true,
  build() {
    const view = el('div', 'profile-view');
    view.append(buildCard());
    initMenuAvatarCard(view);
    // Dil değişiminde metinler tazelenir (kart `keepAlive` olduğu için yeniden kurulmaz).
    onLangChange(() => {
      view.querySelector('.profile-eyebrow').textContent = t('menu.avatarBadge');
      view.querySelector('.profile-title').textContent = t('menu.avatarTitle');
      view.querySelector('.profile-stage-hint').textContent = t('menu.boing');
      const colorTab = view.querySelector('.tab-btn[data-tab="color"] span');
      const faceTab = view.querySelector('.tab-btn[data-tab="face"] span');
      if (colorTab) colorTab.textContent = t('custom.tabColor');
      if (faceTab) faceTab.textContent = t('custom.tabFace');
      const rimTab = view.querySelector('.tab-btn[data-tab="rim"] span');
      if (rimTab) rimTab.textContent = t('custom.tabRim');
      const headwearTab = view.querySelector('.tab-btn[data-tab="headwear"] span');
      if (headwearTab) headwearTab.textContent = t('custom.tabHeadwear');
      const dice = view.querySelector('.profile-dice .scene-btn-label');
      if (dice) dice.textContent = t('custom.random');
      view.querySelectorAll('.profile-headwear').forEach((chip) => {
        const id = chip.dataset.id;
        const hw = AVATAR_HEADWEAR.find((h) => h.id === id);
        if (hw) {
          const name = headwearName(hw.id, hw.name);
          chip.setAttribute('aria-label', name);
          const span = chip.querySelector('span:last-child');
          if (span) span.textContent = name;
        }
      });
    });
    return view;
  },
});
