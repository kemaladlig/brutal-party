// OYUNLAR — sol gezinmenin kalıcı hedefi: 15 oyunun GALERİSİ (lobinin kardeş dili).
//
// Sekmeler MERKEZİ `tabStrip.js` bileşeninden gelir (KARAKTER editörü de aynı
// bileşeni kullanır). Izgara SAYFALIDIR: her sayfada ekrana sığan 8 kapak
// (4×2 hücre, taşma yok — "hepsi tek seferde görünmek zorunda değil" kararı),
// sayfa okları ile gezinilir. Sağ kolonda seçili oyunun kahramanı (büyük
// kapak + ad + taktik ipucu) ve tek altın CTA `▶ OYNA`. Kart SEÇER, CTA başlatır.
//
// Veri kaynağı değişmedi: `CARTRIDGES` + `GAME_ORDER` (registry tek nokta).

import { GAME_ORDER, CARTRIDGES, preloadEngine } from '../../core/engineRegistry.js';
import { t, onLangChange } from '../../i18n.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { createTabStrip } from '../tabStrip.js';
import { registerView } from './registry.js';
import { playMenuTick } from '../../audio.js';

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

const ART = (mode) => `/assets/games/${String(mode).toLowerCase()}.jpg`;

// Kategori tek kaynağı CARTRIDGES.category'dir (registry'de tanımlı).
const CATEGORIES = [
  { id: 'all', label: 'TÜMÜ', icon: 'sparkles' },
  { id: 'fight', label: 'DÖVÜŞ', icon: 'swords' },
  { id: 'aim', label: 'NİŞAN', icon: 'target' },
  { id: 'speed', label: 'HIZ', icon: 'zap' },
  { id: 'strategy', label: 'TAKTİK', icon: 'shield' },
];

const categoryById = (id) => CATEGORIES.find((c) => c.id === id);

// 4 sütun × 2 satır = sayfa başına 8 kapak (games.css `.games-grid` ile birebir).
const PAGE_SIZE = 8;

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

    // ── Sol/ana alan: sekme şeridi + sayfalı kapak ızgarası ────────────────
    const main = el('div', 'games-main');

    const tabs = createTabStrip({
      items: CATEGORIES.map((cat) => ({ id: cat.id, label: cat.label, icon: cat.icon })),
      onChange: (id) => { state.category = id; state.page = 0; renderPage(); },
    });

    const pageLabel = el('span', 'games-page-label', '');
    const pagePrev = el('button', 'tab-btn games-page-btn', getTabletopIconSvg('arrow_left', { size: 14, strokeWidth: 2.4 }));
    const pageNext = el('button', 'tab-btn games-page-btn', getTabletopIconSvg('arrow_right', { size: 14, strokeWidth: 2.4 }));
    for (const [btn, dir] of [[pagePrev, -1], [pageNext, 1]]) {
      btn.type = 'button';
      btn.dataset.focus = 'tab';
      btn.tabIndex = -1;
      btn.addEventListener('click', () => {
        playMenuTick();
        state.page += dir;
        renderPage();
      });
    }
    const pager = el('div', 'games-pager');
    pager.append(pagePrev, pageLabel, pageNext);

    const head = el('div', 'games-head');
    head.append(tabs.node, pager);

    const grid = el('div', 'games-grid');
    grid.setAttribute('role', 'list');
    const tiles = new Map();
    GAME_ORDER.forEach((mode, index) => {
      const tile = gameCard(mode, index);
      tile.setAttribute('role', 'listitem');
      // Kart dokunuşu SEÇER; başlatma tek CTA'nın işi (tek eylem kuralı).
      tile.addEventListener('click', () => select(mode));
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

    // ── Seçim + sayfalama: tek yerden boyanır ──────────────────────────────
    const state = { category: 'all', page: 0 };
    let activeMode = null;

    const visibleModes = () => GAME_ORDER.filter(
      (mode) => state.category === 'all' || CARTRIDGES[mode]?.category === state.category,
    );

    function select(mode) {
      if (!mode || mode === activeMode) return;
      activeMode = mode;
      const cart = CARTRIDGES[mode];
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
      playBtn.onclick = () => actions.onGameSelect?.(mode);
      playBtn.setAttribute('aria-label', `${t('shell.playNow')} — ${cart?.title || mode}`);
      preloadEngine(mode);
    }

    function renderPage() {
      const list = visibleModes();
      const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
      state.page = Math.min(Math.max(state.page, 0), pages - 1);
      const start = state.page * PAGE_SIZE;
      const shown = new Set(list.slice(start, start + PAGE_SIZE));
      tiles.forEach((tile, mode) => { tile.hidden = !shown.has(mode); });

      pager.hidden = pages < 2;
      pageLabel.textContent = `${state.page + 1} / ${pages}`;
      pagePrev.disabled = state.page === 0;
      pageNext.disabled = state.page >= pages - 1;

      if (activeMode && !shown.has(activeMode)) select(list[start] || list[0]);
      // Odak listesi değişti: shell'e tazeleme sinyali.
      refreshFocus?.();
    }

    // Odak değişimi shell'den gelen tek olaydır (bkz. appShell onFocusChange).
    view.addEventListener('shell:focuschange', (e) => {
      const mode = e.detail?.el?.dataset?.game;
      if (mode) select(mode);
    });
    select(GAME_ORDER[0]);
    renderPage();

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
