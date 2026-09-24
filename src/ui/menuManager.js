// SaaS Main Menu Manager: Navbar controls, Quick Lang/Sound, Search & Bento Grid Filters
import { getLang, setLang, onLangChange, t } from '../i18n.js';
import { toggleAudio, getIsMuted, playMenuTick } from '../audio.js';
import { showInstallToast } from './toast.js';
import { isFullscreen, toggleFullscreen, onFullscreenChange } from './fullscreen.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';

export function initMainMenu({ onGameSelect, isOnline = false }) {
  // ── 1. Navbar: Quick Language Switcher ──
  const btnMenuLang = document.getElementById('btn-menu-lang');
  const navLangLabel = document.getElementById('nav-lang-label');

  function updateLangUI(currentLang) {
    if (navLangLabel) {
      navLangLabel.textContent = (currentLang || getLang()).toUpperCase();
    }
  }
  updateLangUI(getLang());

  btnMenuLang?.addEventListener('click', () => {
    const nextLang = getLang() === 'tr' ? 'en' : 'tr';
    setLang(nextLang);
    updateLangUI(nextLang);
    showInstallToast(nextLang === 'tr' ? '🇹🇷 Türkçe seçildi' : '🇬🇧 English selected');
  });

  // ── 2. Navbar: Quick Audio Toggle ──
  const btnMenuSound = document.getElementById('btn-menu-sound');
  const navSoundIcon = document.getElementById('nav-sound-icon');

  function updateSoundUI() {
    const muted = getIsMuted();
    if (navSoundIcon) {
      navSoundIcon.innerHTML = getTabletopIconSvg(muted ? 'volume-x' : 'volume-2', { size: 15 });
    }
    if (btnMenuSound) {
      btnMenuSound.setAttribute('aria-pressed', String(!muted));
    }
  }
  updateSoundUI();

  btnMenuSound?.addEventListener('click', () => {
    const isMuted = toggleAudio();
    updateSoundUI();
    showInstallToast(isMuted ? t('toast.soundOff') : t('toast.soundOn'));
  });

  // ── 2b. Navbar: Fullscreen Mode Toggle ──
  const btnMenuFullscreen = document.getElementById('btn-menu-fullscreen');
  const navFullscreenIcon = document.getElementById('nav-fullscreen-icon');
  const navFullscreenLabel = document.getElementById('nav-fullscreen-label');

  function updateFullscreenUI(active) {
    const isFs = typeof active === 'boolean' ? active : isFullscreen();
    if (navFullscreenIcon) {
      navFullscreenIcon.innerHTML = getTabletopIconSvg(isFs ? 'minimize-2' : 'maximize-2', { size: 15 });
    }
    if (navFullscreenLabel) {
      navFullscreenLabel.textContent = isFs ? t('menu.exitFullscreen') : t('menu.fullscreen');
    }
    if (btnMenuFullscreen) {
      btnMenuFullscreen.classList.toggle('active', isFs);
      btnMenuFullscreen.setAttribute('aria-pressed', String(isFs));
      btnMenuFullscreen.setAttribute('title', isFs ? t('menu.exitFullscreen') : t('menu.fullscreen'));
    }
  }
  updateFullscreenUI();
  onFullscreenChange(updateFullscreenUI);
  onLangChange(() => updateFullscreenUI());

  btnMenuFullscreen?.addEventListener('click', () => {
    toggleFullscreen();
  });

  // ── 3. Navbar: Online / Offline Platform Status Pill ──
  const navbarPlatformPill = document.getElementById('navbar-platform-pill');
  function updateNetworkPill(isOnline) {
    if (!navbarPlatformPill) return;
    if (isOnline) {
      navbarPlatformPill.textContent = `● ${t('menu.onlinePill') || 'ONLINE'}`;
      navbarPlatformPill.classList.remove('offline');
      navbarPlatformPill.classList.add('online');
    } else {
      navbarPlatformPill.textContent = `○ ${t('menu.localPill') || 'YEREL'}`;
      navbarPlatformPill.classList.remove('online');
      navbarPlatformPill.classList.add('offline');
    }
  }
  updateNetworkPill(navigator.onLine);
  window.addEventListener('online', () => updateNetworkPill(true));
  window.addEventListener('offline', () => updateNetworkPill(false));

  function applyConnectionModeCopy() {
    const subtitle = document.querySelector('.menu-subtitle');
    const card = document.querySelector('.tv-mode-card');
    const title = card?.querySelector('.bento-tile-title');
    const desc = card?.querySelector('.bento-tile-sub');
    const pill = card?.querySelector('.hero-mode-pill');
    const hostButton = document.getElementById('btn-hero-create-room');

    card?.classList.toggle('online-phone-host', !!isOnline);
    if (isOnline) {
      if (subtitle) subtitle.textContent = t('menu.onlineSubtitle');
      if (title) title.textContent = t('menu.onlineCardTitle');
      if (desc) desc.textContent = t('menu.onlineCardDesc');
      if (pill) pill.textContent = 'P1 HOST';
      if (hostButton) hostButton.textContent = t('menu.onlineHostBtn');
    } else {
      if (subtitle) subtitle.textContent = t('menu.subtitle');
      if (title) title.textContent = t('menu.tvCardTitle');
      if (desc) desc.textContent = t('menu.tvCardDesc');
      if (pill) pill.textContent = 'TV HOST';
      if (hostButton) hostButton.textContent = t('menu.tvHostBtn');
    }
  }
  applyConnectionModeCopy();
  onLangChange(applyConnectionModeCopy);

  // ── 4. Search & Filter Toolbar ──
  const searchInput = document.getElementById('menu-game-search');
  const btnClearSearchInput = document.getElementById('btn-clear-search-input');
  const btnClearSearch = document.getElementById('btn-clear-search');
  const categoryTabs = document.getElementById('menu-category-tabs');
  const countPill = document.getElementById('menu-games-count');
  const noResultsCard = document.getElementById('menu-no-results');
  const gameGrid = document.getElementById('menu-games-grid');
  const allCards = gameGrid ? Array.from(gameGrid.querySelectorAll('.game-card-btn')) : [];

  let activeCategory = 'all';
  let searchQuery = '';

  function normalize(str) {
    return (str || '')
      .toLowerCase()
      .replace(/ğ/g, 'g')
      .replace(/ü/g, 'u')
      .replace(/ş/g, 's')
      .replace(/ı/g, 'i')
      .replace(/ö/g, 'o')
      .replace(/ç/g, 'c')
      .trim();
  }

  function applyFilters() {
    const q = normalize(searchQuery);
    let visibleCount = 0;

    allCards.forEach((card) => {
      const cardCategory = card.dataset.category || '';
      const categoryMatch = activeCategory === 'all' || cardCategory === activeCategory;

      let searchMatch = true;
      if (q) {
        const title = normalize(card.querySelector('.card-title')?.textContent);
        const desc = normalize(card.querySelector('.card-desc')?.textContent);
        const hl = normalize(card.querySelector('.card-highlight')?.textContent);
        const id = normalize(card.id);
        const keywords = normalize(card.dataset.keywords);
        searchMatch = title.includes(q) || desc.includes(q) || hl.includes(q) || id.includes(q) || keywords.includes(q);
      }

      const isVisible = categoryMatch && searchMatch;
      card.classList.toggle('filtered-out', !isVisible);
      if (isVisible) visibleCount++;
    });

    // Update count pill
    if (countPill) {
      countPill.textContent = t('menu.gamesFound', visibleCount) || `${visibleCount} OYUN`;
    }

    // Toggle empty state card
    if (noResultsCard) {
      noResultsCard.classList.toggle('hidden', visibleCount > 0);
    }

    // Toggle clear search button
    if (btnClearSearchInput) {
      btnClearSearchInput.classList.toggle('hidden', searchQuery.length === 0);
    }
  }

  // Search input listeners
  searchInput?.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    applyFilters();
  });

  btnClearSearchInput?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      searchQuery = '';
      applyFilters();
      searchInput.focus();
    }
  });

  btnClearSearch?.addEventListener('click', () => {
    if (searchInput) {
      searchInput.value = '';
      searchQuery = '';
    }
    activeCategory = 'all';
    if (categoryTabs) {
      categoryTabs.querySelectorAll('.category-filter-chip').forEach((c) => {
        const isActive = c.dataset.filter === 'all';
        c.classList.toggle('active', isActive);
        c.setAttribute('aria-selected', String(isActive));
      });
    }
    applyFilters();
    searchInput?.focus();
  });

  // Category filter tabs listener
  categoryTabs?.addEventListener('click', (e) => {
    const chip = e.target.closest('.category-filter-chip');
    if (!chip) return;
    playMenuTick();
    activeCategory = chip.dataset.filter || 'all';
    categoryTabs.querySelectorAll('.category-filter-chip').forEach((c) => {
      const isActive = c === chip;
      c.classList.toggle('active', isActive);
      c.setAttribute('aria-selected', String(isActive));
    });
    applyFilters();
  });

  // Tactile hover audio on bento game cards
  gameGrid?.addEventListener('mouseenter', (e) => {
    const target = e.target;
    if (target && target.closest && target.closest('.game-card-btn')) {
      playMenuTick();
    }
  }, { capture: true, passive: true });

  // Re-run filter on language change (updates localized text and counts)
  onLangChange((newLang) => {
    updateLangUI(newLang);
    updateSoundUI();
    updateNetworkPill(navigator.onLine);
    applyFilters();
  });

  // Initial pass
  applyFilters();
}
