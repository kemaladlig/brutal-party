// BRUTAL COLOSSUS — 1-4 Oyunculu KOOPERATİF Titan Avı Motoru.
// Host authority: fizik, boss AI, faz geçişleri, mermi ve ışın simülasyonu burada.
//
// Tasarım hattı: boss telegraph'lı saldırılarını köklenerek açar → takım
// sırt çekirdeğine dolanır → modülleri kırar → boss sersemler → faz 2'de
// kalkanı pilonları yıkarak düşürür → faz 3'te aşırı yüklenir.

import { BaseMiniGame } from '../core/BaseGame.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { paintBackdrop } from '../core/fieldKit.js';
import {
  clampToArena,
  damp,
  distToSegmentSquared,
  normalizeAngle,
  segmentCircleIntersection,
} from '../core/physics2d.js';
import { stepArcadeVelocity } from '../core/playerEntity.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import {
  playDashWhoosh,
  playExplosion,
  playHordeBoom,
  playHordeBombTick,
  playHordeHurt,
  playHordeKill,
  playJoin,
  playLoseJingle,
  playPowerUp,
  playShoot,
  playStart,
  playWinJingle,
} from '../audio.js';
import {
  COLOSSUS_BOSSES,
  COLOSSUS_TUNING,
  COLOSSUS_WEAPONS,
  clipRayToCircles,
  getColossusMap,
} from './colossusConfig.js';
import {
  colossusHeaderStatus,
  createColossusWorldPacket,
  drawColossusWorld,
} from './colossusView.js';
import { drawFxFlash } from './worldCore.js';
import { updateBossAI, updateColossusBotAI } from '../ai/colossusAI.js';
import { getBotPersona, getSlotCustomization } from '../core/customizationManager.js';
import { notifyFireBlocked, notifyFireShot } from '../core/fireFeedbackEffects.js';
import { t } from '../i18n.js';
import { UI_COLORS } from '../ui/tokens.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { getSecondActionKey, readSlotKeys } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function pushCircleOut(entity, cx, cy, minDist) {
  const dx = entity.x - cx;
  const dy = entity.y - cy;
  const dSq = dx * dx + dy * dy;
  if (dSq >= minDist * minDist) return false;
  const d = Math.sqrt(dSq);
  const nx = d > 0.001 ? dx / d : 0;
  const ny = d > 0.001 ? dy / d : 1;
  entity.x = cx + nx * minDist;
  entity.y = cy + ny * minDist;
  return true;
}

export class ColossusGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.controlMode = 'COLOSSUS';
    this.arena = { cx: 0, cy: 0, size: 0, width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0, unit: 1 };
    this.slotTypes = ['human', 'empty', 'empty', 'empty'];
    this.minPlayersToStart = 1;

    this.selectedBossId = 'AEGIS';
    this.bossOrder = ['AEGIS', 'IGNIS', 'VOLT'];
    this.selectedWeapons = ['RIFLE', 'SHOTGUN', 'SNIPER', 'PLASMA'];
    this.weaponOrder = ['RIFLE', 'SHOTGUN', 'SNIPER', 'PLASMA'];

    this.players = [];
    this.projectiles = [];
    this.pillars = [];
    this.pylons = [];
    this.shockwaves = [];
    this.pendingEchoStomps = [];
    this.mortars = [];
    this.floatingTexts = [];

    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    this.particles = this.fx.particles;

    this.boss = null;
    this.state = 'LOBBY';
    this.matchResult = null;
    this.roundWinner = null;
    this.matchWinner = null;
    this.scores = [0, 0, 0, 0];

    this.initPlayers();
    this.bindStandardKeyboard();
  }

  cycleBossSelection(delta = 1) {
    const idx = this.bossOrder.indexOf(this.selectedBossId);
    const nextIdx = (idx + delta + this.bossOrder.length) % this.bossOrder.length;
    this.selectedBossId = this.bossOrder[nextIdx];
    try { playJoin(); } catch {}
  }

  cyclePlayerWeapon(slotIndex, delta = 1) {
    const current = this.selectedWeapons[slotIndex] || 'RIFLE';
    const idx = this.weaponOrder.indexOf(current);
    const nextIdx = (idx + delta + this.weaponOrder.length) % this.weaponOrder.length;
    const nextW = this.weaponOrder[nextIdx];
    this.selectedWeapons[slotIndex] = nextW;
    const player = this.players[slotIndex];
    if (player) {
      player.weaponId = nextW;
      player.ammo = COLOSSUS_WEAPONS[nextW]?.magazine || 16;
    }
    try { playJoin(); } catch {}
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('COLOSSUS'),
      joystick: true,
      actions: [
        { id: 'dash', icon: 'zap', cooldownField: 'dashCooldown', maxCooldown: COLOSSUS_TUNING.DASH_COOLDOWN },
      ],
    };
  }

  assertTabletopParity() {
    return super.assertTabletopParity('COLOSSUS');
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive || player.isDowned) return;
    if (actionId === 'dash' && isDown) {
      this.performPlayerDash(player);
    }
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
          try { playJoin(); } catch {}
        },
      });
      return;
    }
    if (this.state === 'MATCH_OVER' || this.state === 'VICTORY' || this.state === 'DEFEAT') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => { this.startNewMatch(); try { playJoin(); } catch {} } });
      return;
    }
    if (this.state === 'PLAYING') {
      if (this.handleUiTap(touch)) return;
      this.handleTabletopTouchStart(touch);
    }
  }

  onTouchMove(touch) {
    if (this.state === 'PLAYING') {
      this.handleTabletopTouchMove(touch);
    }
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
    for (const player of this.players || []) {
      player.steerX = 0;
      player.steerY = 0;
      player.aimActive = false;
      player.remoteAimActive = false;
      player.aimHoldAuto = false;
      player.aimHoldFired = false;
      player.keyDashLatch = false;
      player.keyFireLatch = false;
    }
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((index) => {
      const existing = this.players?.[index];
      const custom = getSlotCustomization(index);
      const slotType = this.slotTypes?.[index] || 'empty';
      const isBot = slotType === 'bot_normal' || slotType === 'bot_god';
      const persona = isBot ? getBotPersona(index, slotType === 'bot_god') : null;
      const isJoined = slotType !== 'empty';
      const angle = Math.PI * 0.5 + (index - 1.5) * 0.35;
      const dist = Math.min(this.arena.width, this.arena.height) * 0.38;

      const weaponId = isBot
        ? (this.selectedWeapons[index] || this.weaponOrder[index % this.weaponOrder.length])
        : (this.selectedWeapons[index] || 'RIFLE');
      const weaponDef = COLOSSUS_WEAPONS[weaponId] || COLOSSUS_WEAPONS.RIFLE;

      return {
        index,
        name: existing?.name || (isBot ? persona.name : `P${index + 1}`),
        color: isBot ? persona.color : (existing?.color || custom.color),
        slotType,
        isJoined,
        isAlive: isJoined,
        isDowned: false,
        reviveProgress: 0,
        x: this.arena.cx + Math.cos(angle) * dist,
        y: this.arena.cy + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        knockVx: 0,
        knockVy: 0,
        steer: 0,
        steerX: 0,
        steerY: 0,
        isAiming: false,
        radius: fieldRadius(this.arena, COLOSSUS_TUNING.PLAYER_RADIUS),
        speed: fieldSpeed(this.arena, COLOSSUS_TUNING.PLAYER_SPEED),
        angle: -Math.PI / 2,
        hp: COLOSSUS_TUNING.MAX_HP,
        maxHp: COLOSSUS_TUNING.MAX_HP,
        weaponId,
        ammo: weaponDef.magazine,
        attackCooldown: 0,
        reloadTimer: 0,
        idleReloadTimer: 0,
        dashCooldown: 0,
        dashTimer: 0,
        dashDirX: 0,
        dashDirY: 0,
        hurtInvuln: 0,
        hitFlash: 0,
        laserHitCd: 0,
        aimActive: false,
        remoteAimActive: false,
        aimHoldAuto: false,
        aimHoldFired: false,
        aimAngle: 0,
        keyDashLatch: false,
        keyFireLatch: false,
        _skidDustCd: 0,
      };
    });
  }

  resize(w, h) {
    this.updateViewport(w, h);
    const oldArena = { ...this.arena };
    this.arena = computePlayfield(w, h, 'roomy');
    if (this.boss) {
      const bossDef = COLOSSUS_BOSSES[this.boss.id] || COLOSSUS_BOSSES.AEGIS;
      this.boss.radius = fieldRadius(this.arena, bossDef.radius || COLOSSUS_TUNING.BOSS_RADIUS);
      if (this.state !== 'LOBBY') {
        this.remapPoint(this.boss, oldArena, this.arena);
        clampToArena(this.boss, this.boss.radius, this.arena);
      }
    }
    for (const player of this.players) {
      player.radius = fieldRadius(this.arena, COLOSSUS_TUNING.PLAYER_RADIUS);
      player.speed = fieldSpeed(this.arena, COLOSSUS_TUNING.PLAYER_SPEED);
      if (this.state !== 'LOBBY') {
        this.remapPoint(player, oldArena, this.arena);
        clampToArena(player, player.radius, this.arena);
      }
    }
    if (this.state !== 'LOBBY') {
      const sizeScale = oldArena.size > 0 && this.arena.size > 0 ? this.arena.size / oldArena.size : 1;
      for (const pillar of this.pillars || []) {
        this.remapPoint(pillar, oldArena, this.arena);
        pillar.radius = fieldRadius(this.arena, COLOSSUS_TUNING.PILLAR_RADIUS);
      }
      for (const pylon of this.pylons || []) {
        this.remapPoint(pylon, oldArena, this.arena);
        pylon.radius = fieldRadius(this.arena, COLOSSUS_TUNING.PYLON_RADIUS);
      }
      for (const mortar of this.mortars || []) {
        this.remapPoint(mortar, oldArena, this.arena);
        mortar.radius = fieldRadius(this.arena, COLOSSUS_TUNING.MORTAR_RADIUS);
      }
      for (const wave of this.shockwaves || []) {
        this.remapPoint(wave, oldArena, this.arena);
        wave.radius *= sizeScale;
        wave.maxRadius = fieldRadius(this.arena, COLOSSUS_TUNING.STOMP_MAX_RADIUS);
      }
    }
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
    }
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchResult = null;
    this.startBattle();
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.matchResult = null;
    this.initPlayers();
    this.projectiles = [];
    this.pillars = [];
    this.pylons = [];
    this.shockwaves = [];
    this.pendingEchoStomps = [];
    this.mortars = [];
    this.floatingTexts = [];
    this.boss = null;
    this.fx.clear();
  }

  startBattle() {
    this.state = 'PLAYING';
    this.matchResult = null;
    this.onTouchesReset();
    const bossDef = COLOSSUS_BOSSES[this.selectedBossId] || COLOSSUS_BOSSES.AEGIS;
    const map = getColossusMap(bossDef.id);

    // 1. Oyuncuları Oluştur (Güney yarım daire)
    this.initPlayers();
    for (const player of this.players) {
      player.isAlive = player.isJoined;
      player.hp = player.maxHp;
      player.isDowned = false;
      player.reviveProgress = 0;
      player.laserHitCd = 0;
      player.hurtInvuln = 0;
      player.hitFlash = 0;
      player.idleReloadTimer = 0;
      player.knockVx = 0;
      player.knockVy = 0;
      player.dashDirX = 0;
      player.dashDirY = 0;
      player._skidDustCd = 0;
      const w = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;
      player.ammo = w.magazine || 16;
    }

    const activeCount = this.players.filter((p) => p.isJoined).length || 1;

    // 2. Boss'u Oluştur (Kuzey Merkez)
    const bossHp = (bossDef.baseHp || COLOSSUS_TUNING.BASE_HP) + (activeCount - 1) * (bossDef.hpPerPlayer || COLOSSUS_TUNING.HP_PER_EXTRA_PLAYER);
    this.boss = {
      id: bossDef.id,
      name: bossDef.name,
      titleKey: bossDef.titleKey,
      theme: bossDef.theme,
      bodyShape: bossDef.bodyShape,
      accentColor: bossDef.accentColor,
      hasShieldPhase: bossDef.hasShieldPhase !== false,
      speedP1: bossDef.speedP1,
      speedP2: bossDef.speedP2,
      speedP3: bossDef.speedP3,
      x: this.arena.cx,
      y: this.arena.cy - this.arena.height * 0.22,
      vx: 0,
      vy: 0,
      angle: Math.PI / 2,
      radius: fieldRadius(this.arena, bossDef.radius || COLOSSUS_TUNING.BOSS_RADIUS),
      hp: bossHp,
      maxHp: bossHp,
      phase: 1,
      state: 'IDLE',
      stagger: 0,
      staggerTimer: 0,
      targetSlot: -1,
      aggroLock: 0,
      hitFlash: 0,
      critFlash: 0,
      shielded: false,
      laserActive: false,
      laserLock: false,
      laserAngle: Math.PI / 2,
      laserProgress: 0,
      laserTimer: 0,
      laserTrackTimer: 0,
      laserLockTimer: 0,
      stompCooldown: 2.5,
      laserCooldown: 4.5,
      mortarCooldown: 4.0,
      chargeCooldown: 6.0,
      stompWindup: 0,
      chargeWindup: 0,
      chargeTimer: 0,
      chargeAngle: Math.PI / 2,
      chargeLock: false,
      chargeHits: [],
      mortarWindup: 0,
      parts: (bossDef.parts || []).map((p) => ({
        id: p.id,
        nameKey: p.nameKey,
        hp: p.maxHp,
        maxHp: p.maxHp,
        angleOffset: p.angleOffset,
        distRatio: p.distRatio,
        radius: p.radius,
        disables: p.disables || null,
        armor: p.armor === true,
        broken: false,
        hitFlash: 0,
      })),
    };

    // 3. Taş Sütunları Konumlandır
    this.pillars = map.pillarOffsets.map((offset) => ({
      x: this.arena.cx + offset.x * this.arena.width,
      y: this.arena.cy + offset.y * this.arena.height,
      radius: fieldRadius(this.arena, COLOSSUS_TUNING.PILLAR_RADIUS),
      hp: COLOSSUS_TUNING.PILLAR_HP,
      maxHp: COLOSSUS_TUNING.PILLAR_HP,
    }));

    this.pylons = [];
    this.projectiles = [];
    this.shockwaves = [];
    this.pendingEchoStomps = [];
    this.mortars = [];
    this.floatingTexts = [];
    this.fx.clear();

    try { playStart(); } catch {}
  }

  update(now) {
    const rawDt = this.clampDt(now, this.lastTime);
    this.lastTime = now;
    // Hit-stop TEK SAAT: fxRuntime sunum dt'sini kısar; otorite host'ta kalır.
    const dt = this.fx.tick(rawDt);

    this.updateTrauma(dt);
    this.fx.update(dt);
    this.updateEffects(dt);

    if (this.state !== 'PLAYING') return;

    this.updatePlayers(dt);
    this.updateBoss(dt);
    this.updatePylons(dt);
    this.updateShockwaves(dt);
    this.updateEchoStomps(dt);
    this.updateLaser(dt);
    this.updateMortars(dt);
    this.updateProjectiles(dt);
    this.checkVictoryDefeat();
  }

  onSlotAimHold(slotIndex, isDown, { cancelled = false, tap = false, previousHeld = false } = {}) {
    const player = this.players[slotIndex];
    if (!player?.isJoined || !player.isAlive) return;
    if (isDown && !previousHeld) player.aimHoldFired = false;
    if (!isDown) {
      player.aimActive = false;
      if (tap && !cancelled && !player.isDowned && player.slotType === 'human' && !player.aimHoldFired && this.state === 'PLAYING') {
        player.angle = this.autoAimAngle(player);
        this.firePlayerWeapon(player);
      }
    }
  }

  updateHumanInput(player, dt) {
    // 1. Hareket: Sanal joystick + Klavye
    const movement = this.getPlayerMovementVector(player.index);
    if (movement.active || movement.magnitude > 0.05) {
      player.steerX = movement.x;
      player.steerY = movement.y;
    } else {
      player.steerX = 0;
      player.steerY = 0;
    }

    // 2. Twin-stick Dokunmatik Aim & Ateş (hold-to-fire) + Yönsüz basılı tutma
    const aimState = this.getAimState(player.index);
    const aimVector = this.getAimVector(player.index);
    const keyboard = readSlotKeys(this.keys, player.index);
    const plainHold = Boolean(aimState?.held && this.getPlainAimHold(player.index));

    if (player.dashTimer <= 0) {
      if (aimState?.active) {
        player.aimActive = true;
        player.angle = aimVector.angle;
        this.firePlayerWeapon(player);
      } else if (plainHold) {
        player.aimActive = true;
        player.angle = this.autoAimAngle(player);
        player.aimHoldFired = true;
        this.firePlayerWeapon(player);
      } else if (keyboard.action) {
        player.aimActive = true;
        player.angle = this.autoAimAngle(player);
        this.firePlayerWeapon(player);
      } else {
        player.aimActive = false;
        if (movement.magnitude > 0.05) {
          player.angle = Math.atan2(movement.y, movement.x);
        }
      }
    }

    // 3. Depar (Dash - İkincil tuş)
    const dashKey = getSecondActionKey('dash', player.index);
    const dashPressed = Boolean(dashKey && this.keys[dashKey]);
    if (dashPressed && !player.keyDashLatch) {
      this.performPlayerDash(player);
      player.keyDashLatch = true;
    } else if (!dashPressed) {
      player.keyDashLatch = false;
    }
  }

  autoAimAngle(player) {
    const boss = this.boss;
    if (!boss || boss.hp <= 0) return player.angle;
    if (boss.phase === 2 && boss.shielded && (this.pylons || []).some((p) => p.active)) {
      const activePylons = this.pylons.filter((p) => p.active);
      const nearest = activePylons.reduce((best, p) => (
        distSq(player.x, player.y, p.x, p.y) < distSq(player.x, player.y, best.x, best.y) ? p : best
      ), activePylons[0]);
      return Math.atan2(nearest.y - player.y, nearest.x - player.x);
    }

    const toPlayerX = player.x - boss.x;
    const toPlayerY = player.y - boss.y;
    const toPlayerLen = Math.hypot(toPlayerX, toPlayerY) || 1;
    let bestPart = null;
    let bestScore = -Infinity;
    for (const part of boss.parts || []) {
      if (part.broken) continue;
      const partAngle = boss.angle + part.angleOffset;
      const dx = Math.cos(partAngle);
      const dy = Math.sin(partAngle);
      const facing = (dx * toPlayerX + dy * toPlayerY) / toPlayerLen;
      if (facing > 0.15 && facing > bestScore) {
        bestScore = facing;
        bestPart = {
          x: boss.x + dx * boss.radius * part.distRatio,
          y: boss.y + dy * boss.radius * part.distRatio,
        };
      }
    }
    if (bestPart) {
      return Math.atan2(bestPart.y - player.y, bestPart.x - player.x);
    }
    return Math.atan2(boss.y - player.y, boss.x - player.x);
  }

  updatePlayers(dt) {
    const reviveR = fieldRadius(this.arena, COLOSSUS_TUNING.REVIVE_RADIUS);
    const dashSpd = fieldSpeed(this.arena, COLOSSUS_TUNING.DASH_SPEED);

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.slotType === 'bot_normal' || player.slotType === 'bot_god') {
        updateColossusBotAI(player, this, dt);
      } else if (player.slotType === 'human' && !player.isDowned) {
        this.updateHumanInput(player, dt);
      }

      if (player.dashTimer > 0) player.dashTimer = Math.max(0, player.dashTimer - dt);
      if (player.dashCooldown > 0) player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      if (player.attackCooldown > 0) player.attackCooldown = Math.max(0, player.attackCooldown - dt);
      if (player.laserHitCd > 0) player.laserHitCd = Math.max(0, player.laserHitCd - dt);
      if (player.hurtInvuln > 0) player.hurtInvuln = Math.max(0, player.hurtInvuln - dt);
      if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt);
      if (player._skidDustCd > 0) player._skidDustCd = Math.max(0, player._skidDustCd - dt);

      if (player.dashCooldown <= 0 && !player.isDowned && this.consumeSlotAction(player.index, 'dash')) {
        this.performPlayerDash(player);
      }

      const w = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;
      if (player.reloadTimer > 0) {
        player.reloadTimer = Math.max(0, player.reloadTimer - dt);
        player.idleReloadTimer = 0;
        if (player.reloadTimer <= 0) {
          player.ammo = w.magazine;
        }
      } else if (!player.isDowned && this.state === 'PLAYING' && player.ammo < w.magazine) {
        player.idleReloadTimer = (player.idleReloadTimer || 0) + dt;
        if (player.idleReloadTimer >= COLOSSUS_TUNING.AUTO_RELOAD_DELAY) {
          player.idleReloadTimer = 0;
          player.reloadTimer = w.reloadTime;
        }
      } else {
        player.idleReloadTimer = 0;
      }

      if (player.isDowned) {
        player.vx = 0;
        player.vy = 0;
        player.knockVx = 0;
        player.knockVy = 0;

        const rescuer = this.players.find(
          (other) => other.isJoined && other.isAlive && !other.isDowned && other.index !== player.index &&
            distSq(other.x, other.y, player.x, player.y) < reviveR * reviveR,
        );

        if (rescuer) {
          player.reviveProgress = Math.min(1, player.reviveProgress + dt / COLOSSUS_TUNING.REVIVE_DURATION);
          if (player.reviveProgress >= 1) {
            player.isDowned = false;
            player.hp = 2;
            player.reviveProgress = 0;
            try { playStart(); } catch {}
          }
        } else {
          player.reviveProgress = Math.max(0, player.reviveProgress - dt * 0.5);
        }
        continue;
      }

      if (player.dashTimer > 0) {
        const dashProg = 1 - player.dashTimer / COLOSSUS_TUNING.DASH_DURATION;
        const dashEase = dashProg > 0.7 ? 1 - (dashProg - 0.7) * 0.65 : 1;
        const dirX = player.dashDirX || Math.cos(player.angle);
        const dirY = player.dashDirY || Math.sin(player.angle);
        player.vx = dirX * dashSpd * dashEase;
        player.vy = dirY * dashSpd * dashEase;
      } else {
        const reversed = stepArcadeVelocity(
          player,
          (player.steerX || 0) * player.speed,
          (player.steerY || 0) * player.speed,
          dt,
        );
        if (reversed && !(player._skidDustCd > 0)) {
          player._skidDustCd = 0.22;
          this.fx.emit('dust', { x: player.x, y: player.y, color: player.color });
        }
      }

      const kvx = player.knockVx || 0;
      const kvy = player.knockVy || 0;
      player.x += (player.vx + kvx) * dt;
      player.y += (player.vy + kvy) * dt;

      if (kvx !== 0 || kvy !== 0) {
        const knockDrag = damp(0.84, dt);
        player.knockVx = kvx * knockDrag;
        player.knockVy = kvy * knockDrag;
        if (Math.hypot(player.knockVx, player.knockVy) < 2) {
          player.knockVx = 0;
          player.knockVy = 0;
        }
      }

      for (const pillar of this.pillars || []) {
        if (pillar.hp > 0) {
          pushCircleOut(player, pillar.x, pillar.y, pillar.radius + player.radius);
        }
      }
      for (const pylon of this.pylons || []) {
        if (pylon.active) {
          pushCircleOut(player, pylon.x, pylon.y, pylon.radius + player.radius);
        }
      }
      if (this.boss && this.boss.hp > 0 && this.boss.state !== 'CHARGE' && player.dashTimer <= 0) {
        pushCircleOut(player, this.boss.x, this.boss.y, this.boss.radius + player.radius);
      }

      clampToArena(player, player.radius, this.arena);
    }
  }

  updateBoss(dt) {
    if (!this.boss || this.boss.hp <= 0) return;

    if (this.boss.hitFlash > 0) this.boss.hitFlash = Math.max(0, this.boss.hitFlash - dt);
    if (this.boss.critFlash > 0) this.boss.critFlash = Math.max(0, this.boss.critFlash - dt);
    for (const part of this.boss.parts || []) {
      if (part.hitFlash > 0) part.hitFlash = Math.max(0, part.hitFlash - dt);
    }

    updateBossAI(this.boss, this, dt);

    // Boss Hareketi
    this.boss.x += this.boss.vx * dt;
    this.boss.y += this.boss.vy * dt;
    const bossDecay = damp(0.92, dt);
    this.boss.vx *= bossDecay;
    this.boss.vy *= bossDecay;

    // Duvar dibine hücum: yalnızca o duvara doğru giderken sersemler.
    if (this.boss.state === 'CHARGE') {
      const r = this.boss.radius;
      const hitWall = (this.boss.vx < 0 && this.boss.x - r <= this.arena.left)
        || (this.boss.vx > 0 && this.boss.x + r >= this.arena.right)
        || (this.boss.vy < 0 && this.boss.y - r <= this.arena.top)
        || (this.boss.vy > 0 && this.boss.y + r >= this.arena.bottom);
      this.applyChargeDamage();
      if (hitWall) {
        this.staggerBoss();
      }
    }

    // Sütunlara Çarpışma (Hücum sırasında sütuna çarparsa SERSEMLER!)
    for (const pillar of this.pillars) {
      if (pillar.hp <= 0) continue;
      const minDist = this.boss.radius + pillar.radius;
      if (pushCircleOut(this.boss, pillar.x, pillar.y, minDist)) {
        if (this.boss.state === 'CHARGE') {
          pillar.hp -= 2;
          this.staggerBoss();
          try { playHordeBoom(); } catch {}
        }
      }
    }

    clampToArena(this.boss, this.boss.radius, this.arena);

    // Faz Geçiş Kontrolleri
    const hpRatio = this.boss.hp / this.boss.maxHp;
    if (this.boss.phase === 1 && hpRatio <= COLOSSUS_TUNING.PHASE_2_HP_RATIO) {
      this.enterPhase2();
    } else if (this.boss.phase === 2 && hpRatio <= COLOSSUS_TUNING.PHASE_3_HP_RATIO) {
      this.enterPhase3();
    }
  }

  applyChargeDamage() {
    const boss = this.boss;
    if (!boss || boss.state !== 'CHARGE') return;
    if (!Array.isArray(boss.chargeHits)) boss.chargeHits = [];
    const knock = fieldSpeed(this.arena, COLOSSUS_TUNING.CHARGE_KNOCKBACK);
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive || player.isDowned) continue;
      if (player.dashTimer > 0) continue;
      if (boss.chargeHits.includes(player.index)) continue;
      const d = Math.sqrt(distSq(player.x, player.y, boss.x, boss.y));
      if (d <= boss.radius + player.radius) {
        boss.chargeHits.push(player.index);
        this.damagePlayer(player, COLOSSUS_TUNING.CHARGE_DAMAGE);
        const a = Math.atan2(player.y - boss.y, player.x - boss.x);
        player.knockVx = Math.cos(a) * knock;
        player.knockVy = Math.sin(a) * knock;
        player.vx = player.knockVx;
        player.vy = player.knockVy;
      }
    }
  }

  onBossLaserFire() {
    try { playShoot(); } catch {}
  }

  enterPhase2() {
    this.boss.phase = 2;
    if (this.boss.hasShieldPhase) {
      this.boss.shielded = true;
      const map = getColossusMap(this.boss.id);
      const offsets = map.pylonOffsets && map.pylonOffsets.length
        ? map.pylonOffsets
        : [{ x: 0, y: -0.36 }, { x: 0, y: 0.36 }];

      this.pylons = offsets.map((offset, idx) => ({
        id: idx,
        x: this.arena.cx + offset.x * this.arena.width,
        y: this.arena.cy + offset.y * this.arena.height,
        radius: fieldRadius(this.arena, COLOSSUS_TUNING.PYLON_RADIUS),
        hp: COLOSSUS_TUNING.PYLON_HP,
        maxHp: COLOSSUS_TUNING.PYLON_HP,
        active: true,
        hitFlash: 0,
      }));
    } else {
      this.boss.shielded = false;
      this.pylons = [];
    }

    try { playHordeBoom(); } catch {}
    this.addDirectionalTrauma(0.5, 0, -1);
  }

  enterPhase3() {
    this.boss.phase = 3;
    this.boss.shielded = false;
    this.pylons = [];
    try { playHordeBoom(); } catch {}
    this.addDirectionalTrauma(0.6, 0, 1);
  }

  updatePylons(dt) {
    if (this.boss?.phase !== 2) return;
    for (const p of this.pylons) {
      if (p.hitFlash > 0) p.hitFlash = Math.max(0, p.hitFlash - dt);
    }
    const anyActive = this.pylons.some((p) => p.active);
    if (!anyActive && this.boss.shielded) {
      this.boss.shielded = false;
      this.staggerBoss();
      this.grantTeamSurge();
      try { playExplosion(); } catch {}
    }
  }

  updateShockwaves(dt) {
    const ringSpeed = fieldSpeed(this.arena, COLOSSUS_TUNING.STOMP_RING_SPEED);
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += ringSpeed * dt;
      if (!s.hitPlayers) s.hitPlayers = new Set();

      for (const player of this.players) {
        if (!player.isJoined || !player.isAlive || player.isDowned) continue;
        if (s.hitPlayers.has(player.index)) continue;
        if (player.dashTimer > 0) continue;

        const d = Math.sqrt(distSq(player.x, player.y, s.x, s.y));
        if (Math.abs(d - s.radius) < player.radius * 0.7) {
          s.hitPlayers.add(player.index);
          this.damagePlayer(player, COLOSSUS_TUNING.STOMP_DAMAGE);
        }
      }

      if (s.radius >= s.maxRadius) {
        this.shockwaves.splice(i, 1);
      }
    }
  }

  updateEchoStomps(dt) {
    if (!this.pendingEchoStomps?.length) return;
    const capBroken = this.boss?.parts?.find((part) => part.id === 'capacitors')?.broken === true;
    for (let i = this.pendingEchoStomps.length - 1; i >= 0; i--) {
      const echo = this.pendingEchoStomps[i];
      echo.delay -= dt;
      if (echo.delay <= 0) {
        this.pendingEchoStomps.splice(i, 1);
        if (this.boss && this.boss.hp > 0 && this.boss.state !== 'STAGGER' && !capBroken) {
          this.shockwaves.push({
            x: this.boss.x,
            y: this.boss.y,
            radius: this.boss.radius * 0.45,
            maxRadius: fieldRadius(this.arena, COLOSSUS_TUNING.STOMP_MAX_RADIUS),
            hitPlayers: new Set(),
          });
          this.addDirectionalTrauma(0.24, 0, 1);
          try { playHordeBoom(); } catch {}
        }
      }
    }
  }

  updateLaser(dt) {
    const boss = this.boss;
    if (!boss || boss.state !== 'LASER_FIRE' || !boss.laserActive) return;

    const maxRange = Math.hypot(this.arena.width, this.arena.height) * 1.4;
    const originX = boss.x + Math.cos(boss.laserAngle) * boss.radius * 0.7;
    const originY = boss.y + Math.sin(boss.laserAngle) * boss.radius * 0.7;
    const beamLen = clipRayToCircles(originX, originY, boss.laserAngle, maxRange, this.pillars);
    const endX = originX + Math.cos(boss.laserAngle) * beamLen;
    const endY = originY + Math.sin(boss.laserAngle) * beamLen;
    const beamHalf = fieldRadius(this.arena, COLOSSUS_TUNING.LASER_BEAM_WIDTH * 0.5);

    if (beamLen < maxRange && Math.random() < 0.35) {
      this.fx.emit('spark', { x: endX, y: endY, color: UI_COLORS.danger });
    }

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive || player.isDowned) continue;
      if (player.dashTimer > 0) continue;

      const reach = beamHalf + player.radius;
      if (distToSegmentSquared(player.x, player.y, originX, originY, endX, endY) <= reach * reach) {
        if ((player.laserHitCd || 0) <= 0) {
          this.damagePlayer(player, COLOSSUS_TUNING.LASER_DAMAGE);
          player.laserHitCd = COLOSSUS_TUNING.LASER_TICK;
        }
      }
    }
  }

  updateMortars(dt) {
    for (let i = this.mortars.length - 1; i >= 0; i--) {
      const m = this.mortars[i];
      m.fuse -= dt;

      if (m.fuse <= 0) {
        try { playExplosion(); } catch {}
        this.addDirectionalTrauma(0.2, 0, 0);
        this.fx.emit('hit', { x: m.x, y: m.y, color: UI_COLORS.danger }, { hitStop: false, traumaScale: 0.35 });

        for (const player of this.players) {
          if (!player.isJoined || !player.isAlive || player.isDowned) continue;
          if (player.dashTimer > 0) continue;

          const d = Math.sqrt(distSq(player.x, player.y, m.x, m.y));
          if (d <= m.radius + player.radius) {
            this.damagePlayer(player, COLOSSUS_TUNING.MORTAR_DAMAGE);
          }
        }
        this.mortars.splice(i, 1);
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const prevX = p.x;
      const prevY = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life = (p.life || 1) - dt;

      let hit = false;
      let hitX = p.x;
      let hitY = p.y;

      // 1. Sütunlara Çarpma (swept)
      for (const pillar of this.pillars) {
        if (pillar.hp <= 0) continue;
        const segHit = segmentCircleIntersection(prevX, prevY, p.x, p.y, pillar.x, pillar.y, pillar.radius);
        if (segHit) {
          hit = true;
          hitX = segHit.x;
          hitY = segHit.y;
          pillar.hp -= (p.damage || 2) * 0.2;
          this.fx.emit('spark', { x: hitX, y: hitY, color: p.color || UI_COLORS.muted });
          break;
        }
      }

      // 2. Pilonlara Çarpma (Faz 2, swept)
      if (!hit && this.boss?.phase === 2) {
        for (const pylon of this.pylons) {
          if (!pylon.active) continue;
          const segHit = segmentCircleIntersection(prevX, prevY, p.x, p.y, pylon.x, pylon.y, pylon.radius);
          if (segHit) {
            hit = true;
            hitX = segHit.x;
            hitY = segHit.y;
            pylon.hp -= p.damage || 2;
            pylon.hitFlash = 0.12;
            this.fx.emit('spark', { x: hitX, y: hitY, color: p.color });
            try { playHordeHurt(); } catch {}
            if (pylon.hp <= 0) {
              pylon.active = false;
              this.spawnFloatingText(pylon.x, pylon.y - pylon.radius, t('colossus.pylonDown'), UI_COLORS.gold);
              try { playHordeKill(); } catch {}
            }
            break;
          }
        }
      }

      // 3. Boss'a & İç Modüllere Çarpma (swept)
      if (!hit && this.boss && this.boss.hp > 0) {
        const segHit = segmentCircleIntersection(prevX, prevY, p.x, p.y, this.boss.x, this.boss.y, this.boss.radius);
        if (segHit) {
          hit = true;
          hitX = segHit.x;
          hitY = segHit.y;
          if (this.boss.shielded) {
            this.boss.hitFlash = 0.08;
            this.spawnFloatingText(hitX, hitY, t('colossus.shielded'), UI_COLORS.hudShield);
          } else {
            const pSpd = Math.hypot(p.vx, p.vy);
            if (pSpd > 1 && this.boss.parts?.length) {
              const probeEndX = segHit.x + (p.vx / pSpd) * this.boss.radius * 0.9;
              const probeEndY = segHit.y + (p.vy / pSpd) * this.boss.radius * 0.9;
              let bestT = Infinity;
              for (const part of this.boss.parts) {
                if (part.broken) continue;
                const partAngle = this.boss.angle + part.angleOffset;
                const partDist = this.boss.radius * part.distRatio;
                const cx = this.boss.x + Math.cos(partAngle) * partDist;
                const cy = this.boss.y + Math.sin(partAngle) * partDist;
                const pRad = Math.max(part.radius || 22, this.boss.radius * ((part.radius || 22) / 76)) * 1.15;
                const partHit = segmentCircleIntersection(prevX, prevY, probeEndX, probeEndY, cx, cy, pRad);
                if (partHit && partHit.t < bestT) {
                  bestT = partHit.t;
                  hitX = partHit.x;
                  hitY = partHit.y;
                }
              }
            }
            this.applyDamageToBoss(p.damage || 2, hitX, hitY, p.stagger || 4);
          }
        }
      }

      // 4. Plazma / Patlama AoE Etkisi
      if (hit && p.aoeRadius > 0) {
        this.addDirectionalTrauma(0.18, 0, 0);
        try { playExplosion(); } catch {}
        if (this.boss && !this.boss.shielded && this.boss.hp > 0) {
          const dBossAoE = Math.sqrt(distSq(hitX, hitY, this.boss.x, this.boss.y));
          if (dBossAoE <= this.boss.radius + p.aoeRadius) {
            this.applyDamageToBoss((p.damage || 2) * 0.75, hitX, hitY, p.stagger || 4);
          }
        }
      }

      if (hit || p.life <= 0) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  applyDamageToBoss(rawDamage, hitX, hitY, staggerAmount) {
    if (!this.boss || this.boss.hp <= 0) return;

    // 1. Boss Modüllerini Denetle (destructible parts, boss yarıçapına göre ölçekli)
    let hitPart = null;
    if (this.boss.parts) {
      const bossScale = Math.max(0.5, this.boss.radius / 76);
      for (const part of this.boss.parts) {
        if (part.broken) continue;
        const partAngle = this.boss.angle + part.angleOffset;
        const partDist = this.boss.radius * part.distRatio;
        const px = this.boss.x + Math.cos(partAngle) * partDist;
        const py = this.boss.y + Math.sin(partAngle) * partDist;
        const pRad = Math.max(part.radius || 22, (part.radius || 22) * bossScale) * 1.15;
        if (distSq(hitX, hitY, px, py) <= pRad * pRad) {
          hitPart = part;
          break;
        }
      }
    }

    let partJustBroke = false;
    if (hitPart) {
      hitPart.hp -= rawDamage;
      hitPart.hitFlash = 0.16;
      if (hitPart.hp <= 0 && !hitPart.broken) {
        hitPart.hp = 0;
        hitPart.broken = true;
        partJustBroke = true;
      }
    }

    // 2. Vuruş açısını Boss'un baktığı yöne göre hesapla
    const hitAngle = Math.atan2(hitY - this.boss.y, hitX - this.boss.x);
    const relAngle = Math.abs(normalizeAngle(hitAngle - this.boss.angle));

    const isRearCore = relAngle > (Math.PI - COLOSSUS_TUNING.CORE_ARC / 2);
    const frontArmorBroken = this.boss.parts?.find((p) => p.id === 'armorPlate')?.broken === true;
    const allPartsBroken = (this.boss.parts || []).length > 0 && this.boss.parts.every((p) => p.broken);

    let damage;
    if (isRearCore || this.boss.state === 'STAGGER' || frontArmorBroken || allPartsBroken) {
      damage = rawDamage;
      this.boss.hp -= damage;
      this.boss.critFlash = 0.14;
      this.boss.stagger = Math.min(COLOSSUS_TUNING.STAGGER_MAX, this.boss.stagger + staggerAmount * 2);
      this.fx.emit('hit', { x: hitX, y: hitY, color: UI_COLORS.gold }, { hitStop: false, traumaScale: 0.5 });
      this.spawnFloatingText(hitX, hitY, `${Math.round(damage)}`, UI_COLORS.gold);
    } else {
      damage = Math.max(0.5, rawDamage * COLOSSUS_TUNING.ARMOR_DAMAGE_SCALE);
      this.boss.hp -= damage;
      this.boss.hitFlash = 0.08;
      this.boss.stagger = Math.min(COLOSSUS_TUNING.STAGGER_MAX, this.boss.stagger + staggerAmount * 0.5);
      this.fx.emit('spark', { x: hitX, y: hitY, color: UI_COLORS.muted });
      this.spawnFloatingText(hitX, hitY, `${Math.max(1, Math.round(damage))}`, UI_COLORS.muted);
    }

    if (partJustBroke && hitPart) {
      this.boss.stagger = Math.min(COLOSSUS_TUNING.STAGGER_MAX, this.boss.stagger + COLOSSUS_TUNING.STAGGER_MAX);
      this.addDirectionalTrauma(0.45, 0, 0);
      this.fx.emit('slay', { x: hitX, y: hitY, color: UI_COLORS.danger }, { traumaScale: 0.6 });
      this.spawnFloatingText(hitX, hitY - 18, t(hitPart.nameKey), UI_COLORS.danger);
      this.grantTeamSurge();
      try { playExplosion(); } catch {}
    }

    if (this.boss.stagger >= COLOSSUS_TUNING.STAGGER_MAX && this.boss.state !== 'STAGGER') {
      this.staggerBoss();
    }
  }

  grantTeamSurge() {
    for (const player of this.players || []) {
      if (!player.isJoined || !player.isAlive || player.isDowned) continue;
      const healed = player.hp < player.maxHp;
      if (healed) {
        player.hp = Math.min(player.maxHp, player.hp + 1);
      }
      const w = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;
      player.ammo = w.magazine;
      player.reloadTimer = 0;
      player.idleReloadTimer = 0;
      if (healed) {
        this.spawnFloatingText(player.x, player.y - player.radius, '+1 HP', UI_COLORS.gold);
      }
    }
    try { playPowerUp(); } catch {}
  }

  staggerBoss() {
    this.boss.state = 'STAGGER';
    this.boss.staggerTimer = COLOSSUS_TUNING.STAGGER_DURATION;
    this.boss.laserActive = false;
    this.boss.laserLock = false;
    this.boss.chargeLock = false;
    this.addDirectionalTrauma(0.5, 0, 1);
    this.fx.emit('slay', { x: this.boss.x, y: this.boss.y, color: UI_COLORS.gold }, { traumaScale: 0.5 });
    this.spawnFloatingText(this.boss.x, this.boss.y - this.boss.radius * 0.6, t('colossus.staggered'), UI_COLORS.gold);
    try { playHordeBoom(); } catch {}
  }

  damagePlayer(player, amount) {
    if (player.isDowned || player.dashTimer > 0 || (player.hurtInvuln || 0) > 0) return;
    player.hp -= amount;
    player.hurtInvuln = COLOSSUS_TUNING.HURT_INVULN;
    player.hitFlash = 0.22;
    this.fx.emit('hit', { x: player.x, y: player.y, color: player.color, slot: player.index });
    this.addDirectionalTrauma(0.25, 0, 0);
    try { playHordeHurt(); } catch {}

    if (player.hp <= 0) {
      player.hp = 0;
      player.isDowned = true;
      player.reviveProgress = 0;
      this.spawnFloatingText(player.x, player.y - 24, t('colossus.help'), UI_COLORS.danger);
      try { playExplosion(); } catch {}
    }
  }

  triggerStomp() {
    this.shockwaves.push({
      x: this.boss.x,
      y: this.boss.y,
      radius: this.boss.radius * 0.5,
      maxRadius: fieldRadius(this.arena, COLOSSUS_TUNING.STOMP_MAX_RADIUS),
      hitPlayers: new Set(),
    });
    const capBroken = this.boss?.parts?.find((part) => part.id === 'capacitors')?.broken === true;
    if (this.boss?.id === 'VOLT' && !capBroken) {
      this.pendingEchoStomps.push({ delay: COLOSSUS_TUNING.VOLT_DOUBLE_STOMP_DELAY });
    }
    this.addDirectionalTrauma(0.3, 0, 1);
    try { playHordeBoom(); } catch {}
  }

  triggerMortarBarrage(players) {
    const baseRadius = fieldRadius(this.arena, COLOSSUS_TUNING.MORTAR_RADIUS);
    const scatter = fieldRadius(this.arena, 36);
    const twinOffset = fieldRadius(this.arena, 58);
    const pad = baseRadius * 0.8;
    const isIgnis = this.boss?.id === 'IGNIS';
    const spawnCrater = (x, y, extraFuse = 0) => {
      const cx = Math.max(this.arena.left + pad, Math.min(this.arena.right - pad, x));
      const cy = Math.max(this.arena.top + pad, Math.min(this.arena.bottom - pad, y));
      const fuse = COLOSSUS_TUNING.MORTAR_FUSE + extraFuse;
      this.mortars.push({ x: cx, y: cy, radius: baseRadius, fuse, maxFuse: fuse });
    };
    for (const p of players) {
      const leadX = p.x + (p.vx || 0) * 0.45 + (Math.random() - 0.5) * scatter;
      const leadY = p.y + (p.vy || 0) * 0.45 + (Math.random() - 0.5) * scatter;
      spawnCrater(leadX, leadY, 0);
      if (isIgnis) {
        const ang = Math.random() * Math.PI * 2;
        spawnCrater(leadX + Math.cos(ang) * twinOffset, leadY + Math.sin(ang) * twinOffset, 0.35);
      }
    }
    try { playHordeBombTick(); } catch {}
  }

  firePlayerWeapon(player) {
    if (player.attackCooldown > 0 || player.reloadTimer > 0 || player.ammo <= 0) {
      notifyFireBlocked(player);
      return;
    }
    const w = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;

    player.attackCooldown = w.fireInterval;
    player.ammo -= 1;
    player.idleReloadTimer = 0;

    const projSpeed = fieldSpeed(this.arena, w.projectileSpeed);
    const projRange = fieldRadius(this.arena, w.range || 600);
    const aoeRadius = w.aoeRadius ? fieldRadius(this.arena, w.aoeRadius) : 0;
    const projRadius = fieldRadius(this.arena, w.aoeRadius ? 6 : 4);
    const muzzleOffset = player.radius + fieldRadius(this.arena, 6);

    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const spread = (Math.random() - 0.5) * (w.spread || 0.05);
      const angle = player.angle + spread;
      this.projectiles.push({
        x: player.x + Math.cos(angle) * muzzleOffset,
        y: player.y + Math.sin(angle) * muzzleOffset,
        vx: Math.cos(angle) * projSpeed,
        vy: Math.sin(angle) * projSpeed,
        damage: w.damage,
        stagger: w.stagger,
        color: w.color,
        radius: projRadius,
        life: projRange / Math.max(1, projSpeed),
        aoeRadius,
      });
    }

    notifyFireShot(player);
    try { playShoot(); } catch {}

    if (player.ammo <= 0) {
      player.reloadTimer = w.reloadTime;
    }
  }

  performPlayerDash(player) {
    if (player.isDowned) return;
    if (player.dashCooldown > 0) {
      this.bufferSlotAction(player.index, 'dash');
      return;
    }
    let dirX = 0;
    let dirY = 0;
    if (player.slotType === 'human') {
      const movement = this.getPlayerMovementVector(player.index);
      if (movement.magnitude > 0.1) {
        dirX = movement.x / movement.magnitude;
        dirY = movement.y / movement.magnitude;
      }
    }
    if (dirX === 0 && dirY === 0) {
      const steerLen = Math.hypot(player.steerX || 0, player.steerY || 0);
      if (steerLen > 0.1) {
        dirX = player.steerX / steerLen;
        dirY = player.steerY / steerLen;
      } else {
        dirX = Math.cos(player.angle);
        dirY = Math.sin(player.angle);
      }
    }

    const dashSpd = fieldSpeed(this.arena, COLOSSUS_TUNING.DASH_SPEED);
    player.dashTimer = COLOSSUS_TUNING.DASH_DURATION;
    player.dashCooldown = COLOSSUS_TUNING.DASH_COOLDOWN;
    player.dashDirX = dirX;
    player.dashDirY = dirY;
    player.vx = dirX * dashSpd;
    player.vy = dirY * dashSpd;

    this.fx.emit('dust', { x: player.x, y: player.y, color: player.color, slot: player.index });
    try { playDashWhoosh(); } catch {}
  }

  spawnFloatingText(x, y, text, color) {
    if (!text) return;
    this.floatingTexts.push({ x, y, text: String(text).slice(0, 20), color, vy: -30, alpha: 1, decay: 1.15 });
    const cap = 16;
    if (this.floatingTexts.length > cap) this.floatingTexts.shift();
  }

  updateEffects(dt) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const entry = this.floatingTexts[i];
      entry.y += entry.vy * dt;
      entry.alpha -= entry.decay * dt;
      if (entry.alpha <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  checkVictoryDefeat() {
    if (this.state === 'MATCH_OVER') return;

    if (this.boss && this.boss.hp <= 0) {
      this.state = 'MATCH_OVER';
      this.matchResult = 'win';
      this.resetInputSource();
      for (let i = 0; i < 4; i++) {
        if (this.players[i]?.isJoined) this.scores[i] += 1;
      }
      this.fx.emit('kill', { x: this.boss.x, y: this.boss.y, color: UI_COLORS.gold });
      this.addDirectionalTrauma(0.8, 0, 0);
      try {
        playExplosion();
        playWinJingle();
      } catch {}
      return;
    }

    const aliveCount = this.players.filter((p) => p.isJoined && p.isAlive && !p.isDowned).length;
    if (aliveCount === 0) {
      this.state = 'MATCH_OVER';
      this.matchResult = 'loss';
      this.resetInputSource();
      try { playLoseJingle(); } catch {}
    }
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !data) return;
    const isAimRelease = data.action === 'AIM_RELEASE' || data.intent?.phase === 'release';
    if (this.state !== 'PLAYING' && !isAimRelease) return;
    if (player.isDowned && !isAimRelease) return;

    if (this.applyAimLifecycleInput(slotIndex, data)) return;

    if (isInputIntent(data, 'aim') || data.action === 'AIM_MOVE') {
      this.handleSlotAim(slotIndex, data, { source: data.intent?.source || 'network' });
      return;
    }
    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE') {
      const dx = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
      const dy = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : Math.hypot(dx, dy);
      const joy = this.joysticks?.[slotIndex];
      if (joy) {
        joy.active = force > 0.05;
        joy.angle = Number.isFinite(data.angle) ? data.angle : Math.atan2(dy, dx);
        joy.force = force;
      }
      player.steerX = joy?.active ? dx : 0;
      player.steerY = joy?.active ? dy : 0;
      return;
    }
    if (matchesInputAction(data, 'dash', 'DASH')) {
      this.performPlayerDash(player);
    }
  }

  createWorldPacket() {
    return createColossusWorldPacket(this);
  }

  render() {
    const ctx = this.ctx;
    ctx.save();

    paintBackdrop(ctx, this.viewport, this.arena, { mode: 'COLOSSUS' });
    this.applyScreenShake(ctx);

    const packet = this.createWorldPacket();
    if (packet) {
      drawColossusWorld(ctx, this.arena, packet, {
        now: performance.now(),
        roundId: packet.roundId,
        selfSlot: this.localControlSlot ?? -1,
      });
    }

    if (this.state === 'PLAYING') {
      this.renderControls(ctx);
    }

    const header = colossusHeaderStatus({ boss: this.boss });
    this.renderHUD(ctx, {
      guideTitle: t('hint.colossus'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: UI_COLORS.players,
      accent: UI_COLORS.danger,
      statusText: this.state === 'PLAYING' ? header.text : null,
      statusTone: this.state === 'PLAYING' ? header.tone : null,
      matchOverHeadline: this.matchResult === 'win' || this.matchResult === 'victory' || this.state === 'VICTORY'
        ? t('colossus.victory')
        : t('colossus.defeat'),
      matchOverRows: this.players
        .filter((player) => player.isJoined)
        .sort((a, b) => this.scores[b.index] - this.scores[a.index])
        .map((player) => ({
          color: player.color,
          name: player.name,
          value: `${this.scores[player.index] || 0}`,
          score: this.scores[player.index] || 0,
        })),
      onStart: () => this.startNewMatch(),
      onRestart: () => this.startNewMatch(),
      onSeatChange: (index) => {
        const player = this.players[index];
        if (!player) return;
        player.isJoined = this.isSlotJoined(index);
        player.slotType = this.slotTypes[index];
        player.isAlive = player.isJoined;
        try { playJoin(); } catch {}
      },
      customControls: (c) => {
        if (this.state !== 'LOBBY') return;
        const { cx, top, bottom, width, height } = this.arena;
        const bossDef = COLOSSUS_BOSSES[this.selectedBossId] || COLOSSUS_BOSSES.AEGIS;

        // 1. Boss Seçim Kartı (Üst Kenar — koltuk kartları ve Başlat düğmesiyle çakışmaz)
        const bossCardW = Math.min(360, width * 0.72);
        const bossCardH = 40;
        const bossCardX = cx - bossCardW / 2;
        const bossCardY = top + Math.max(8, height * 0.03);

        c.save();
        c.fillStyle = UI_COLORS.ink;
        c.fillRect(bossCardX + 3, bossCardY + 3, bossCardW, bossCardH);
        c.fillStyle = UI_COLORS.card;
        c.fillRect(bossCardX, bossCardY, bossCardW, bossCardH);
        c.strokeStyle = bossDef.accentColor || UI_COLORS.line;
        c.lineWidth = Math.max(1.5, 2.5 * (this.arena?.unit ?? 1));
        c.strokeRect(bossCardX, bossCardY, bossCardW, bossCardH);

        c.fillStyle = UI_COLORS.ink;
        c.font = 'bold 12px "JetBrains Mono", system-ui, sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        const bossTitle = t(bossDef.titleKey) || bossDef.name;
        c.fillText(`< BOSS: ${bossDef.name} (${bossTitle}) >`, cx, bossCardY + bossCardH / 2);
        c.restore();

        this.uiButtons.push({
          x: bossCardX,
          y: bossCardY,
          w: bossCardW,
          h: bossCardH,
          onClick: () => this.cycleBossSelection(),
        });

        // 2. Oyuncu Silah Rozetleri (Alt Kenar — dokunma hedefleri >= 36px)
        const joinedPlayers = this.players.filter((p) => p.isJoined);
        if (joinedPlayers.length > 0) {
          const btnW = Math.min(126, (width * 0.84) / joinedPlayers.length - 8);
          const btnH = 36;
          const totalW = joinedPlayers.length * btnW + (joinedPlayers.length - 1) * 8;
          const startX = cx - totalW / 2;
          const btnY = bottom - btnH - Math.max(8, height * 0.03);

          joinedPlayers.forEach((p, idx) => {
            const bx = startX + idx * (btnW + 8);
            const wDef = COLOSSUS_WEAPONS[p.weaponId] || COLOSSUS_WEAPONS.RIFLE;
            const wName = t(wDef.nameKey) || p.weaponId;

            c.save();
            c.fillStyle = UI_COLORS.ink;
            c.fillRect(bx + 2, btnY + 2, btnW, btnH);
            c.fillStyle = p.color || UI_COLORS.card;
            c.fillRect(bx, btnY, btnW, btnH);
            c.strokeStyle = UI_COLORS.ink;
            c.lineWidth = Math.max(1, 2 * (this.arena?.unit ?? 1));
            c.strokeRect(bx, btnY, btnW, btnH);

            c.fillStyle = UI_COLORS.white;
            c.font = 'bold 11px system-ui, sans-serif';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(`${p.name}: ${wName}`, bx + btnW / 2, btnY + btnH / 2);
            c.restore();

            this.uiButtons.push({
              x: bx,
              y: btnY,
              w: btnW,
              h: btnH,
              onClick: () => this.cyclePlayerWeapon(p.index),
            });
          });
        }
      },
    });

    ctx.restore();

    const flashAlpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (flashAlpha > 0) {
      drawFxFlash(ctx, this.viewport.width, this.viewport.height, flashAlpha);
    }
  }
}
