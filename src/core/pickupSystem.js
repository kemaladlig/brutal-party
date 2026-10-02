/**
 * pickupSystem.js — Shared tactical pickup spawning, collection & effect registry.
 * Part of Phase 4 Architecture Refactor.
 */

import { playItemPickup } from '../audio.js';
import { pointBlocked } from './physics2d.js';
import { PICKUP_CATALOG, EFFECTS, availablePickupTypes } from './pickupCatalog.js';

// Toplama davranışları TEK kaynak `core/pickupCatalog.js`'tedir (görsel +
// davranış + gereksinim aynı kayıtta). Geriye-uyum için buradan yeniden dışa
// verilir; `collectPickups` doğrudan katalogdan okur.
export { EFFECTS };

/**
 * Spawns a tactical pickup into game.pickups array if max capacity is not reached.
 *
 * `strict: true` verilirse `types` listesi oyunun KARŞILADIĞI tiplere indirilir
 * (`pickupCatalog.requires`) — desteklenmeyen tip hiç doğmaz, sessiz no-op olmaz.
 * Varsayılan `false`: mevcut oyunların spawn davranışı birebir korunur.
 */
export function spawnPickup(game, opts = {}) {
  const {
    types = ['TURBO', 'TELEPORT', 'SLIP'],
    max = 2,
    size = 15,
    obstacles = game.pillars || game.obstacles || [],
    pad = 20,
    strict = false,
  } = opts;

  if (!game.pickups) game.pickups = [];
  if (game.pickups.length >= max) return null;

  const pool = strict ? availablePickupTypes(types, game) : types;
  if (!pool.length) return null;

  const type = pool[Math.floor(Math.random() * pool.length)];
  const left = game.arena.left || 0;
  const top = game.arena.top || 0;
  const right = game.arena.right || (left + (game.arena.width || 400));
  const bottom = game.arena.bottom || (top + (game.arena.height || 400));
  const w = right - left;
  const h = bottom - top;
  const marginX = w * 0.15;
  const marginY = h * 0.15;

  for (let tries = 0; tries < 8; tries++) {
    const px = left + marginX + Math.random() * (w - marginX * 2);
    const py = top + marginY + Math.random() * (h - marginY * 2);

    if (pointBlocked(px, py, obstacles, pad)) continue;

    // Optional check: avoid spawning too close to players
    if (game.players) {
      let nearPlayer = false;
      for (const p of game.players) {
        if (p.isJoined && Math.hypot(p.x - px, p.y - py) < 60) {
          nearPlayer = true;
          break;
        }
      }
      if (nearPlayer) continue;
    }

    const item = {
      x: px,
      y: py,
      type,
      radius: size,
      size,
      animTime: 0,
      life: opts.life || 14.0,
      phase: Math.random() * Math.PI * 2,
    };
    game.pickups.push(item);
    return item;
  }
  return null;
}

/**
 * Checks and collects pickups near player, triggering sound and effect callback.
 */
export function collectPickups(game, player, opts = {}) {
  if (!game.pickups || !game.pickups.length) return;
  const radius = opts.radiusOf ? opts.radiusOf(player) : (player.radius || 15);

  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const item = game.pickups[i];
    const dist = Math.hypot(player.x - item.x, player.y - item.y);
    const itemRadius = item.radius || item.size || 15;

    if (dist < radius + itemRadius) {
      playItemPickup();
      if (opts.onCollect) {
        opts.onCollect(game, player, item);
      } else {
        PICKUP_CATALOG[item.type]?.effect?.(game, player, item);
      }
      game.pickups.splice(i, 1);
    }
  }
}

/**
 * Ticks pickup animation, lifetime, and spawn timers.
 */
export function tickPickupTimers(game, dt) {
  if (!game.pickups) return;
  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const p = game.pickups[i];
    p.animTime += dt;
    if (p.life !== undefined) {
      p.life -= dt;
      if (p.life <= 0) {
        game.pickups.splice(i, 1);
      }
    }
  }
}
