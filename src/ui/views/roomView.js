// Oda kurma — ana menüdeki ODA KUR eyleminin açtığı SAHNE ekranı.
//
// Bu bir "form" değil, ana menünün devamı: aynı arena, aynı karakter (daha
// küçük, sol köşede), sağda iki dev seçenek. TV ve ONLINE yazıları oyun
// karakteri gibi ekranda durur; kart listesi / web sayfası düzeni yok.
// AYNI CİHAZ seçeneği burada değil: yerel oynama ana menüdeki OYNA →
// oyun arenası üzerinden yapılır, iki yol aynı işi göstermez.

import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { t, onLangChange } from '../../i18n.js';
import { playMenuTick, playMenuPop } from '../../audio.js';
import { registerView } from './registry.js';
import { mountHeroAvatar } from './heroAvatar.js';
import { createPlayerNameField } from '../playerNameField.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

const OPTIONS = [
  { id: 'TV_CONSOLE', label: 'TV', icon: 'tv' },
  { id: 'ONLINE', label: 'ONLINE', icon: 'globe' },
];

registerView('room', {
  title: 'ODA KUR',
  // Rayde görünmez: bir eylemden açılan adım ekranı, kalıcı hedef değil.
  rail: null,
  chrome: 'cinema',    // yüzen gezinme sahne üstünde kalır
  build({ actions, openView }) {
    const view = el('div', 'scene room-scene');
    view.append(
      el('div', 'scene-backdrop', ''),
      el('div', 'scene-spotlight', ''),
      el('div', 'scene-floor', ''),
      el('div', 'scene-vignette', ''),
    );

    // ── Sol köşe: karakter (daha küçük) + isim rozeti ──
    const stage = el('div', 'scene-hero room-hero');
    const canvas = document.createElement('canvas');
    canvas.className = 'scene-hero-canvas room-hero-canvas';
    stage.append(canvas);

    const nameField = createPlayerNameField({
      prefix: 'home-',
      ids: {
        viewRow: 'room-name-view',
        name: 'room-name',
        edit: 'room-name-edit',
        reroll: 'room-name-reroll',
        inputRow: 'room-name-input-row',
        input: 'room-name-input',
        save: 'room-name-save',
      },
    });
    const badge = el('div', 'scene-badge room-badge');
    badge.append(nameField.el);
    stage.append(badge);
    view.append(stage);

    // ── Sağ: iki dev seçenek ──
    const list = el('div', 'room-choices');
    const rows = OPTIONS.map((opt) => {
      const btn = el('button', 'room-choice');
      btn.type = 'button';
      btn.dataset.focus = 'room';
      btn.dataset.mode = opt.id;
      btn.tabIndex = -1;
      btn.innerHTML = `
        <span class="room-choice-word"></span>
        <span class="room-choice-desc"></span>
        <span class="room-choice-icon">${getTabletopIconSvg(opt.icon, { size: 26, strokeWidth: 2.1 })}</span>`;
      btn.addEventListener('click', () => {
        playMenuPop();
        // Mod değişimi platform modunu da günceller: oda ekranından ayrılırken
        // seçilen mod tek gerçek olur (lobi, davet linki ve pill aynı değeri okur).
        actions.setPlatformMode?.(opt.id);
        actions.openHostLobby?.();
      });
      list.append(btn);
      return btn;
    });
    view.append(list);

    function applyTexts() {
      rows.forEach((btn, i) => {
        const opt = OPTIONS[i];
        const word = btn.querySelector('.room-choice-word');
        const desc = btn.querySelector('.room-choice-desc');
        word.textContent = t(opt.label);
        desc.textContent = t(`shell.room.${opt.id === 'TV_CONSOLE' ? 'tvDesc' : 'onlineDesc'}`);
        btn.setAttribute('aria-label', `${t(opt.label)} — ${desc.textContent}`);
      });
    }
    applyTexts();

    const dispose = mountHeroAvatar(canvas);
    const offLang = onLangChange(() => { applyTexts(); nameField.refresh(); });
    view.addEventListener('shell:viewleave', () => {
      dispose();
      nameField.destroy();
      offLang();
    }, { once: true });

    return view;
  },
});
