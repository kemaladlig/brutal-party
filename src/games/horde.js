// BRUTAL HORDE — 1-4 oyunculu takım hayatta-kalma oyunu.
// Host authority: fizik, AI, wave ve terminal durumlar yalnız bu motorda ilerler.

import { playDashWhoosh, playExplosion, playJoin, playPaddleHit, playShoot, playStart, playStumble } from '../audio.js';
import { t } from '../i18n.js';
import { getBotPersona, getSlotCustomization } from '../core/customizationManager.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { buildLayout } from '../core/arenaKit.js';
import { getSecondActionKey, readSlotKeys } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import {
  clampToArena,
  getProjectileSubsteps,
  normalizeAngle,
  pointBlocked,
  resolveAABB,
  segmentAabbIntersection,
  segmentCircleIntersection,
} from '../core/physics2d.js';
import { createPlayer, tickEffectTimers } from '../core/playerEntity.js';
import { collectPickups, spawnPickup, tickPickupTimers } from '../core/pickupSystem.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { updateHordeBotAI } from '../ai/hordeAI.js';
import {
  HORDE_ARMORY_WEAPONS,
  HORDE_UPGRADES,
  HORDE_UPGRADE_IDS,
  getDashCooldown,
  getHordeMap,
  getPickupMagnet,
  getPlayerWeapon,
  getReloadTime,
  getReviveDuration,
} from './hordeConfig.js';
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
  WAVE_BREAK_TIME: 2.4,
  ROUND_BREAK_TIME: 15,
  LOADOUT_RADIUS: 34,
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
  chaser: { hp: 42, radius: 32, speed: 104, damage: 2, attackEvery: 0.8 },
  shooter: { hp: 30, radius: 28, speed: 76, damage: 2, attackEvery: 1.15 },
  tank: { hp: 62, radius: 39, speed: 40, damage: 3, attackEvery: 1.45 },
  healer: { hp: 36, radius: 31, speed: 66, damage: 1, attackEvery: 2.6 },
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
    this.obstacles = [];
    this.loadoutCrates = [];
    this.particles = [];
    this.floatingTexts = [];
    this.portal = null;
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.roundId = 0;
    this.waveTimer = HORDE_TUNING.WAVE_LIMIT;
    this.waveBreakTimer = 0;
    this.roundBreakTimer = 0;
    this.nextRound = 1;
    this.mapTheme = getHordeMap(1).id;
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
    this._nextLoadoutId = 1;

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
      player.maxHp = HORDE_TUNING.MAX_HP;
      player.hp = player.maxHp;
      player.weaponId = 'SIDEARM';
      player.magazine = getPlayerWeapon(player).magazine;
      player.ammo = player.magazine;
      player.reloadTimer = 0;
      player.weaponSwingTimer = 0;
      player.upgrades = {};
      player.loadoutChoiceCrateId = null;
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
    const oldObstacles = (this.obstacles || []).map((obstacle) => ({ ...obstacle }));
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
    this.buildMap();

    if (oldArena.width > 0 && oldObstacles.length === this.obstacles.length) {
      this.obstacles = this.obstacles.map((obstacle, index) => {
        const old = oldObstacles[index];
        const mapped = { x: obstacle.x, y: obstacle.y, w: obstacle.w, h: obstacle.h };
        this.remapPoint(mapped, oldArena, this.arena);
        return mapped;
      });
    }

    if (this.state === 'LOBBY' || this.players.length === 0) {
      this.initPlayers();
      return;
    }

    for (const player of this.players) {
      this.remapPoint(player, oldArena, this.arena);
      clampToArena(player, player.radius, this.arena);
      resolveAABB(player, this.obstacles, player.radius);
    }
    for (const enemy of this.enemies) {
      this.remapPoint(enemy, oldArena, this.arena);
      clampToArena(enemy, enemy.radius, this.arena);
      resolveAABB(enemy, this.obstacles, enemy.radius);
    }
    for (const projectile of this.projectiles) {
      this.remapPoint(projectile, oldArena, this.arena);
      clampToArena(projectile, projectile.radius, this.arena);
    }
    for (const pickup of this.pickups) {
      this.remapPoint(pickup, oldArena, this.arena);
      clampToArena(pickup, pickup.radius || 15, this.arena);
    }
    for (const crate of this.loadoutCrates) this.remapPoint(crate, oldArena, this.arena);
    for (const tomb of this.tombs) {
      this.remapPoint(tomb, oldArena, this.arena);
    }
    if (this.portal) {
      this.remapPoint(this.portal, oldArena, this.arena);
      this.portal.x = Math.max(this.arena.left + this.portal.radius, Math.min(this.arena.right - this.portal.radius, this.portal.x));
      this.portal.y = Math.max(this.arena.top + this.portal.radius, Math.min(this.arena.bottom - this.portal.radius, this.portal.y));
    }
  }

  buildMap(round = this.round) {
    const map = getHordeMap(round);
    this.mapTheme = map.id;
    this.obstacles = this.arena.size > 0 ? buildLayout(map.layout, this.arena) : [];
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.roundId = 0;
    this.waveTimer = HORDE_TUNING.WAVE_LIMIT;
    this.waveBreakTimer = 0;
    this.roundBreakTimer = 0;
    this.nextRound = 1;
    this.mapTheme = getHordeMap(1).id;
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
    this.buildMap(1);
    this.loadoutCrates = [];
    this.particles = [];
    this.floatingTexts = [];
    this.portal = null;
    this._nextEnemyId = 1;
    this._nextProjectileId = 1;
    this._nextLoadoutId = 1;
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
    this.loadoutCrates = [];
    this.nextRound = 1;
    this.waveBreakTimer = 0;
    this.roundBreakTimer = 0;
    this.buildMap(1);
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
    this.waveBreakTimer = 0;
    this.roundBreakTimer = 0;
    this.nextRound = this.round;
    this.mapTheme = getHordeMap(this.round).id;
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
      player.maxHp = HORDE_TUNING.MAX_HP;
      player.hp = player.maxHp;
      player.weaponId = 'SIDEARM';
      player.magazine = getPlayerWeapon(player).magazine;
      player.ammo = player.magazine;
      player.reloadTimer = 0;
      player.weaponSwingTimer = 0;
      player.upgrades = {};
      player.loadoutChoiceCrateId = null;
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
      ['chaser', 'shooter', 'tank', 'healer'].forEach((type, index) => {
        const enemy = this.createEnemy(type, true, playerCount, false);
        const point = this.randomEdgePoint(enemy.radius + 8);
        enemy.x = point.x;
        enemy.y = point.y;
        enemy.spawnDelay = 0.45 + index * 0.16;
        this.enemies.push(enemy);
      });
      return;
    }

    const rawCount = (this.wave + this.round * 2) * playerCount;
    const count = Math.min(HORDE_TUNING.MAX_ENEMIES, rawCount);
    const tankChance = this.round === 1 ? [0.04, 0.10, 0.20][this.wave - 1] : [0.18, 0.26, 0.32][this.wave - 1];
    const shooterChance = 0.26 + this.round * 0.025;
    const healerChance = this.round === 3 && this.wave >= 2 ? 0.08 : 0;
    const eliteChance = [0.02, 0.06, 0.12, 0.16, 0.22, 0.28, 0.32, 0.38, 0.44][(this.round - 1) * 3 + this.wave - 1];
    for (let i = 0; i < count; i++) {
      const roll = Math.random();
      let type = 'chaser';
      if (roll < healerChance) type = 'healer';
      else if (roll < healerChance + tankChance) type = 'tank';
      else if (roll < healerChance + tankChance + shooterChance) type = 'shooter';
      const elite = Math.random() < eliteChance;
      const enemy = this.createEnemy(type, false, playerCount, elite);
      const point = this.randomEdgePoint(enemy.radius + 8);
      enemy.x = point.x;
      enemy.y = point.y;
      enemy.spawnDelay = 0.35 + (i % 5) * 0.14 + Math.random() * 0.18;
      this.enemies.push(enemy);
    }
  }

  createEnemy(type, boss, playerCount, elite = false) {
    const base = boss ? BOSS_BASE[type] : ENEMY_BASE[type];
    const hpScale = boss ? 1 + Math.max(0, playerCount - 1) * 0.18 : 1 + Math.max(0, playerCount - 1) * 0.12;
    const eliteHp = elite ? 1.75 : 1;
    const hp = Math.max(1, Math.round(base.hp * hpScale * eliteHp));
    return {
      id: this._nextEnemyId++,
      type,
      isBoss: boss,
      elite,
      x: this.arena.cx,
      y: this.arena.cy,
      vx: 0,
      vy: 0,
      radius: base.radius * (elite ? 1.12 : 1),
      speed: base.speed * (elite ? 1.08 : 1),
      hp,
      maxHp: hp,
      damage: base.damage + (elite && base.damage > 0 ? 1 : 0),
      attackEvery: base.attackEvery * (elite ? 0.9 : 1),
      attackTimer: 0.45 + Math.random() * base.attackEvery,
      healTimer: type === 'healer' ? (boss ? 1.5 : 4.5) : Infinity,
      angle: 0,
      hitTimer: 0,
      spawnDelay: boss ? 0.5 : 0.4,
      lungeTimer: 0,
      lungeCooldown: 0.8 + Math.random() * 1.4,
      avoidDir: Math.random() < 0.5 ? -1 : 1,
      summonThresholds: boss ? [0.55, 0.3] : [],
      summonIndex: 0,
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

    for (let attempt = 0; attempt < 10; attempt++) {
      const tooClose = this.players.some((player) => player.isJoined && distanceSq(player.x, player.y, point.x, point.y) < 150 * 150);
      if (!tooClose && !pointBlocked(point.x, point.y, this.obstacles, margin * 0.65)) break;
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

    if (this.state === 'ROUND_PAUSE') {
      this.updateRoundBreak(dt);
      return;
    }
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
        obstacles: this.obstacles,
        size: 30,
        pad: 24,
      });
    }
    tickPickupTimers(this, dt);

    for (const player of this.players) this.updatePlayer(player, dt, true);

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

  updatePlayer(player, dt, allowFire) {
    if (!player?.isJoined) return;
    tickEffectTimers(player, dt);
    this.updatePlayerWeapon(player, dt);
    if (player.attackCooldown > 0) player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    if (!player.isAlive) {
      player.steerX = 0;
      player.steerY = 0;
      player.isAiming = false;
      return;
    }

    if (isBot(player)) updateHordeBotAI(this, player, dt);
    else this.updateHumanInput(player, dt, allowFire);

    const angleDiff = normalizeAngle((player.targetAngle || 0) - player.angle);
    player.angle += angleDiff * Math.min(1, dt * 16);
    if (allowFire && player.isAiming && player.attackCooldown <= 0) this.firePlayer(player);

    const speed = HORDE_TUNING.MOVE_SPEED
      * (player.fastTimer > 0 ? HORDE_TUNING.FAST_MULT : 1)
      * (player.dashTimer > 0 ? HORDE_TUNING.DASH_SPEED_MULT : 1);
    player.x += player.steerX * speed * dt;
    player.y += player.steerY * speed * dt;
    clampToArena(player, player.radius, this.arena);
    resolveAABB(player, this.obstacles, player.radius);

    const magnet = getPickupMagnet(player);
    collectPickups(this, player, {
      radiusOf: () => player.radius * magnet,
      onCollect: (game, collector, pickup) => this.applyPickup(collector, pickup),
    });
    if (this.state === 'ROUND_PAUSE') this.tryClaimLoadout(player);
  }

  updateRoundBreak(dt) {
    if (this.alivePlayers.length === 0) {
      this.endMatch(false, 'all-dead');
      return;
    }
    this.roundBreakTimer = Math.max(0, this.roundBreakTimer - dt);
    this.roundBreakElapsed = (Number(this.roundBreakElapsed) || 0) + dt;
    for (const player of this.players) {
      if (isBot(player) && player.isAlive && player.loadoutChoiceCrateId === null && this.roundBreakElapsed > 0.35) {
        this.chooseBotLoadout(player);
      }
      this.updatePlayer(player, dt, false);
    }
    this.updateEffects(dt);
    const everyoneChose = this.players
      .filter((player) => player.isJoined && player.isAlive)
      .every((player) => player.loadoutChoiceCrateId !== null);
    if (this.roundBreakTimer <= 0 || (everyoneChose && this.roundBreakElapsed >= 2.2)) {
      this.finalizeLoadoutChoices();
      this.startNextRound();
    }
  }

  updateHumanInput(player, dt, allowFire = true) {
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
    player.isAiming = allowFire && (player.remoteFireHeld || player.localFireHeld || keyboard.action);
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
    if (!['PLAYING', 'ROUND_PAUSE'].includes(this.state) || !player?.isJoined || !player.isAlive || player.dashCooldown > 0) return false;
    if (Math.hypot(player.steerX, player.steerY) <= 0.1) return false;
    player.dashCooldown = getDashCooldown(player, HORDE_TUNING.DASH_CD);
    player.dashTimer = HORDE_TUNING.DASH_TIME;
    player.isDashing = true;
    playDashWhoosh();
    return true;
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player?.isJoined || !player.isAlive) return;
    if (actionId === 'fire') {
      player.localFireHeld = isDown && this.state === 'PLAYING';
      player.isAiming = player.localFireHeld;
    } else if (actionId === 'dash' && isDown) {
      this.triggerDash(slotIndex);
    }
  }

  updatePlayerWeapon(player, dt) {
    if (player.weaponSwingTimer > 0) player.weaponSwingTimer = Math.max(0, player.weaponSwingTimer - dt);
    if (player.reloadTimer <= 0) return;
    player.reloadTimer = Math.max(0, player.reloadTimer - dt);
    if (player.reloadTimer === 0) {
      const weapon = getPlayerWeapon(player);
      player.ammo = Number.isFinite(weapon.magazine) ? weapon.magazine : -1;
    }
  }

  startReload(player) {
    const weapon = getPlayerWeapon(player);
    if (!Number.isFinite(weapon.magazine) || player.reloadTimer > 0) return;
    player.reloadTimer = Math.max(0.08, getReloadTime(player));
  }

  firePlayer(player) {
    if (this.state !== 'PLAYING' || !player?.isAlive || player.attackCooldown > 0 || player.reloadTimer > 0) return;
    const weapon = getPlayerWeapon(player);
    if (weapon.kind === 'melee') {
      this.fireBlade(player, weapon);
      return;
    }
    if (player.ammo <= 0) {
      this.startReload(player);
      return;
    }

    let pellets = weapon.pellets;
    if (player.tripleTimer > 0) pellets += 2;
    const speed = weapon.projectileSpeed * (player.fastTimer > 0 ? 1.12 : 1);
    for (let i = 0; i < pellets; i++) {
      const spread = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * weapon.spread * 2;
      const angle = player.angle + spread + (Math.random() - 0.5) * weapon.spread * 0.35;
      this.addProjectile({
        owner: player.index,
        isEnemy: false,
        x: player.x + Math.cos(angle) * 20,
        y: player.y + Math.sin(angle) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: weapon.id === 'RIFLE' ? 5 : weapon.id === 'SHOTGUN' ? 4 : 6,
        damage: weapon.damage,
        life: weapon.range / speed,
        color: weapon.color,
        knockback: weapon.knockback,
        pierce: weapon.pierce,
      });
    }
    player.ammo -= 1;
    player.attackCooldown = weapon.fireInterval * (player.fastTimer > 0 ? 0.88 : 1);
    playShoot();
    if (player.ammo <= 0) this.startReload(player);
  }

  fireBlade(player, weapon) {
    player.weaponSwingTimer = 0.2;
    player.attackCooldown = weapon.fireInterval;
    let hitAny = false;
    for (const enemy of this.enemies) {
      if (enemy.spawnDelay > 0) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > weapon.range + enemy.radius) continue;
      const angle = Math.atan2(dy, dx);
      if (Math.abs(normalizeAngle(angle - player.angle)) > weapon.arc * 0.5) continue;
      if (this.hasBlockedShot(player.x, player.y, enemy.x, enemy.y)) continue;
      this.damageEnemy(enemy, weapon.damage, player.index, weapon.knockback, dx, dy, distance);
      hitAny = true;
    }
    if (hitAny) this.addTrauma(0.2);
    playPaddleHit(0.75);
  }

  hasBlockedShot(x1, y1, x2, y2) {
    return this.obstacles.some((obstacle) => segmentAabbIntersection(x1, y1, x2, y2, obstacle, 1));
  }

  addProjectile(projectile) {
    if (this.projectiles.length >= HORDE_TUNING.MAX_PROJECTILES) this.projectiles.shift();
    this.projectiles.push({
      id: this._nextProjectileId++,
      ...projectile,
    });
  }

  applyPickup(player, pickup) {
    if (pickup.type === 'HEAL') {
      player.hp = Math.min(player.maxHp, player.hp + 1);
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

  generateLoadoutCrates() {
    const pool = [...HORDE_ARMORY_WEAPONS];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const weaponIds = pool.slice(0, 3);
    const upgradeId = HORDE_UPGRADE_IDS[Math.floor(Math.random() * HORDE_UPGRADE_IDS.length)];
    const positions = [
      { x: -0.24, y: -0.17 },
      { x: 0.24, y: -0.17 },
      { x: -0.24, y: 0.17 },
      { x: 0.24, y: 0.17 },
    ];
    this.loadoutCrates = [];
    weaponIds.forEach((weaponId, index) => {
      const weapon = getPlayerWeapon({ weaponId });
      this.loadoutCrates.push({
        id: this._nextLoadoutId++,
        kind: 'weapon',
        weaponId,
        upgradeId: null,
        color: weapon.color,
        claimedBy: null,
        ...this.loadoutPosition(positions[index]),
      });
    });
    const upgrade = HORDE_UPGRADES[upgradeId];
    this.loadoutCrates.push({
      id: this._nextLoadoutId++,
      kind: 'upgrade',
      weaponId: null,
      upgradeId,
      color: upgrade.color,
      claimedBy: null,
      ...this.loadoutPosition(positions[3]),
    });
  }

  loadoutPosition(offset) {
    const size = Math.max(120, this.arena.size || 640);
    const candidates = [
      { x: this.arena.cx + offset.x * size, y: this.arena.cy + offset.y * size },
      ...Array.from({ length: 8 }, (_, index) => {
        const angle = index * Math.PI / 4;
        return {
          x: this.arena.cx + Math.cos(angle) * size * 0.27,
          y: this.arena.cy + Math.sin(angle) * size * 0.27,
        };
      }),
      { x: this.arena.cx, y: this.arena.cy },
    ];
    const point = candidates.find((candidate) => !pointBlocked(candidate.x, candidate.y, this.obstacles, 48)) || candidates[candidates.length - 1];
    return { x: point.x, y: point.y, radius: HORDE_TUNING.LOADOUT_RADIUS };
  }

  tryClaimLoadout(player) {
    if (!player?.isAlive || player.loadoutChoiceCrateId !== null) return;
    for (const crate of this.loadoutCrates) {
      if (crate.claimedBy !== null) continue;
      if (distanceSq(player.x, player.y, crate.x, crate.y) > (HORDE_TUNING.LOADOUT_RADIUS + player.radius) ** 2) continue;
      crate.claimedBy = player.index;
      player.loadoutChoiceCrateId = crate.id;
      if (crate.kind === 'weapon') {
        player.weaponId = crate.weaponId;
        player.magazine = getPlayerWeapon(player).magazine;
      player.ammo = player.magazine;
        player.reloadTimer = 0;
        this.spawnFloatingText(player.x, player.y - 24, t(`horde.weapon.${crate.weaponId}`), crate.color);
      } else {
        this.applyLoadoutUpgrade(player, crate.upgradeId);
      }
      return;
    }
  }

  applyLoadoutUpgrade(player, upgradeId) {
    player.upgrades[upgradeId] = (player.upgrades[upgradeId] || 0) + 1;
    if (upgradeId === 'ARMOR') {
      player.maxHp += 1;
      player.hp += 1;
    }
    const meta = HORDE_UPGRADES[upgradeId];
    this.spawnFloatingText(player.x, player.y - 24, t(`horde.upgrade.${upgradeId}`), meta?.color || '#7C3AED');
  }

  chooseBotLoadout(bot) {
    const available = this.loadoutCrates.filter((crate) => crate.claimedBy === null);
    if (available.length === 0) return;
    const wantsUpgrade = bot.hp / Math.max(1, bot.maxHp) < 0.55;
    const crate = available.find((entry) => wantsUpgrade && entry.kind === 'upgrade') || available[0];
    crate.claimedBy = bot.index;
    bot.loadoutChoiceCrateId = crate.id;
    if (crate.kind === 'weapon') {
      bot.weaponId = crate.weaponId;
      bot.magazine = getPlayerWeapon(bot).magazine;
      bot.ammo = bot.magazine;
      bot.reloadTimer = 0;
    } else {
      this.applyLoadoutUpgrade(bot, crate.upgradeId);
    }
  }

  finalizeLoadoutChoices() {
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive || player.loadoutChoiceCrateId !== null) continue;
      const weaponCrate = this.loadoutCrates.find((crate) => crate.kind === 'weapon' && crate.claimedBy === null);
      if (!weaponCrate) continue;
      weaponCrate.claimedBy = player.index;
      player.loadoutChoiceCrateId = weaponCrate.id;
      player.weaponId = weaponCrate.weaponId;
      player.magazine = getPlayerWeapon(player).magazine;
      player.ammo = player.magazine;
      player.reloadTimer = 0;
    }
  }

  updateEnemies(dt, alivePlayers) {
    for (const enemy of this.enemies) {
      if (enemy.spawnDelay > 0) {
        enemy.spawnDelay = Math.max(0, enemy.spawnDelay - dt);
        continue;
      }
      enemy.hitTimer = Math.max(0, enemy.hitTimer - dt);
      enemy.attackTimer -= dt;
      enemy.healTimer -= dt;
      enemy.lungeTimer = Math.max(0, enemy.lungeTimer - dt);
      enemy.lungeCooldown = Math.max(0, enemy.lungeCooldown - dt);
      this.maybeSummonBossAdds(enemy);
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
      if (enemy.elite && enemy.type === 'chaser' && enemy.lungeCooldown <= 0 && distance > 100 && distance < 280) {
        enemy.lungeTimer = 0.42;
        enemy.lungeCooldown = 2.8;
      }
      const moveSpeed = enemy.speed * (enemy.lungeTimer > 0 ? 2.2 : 1);
      const blockedAhead = pointBlocked(
        enemy.x + nx * (enemy.radius + 28),
        enemy.y + ny * (enemy.radius + 28),
        this.obstacles,
        enemy.radius,
      );
      const strafe = blockedAhead ? enemy.avoidDir * 0.95 : 0;
      if (blockedAhead && Math.random() < dt * 0.8) enemy.avoidDir *= -1;
      let moveX = nx * moveMultiplier - ny * strafe;
      let moveY = ny * moveMultiplier + nx * strafe;
      const moveLength = Math.hypot(moveX, moveY) || 1;
      enemy.x += (moveX / moveLength) * moveSpeed * dt;
      enemy.y += (moveY / moveLength) * moveSpeed * dt;

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
          if (enemy.elite) {
            for (const offset of [-0.16, 0, 0.16]) this.fireEnemyProjectile(enemy, enemy.angle + offset, enemy.damage, '#E63946');
          } else {
            this.fireEnemyProjectile(enemy, enemy.angle, enemy.damage, '#E63946');
          }
          enemy.attackTimer = enemy.attackEvery;
        } else if (enemy.type === 'healer' && distance < 380) {
          const shots = enemy.isBoss ? 6 : 5;
          for (let i = 0; i < shots; i++) this.fireEnemyProjectile(enemy, enemy.angle + i * Math.PI * 2 / shots, 1, '#16A34A');
          enemy.attackTimer = enemy.attackEvery;
        } else if ((enemy.type === 'chaser' || enemy.type === 'tank') && distance < enemy.radius + target.radius + 6) {
          this.damagePlayer(target, enemy.damage);
          enemy.attackTimer = enemy.attackEvery;
          if (this.state !== 'PLAYING') return;
        }
      }
      clampToArena(enemy, enemy.radius, this.arena);
      resolveAABB(enemy, this.obstacles, enemy.radius);
    }
    this.separateEnemies();
    this.separatePlayersFromEnemies();
  }

  separatePlayersFromEnemies() {
    for (const player of this.alivePlayers) {
      for (const enemy of this.enemies) {
        if (enemy.spawnDelay > 0) continue;
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const minimum = player.radius + enemy.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= minimum * minimum) continue;
        const distance = Math.sqrt(d2) || 0.001;
        const overlap = minimum - distance;
        const nx = dx / distance;
        const ny = dy / distance;
        player.x += nx * overlap * 0.35;
        player.y += ny * overlap * 0.35;
        enemy.x -= nx * overlap * 0.65;
        enemy.y -= ny * overlap * 0.65;
        clampToArena(player, player.radius, this.arena);
        clampToArena(enemy, enemy.radius, this.arena);
        resolveAABB(player, this.obstacles, player.radius);
        resolveAABB(enemy, this.obstacles, enemy.radius);
      }
    }
  }

  maybeSummonBossAdds(boss) {
    if (!boss?.isBoss) return;
    const ratio = boss.hp / boss.maxHp;
    const threshold = boss.summonThresholds[boss.summonIndex];
    if (threshold === undefined || ratio > threshold) return;
    boss.summonIndex += 1;
    for (let i = 0; i < 2 && this.enemies.length < HORDE_TUNING.MAX_ENEMIES; i++) {
      const add = this.createEnemy(i === 0 ? 'shooter' : 'chaser', false, 1, true);
      const point = this.randomEdgePoint(add.radius + 8);
      add.x = point.x;
      add.y = point.y;
      add.spawnDelay = 0.35 + i * 0.2;
      this.enemies.push(add);
    }
    this.spawnFloatingText(boss.x, boss.y - boss.radius, t('horde.bossSummon'), '#FACC15');
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
      if (a.spawnDelay > 0) continue;
      for (let j = i + 1; j < this.enemies.length; j++) {
        const b = this.enemies[j];
        if (b.spawnDelay > 0) continue;
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
        resolveAABB(a, this.obstacles, a.radius);
        resolveAABB(b, this.obstacles, b.radius);
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const projectile = this.projectiles[i];
      const steps = getProjectileSubsteps(Math.hypot(projectile.vx, projectile.vy) * dt, 8);
      let consumed = false;
      for (let step = 0; step < steps && !consumed; step++) {
        const subDt = dt / steps;
        const fromX = projectile.x;
        const fromY = projectile.y;
        projectile.x += projectile.vx * subDt;
        projectile.y += projectile.vy * subDt;

        let obstacleHit = null;
        for (const obstacle of this.obstacles) {
          const intersection = segmentAabbIntersection(fromX, fromY, projectile.x, projectile.y, obstacle, projectile.radius);
          if (intersection) {
            obstacleHit = intersection;
            break;
          }
        }
        if (obstacleHit) {
          projectile.x = obstacleHit.x;
          projectile.y = obstacleHit.y;
          this.spawnParticles(projectile.x, projectile.y, projectile.color || '#1A1A1A', 4);
          consumed = true;
          break;
        }

        if (projectile.isEnemy) {
          for (const player of this.alivePlayers) {
            if (player.invulnTimer > 0 || player.spawnProt > 0 || player.dashTimer > 0) continue;
            if (segmentCircleIntersection(fromX, fromY, projectile.x, projectile.y, player.x, player.y, player.radius + projectile.radius)) {
              this.damagePlayer(player, projectile.damage);
              consumed = true;
              break;
            }
          }
        } else {
          for (const enemy of this.enemies) {
            if (enemy.spawnDelay > 0) continue;
            if (!segmentCircleIntersection(fromX, fromY, projectile.x, projectile.y, enemy.x, enemy.y, enemy.radius + projectile.radius)) continue;
            this.damageEnemy(
              enemy,
              projectile.damage,
              projectile.owner,
              projectile.knockback || 0,
              projectile.vx,
              projectile.vy,
              Math.hypot(projectile.vx, projectile.vy) || 1,
            );
            if ((Number(projectile.pierce) || 0) > 0) projectile.pierce -= 1;
            else {
              consumed = true;
              break;
            }
          }
        }
        if (this.state !== 'PLAYING') return;
      }

      projectile.life -= dt;
      if (
        consumed || projectile.life <= 0 || projectile.x < this.arena.left || projectile.x > this.arena.right
        || projectile.y < this.arena.top || projectile.y > this.arena.bottom
      ) {
        this.projectiles.splice(i, 1);
      }
      if (this.state !== 'PLAYING') return;
    }
  }

  damageEnemy(enemy, damage, ownerIndex, knockback = 0, dirX = 0, dirY = 0, projectileSpeed = 1) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.hp -= damage;
    enemy.hitTimer = 0.1;
    if (knockback > 0) {
      const magnitude = Math.max(1, projectileSpeed) || 1;
      enemy.x += (dirX / magnitude) * knockback;
      enemy.y += (dirY / magnitude) * knockback;
      clampToArena(enemy, enemy.radius, this.arena);
      resolveAABB(enemy, this.obstacles, enemy.radius);
    }
    if (enemy.hp > 0) return;
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) this.enemies.splice(index, 1);
    const owner = this.players[ownerIndex];
    const points = enemy.isBoss ? 3 : enemy.elite ? 2 : 1;
    if (owner) this.scores[owner.index] += points;
    this.spawnParticles(enemy.x, enemy.y, enemy.isBoss || enemy.elite ? '#FACC15' : '#E63946', enemy.isBoss ? 22 : enemy.elite ? 14 : 9);
    this.spawnFloatingText(enemy.x, enemy.y - enemy.radius, `+${points}`, owner?.color || '#D84727');
    this.addTrauma(enemy.isBoss ? 0.55 : enemy.elite ? 0.25 : 0.16);
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
      this.tombs.push({
        x: player.x,
        y: player.y,
        ownerIndex: player.index,
        timer: 0,
        reviveDuration: getReviveDuration(player, HORDE_TUNING.REVIVE_TIME),
      });
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
      if (tomb.timer < (tomb.reviveDuration || HORDE_TUNING.REVIVE_TIME)) continue;

      const player = this.players[tomb.ownerIndex];
      if (player) {
        player.isAlive = true;
        player.hp = player.maxHp;
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
    if (this.enemies.length === 0) {
      if (this.round === HORDE_TUNING.ROUNDS && this.wave === HORDE_TUNING.WAVES_PER_ROUND) {
        this.endMatch(true, 'campaign-complete');
        return;
      }
      if (this.wave === HORDE_TUNING.WAVES_PER_ROUND) {
        if (!this.portal) this.portal = this.createExtractionGate();
      } else if (this.waveBreakTimer <= 0) {
        this.waveBreakTimer = HORDE_TUNING.WAVE_BREAK_TIME;
      }
    }

    if (this.waveBreakTimer > 0) {
      this.waveBreakTimer = Math.max(0, this.waveBreakTimer - dt);
      if (this.waveBreakTimer === 0) this.advanceWave();
      return;
    }
    if (!this.portal || alivePlayers.length === 0) return;

    let inside = 0;
    for (const player of alivePlayers) {
      if (distanceSq(player.x, player.y, this.portal.x, this.portal.y) <= (this.portal.radius + player.radius * 0.35) ** 2) inside++;
    }
    if (inside === alivePlayers.length) this.portal.timer += dt;
    else this.portal.timer = Math.max(0, this.portal.timer - dt * 1.5);
    if (this.portal.timer >= HORDE_TUNING.PORTAL_TIME) this.enterRoundBreak();
  }

  createExtractionGate() {
    const side = Math.floor(Math.random() * 4);
    const margin = HORDE_TUNING.PORTAL_RADIUS + 8;
    const point = [
      { x: this.arena.cx, y: this.arena.top + margin },
      { x: this.arena.right - margin, y: this.arena.cy },
      { x: this.arena.cx, y: this.arena.bottom - margin },
      { x: this.arena.left + margin, y: this.arena.cy },
    ][side];
    return { ...point, side, radius: HORDE_TUNING.PORTAL_RADIUS, timer: 0 };
  }

  advanceWave() {
    if (this.wave >= HORDE_TUNING.WAVES_PER_ROUND) return;
    this.wave += 1;
    this.startWave();
    spawnPickup(this, {
      types: ['HEAL', 'SHIELD'],
      max: 1,
      obstacles: this.obstacles,
      size: 30,
      pad: 28,
    });
  }

  enterRoundBreak() {
    if (this.round >= HORDE_TUNING.ROUNDS) {
      this.endMatch(true, 'campaign-complete');
      return;
    }
    this.portal = null;
    this.nextRound = this.round + 1;
    this.state = 'ROUND_PAUSE';
    this.roundBreakTimer = HORDE_TUNING.ROUND_BREAK_TIME;
    this.roundBreakElapsed = 0;
    this.enemies = [];
    this.projectiles = [];
    this.pickups = [];
    this.tombs = [];
    this.buildMap(this.nextRound);
    this.onTouchesReset();
    for (const player of this.players) {
      if (!player.isJoined) continue;
      const spawn = this.spawnPoint(player.index);
      const wasDown = !player.isAlive;
      player.x = spawn.x;
      player.y = spawn.y;
      player.angle = spawn.angle;
      player.targetAngle = spawn.angle;
      player.isAlive = true;
      player.hp = wasDown ? 1 : Math.max(1, player.hp);
      player.invulnTimer = 0;
      player.spawnProt = 0;
      player.steerX = 0;
      player.steerY = 0;
      player.isAiming = false;
      player.remoteFireHeld = false;
      player.localFireHeld = false;
      player.attackCooldown = 0;
      player.reloadTimer = 0;
      player.magazine = getPlayerWeapon(player).magazine;
      player.ammo = player.magazine;
      player.loadoutChoiceCrateId = null;
    }
    this.generateLoadoutCrates();
    this.spawnFloatingText(this.arena.cx, this.arena.cy - 60, t('horde.armory'), '#7C3AED');
  }

  startNextRound() {
    this.round = this.nextRound;
    this.wave = 1;
    this.nextRound = this.round;
    this.roundId += 1;
    this.state = 'PLAYING';
    this.roundBreakTimer = 0;
    this.roundBreakElapsed = 0;
    this.loadoutCrates = [];
    for (const player of this.players) {
      player.loadoutChoiceCrateId = null;
      player.invulnTimer = player.isJoined ? HORDE_TUNING.SPAWN_PROTECT : 0;
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
    this.waveBreakTimer = 0;
    this.roundBreakTimer = 0;
    this.loadoutCrates = [];
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
    if (!['PLAYING', 'ROUND_PAUSE'].includes(this.state) || !player?.isJoined || !player.isAlive || !data) return;
    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE') {
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
    } else if (matchesInputAction(data, 'fire', 'HORDE_FIRE', 'press') && this.state === 'PLAYING') {
      player.remoteFireHeld = true;
      player.isAiming = true;
    } else if (matchesInputAction(data, 'fire', 'HORDE_FIRE_RELEASE', 'release')) {
      player.remoteFireHeld = false;
      player.isAiming = false;
    } else if (matchesInputAction(data, 'dash', 'DASH')) {
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
    if (['PLAYING', 'ROUND_PAUSE'].includes(this.state)) {
      if (this.handleUiTap(touch)) return;
      this.handleTabletopTouchStart(touch);
    }
  }

  onTouchMove(touch) {
    if (['PLAYING', 'ROUND_PAUSE'].includes(this.state)) this.handleTabletopTouchMove(touch);
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
