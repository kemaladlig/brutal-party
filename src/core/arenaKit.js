// Ortak arena görsel kiti — engeller, layout oluşturma ve power-up rozetleri tek yerden.
// Motorlar buildLayout(name, arena) çağırabilir; ÇİZİM (drawObstacle, drawPickup) buradan gelir.
import { drawTabletopIcon, hasTabletopIcon } from './tabletopIcons.js';
import { fieldTheme } from './fieldKit.js';
import { fxGlowEnabled } from './perfMonitor.js';
import { UI_COLORS } from '../ui/tokens.js';
import { hueFor } from './projection2d.js';

export const PICKUP_META = {
  TURBO:        { label: 'TRB', icon: 'zap', glyph: '⚡', color: '#FFB020', ink: '#241C15' },
  FAST:         { label: 'HIZ', icon: 'zap', glyph: '⚡', color: '#FFB020', ink: '#241C15' },
  SPEED:        { label: 'HIZ', icon: 'zap', glyph: '⚡', color: '#FFB020', ink: '#241C15' },
  TELEPORT:     { label: 'TEL', icon: 'rotate-cw', glyph: '🌀', color: '#2BA6E8', ink: '#081D2E' },
  SLIP:         { label: 'KAY', icon: 'banana', glyph: '🍌', color: '#FFD24A', ink: '#2E2203' },
  MULTI:        { label: '3OK', icon: 'crosshair', glyph: '🎯', color: '#9B5DE5', ink: '#FFFFFF' },
  QUICKDRAW:    { label: 'ÇEK', icon: 'target', glyph: '🏹', color: '#FF8C1A', ink: '#2A1400' },
  SHIELD:       { label: 'KLK', icon: 'shield', glyph: '🛡️', color: '#0EA5E9', ink: '#06283D' },
  TRIPLE:       { label: '3×',  icon: 'flame', glyph: '💥', color: '#E63946', ink: '#FFFFFF' },
  SCISSORS:     { label: 'KES', icon: 'scissors', glyph: '✂️', color: '#F59E0B', ink: '#291800' },
  GHOST:        { label: 'HAY', icon: 'ghost', glyph: '👻', color: '#94A3B8', ink: '#0F172A' },
  INVERT:       { label: 'TERS',icon: 'rotate-ccw', glyph: '🔃', color: '#A78BFA', ink: '#241442' },
  SHRINK:       { label: 'KÜÇ', icon: 'search', glyph: '🔍', color: '#38BDF8', ink: '#082F49' },
  FREEZE:       { label: 'BUZ', icon: 'snowflake', glyph: '❄️', color: '#38BDF8', ink: '#082F49' },
  BOMB:         { label: 'PAT', icon: 'bomb', glyph: '💣', color: '#EF4444', ink: '#FFFFFF' },
  THICK:        { label: 'KAL', icon: 'brick', glyph: '🧱', color: '#A8A29E', ink: '#1C1917' },
  WALL:         { label: 'DUV', icon: 'brick', glyph: '🧱', color: '#F97316', ink: '#2A1400' },
  SLOW:         { label: 'YAV', icon: 'hourglass', glyph: '⏳', color: '#3B82F6', ink: '#FFFFFF' },
  GOLDEN_STAR:  { label: '★',   icon: 'star', glyph: '⭐', color: '#FFD700', ink: '#2A1E00' },
  TURBO_BERRY:  { label: 'HIZ', icon: 'sparkles', glyph: '✨', color: '#F43F5E', ink: '#FFFFFF' },
  FLASH:        { label: 'HIZ', icon: 'zap', glyph: '⚡', color: '#FFD122', ink: '#241C15' },
  SEISMIC:      { label: 'DAR', icon: 'flame', glyph: '💥', color: '#FF473A', ink: '#FFFFFF' },
  SUPER_JUMP:   { label: 'ZIP', icon: 'chevrons-up', glyph: '🦘', color: '#FFB020', ink: '#241C15' },
  REPAIR_TILES: { label: 'TAM', icon: 'hammer', glyph: '🔨', color: '#35B36A', ink: '#FFFFFF' },
};

/**
 * Engel derileri — TEK kaynak, DIŞA AÇIK kayıt defteri.
 *
 * Eskiden private'tı ve 3 deri vardı; motorlar yalnız o üçünü seçebiliyordu.
 * Artık `THEME_BASE.block` bir deri kimliği taşır, motor hex SEÇMEZ: sahaya
 * geçtiği temayı engeline de geçirir (`opts.theme`).
 *
 * `detail` bir fonksiyondur ve YAPILMAZ: blok başına karede gradyan üretmek
 * (12 blok × 60 fps = saniyede 720 nesne) telefonda GC takılması olarak geri
 * döner. Detaylar yalnız düz dolgu/çizgi kullanır.
 */
export const OBSTACLE_STYLES = {
  // Açık granit taş: Yeşil (TANKS / ARCHER) zeminlerde yüksek kontrastlı, temiz, pürüzsüz taş blok.
  stone: { top: '#F4EFE6', fill: '#C8BEAA', bevel: 'rgba(255,255,255,0.85)', edge: '#4A4234', shadow: 'rgba(20, 16, 31, 0.32)', detail: detailStone },
  // Obsidyen / Koyu gece bloğu: NINJA, CURVE gibi mistik sahalarda derin koyu mor-antrasit.
  dark:  { top: '#52436D', fill: '#241B34', bevel: 'rgba(255,255,255,0.52)', edge: '#120E1C', shadow: 'rgba(10, 8, 20, 0.45)', detail: null },
  // Sıcak maun koli: BOMB ve HEIST gibi sıcak sahalarda zeminle kaynaşmayan, belirgin ahşap kasa.
  crate: { top: '#8F5425', fill: '#522A0C', bevel: 'rgba(255,255,255,0.48)', edge: '#2C1404', shadow: 'rgba(20, 16, 31, 0.36)', detail: detailCrate },

  // Soğuk platin / kobalt titanyum: tek speküler şerit, parlak metalik yüzey.
  metal: { top: '#E8EDF5', fill: '#92A2B8', bevel: 'rgba(255,255,255,0.92)', edge: '#323C4C', shadow: 'rgba(16, 20, 28, 0.38)', detail: detailMetal },
  // Kristal buz: iç içe iki kontur, açık speküler gölge.
  ice: { top: '#EAF6FD', fill: '#94CFE4', bevel: 'rgba(255,255,255,0.85)', edge: '#357187', shadow: 'rgba(30, 70, 86, 0.26)', detail: detailIce },
  // Volkanik bazalt kaya: kırık köşe iki üçgen + tanecik.
  rock: { top: '#5A5266', fill: '#2E2838', bevel: 'rgba(255,255,255,0.38)', edge: '#181320', shadow: 'rgba(20, 16, 31, 0.40)', detail: detailRock },
  // Ağır endüstriyel kasa: çelik kuşaklı kasa.
  crateHeavy: { top: '#7D4B22', fill: '#44230B', bevel: 'rgba(255,255,255,0.42)', edge: '#240F04', shadow: 'rgba(16, 12, 24, 0.42)', detail: detailCrateHeavy },
  // Tehlike barikatı: gövde koyu grafit, uyarı şeritleri parlak kehribar.
  hazard: { top: '#3D344E', fill: '#1E1729', bevel: 'rgba(255,255,255,0.40)', edge: '#100C18', shadow: 'rgba(10, 8, 20, 0.45)', detail: detailHazard },
  // Kaideli mermer: açık ve asil kaide.
  plinth: { top: '#F9F5EC', fill: '#D3C9B6', bevel: 'rgba(255,255,255,0.90)', edge: '#5E5343', shadow: 'rgba(40, 34, 24, 0.28)', detail: detailPlinth },
};

/** Deri detayları — blok başına 0-2 op, tek path'te toplanır. */
function detailStone(ctx, x, y, w, h, u) {
  ctx.fillStyle = 'rgba(60, 50, 40, 0.12)';
  const s = Math.max(1, 2 * u);
  ctx.fillRect(x + w * 0.22, y + h * 0.3, s, s);
  ctx.fillRect(x + w * 0.58, y + h * 0.16, s, s);
  ctx.fillRect(x + w * 0.72, y + h * 0.46, s, s);
}

function detailCrate(ctx, x, y, w, h, u) {
  ctx.strokeStyle = 'rgba(40, 26, 10, 0.45)';
  ctx.lineWidth = Math.max(1, 1.6 * u);
  ctx.beginPath();
  ctx.moveTo(x + 2 * u, y + h * 0.5); ctx.lineTo(x + w - 2 * u, y + h * 0.5);
  ctx.moveTo(x + w * 0.5, y + 2 * u); ctx.lineTo(x + w * 0.5, y + h - 2 * u);
  ctx.stroke();
}

function detailCrateHeavy(ctx, x, y, w, h, u, style) {
  ctx.fillStyle = style.edge;
  const band = Math.max(1.5, 2.6 * u);
  ctx.fillRect(x, y + h * 0.2, w, band);
  ctx.fillRect(x, y + h * 0.66, w, band);
}

function detailMetal(ctx, x, y, w, h, u) {
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fillRect(x + Math.min(w * 0.16, 4 * u), y + 2 * u, Math.max(1, w * 0.12), Math.max(2, h - 4 * u));
}

function detailIce(ctx, x, y, w, h, u) {
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, 1.4 * u);
  const inset = Math.max(1.5, 3 * u);
  ctx.strokeRect(x + inset, y + inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2));
}

function detailRock(ctx, x, y, w, h, u) {
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  const c = Math.max(2, Math.min(w, h) * 0.2);
  ctx.beginPath();
  ctx.moveTo(x, y + c); ctx.lineTo(x + c, y); ctx.lineTo(x, y); ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.closePath();
  ctx.fill();
}

function detailPlinth(ctx, x, y, w, h, u, style) {
  ctx.strokeStyle = style.edge;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = Math.max(1, 1.2 * u);
  const inset = Math.max(2, 4 * u);
  ctx.strokeRect(x + inset, y + inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2.4));
  ctx.globalAlpha = 1;
}

/** Uyarı şeritleri: üst yüze kırpılmış çapraz çizgiler. Sayı BAĞLIDIR. */
function detailHazard(ctx, x, y, w, h, u) {
  const topH = h * 0.42;
  if (topH < 4) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, topH);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 209, 34, 0.85)';
  ctx.lineWidth = Math.max(2, 3.4 * u);
  ctx.beginPath();
  // Adım hem genişliğe hem şerit yüksekliğine bölünür ve SAYI 4'te bağlanır:
  // `w/4` tek başına uzun-fişek bir blokta 17 çapraz üretiyordu (op bütçesini
  // tek aşan buydu). Her çapraz 2 op (moveTo + lineTo).
  const step = Math.max(7, w / 3, topH / 2);
  for (let i = 0; i < 4 && (i - 1) * step < w + topH; i += 1) {
    ctx.moveTo(x + (i - 1) * step, y + topH);
    ctx.lineTo(x + (i - 1) * step + topH, y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Çizilecek deriyi çözer: açık `variant` her zaman kazanır (motorlar ona
 * güveniyor), yoksa tema'nın `block` kimliği, o da yoksa `stone`.
 *
 * KARE BAŞINA TAHSİZ YOK: bu fonksiyon çağrı başına nesne ÜRETMEZ — tablodaki
 * hazır referansı döndürür. Üretirse 12 blok × 60 fps = saniyede 720 nesne eder.
 */
export function obstacleStyle(opts = {}) {
  const id = opts.variant || themeBlockId(opts.theme) || 'stone';
  return OBSTACLE_STYLES[id] || OBSTACLE_STYLES.stone;
}

/** Tema kimliğinden (string ya da palet nesnesi) varsayılan engel derisini okur. */
function themeBlockId(theme) {
  if (!theme) return null;
  const palette = typeof theme === 'string' ? fieldTheme(theme) : theme;
  return palette && typeof palette.block === 'string' ? palette.block : null;
}

// ---------------------------------------------------------------------------
// Düzen yerleşimi — en-boy oranı farkındalığı
// ---------------------------------------------------------------------------
// Presetler kare bir alanda yazıldı: node konumları `size` cinsinden, merkezden.
// `size = min(arenaW, arenaH)` olduğu için 21:9 telefon yatayında (~2.1:1) bu
// düzen sahanın yalnız ~%24-36'sını kaplıyor, gerisi boş zemin oluyor.
//
// Çözüm iki aşamalı ve iç içe değil:
//   1) YAY  — konumlar yatayda `spread` katsayısıyla gerçek saha dikdörtgenine
//             dağıtılır. Blok BOYUUTLARI değişmez (orantı bozulmaz).
//   2) YOĞUNLUK — yay yaptığında aynı sayıdaki blok daha geniş bir alana
//             dağılır ve "az sayıda minik blok" hissi doğar. En-boy oranı
//             eşiği aşınca preset'in kendi sözlüğünden ikinci bir halka eklenir
//             (daha küçük ölçekli), böylece parça yoğunluğu kabaca sabit kalır.
//
// NOT: `designAspect: 1` — presetler kareye göre yazıldı. Kare sahada yay 1.0'dir,
// yani davranış bugünküyle aynıdır. Geniş sahada yay büyür; `maxSpread` ile
// tavanlanır (aşırı oranlarda bloklar uç noktarda yığılmasın).
export const LAYOUT_TUNING = Object.freeze({
  designAspect: 1,
  // `spread = 1 + (aspect - designAspect) * spreadGain` — kare sahada (aspect 1)
  // TAMAMEN 1.0 döner, yani bugünkü davranış birebir korunur. `aspect` ile
  // doğrudan çarpım kare olmayan sahada da büyüme verdiği için (4:3 tablet,
  // 3:2) yanlış olurdu; fark tabanlı formül bu yüzden seçildi.
  spreadGain: 1.4,
  maxSpread: 2.6,
  densifyFrom: 1.25,
  ringScale: 0.6,
  // Halka adaylarının merkezden uzaklık oranları. Sabit tek oran yerine ızgara:
  // adaylar sırayla değerlendirilir, `minPassage` açıklığı veren ilk kabul
  // edilir (aksi halde en iyisi seçilir). 0.62 eski sabit oranın karşılığıdır.
  ringCandidates: Object.freeze([0.62, 0.42, 0.78, 0.26, 0.9]),
  // Merkeze bu mesafedeki node'lar halkaya katılmaz (aksi halde merkezdeki
  // bloğun kopyası üstüne biner).
  ringMinOffset: 0.16,
  wallMargin: 0.045,
  // Motor geçmezse geçiş tabanı: saha kısa kenarının %5'i.
  defaultPassage: 0.05,
});

/** Halka aday oranları — `LAYOUT_TUNING`'dan okunur (donmuş nesne). */
const RING_CANDIDATES = LAYOUT_TUNING.ringCandidates;

function rectsBounds(list) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of list) {
    const ox = r.mover?.axis === 'x' ? Math.abs(r.mover.amp || 0) : 0;
    const oy = r.mover?.axis === 'y' ? Math.abs(r.mover.amp || 0) : 0;
    const x = r.mover ? (r.mover.baseX ?? r.x) : r.x;
    const y = r.mover ? (r.mover.baseY ?? r.y) : r.y;
    minX = Math.min(minX, x, x + r.w - ox);
    maxX = Math.max(maxX, x + r.w + ox);
    minY = Math.min(minY, y, y + r.h - oy);
    maxY = Math.max(maxY, y + r.h + oy);
  }
  return { minX, minY, maxX, maxY };
}

/** Konumları yatayda `spread` katsayısıyla açar; boyutlar ve oran korunur. */
function spreadNodes(nodes, cx, spread) {
  if (spread === 1) return nodes;
  return nodes.map((r) => {
    const next = { ...r };
    const anchorX = r.mover ? (r.mover.baseX ?? r.x) : r.x;
    const movedX = cx + (anchorX - cx) * spread;
    if (r.mover) {
      next.mover = { ...r.mover };
      if (r.mover.axis === 'x') {
        next.mover.baseX = movedX;
        // Salınım genişliği de aynı ölçekte büyür, yoksa yay sırasında
        // hareketli duvar yayılmayı bozar.
        next.mover.amp = (r.mover.amp || 0) * spread;
        next.x = movedX;
      } else {
        next.mover.baseY = r.mover.baseY;
        next.x = movedX;
      }
      return next;
    }
    next.x = movedX;
    return next;
  });
}

/**
 * Yay sonrası alan seyrelmesini telafi eden ikinci halka: preset'in kendi
 * blokları merkezden yansıtılıp küçültülür. Yeni geometri uydurmaz, mevcut
 * düzenin dilini tekrar kullanır.
 */
/**
 * Bir aday rect ile mevcut node'lar arasındaki EN DAR kenardan-kenara açıklık.
 * Çakışma varsa negatif döner. `Math.max(dx, dy)` kullanılır: iki dikdörtgen
 * yalnız BİR eksende örtüşüyorsa aralarından yatay ya da düşey geçilebilir,
 * o durumda o eksendeki açıklık geçerli ölçüttür.
 */
function clearanceTo(rect, list) {
  let min = Infinity;
  for (const other of list) {
    const dx = Math.max(rect.x - (other.x + other.w), other.x - (rect.x + rect.w));
    const dy = Math.max(rect.y - (other.y + other.h), other.y - (rect.y + rect.h));
    min = Math.min(min, Math.max(dx, dy));
  }
  return min;
}

/**
 * İkinci halka: preset'in kendi bloklarını merkezden yansıtıp küçülterek
 * saha geniş olduğunda ortada kalan boşluğu doldurur.
 *
 * Konum SABİT bir orana (`ringOffset`) değil, gerçekten boş olan yere konur:
 * merkez ile asıl node arasındaki ızgara üzerinde birkaç aday konum denenir ve
 * `minPassage` açıklığı veren EN İYİSİ seçilir.
 *
 * Neden: sabit oran iki hata birden üretiyordu. (1) `cross`'ta 0.62 konumu tam
 * merkez kareye düşüyordu — %95 üst üste binme. (2) Açıklık denetimi eklendiğinde
 * halka neredeyse tamamen reddedildi ve `cross` 6 blokla kaldı: saha alanının
 * %3.3'ü (ölçülen — `pillars` %6.6, `scatter` %5.0), yani "geçilebilir ama
 * seyrek". Boşluğu arayan yerleşim ikisini birden çözer: kare sahada yer
 * olmadığı için halka eklenmez (tasarım korunur), geniş sahada ortadaki
 * geniş bantlara yerleşir (saha dolu görünür).
 */
function densify(nodes, cx, cy, size, minPassage) {
  const minOffset = size * LAYOUT_TUNING.ringMinOffset;
  const placed = [...nodes];
  for (const r of nodes) {
    if (r.mover) continue; // hareketli duvarları çoğaltma
    const nx = r.x + r.w / 2;
    const ny = r.y + r.h / 2;
    const ox = nx - cx;
    const oy = ny - cy;
    if (Math.hypot(ox, oy) < minOffset) continue; // merkez özelliği, çoğaltma

    const w = r.w * LAYOUT_TUNING.ringScale;
    const h = r.h * LAYOUT_TUNING.ringScale;
    let best = null;
    let bestClearance = -Infinity;
    for (const t of RING_CANDIDATES) {
      const candidate = {
        x: cx + ox * t - w / 2,
        y: cy + oy * t - h / 2,
        w,
        h,
      };
      const clearance = clearanceTo(candidate, placed);
      if (clearance > bestClearance) {
        bestClearance = clearance;
        best = candidate;
      }
      if (bestClearance >= minPassage) break; // daha iyisi olamaz
    }
    if (best && bestClearance >= minPassage) placed.push(best);
  }
  return placed;
}

/**
 * Builds preset map obstacle layouts for games.
 *
 * `minPassage` — preset'lerin bırakması gereken EN DAR geçiş (px). Bir koridor
 * oyuncunun çapından dar olamaz; motor kendi oyuncu yarıçapından türetip
 * geçer (örn. `playerRadius * 2.4`). Verilmezse saha kısa kenarının %5'i.
 * Geçilemeyen koridor "engel çakışmıyor" diye testlerden geçebilir; bu yüzden
 * sayısal bir taban gerekiyor.
 *
 * @param {string} name - Layout preset name
 * @param {Object} arena - Arena geometry object { cx, cy, size, width, height, aspect }
 * @param {{ minPassage?: number }} [options]
 * @returns {Array<Object>} List of obstacle rect objects { x, y, w, h, mover? }
 */
export function buildLayout(name, arena, options = {}) {
  const minPassage = Number.isFinite(options.minPassage) && options.minPassage > 0
    ? options.minPassage
    : (arena.size || 0) * LAYOUT_TUNING.defaultPassage;
  const authored = buildSquareLayout(name, arena, minPassage);
  if (!authored.length) return authored;

  const { cx, cy, size } = arena;
  const aspect = Number.isFinite(arena.aspect) && arena.aspect > 0
    ? arena.aspect
    : (arena.width && arena.height ? arena.width / arena.height : 1);
  const spread = Math.max(1, Math.min(
    LAYOUT_TUNING.maxSpread,
    1 + (aspect - LAYOUT_TUNING.designAspect) * LAYOUT_TUNING.spreadGain,
  ));
  if (spread === 1) return authored;

  const spreaded = spreadNodes(authored, cx, spread);
  const filled = aspect < LAYOUT_TUNING.densifyFrom
    ? spreaded
    : densify(spreaded, cx, cy, size, minPassage);
  return dropOutsideArena(filled, arena);
}

/**
 * Sahanın TAMAMEN dışında kalan bloğu eler. `spreadNodes` konumları merkezden
 * `spread` katına açar ama boyutları değiştirmez; geniş sahada bir preset'in
 * kenar bloğu duvarın ötesine taşabiliyordu (ölçülen: `scatter`, 1 blok).
 * Görünmeyen bir engel hiçbir şeyi engellemez, yalnız yer kaplar.
 *
 * Kısmen taşan blok ATILMAZ: görünür kısmı hâlâ duvar görevi görür.
 */
function dropOutsideArena(nodes, arena) {
  const { left, top, right, bottom } = arena;
  if (![left, top, right, bottom].every(Number.isFinite)) return nodes;
  return nodes.filter((r) => (
    r.x < right && r.x + r.w > left && r.y < bottom && r.y + r.h > top
  ));
}

function buildSquareLayout(name, arena, minPassage) {
  const { cx, cy, size } = arena;
  if (!size || size <= 0) return [];

  const layoutName = (name || 'pillars').toLowerCase();

  if (layoutName === 'cross') {
    const armL = size * 0.26;
    const armT = size * 0.055;
    // Geçiş genişliği OYUNCUNUN BOYUTUNDAN türetilir, kolların kalınlığından
    // değil. Ölçülen hata: kolun iç ucu ile merkez kare arasında 10px kalıyordu
    // (44px çaplı karakter) — yani dikey geçiş MATEMATİKSEL OLARAK KAPALIYDI.
    // Eski halinde kollar merkez kareye gömülüydü, yani o da tamamen kapalıydı:
    // bu yol baştan beri geçilemezdi. `armT`'den türeyen `armGap` oyuncuya hiç
    // bakmıyordu.
    const centreHalf = armT * 1.4;
    const armStart = centreHalf + minPassage;
    const armW = armL * 0.70;
    return [
      { x: cx - armStart - armW, y: cy - armT / 2, w: armW, h: armT },
      { x: cx + armStart, y: cy - armT / 2, w: armW, h: armT },
      { x: cx - armT / 2, y: cy - armStart - armW, w: armT, h: armW },
      { x: cx - armT / 2, y: cy + armStart, w: armT, h: armW },
      { x: cx - centreHalf, y: cy - centreHalf, w: centreHalf * 2, h: centreHalf * 2 },
    ];
  }

  if (layoutName === 'scatter') {
    const bw = size * 0.13;
    const mw = size * 0.05;
    return [
      { x: cx - size * 0.30, y: cy - size * 0.05, w: bw, h: bw * 0.7 },
      { x: cx + size * 0.18, y: cy - size * 0.05, w: bw, h: bw * 0.7 },
      { x: cx - size * 0.05, y: cy - size * 0.30, w: bw * 0.7, h: bw },
      { x: cx - size * 0.05, y: cy + size * 0.20, w: bw * 0.7, h: bw },
      { x: cx - size * 0.34, y: cy - size * 0.34, w: bw * 0.8, h: bw * 0.8 },
      { x: cx + size * 0.28, y: cy + size * 0.28, w: bw * 0.8, h: bw * 0.8 },
      { x: cx - size * 0.22, y: cy + size * 0.40, w: size * 0.16, h: mw, mover: { baseX: cx - size * 0.22, baseY: cy + size * 0.40, axis: 'x', amp: size * 0.16, speed: 0.9, phase: 0 } },
      { x: cx + size * 0.40, y: cy - size * 0.22, w: mw, h: size * 0.16, mover: { baseX: cx + size * 0.40, baseY: cy - size * 0.22, axis: 'y', amp: size * 0.16, speed: 1.2, phase: Math.PI / 2 } },
    ];
  }

  if (layoutName === 'bunker') {
    const bSize = Math.round(size * 0.115);
    const bOffset = Math.round(size * 0.165);
    return [
      { x: cx - bOffset - bSize / 2, y: cy - bOffset - bSize / 2, w: bSize, h: bSize },
      { x: cx + bOffset - bSize / 2, y: cy - bOffset - bSize / 2, w: bSize, h: bSize },
      { x: cx - bOffset - bSize / 2, y: cy + bOffset - bSize / 2, w: bSize, h: bSize },
      { x: cx + bOffset - bSize / 2, y: cy + bOffset - bSize / 2, w: bSize, h: bSize },
      { x: cx - size * 0.38, y: cy - size * 0.05, w: size * 0.08, h: size * 0.09 },
      { x: cx + size * 0.30, y: cy - size * 0.05, w: size * 0.08, h: size * 0.09 },
    ];
  }

  if (layoutName === 'courtyard') {
    const bW = Math.round(size * 0.24);
    const bH = Math.round(size * 0.07);
    // Dört kollu çıkarma (pinwheel) düzeni. Döner kolların ARALARINDAKİ
    // koridor genişliği, kolların uzunluğundan türer:
    //   koridor = kolMerkezi - bH/2 - kolYarıUzunluk
    // Kol uzunluğu SABİT bir oran olduğu için bu koridor da sabitti
    // (0.075 × size) ve yalnız küçük gövdeli oyunlarda geçerliydi.
    // HORDE tankı 33 → 42 px büyüyünce ihtiyaç 70px'i geçti ve 900x900'de
    // koridor 58px'te kaldı: orta cepteki disk kenara hiç ulaşamadı.
    // `cross` preset'i bu hatadan bir tur önce kurtulmuştu (kolların iç ucu
    // `armStart = centreHalf + minPassage`); burada da kol uzunluğu
    // `minPassage`'tan türetilir. Kısaltılan yer `densify` ile geri dolar.
    const barOffset = size * 0.23;
    const armHalf = Math.min(
      bW / 2,
      barOffset - bH / 2 - minPassage,
    );
    const bW2 = Math.max(0, armHalf * 2);
    return [
      { x: cx - bW / 2, y: cy - barOffset - bH / 2, w: bW, h: bH },
      { x: cx - bW / 2, y: cy + barOffset - bH / 2, w: bW, h: bH },
      { x: cx - barOffset - bH / 2, y: cy - armHalf, w: bH, h: bW2 },
      { x: cx + barOffset - bH / 2, y: cy - armHalf, w: bH, h: bW2 },
    ];
  }

  if (layoutName === 'split') {
    const blkW = Math.round(size * 0.14);
    const blkH = Math.round(size * 0.32);
    return [
      { x: cx - size * 0.22 - blkW / 2, y: cy - blkH / 2, w: blkW, h: blkH },
      { x: cx + size * 0.22 - blkW / 2, y: cy - blkH / 2, w: blkW, h: blkH },
    ];
  }

  // Bomb '04 SİPER KOLONU' — 4 sade köşe kolonu (merkez blok yok)
  if (layoutName === 'columns4') {
    const pSize = Math.round(size * 0.125);
    const offset = Math.round(size * 0.22);
    return [
      { x: cx - offset - pSize / 2, y: cy - offset - pSize / 2, w: pSize, h: pSize },
      { x: cx + offset - pSize / 2, y: cy - offset - pSize / 2, w: pSize, h: pSize },
      { x: cx - offset - pSize / 2, y: cy + offset - pSize / 2, w: pSize, h: pSize },
      { x: cx + offset - pSize / 2, y: cy + offset - pSize / 2, w: pSize, h: pSize },
    ];
  }

  // Bomb 'HAÇ & KORİDORLAR' — merkezsiz 4 koridor kanadı (archer cross'undan farklı)
  if (layoutName === 'crossfire') {
    const thick = Math.round(size * 0.07);
    const len = Math.round(size * 0.2);
    const gap = Math.round(size * 0.19);
    return [
      { x: cx - thick / 2, y: cy - gap - len, w: thick, h: len },
      { x: cx - thick / 2, y: cy + gap, w: thick, h: len },
      { x: cx - gap - len, y: cy - thick / 2, w: len, h: thick },
      { x: cx + gap, y: cy - thick / 2, w: len, h: thick },
    ];
  }

  // 'pillars' (default)
  const bw = Math.round(size * 0.16);
  return [
    { x: cx - bw * 1.4 - bw / 2, y: cy - bw - bw / 2, w: bw, h: bw },
    { x: cx + bw * 1.4 - bw / 2, y: cy - bw - bw / 2, w: bw, h: bw },
    { x: cx - bw * 1.4 - bw / 2, y: cy + bw - bw / 2, w: bw, h: bw },
    { x: cx + bw * 1.4 - bw / 2, y: cy + bw - bw / 2, w: bw, h: bw },
    { x: cx - bw * 0.35, y: cy - bw * 0.35, w: bw * 0.7, h: bw * 0.7 },
  ];
}

function pathRoundRect(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
  }
}

/**
 * Yumuşak temas gölgesi damgası — BİR KEZ üretilir, varlık başına tek `drawImage`.
 *
 * Neden elips değil: 3 iç-içe elips yumuşak düşüşün yalnız TAKLİDİDİR ve kenarda
 * görünen bantlar bırakır — kullanıcının "kalitesiz / ben buradayım der gibi"
 * dediği şey tam olarak bu bandalanmaydı. Gerçek radyal düşüş bir bitmap'te
 * bir kez hesaplanır, kare başına maliyeti tek blit. `shadowBlur` DEĞİL: o her
 * çizimde konvolüsyon yapar ve GPU hızlı yolunu kapatır.
 *
 * 64×64 ≈ 16 KB. Alfa tavanı 0.17 — önceki sert yolun ~0.15 çekirdeğinden bile
 * düşük okunur, çünkü ortalama düşüş çok daha hızlı sıfıra iner.
 */
const SHADOW_SPRITE_SIZE = 64;
const SHADOW_SPRITE_STOPS = /** @type {Array<[number, string]>} */ ([
  [0, 'rgba(18, 14, 28, 0.17)'],
  [0.35, 'rgba(18, 14, 28, 0.11)'],
  [0.65, 'rgba(18, 14, 28, 0.04)'],
  [1, 'rgba(18, 14, 28, 0)'],
]);
let shadowSprite = null;
let shadowSpriteTried = false;

function getShadowSprite() {
  if (shadowSprite || shadowSpriteTried) return shadowSprite;
  shadowSpriteTried = true;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  try {
    const canvas = document.createElement('canvas');
    const g = canvas.getContext && canvas.getContext('2d');
    if (!g) return null;
    canvas.width = SHADOW_SPRITE_SIZE;
    canvas.height = SHADOW_SPRITE_SIZE;
    const half = SHADOW_SPRITE_SIZE / 2;
    const grad = g.createRadialGradient(half, half, 0, half, half, half);
    for (const [stop, color] of SHADOW_SPRITE_STOPS) grad.addColorStop(stop, color);
    g.fillStyle = grad;
    g.fillRect(0, 0, SHADOW_SPRITE_SIZE, SHADOW_SPRITE_SIZE);
    shadowSprite = canvas;
  } catch {
    shadowSprite = null;
  }
  return shadowSprite;
}

/** DOM'suz ortam (test/SSR) için düşüş: üç iç-içe elips, bantlı ama çizilmeyen. */
function contactShadowFallback(ctx, cx, baseY, rx, ry, style) {
  ctx.fillStyle = style.shadow || 'rgba(26, 26, 26, 0.32)';
  const layers = [[1, 0.05], [0.72, 0.05], [0.45, 0.06]];
  for (const [scale, alpha] of layers) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, rx * scale, ry * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Bloğun TABANINA oturan, çok hafif temas gölgesi.
 *
 * İki kural: (1) boyut bloğun **ayak izininden** türer, yüksekliğinden değil —
 * uzun-fişek bloğun altına dev gri leke koymak, gölgeyi "bloğun gövdesinin
 * kopyası" sanmaktan doğan hataydı; (2) ışık yönü saha dilinde sabit
 * (sol-üstten, bkz. `fieldKit.paintFloorBase`), bu yüzden YATAY OFSET yok —
 * gölge her zaman tam altta ve belli belirsiz.
 */
function contactShadow(ctx, x, y, w, h, u, style, mass) {
  const footprint = Math.min(w, h);
  const cx = x + w / 2;
  const baseY = y + h + Math.max(0.5, footprint * 0.03 + 0.8 * u);
  const rx = w / 2 + Math.max(1, footprint * 0.04);
  const ry = Math.max(1.2, footprint * 0.1 + u) * (0.85 + 0.3 * mass);
  const sprite = getShadowSprite();
  if (!sprite) {
    contactShadowFallback(ctx, cx, baseY, rx, ry, style);
    return;
  }
  // Birim kare damga → dikey ölçekle elipse dönüşür. `save/restore` zaten
  // çağıranın elinde; burada yalnız transform sıkıştırıyoruz.
  ctx.translate(cx, baseY);
  ctx.scale(1, ry / rx);
  ctx.drawImage(sprite, -rx, -rx, rx * 2, rx * 2);
  ctx.scale(1, rx / ry);
  ctx.translate(-cx, -baseY);
}

/**
 * Blok başına deterministik "kabartma" [0,1): aynı kutu her cihazda aynı
 * yükseklikte okunur.
 *
 * Girdi yalnız kutunun kendisidir — engel dikdörtgenleri world packet'te zaten
 * taşınır, yani PAKET ALANI EKLENMEZ ve host ile client aynı değeri üretir.
 * Kutu 4 px kovaya kuantlanır: paket `round1` ile 0.1 px'e yuvarladığı için ham
 * float üzerinden hash'lemek host↔client bir kovayı tersleyebilirdi.
 *
 * SİLÜET VE BOUNDING KUTU DEĞİŞMEZ — yalnızca relief (alt kenar kalınlığı,
 * gölge ofseti, detay) türer. Çarpışma algısı birebir doğru kalır.
 */
export function obstacleMass(obs) {
  const q = (v) => Math.round((Number(v) || 0) / 4);
  let h = Math.imul(q(obs.x) + 1, 374761393)
    ^ Math.imul(q(obs.y) + 1, 668265263)
    ^ Math.imul(q(obs.w) + 1, 1274126177)
    ^ Math.imul(q(obs.h) + 1, 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Engel ölçüleri — kare başına SIFIR TAHSİS için modül içi tek seferlik depo.
 * Senkron ve yeniden girişi olmayan çağrılar paylaşır; ayrıntı üretmez.
 */
const METRICS = { u: 0, r: 0, border: 0, mass: 0, wallH: 0 };

function measureObstacle(obs) {
  const u = Math.max(0.42, Math.min(1.5, Math.min(obs.w, obs.h) / 48));
  METRICS.u = u;
  METRICS.r = Math.max(3, Math.min(10 * u, Math.min(obs.w, obs.h) * 0.22));
  METRICS.border = Math.max(1.5, 2.2 * u);
  METRICS.mass = obstacleMass(obs);
  // Yükseklik ekseni: kamera güneyden hafif eğik bakar, blok ekranın YUKARISINA
  // doğru yükselir. `wallH` eski bottomRim formülüdür — deterministik ve aynı
  // blokta her cihazda aynı. Çarpışma dikdörtgeni TABAN İZİDİR (bkz. §2.5D).
  METRICS.wallH = Math.max(3.5, Math.min(10, 5.2 * u)) * (0.75 + 0.5 * METRICS.mass);
  return METRICS;
}

/**
 * Derinlik sıralaması anahtarı: bloğun zemine temas çizgisi.
 * Karakter/pickup anahtarıyla karşılaştırılır — bkz. `sceneEntityY`.
 */
export function obstacleBaseY(obs) {
  return obs.y + obs.h;
}

/** Varlık (oyuncu, pickup) derinlik anahtarı: merkezin biraz güneyi. */
export function entitySceneY(y, radius) {
  return y + radius * 0.5;
}

/** Zemin temas gölgesi — her koşulda HER VARLIĞIN ALTINDA çizilir. */
export function drawObstacleGround(ctx, obs, opts = {}) {
  const { x, y, w, h } = obs;
  if (!(w > 0 && h > 0)) return;
  const m = measureObstacle(obs);
  ctx.save();
  contactShadow(ctx, x, y, w, h, m.u, obstacleStyle(opts), m.mass);
  ctx.restore();
}

/**
 * Tactile 2.5D engel prizması: yuvarlak köşeli çatı yüzü (ışık yüzü), kalıplanmış
 * vinil pah ışıltısı, çatı/ön yüz birleşim gölgesi ve zemine oturan ön yüz.
 *
 * Siluet = (x, y - wallH, w, h + wallH): çatı yukarı taşar, ön yüz bloğun kendi
 * yüksekliğinde kalır. Çarpışma kutusu (x, y, w, h) DEĞİŞMEZ — görsel yükseliş
 * painter's order ile okunur; kuzeydeki varlıkları çatı ÖRTTÜĞÜ için sahte değil,
 * kameranın güneyden bakış açısının kendisidir (bkz. sahne kuyruğu).
 *
 * BÜTÇE: blok başına ≤ 18 raster/path op ve KARE BAŞINA SIFIR TAHSİŞ. Gövde
 * koyulaştırma ve pahlar gradyanla değil, siluet clip'i altındaki düz dolgu
 * şeritleriyle üretilir; deri detayı `detail` fonksiyon tablosundan gelir
 * (`drawObstacleMass` içine `if/else` zinciri büyümez). Tavan `arenaLayout.test.mjs`'te kilitli.
 */
export function drawObstacleMass(ctx, obs, opts = {}) {
  const { x, y, w, h } = obs;
  if (!(w > 0 && h > 0)) return;
  const style = obstacleStyle(opts);
  const m = measureObstacle(obs);
  const { u, r, border, wallH } = m;
  const top = y - wallH;
  const jct = y + h - wallH;

  ctx.save();

  // 1. Prizma silueti: kontur + gövde (ön/yan yüz = orta ton).
  pathRoundRect(ctx, x, top, w, h + wallH, r);
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = border;
  ctx.stroke();
  ctx.fillStyle = style.fill;
  ctx.fill();

  // 2-5. Yüzler — siluet clip'i köşeleri biçer, hepsi düz dolgu şeridi.
  ctx.clip();

  // 2. Çatı yüzü (açık ışık yüzü).
  ctx.fillStyle = style.top;
  ctx.fillRect(x - 1, top - 1, w + 2, h + 1);

  // 3. Birleşim gölgesi: çatı, ön yüzün üstüne hafif gölge düşürür.
  ctx.globalAlpha = 0.30;
  ctx.fillStyle = style.edge;
  ctx.fillRect(x, jct - Math.max(1, 0.8 * u), w, Math.max(1, 1.6 * u));

  // 4. Ön yüz alt kenar koyulaşması — zemine oturma.
  ctx.globalAlpha = 0.4;
  ctx.fillRect(x, y + h - Math.max(1.5, wallH * 0.4), w, Math.max(1.5, wallH * 0.4));
  ctx.globalAlpha = 1;

  // 5. Çatı üst pah ışıltısı (kalıplanmış vinil kenar).
  ctx.fillStyle = style.bevel;
  ctx.fillRect(x + r * 0.6, top + Math.max(0.5, 0.6 * u), Math.max(1, w - r * 1.2), Math.max(1, 1.2 * u));

  // 6. Deri detayı (0-4 op) — çatı yüzünde.
  if (style.detail) style.detail(ctx, x, top, w, h, u, style);

  ctx.restore();
}

/** Gölge + prizma birlikte: derinlik sıralaması DIŞINDAKİ her kullanım. */
export function drawObstacle(ctx, obs, opts = {}) {
  const { w, h } = obs;
  if (!(w > 0 && h > 0)) return;
  drawObstacleGround(ctx, obs, opts);
  drawObstacleMass(ctx, obs, opts);
}

// ---------------------------------------------------------------------------
// 2.5D eğik engel (BOMB dönüşümü) — tepeden bakış çiziminin kardeşi.
// Aynı sahip (arenaKit); yalnız projeksiyonla çizer. Gölge zemin katmanında
// (çağıran hemen çizer), gövde derinlik kuyruğuna `sceneDraw` ile girer:
//   sceneDraw(ctx, obstacleBaseY(obs), drawObstacle25dMass, proj, obs)
// ---------------------------------------------------------------------------

/** Zemin temas gölgesi — prizmadan ÖNCE, zemin katmanında çizilir. */
export function drawObstacle25dShadow(ctx, proj, obs) {
  const { x, y, w, h } = obs;
  if (!(w > 0 && h > 0)) return;
  proj.contactPatch(ctx, x + w / 2 + 4, y + h / 2 + 6, (w / 2) * 0.95, (h / 2) * 0.95, 0.8);
}

/**
 * 2.5D engel yüksekliği — SADECE GÖRSEL z ekseni (çarpışma daima (x,y,w,h) taban
 * izidir). Deterministik: ayak izinden türer (mass hash + en-boy oranı), yani
 * host ve client PAKET DEĞİŞİKLİĞİ OLMADAN aynı yüksekliği hesaplar.
 *
 * Sözlük (yükseklik = "ne kadar dik duruyor", kameradan bağımsız):
 *   • UZUN DUVAR (oran ≥ 2)     → yüksek (uzun kenar duvar gibi ayakta)
 *   • KOLON      (minDim ≥ 40)  → orta
 *   • KERB       (küçük blok)   → kısa
 * `proj.obstacleHeightScale` (varsayılan 1) sahne genelinde kısaltır/uzatır.
 *
 * KÖR NOKTA BÜTÇESİ: engelin arkasında `d = h / tan(kamera açısı)` kadar şerit
 * saklanır. Yani kamera açısı ile yükseklik aynı hedefin İKİ bağımsız koludur:
 * yatık (derin) kamera isteniyorsa yüksekliği kısarak kör nokta küçük tutulur.
 */
export function obstacle25dHeight(obs, proj) {
  const minDim = Math.min(obs.w, obs.h);
  const aspect = Math.max(obs.w, obs.h) / Math.max(1, minDim);
  const mass = obstacleMass(obs);
  let h;
  if (aspect >= 2) h = minDim * 0.95;        // uzun duvar
  else if (minDim >= 40) h = minDim * 0.67;  // kolon
  else h = minDim * 0.53;                    // kerb
  h *= 0.85 + 0.3 * mass;                    // blok başına hafif varyasyon
  h = Math.max(16, Math.min(56, h));
  const scale = proj && Number.isFinite(proj.obstacleHeightScale) ? proj.obstacleHeightScale : 1;
  return h * scale;
}

/**
 * Gövde: UZUN blok → prizma (duvar şekli korunur), kare/kısa → silindir (kolon),
 * büyük kare blok → prizma. Yükseklik `obstacle25dHeight`'ten (tek kaynak).
 */
export function drawObstacle25dMass(ctx, proj, obs) {
  const { x, y, w, h } = obs;
  if (!(w > 0 && h > 0)) return;
  const pal = hueFor(x * 0.13 + y * 0.07 + w, proj.theme && proj.theme.hues);
  const minDim = Math.min(w, h);
  const aspect = Math.max(w, h) / Math.max(1, minDim);
  const height = obstacle25dHeight(obs, proj);
  if (aspect < 1.8 && minDim < 66) {
    proj.drawCylinder(ctx, x + w / 2, y + h / 2, minDim / 2, height, pal);
  } else {
    proj.drawPrism(ctx, x, y, w, h, height, pal);
  }
}

// ---------------------------------------------------------------------------
// Derinlik sıralaması — sahne kuyruğu (2.5D painter's order)
// ---------------------------------------------------------------------------
// Görüşme: bloklar birbirini asla örtmez (layout testi kilitli), asıl çakışma
// blok ↔ varlık çiftlerinde. Tam painter's order için her çizilebilir bir öğe
// olarak kuyruğa girer ve `sceneEnd` taban Y'ye göre KARARLI sırayla çizer
// (eşit Y'de ekleme sırası korunur). Kare başına tahsis yok: öğe nesneleri
// havuzda yaşar, sıralama yerinde insertion sort'tur.
const sceneItems = [];
let sceneCount = 0;
let sceneOpen = false;

/**
 * Sahne/sahne başı: kuyruğu AÇAR ve sayacı sıfırlar (havuzu boşaltmaz).
 * İç içe çağrılmaz — tek sahne penceresi yeter.
 */
export function sceneBegin() {
  sceneCount = 0;
  sceneOpen = true;
}

/**
 * Öğe ekle. `draw` imzası `draw(ctx, a, b)` — STATİK fonksiyon olmalı (kare
 * başına closure üreten çizim, GC bütçesini bozar).
 */
export function scenePush(y, draw, a = null, b = null) {
  let idx = sceneCount;
  if (idx >= sceneItems.length) sceneItems.push({ y: 0, draw: null, a: null, b: null });
  const item = sceneItems[idx];
  item.y = y;
  item.draw = draw;
  item.a = a;
  item.b = b;
  sceneCount = idx + 1;
}

/**
 * Sahne AÇIKSA kuyruğa yazar, değilse hemen çizer. Kuyruğu bilmeyen çağıranlar
 * (testler, tekil render yolları) bu yüzden bugünkü davranışı aynen korur;
 * sıralama yalnız `sceneBegin`/`sceneEnd` penceresi içinde devreye girer.
 */
export function sceneDraw(ctx, y, draw, a = null, b = null) {
  if (!sceneOpen) {
    draw(ctx, a, b);
    return;
  }
  scenePush(y, draw, a, b);
}

/** Prizma öğesi olarak ekle (gölge değil — gölge zemin katmanında kalır). */
export function sceneObstacle(ctx, obs, opts = null) {
  sceneDraw(ctx, obstacleBaseY(obs), drawObstacleMass, obs, opts || undefined);
}

/** Sahneyi sıralayıp çizer ve pencereyi kapatır. Açık pencere yoksa boştur. */
export function sceneEnd(ctx) {
  if (!sceneOpen) return;
  for (let i = 1; i < sceneCount; i += 1) {
    const item = sceneItems[i];
    let j = i - 1;
    while (j >= 0 && sceneItems[j].y > item.y) {
      sceneItems[j + 1] = sceneItems[j];
      j -= 1;
    }
    sceneItems[j + 1] = item;
  }
  for (let i = 0; i < sceneCount; i += 1) {
    const item = sceneItems[i];
    item.draw(ctx, item.a, item.b);
  }
  sceneCount = 0;
  sceneOpen = false;
}

// Ortak power-up rozeti: hafif puls aura + yumuşak gölge + canlı dairesel rozet + vektör ikon.
export function drawPickup(ctx, pk, opts = {}) {
  const meta = PICKUP_META[pk.type] || { label: '★', icon: 'star', glyph: '⭐', color: '#FFD700', ink: '#241C15' };
  const color = opts.color || meta.color;
  const glyph = opts.glyph || meta.glyph || '⭐';
  const iconKey = meta.icon || glyph;
  const half = (opts.size || (pk.radius ? pk.radius * 2 : 28)) / 2;
  const u = Math.max(0.6, half / 14);
  const proj = opts.proj || null;

  ctx.save();
  const pulse = 1 + Math.sin((pk.animTime || 0) * 6) * 0.08;
  if (proj) {
    // 2.5D: rozet zeminden yüzer; merkez projekte, ölçek kameradan.
    const sp = proj.proj(pk.x, pk.y, half);
    const k = proj.view.scale * sp.d;
    ctx.translate(sp.x, sp.y);
    ctx.scale(pulse * k, pulse * k);
  } else {
    ctx.translate(pk.x, pk.y);
    ctx.scale(pulse, pulse);
  }

  // 1. Hafif Dış Puls Aurası (glow) — düşük FX kademesinde kapalı (2.3).
  if (fxGlowEnabled()) {
    ctx.beginPath();
    ctx.arc(0, 0, half + 3.5 * u, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.22;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // 2. Yumuşak Zemin Gölgesi
  ctx.beginPath();
  ctx.arc(0, 2.5 * u, half, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(20, 16, 31, 0.35)';
  ctx.fill();

  // 3. Canlı Renkli Gövde
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 4. Üst Parlaklık / Işık Yayı (Gloss)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(-half * 0.2, -half * 0.3, half * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.30)';
  ctx.fill();
  ctx.restore();

  // 5. Tactile Dış Çerçeve
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.strokeStyle = meta.ink || '#241C15';
  ctx.lineWidth = Math.max(1.8, 2.2 * u);
  ctx.stroke();

  // 6. İç Vektör İkonu (Lucide standart) veya fallback glif
  if (hasTabletopIcon(iconKey)) {
    drawTabletopIcon(ctx, iconKey, 0, 0, Math.round(half * 1.3), {
      color: meta.ink || '#241C15',
      strokeWidth: 2.4,
    });
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = meta.ink || '#241C15';
    ctx.font = `900 ${Math.max(13, Math.round(half * 1.2))}px sans-serif`;
    ctx.fillText(glyph, 0, 1);
  }

  ctx.restore();
}

/**
 * Zemin Yanık/İs İzi (Decal) — patlama ve vuruş noktalarında zemine düşen 2.5D leke.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} [alpha=1]
 * @param {{ color?: string }} [opts]
 */
export function drawScorchDecal(ctx, x, y, radius, alpha = 1, opts = {}) {
  if (!ctx || radius <= 0 || alpha <= 0) return;
  const a = Math.max(0, Math.min(1, alpha));
  const r = radius;
  const rgb = opts.color || UI_COLORS.contactShadowRgb;

  ctx.save();
  ctx.translate(x, y);

  // 1. Dış yumuşak is dairesi
  ctx.fillStyle = `rgba(${rgb}, ${0.22 * a})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();

  // 2. İç koyu yanık çekirdeği
  ctx.fillStyle = `rgba(${rgb}, ${0.45 * a})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.55, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();

  // 3. İki küçük asimetrik is sıçraması
  ctx.fillStyle = `rgba(${rgb}, ${0.35 * a})`;
  ctx.beginPath();
  ctx.arc(-r * 0.35, -r * 0.25, r * 0.22, 0, Math.PI * 2);
  ctx.arc(r * 0.4, r * 0.2, r * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/**
 * Drift/Kayma İzi (Skid Mark Decal) — ani fren ve kaymalarda zemine bırakılan çift iz.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} angle
 * @param {number} length
 * @param {number} [alpha=1]
 * @param {{ unit?: number, trackWidth?: number }} [opts]
 */
export function drawSkidMark(ctx, x, y, angle, length, alpha = 1, opts = {}) {
  if (!ctx || length <= 0 || alpha <= 0) return;
  const a = Math.max(0, Math.min(1, alpha));
  const u = opts.unit || 1;
  const spacing = (opts.trackWidth || 12) * u;
  const trackW = Math.max(1.2, 2.0 * u);
  const rgb = UI_COLORS.contactShadowRgb;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = `rgba(${rgb}, ${0.28 * a})`;
  ctx.lineWidth = trackW;
  ctx.lineCap = 'round';

  ctx.beginPath();
  // Sol teker izi
  ctx.moveTo(-length * 0.5, -spacing * 0.5);
  ctx.lineTo(length * 0.5, -spacing * 0.5);
  // Sağ teker izi
  ctx.moveTo(-length * 0.5, spacing * 0.5);
  ctx.lineTo(length * 0.5, spacing * 0.5);
  ctx.stroke();

  ctx.restore();
}

