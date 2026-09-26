import { getPreference, setPreference } from '../core/preferences.js';

// Tasarım Token'ları — TV canvas + DOM + kumanda için tek renk/tipografi/ölçü sözlüğü.
// Yeni HUD öğesi yazan önce buraya bakar; hardcoded renk/font/ölçü yasaktır.
// Değerler mevcut oyundan alındı (görsel değişiklik yok, sadece merkezileşme).

export const UI_COLORS = {
  ink: '#2B2018',
  paper: '#FFF6E8',
  paperWarm: '#FFE7C4',
  card: '#FFFDF7',
  white: '#FFFFFF',
  muted: '#6E6357',
  faint: '#8C8175',
  dim: '#A79C90',
  line: '#2B2018',
  gold: '#FFB020',
  danger: '#D93A22',
  accent: '#FF8C1A',
  success: '#35B36A',
  // Oyuncu renkleri (P1 kırmızı, P2 mavi, P3 sarı, P4 yeşin) — TV + kumanda aynı.
  players: ['#F0483C', '#2B7FC4', '#FFD24A', '#35B36A'],
  // Bot rozetleri
  botFace: '#2B2018',
  botEdge: '#F2E7D4',
  botTag: '#FFDE59',
  botGod: '#FFD700',
  // Durum zeminleri
  disabled: '#E5DCC9',
  // Yüksek kontrastlı dış hat ve semantik HUD token'ları
  outlineContrast: 'rgba(255, 253, 247, 0.92)',
  // Katman örtüleri — CSS tarafındaki --scrim ailesiyle eşleşir.
  scrim: 'rgba(24, 18, 13, 0.62)',
  scrimStrong: 'rgba(24, 18, 13, 0.84)',
  ammoEmpty: '#2B2A26',
  ammoFrame: '#1A1815',
  ammoReloading: '#FFB020',
  shield: '#0EA5E9',
  shieldBg: 'rgba(14, 165, 233, 0.18)',
  turbo: '#FFDE59',
  daze: '#A79C90',
  cooldownTrack: 'rgba(43, 32, 24, 0.28)',
  cooldownTrackLight: 'rgba(255, 253, 247, 0.40)',
};

export const UI_FONTS = {
  grotesk: '"Space Grotesk", sans-serif',
  mono: '"JetBrains Mono", monospace',
};

// Tipografi kademeleri: rol → [ağırlık, px, aile]
export const UI_TEXT = {
  label: [800, 11, 'grotesk'], // kart altı yazı, rozet altı
  nameTag: [900, 11, 'grotesk'], // oyuncu isim rozeti
  tag: [900, 12, 'grotesk'], // bot rozeti
  monoLabel: [900, 13, 'mono'], // kılavuz başlığı
  monoBody: [800, 12, 'mono'], // alt bilgi / skor satırı
  section: [900, 14, 'grotesk'], // bölüm başlığı
  seatNum: [900, 28, 'grotesk'], // koltuk numarası (dolu)
  seatEmpty: [900, 24, 'grotesk'], // koltuk numarası (boş)
  pill: [900, 15, 'mono'], // üst hap (süre/skor)
  body: [800, 13, 'grotesk'], // bekleme yazısı
  hudScore: [900, 22, 'mono'], // broadcast skor sayısı
  hudBadge: [900, 10, 'grotesk'], // mikro rozet (P1, LEADER vb.)
  hudName: [800, 11, 'grotesk'], // HUD oyuncu adı
  floating: [900, 15, 'mono'], // havaya süzülen bildirim (+1★, HASAR)
  button: [900, 20, 'grotesk'], // BAŞLAT / YENİDEN OYNA (büyük)
  buttonSmall: [800, 15, 'grotesk'], // final butonu
  title: [900, 24, 'grotesk'], // final kazananı
  display: [900, 32, 'grotesk'], // lobi başlığı
  hero: [900, 52, 'grotesk'], // sinyal / devasa durum
};

// `900 15px "JetBrains Mono", monospace` üretir.
// scale parametresi ile büyük ekranlarda (TV / monitör) orantılı büyütülür.
export function uiFont(role, scale = 1.0) {
  const [weight, px, family] = UI_TEXT[role] || UI_TEXT.body;
  const scaledPx = Math.round(px * scale);
  return `${weight} ${scaledPx}px ${UI_FONTS[family]}`;
}

// ---------------------------------------------------------------------------
// Ekran Profili ve Dinamik Ölçekleme (Mobile, Tabletop/Tablet, Desktop/TV)
// ---------------------------------------------------------------------------

export function getDisplayProfile(dimA, dimB = null, forceTouch = null) {
  let w, h;
  if (dimA && typeof dimA === 'object') {
    w = dimA.width || dimA.w || (typeof window !== 'undefined' ? window.innerWidth : 800);
    h = dimA.height || dimA.h || (typeof window !== 'undefined' ? window.innerHeight : 600);
  } else {
    w = typeof dimA === 'number' ? dimA : (typeof window !== 'undefined' ? window.innerWidth : 800);
    h = typeof dimB === 'number' ? dimB : (typeof window !== 'undefined' ? window.innerHeight : 600);
  }

  const minDim = Math.min(w, h);
  const maxDim = Math.max(w, h);
  const isTouch = forceTouch !== null
    ? !!forceTouch
    : isTouchDevice();

  let type = 'DESKTOP_TV';
  let baseUnit = 1.0;
  let safePadding = 16;

  // Saha içi varlık ölçeği BURADA yaşamaz: tek otorite `playfield.unit`
  // (src/core/playfield.js). Eskiden buradaki `entityScale` vardı ama hiçbir
  // motor okumuyordu; küçük ekranda oyuncu/harita ölçezi bu yüzden elle
  // `Math.max(mutlak px, ...)` tabanlarına dağılmış haldeydi.
  if (minDim < 540) {
    // Akıllı telefon / kompakt ekran
    type = 'MOBILE';
    baseUnit = Math.max(0.72, Math.min(1.0, minDim / 480));
    safePadding = Math.round(10 * baseUnit);
  } else if (minDim <= 900 && isTouch) {
    // Tablet / iPad masa-ortası
    type = 'TABLETOP';
    baseUnit = Math.max(1.0, Math.min(1.4, minDim / 600));
    safePadding = Math.round(16 * baseUnit);
  } else {
    // Masaüstü Monitör veya TV
    type = 'DESKTOP_TV';
    baseUnit = Math.max(1.0, Math.min(2.2, minDim / 520));
    safePadding = Math.round(20 * baseUnit);
  }

  return {
    type,        // 'MOBILE' | 'TABLETOP' | 'DESKTOP_TV'
    isTouch,
    baseUnit,    // UI tipografi & badge ölçek katsayısı
    safePadding, // HUD güvenli kenar boşluğu
    minDim,
    maxDim,
  };
}

// Geriye dönük uyumluluk: mevcut motorlar getUiScale(arena) çağırır.
export function getUiScale(arena) {
  return getDisplayProfile(arena).baseUnit;
}

export function isLargeDisplay(arena) {
  return getUiScale(arena) >= 1.35;
}

// ---------------------------------------------------------------------------
// Sanal Kontrol Tercih Yöneticisi (Control Surface State)
// ---------------------------------------------------------------------------

export const CONTROL_SURFACE = Object.freeze({
  AUTO: 'auto',
  MOBILE: 'mobile',
  TABLETOP: 'tabletop',
});

export const STORAGE_KEY_CONTROL_SURFACE = 'bp_control_surface';
export const STORAGE_KEY_VIRTUAL_CONTROLS = 'bp_virtual_controls'; // legacy: 'auto' | 'on' | 'off'

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window
    || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0);
}

// ---------------------------------------------------------------------------
// Güvenli alan (notch / home indicator)
// ---------------------------------------------------------------------------
// Canvas JS `env(safe-area-inset-*)` değerlerini doğrudan okuyamaz; sabit
// konumlu, görünmez bir probe üzerinden CSS custom property olarak okunur.
// Değerler döndürmeyle değiştiği için cache viewport boyutuna bağlanır.

const ZERO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

let safeAreaProbe = null;
let safeAreaCache = null;
let safeAreaCacheKey = '';

function readProbeInsets() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  // SSR, test harness'ları ve bazı webview'larda getComputedStyle yok.
  if (typeof window.getComputedStyle !== 'function') return null;
  if (!safeAreaProbe) {
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:0', 'height:0',
      'visibility:hidden', 'pointer-events:none', 'z-index:-1',
      '--bp-safe-top:env(safe-area-inset-top,0px)',
      '--bp-safe-right:env(safe-area-inset-right,0px)',
      '--bp-safe-bottom:env(safe-area-inset-bottom,0px)',
      '--bp-safe-left:env(safe-area-inset-left,0px)',
    ].join(';');
    (document.body || document.documentElement).appendChild(probe);
    safeAreaProbe = probe;
  }
  const style = window.getComputedStyle(safeAreaProbe);
  const px = (name) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) && value > 0 ? value : 0;
  };
  return {
    top: px('--bp-safe-top'),
    right: px('--bp-safe-right'),
    bottom: px('--bp-safe-bottom'),
    left: px('--bp-safe-left'),
  };
}

/**
 * Cihazın güvenli alanı (px). Çentikli cihazlarda yatayda notch 47-59px,
 * dikeyde home indicator ~21px yer kaplar. Masaüstü/SSR'de hepsi 0.
 */
export function getSafeAreaInsets() {
  if (typeof document === 'undefined' || typeof window === 'undefined'
    || typeof window.getComputedStyle !== 'function') {
    return ZERO_INSETS;
  }
  // Döndürmede güvenli alan değişir; boyut değiştiyse yeniden oku.
  const key = `${window.innerWidth}x${window.innerHeight}`;
  if (safeAreaCache && safeAreaCacheKey === key) return safeAreaCache;
  const insets = readProbeInsets();
  safeAreaCacheKey = key;
  safeAreaCache = insets || ZERO_INSETS;
  return safeAreaCache;
}

export function getControlSurfacePreference() {
  return getPreference('controlSurface');
}

export function resolveControlSurface(
  preference = getControlSurfacePreference(),
  { touchDevice = null, width = null, height = null } = {},
) {
  if (preference === CONTROL_SURFACE.MOBILE || preference === CONTROL_SURFACE.TABLETOP) {
    return preference;
  }
  if (preference !== CONTROL_SURFACE.AUTO) return CONTROL_SURFACE.TABLETOP;

  const touch = touchDevice === null ? isTouchDevice() : !!touchDevice;
  if (!touch) return CONTROL_SURFACE.TABLETOP;
  const profile = getDisplayProfile(
    width ?? (typeof window !== 'undefined' ? window.innerWidth : 800),
    height ?? (typeof window !== 'undefined' ? window.innerHeight : 600),
    true,
  );
  return profile.type === 'MOBILE' ? CONTROL_SURFACE.MOBILE : CONTROL_SURFACE.TABLETOP;
}

export function getControlSurface() {
  return resolveControlSurface();
}

export function setControlSurface(value) {
  if (value !== CONTROL_SURFACE.AUTO
    && value !== CONTROL_SURFACE.MOBILE
    && value !== CONTROL_SURFACE.TABLETOP) return;
  setPreference('controlSurface', value);
}

// Eski çağıranlar için uyum katmanı; yeni tek kaynak control surface'tır.
export function getVirtualControlsSetting() {
  const preference = getControlSurfacePreference();
  if (preference === CONTROL_SURFACE.AUTO) return 'auto';
  return getControlSurface() === CONTROL_SURFACE.MOBILE ? 'on' : 'off';
}

export function setVirtualControlsSetting(value) {
  if (value === 'auto' || value === 'on') setControlSurface(CONTROL_SURFACE.AUTO);
  else if (value === 'off') setControlSurface(CONTROL_SURFACE.TABLETOP);
}

export function shouldShowVirtualControls({
  isHosting = false,
  isTouchDevice: touchDevice = null,
  force = false,
  surface = null,
} = {}) {
  // ONLINE/TV host authority-local touch veya LOCAL masa-ortası modu.
  if (force) return true;
  if (isHosting) return false;

  // Mobil yüzey LOCAL'da DOM kumandasıyla karşılanır; canvas masa-ortası
  // katmanı yalnız tabletop tercihinde görünür.
  const selectedSurface = resolveControlSurface(surface || getControlSurfacePreference());
  if (selectedSurface === CONTROL_SURFACE.MOBILE) return false;
  // Explicit tabletop (and desktop AUTO) is a real playable surface, not a
  // touch-only hint. This keeps the four canvas corner controls available on PC.
  if (selectedSurface === CONTROL_SURFACE.TABLETOP) return true;

  const touch = touchDevice === null ? isTouchDevice() : touchDevice;
  return !!touch;
}

// Standart ölçüler (CSS pikseli)
export const UI_SIZES = {
  seatMin: 96,
  seatMax: 148,
  seatRatio: 0.22,
  seatInset: 20,
  startW: 220,
  startH: 60,
  finalBtnW: 190,
  finalBtnH: 46,
  pillH: 34,
  bannerW: 260,
  bannerH: 64,
  // Telefon kumanda bölgeleri (landscape-first düzen sözleşmesi):
  // üst tek şerit / orta boş / alt kontrol kuşağı. Değerler CSS ile aynıdır.
  phoneHeaderH: 46,
  phoneHeaderHCompact: 38,
  phoneStripH: 30,
  phoneControlBeltMin: 96,
  phoneControlBeltMax: 170,
  rotateGateZ: 300,
};
