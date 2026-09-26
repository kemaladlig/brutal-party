// Ortak arena görsel kiti — engeller, layout oluşturma ve power-up rozetleri tek yerden.
// Motorlar buildLayout(name, arena) çağırabilir; ÇİZİM (drawObstacle, drawPickup) buradan gelir.

export const PICKUP_META = {
  TURBO:       { label: 'TRB', glyph: '⚡', color: '#FFDE59', ink: '#1C1C1A' },
  FAST:        { label: 'HIZ', glyph: '⚡', color: '#FFDE59', ink: '#1C1C1A' },
  SPEED:       { label: 'HIZ', glyph: '⚡', color: '#FFDE59', ink: '#1C1C1A' },
  TELEPORT:    { label: 'TEL', glyph: '🌀', color: '#48CAE4', ink: '#1C1C1A' },
  SLIP:        { label: 'KAY', glyph: '🍌', color: '#FCD34D', ink: '#1C1C1A' },
  MULTI:       { label: '3OK', glyph: '🎯', color: '#8B5CF6', ink: '#FFFFFF' },
  QUICKDRAW:   { label: 'ÇEK', glyph: '🏹', color: '#F97316', ink: '#1C1C1A' },
  SHIELD:      { label: 'KLK', glyph: '🛡️', color: '#06B6D4', ink: '#1C1C1A' },
  TRIPLE:      { label: '3×',  glyph: '💥', color: '#E63946', ink: '#FFFFFF' },
  SCISSORS:    { label: 'KES', glyph: '✂️', color: '#D99B26', ink: '#1C1C1A' },
  GHOST:       { label: 'HAY', glyph: '👻', color: '#94A3B8', ink: '#1C1C1A' },
  INVERT:      { label: 'TERS',glyph: '🔃', color: '#A78BFA', ink: '#1C1C1A' },
  SHRINK:      { label: 'KÜÇ', glyph: '🔍', color: '#38BDF8', ink: '#1C1C1A' },
  FREEZE:      { label: 'BUZ', glyph: '❄️', color: '#BAE6FD', ink: '#1C1C1A' },
  BOMB:        { label: 'PAT', glyph: '💣', color: '#EF4444', ink: '#FFFFFF' },
  THICK:       { label: 'KAL', glyph: '🧱', color: '#A8A29E', ink: '#1C1C1A' },
  WALL:        { label: 'DUV', glyph: '🧱', color: '#E59866', ink: '#1C1C1A' },
  SLOW:        { label: 'YAV', glyph: '🐢', color: '#3B82F6', ink: '#FFFFFF' },
  GOLDEN_STAR: { label: '★',   glyph: '⭐', color: '#FFD700', ink: '#1C1C1A' },
  TURBO_BERRY: { label: 'HIZ', glyph: '🍓', color: '#F43F5E', ink: '#FFFFFF' },
  FLASH:       { label: 'HIZ', glyph: '⚡', color: '#FFD122', ink: '#1C1C1A' },
  SEISMIC:     { label: 'DAR', glyph: '💥', color: '#FF473A', ink: '#FFFFFF' },
  SUPER_JUMP:  { label: 'ZIP', glyph: '🦘', color: '#FFDE59', ink: '#1C1C1A' },
  REPAIR_TILES:{ label: 'TAM', glyph: '🔨', color: '#2F6A4F', ink: '#FFFFFF' },
};

const OBSTACLE_STYLES = {
  stone: { fill: '#4A4440', bevel: 'rgba(255,255,255,0.22)', inner: '#2A2624' },
  dark:  { fill: '#1A1A1A', bevel: 'rgba(255,255,255,0.18)', inner: '#3A3A3A' },
  crate: { fill: '#8A6A3B', bevel: 'rgba(255,255,255,0.28)', inner: '#5C4526' },
};

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
    return [
      { x: cx - bW / 2, y: cy - size * 0.23 - bH / 2, w: bW, h: bH },
      { x: cx - bW / 2, y: cy + size * 0.23 - bH / 2, w: bW, h: bH },
      { x: cx - size * 0.23 - bH / 2, y: cy - bW / 2, w: bH, h: bW },
      { x: cx + size * 0.23 - bH / 2, y: cy - bW / 2, w: bH, h: bW },
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

// Neo-brutalist engel bloğu: sert gölge, düz dolgu, kalın kenar, iç bevel, perçinler.
//
// Krom ÖLÇEKLİDİR: 3px çerçeve / 5px gölge / 8px perçin iç boşluğu sabit
// yazılınca 41px'lik bir mobil bloğun silueti tamamen kroma ile yiyordu
// (telefonda blok, masaüstündeki 152px bloğun yarısı kadardı). `u` bloğun
// KENDİ boyutundan türetilir, yani sahadan ve cihazdan bağımsızdır: her
// boyutta aynı görsel oran.
export function drawObstacle(ctx, obs, opts = {}) {
  const style = OBSTACLE_STYLES[opts.variant || 'stone'] || OBSTACLE_STYLES.stone;
  const { x, y, w, h } = obs;
  // 48px referans: bu boyuttaki blokta krom tam olarak eski değerlere denk gelir.
  const u = Math.max(0.42, Math.min(1.5, Math.min(w, h) / 48));
  const shadow = 5 * u;
  const border = 3 * u;
  const bevelInset = 6 * u;
  const bevelWidth = 2 * u;
  const rivetInset = 8 * u;
  const rivetR = 3 * u;

  ctx.save();

  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(x + shadow, y + shadow, w, h);

  ctx.fillStyle = style.fill;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = border;
  ctx.strokeRect(x + border / 2, y + border / 2, w - border, h - border);

  // Bevel ve perçinler ancak blok onları taşıyacak kadar büyükse çizilir.
  if (w > bevelInset * 2 + bevelWidth * 2 && h > bevelInset * 2 + bevelWidth * 2) {
    ctx.strokeStyle = style.bevel;
    ctx.lineWidth = bevelWidth;
    ctx.strokeRect(x + bevelInset, y + bevelInset, w - bevelInset * 2, h - bevelInset * 2);
  }

  if (w > rivetInset * 2 + rivetR * 2 && h > rivetInset * 2 + rivetR * 2) {
    ctx.fillStyle = style.inner;
    for (const [rx, ry] of [
      [x + rivetInset, y + rivetInset],
      [x + w - rivetInset, y + rivetInset],
      [x + rivetInset, y + h - rivetInset],
      [x + w - rivetInset, y + h - rivetInset],
    ]) {
      ctx.beginPath();
      ctx.arc(rx, ry, rivetR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Ortak power-up rozeti: pulse + sert gölge + canlı ikon rozeti.
export function drawPickup(ctx, pk, opts = {}) {
  const meta = PICKUP_META[pk.type] || { label: '★', glyph: '⭐', color: '#FFDE59', ink: '#1C1C1A' };
  const color = opts.color || meta.color;
  const glyph = opts.glyph || meta.glyph || '⭐';
  const half = (opts.size || (pk.radius ? pk.radius * 2 : 28)) / 2;

  ctx.save();
  const pulse = 1 + Math.sin((pk.animTime || 0) * 6) * 0.08;
  ctx.translate(pk.x, pk.y);
  ctx.scale(pulse, pulse);

  // Sert Brutalist Gölge
  ctx.fillStyle = '#1C1C1A';
  ctx.fillRect(-half + 3, -half + 3, half * 2, half * 2);

  // Canlı Renkli Gövde
  ctx.fillStyle = color;
  ctx.fillRect(-half, -half, half * 2, half * 2);

  // Kalın Çerçeve
  ctx.strokeStyle = '#1C1C1A';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-half, -half, half * 2, half * 2);

  // İç İkon / Glif
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(13, Math.round(half * 1.22))}px sans-serif`;
  ctx.fillText(glyph, 0, 1);

  ctx.restore();
}
