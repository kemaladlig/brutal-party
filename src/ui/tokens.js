import { getPreference, setPreference } from '../core/preferences.js';

// Tasarım Token'ları — TV canvas + DOM + kumanda için tek renk/tipografi/ölçü sözlüğü.
// Yeni HUD öğesi yazan önce buraya bakar; hardcoded renk/font/ölçü yasaktır.
// Değerler mevcut oyundan alındı (görsel değişiklik yok, sadece merkezileşme).

export const UI_COLORS = {
  ink: '#1A1A1A',
  paper: '#F4F4F0',
  paperWarm: '#F4F0EA',
  card: '#FAF7F2',
  white: '#FFFFFF',
  muted: '#75726B',
  faint: '#99948A',
  dim: '#8A857B',
  line: '#1C1C1A',
  gold: '#D99B26',
  danger: '#D84727',
  // Oyuncu renkleri (P1 kırmızı, P2 mavi, P3 sarı, P4 yeşil) — TV + kumanda aynı.
  players: ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'],
  // Bot rozetleri
  botFace: '#1F1F1D',
  botEdge: '#E5E0D6',
  botTag: '#FFDE59',
  botGod: '#FFD700',
  // Durum zeminleri
  disabled: '#E5E0D6',
  // Yüksek kontrastlı dış hat ve semantik HUD token'ları
  outlineContrast: 'rgba(250, 247, 242, 0.92)',
  ammoEmpty: '#26262B',
  ammoFrame: '#141416',
  ammoReloading: '#FACC15',
  shield: '#0EA5E9',
  shieldBg: 'rgba(14, 165, 233, 0.18)',
  turbo: '#FFDE59',
  daze: '#9C988F',
  cooldownTrack: 'rgba(26, 26, 26, 0.28)',
  cooldownTrackLight: 'rgba(250, 247, 242, 0.40)',
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
  let entityScale = 1.0;
  let safePadding = 16;

  if (minDim < 540) {
    // Akıllı telefon / kompakt ekran
    type = 'MOBILE';
    baseUnit = Math.max(0.72, Math.min(1.0, minDim / 480));
    entityScale = 0.85; // Küçük ekranda oyuncuların alanı boğmasını önler
    safePadding = Math.round(10 * baseUnit);
  } else if (minDim <= 900 && isTouch) {
    // Tablet / iPad masa-ortası
    type = 'TABLETOP';
    baseUnit = Math.max(1.0, Math.min(1.4, minDim / 600));
    entityScale = 1.0;
    safePadding = Math.round(16 * baseUnit);
  } else {
    // Masaüstü Monitör veya TV
    type = 'DESKTOP_TV';
    baseUnit = Math.max(1.0, Math.min(2.2, minDim / 520));
    entityScale = Math.min(1.25, 1.0 + (baseUnit - 1.0) * 0.25);
    safePadding = Math.round(20 * baseUnit);
  }

  return {
    type,        // 'MOBILE' | 'TABLETOP' | 'DESKTOP_TV'
    isTouch,
    baseUnit,    // UI tipografi & badge ölçek katsayısı
    entityScale, // Saha içi varlıklar için ölçek katsayısı
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
