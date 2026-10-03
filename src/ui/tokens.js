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
  // --- Saha kapsamı HUD ailesi (karakter üstü göstergeler) ---
  // Saha zemini L* 92.5-97.5 arası krem (`fieldKit.FIELD_THEMES`); altın ve
  // turkuaz bu zeminde 1.2-1.3:1 ile ÖLÜ. Koyu plaka üstünde aynı renkler
  // 9.9-10.6:1. Bu yüzden "hazır" göstergeleri çember değil koyu plaka + ikon
  // taşır (`core/entityStatus.js`).
  hudPlate: '#1A1815',        // koyu plaka zemini
  hudPlateInk: '#FFF8EA',     // plaka üstü yazı/ikon
  hudReady: '#35B36A',        // hazır vurgusu (kenarlık + ikon)
  hudDim: 'rgba(26, 26, 26, 0.55)', // dolum rayı (0.28 -> 0.55: 1.78 -> 3.4:1)
  // Boş pip/yuva: hem koyu cephane çerçevesinin İÇİNDE (4.28:1) hem de
  // krem saha üstünde (3.45:1) 3:1'i geçer — `#6B625A` çerçevede 2.97'de
  // kalıyordu, `#8C8175` ise zeminde 3.18'e düşüyordu.
  hudEmpty: '#857B71',
  hudMuted: '#4A443E',        // pasif durum
  // Saha üstü metin konturu: beyaz krem zeminde İŞE YARAMAZ (1.10:1).
  // `outlineContrast` beyaz olduğu için burada ayrı bir koyu ton var.
  hudInkOutline: 'rgba(26, 26, 26, 0.92)',
  // Durum haleleri: krem zeminde okunacak koyu tonlar. #0EA5E9 2.30:1 ve
  // #38BDF8 1.91:1 iken okunmuyordu; uydu noktası halkanın ÜSTÜNDE
  // oturduğu için halkaya karşı ayrı bir açık ton taşır.
  hudShield: '#0E7490',
  hudShieldDot: '#CDEEF7',
  hudShieldFill: 'rgba(14, 116, 144, 0.22)',
  // Şarj/yay gerilme tonu: mor 3.77:1, zeminden ayrışıyor.
  hudCharge: '#6D28D9',
  // Durum haleleri: krem zeminde okunacak koyu tonlar (`#D99B26` 2.16:1,
  // `#70E000` 1.52:1 iken görünmüyordu).
  hudAmber: '#8A5A00',
  hudGhost: '#4F8A00',
  // Koyu çubuk/ray zemini üstünde kalan "dolu" tonları.
  hudAmmo: '#FFB020',
  // Katman örtüleri — CSS tarafındaki --scrim ailesiyle eşleşir.
  scrim: 'rgba(24, 18, 13, 0.62)',
  scrimStrong: 'rgba(24, 18, 13, 0.84)',
  ammoEmpty: '#2B2A26',
  ammoFrame: '#1A1815',
  ammoReloading: '#FFB020',
  shield: '#0EA5E9',
  shieldBg: 'rgba(14, 165, 233, 0.18)',
  colossusRifle: '#38BDF8',
  colossusShotgun: '#F97316',
  colossusSniper: '#A855F7',
  colossusPlasma: '#10B981',
  colossusIgnis: '#EF4444',
  turbo: '#FFDE59',
  daze: '#A79C90',
  cooldownTrack: 'rgba(43, 32, 24, 0.28)',
  cooldownTrackLight: 'rgba(255, 253, 247, 0.40)',
  // --- Sonuç/final yüzeyi: `tokens.css --result-*` ailesinin canvas karşılığı.
  // Kartın dili sahadan (krem) değil, uygulamanın sonuç ekranından gelir:
  // telefon kumandasındaki tam ekran sonuçla aynı panel, aynı mürekkep.
  resultInk: '#FFF8EA',
  resultMuted: '#CFC0AD',
  resultGold: '#FFD27A',
  resultPanelTop: '#2B2018',
  resultPanelBottom: '#160F0A',
  resultRow: 'rgba(255, 255, 255, 0.07)',
  resultEdge: 'rgba(255, 248, 234, 0.18)',
  // `--shadow-float`/`--dim-*` ailesinin RGB kanalları: katmanlı gölde alfa
  // katman başına değiştiği için renk değil kanal üçlüsü taşınır.
  resultShadowRgb: '4, 2, 12',
  // Doygun altın/yeşil dolgu üstündeki mürekkep (`--on-accent`).
  onAccent: '#2A1400',
  // --- Crown / Arena / Brutalist Sahne & Prop Token'ları ---
  crownRed: '#D84727',
  crownBlue: '#1D5D8A',
  crownGold: '#D99B26',
  crownGreen: '#2F6A4F',
  crownPaper: '#F4F0EA',
  crownPaperLight: '#FAF7F2',
  crownStone: '#2B2B28',
  crownStoneDark: '#1A1A1A',
  crownStoneDarker: '#333330',
  crownHazard: '#262624',
  crownAmber: '#F59E0B',
  crownSpark: '#FFDE59',
  crownTeleport: '#48CAE4',
  crownFlash: '#FFD9C0',
  crownPillarBorder: '#E0DAD0',
  crownPillarEdge: '#8A857C',
  crownConveyorLine: '#6E6E66',
  crownConveyorArrow: '#4A4A45',
  crownConveyorEdge: '#E5DFD5',
  crownForest: '#2D6A4F',
  crownPressed: '#E0DFDC',
  crownUnreadyFill: '#2A2A2E',
  crownUnreadyBorder: '#555555',
  crownDarkIcon: '#141416',
  blastFlash: '#FFD9C0',
  blastSpark: '#FFD122',
  heistPiggy: '#E143C8',
  inkDark: '#1A1A1A',
  lineDark: '#1C1C1A',
  pureBlack: '#000000',
  // --- Yüz rigi (tek kaynak): göz/ağız/kaş/allık tonları ---
  // characterRenderer.js yeni katmanları buradan besler; ham literal yazmaz
  // (K2 kotası renderer'da donduruk, sözlük istisnası tokens.js'tir).
  faceInk: '#1A1A1A',
  faceWhite: '#FFFFFF',
  faceTear: '#9BD7FF',
  mouthDark: '#4A1D18',
  tongue: '#FF6B8A',
  blush: 'rgba(255, 90, 130, 0.30)',
  lidShade: 'rgba(0, 0, 0, 0.15)',
  heartPink: '#FF3B6B',
  zombiePale: '#DDF5DD',
  zombieIris: '#2F6A4F',
  visorCyan: '#00F0FF',
  visorPink: '#FF0055',
  rimLight: 'rgba(255, 255, 255, 0.22)',
  // --- Baş süsleri (HEADWEAR) ---
  hatInk: '#1A1A1A',
  hatGold: '#FFC42E',
  hatGoldDark: '#D99B26',
  hatVelvet: '#8B0000',
  hatGem: '#FF3B6B',
  hatEmerald: '#00B894',
  hatSapphire: '#0984E3',
  hatOrange: '#FF5722',
  hatYellow: '#FFD700',
  hatPurple: '#7928CA',
  hatPurpleDark: '#5B1FA8',
  hatHaloGlow: 'rgba(255, 255, 255, 0.65)',
  hatHaloAura: 'rgba(255, 215, 0, 0.30)',
  hatRed: '#D84727',
  hatPinkKnot: '#FF6B9D',
  hatPinkLight: '#FF85A2',
  hatPinkDark: '#D81B60',
  hatCyan: '#00F0FF',
  hatShine: '#FFFFFF',
  hatObsidian: '#2B1B17',
  hatMetal: '#9AA7B4',
  hatBone: '#F0E6D2',
};

export const CROWN_COLORS = Object.freeze([
  UI_COLORS.crownRed,
  UI_COLORS.crownBlue,
  UI_COLORS.crownGold,
  UI_COLORS.crownGreen,
]);

export const UI_FONTS = {
  grotesk: '"Space Grotesk", sans-serif',
  mono: '"JetBrains Mono", monospace',
  // "Arcade Oyuncak Kutusu" display yüzü — `src/styles/tokens.css --font-display`
  // ile AYNI aile. Başlık/wordmark/kazanan adı buradan çizilir; iki taraf
  // birlikte değişir yoksa canvas HUD'u menüden kopar.
  display: '"Fredoka", "Space Grotesk", sans-serif',
};

// Tipografi kademeleri: rol → [ağırlık, px, aile]
export const UI_TEXT = {
  label: [800, 11, 'grotesk'], // kart altı yazı, rozet altı
  nameTag: [600, 11, 'display'], // oyuncu isim rozeti
  tag: [700, 12, 'display'], // bot rozeti
  monoLabel: [900, 13, 'mono'], // kılavuz başlığı
  monoBody: [800, 12, 'mono'], // alt bilgi / skor satırı
  section: [600, 14, 'display'], // bölüm başlığı
  seatNum: [700, 28, 'display'], // koltuk numarası (dolu)
  seatEmpty: [700, 24, 'display'], // koltuk numarası (boş)
  pill: [900, 15, 'mono'], // üst hap (süre/skor)
  body: [800, 13, 'grotesk'], // bekleme yazısı
  hudScore: [900, 22, 'mono'], // broadcast skor sayısı
  hudBadge: [600, 10, 'display'], // mikro rozet (P1, LEADER vb.)
  hudName: [500, 11, 'display'], // HUD oyuncu adı
  floating: [900, 15, 'mono'], // havaya süzülen bildirim (+1★, HASAR)
  button: [700, 20, 'display'], // BAŞLAT / YENİDEN OYNA (büyük)
  buttonSmall: [600, 15, 'display'], // final butonu
  title: [700, 24, 'display'], // final kazananı
  // Sonuç kartı kademesi (koyu panel): üst etiket / kazanan / sıralama satırı.
  finalLabel: [900, 12, 'mono'],
  finalHero: [700, 27, 'display'],
  finalRow: [500, 14, 'display'],
  finalRowValue: [900, 14, 'mono'],
  display: [700, 32, 'display'], // lobi başlığı
  hero: [700, 52, 'display'], // sinyal / devasa durum
  // Arcade Oyuncak Kutusu display kademeleri (canvas HUD tarafı).
  // CSS `--font-display` tüketicileriyle aynı karakteri taşır.
  displayTag: [700, 12, 'display'], // rozet/etiket
  displayM: [600, 22, 'display'], // kart / bölüm başlığı
  displayL: [700, 34, 'display'], // ekran başlığı
  displayXL: [700, 52, 'display'], // kazanan / devasa durum
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

export const CONTROL_MODE = Object.freeze({
  NONE: 'none',
  DOM: 'dom',
  CANVAS: 'canvas',
});

/**
 * Otorite cihazın yerel kontrol yüzeyi — TEK karar noktası.
 *
 * Yüzey iki yerden geliyordu (DOM kumandası `main.js`, canvas masa-ortası
 * `BaseGame`/`tabletopRenderer`) ve ikisi de aynı anda farklı şey söylüyordu:
 * DOM tarafı "birden çok insan koltuğu var" diye masa-ortasına zorluyordu,
 * canvas tarafı ham tercihi okuyordu. Tercih `mobile` iken ikisi de kapanıyor
 * ve host (LOCAL'de ya da ONLINE'da P1) hiçbir kontrolü kalmıyordu.
 *
 * Koltuk sayısı bilgisi değildir: ONLINE'da uzak oyuncular da `human`
 * sayılır. Açık kullanıcı seçimi her zaman kazanır; `auto` sadece cihaz
 * profiline bakar.
 *
 * @returns {{mode: 'none'|'dom'|'canvas', localControlSlot: number|null}}
 *   `localControlSlot` yalnız bu cihazın oynadığı koltuktur; canvas köşe
 *   kontrolleri başka koltuklara dokunulabilir çizilmemeli (authority kuralı).
 */
export function resolveLocalControlMode({
  isHosting = false,
  isLocalHostPlayer = false,
  isLocalMode = false,
  preference = getControlSurfacePreference(),
  localSlot = null,
} = {}) {
  // Cihaz oyuncu değilse (kumanda ekranı, TV host spectator) yerel yüzey yok.
  if (!isLocalMode && !(isHosting && isLocalHostPlayer)) {
    return { mode: CONTROL_MODE.NONE, localControlSlot: null };
  }
  const surface = resolveControlSurface(preference);
  return {
    mode: surface === CONTROL_SURFACE.MOBILE ? CONTROL_MODE.DOM : CONTROL_MODE.CANVAS,
    localControlSlot: Number.isInteger(localSlot) ? localSlot : null,
  };
}

/** Canvas köşe kontrollerinin çizilip dokunulabilir olup olmadığı. */
export function shouldShowVirtualControls({ mode = /** @type {string} */ (CONTROL_MODE.NONE) } = {}) {
  return mode === CONTROL_MODE.CANVAS;
}

// Standart ölçüler (CSS pikseli)
export const UI_SIZES = {
  seatMin: 96,
  seatMax: 148,
  seatRatio: 0.22,
  seatInset: 20,
  startW: 220,
  startH: 60,
  // --- Final kartı (match over) düzeni. `layoutMatchOverCard` tek tüketicidir;
  // `tests/matchOverLayout.test.mjs` bu sözleşmeyi telefon yatayından TV'ye
  // beş viewport üzerinde kilitler (kart sahada kalır, satır ↔ buton boşluğu,
  // 44 px dokunma tabanı).
  finalPad: 16,
  finalRowH: 30,
  finalRowGap: 6,
  finalSectionGap: 12,
  finalLabelH: 14,
  finalNameH: 28,
  finalLabelNameGap: 6,
  finalHeroR: 26,
  finalHeroRSplit: 30,
  finalBtnHMin: 44, // dokunma tabanı: altında isabetli basış sayılmaz
  finalBtnTall: 48,
  finalBtnMinW: 96,
  finalBtnGap: 10,
  finalCardW: 440,
  finalCardWSplit: 640,
  finalMaxWidthFraction: 0.92, // saha genişliğinin üst sınırı
  finalMaxHeightFraction: 0.94, // saha yüksekliğinin üst sınırı
  finalLeadShare: 0.42, // iki sütunlu düzende kazanan sütununun payı
  finalLeadMaxW: 260,
  finalTextMinRatio: 0.62, // ada/kopya sığmıyorsa puntonun inebileceği taban
  finalColGap: 18,
  finalRadiusMax: 26,
  finalSplitAspect: 1.55, // bu en-boy oranı ve üstünde kart iki sütuna geçer
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
