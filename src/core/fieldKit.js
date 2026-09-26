// Ortak saha görsel kiti — zemin, ızgara, motif, dekor, duvar bandı TEK yerden.
//
// Neden var: her motor her frame zemin dolgusu + ızgara + duvar konturunu yeniden
// raster ediyordu (HORDE ~40 stroke, PONG ~20, BOMB ~15). World-view client'ları
// bunu 60 Hz interpolasyonla telefonun üzerinde ödüyordu. Burada statik saha
// katmanı bir kez offscreen canvas'a PİŞİRİLİR, frame başına tek `drawImage`
// (GPU blit) yapılır.
//
// AĞ BÜTÇESİ: bu modül HİÇBİR paket alanı eklemez. Katman yalnızca (mode,
// arena kutusu, theme, seed) bilgisinden türer; `mode` ve `roundId` zaten 30 Hz
// world packet'inde vardır, seed onlardan hash'lenir. Bu yüzden host ve client
// aynı dekoru AĞ YOKKEN aynı görür ve `isValid*WorldFrame` doğrulayıcıları
// dokunulmadan kalır.
//
// DETERMİNİZM KURALI: katman içinde `Math.random()`, `Date.now()` ve
// `performance.now()` YASAKTIR. Rastgelelik yalnız `seed`ten türeyen PRNG'den
// gelir; aksi halde her cihaz farklı dekor çizer ve cache her frame geçersiz
// olur.
//
// ÖLÇEK KURALI: ham px yazılmaz; tüm ölçüler `arena.unit` (`playfield.unit`,
// saha içi ölçeğin tek otoritesi) veya `fieldPx`/`fieldRadius` türevleridir.
//
// Renkler burada, `arenaKit.js`'teki `OBSTACLE_STYLES`/`PICKUP_META` gibi, saha
// paleti olarak yaşar: bunlar canvas dünyasının verisi, DOM çözüğü değil.
// Tema kimliği (`accent`) HORDE tarafından da okunduğu için tema sözleşmesi
// `floor/grid/accent/motif` alanlarını korur.

import { fieldPx, fieldRadius } from './playfield.js';

// ---------------------------------------------------------------------------
// Tema kayıt defteri
// ---------------------------------------------------------------------------

/** Ortak zemin dili: her tema bu alanların tamamını taşır. */
const THEME_BASE = Object.freeze({
  floor: '#FAF7F2',            // taban krem
  floorEdge: '#F1ECE2',        // gradyanın alt ucu (tabandan ~%4 koyu)
  grid: 'rgba(26, 26, 26, 0.05)',
  frame: 'rgba(26, 26, 26, 0.10)',  // iç çerçeve hairline
  accent: '#D84727',
  motif: 'rings',
  corners: 'plate',            // 'plate' | 'crosshair' | 'both' | 'none'
  cornerInk: '#2B2B28',
  wall: '#1A1A1A',
  wallShade: 'rgba(26, 26, 26, 0.15)', // sağ/alt iç gölge (ışık sol-üstten)
  decal: 'rgba(26, 26, 26, 0.055)',
  decals: 1,                   // 0..2 dekor yoğunluğu çarpanı
});

function theme(overrides) {
  return Object.freeze({ ...THEME_BASE, ...overrides });
}

/**
 * `mode` (ya da tema kimliği) → tema. Tanımsız oyunlar ortak krem saha diline
 * düşer; böylece yeni oyun eklemek burada tek satır.
 */
export const FIELD_THEMES = Object.freeze({
  default: theme({}),

  // PONG: sahanın kendisi fil yeri — çizgiler belirgin, motif iki halka, köşelerde
  // hem L plaka hem nişan çizgisi (host'un eski saha dilinin tamamı).
  PONG: theme({
    grid: 'rgba(26, 26, 26, 0.055)',
    frame: 'rgba(26, 26, 26, 0.13)',
    motif: 'rings',
    corners: 'both',
  }),

  // BOMB: krem + koyu çerçeve, sıcak gölge.
  BOMB: theme({
    floor: '#FAF7F2',
    floorEdge: '#F2ECE1',
    grid: 'rgba(26, 26, 26, 0.06)',
    frame: 'rgba(26, 26, 26, 0.11)',
    motif: 'rings',
    corners: 'plate',
    decal: 'rgba(43, 43, 40, 0.06)',
  }),

  // HORDE: üç mevcut harita teması, `hordeConfig.HORDE_MAPS` bunlara bağlanır.
  foundry: theme({
    floor: '#F1EEE7',
    grid: 'rgba(26, 26, 26, 0.075)',
    accent: '#D84727',
    motif: 'foundry',
    corners: 'none',
  }),
  reactor: theme({
    floor: '#E9F1F3',
    grid: 'rgba(14, 116, 144, 0.10)',
    accent: '#0891B2',
    motif: 'reactor',
    corners: 'none',
  }),
  core: theme({
    floor: '#EEEAF5',
    grid: 'rgba(91, 33, 182, 0.10)',
    accent: '#7C3AED',
    motif: 'core',
    corners: 'none',
  }),
});

// Tema kimliği büyük/küçük harften bağımsız çözülür: motor `mode` ('BOMB'),
// harita `id` ('foundry') geçiyor; ikisi de aynı kayda gitmeli.
const THEME_INDEX = new Map(
  Object.entries(FIELD_THEMES).map(([id, palette]) => [id.toLowerCase(), palette]),
);

/** Tema kimliği (`foundry` / `BOMB`) ya da doğrudan tema nesnesi çözer. */
export function fieldTheme(id, fallback = FIELD_THEMES.default) {
  if (id && typeof id === 'object') return { ...THEME_BASE, ...id };
  if (typeof id === 'string') {
    const found = THEME_INDEX.get(id.toLowerCase());
    if (found) return found;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Deterministik seed
// ---------------------------------------------------------------------------

/**
 * (mode, roundId) → uint32 seed. FNV-1a + avalanche; saf tamsayı matematiği
 * olduğu için host ve client BİREBİR aynı seed'i üretir.
 */
export function hashFieldSeed(mode, roundId = 0) {
  const name = String(mode || 'FIELD');
  const round = Math.max(0, Math.floor(Number(roundId) || 0));
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h = Math.imul(h ^ (round + 0x9e3779b9), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/** mulberry32 — dekor yerleşimi için seed'li PRNG. */
function seededRandom(seed) {
  let t = (Number(seed) || 0) >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), 1 | x);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Merkez motifleri
// ---------------------------------------------------------------------------

/**
 * Motifler düşük kontrastlı (alpha ~0.12) ve oyuncu/pickup renklerinden uzak
 * tutulur: saha okunurluğunu (I7) ve "burada engel var" okumasını bozmaz.
 * Çizim alanı ARENA-İÇİ 0..w / 0..h koordinatlarıdır.
 */
export const FIELD_MOTIFS = Object.freeze({
  none: () => {},

  /** PONG/BOMB: iki konsantrik merkez halkası. */
  rings(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(1, 2 * u);
    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, min * 0.22), 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.13)';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, min * 0.14), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },

  /** HORDE 'foundry': eşkenar dörtgen + çaprazlar. */
  foundry(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.21;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 4 * u);
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy);
    ctx.lineTo(cx + r * 0.55, cy);
    ctx.moveTo(cx, cy - r * 0.55);
    ctx.lineTo(cx, cy + r * 0.55);
    ctx.stroke();
    ctx.restore();
  },

  /** HORDE 'reactor': iç içe üç kare. */
  reactor(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const min = Math.min(w, h);
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 4 * u);
    for (let i = 0; i < 3; i += 1) {
      const r = min * (0.1 + i * 0.065);
      ctx.strokeRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();
  },

  /** HORDE 'core': altıgen. */
  core(ctx, w, h, u, palette) {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.19;
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = Math.max(1.5, 4 * u);
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = (i * Math.PI) / 3 - Math.PI / 6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  },
});

// ---------------------------------------------------------------------------
// Statik katmanın çizimi (arena-içi 0..w / 0..h koordinatları)
// ---------------------------------------------------------------------------

function arenaUnit(arena) {
  const u = Number(arena?.unit);
  if (Number.isFinite(u) && u > 0) return u;
  const size = Number(arena?.size) || Math.min(arena?.width || 0, arena?.height || 0);
  return size > 0 ? size / 952 : 1;
}

function paintCorners(ctx, w, h, u, palette, inset, edge) {
  const style = palette.corners;
  if (style === 'none') return;
  const min = Math.min(w, h);

  if (style === 'crosshair' || style === 'both') {
    const spots = [
      [inset, inset],
      [w - inset, inset],
      [inset, h - inset],
      [w - inset, h - inset],
    ];
    const len = fieldRadius({ size: min, unit: u }, 20, 0.012);
    ctx.save();
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.18)';
    ctx.lineWidth = Math.max(1, 1.5 * u);
    ctx.beginPath();
    for (const [x, y] of spots) {
      ctx.moveTo(x - len, y);
      ctx.lineTo(x + len, y);
      ctx.moveTo(x, y - len);
      ctx.lineTo(x, y + len);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (style !== 'plate' && style !== 'both') return;

  // 'plate': köşelerde L plakaları (sahanın fiziksel kenar dilini güçlendirir).
  // Duvar konturuyla kaynaşmaması için tam köşeden değil, `edge` kadar içeriden
  // başlar.
  const bLen = Math.max(fieldPx({ unit: u }, 16), min * 0.05);
  const reach = Math.max(2, edge);
  ctx.save();
  ctx.strokeStyle = palette.cornerInk;
  ctx.lineWidth = Math.max(1.5, 3 * u);
  ctx.beginPath();
  ctx.moveTo(0, reach + bLen); ctx.lineTo(0, reach); ctx.lineTo(reach + bLen, reach);
  ctx.moveTo(w - reach - bLen, reach); ctx.lineTo(w - reach, reach); ctx.lineTo(w - reach, reach + bLen);
  ctx.moveTo(0, h - reach - bLen); ctx.lineTo(0, h - reach); ctx.lineTo(reach + bLen, h - reach);
  ctx.moveTo(w - reach - bLen, h - reach); ctx.lineTo(w - reach, h - reach); ctx.lineTo(w - reach, h - reach - bLen);
  ctx.stroke();
  ctx.restore();
}

function paintDecals(ctx, w, h, u, palette, seed) {
  const intensity = Number(palette.decals);
  if (!(intensity > 0)) return;
  const min = Math.min(w, h);
  if (min < 40) return;

  // Alan arttıkça çoğalan ama sınırlı sayı; küçük `unit`'te (kompakt telefon
  // yatay) azalır — ince çizgi/karma 900px'de alias olur ve gövdeyi yorar.
  let count = Math.round((min * min) / 26000) * intensity;
  if (u < 0.5) count = Math.round(count * 0.6);
  if (u < 0.35) count = Math.round(count * 0.4);
  count = Math.max(0, Math.min(26, count));
  if (count === 0) return;

  const rng = seededRandom(seed);
  const margin = min * 0.07;
  const spanX = w - margin * 2;
  const spanY = h - margin * 2;
  const pf = { size: min, unit: u };

  ctx.save();
  for (let i = 0; i < count; i += 1) {
    const x = margin + rng() * spanX;
    const y = margin + rng() * spanY;
    const roll = rng();
    ctx.globalAlpha = 0.6 + rng() * 0.4;
    ctx.strokeStyle = palette.decal;
    ctx.fillStyle = palette.decal;

    if (roll < 0.42) {
      // çizik
      const len = fieldRadius(pf, 26, 0.02) * (0.6 + rng() * 0.9);
      const a = rng() * Math.PI;
      ctx.lineWidth = Math.max(1, 1.4 * u);
      ctx.beginPath();
      ctx.moveTo(x - Math.cos(a) * len * 0.5, y - Math.sin(a) * len * 0.5);
      ctx.lineTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5);
      ctx.stroke();
    } else if (roll < 0.78) {
      // leke
      const r = fieldRadius(pf, 30, 0.018) * (0.25 + rng() * 0.7);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // yay
      const r = fieldRadius(pf, 70, 0.05) * (0.5 + rng() * 0.8);
      const start = rng() * Math.PI * 2;
      ctx.lineWidth = Math.max(1, 1.2 * u);
      ctx.beginPath();
      ctx.arc(x, y, r, start, start + 0.7 + rng() * 1.1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Sahanın dışına taşan statik parçaların üstünü temizler: kapı boşluğu gibi.
 * Duvar konturu bilerek SONRA çizilir, böylece yama saha kenarındaki duvarı da
 * keser — yani kapı gerçekten sahnede bir açıklık olur.
 */
function paintPatches(ctx, w, h, u, palette, patches) {
  if (!Array.isArray(patches) || patches.length === 0) return;
  for (const patch of patches) {
    if (!patch) continue;
    const x = Number(patch.x);
    const y = Number(patch.y);
    const pw = Number(patch.w);
    const ph = Number(patch.h);
    if (![x, y, pw, ph].every(Number.isFinite) || pw <= 0 || ph <= 0) continue;
    ctx.fillStyle = palette.floor;
    ctx.fillRect(x, y, pw, ph);

    // Yamaya hafif bir iç gölge: düz leke yerine "çukur kapı" hissi.
    const depth = Math.max(fieldPx({ unit: u }, 6), Math.min(pw, ph) * 0.55);
    const toRight = Math.abs(x + pw - w) < 1;
    const toLeft = Math.abs(x) < 1;
    const toBottom = Math.abs(y + ph - h) < 1;
    const toTop = Math.abs(y) < 1;
    if (!(toRight || toLeft || toBottom || toTop)) continue;

    const grad = toRight
      ? ctx.createLinearGradient(x + pw - depth, 0, x + pw, 0)
      : toLeft
        ? ctx.createLinearGradient(x, 0, x + depth, 0)
        : toBottom
          ? ctx.createLinearGradient(0, y + ph - depth, 0, y + ph)
          : ctx.createLinearGradient(0, y, 0, y + depth);
    grad.addColorStop(0, 'rgba(26, 26, 26, 0)');
    grad.addColorStop(1, palette.wallShade);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, pw, ph);
  }
}

/**
 * Statik saha katmanının TAMAMINI çizer. Koordinat alanı arena içidir
 * (0,0)..(w,h): hem offscreen bake hem de DOM'suz doğrudan çizim yolu aynı
 * kodu kullanır.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} arena - { width, height } (arena içi çizim için yeterli)
 * @param {object} palette - `fieldTheme()` çıktısı
 * @param {object} opts - { seed, marks, patches }
 */
export function paintFieldLayer(ctx, arena, palette, { seed = 1, marks = null, patches = null } = {}) {
  const w = Math.max(1, Number(arena?.width) || 0);
  const h = Math.max(1, Number(arena?.height) || 0);
  const u = arenaUnit(arena);
  const min = Math.min(w, h);
  const inset = Math.max(fieldPx({ unit: u }, 12), min * 0.045);
  // Duvar konturu yarım çizgi kalınlığı kadar içeri alınır (katman kenarına
  // taşmasın); köşe plakaları da aynı mesafeden başlar.
  const wallW = Math.max(2, 4 * u);
  const edge = wallW * 0.6;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();

  // 1. Zemin gradyanı — düz dolgunun yerine, ışık solda-üstte olduğu için
  //    taban üstte açık altta bir tık derin.
  const floorGrad = ctx.createLinearGradient(0, 0, 0, h);
  floorGrad.addColorStop(0, palette.floor);
  floorGrad.addColorStop(1, palette.floorEdge);
  ctx.fillStyle = floorGrad;
  ctx.fillRect(0, 0, w, h);

  // 2. Izgara — tek path, tek stroke. Hücre boyutu `unit` ile büyür, böylece
  //    küçük ekranda 1px'e yaklaşan ince çizgi oluşmaz.
  const cell = Math.max(fieldPx({ unit: u }, 30), min / 13);
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = Math.max(1, 1 * u);
  ctx.beginPath();
  for (let x = inset + cell; x < w - inset; x += cell) {
    ctx.moveTo(x, inset);
    ctx.lineTo(x, h - inset);
  }
  for (let y = inset + cell; y < h - inset; y += cell) {
    ctx.moveTo(inset, y);
    ctx.lineTo(w - inset, y);
  }
  ctx.stroke();

  // 3. İç çerçeve hairline
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.strokeRect(inset, inset, w - inset * 2, h - inset * 2);

  // 4. Merkez motifi
  const motif = FIELD_MOTIFS[palette.motif] || FIELD_MOTIFS.rings;
  motif(ctx, w, h, u, palette);

  // 5. Seed'li dekor (yalnız bu katmanda, yalnız seed'den)
  paintDecals(ctx, w, h, u, palette, seed);

  // 6. Köşe işaretleri
  paintCorners(ctx, w, h, u, palette, inset, edge);

  // 7. Vignette — tek radyal gradyan
  const cx = w / 2;
  const cy = h / 2;
  const outer = Math.max(1, Math.hypot(cx, cy));
  const vig = ctx.createRadialGradient(cx, cy, outer * 0.42, cx, cy, outer);
  vig.addColorStop(0, 'rgba(26, 26, 26, 0)');
  vig.addColorStop(1, 'rgba(26, 26, 26, 0.085)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  // 8. Duvar iç gölgesi: sağ + alt (ışık sol-üstten gelir)
  const band = Math.max(fieldPx({ unit: u }, 8), min * 0.055);
  const rightShade = ctx.createLinearGradient(w - band, 0, w, 0);
  rightShade.addColorStop(0, 'rgba(26, 26, 26, 0)');
  rightShade.addColorStop(1, palette.wallShade);
  ctx.fillStyle = rightShade;
  ctx.fillRect(w - band, 0, band, h);
  const bottomShade = ctx.createLinearGradient(0, h - band, 0, h);
  bottomShade.addColorStop(0, 'rgba(26, 26, 26, 0)');
  bottomShade.addColorStop(1, palette.wallShade);
  ctx.fillStyle = bottomShade;
  ctx.fillRect(0, h - band, w, band);

  // 9. Duvar konturu — yarım çizgi katman kenarına taşmasın diye içeri alınır
  const half = wallW / 2;
  ctx.strokeStyle = palette.wall;
  ctx.lineWidth = wallW;
  ctx.strokeRect(half, half, w - wallW, h - wallW);

  // 10. Yama (kapı boşluğu vb.) — duvarın üstüne, yani açıklık gerçekten açık
  paintPatches(ctx, w, h, u, palette, patches);

  // 11. Oyunun kendi statik işaretleri (PONG halkaları, HORDE spawn kapıları)
  if (typeof marks === 'function') {
    ctx.save();
    marks(ctx, { width: w, height: h, unit: u, cx, cy, min }, palette);
    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Offscreen bake + cache
// ---------------------------------------------------------------------------

// Katman belleği: iki entry, ~2.4M px tavanı. Telefonda 852×393 @2 ≈ 1.3M px.
const MAX_LAYER_SCALE = 2;
const MAX_LAYER_PIXELS = 2_400_000;
const MAX_LAYER_ENTRIES = 2;

const layerCache = new Map();

/**
 * Canvas'ın efektif ölçeği (DPR × world-view `fitWorld` ölçeği). Blit 1:1
 * olsun diye katman tam bu çözünürlükte pişirilir. `getTransform` desteklemeyen
 * ya da sahte ctx'lerde 1'e düşer.
 */
function layerScale(ctx, arena) {
  let scale = 1;
  try {
    if (typeof ctx?.getTransform === 'function') {
      const matrix = ctx.getTransform();
      const a = matrix && Number(matrix.a);
      if (Number.isFinite(a) && a > 0) scale = a;
    }
  } catch {
    scale = 1;
  }
  scale = Math.min(scale, MAX_LAYER_SCALE);
  const area = Math.max(1, arena.width * arena.height) * scale * scale;
  if (area > MAX_LAYER_PIXELS) scale *= Math.sqrt(MAX_LAYER_PIXELS / area);
  return Math.max(0.5, scale);
}

function layerKey({ mode, themeId, seed, arena, scale, variant }) {
  return [
    mode,
    themeId,
    seed,
    Math.round(arena.left * 10),
    Math.round(arena.top * 10),
    Math.round(arena.width * 10),
    Math.round(arena.height * 10),
    scale.toFixed(2),
    variant,
  ].join('|');
}

function createLayerCanvas() {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    return typeof canvas?.getContext === 'function' ? canvas : null;
  } catch {
    return null;
  }
}

function evictIfNeeded() {
  while (layerCache.size > MAX_LAYER_ENTRIES) {
    const oldest = layerCache.keys().next().value;
    const entry = layerCache.get(oldest);
    // Backing store'u serbest bırak (mobil bellek).
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
    layerCache.delete(oldest);
  }
}

/** Bake sayaçları — testler ve performans ölçümü için (çizim yolunu değiştirmez). */
export const fieldLayerStats = { bakes: 0, blits: 0, fallbacks: 0 };

/**
 * Sahayı çizer: geçerli bir offscreen katman varsa tek `drawImage`, yoksa
 * katmanı bake edip blit eder; canvas oluşturulamıyorsa (DOM'suz test/SSR)
 * doğrudan çizime düşer — görsel aynı, maliyet eskisi kadardır.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} arena - playfield çıktısı (left/top/right/bottom/unit)
 * @param {object} [opts] - { mode, theme, seed, marks, patches, variant }
 *
 * `marks` bir oyun başına SABİT fonksiyon olmalıdır (modül seviyesinde tanımlanır):
 * cache anahtarı `marks`'i içermez, çünkü aynı `mode` için her frame aynı statik
 * işaretleri bekleriz. Oyununa özgü veriye bağlı katmanlar `variant` ile
 * anahtarlanır (PONG'un kapı boşlukları böyle).
 */
export function drawField(ctx, arena, opts = {}) {
  if (!ctx || !arena) return;
  const width = Number(arena.width) || (Number(arena.right) - Number(arena.left)) || 0;
  const height = Number(arena.height) || (Number(arena.bottom) - Number(arena.top)) || 0;
  if (width <= 0 || height <= 0) return;

  const box = {
    left: Number(arena.left) || 0,
    top: Number(arena.top) || 0,
    width,
    height,
    unit: arenaUnit(arena),
    size: Number(arena.size) || Math.min(width, height),
  };

  const mode = String(opts.mode || 'FIELD');
  const themeId = typeof opts.theme === 'string' ? opts.theme : mode;
  const palette = fieldTheme(opts.theme ?? mode);
  const seed = Number.isFinite(opts.seed) ? (Number(opts.seed) >>> 0) : hashFieldSeed(mode, 0);
  const scale = layerScale(ctx, box);
  const variant = opts.variant || '';
  const key = layerKey({ mode, themeId, seed, arena: box, scale, variant });

  const cached = layerCache.get(key);
  if (cached) {
    layerCache.delete(key);
    layerCache.set(key, cached); // LRU: kullanılan entry sona gider
    fieldLayerStats.blits += 1;
    ctx.drawImage(cached.canvas, box.left, box.top, box.width, box.height);
    return;
  }

  const layer = createLayerCanvas();
  if (!layer) {
    fieldLayerStats.fallbacks += 1;
    ctx.save();
    ctx.translate(box.left, box.top);
    paintFieldLayer(ctx, box, palette, { seed, marks: opts.marks, patches: opts.patches });
    ctx.restore();
    return;
  }

  layer.width = Math.max(1, Math.round(width * scale));
  layer.height = Math.max(1, Math.round(height * scale));
  const lctx = layer.getContext('2d');
  if (!lctx) {
    fieldLayerStats.fallbacks += 1;
    ctx.save();
    ctx.translate(box.left, box.top);
    paintFieldLayer(ctx, box, palette, { seed, marks: opts.marks, patches: opts.patches });
    ctx.restore();
    return;
  }

  lctx.setTransform(scale, 0, 0, scale, 0, 0);
  paintFieldLayer(lctx, box, palette, { seed, marks: opts.marks, patches: opts.patches });
  fieldLayerStats.bakes += 1;

  layerCache.set(key, { canvas: layer });
  evictIfNeeded();
  ctx.drawImage(layer, box.left, box.top, box.width, box.height);
}

/** Oyun değişimi / bellek baskısı: tüm bake'leri serbest bırakır. */
export function releaseFieldLayers() {
  for (const entry of layerCache.values()) {
    if (entry?.canvas) {
      entry.canvas.width = 0;
      entry.canvas.height = 0;
    }
  }
  layerCache.clear();
}
