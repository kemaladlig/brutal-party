/**
 * playerEntity.js — Shared player entity creation, effect timers ticking & movement helpers.
 * Part of Phase 6 Architecture Refactor.
 */

import { getSlotCustomization } from './customizationManager.js';
import { clampToArena, resolveAABB } from './physics2d.js';

/**
 * Creates a standard player object with slot customization and initial state.
 * @param {number} i - Slot index (0..3)
 * @param {Object} spawn - { x, y, angle? }
 * @param {Object} [opts] - Additional options { defaultName, defaultColors, isJoined, slotType, radius, speed }
 * @returns {Object} Player entity
 */
export function createPlayer(i, spawn, opts = {}) {
  const {
    existingName,
    defaultColors = ['#D84727', '#2B5B84', '#D99B26', '#2D6A4F'],
    defaultNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'],
    radius = 18,
    speed = 175,
    baseSpeed = opts.baseSpeed || speed,
    isAlive = opts.isAlive !== undefined ? opts.isAlive : true,
    isJoined = opts.isJoined !== undefined ? opts.isJoined : true,
    slotType = 'human',
    ...extra
  } = opts;

  const custom = getSlotCustomization(i);
  const isBot = slotType === 'bot_normal' || slotType === 'bot_god';

  return {
    index: i,
    name: existingName || defaultNames[i] || `P${i + 1}`,
    color: isBot ? '#8E8E93' : custom.color || defaultColors[i],
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius,
    facingAngle: spawn.angle || 0,
    angle: spawn.angle || 0,
    speed,
    baseSpeed,
    isAlive,
    isJoined,
    slotType,

    // Standard effect timers
    turboTimer: 0,
    slipTimer: 0,
    slipAngle: 0,
    stun: 0,
    stumbleTimer: 0,
    invulnTimer: 0,
    spawnProt: 0,
    dashCooldown: 0,
    dashTimer: 0,
    isDashing: false,
    immunityTimer: 0,
    escapeBoostTimer: 0,
    fastTimer: 0,
    tripleTimer: 0,
    shield: false,

    ...extra,
  };
}

/**
 * Ticks down standard effect & action cooldown timers on player entity.
 * @param {Object} p - Player entity
 * @param {number} dt - Delta time in seconds
 */
export function tickEffectTimers(p, dt) {
  if (!p) return;
  if (p.turboTimer > 0) p.turboTimer = Math.max(0, p.turboTimer - dt);
  if (p.fastTimer > 0) p.fastTimer = Math.max(0, p.fastTimer - dt);
  if (p.tripleTimer > 0) p.tripleTimer = Math.max(0, p.tripleTimer - dt);
  if (p.stun > 0) p.stun = Math.max(0, p.stun - dt);
  if (p.stumbleTimer > 0) p.stumbleTimer = Math.max(0, p.stumbleTimer - dt);
  if (p.invulnTimer > 0) p.invulnTimer = Math.max(0, p.invulnTimer - dt);
  if (p.spawnProt > 0) p.spawnProt = Math.max(0, p.spawnProt - dt);
  if (p.immunityTimer > 0) p.immunityTimer = Math.max(0, p.immunityTimer - dt);
  if (p.escapeBoostTimer > 0) p.escapeBoostTimer = Math.max(0, p.escapeBoostTimer - dt);

  if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
  if (p.dashTimer > 0) {
    p.dashTimer = Math.max(0, p.dashTimer - dt);
    if (p.dashTimer === 0) p.isDashing = false;
  }

  if (p.slipTimer > 0) {
    p.slipTimer = Math.max(0, p.slipTimer - dt);
    p.slipAngle = (p.slipAngle || 0) + dt * 16.0;
  }
}

/**
 * Advances player movement using velocity, clamps to arena, and resolves obstacle collisions.
 * @param {Object} p - Player entity
 * @param {number} dt - Delta time in seconds
 * @param {Object} arena - Arena geometry
 * @param {Array<Object>} [obstacles=[]] - Obstacles list
 * @param {Object} [opts] - Options { zeroVelocity, radius }
 */
export function advancePlayer(p, dt, arena, obstacles = [], opts = {}) {
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  const r = opts.radius || p.radius || 18;
  clampToArena(p, r, arena, { zeroVelocity: opts.zeroVelocity });
  resolveAABB(p, obstacles, r);
  tickEffectTimers(p, dt);
}
