// Ortak arena görsel kiti — engeller ve power-up rozetleri tek yerden.
// Motorlar kendi buildMap()/spawn mantığını tutar; sadece ÇİZİM buradan gelir.
// Yeni pickup tipi ekle: PICKUP_META'ya 1 satır yaz, motorlar otomatik görür.

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
