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
  // 2.5D vinil zemin temas gölgesi
  contactShadow: 'rgba(18, 14, 28, 0.16)',
  contactShadowRgb: '18, 14, 28',
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

  // --- 2.5D Eğik Sahne Paleti (canvas) -----------------------------------
  // Eğik kameranın "oyuncak masa" malzeme dili. `rules-lint K2` ham renk
  // literalini `src/**/*.js`te yasakladığı için palet burada (muaf sözlükte)
  // yaşar; `core/projection2d.js` buradan okur, koda literal yazılmaz.
  arena25d: {
    // Mürekkep + vinil mat
    ink25d: '#3A2A22',
    mat25d: '#9AD3C8',
    matEdge25d: '#6FB3A9',
    tray25d: '#F3ECDD',
    stitch25d: 'rgba(255, 255, 255, 0.55)',
    shadow25d: 'rgba(58, 34, 44, 0.20)',
    gloss25d: 'rgba(255, 255, 255, 0.55)',
    // Gradyan uçlarını saydamlaştırmak için (küre parıltısı/taban gölgesi).
    clear25d: 'rgba(255, 255, 255, 0)',
    // Sahanın dışı: ahşap masa + vinyet
    table25d: '#B08863',
    tableVignetteTop25d: 'rgba(255, 240, 220, 0.10)',
    tableVignetteEdge25d: 'rgba(60, 36, 24, 0.28)',
    // Kauçuk kenar tamponları (kuzey/güney/doğu/batı)
    rail25d: {
      north: { top: '#FFB08A', front: '#E8825A', side: '#C96A45' },
      east: { top: '#FFE08A', front: '#E8B94F', side: '#C79A38' },
      south: { top: '#FFD08A', front: '#EE9F4F', side: '#CC8139' },
      west: { top: '#C7B4F2', front: '#9B7BD8', side: '#7C5FB8' },
    },
    // Engel prizmaları — deterministik pastel tonlar (5 hue)
    hue25d: [
      { top: '#F6B27B', front: '#E08A4F', side: '#BC6F3A' },
      { top: '#C79AD8', front: '#9B5FA8', side: '#7B4588' },
      { top: '#C2D98A', front: '#9CBB5A', side: '#7C9A42' },
      { top: '#FFB7C6', front: '#F58AA3', side: '#D26B85' },
      { top: '#A8D8EF', front: '#74B8DC', side: '#5697BC' },
    ],
  },

  // --- 2.5D Saha Temaları (harita → tema) ---------------------------------
  // Aynı geometri, farklı malzeme. BOMB harita sırasıyla eşlenir
  // (`bombView.bombThemeForMap`); host↔client aynı paket `mapIndex`inden türetir.
  // Anahtar adları: mat/matEdge/tray/table/vigTop/vigEdge/stitch/rails/hues.
  arena25dThemes: {
    wood: {
      table: '#B08863', vigTop: 'rgba(255, 240, 220, 0.10)', vigEdge: 'rgba(60, 36, 24, 0.28)',
      tray: '#F3ECDD', mat: '#9AD3C8', matEdge: '#6FB3A9', stitch: 'rgba(255, 255, 255, 0.55)',
      rails: {
        north: { top: '#FFB08A', front: '#E8825A', side: '#C96A45' },
        east: { top: '#FFE08A', front: '#E8B94F', side: '#C79A38' },
        south: { top: '#FFD08A', front: '#EE9F4F', side: '#CC8139' },
        west: { top: '#C7B4F2', front: '#9B7BD8', side: '#7C5FB8' },
      },
      hues: [
        { top: '#F6B27B', front: '#E08A4F', side: '#BC6F3A' },
        { top: '#C79AD8', front: '#9B5FA8', side: '#7B4588' },
        { top: '#C2D98A', front: '#9CBB5A', side: '#7C9A42' },
        { top: '#FFB7C6', front: '#F58AA3', side: '#D26B85' },
        { top: '#A8D8EF', front: '#74B8DC', side: '#5697BC' },
      ],
    },
    marble: {
      table: '#C9CBD0', vigTop: 'rgba(255, 255, 255, 0.18)', vigEdge: 'rgba(50, 55, 66, 0.20)',
      tray: '#F6F7F9', mat: '#E8EDF2', matEdge: '#C2CBD6', stitch: 'rgba(120, 135, 155, 0.45)',
      rails: {
        north: { top: '#F2B8A0', front: '#D98E72', side: '#B87057' },
        east: { top: '#F2DA9A', front: '#D9B96A', side: '#B89A50' },
        south: { top: '#F2C89A', front: '#D9A96A', side: '#B88A50' },
        west: { top: '#C9BEE8', front: '#A79BCC', side: '#877BB0' },
      },
      hues: [
        { top: '#E7B79A', front: '#C98F6A', side: '#A87450' },
        { top: '#D8C4E4', front: '#B49BC6', side: '#9179A8' },
        { top: '#D3E0B8', front: '#AEC488', side: '#8AA068' },
        { top: '#F0C8CF', front: '#D6A0AA', side: '#B47E88' },
        { top: '#C4DCE8', front: '#9FBED2', side: '#7C9CB0' },
      ],
    },
    arcade: {
      table: '#241C33', vigTop: 'rgba(120, 80, 200, 0.12)', vigEdge: 'rgba(0, 0, 0, 0.45)',
      tray: '#2E2440', mat: '#1B1530', matEdge: '#3A2E5A', stitch: 'rgba(120, 255, 220, 0.35)',
      rails: {
        north: { top: '#FF6AD5', front: '#C43FA0', side: '#8E2B74' },
        east: { top: '#6AFFE0', front: '#2FC4A8', side: '#1F8E7A' },
        south: { top: '#FFD46A', front: '#C4A02F', side: '#8E741F' },
        west: { top: '#8A6AFF', front: '#5F3FC4', side: '#442B8E' },
      },
      hues: [
        { top: '#FF9AA2', front: '#D96A74', side: '#A84A52' },
        { top: '#B39DFF', front: '#8A6FD9', side: '#644FA8' },
        { top: '#9DFFC4', front: '#6AD99A', side: '#4AA872' },
        { top: '#FFC59D', front: '#D9966A', side: '#A86E4A' },
        { top: '#9DE0FF', front: '#6AB6D9', side: '#4A8AA8' },
      ],
    },
    picnic: {
      table: '#A9744F', vigTop: 'rgba(255, 240, 200, 0.12)', vigEdge: 'rgba(60, 40, 20, 0.28)',
      tray: '#F4E4C1', mat: '#8FCB6B', matEdge: '#6BA84C', stitch: 'rgba(255, 255, 255, 0.50)',
      rails: {
        north: { top: '#F2A6A6', front: '#D97A7A', side: '#B85A5A' },
        east: { top: '#F2D27A', front: '#D9B85A', side: '#B8983A' },
        south: { top: '#F2C0A0', front: '#D99A72', side: '#B87750' },
        west: { top: '#A6C4F2', front: '#7A9ED9', side: '#5A7EB8' },
      },
      hues: [
        { top: '#F2B27B', front: '#D98A4F', side: '#B86A3A' },
        { top: '#C79AD8', front: '#9B5FA8', side: '#7B4588' },
        { top: '#C2D98A', front: '#9CBB5A', side: '#7C9A42' },
        { top: '#FFB7C6', front: '#F58AA3', side: '#D26B85' },
        { top: '#A8D8EF', front: '#74B8DC', side: '#5697BC' },
      ],
    },
    night: {
      table: '#16202B', vigTop: 'rgba(90, 140, 200, 0.12)', vigEdge: 'rgba(0, 0, 0, 0.50)',
      tray: '#1E2A38', mat: '#14212E', matEdge: '#2A3D52', stitch: 'rgba(150, 210, 255, 0.35)',
      rails: {
        north: { top: '#6AB8FF', front: '#3F8FD9', side: '#2B6AA8' },
        east: { top: '#6AFFD4', front: '#3FD9A8', side: '#2BA87A' },
        south: { top: '#FFD46A', front: '#D9A83F', side: '#A87A2B' },
        west: { top: '#B08AFF', front: '#7F5FD9', side: '#5A3FA8' },
      },
      hues: [
        { top: '#7FB3FF', front: '#4F82D9', side: '#3560A8' },
        { top: '#B08AFF', front: '#7F5FD9', side: '#5A3FA8' },
        { top: '#7FFFC4', front: '#4FD99A', side: '#35A870' },
        { top: '#FFB37F', front: '#D9824F', side: '#A86035' },
        { top: '#7FE4FF', front: '#4FB6D9', side: '#358AA8' },
      ],
    },
    // SNAKE — tek tema (harita varyasyonları yalnız duvar düzeni; zemin ortak).
    // Açık yeşil mat + krem tepsi, yeşil yılan gövdesini yutar diye mat'ı
    // koyulaştırmadan soluk tuttuk; engeller (hues) toprak/patika tonları.
    garden: {
      table: '#A9744F', vigTop: 'rgba(255, 240, 200, 0.12)', vigEdge: 'rgba(60, 40, 20, 0.28)',
      tray: '#F2E7C9', mat: '#C7DFA0', matEdge: '#9CBB6E', stitch: 'rgba(255, 255, 255, 0.55)',
      rails: {
        north: { top: '#B7E08A', front: '#8FBF5A', side: '#6E9A42' },
        east: { top: '#F2D27A', front: '#D9B85A', side: '#B8983A' },
        south: { top: '#F2B08A', front: '#D98A5A', side: '#B86A42' },
        west: { top: '#A6D8F2', front: '#7AAED9', side: '#5A86B8' },
      },
      hues: [
        { top: '#E7C79A', front: '#C9A06A', side: '#A87C50' },
        { top: '#C79AD8', front: '#9B5FA8', side: '#7B4588' },
        { top: '#C2D98A', front: '#9CBB5A', side: '#7C9A42' },
        { top: '#FFB7C6', front: '#F58AA3', side: '#D26B85' },
        { top: '#A8D8EF', front: '#74B8DC', side: '#5697BC' },
      ],
    },
  },
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
  // Sonuç kartı kademesi (koyu panel): üst etiket / kazanan / sıralama satırı.
  finalLabel: [900, 12, 'mono'],
  finalHero: [900, 26, 'grotesk'],
  finalRow: [800, 14, 'grotesk'],
  finalRowValue: [900, 14, 'mono'],
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
