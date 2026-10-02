// Power-up / pickup TEK katalog — görsel + davranış + gereksinim tek kayıtta.
//
// Eskiden aynı tip kimliği İKİ dosyaya dağılmıştı: görsel sözlük
// `arenaKit.PICKUP_META`, toplama davranışı `pickupSystem.EFFECTS`. Yeni bir
// power-up eklemek iki yeri senkronlamak demekti; bir oyunun desteklemediği tip
// sessizce no-op oluyordu (efekt var olmayan alana yazıyordu).
//
// Artık tek kayıt: `id → { visual?, effect?, requires? }`.
//   - `visual`   : `arenaKit.drawPickup` rozet sözlüğü. Yoksa `DEFAULT_PICKUP_VISUAL`.
//   - `effect(game, player, item)` : toplama anı davranışı. Yoksa öğe tüketilir,
//                  etki uygulanmaz (SCISSORS/INVERT gibi yalnız görsel/yönlendirmeli
//                  tipler; oyun kendi `onCollect`'ını verir).
//   - `requires(game)` : tipin oyunda ANLAMLI olması için gereken alanlar.
//                  `spawnPickup({ strict: true })` bunu sağlamayan tipleri atlar —
//                  sessiz no-op yerine tip hiç doğmaz.
//
// `PICKUP_META` ve `EFFECTS` geriye-uyum için buradan TÜRETİLİR (tek kaynak
// burasıdır); arenaKit ve pickupSystem bunları yeniden tanımlamaz.

import { playItemPickup, playPowerUp, playTeleport, playDashWhoosh } from '../audio.js';

/** Katalogda görseli olmayan tip için varsayılan rozet (eski fallback ile aynı). */
export const DEFAULT_PICKUP_VISUAL = Object.freeze({
  icon: 'star', color: '#FFD700', ink: '#241C15',
});

/** @type {Record<string, {visual?: any, effect?: (game:any,player:any,item?:any)=>void, requires?: (game:any)=>boolean}>} */
export const PICKUP_CATALOG = {
  // --- Hem görsel hem davranış ---
  TURBO: {
    visual: { label: 'TRB', icon: 'zap', color: '#FFB020', ink: '#241C15' },
    effect: (game, p) => { p.turboTimer = 3.5; playPowerUp(); },
  },
  FAST: {
    visual: { label: 'HIZ', icon: 'zap', color: '#FFB020', ink: '#241C15' },
    effect: (game, p) => { p.fastTimer = 8.0; playPowerUp(); },
  },
  TELEPORT: {
    visual: { label: 'TEL', icon: 'rotate-cw', color: '#2BA6E8', ink: '#081D2E' },
    requires: (game) => !!(game && game.arena),
    effect: (game, p) => {
      const { left, right, top, bottom, size } = game.arena;
      const pad = size * 0.16;
      const corners = [
        { x: left + pad, y: top + pad },
        { x: right - pad, y: top + pad },
        { x: left + pad, y: bottom - pad },
        { x: right - pad, y: bottom - pad },
      ];
      // En uzak köşe: bomba taşıyıcısı ya da oyuncunun kendisi referans.
      const refPos = (game.bombCarrierIndex !== undefined && game.players[game.bombCarrierIndex])
        ? game.players[game.bombCarrierIndex]
        : p;
      let bestCorner = corners[0];
      let maxDist = -1;
      for (const c of corners) {
        const d = Math.hypot(c.x - refPos.x, c.y - refPos.y);
        if (d > maxDist) { maxDist = d; bestCorner = c; }
      }
      p.x = bestCorner.x;
      p.y = bestCorner.y;
      playTeleport();
    },
  },
  SLIP: {
    visual: { label: 'KAY', icon: 'banana', color: '#FFD24A', ink: '#2E2203' },
    effect: (game, p) => {
      if (game.inkPuddles) {
        game.inkPuddles.push({ x: p.x, y: p.y, radius: 22, duration: 10.0 });
      } else {
        p.slipTimer = 0.55;
        playDashWhoosh();
      }
    },
  },
  MULTI: {
    visual: { label: '3OK', icon: 'crosshair', color: '#9B5DE5', ink: '#FFFFFF' },
    effect: (game, p) => { p.multiShots = (p.multiShots || 0) + 3; playPowerUp(); },
  },
  QUICKDRAW: {
    visual: { label: 'ÇEK', icon: 'target', color: '#FF8C1A', ink: '#2A1400' },
    effect: (game, p) => { p.quickdrawTimer = 8.0; playPowerUp(); },
  },
  SHIELD: {
    visual: { label: 'KLK', icon: 'shield', color: '#0EA5E9', ink: '#06283D' },
    effect: (game, p) => { p.shield = p.shield ? (typeof p.shield === 'number' ? p.shield + 1 : true) : true; playPowerUp(); },
  },
  TRIPLE: {
    visual: { label: '3×', icon: 'flame', color: '#E63946', ink: '#FFFFFF' },
    effect: (game, p) => { p.tripleTimer = 8.0; playPowerUp(); },
  },
  GHOST: {
    visual: { label: 'HAY', icon: 'ghost', color: '#94A3B8', ink: '#0F172A' },
    effect: (game, p) => { p.ghostTimer = 4.0; playPowerUp(); },
  },
  SUPER_JUMP: {
    visual: { label: 'ZIP', icon: 'chevrons-up', color: '#FFB020', ink: '#241C15' },
    effect: (game, p) => { p.superJumpTimer = 6.0; playPowerUp(); },
  },
  REPAIR_TILES: {
    visual: { label: 'TAM', icon: 'hammer', color: '#35B36A', ink: '#FFFFFF' },
    requires: (game) => typeof game?.repairGrid === 'function',
    effect: (game, p) => { if (game.repairGrid) game.repairGrid(p); playPowerUp(); },
  },
  // --- Yalnız davranış (görsel varsayılana düşer) ---
  HEAL: {
    requires: (game) => (game?.players || []).some((p) => p && p.hp !== undefined),
    effect: (game, p) => { if (p.hp !== undefined) p.hp = Math.min((game.maxHp || 3) + 1, p.hp + 1); },
  },
  BLAST_WAVE: {
    requires: (game) => typeof game?.triggerBlastWave === 'function',
    effect: (game, p) => { if (game.triggerBlastWave) game.triggerBlastWave(p); playPowerUp(); },
  },
  APPLE: {
    requires: (game) => (game?.players || []).some((p) => typeof p?.grow === 'function'),
    effect: (game, p) => { if (p.grow) p.grow(3); playItemPickup(); },
  },

  // --- Yalnız görsel (oyun kendi `onCollect`'ıyla işler) ---
  SPEED:        { visual: { label: 'HIZ', icon: 'zap', color: '#FFB020', ink: '#241C15' } },
  SCISSORS:     { visual: { label: 'KES', icon: 'scissors', color: '#F59E0B', ink: '#291800' } },
  INVERT:       { visual: { label: 'TERS', icon: 'rotate-ccw', color: '#A78BFA', ink: '#241442' } },
  SHRINK:       { visual: { label: 'KÜÇ', icon: 'search', color: '#38BDF8', ink: '#082F49' } },
  FREEZE:       { visual: { label: 'BUZ', icon: 'snowflake', color: '#38BDF8', ink: '#082F49' } },
  BOMB:         { visual: { label: 'PAT', icon: 'bomb', color: '#EF4444', ink: '#FFFFFF' } },
  THICK:        { visual: { label: 'KAL', icon: 'brick', color: '#A8A29E', ink: '#1C1917' } },
  WALL:         { visual: { label: 'DUV', icon: 'brick', color: '#F97316', ink: '#2A1400' } },
  SLOW:         { visual: { label: 'YAV', icon: 'hourglass', color: '#3B82F6', ink: '#FFFFFF' } },
  GOLDEN_STAR:  { visual: { label: 'YLD', icon: 'star', color: '#FFD700', ink: '#2A1E00' } },
  TURBO_BERRY:  { visual: { label: 'HIZ', icon: 'sparkles', color: '#F43F5E', ink: '#FFFFFF' } },
  FLASH:        { visual: { label: 'HIZ', icon: 'zap', color: '#FFD122', ink: '#241C15' } },
  SEISMIC:      { visual: { label: 'DAR', icon: 'flame', color: '#FF473A', ink: '#FFFFFF' } },
};

/** Görsel sözlük — `drawPickup` bunu okur (eski `PICKUP_META` API'si korunur). */
export const PICKUP_META = Object.fromEntries(
  Object.entries(PICKUP_CATALOG).map(([id, entry]) => [id, entry.visual || DEFAULT_PICKUP_VISUAL]),
);

/** Davranış sözlüğü — geriye-uyum için (eski `pickupSystem.EFFECTS` API'si). */
export const EFFECTS = Object.fromEntries(
  Object.entries(PICKUP_CATALOG)
    .filter(([, entry]) => typeof entry.effect === 'function')
    .map(([id, entry]) => [id, entry.effect]),
);

/** Tip oyunda anlamlı mı? (`requires` yoksa true.) */
export function pickupRequiresMet(id, game) {
  const req = PICKUP_CATALOG[id]?.requires;
  if (typeof req !== 'function') return true;
  try { return !!req(game); } catch { return false; }
}

/** `types` listesini oyunun karşıladığı tiplere indirger (sessiz no-op yerine eleme). */
export function availablePickupTypes(types, game) {
  return types.filter((id) => pickupRequiresMet(id, game));
}
