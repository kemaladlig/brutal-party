// Oyun arenası — ana menüdeki OYNA eyleminin açtığı SAHNE ekranı.
//
// Oda ekranı gibi bu da bir "sayfa" değil, aynı arenanın devamı: 15 oyun
// yatay bir rafta, seçili oyunun adı ve taktik ipucu DEV YAZI olarak sahnenin
// sol altında, tek OYNA düğmesi sağ altta. Sağdaki "önizleme paneli" kaldırıldı
// — oyun kartını ayrı bir kutuyla tekrar göstermek web sayfası gibi okunuyordu.
//
// Veri kaynağı değişmedi: `CARTRIDGES` + `GAME_ORDER` (registry tek nokta).

import { GAME_ORDER, CARTRIDGES, preloadEngine } from '../../core/engineRegistry.js';
import { t, onLangChange } from '../../i18n.js';
import { getTabletopIconSvg } from '../../core/tabletopIcons.js';
import { registerView } from './registry.js';

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

function gameTile(mode, index) {
  const cart = CARTRIDGES[mode];
  const tile = el('button', 'game-tile');
  tile.type = 'button';
  tile.dataset.focus = 'game';
  tile.dataset.game = mode;
  tile.tabIndex = -1;
  if (cart?.retired) tile.classList.add('is-retired');

  const img = document.createElement('img');
  img.className = 'game-tile-img';
  img.src = ART(mode);
  img.alt = '';
  img.loading = index < 6 ? 'eager' : 'lazy';
  img.decoding = 'async';

  const art = el('span', 'game-tile-art');
  art.append(img);
  tile.append(
    art,
    el('span', 'game-tile-index', String(index + 1).padStart(2, '0')),
    el('span', 'game-tile-name', cart?.title || mode),
  );
  if (cart?.retired) tile.append(el('span', 'game-tile-retired', 'ARŞİV'));

  // Kart görünürken motor chunk'ı arka planda insin (mevcut menü davranışı).
  tile.addEventListener('mouseenter', () => preloadEngine(mode), { passive: true });
  tile.addEventListener('touchstart', () => preloadEngine(mode), { passive: true });
  return tile;
}

registerView('games', {
  title: 'OYUN ARENASI',
  rail: { icon: 'target', label: 'OYUN', order: 1 },
  chrome: 'cinema',    // üst şerit sahne üstünde overlay olarak yüzer
  build({ actions, openView, refreshFocus }) {
    const view = el('div', 'scene games-scene');
    view.append(
      el('div', 'scene-backdrop', ''),
      el('div', 'scene-spotlight', ''),
      el('div', 'scene-floor', ''),
      el('div', 'scene-vignette', ''),
    );

    // ── Sayaç: çip şeridinin başında (üst şerit zaten ekran adını yazıyor,
    //    ikinci bir başlık satırı çakışıyordu) ──
    const count = el('span', 'games-count', '');

    // ── Orta: yatay oyun rafı ──
    const track = el('div', 'games-track');
    track.dataset.hTrack = 'games';
    track.setAttribute('role', 'list');
    const tiles = new Map();
    GAME_ORDER.forEach((mode, index) => {
      const tile = gameTile(mode, index);
      tile.setAttribute('role', 'listitem');
      tile.addEventListener('click', () => actions.onGameSelect?.(mode));
      tiles.set(mode, tile);
      track.append(tile);
    });

    // Track yatayda taşar: tasarlanmış sayfalama bölgesi, sayfa scroll'u değil.
    view.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      track.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });

    // ── Sol alt: odaktaki oyunun adı + ipucu (dev yazı) ──
    const info = el('div', 'games-focus');
    const infoTitle = el('h3', 'games-focus-title', '');
    const infoHint = el('p', 'games-focus-hint', '');
    info.append(infoTitle, infoHint);

    // ── Sağ alt: tek OYNA ──
    const playBtn = el('button', 'scene-btn is-gold games-play');
    playBtn.type = 'button';
    playBtn.dataset.focus = 'play';
    playBtn.tabIndex = -1;
    playBtn.innerHTML = `
      <span class="scene-btn-icon">${getTabletopIconSvg('play', { size: 22, strokeWidth: 2.2 })}</span>
      <span class="scene-btn-copy"><span class="scene-btn-label"></span></span>`;
    playBtn.querySelector('.scene-btn-label').textContent = t('shell.playNow');

    // ── Alt orta: kategori filtresi ──
    const chips = el('div', 'games-chips');
    chips.setAttribute('role', 'tablist');
    chips.append(count);
    const chipButtons = CATEGORIES.map((cat) => {
      const chip = el('button', 'games-chip');
      chip.type = 'button';
      chip.dataset.focus = 'chip';
      chip.dataset.filter = cat.id;
      chip.tabIndex = -1;
      chip.setAttribute('role', 'tab');
      const count = cat.id === 'all'
        ? GAME_ORDER.length
        : GAME_ORDER.filter((m) => CARTRIDGES[m]?.category === cat.id).length;
      chip.innerHTML = `<span>${getTabletopIconSvg(cat.icon, { size: 12 })}<em>${cat.label}</em></span><i>${count}</i>`;
      chip.setAttribute('aria-selected', String(cat.id === 'all'));
      chip.classList.toggle('is-active', cat.id === 'all');
      chip.addEventListener('click', () => applyCategory(cat.id));
      chips.append(chip);
      return chip;
    });

    function applyCategory(id) {
      chipButtons.forEach((chip) => {
        const on = chip.dataset.filter === id;
        chip.classList.toggle('is-active', on);
        chip.setAttribute('aria-selected', String(on));
      });
      let firstVisible = null;
      for (const [mode, tile] of tiles) {
        const visible = id === 'all' || CARTRIDGES[mode]?.category === id;
        tile.hidden = !visible;
        if (visible && !firstVisible) firstVisible = tile;
      }
      track.scrollLeft = 0;
      showFocus(firstVisible);
      // Odak listesi değişti: shell'e tazeleme sinyali.
      refreshFocus?.();
    }

    // ── Odakla sürülen seçim (ayrı önizleme paneli YOK) ──
    let activeMode = null;
    function showFocus(tile) {
      const mode = tile?.dataset?.game;
      if (!mode || mode === activeMode) return;
      activeMode = mode;
      const cart = CARTRIDGES[mode];
      infoTitle.textContent = cart?.title || mode;
      const cat = categoryById(cart?.category);
      // Kategori adı bilgi bloğunun başlığının yanına küçük bir rozet olarak
      // eklenir; ayrı bir etiket satırı görsel gürültü yaratıyordu.
      info.dataset.category = cat?.id || 'all';
      info.dataset.retired = cart?.retired ? 'true' : 'false';
      infoHint.textContent = t(cart?.tacticalHintKey || '');
      playBtn.onclick = () => actions.onGameSelect?.(mode);
      playBtn.setAttribute('aria-label', `${t('shell.playNow')} — ${cart?.title || mode}`);
      preloadEngine(mode);
    }

    // Odak değişimi shell'den gelen tek olaydır (bkz. appShell onFocusChange).
    view.addEventListener('shell:focuschange', (e) => showFocus(e.detail?.el));
    showFocus(track.firstElementChild);

    view.append(track, info, chips, playBtn);

    function applyTexts() {
      count.textContent = `${GAME_ORDER.length} OYUN`;
      playBtn.querySelector('.scene-btn-label').textContent = t('shell.playNow');
      chipButtons.forEach((chip, i) => {
        const cat = CATEGORIES[i];
        const count = cat.id === 'all'
          ? GAME_ORDER.length
          : GAME_ORDER.filter((m) => CARTRIDGES[m]?.category === cat.id).length;
        chip.innerHTML = `<span>${getTabletopIconSvg(cat.icon, { size: 12 })}<em>${cat.label}</em></span><i>${count}</i>`;
      });
      if (activeMode) {
        const cart = CARTRIDGES[activeMode];
        infoHint.textContent = t(cart?.tacticalHintKey || '');
      }
    }
    applyTexts();
    const offLang = onLangChange(applyTexts);
    view.addEventListener('shell:viewleave', () => offLang(), { once: true });

    return view;
  },
});
