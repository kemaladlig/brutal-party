// OYUNLAR — sol gezinmenin kalıcı hedefi: 15 oyunun GALERİSİ (lobinin kardeş dili).
//
// Sekmeler MERKEZİ `tabStrip.js` bileşeninden gelir (KARAKTER editörü de aynı
// bileşeni kullanır). Izgara DİKEY KAYAR: kapsüllenmiş iç scroller'da 4 sütun,
// tüm filtre sonucu tek akışta (sayfalama kaldırıldı — kullanıcı kararı).
// Sağ kolonda seçili oyunun kahramanı (büyük kapak + ad + taktik ipucu)
// ve tek altın CTA `▶ OYNA`. Kart SEÇER, CTA başlatır.
//
// Veri kaynağı değişmedi: `CARTRIDGES` + `GAME_ORDER` (registry tek nokta).

import { GAME_ORDER, CARTRIDGES, preloadEngine, gameArtPath } from '../../core/engineRegistry.js';
import { t, onLangChange } from '../../i18n.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { createTabStrip } from '../tabStrip.js';
import { playMenuTick, playMenuPop } from '../../audio.js';
import { registerView } from './registry.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

const ART = gameArtPath;

// Kategori tek kaynağı CARTRIDGES.category'dir (registry'de tanımlı).
const CATEGORIES = [
  { id: 'all', label: 'TÜMÜ', icon: 'sparkles' },
  { id: 'fight', label: 'DÖVÜŞ', icon: 'swords' },
  { id: 'aim', label: 'NİŞAN', icon: 'target' },
  { id: 'speed', label: 'HIZ', icon: 'zap' },
  { id: 'strategy', label: 'TAKTİK', icon: 'shield' },
];

const categoryById = (id) => CATEGORIES.find((c) => c.id === id);

// 4 sütun, satırlar içeriğe göre uzar; ızgara dikey kayar (iç scroller).

function gameCard(mode, index) {
  const cart = CARTRIDGES[mode];
  const card = el('button', 'game-card');
  card.type = 'button';
  card.dataset.focus = 'game';
  card.dataset.game = mode;
  card.tabIndex = -1;
  if (cart?.retired) card.classList.add('is-retired');
  card.setAttribute('aria-label', cart?.title || mode);

  const img = document.createElement('img');
  img.src = ART(mode);
  img.alt = '';
  img.loading = index < 8 ? 'eager' : 'lazy';
  img.decoding = 'async';
  // Kapak swap edilirken (webp yok/bozuk) galeri kırılmasın: kart zemini +
  // isim etiketi kalır, kırık ikon gösterilmez (kumanda önizlemeyle aynı dil).
  img.addEventListener('error', () => { img.style.display = 'none'; }, { once: true });

  card.append(
    img,
    el('span', 'game-card-index', String(index + 1).padStart(2, '0')),
    el('span', 'game-card-name', cart?.title || mode),
  );
  if (cart?.retired) card.append(el('span', 'game-card-retired', 'ARŞİV'));

  // Kart görünürken motor chunk'ı arka planda insin (mevcut menü davranışı).
  card.addEventListener('mouseenter', () => preloadEngine(mode), { passive: true });
  card.addEventListener('touchstart', () => preloadEngine(mode), { passive: true });
  return card;
}

registerView('games', {
  title: 'OYUNLAR',
  rail: { icon: 'target', label: 'OYUNLAR', order: 1 },
  chrome: 'cinema',    // sahne tam kaplama; yüzen gezinme solda dikey ortada
  build({ actions, refreshFocus }) {
    const view = el('div', 'scene games-scene');
    view.append(
      el('div', 'scene-backdrop', ''),
      el('div', 'scene-spotlight', ''),
      el('div', 'scene-floor', ''),
      el('div', 'scene-vignette', ''),
    );

    const body = el('div', 'games-body');

    // ── Sol/ana alan: sekme şeridi + kayan kapak ızgarası ─────────────────
    const main = el('div', 'games-main');

    const tabs = createTabStrip({
      items: CATEGORIES.map((cat) => ({ id: cat.id, label: cat.label, icon: cat.icon })),
      onChange: (id) => { state.category = id; renderFilter(); },
    });

    const head = el('div', 'games-head');
    head.append(tabs.node);

    const grid = el('div', 'games-grid');
    grid.setAttribute('role', 'list');
    const tiles = new Map();
    GAME_ORDER.forEach((mode, index) => {
      const tile = gameCard(mode, index);
      tile.setAttribute('role', 'listitem');
      // Kart dokunuşu SEÇER; başlatma tek CTA'nın işi (tek eylem kuralı).
      tile.addEventListener('click', () => { playMenuTick(); select(mode); });
      tiles.set(mode, tile);
      grid.append(tile);
    });
    main.append(head, grid);

    // ── Sağ kolon: seçili oyunun kahramanı + tek OYNA ──
    const side = el('aside', 'games-side');
    const heroCover = document.createElement('img');
    heroCover.className = 'games-hero-cover';
    heroCover.alt = '';
    heroCover.decoding = 'async';
    // Kahraman kapak yoksa alan çökmesin: kopya + CTA ayakta kalır.
    heroCover.addEventListener('error', () => { heroCover.style.display = 'none'; });
    const heroCat = el('span', 'games-hero-cat', '');
    const heroName = el('h3', 'games-hero-name', '');
    const heroHint = el('p', 'games-hero-hint', '');
    const copy = el('div', 'games-hero-copy');
    copy.append(heroCat, heroName, heroHint);

    const playBtn = el('button', 'scene-btn is-gold games-play');
    playBtn.type = 'button';
    playBtn.dataset.focus = 'play';
    playBtn.tabIndex = -1;
    playBtn.innerHTML = `
      <span class="scene-btn-icon">${getTabletopIconSvg('play', { size: 22, strokeWidth: 2.2 })}</span>
      <span class="scene-btn-copy"><span class="scene-btn-label"></span></span>`;
    side.append(heroCover, copy, playBtn);

    body.append(main, side);
    view.append(body);

    // ── Seçim + filtre: tek yerden boyanır ─────────────────────────────────
    const state = { category: 'all' };
    let activeMode = null;

    const visibleModes = () => GAME_ORDER.filter(
      (mode) => state.category === 'all' || CARTRIDGES[mode]?.category === state.category,
    );

    function select(mode) {
      if (!mode || mode === activeMode) return;
      activeMode = mode;
      const cart = CARTRIDGES[mode];
      heroCover.style.display = '';
      heroCover.src = ART(mode);
      heroCover.classList.remove('is-in');
      // Re-trigger: sınıfın düşmesi için bir kare refix zorunlu.
      void heroCover.offsetWidth;
      heroCover.classList.add('is-in');
      heroName.textContent = cart?.title || mode;
      const cat = categoryById(cart?.category);
      heroCat.textContent = cat ? cat.label : '';
      heroCat.dataset.category = cat?.id || 'all';
      heroCat.hidden = !cat || cat.id === 'all';
      heroHint.textContent = t(cart?.tacticalHintKey || '');
      tiles.forEach((tile, key) => tile.classList.toggle('is-active', key === mode));
      playBtn.onclick = () => { playMenuPop(); actions.onGameSelect?.(mode); };
      playBtn.setAttribute('aria-label', `${t('shell.playNow')} — ${cart?.title || mode}`);
      preloadEngine(mode);
    }

    function renderFilter() {
      const list = visibleModes();
      const shown = new Set(list);
      tiles.forEach((tile, mode) => { tile.hidden = !shown.has(mode); });
      grid.scrollTop = 0;

      if (activeMode && !shown.has(activeMode)) select(list[0]);
      // Odak listesi değişti: shell'e tazeleme sinyali.
      refreshFocus?.();
    }

    // Odak değişimi shell'den gelen tek olaydır (bkz. appShell onFocusChange).
    view.addEventListener('shell:focuschange', (e) => {
      const mode = e.detail?.el?.dataset?.game;
      if (mode) select(mode);
    });
    select(GAME_ORDER[0]);
    renderFilter();

    function applyTexts() {
      CATEGORIES.forEach((cat) => {
        const n = cat.id === 'all'
          ? GAME_ORDER.length
          : GAME_ORDER.filter((m) => CARTRIDGES[m]?.category === cat.id).length;
        tabs.setCount(cat.id, n);
      });
      playBtn.querySelector('.scene-btn-label').textContent = t('shell.playNow');
      if (activeMode) {
        const cart = CARTRIDGES[activeMode];
        const cat = categoryById(cart?.category);
        heroCat.textContent = cat ? cat.label : '';
        heroHint.textContent = t(cart?.tacticalHintKey || '');
      }
    }
    applyTexts();
    const offLang = onLangChange(applyTexts);
    view.addEventListener('shell:viewleave', () => offLang(), { once: true });

    return view;
  },
});
