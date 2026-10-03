// Ortak arena görsel kiti — engeller, layout oluşturma ve power-up rozetleri tek yerden.
// Motorlar buildLayout(name, arena) çağırabilir; ÇİZİM (drawObstacle, drawPickup) buradan gelir.
import { drawTabletopIcon, hasTabletopIcon } from './tabletopIcons.js';
import { drawDioramaContactShadow } from './dioramaKit.js';
import { DEPTH_KIND, entityDepth, obstacleDepth, pushDepthItem } from './depthPass.js';
import { fieldTheme } from './fieldKit.js';
import { fxGlowEnabled } from './perfMonitor.js';
// Reaktif engel tepkisi (ARENA_ELEVATION_PLAN Faz 5): blok gövdesinin sahibi
// burasıdır, darbe titreşimi/çatlağı da burada okunur. Tek yönlü bağımlılık —
// `fieldProps` `arenaKit`i tanımaz, döngü yok.
import { drawPropCracks, propFlinchOffset, propHitFor } from './fieldProps.js';

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

// Pickup ÖLÇEK tablosu (yarıçap, tasarım px) — TEK kaynak.
//
// `PICKUP_META` renk/ikonu, bu tablo BOYUTU tutar: `drawPickup` `size`
// alanını yarıçap sayar (`half = radius * 2 / 2`), `spawnPickup` varsayılanı
// buradan okur. Saha ölçekli motorlar (SNAKE yemi) de aynı sayıyı
// `playfield.fieldRadius` üzerinden geçirir — ham px motor dosyasında yazılmaz
// (AGENTS §4). `minFraction` küçük telefonda varlığın ezilmesini engeller.
export const PICKUP_SIZE = Object.freeze({
  base: 15,
  // Güvenlik tabanı, ölçek payı: aşırı dar portre sahada varlık sıfıra
  // düşmesin. BİLEREK çok küçük tutulur — taban yukarı çıkarıldığında tip
  // hiyerarşisini (yıldız > berry > elma) eziyor, yem kafadan büyük çıkıyordu.
  minFraction: 0.012,
});

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
  stone: { top: '#E6E1D8', fill: '#CFC7B8', bevel: 'rgba(255,255,255,0.7)', edge: '#4E483E', shadow: 'rgba(20, 16, 31, 0.32)', detail: detailStone },
  // Obsidyen / Koyu gece bloğu: NINJA, CURVE gibi mistik sahalarda derin koyu mor-antrasit.
  dark:  { top: '#342C44', fill: '#231C30', bevel: 'rgba(255,255,255,0.22)', edge: '#120E1C', shadow: 'rgba(10, 8, 20, 0.45)', detail: null },
  // Sıcak maun koli: BOMB ve HEIST gibi sıcak sahalarda zeminle kaynaşmayan, belirgin ahşap kasa.
  crate: { top: '#7C4B24', fill: '#5C3314', bevel: 'rgba(255,255,255,0.32)', edge: '#361B08', shadow: 'rgba(20, 16, 31, 0.36)', detail: detailCrate },

  // Soğuk platin / kobalt titanyum: tek speküler şerit, parlak metalik yüzey.
  metal: { top: '#DDE3ED', fill: '#9BA8BD', bevel: 'rgba(255,255,255,0.85)', edge: '#3B4556', shadow: 'rgba(16, 20, 28, 0.38)', detail: detailMetal },
  // Kristal buz: iç içe iki kontur, açık speküler gölge.
  ice: { top: '#E6F6FC', fill: '#9BD6E8', bevel: 'rgba(255,255,255,0.75)', edge: '#3E7C93', shadow: 'rgba(30, 70, 86, 0.26)', detail: detailIce },
  // Volkanik bazalt kaya: kırık köşe iki üçgen + tanecik.
  rock: { top: '#484252', fill: '#332E3D', bevel: 'rgba(255,255,255,0.22)', edge: '#1B1724', shadow: 'rgba(20, 16, 31, 0.40)', detail: detailRock },
  // Ağır endüstriyel kasa: çelik kuşaklı kasa.
  crateHeavy: { top: '#6E421E', fill: '#4E2B10', bevel: 'rgba(255,255,255,0.28)', edge: '#2B1406', shadow: 'rgba(16, 12, 24, 0.42)', detail: detailCrateHeavy },
  // Tehlike barikatı: gövde koyu grafit, uyarı şeritleri parlak kehribar.
  hazard: { top: '#2E273A', fill: '#1E1828', bevel: 'rgba(255,255,255,0.20)', edge: '#100C18', shadow: 'rgba(10, 8, 20, 0.45)', detail: detailHazard },
  // Kaideli mermer: açık ve asil kaide.
  plinth: { top: '#F6F2E8', fill: '#D9D0C1', bevel: 'rgba(255,255,255,0.80)', edge: '#665C4E', shadow: 'rgba(40, 34, 24, 0.28)', detail: detailPlinth },
};

/** Deri detayları — blok başına 0-2 op, tek path'te toplanır. */
function detailStone(ctx, x, y, w, h, u) {
  ctx.fillStyle = 'rgba(60, 50, 40, 0.16)';
  const s = Math.max(1, 2.2 * u);
  ctx.fillRect(x + w * 0.22, y + h * 0.28, s, s);
  ctx.fillRect(x + w * 0.68, y + h * 0.18, s * 1.3, s * 1.3);
  ctx.fillRect(x + w * 0.42, y + h * 0.50, s, s);
}

function detailCrate(ctx, x, y, w, h, u) {
  const inset = Math.max(2, 3.2 * u);
  ctx.strokeStyle = 'rgba(40, 26, 10, 0.45)';
  ctx.lineWidth = Math.max(1, 1.4 * u);
  ctx.beginPath();
  // İç çerçeve kasası + X çapraz takviye çıtası (tek path stroke)
  ctx.rect(x + inset, y + inset, Math.max(1, w - inset * 2), Math.max(1, h - inset * 2));
  ctx.moveTo(x + inset, y + inset); ctx.lineTo(x + w - inset, y + h - inset);
  ctx.moveTo(x + w - inset, y + inset); ctx.lineTo(x + inset, y + h - inset);
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

// ---------------------------------------------------------------------------
// Sahne derinlik geçişi — 12 oyunun ortak köprüsü
// ---------------------------------------------------------------------------

/**
 * Bu iki çizici MODÜL SEVİYESİ sabittir; `pushDepthItem` kare başına
 * fonksiyon referansı yazdığı için `() => drawObstacle(...)` gibi bir kapanış
 * yazmak 60 Hz'de saniyede yüzlerce nesne demektir (AGENTS §1 madde 4).
 */
const DEPTH_DRAW_OBSTACLE = (ctx, obs, opts) => drawObstacle(ctx, obs, opts);
const DEPTH_DRAW_PICKUP = (ctx, pk) => drawPickup(ctx, pk);

/**
 * Engel listesini derinlik havuzuna YAZAR (çizmez).
 *
 * View'lar `drawXArena` içinde bunu çağırır, `drawXPlayers` sonunda
 * `flushDepthPass` ile tek seferde sıralı çizim olur. Böylece karakter bloğun
 * arkasına geçtiğinde arkasında kalır — 2.5D hacminin okunabilirliği.
 *
 * @param {Array<any>} obstacles
 * @param {any} opts - `drawObstacle` seçenekleri (view'ın MODÜL SABİTİ)
 */
export function pushObstaclesToDepth(obstacles, opts) {
  if (!Array.isArray(obstacles)) return;
  for (let i = 0; i < obstacles.length; i += 1) {
    const obs = obstacles[i];
    if (!obs) continue;
    pushDepthItem(obstacleDepth(obs), DEPTH_KIND.OBSTACLE, obs, DEPTH_DRAW_OBSTACLE, opts);
  }
}

/** Pickup listesini derinlik havuzuna yazar (havada süzülürler, zeminden yukarı). */
export function pushPickupsToDepth(pickups) {
  if (!Array.isArray(pickups)) return;
  for (let i = 0; i < pickups.length; i += 1) {
    const pk = pickups[i];
    if (!pk) continue;
    pushDepthItem(entityDepth(pk), DEPTH_KIND.PICKUP, pk, DEPTH_DRAW_PICKUP, null);
  }
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
 * Sprite'in kendisi `dioramaKit`'te yaşar (oyuncu, engel, madalyon, taş, top aynı
 * düşüşü paylaşır; iki ayrı sprite iki ayrı gölge dili demekti).
 */
const SHADOW_INK = '12, 8, 20';
const LIGHT_INK = '255, 255, 255';
const shadowRgba = (a) => `rgba(${SHADOW_INK}, ${a})`;
const lightRgba = (a) => `rgba(${LIGHT_INK}, ${a})`;

/**
 * Bloğun TABANINA oturan, yönlü 2.5D derinlik gölgesi.
 * Sol-üst ana ışıktan türeyen hafif sağ-aşağı ofset ve tok temas oklüzyonu.
 */
function contactShadow(ctx, x, y, w, h, u, mass) {
  const footprint = Math.min(w, h);
  const cx = x + w / 2 + Math.max(1, 2.2 * u);
  const drop = Math.max(1, 1.8 * u + footprint * 0.02);
  const rx = w / 2 + Math.max(1.5, footprint * 0.06);
  const ry = Math.max(2, footprint * 0.14 + 1.2 * u) * (0.85 + 0.3 * mass);
  drawDioramaContactShadow(ctx, cx, y + h, rx, ry, { drop });
}

/**
 * Blok başına deterministik "kabartma" [0,1): aynı kutu her cihazda aynı
 * yükseklikte okunur.
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
 * Tactile diorama engel bloğu: 2.5D basık ön yüzey (front face), üst bevel ışığı,
 * tok temas gölgesi ve çatışma tepkisi.
 */
export function drawObstacle(ctx, obs, opts = {}) {
  const style = obstacleStyle(opts);
  const { x, y, w, h } = obs;
  if (!(w > 0 && h > 0)) return;
  const u = Math.max(0.42, Math.min(1.5, Math.min(w, h) / 48));
  const r = Math.max(3, Math.min(10 * u, Math.min(w, h) * 0.22));
  const border = Math.max(1.5, 2.2 * u);
  const mass = obstacleMass(obs);
  // 2.5D Ön Yüz Derinliği: fiziksel diorama takozu (Boomerang Fu / Brawl Stars derinlik oranı %18-24).
  const depth = Math.max(5.5 * u, Math.min(h * 0.24, 14 * u)) * (0.85 + 0.35 * mass);

  // Darbe tepkisi: canlı darbede blok vuranın yönünde 1-2 px geri teper.
  const hit = propHitFor(obs);
  const flinch = propFlinchOffset(hit, u);
  const ox = hit ? -hit.nx * flinch : 0;
  const oy = hit ? -hit.ny * flinch : 0;

  ctx.save();
  if (ox !== 0 || oy !== 0) ctx.translate(ox, oy);

  // 1. Temas & Yönlü zemin gölgesi — her zaman en altta.
  contactShadow(ctx, x, y, w, h, u, mass);

  // 2. Alt Gövde / 3B Ön Duvar (Koyu Taban)
  ctx.fillStyle = style.fill;
  pathRoundRect(ctx, x, y, w, h, r);
  ctx.fill();

  // 2b. Ön duvarı açık üst yüzeyden ayıran 3B gövde gölgesi (front face shading)
  ctx.save();
  pathRoundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = shadowRgba(0.28);
  ctx.fillRect(x, y + h - depth, w, depth);
  // Taban temas oklüzyonu (en alt 35% koyulaştırma)
  ctx.fillStyle = shadowRgba(0.36);
  ctx.fillRect(x, y + h - depth * 0.45, w, depth * 0.45);
  ctx.restore();

  // 3. Üst Yüzey (Açık Ton Işık Yüzü)
  if (h > depth * 1.35) {
    ctx.fillStyle = style.top;
    pathRoundRect(ctx, x, y, w, h - depth, [r, r, Math.max(1, r * 0.35), Math.max(1, r * 0.35)]);
    ctx.fill();

    // Üst & Sol kenar Speküler Işık Pahı (Key Light -45° vuruşu — tek birleşik yol)
    ctx.strokeStyle = style.bevel || lightRgba(0.75);
    ctx.lineWidth = Math.max(1.2, 1.6 * u);
    ctx.beginPath();
    ctx.moveTo(x + 1.2 * u, y + h - depth - r);
    ctx.lineTo(x + 1.2 * u, y + 1.2 * u);
    ctx.lineTo(x + w - r, y + 1.2 * u);
    ctx.stroke();

    // Ön yüz kırılma çizgisi (2.5D üst yüzey ile ön duvar ayrım pahı)
    ctx.strokeStyle = style.bevel || lightRgba(0.6);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(1, 1.2 * u);
    ctx.beginPath();
    ctx.moveTo(x + border, y + h - depth);
    ctx.lineTo(x + w - border, y + h - depth);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 5. Deri detayı (taş gözenek, tahta koli X'i, platin şerit)
  if (style.detail) style.detail(ctx, x, y, w, h, u, style);

  // 6. Dış Kontur (temiz, okunaklı sınır)
  ctx.strokeStyle = style.edge;
  ctx.lineWidth = border;
  pathRoundRect(ctx, x, y, w, h, r);
  ctx.stroke();

  // 7. Darbe izi (Faz 5): çatlaklar ve talaş kıymıkları
  if (hit) drawPropCracks(ctx, hit, obs, u, style);

  ctx.restore();
}

// Ortak power-up rozeti: havada süzülen 2.5D madalyon + reaktif zemin gölgesi + renkli zemin aurası + vektör ikon.
export function drawPickup(ctx, pk, opts = {}) {
  const meta = PICKUP_META[pk.type] || { label: '★', icon: 'star', glyph: '⭐', color: '#FFD700', ink: '#241C15' };
  const color = opts.color || meta.color;
  const glyph = opts.glyph || meta.glyph || '⭐';
  const iconKey = meta.icon || glyph;
  const half = (opts.size || (pk.radius ? pk.radius * 2 : 28)) / 2;
  const u = Math.max(0.6, half / 14);

  const animTime = Number(pk.animTime || 0);
  const pulse = 1 + Math.sin(animTime * 5.5) * 0.04;
  const hoverPhase = (Math.sin(animTime * 4.2) + 1) / 2; // 0..1
  const hoverY = -hoverPhase * (3.2 * u); // yukarı süzülme

  ctx.save();
  ctx.translate(pk.x, pk.y);

  // 1. ZEMİN REAKTİF GÖLGESİ (Madalyon yükseldikçe gölge hafifçe küçülür ve solar)
  const shadowR = half * (0.95 - hoverPhase * 0.12);
  const shadowRy = shadowR * 0.42;
  const shadowY = 4.2 * u;

  // 1a. Renkli Zemin Işık Havuzu (Ground Glow)
  if (fxGlowEnabled()) {
    ctx.beginPath();
    ctx.ellipse(0, shadowY, shadowR * 1.45, shadowRy * 1.45, 0, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.18 + hoverPhase * 0.08;
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // 1b. Zemin Temas Gölgesi
  ctx.beginPath();
  ctx.ellipse(0, shadowY, shadowR, shadowRy, 0, 0, Math.PI * 2);
  ctx.fillStyle = shadowRgba(0.38 - hoverPhase * 0.12);
  ctx.fill();

  // 2. HAVADA SÜZÜLEN 2.5D MADALYON GÖVDESİ
  ctx.translate(0, hoverY);
  ctx.scale(pulse, pulse);

  // 2a. Madalyon 3B Kenar Kalınlığı (Jeton Ön Cephesi / Coin Extrusion)
  const coinRim = Math.max(1.8, 2.6 * u);
  ctx.beginPath();
  ctx.ellipse(0, coinRim, half, half * 0.92, 0, 0, Math.PI * 2);
  ctx.fillStyle = meta.ink || shadowRgba(0.85);
  ctx.fill();

  // 2b. Canlı Renkli Madalyon Üst Yüzeyi
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 2c. Üst-Sol Speküler Işık Pahı (-45° Key Light Vuruşu)
  ctx.strokeStyle = lightRgba(0.75);
  ctx.lineWidth = Math.max(1.2, 1.5 * u);
  ctx.beginPath();
  ctx.arc(0, 0, half - 1.2 * u, Math.PI * 0.85, Math.PI * 1.85);
  ctx.stroke();

  // 2d. Üst Parlaklık / Cam Şıklığı (Gloss)
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(-half * 0.22, -half * 0.32, half * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = lightRgba(0.32);
  ctx.fill();
  ctx.restore();

  // 2e. Madalyon Dış Çerçevesi
  ctx.beginPath();
  ctx.arc(0, 0, half, 0, Math.PI * 2);
  ctx.strokeStyle = meta.ink || shadowRgba(0.85);
  ctx.lineWidth = Math.max(1.8, 2.2 * u);
  ctx.stroke();

  // 2f. İç Vektör İkonu (Lucide Standart) veya Fallback Glif
  if (hasTabletopIcon(iconKey)) {
    drawTabletopIcon(ctx, iconKey, 0, 0, Math.round(half * 1.25), {
      color: meta.ink || '#241C15',
      strokeWidth: 2.6,
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
