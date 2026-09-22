/**
 * pickupSystem.js — Shared tactical pickup spawning, collection & effect registry.
 * Part of Phase 4 Architecture Refactor.
 */

import { playItemPickup, playPowerUp, playTeleport, playSlip, playDashWhoosh } from '../audio.js';
import { pointBlocked } from './physics2d.js';

/**
 * Pickup effect registry for various power-ups across mini-games.
 */
export const EFFECTS = {
  TURBO: (game, p) => {
    p.turboTimer = 3.5;
    playPowerUp();
  },
  FAST: (game, p) => {
    p.fastTimer = 8.0;
    playPowerUp();
  },
  TELEPORT: (game, p) => {
    const { left, right, top, bottom, size } = game.arena;
    const pad = size * 0.16;
    const corners = [
      { x: left + pad, y: top + pad },
      { x: right - pad, y: top + pad },
      { x: left + pad, y: bottom - pad },
      { x: right - pad, y: bottom - pad },
    ];
    // Find corner furthest from current position or bomb carrier
    const refPos = (game.bombCarrierIndex !== undefined && game.players[game.bombCarrierIndex])
      ? game.players[game.bombCarrierIndex]
      : p;
    let bestCorner = corners[0];
    let maxDist = -1;
    for (const c of corners) {
      const d = Math.hypot(c.x - refPos.x, c.y - refPos.y);
      if (d > maxDist) {
        maxDist = d;
        bestCorner = c;
      }
    }
    p.x = bestCorner.x;
    p.y = bestCorner.y;
    playTeleport();
  },
  SLIP: (game, p) => {
    if (game.inkPuddles) {
      game.inkPuddles.push({
        x: p.x,
        y: p.y,
        radius: 22,
        duration: 10.0,
      });
    } else {
      p.slipTimer = 0.55;
      playDashWhoosh();
    }
  },
  MULTI: (game, p) => {
    p.multiShots = (p.multiShots || 0) + 3;
    playPowerUp();
  },
  QUICKDRAW: (game, p) => {
    p.quickdrawTimer = 8.0;
    playPowerUp();
  },
  SHIELD: (game, p) => {
    p.shield = p.shield ? (typeof p.shield === 'number' ? p.shield + 1 : true) : true;
    playPowerUp();
  },
  HEAL: (game, p) => {
    if (p.hp !== undefined) p.hp = Math.min((game.maxHp || 3) + 1, p.hp + 1);
  },
  TRIPLE: (game, p) => {
    p.tripleTimer = 8.0;
    playPowerUp();
  },
  GHOST: (game, p) => {
    p.ghostTimer = 4.0;
    playPowerUp();
  },
  SUPER_JUMP: (game, p) => {
    p.superJumpTimer = 6.0;
    playPowerUp();
  },
  REPAIR_TILES: (game, p) => {
    if (game.repairGrid) game.repairGrid(p);
    playPowerUp();
  },
  BLAST_WAVE: (game, p) => {
    if (game.triggerBlastWave) game.triggerBlastWave(p);
    playPowerUp();
  },
  APPLE: (game, p) => {
    if (p.grow) p.grow(3);
    playItemPickup();
  },
};

/**
 * Spawns a tactical pickup into game.pickups array if max capacity is not reached.
 */
export function spawnPickup(game, opts = {}) {
  const {
    types = ['TURBO', 'TELEPORT', 'SLIP'],
    max = 2,
    size = 15,
    obstacles = game.pillars || game.obstacles || [],
    pad = 20,
  } = opts;

  if (!game.pickups) game.pickups = [];
  if (game.pickups.length >= max) return null;

  const type = types[Math.floor(Math.random() * types.length)];
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
      } else if (EFFECTS[item.type]) {
        EFFECTS[item.type](game, player, item);
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
