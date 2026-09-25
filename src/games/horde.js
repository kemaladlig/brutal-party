// BRUTAL HORDE — 1-4 oyunculu takım hayatta-kalma oyunu.
// Host authority: fizik, AI, wave ve terminal durumlar yalnız bu motorda ilerler.

import { playDashWhoosh, playExplosion, playJoin, playShoot, playStart, playStumble } from '../audio.js';
import { t } from '../i18n.js';
import { getBotPersona, getSlotCustomization } from '../core/customizationManager.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { getSecondActionKey, readSlotKeys } from '../core/inputMaps.js';
import { clampToArena, getProjectileSubsteps, normalizeAngle, segmentCircleIntersection } from '../core/physics2d.js';
import { createPlayer, tickEffectTimers } from '../core/playerEntity.js';
import { collectPickups, spawnPickup, tickPickupTimers } from '../core/pickupSystem.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { updateHordeBotAI } from '../ai/hordeAI.js';
import {
  HORDE_VIEW_LIMITS,
  createHordeWorldPacket,
  drawHordeParticles,
  drawHordeStatus,
  drawHordeWorld,
  mapHordeScene,
} from './hordeView.js';

export const HORDE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2D6A4F'];

export const HORDE_TUNING = Object.freeze({
  ROUNDS: 3,
  WAVES_PER_ROUND: 3,
  MAX_HP: 5,
  PLAYER_RADIUS: 16,
  MOVE_SPEED: 190,
  FAST_MULT: 1.42,
  FIRE_INTERVAL: 0.28,
  SHOT_SPEED: 520,
  SHOT_DAMAGE: 1,
  SHOT_LIFE: 1.35,
  ENEMY_SHOT_SPEED: 270,
  DASH_TIME: 0.24,
  DASH_SPEED_MULT: 2.65,
  DASH_CD: 4,
  SPAWN_PROTECT: 2,
  HIT_INVULN: 0.6,
  REVIVE_TIME: 3,
  REVIVE_RADIUS: 44,
  PORTAL_TIME: 3,
  PORTAL_RADIUS: 44,
  WAVE_LIMIT: 90,
  PICKUP_EVERY: 10,
  PICKUP_MAX: 3,
  MAX_ENEMIES: HORDE_VIEW_LIMITS.enemies,
  MAX_PROJECTILES: 96,
});

const ENEMY_BASE = Object.freeze({
  chaser: { hp: 3, radius: 16, speed: 112, damage: 1, attackEvery: 0.95 },
  shooter: { hp: 2, radius: 14, speed: 78, damage: 1, attackEvery: 1.55 },
  tank: { hp: 8, radius: 21, speed: 44, damage: 2, attackEvery: 1.8 },
  healer: { hp: 5, radius: 18, speed: 68, damage: 0, attackEvery: 3.2 },
});

const BOSS_BASE = Object.freeze({
  chaser: { hp: 45, radius: 32, speed: 104, damage: 2, attackEvery: 0.8 },
  shooter: { hp: 32, radius: 28, speed: 76, damage: 2, attackEvery: 1.15 },
  tank: { hp: 70, radius: 39, speed: 40, damage: 3, attackEvery: 1.45 },
  healer: { hp: 40, radius: 31, speed: 66, damage: 1, attackEvery: 2.6 },
});

function isBot(player) {
  return player?.slotType === 'bot_normal' || player?.slotType === 'bot_god';
}

function distanceSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export class HordeGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'empty', 'empty', 'empty'];
    this.minPlayersToStart = 1;
    this.players = [];
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.tombs = [];
    this.particles = [];
    this.floatingTexts = [];
    this.portal = null;
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.roundId = 0;
    this.waveTimer = HORDE_TUNING.WAVE_LIMIT;
    this.waveTimedOut = false;
    this.isBossWave = false;
    this.pickupTimer = HORDE_TUNING.PICKUP_EVERY;
    this.matchResult = null;
    this.matchWinner = null;
    this.roundWinner = null;
    this.matchDraw = false;
    this.lastTime = performance.now();
    this._nextEnemyId = 1;
    this._nextProjectileId = 1;

    this.initPlayers();
    this.bindStandardKeyboard();
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('HORDE'),
      joystick: true,
      actions: [
        { id: 'fire', icon: 'crosshair', hold: true },
        { id: 'dash', icon: 'zap', cooldownField: 'dashCooldown', maxCooldown: HORDE_TUNING.DASH_CD },
      ],
    };
  }

  assertTabletopParity() {
    return super.assertTabletopParity('HORDE');
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((index) => {
      const existing = this.players[index];
      const custom = getSlotCustomization(index);
      const slotType = this.slotTypes[index] || 'empty';
      const bot = slotType === 'bot_normal' || slotType === 'bot_god';
      const persona = bot ? getBotPersona(index, slotType === 'bot_god') : null;
      const spawn = this.spawnPoint(index);
      const player = createPlayer(index, spawn, {
        radius: HORDE_TUNING.PLAYER_RADIUS,
        speed: HORDE_TUNING.MOVE_SPEED,
        baseSpeed: HORDE_TUNING.MOVE_SPEED,
        isJoined: slotType !== 'empty',
        isAlive: slotType !== 'empty',
        slotType,
        existingName: existing?.name || (bot ? persona.name : `P${index + 1}`),
        expression: existing?.expression || custom.expression,
        accessory: existing?.accessory || (bot ? persona.accessory : custom.accessory),
        pattern: existing?.pattern || (bot ? persona.pattern : custom.pattern),
        avatar: existing?.avatar || custom,
      });
      player.name = existing?.name || (bot ? persona.name : `P${index + 1}`);
      player.color = bot ? persona.color : (existing?.color || custom.color || HORDE_COLORS[index]);
      player.hp = HORDE_TUNING.MAX_HP;
      player.steerX = 0;
      player.steerY = 0;
      player.targetAngle = spawn.angle;
      player.angle = spawn.angle;
      player.isAiming = false;
      player.remoteFireHeld = false;
      player.localFireHeld = false;
      player.keyDashLatch = false;
      player.botCheckTimer = Math.random() * 0.2;
      player.botRetarget = Math.random() * 0.5;
      player.botStrafeDir = Math.random() < 0.5 ? -1 : 1;
      player.attackCooldown = 0.15;
      return player;
    });
  }

  spawnPoint(index) {
    const size = Math.max(120, this.arena.size || 640);
    const angle = index * Math.PI / 2 + Math.PI / 4;
    const distance = size * 0.14;
    return {
      x: this.arena.cx + Math.cos(angle) * distance,
      y: this.arena.cy + Math.sin(angle) * distance,
      angle,
    };
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const marginX = Math.max(16, Math.floor(width * 0.04));
    const marginY = height > width ? Math.max(54, Math.floor(height * 0.12)) : Math.max(34, Math.floor(height * 0.07));
    const arenaWidth = Math.max(120, width - marginX * 2);
    const arenaHeight = Math.max(120, height - marginY * 2);
    this.arena = {
      cx: width / 2,
      cy: height / 2,
      width: arenaWidth,
      height: arenaHeight,
      size: Math.min(arenaWidth, arenaHeight),
      left: marginX,
      right: marginX + arenaWidth,
      top: marginY,
      bottom: marginY + arenaHeight,
    };

    if (this.state === 'LOBBY' || this.players.length === 0) {
      this.initPlayers();
      return;
    }

    for (const player of this.players) {
      this.remapPoint(player, oldArena, this.arena);
      clampToArena(player, player.radius, this.arena);
    }
    for (const enemy of this.enemies) {
      this.remapPoint(enemy, oldArena, this.arena);
      clampToArena(enemy, enemy.radius, this.arena);
    }
    for (const projectile of this.projectiles) {
      this.remapPoint(projectile, oldArena, this.arena);
      clampToArena(projectile, projectile.radius, this.arena);
    }
    for (const pickup of this.pickups) {
      this.remapPoint(pickup, oldArena, this.arena);
      clampToArena(pickup, pickup.radius || 15, this.arena);
    }
    for (const tomb of this.tombs) {
      this.remapPoint(tomb, oldArena, this.arena);
    }
    if (this.portal) {
      this.remapPoint(this.portal, oldArena, this.arena);
      this.portal.x = Math.max(this.arena.left + this.portal.radius, Math.min(this.arena.right - this.portal.radius, this.portal.x));
      this.portal.y = Math.max(this.arena.top + this.portal.radius, Math.min(this.arena.bottom - this.portal.radius, this.portal.y));
    }
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.roundId = 0;
    this.waveTimer = HORDE_TUNING.WAVE_LIMIT;
    this.waveTimedOut = false;
    this.isBossWave = false;
    this.pickupTimer = HORDE_TUNING.PICKUP_EVERY;
    this.matchResult = null;
    this.matchWinner = null;
    this.roundWinner = null;
    this.matchDraw = false;
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.tombs = [];
    this.particles = [];
    this.floatingTexts = [];
    this.portal = null;
    this._nextEnemyId = 1;
    this._nextProjectileId = 1;
    this.onTouchesReset();
    this.initPlayers();
    this.lastTime = performance.now();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.syncJoinedPlayers();
    if (this.getActivePlayerCount() < this.minPlayersToStart) {
      this.state = 'LOBBY';
      return;
    }
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.roundId += 1;
    this.matchResult = null;
    this.matchWinner = null;
    this.roundWinner = null;
    this.matchDraw = false;
    this.tombs = [];
    this.onTouchesReset();
    this.resetPlayersForMatch();
    this.startNewRound();
    playStart();
  }

  startNewRound() {
    if (this.getActivePlayerCount() < this.minPlayersToStart) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'PLAYING';
    this.startWave();
  }

  startWave() {
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.portal = null;
    this.waveTimer = HORDE_TUNING.WAVE_LIMIT;
    this.waveTimedOut = false;
    this.pickupTimer = HORDE_TUNING.PICKUP_EVERY;
    this.isBossWave = this.round === HORDE_TUNING.ROUNDS && this.wave === HORDE_TUNING.WAVES_PER_ROUND;
    this.spawnWave();
  }

  resetPlayersForMatch() {
    for (const player of this.players) {
      const spawn = this.spawnPoint(player.index);
      player.x = spawn.x;
      player.y = spawn.y;
      player.angle = spawn.angle;
      player.targetAngle = spawn.angle;
      player.steerX = 0;
      player.steerY = 0;
      player.isAlive = player.isJoined;
      player.hp = HORDE_TUNING.MAX_HP;
      player.invulnTimer = player.isJoined ? HORDE_TUNING.SPAWN_PROTECT : 0;
      player.spawnProt = 0;
      player.dashCooldown = 0;
      player.dashTimer = 0;
      player.isDashing = false;
      player.fastTimer = 0;
      player.tripleTimer = 0;
      player.shield = false;
      player.attackCooldown = 0.15;
      player.isAiming = false;
      player.remoteFireHeld = false;
      player.localFireHeld = false;
      player.keyDashLatch = false;
    }
  }

  syncJoinedPlayers() {
    for (let i = 0; i < 4; i++) {
      const player = this.players[i];
      if (!player) continue;
      player.isJoined = this.isSlotJoined(i);
      player.slotType = this.slotTypes[i];
      if (player.isJoined) this.applyLocalSeatColor(i, player.color);
    }
  }

  spawnWave() {
    const playerCount = Math.max(1, this.players.filter((player) => player.isJoined).length);
    if (this.isBossWave) {
      for (const type of ['chaser', 'shooter', 'tank', 'healer']) {
        const enemy = this.createEnemy(type, true, playerCount);
        const point = this.randomEdgePoint(enemy.radius + 8);
        enemy.x = point.x;
        enemy.y = point.y;
        this.enemies.push(enemy);
      }
      return;
    }

    const rawCount = (this.wave + this.round * 2) * playerCount;
    const count = Math.min(HORDE_TUNING.MAX_ENEMIES, rawCount);
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      const type = roll < 0.3 ? 'shooter' : roll < 0.52 ? 'tank' : 'chaser';
      const enemy = this.createEnemy(type, false, playerCount);
      const point = this.randomEdgePoint(enemy.radius + 8);
      enemy.x = point.x;
      enemy.y = point.y;
      this.enemies.push(enemy);
    }
  }

  createEnemy(type, boss, playerCount) {
    const base = boss ? BOSS_BASE[type] : ENEMY_BASE[type];
    const hpScale = boss ? 1 + Math.max(0, playerCount - 1) * 0.18 : 1 + Math.max(0, playerCount - 1) * 0.12;
    const hp = Math.max(1, Math.round(base.hp * hpScale));
    return {
      id: this._nextEnemyId++,
      type,
      isBoss: boss,
      x: this.arena.cx,
      y: this.arena.cy,
      vx: 0,
      vy: 0,
      radius: base.radius,
      speed: base.speed,
      hp,
      maxHp: hp,
      damage: base.damage,
      attackEvery: base.attackEvery,
      attackTimer: 0.45 + Math.random() * base.attackEvery,
      healTimer: boss && type === 'healer' ? 1.5 : Infinity,
      angle: 0,
      hitTimer: 0,
    };
  }

  randomEdgePoint(margin = 40) {
    const side = Math.floor(Math.random() * 4);
    const minX = this.arena.left + margin;
    const maxX = this.arena.right - margin;
    const minY = this.arena.top + margin;
    const maxY = this.arena.bottom - margin;
    let point = { x: this.arena.cx, y: this.arena.cy };
    if (side === 0) point = { x: minX + Math.random() * (maxX - minX), y: minY };
    else if (side === 1) point = { x: maxX, y: minY + Math.random() * (maxY - minY) };
    else if (side === 2) point = { x: minX + Math.random() * (maxX - minX), y: maxY };
    else point = { x: minX, y: minY + Math.random() * (maxY - minY) };

    for (let attempt = 0; attempt < 6; attempt++) {
      const tooClose = this.players.some((player) => player.isJoined && distanceSq(player.x, player.y, point.x, point.y) < 150 * 150);
      if (!tooClose) break;
      point.x = this.arena.left + margin + Math.random() * Math.max(1, this.arena.width - margin * 2);
      point.y = this.arena.top + margin + Math.random() * Math.max(1, this.arena.height - margin * 2);
    }
    return point;
  }

  get alivePlayers() {
    return this.players.filter((player) => player.isJoined && player.isAlive);
  }

  update(now) {
    const timestamp = Number.isFinite(Number(now)) ? Number(now) : performance.now();
    const dt = Math.max(0, Math.min((timestamp - this.lastTime) / 1000, 0.08));
    this.lastTime = timestamp;
    this.updateTrauma(dt);
    if (this.state !== 'PLAYING') return;

    let alivePlayers = this.alivePlayers;
    if (alivePlayers.length === 0) {
      this.endMatch(false, 'all-dead');
      return;
    }

    if (!this.portal && this.enemies.length > 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.waveTimer = 0;
        this.forceClearWave();
      }
    }

    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = HORDE_TUNING.PICKUP_EVERY;
      spawnPickup(this, {
        types: ['HEAL', 'SHIELD', 'FAST', 'TRIPLE'],
        max: HORDE_TUNING.PICKUP_MAX,
        size: 30,
        pad: 24,
      });
    }
    tickPickupTimers(this, dt);

    for (const player of this.players) {
      if (!player.isJoined) continue;
      tickEffectTimers(player, dt);
      if (player.attackCooldown > 0) player.attackCooldown = Math.max(0, player.attackCooldown - dt);
      if (!player.isAlive) {
        player.steerX = 0;
        player.steerY = 0;
        player.isAiming = false;
        continue;
      }

      if (isBot(player)) updateHordeBotAI(this, player, dt);
      else this.updateHumanInput(player, dt);

      const angleDiff = normalizeAngle((player.targetAngle || 0) - player.angle);
      player.angle += angleDiff * Math.min(1, dt * 16);
      if (player.isAiming && player.attackCooldown <= 0) this.firePlayer(player);

      const speed = HORDE_TUNING.MOVE_SPEED
        * (player.fastTimer > 0 ? HORDE_TUNING.FAST_MULT : 1)
        * (player.dashTimer > 0 ? HORDE_TUNING.DASH_SPEED_MULT : 1);
      player.x += player.steerX * speed * dt;
      player.y += player.steerY * speed * dt;
      clampToArena(player, player.radius, this.arena);

      collectPickups(this, player, {
        radiusOf: () => player.radius,
        onCollect: (game, collector, pickup) => this.applyPickup(collector, pickup),
      });
    }

    alivePlayers = this.alivePlayers;
    if (alivePlayers.length === 0) {
      this.endMatch(false, 'all-dead');
      return;
    }

    this.updateEnemies(dt, alivePlayers);
    if (this.state !== 'PLAYING') return;
    this.updateProjectiles(dt);
    if (this.state !== 'PLAYING') return;
    this.updateTombs(dt, this.alivePlayers);
    if (this.state !== 'PLAYING') return;
    this.updatePortal(dt, this.alivePlayers);
    this.updateEffects(dt);
  }

  updateHumanInput(player, dt) {
    const movement = this.getPlayerMovementVector(player.index);
    const magnitude = Math.hypot(movement.x, movement.y);
    if (magnitude > 0.05) {
      player.steerX = movement.x;
      player.steerY = movement.y;
      player.targetAngle = Math.atan2(movement.y, movement.x);
    } else {
      player.steerX = 0;
      player.steerY = 0;
    }

    const keyboard = readSlotKeys(this.keys, player.index);
    player.isAiming = player.remoteFireHeld || player.localFireHeld || keyboard.action;
    const dashKey = getSecondActionKey('dash', player.index);
    const dashPressed = !!dashKey && !!this.keys[dashKey];
    if (dashPressed && !player.keyDashLatch) {
      this.triggerDash(player.index);
      player.keyDashLatch = true;
    } else if (!dashPressed) {
      player.keyDashLatch = false;
    }
  }

  triggerDash(index) {
    const player = this.players[index];
    if (this.state !== 'PLAYING' || !player?.isJoined || !player.isAlive || player.dashCooldown > 0) return false;
    if (Math.hypot(player.steerX, player.steerY) <= 0.1) return false;
    player.dashCooldown = HORDE_TUNING.DASH_CD;
    player.dashTimer = HORDE_TUNING.DASH_TIME;
    player.isDashing = true;
    playDashWhoosh();
    return true;
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player?.isJoined || !player.isAlive) return;
    if (actionId === 'fire') {
      player.localFireHeld = isDown;
      player.isAiming = isDown;
    } else if (actionId === 'dash' && isDown) {
      this.triggerDash(slotIndex);
    }
  }

  firePlayer(player) {
    if (this.state !== 'PLAYING' || !player?.isAlive || player.attackCooldown > 0) return;
    const angles = player.tripleTimer > 0
      ? [player.angle - 0.24, player.angle, player.angle + 0.24]
      : [player.angle];
    const speed = HORDE_TUNING.SHOT_SPEED * (player.fastTimer > 0 ? HORDE_TUNING.FAST_MULT : 1);
    for (const angle of angles) {
      this.addProjectile({
        owner: player.index,
        isEnemy: false,
        x: player.x + Math.cos(angle) * 20,
        y: player.y + Math.sin(angle) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: player.tripleTimer > 0 ? 5 : 7,
        damage: HORDE_TUNING.SHOT_DAMAGE,
        life: HORDE_TUNING.SHOT_LIFE,
        color: player.color,
      });
    }
    player.attackCooldown = player.tripleTimer > 0
      ? HORDE_TUNING.FIRE_INTERVAL * 1.15
      : HORDE_TUNING.FIRE_INTERVAL;
    playShoot();
  }

  addProjectile(projectile) {
    if (this.projectiles.length >= HORDE_TUNING.MAX_PROJECTILES) this.projectiles.shift();
    this.projectiles.push({
      id: this._nextProjectileId++,
      life: HORDE_TUNING.SHOT_LIFE,
      ...projectile,
    });
  }

  applyPickup(player, pickup) {
    if (pickup.type === 'HEAL') {
      player.hp = Math.min(HORDE_TUNING.MAX_HP, player.hp + 1);
      this.spawnFloatingText(player.x, player.y - 22, t('horde.heal'), '#2D6A4F');
    } else if (pickup.type === 'SHIELD') {
      player.shield = true;
      this.spawnFloatingText(player.x, player.y - 22, t('horde.shield'), '#0891B2');
    } else if (pickup.type === 'FAST') {
      player.fastTimer = 8;
      this.spawnFloatingText(player.x, player.y - 22, t('horde.fast'), '#CA8A04');
    } else if (pickup.type === 'TRIPLE') {
      player.tripleTimer = 8;
      this.spawnFloatingText(player.x, player.y - 22, t('horde.triple'), '#DC2626');
    }
  }

  updateEnemies(dt, alivePlayers) {
    for (const enemy of this.enemies) {
      enemy.hitTimer = Math.max(0, enemy.hitTimer - dt);
      enemy.attackTimer -= dt;
      enemy.healTimer -= dt;
      let target = null;
      let minDistanceSq = Infinity;
      for (const player of alivePlayers) {
        const d2 = distanceSq(enemy.x, enemy.y, player.x, player.y);
        if (d2 < minDistanceSq) {
          minDistanceSq = d2;
          target = player;
        }
      }
      if (!target) continue;

      const dx = target.x - enemy.x;
      const dy = target.y - enemy.y;
      const distance = Math.hypot(dx, dy) || 1;
      const nx = dx / distance;
      const ny = dy / distance;
      enemy.angle = Math.atan2(dy, dx);
      let moveMultiplier = 1;
      if (enemy.type === 'shooter' && distance < 165) moveMultiplier = -0.8;
      else if (enemy.type === 'shooter' && distance <= 270) moveMultiplier = 0;
      else if (enemy.type === 'healer' && distance < 245) moveMultiplier = -0.65;
      enemy.x += nx * enemy.speed * moveMultiplier * dt;
      enemy.y += ny * enemy.speed * moveMultiplier * dt;

      if (enemy.type === 'healer' && enemy.healTimer <= 0) {
        enemy.healTimer = enemy.isBoss ? 3 : 5;
        for (const ally of this.enemies) {
          if (ally === enemy || ally.hp >= ally.maxHp || distanceSq(enemy.x, enemy.y, ally.x, ally.y) > 170 * 170) continue;
          ally.hp = Math.min(ally.maxHp, ally.hp + 2);
          ally.hitTimer = 0.12;
        }
      }

      if (enemy.attackTimer <= 0) {
        if (enemy.type === 'shooter' && distance < 350) {
          this.fireEnemyProjectile(enemy, enemy.angle, enemy.damage, '#E63946');
          enemy.attackTimer = enemy.attackEvery;
        } else if (enemy.type === 'healer' && distance < 380) {
          for (let i = 0; i < 6; i++) this.fireEnemyProjectile(enemy, enemy.angle + i * Math.PI / 3, 1, '#16A34A');
          enemy.attackTimer = enemy.attackEvery;
        } else if ((enemy.type === 'chaser' || enemy.type === 'tank') && distance < enemy.radius + target.radius + 6) {
          this.damagePlayer(target, enemy.damage);
          enemy.attackTimer = enemy.attackEvery;
          if (this.state !== 'PLAYING') return;
        }
      }
      clampToArena(enemy, enemy.radius, this.arena);
    }
    this.separateEnemies();
  }

  fireEnemyProjectile(enemy, angle, damage, color) {
    this.addProjectile({
      owner: enemy.id,
      isEnemy: true,
      x: enemy.x + Math.cos(angle) * (enemy.radius + 6),
      y: enemy.y + Math.sin(angle) * (enemy.radius + 6),
      vx: Math.cos(angle) * HORDE_TUNING.ENEMY_SHOT_SPEED,
      vy: Math.sin(angle) * HORDE_TUNING.ENEMY_SHOT_SPEED,
      radius: enemy.isBoss ? 8 : 6,
      damage,
      life: 3,
      color,
    });
  }

  separateEnemies() {
    for (let i = 0; i < this.enemies.length; i++) {
      const a = this.enemies[i];
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minimum = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minimum * minimum) continue;
        const distance = Math.sqrt(d2) || 0.001;
        const overlap = (minimum - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        clampToArena(a, a.radius, this.arena);
        clampToArena(b, b.radius, this.arena);
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const steps = getProjectileSubsteps(Math.hypot(projectile.vx, projectile.vy) * dt, 8);
      let hit = false;
      for (let step = 0; step < steps && !hit; step++) {
        const subDt = dt / steps;
        const fromX = projectile.x;
        const fromY = projectile.y;
        projectile.x += projectile.vx * subDt;
        projectile.y += projectile.vy * subDt;

        if (projectile.isEnemy) {
          for (const player of this.alivePlayers) {
            if (player.invulnTimer > 0 || player.spawnProt > 0 || player.dashTimer > 0) continue;
            if (segmentCircleIntersection(fromX, fromY, projectile.x, projectile.y, player.x, player.y, player.radius + projectile.radius)) {
              this.damagePlayer(player, projectile.damage);
              hit = true;
              break;
            }
          }
        } else {
          for (const enemy of this.enemies) {
            if (segmentCircleIntersection(fromX, fromY, projectile.x, projectile.y, enemy.x, enemy.y, enemy.radius + projectile.radius)) {
              this.damageEnemy(enemy, projectile.damage, projectile.owner);
              hit = true;
              break;
            }
          }
        }
        if (this.state !== 'PLAYING') return;
      }

      projectile.life -= dt;
      if (
        hit || projectile.life <= 0 || projectile.x < this.arena.left || projectile.x > this.arena.right
        || projectile.y < this.arena.top || projectile.y > this.arena.bottom
      ) {
        this.projectiles.splice(i, 1);
      }
      if (this.state !== 'PLAYING') return;
    }
  }

  damageEnemy(enemy, damage, ownerIndex) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.hp -= damage;
    enemy.hitTimer = 0.1;
    if (enemy.hp > 0) return;
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) this.enemies.splice(index, 1);
    const owner = this.players[ownerIndex];
    if (owner) this.scores[owner.index] += enemy.isBoss ? 3 : 1;
    this.spawnParticles(enemy.x, enemy.y, enemy.isBoss ? '#FACC15' : '#E63946', enemy.isBoss ? 22 : 9);
    this.spawnFloatingText(enemy.x, enemy.y - enemy.radius, enemy.isBoss ? `+${enemy.isBoss ? 3 : 1}` : `+1`, owner?.color || '#D84727');
    this.addTrauma(enemy.isBoss ? 0.55 : 0.16);
    playExplosion();
  }

  damagePlayer(player, damage) {
    if (this.state !== 'PLAYING' || !player?.isAlive) return false;
    if (player.invulnTimer > 0 || player.spawnProt > 0 || player.dashTimer > 0) return false;
    if (player.shield) {
      player.shield = false;
      player.invulnTimer = 0.4;
      this.spawnFloatingText(player.x, player.y - 22, t('horde.blocked'), '#0891B2');
      return true;
    }
    player.hp -= Math.max(1, damage || 1);
    player.invulnTimer = HORDE_TUNING.HIT_INVULN;
    this.spawnParticles(player.x, player.y, player.color, 7);
    playStumble();
    if (player.hp <= 0) {
      player.hp = 0;
      player.isAlive = false;
      player.isAiming = false;
      player.steerX = 0;
      player.steerY = 0;
      this.tombs.push({ x: player.x, y: player.y, ownerIndex: player.index, timer: 0 });
      this.spawnFloatingText(player.x, player.y - 24, t('horde.down'), '#DC2626');
      if (this.alivePlayers.length === 0) this.endMatch(false, 'all-dead');
    }
    return true;
  }

  updateTombs(dt, alivePlayers) {
    for (let i = this.tombs.length - 1; i >= 0; i--) {
      const tomb = this.tombs[i];
      const reviving = alivePlayers.some((player) => distanceSq(player.x, player.y, tomb.x, tomb.y) <= HORDE_TUNING.REVIVE_RADIUS ** 2);
      if (reviving) tomb.timer += dt;
      else tomb.timer = Math.max(0, tomb.timer - dt * 1.5);
      if (tomb.timer < HORDE_TUNING.REVIVE_TIME) continue;

      const player = this.players[tomb.ownerIndex];
      if (player) {
        player.isAlive = true;
        player.hp = HORDE_TUNING.MAX_HP;
        player.x = tomb.x;
        player.y = tomb.y;
        player.invulnTimer = HORDE_TUNING.SPAWN_PROTECT;
        player.attackCooldown = 0.2;
        player.isAiming = false;
        this.spawnFloatingText(player.x, player.y - 24, t('horde.revived'), '#2D6A4F');
        playJoin();
      }
      this.tombs.splice(i, 1);
    }
  }

  updatePortal(dt, alivePlayers) {
    if (this.enemies.length === 0 && !this.portal) {
      this.portal = {
        x: this.arena.cx,
        y: this.arena.cy,
        radius: HORDE_TUNING.PORTAL_RADIUS,
        timer: 0,
      };
    }
    if (!this.portal || alivePlayers.length === 0) return;

    let inside = 0;
    for (const player of alivePlayers) {
      if (distanceSq(player.x, player.y, this.portal.x, this.portal.y) <= (this.portal.radius + player.radius * 0.35) ** 2) inside++;
    }
    if (inside === alivePlayers.length) this.portal.timer += dt;
    else this.portal.timer = Math.max(0, this.portal.timer - dt * 1.5);
    if (this.portal.timer < HORDE_TUNING.PORTAL_TIME) return;

    this.portal = null;
    if (this.round === HORDE_TUNING.ROUNDS && this.wave === HORDE_TUNING.WAVES_PER_ROUND) {
      this.endMatch(true, 'campaign-complete');
      return;
    }
    this.wave++;
    if (this.wave > HORDE_TUNING.WAVES_PER_ROUND) {
      this.wave = 1;
      this.round++;
      this.roundId += 1;
    }
    this.startWave();
  }

  forceClearWave() {
    this.waveTimedOut = true;
    this.enemies = [];
    this.projectiles = this.projectiles.filter((projectile) => !projectile.isEnemy);
    this.spawnFloatingText(this.arena.cx, this.arena.cy - 50, t('horde.waveSafe'), '#7C3AED');
  }

  endMatch(won, reason = won ? 'complete' : 'defeat') {
    if (this.state === 'MATCH_OVER') return;
    this.state = 'MATCH_OVER';
    this.matchResult = won ? 'win' : 'loss';
    this.matchWinner = null;
    this.roundWinner = null;
    this.matchDraw = false;
    this.matchResolutionReason = reason;
    this.portal = null;
    for (const player of this.players) {
      player.isAiming = false;
      player.localFireHeld = false;
      player.remoteFireHeld = false;
      player.steerX = 0;
      player.steerY = 0;
    }
  }

  spawnParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 35 + Math.random() * 150;
      const life = 0.25 + Math.random() * 0.35;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 2 + Math.random() * 3,
        color,
        life,
        maxLife: life,
      });
    }
    if (this.particles.length > HORDE_VIEW_LIMITS.particles * 2) {
      this.particles.splice(0, this.particles.length - HORDE_VIEW_LIMITS.particles * 2);
    }
  }

  spawnFloatingText(x, y, text, color) {
    this.floatingTexts.push({ x, y, text, color, vy: -28, alpha: 1, decay: 1.2 });
    if (this.floatingTexts.length > HORDE_VIEW_LIMITS.texts * 2) this.floatingTexts.shift();
  }

  updateEffects(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= Math.max(0, 1 - dt * 3.5);
      particle.vy *= Math.max(0, 1 - dt * 3.5);
      particle.life -= dt;
      if (particle.life <= 0) this.particles.splice(i, 1);
    }
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const entry = this.floatingTexts[i];
      entry.y += entry.vy * dt;
      entry.alpha -= entry.decay * dt;
      if (entry.alpha <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (this.state !== 'PLAYING' || !player?.isJoined || !player.isAlive || !data) return;
    if (data.action === 'JOYSTICK_MOVE') {
      const dx = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
      const dy = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : Math.hypot(dx, dy);
      player.remoteMoveActive = force > 0.05;
      player.steerX = dx;
      player.steerY = dy;
      if (player.remoteMoveActive && Number.isFinite(data.angle)) player.targetAngle = normalizeAngle(data.angle);
      const joy = this.joysticks[slotIndex];
      if (joy) {
        joy.active = player.remoteMoveActive;
        joy.angle = Number.isFinite(data.angle) ? data.angle : Math.atan2(dy, dx);
        joy.force = force;
      }
    } else if (data.action === 'HORDE_FIRE') {
      player.remoteFireHeld = true;
      player.isAiming = true;
    } else if (data.action === 'HORDE_FIRE_RELEASE') {
      player.remoteFireHeld = false;
      player.isAiming = false;
    } else if (data.action === 'DASH') {
      this.triggerDash(slotIndex);
    }
  }

  createWorldPacket() {
    return createHordeWorldPacket(this, HORDE_TUNING);
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch, { minJoined: this.minPlayersToStart })) return;
      lobbyQuadrantTap(this, touch, {
        onSeatChange: (index) => {
          const player = this.players[index];
          if (player) {
            player.isJoined = this.isSlotJoined(index);
            player.slotType = this.slotTypes[index];
            player.isAlive = player.isJoined;
          }
        },
      });
      playJoin();
      return;
    }
    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => this.startNewMatch() });
      return;
    }
    if (this.state === 'PLAYING') {
      if (this.handleUiTap(touch)) return;
      this.handleTabletopTouchStart(touch);
    }
  }

  onTouchMove(touch) {
    if (this.state === 'PLAYING') this.handleTabletopTouchMove(touch);
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
    for (const player of this.players || []) {
      player.steerX = 0;
      player.steerY = 0;
      player.isAiming = false;
      player.localFireHeld = false;
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    const scene = mapHordeScene(this, HORDE_TUNING);
    drawHordeWorld(ctx, this.arena, scene, { withFx: this.state === 'PLAYING' });
    drawHordeParticles(ctx, this.particles);
    drawHordeStatus(ctx, this.arena, scene);

    if (this.state === 'PLAYING') {
      this.renderControls(ctx, { extraEntities: this.enemies });
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.horde'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: HORDE_COLORS,
      accent: '#7C3AED',
      showScoreboard: false,
      matchOverHeadline: this.matchResult === 'win' ? t('horde.victory') : t('horde.defeat'),
      matchOverRows: this.players
        .filter((player) => player.isJoined)
        .sort((a, b) => this.scores[b.index] - this.scores[a.index])
        .map((player) => ({ color: player.color, text: `${player.name}: ${this.scores[player.index] || 0}` })),
      onRestart: () => this.startNewMatch(),
      onSeatChange: (index) => {
        const player = this.players[index];
        if (!player) return;
        player.isJoined = this.isSlotJoined(index);
        player.slotType = this.slotTypes[index];
        player.isAlive = player.isJoined;
        playJoin();
      },
    });
    ctx.restore();
  }
}
