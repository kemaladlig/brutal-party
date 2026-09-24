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

/**
 * Builds preset map obstacle layouts for games.
 * @param {string} name - Layout preset name ('pillars' | 'cross' | 'scatter' | 'bunker' | 'courtyard' | 'split')
 * @param {Object} arena - Arena geometry object { cx, cy, size }
 * @returns {Array<Object>} List of obstacle rect objects { x, y, w, h, mover? }
 */
export function buildLayout(name, arena) {
  const { cx, cy, size } = arena;
  if (!size || size <= 0) return [];

  const layoutName = (name || 'pillars').toLowerCase();

  if (layoutName === 'cross') {
    const armL = size * 0.26;
    const armT = size * 0.055;
    return [
      { x: cx - armL - armT / 2, y: cy - armT / 2, w: armL * 0.85, h: armT },
      { x: cx + armT / 2, y: cy - armT / 2, w: armL * 0.85, h: armT },
      { x: cx - armT / 2, y: cy - armL - armT / 2, w: armT, h: armL * 0.85 },
      { x: cx - armT / 2, y: cy + armT / 2, w: armT, h: armL * 0.85 },
      { x: cx - armT * 1.4, y: cy - armT * 1.4, w: armT * 2.8, h: armT * 2.8 },
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
export function drawObstacle(ctx, obs, opts = {}) {
  const style = OBSTACLE_STYLES[opts.variant || 'stone'] || OBSTACLE_STYLES.stone;
  const { x, y, w, h } = obs;
  ctx.save();

  ctx.fillStyle = '#1A1A1A';
  ctx.fillRect(x + 5, y + 5, w, h);

  ctx.fillStyle = style.fill;
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);

  ctx.strokeStyle = style.bevel;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 6, y + 6, w - 12, h - 12);

  if (w >= 24 && h >= 24) {
    ctx.fillStyle = style.inner;
    const r = 3;
    for (const [rx, ry] of [[x + 8, y + 8], [x + w - 8, y + 8], [x + 8, y + h - 8], [x + w - 8, y + h - 8]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, Math.PI * 2);
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
