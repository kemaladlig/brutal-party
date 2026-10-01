// BRUTAL HORDE — 1-4 oyunculu takım hayatta-kalma oyunu.
// Host authority: fizik, AI, wave ve terminal durumlar yalnız bu motorda ilerler.

import { playDashWhoosh, playDryFire, playExplosion, playJoin, playPaddleHit, playShoot, playStart, playStumble } from '../audio.js';
import { notifyFireBlocked, notifyFireShot } from '../core/fireFeedbackEffects.js';
import { resetFireFeedback, updateFireFeedback } from '../core/fireFeedback.js';
import { t } from '../i18n.js';
import { getBotPersona, getSlotCustomization } from '../core/customizationManager.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { buildLayout } from '../core/arenaKit.js';
import { getSecondActionKey, readSlotKeys } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import {
  clampToArena,
  damp,
  firstFreeDirection,
  getProjectileSubsteps,
  normalizeAngle,
  pointBlocked,
  resolveAABB,
  segmentAabbIntersection,
  segmentCircleIntersection,
} from '../core/physics2d.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { findAutoAimTarget } from '../core/autoAim.js';
import { createPlayer, tickEffectTimers } from '../core/playerEntity.js';
import { collectPickups, spawnPickup, tickPickupTimers } from '../core/pickupSystem.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { updateHordeBotAI } from '../ai/hordeAI.js';
import {
  HORDE_ARMORY_WEAPONS,
  HORDE_AVOID,
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
  drawHordeFxLayer,
  drawHordeWorld,
  hordeHeaderStatus,
  mapHordeScene,
} from './hordeView.js';
import { drawFxFlash } from './worldCore.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { fxFlashAlpha } from '../core/fxKit.js';

export const HORDE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2D6A4F'];

const ENEMY_BLOOD = '#E63946';
const ENEMY_HEAL = '#16A34A';

export const HORDE_TUNING = Object.freeze({
  ROUNDS: 3,
  WAVES_PER_ROUND: 3,
  MAX_HP: 5,
  PLAYER_RADIUS: 30, // FIELD_TIERS §normal bandı (28–36); eski 19 + okunurluk çarpanı yerine doğrudan iri gövde
  // Orantılı taban YOK, ama MUTLAK CSS px tabanı VAR (`LEGIBILITY_PX`).
  //
  // Önce `PLAYER_R_MIN: 0.024` / `ENEMY_R_MIN: 0.022` vardı; bunlar saha
  // YÜZDESİ olduğu için MASAÜSTÜNDE de devreye giriyordu (oyuncu +%43,
  // chaser +%31) ve NPC'ler birbirine yaklaşıp boyut çeşitliliğini
  // yitiriyordu. Orantı tabanı PRENSİPTE telefonda da işe yaramaz:
  // `unit = size/952` orantıyı birebir korur, 24" monitörde 15px olan gövde
  // 6" ekranda 6px'tir. Yani "oran" doğruydu ama FİZİKSEL HEDEF küçüktü.
  //
  // Ölçülen durum: telefonda oyuncu çapı 12px (karınca), mermiler oyuncunun
  // 7.5 katı hızda (bkz. `LEGIBILITY_PX` ve mermi ölçeği notları). Bu
  // yüzden iki AYRI önlem var:
  //   1) Tasarım yarıçapları ×1.27 büyütüldü → web'de de okunur.
  //   2) `LEGIBILITY_PX` tabanı → telefonda tüm gövdeler birlikte büyür.
  //
  // (2) bütün gövdelere TEK çarpan olarak uygulanır (`bodyScale`), böylece
  // oyuncu/düşman oranı ve isabet zorluğu DEĞİŞMEZ; sadece hepsi birden
  // okunur olur. `Math.max(1, …)` sayesinde masaüstünde `1`'dir: hiçbir
  // şeyi şişirmez, sadece küçük sahada devreye girer.
  LEGIBILITY_PX: 11,
  // 155 "ağır basıyordu": sahayı 6,14 sn'de geçiyordu — 15 oyun içinde en
  // yavaş ikinci. 168 → A 5,67 sn, B 2,80 gövde/sn; bant kilidi
  // `movementBudget.test.mjs §A` (maxA 6,2 / minB 2,5) içinde kalır.
  MOVE_SPEED: 168,
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
  PORTAL_RADIUS: 60,
  WAVE_LIMIT: 90,
  WAVE_BREAK_TIME: 2.4,
  ROUND_BREAK_TIME: 15,
  LOADOUT_RADIUS: 34,
  PICKUP_EVERY: 8,
  PICKUP_MAX: 4,
  // Power-up ÇAPı tasarım px. `spawnPickup`'ta `size` alanı çaptır, gövde
  // yarıçapı ise `bodyPx(30)`: 30 yazılıyken pickup oyuncunun yarısı kadardı
  // (telefonda 12,2px çap / 24,4px oyuncu) ve sahada okunmuyordu.
  PICKUP_SIZE: 48,
  // Vurulma geri bildirimi: gövdeyi 6 kare saf beyaza boyamak tür rengini ve
  // silueti siliyordu. Artık flash yalnız kontur + anlık büyüme (hordeView),
  // süresi burada durur.
  HIT_FLASH: 0.16,
  // Knockback bir konum sıçraması değil itilmedir: `KNOCK_RETAIN_60` kare
  // başı sönümle (60 Hz referans) katedilen toplam mesafe = verilen
  // `knockback`. `damp()` sayesinde kare hızından bağımsız.
  KNOCK_RETAIN_60: 0.72,
  MAX_ENEMIES: HORDE_VIEW_LIMITS.enemies,
  MAX_PROJECTILES: 96,
  // Şarjör yenileme: bu süre boyunca ateş edilmezse (meşgul olmasa bile) kısmen
  // dolu şarjör kendini yeniden doldurur. Ateş her zaman sayacı sıfırlar.
  AUTO_RELOAD_DELAY: 3,
});

// Gövde yarıçapları. Geçmiş: 14/16/18/21 → 17/20/22/26 → 19/23/25/30 →
// 15/25/21/33/28. Bu turda **hepsi ×1.27**: kullanıcı telefonda oynarken
// "kendi karakterim karınca gibi küçük" ve "rakipler öyle" dedi; web'de de
// "biraz küçük kalmış" dedi. Yani istek hem tasarım hem okunurluk.
//
// ×1.27 sonrası bağıl oranlar korunuyor (oyuncu/chaser 0.60 → 0.59) ve
// `BOSS_BASE` aynı çarpanı alıyor (chaser/tank 1.96 → 1.96).
// `minPassage` en büyük gövdeden (tank) türediği için taban da yükselir;
// `arenaLayout.test.mjs` bunu `BODY_RADIUS.HORDE` üzerinden doğruluyor.
//
// HIZLARA DOKUNULMADI (171 = 5.6sn saha geçişi, sağlıklı). Ölçülen
// "çok hızlı" hissi HAREKETTEN değil, mermilerden geliyordu: oyuncu mermisi
// `fieldSpeed`'ten geçerken `ENEMY_SHOT_SPEED` ve `weapon.projectileSpeed`
// geçmiyordu. Telefonda mermi/oyuncu hızı oranı masaüstünün 2.5 katıydı
// (düşman 3.92'ye karşı 1.58) → "sürekli uçan mermiler" hissi. İki taraf
// birlikte ölçeklenince oyuncu/düşman mermisi oranı (1.93) KORUNUR ve
// kaçma zorluğu masaüstüyle aynı olur.
const ENEMY_BASE = Object.freeze({
  chaser: { hp: 3, radius: 32, speed: 101, damage: 1, attackEvery: 0.95 },
  shooter: { hp: 2, radius: 27, speed: 70, damage: 1, attackEvery: 1.55 },
  tank: { hp: 8, radius: 42, speed: 40, damage: 2, attackEvery: 1.8 },
  healer: { hp: 5, radius: 36, speed: 61, damage: 0, attackEvery: 3.2 },
});

// Boss'lar tabanla aynı oranı korur (chaser 49/25=1.96 → 62/32=1.94, tank
// 64/33=1.94 → 81/42=1.93).
const BOSS_BASE = Object.freeze({
  chaser: { hp: 42, radius: 62, speed: 104, damage: 2, attackEvery: 0.8 },
  shooter: { hp: 30, radius: 53, speed: 76, damage: 2, attackEvery: 1.15 },
  tank: { hp: 62, radius: 81, speed: 40, damage: 3, attackEvery: 1.45 },
  healer: { hp: 36, radius: 60, speed: 66, damage: 1, attackEvery: 2.6 },
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
    this.controlMode = 'HORDE';
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
    // FX runtime (MOTION_PLAN Faz 2a): partikül/ring/pop/hit-stop tek sahibi;
    // `this.particles` worldCore konvansiyonu için alias'tır.
    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    /** @type {any[]} */ this.particles = this.fx.particles;
    this.floatingTexts = [];
    this.portal = null;
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.roundId = 0;
    this.waveTimer = /** @type {number} */ (HORDE_TUNING.WAVE_LIMIT);
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
        radius: this.bodyPx(HORDE_TUNING.PLAYER_RADIUS),
        speed: fieldSpeed(this.arena, HORDE_TUNING.MOVE_SPEED),
        baseSpeed: fieldSpeed(this.arena, HORDE_TUNING.MOVE_SPEED),
        isJoined: slotType !== 'empty',
        isAlive: slotType !== 'empty',
        slotType,
        existingName: existing?.name || (bot ? persona.name : `P${index + 1}`),
        expression: existing?.expression || custom.expression,
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
      player.idleReloadTimer = 0;
      player.weaponSwingTimer = 0;
      player.upgrades = {};
      player.loadoutChoiceCrateId = null;
      player.steerX = 0;
      player.steerY = 0;
      player.targetAngle = spawn.angle;
      player.angle = spawn.angle;
      player.isAiming = false;
      player.keyDashLatch = false;
      player.keyFireLatch = false;
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

  /**
   * Küçük saha okunurluk çarpanı: TASARIM px → cihaz px gövde ölçeği.
   *
   * `fieldRadius` orantıyı (`size/952`) korur, ama orantı fiziksel hedef
   * DEĞİLDİR: 24" monitörde 15px gövde, 6" telefon ekranında 6px'tir. Bu
   * yüzden telefonda oyuncu 12px çaplı "karınca" oluyordu. Çarpan, oyuncu
   * gövdesini `LEGIBILITY_PX`'e (11px yarıçap) getirecek kadar büyütür.
   *
   * `Math.max(1, …)` masaüstünde tam olarak 1'dir: hiçbir şeyi şişirmez.
   * Bütün gövde yarıçapları (oyuncu, düşman, boss, mermi, kasa, halka) TEK
   * bu çarpandan geçtiği için oyuncu/düşman oranı ve isabet zorluğu sabit
   * kalır — yalnız hepsi birden okunur olur.
   */
  bodyScale() {
    const unit = this.arena.unit || 1;
    return Math.max(1, HORDE_TUNING.LEGIBILITY_PX / (HORDE_TUNING.PLAYER_RADIUS * unit));
  }

  /** Gövde çarpanından geçmiş uzamsal değer (tasarım px → cihaz px). */
  bodyPx(designPx, minFraction = 0) {
    return fieldRadius(this.arena, designPx * this.bodyScale(), minFraction);
  }

  /** Saha ile ölçeklenen zaman-uzamsal değer (tasarım px/sn → cihaz px/sn). */
  bodySpeed(designPxPerSec) {
    return fieldSpeed(this.arena, designPxPerSec);
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const oldObstacles = (this.obstacles || []).map((obstacle) => ({ ...obstacle }));

    this.arena = computePlayfield(width, height, 'roomy');

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
    // Biriken partiküller ESKİ arena ölçeğindeydi; yeni unit ile karışmasın.
    this.fx.clear();
  }

  buildMap(round = this.round) {
    const map = getHordeMap(round);
    this.mapTheme = map.id;
    // Geçiş tabanı oyuncu çapından türer: en dar cep karakterin çapından geniş
    // olmalı. HORDE'da en büyük düşman (tank, 21px) oyuncudan (16px) büyük
    // olduğu için geçiş en büyük düşman çapından türetilir — değilse düşmanlar
    // boşluğa sıkışır.
    this.obstacles = this.arena.size > 0
      ? buildLayout(map.layout, this.arena, {
        minPassage: this.bodyPx(ENEMY_BASE.tank.radius) * 2.4,
      })
      : [];
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
    this.fx.clear();
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
      player.idleReloadTimer = 0;
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
      resetFireFeedback(player);
      player.isAiming = false;
      player.keyDashLatch = false;
      player.keyFireLatch = false;
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
      knockVx: 0,
      knockVy: 0,
      radius: this.bodyPx(base.radius * (elite ? 1.12 : 1)),
      speed: fieldSpeed(this.arena, base.speed * (elite ? 1.08 : 1)),
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
      avoidTimer: 0,
      avoidX: 0,
      avoidY: 0,
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
    const rawDt = this.clampDt(timestamp, this.lastTime);
    this.lastTime = timestamp;
    // HORDE istisnası: hit-stop YALNIZ sunumu yavaşlatır, simülasyonu değil.
    // 3 tetikçi (1 insan + 2 bot) her vuruşta `hit`/`slay` basınca global saat
    // `Math.max` ile kilitlenip oyun sürekli slow-mo'ya giriyor, basılı ateşte
    // mermi de aynı dt ile ilerlediği için oyuncunun mermisi yavaşlıyordu.
    // `fxDt` yalnız travma sönümü + partikül/halka/pop içindir; oyun mantığı
    // ham `rawDt` ile akar. Elit/boss `kill`'deki kısa yavaşlama + flaş özel
    // an olarak sunumda kalır, akışı kesmez.
    const fxDt = this.fx.tick(rawDt);
    this.updateTrauma(fxDt);
    this.fx.update(fxDt);
    const dt = rawDt;

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
        size: this.bodyPx(HORDE_TUNING.PICKUP_SIZE),
        pad: this.bodyPx(24),
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
    if (player.attackCooldown > 0) {
      player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    }
    updateFireFeedback(player);
    if (!player.isAlive) {
      player.steerX = 0;
      player.steerY = 0;
      player.isAiming = false;
      player.aimHoldAuto = false;
      return;
    }

    if (isBot(player)) updateHordeBotAI(this, player, dt);
    else this.updateHumanInput(player, dt, allowFire);

    const aim = this.getAimVector(player.index);
    const aimState = this.getAimState(player.index);
    const angleDiff = normalizeAngle((player.targetAngle || 0) - player.angle);
    if (player.isAiming && aimState?.active) {
      player.angle += angleDiff * Math.min(1, dt * 32);
    } else {
      player.angle += angleDiff * Math.min(1, dt * 16);
    }
    if (allowFire && player.slotType === 'human' && player.isAiming && player.attackCooldown > 0) {
      notifyFireBlocked(player);
    }
    if (allowFire && player.isAiming && player.attackCooldown <= 0) this.firePlayer(player);
    // Basılı tap: aim alanı yönsüz basılı tutulunca tap'ın tam otomatik hâli —
    // her atışta en yakın düşmana kilitlenir. Kapılar ateş edilebilir durumda
    // çağırır; curur/blocked geri bildirimi spam olmaz.
    if (player.aimHoldAuto && player.attackCooldown <= 0 && player.reloadTimer <= 0) {
      const holdWeapon = getPlayerWeapon(player);
      if (holdWeapon.kind === 'melee' || player.ammo > 0) {
        if (!this.snapAimToNearestEnemy(player)) player.targetAngle = player.angle;
        player.aimHoldFired = true;
        this.firePlayer(player);
      }
    }

    const speed = this.bodySpeed(HORDE_TUNING.MOVE_SPEED)
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
    } else {
      player.steerX = 0;
      player.steerY = 0;
    }
    const aimState = this.getAimState(player.index);
    const aim = this.getAimVector(player.index);
    if (aimState?.active) {
      player.targetAngle = aim.angle;
    } else if (magnitude > 0.05) {
      player.targetAngle = Math.atan2(movement.y, movement.x);
    }

    const keyboard = readSlotKeys(this.keys, player.index);
    if (keyboard.action) {
      if (!player.keyFireLatch) {
        const angle = player.targetAngle ?? player.angle;
        this.handleSlotAimStart(player.index, {
          dx: Math.cos(angle),
          dy: Math.sin(angle),
          angle,
          force: 1,
        }, { source: 'keyboard' });
        player.keyFireLatch = true;
      }
    } else if (player.keyFireLatch) {
      player.keyFireLatch = false;
      const angle = player.targetAngle ?? player.angle;
      this.handleSlotAimEnd(player.index, {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        angle,
        force: 1,
      }, { source: 'keyboard', cancelled: false });
    }
    const currentAimState = this.getAimState(player.index);
    if (currentAimState?.active) player.targetAngle = currentAimState.vector.angle;
    const aimHeld = currentAimState?.held === true;
    const aimFiring = this.isHoldToFireAim() && aimHeld && currentAimState.active;
    player.isAiming = allowFire && aimFiring;
    // Yönsüz basılı tutma (tap'ın tutulan hâli): sürükleme yoksa kilit auto-aim'de.
    player.aimHoldAuto = !!allowFire && this.isHoldToFireAim() && aimHeld
      && !currentAimState.active && !!this.getPlainAimHold(player.index);
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
      const angle = player.angle;
      const input = {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        angle,
        force: 1,
      };
      if (isDown) this.handleSlotAimStart(slotIndex, input, { source: 'touch' });
      else this.handleSlotAimEnd(slotIndex, input, { source: 'touch', cancelled: false });
    } else if (actionId === 'dash' && isDown) {
      this.triggerDash(slotIndex);
    }
  }

  onSlotAimHold(slotIndex, isDown, { cancelled = false, tap = false, previousHeld = false } = {}) {
    const player = this.players[slotIndex];
    if (!player?.isJoined || !player.isAlive) return;
    if (isDown && !previousHeld) player.aimHoldFired = false;
    const aimState = this.getAimState(slotIndex);
    player.isAiming = isDown && this.state === 'PLAYING' && this.isHoldToFireAim() && aimState?.active === true;
    // HOLD_TO_FIRE'da tap tek başına ateş üretmez (basılı-tutma + force
    // gerekir); hızlı dokunma tek atışlık auto-aim epizodudur. Basılı tutma
    // sırasında otomatik atış çıktıysa tap tekrar sıkmaz (çift atış yok).
    if (!isDown && tap && !cancelled && !isBot(player) && !player.aimHoldFired) {
      if (!this.snapAimToNearestEnemy(player)) {
        player.targetAngle = player.angle;
      }
      this.firePlayer(player);
    }
  }

  snapAimToNearestEnemy(shooter) {
    const hit = findAutoAimTarget(shooter, this.enemies, {
      maxRange: fieldRadius(this.arena, 900, 0.35),
      valid: (e) => !(e.spawnDelay > 0) && e.hp > 0,
    });
    if (hit) {
      shooter.targetAngle = hit.angle;
      shooter.angle = hit.angle;
    }
    return hit;
  }

  updatePlayerWeapon(player, dt) {
    if (player.weaponSwingTimer > 0) player.weaponSwingTimer = Math.max(0, player.weaponSwingTimer - dt);
    // Şarjör yenileme: yalnız oyun sırasında, kısmen/boş dolu ateşli silahta ve
    // yeniden doldurma sürmediğinde sayaç birikir. Ateş (`firePlayer`) sayacı
    // sıfırlar; 3 sn (AUTO_RELOAD_DELAY) ateşsiz bekleyen oyuncu — nişan alsa
    // bile — şarjörü otomatik doldurur. Böylece yarı boş şarjörle dalga arası
    // beklerken "el boş gibi" kalmak yerine hazırda tam dolu olur.
    const weapon = getPlayerWeapon(player);
    if (
      this.state === 'PLAYING'
      && weapon.kind === 'gun'
      && Number.isFinite(weapon.magazine)
      && player.reloadTimer <= 0
      && player.ammo < weapon.magazine
    ) {
      player.idleReloadTimer = (Number(player.idleReloadTimer) || 0) + dt;
      if (player.idleReloadTimer >= HORDE_TUNING.AUTO_RELOAD_DELAY) {
        player.idleReloadTimer = 0;
        this.startReload(player);
      }
    } else {
      player.idleReloadTimer = 0;
    }
    if (player.reloadTimer <= 0) return;
    player.reloadTimer = Math.max(0, player.reloadTimer - dt);
    if (player.reloadTimer === 0) {
      player.ammo = Number.isFinite(weapon.magazine) ? weapon.magazine : -1;
      player.idleReloadTimer = 0;
    }
  }

  startReload(player) {
    const weapon = getPlayerWeapon(player);
    if (!Number.isFinite(weapon.magazine) || player.reloadTimer > 0) return;
    player.reloadTimer = Math.max(0.08, getReloadTime(player));
  }

  firePlayer(player) {
    if (this.state !== 'PLAYING' || !player?.isAlive) return;
    if (player.attackCooldown > 0) {
      notifyFireBlocked(player);
      return;
    }
    // Cephane bittiğinde iki SESSİZ yol vardı: yeniden doldurma sürerken
    // (`reloadTimer > 0`) ve şarjör boşken. Oyuncu ateş edemediğini
    // duyamıyordu — ölçülen geri bildirim eksikliği. `playDryFire` kuru tetik
    // sesi, `notifyFireBlocked` ise mevcut blocked görselini tetikler.
    // İkisi birlikte: ses "neden", rozet "ne yapıyorum" der.
    if (player.reloadTimer > 0) {
      playDryFire();
      notifyFireBlocked(player);
      return;
    }
    const weapon = getPlayerWeapon(player);
    if (weapon.kind === 'melee') {
      this.fireBlade(player, weapon);
      return;
    }
    if (player.ammo <= 0) {
      playDryFire();
      notifyFireBlocked(player);
      this.startReload(player);
      return;
    }

    let pellets = weapon.pellets;
    if (player.tripleTimer > 0) pellets += 2;
    // Mermi hızı DAHA ÖNCE ham px'ti (`weapon.projectileSpeed`), hareket
    // hızı ise `fieldSpeed`'ten geçiyordu. Telefonda mermi/oyuncu oranı
    // masaüstünün 2.5 katıydı → "sürekli uçan mermi" hissi. Oyuncu mermisi
    // VE düşman mermisi birlikte ölçeklenir: oyuncu/düşman mermisi oranı
    // (520/270 = 1.93) sabit kalır, kaçma zorluğu masaüstüyle eşitlenir.
    //
    // `life` TASARIM oranı olarak hesaplanır (`range / projectileSpeed`),
    // cihaz hızıyla değil: `range / speed` yazılsaydı ömre `1/unit` girerdi,
    // yani telefonda mermi 2.5 kat uzun yaşar ve 460px menzille 384px'lik
    // sahayı iki kez geçerdi. İkisi de tasarım px olduğu için birim düşer
    // ve ömür her cihazda 0.885 sn olur; kat edilen mesafe `460 * unit`.
    const speed = this.bodySpeed(weapon.projectileSpeed) * (player.fastTimer > 0 ? 1.12 : 1);
    const life = weapon.range / weapon.projectileSpeed;
    const knockback = this.bodyPx(weapon.knockback);
    for (let i = 0; i < pellets; i++) {
      const spread = pellets === 1 ? 0 : (i / (pellets - 1) - 0.5) * weapon.spread * 2;
      const angle = player.angle + spread + (Math.random() - 0.5) * weapon.spread * 0.35;
      this.addProjectile({
        owner: player.index,
        isEnemy: false,
        x: player.x + Math.cos(angle) * this.bodyPx(20),
        y: player.y + Math.sin(angle) * this.bodyPx(20),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: this.bodyPx(weapon.id === 'RIFLE' ? 5 : weapon.id === 'SHOTGUN' ? 4 : 6),
        damage: weapon.damage,
        life,
        color: weapon.color,
        knockback,
        pierce: weapon.pierce,
      });
    }
    player.ammo -= 1;
    player.attackCooldown = weapon.fireInterval * (player.fastTimer > 0 ? 0.88 : 1);
    notifyFireShot(player);
    // FX olayı: shot profili trauma bütçesini uygular; haptik insan koltuğuna.
    this.fx.emit('shot', {
      x: player.x + Math.cos(player.angle) * this.bodyPx(20),
      y: player.y + Math.sin(player.angle) * this.bodyPx(20),
      dirX: Math.cos(player.angle),
      dirY: Math.sin(player.angle),
      color: weapon.color,
      slot: player.index,
      haptic: player.slotType === 'human',
    });
    if (player.ammo <= 2) {
      playDryFire();
      playShoot();
    } else {
      playShoot();
    }
    player.idleReloadTimer = 0;
    if (player.ammo <= 0) this.startReload(player);
  }

  fireBlade(player, weapon) {
    player.weaponSwingTimer = Number.isFinite(weapon.swingTime) ? weapon.swingTime : 0.2;
    player.attackCooldown = weapon.fireInterval;
    notifyFireShot(player);
    player.idleReloadTimer = 0;
    // Yakın dövüş savruluşu: shot olayı (isabet görseli damageEnemy'den gelir).
    this.fx.emit('shot', {
      x: player.x + Math.cos(player.angle) * this.bodyPx(20),
      y: player.y + Math.sin(player.angle) * this.bodyPx(20),
      dirX: Math.cos(player.angle),
      dirY: Math.sin(player.angle),
      color: weapon.color,
      slot: player.index,
      haptic: player.slotType === 'human',
    });
    for (const enemy of this.enemies) {
      if (enemy.spawnDelay > 0) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > this.bodyPx(weapon.range) + enemy.radius) continue;
      const angle = Math.atan2(dy, dx);
      if (Math.abs(normalizeAngle(angle - player.angle)) > weapon.arc * 0.5) continue;
      if (this.hasBlockedShot(player.x, player.y, enemy.x, enemy.y)) continue;
      this.damageEnemy(enemy, weapon.damage, player.index, this.bodyPx(weapon.knockback), dx, dy);
    }
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
    this.fx.emit('pickup', {
      x: player.x, y: player.y, color: player.color, slot: player.index,
      haptic: player.slotType === 'human',
    });
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
    const placed = [];
    weaponIds.forEach((weaponId, index) => {
      const weapon = getPlayerWeapon({ weaponId });
      const pos = this.loadoutPosition(positions[index], placed);
      placed.push(pos);
      this.loadoutCrates.push({
        id: this._nextLoadoutId++,
        kind: 'weapon',
        weaponId,
        upgradeId: null,
        color: weapon.color,
        claimedBy: null,
        ...pos,
      });
    });
    const upgrade = HORDE_UPGRADES[upgradeId];
    const upgradePos = this.loadoutPosition(positions[3], placed);
    this.loadoutCrates.push({
      id: this._nextLoadoutId++,
      kind: 'upgrade',
      weaponId: null,
      upgradeId,
      color: upgrade.color,
      claimedBy: null,
      ...upgradePos,
    });
  }

  /**
   * Sandık yerini seçer. Adaylar SIRAYLA denenir: engelsiz VE daha önce
   * yerleştirilmiş sandıklardan yeterince uzak ilk aday kazanır. Böylece
   * engelin tercih edilen noktayı kapattığı haritalarda (courtyard) dört
   * sandık aynı merkez yedeğine düşüp üst üste binmez (bkz. round 3).
   * Hiçbir aday minGap'i tutturamazsa en az örtüşen seçilir.
   * @param {{ x: number, y: number }} offset
   * @param {Array<{ x: number, y: number }>} placed
   */
  loadoutPosition(offset, placed = []) {
    const size = Math.max(120, this.arena.size || 640);
    // Tercih edilen authored nokta, sonra çok halkalı aday ızgarası: courtyard
    // gibi dar geçitli haritalarda tek halka (0.27) engelle kapanıp dört sandığı
    // aynı yedeğe düşürüyordu. Farklı yarıçaplar boş koridor yakalar.
    const candidates = [
      { x: this.arena.cx + offset.x * size, y: this.arena.cy + offset.y * size },
      ...[0.22, 0.3, 0.38].flatMap((rr) => Array.from({ length: 8 }, (_, index) => {
        const angle = index * Math.PI / 4;
        return {
          x: this.arena.cx + Math.cos(angle) * size * rr,
          y: this.arena.cy + Math.sin(angle) * size * rr,
        };
      })),
      { x: this.arena.cx, y: this.arena.cy },
    ];
    const radius = this.bodyPx(HORDE_TUNING.LOADOUT_RADIUS);
    const minGap = radius * 2.4;
    let fallback = null;
    let fallbackDist = -Infinity;
    for (const candidate of candidates) {
      if (pointBlocked(candidate.x, candidate.y, this.obstacles, 48)) continue;
      let nearest = Infinity;
      for (const other of placed) {
        nearest = Math.min(nearest, Math.hypot(candidate.x - other.x, candidate.y - other.y));
      }
      if (nearest >= minGap) return { x: candidate.x, y: candidate.y, radius };
      if (nearest > fallbackDist) {
        fallbackDist = nearest;
        fallback = candidate;
      }
    }
    const point = fallback || candidates[candidates.length - 1];
    return { x: point.x, y: point.y, radius };
  }

  tryClaimLoadout(player) {
    if (!player?.isAlive || player.loadoutChoiceCrateId !== null) return;
    for (const crate of this.loadoutCrates) {
      if (crate.claimedBy !== null) continue;
      if (distanceSq(player.x, player.y, crate.x, crate.y) > (crate.radius + player.radius) ** 2) continue;
      crate.claimedBy = player.index;
      player.loadoutChoiceCrateId = crate.id;
      if (crate.kind === 'weapon') {
        player.weaponId = crate.weaponId;
        player.magazine = getPlayerWeapon(player).magazine;
      player.ammo = player.magazine;
        player.reloadTimer = 0;
        player.idleReloadTimer = 0;
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
      bot.idleReloadTimer = 0;
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
      player.idleReloadTimer = 0;
    }
  }

  updateEnemies(dt, alivePlayers) {
    // Tüm menzil bantları tasarım px'inden `bodyPx` ile geçer. Ham px
    // bırakılmıştı: 852×393'te saha 387px iken "dur" bandı 270px'ti, yani
    // sahanın %70'i — shooter'ın %92 kare hareketsiz kalmasının ölçülen
    // sebebi buydu (masaüstünde aynı kod %17). Kare başına düşman sayısıyla
    // çarpılmasınlar diye döngü dışında bir kez türetilir.
    const band = {
      keep: this.bodyPx(165),
      hold: this.bodyPx(270),
      healerKeep: this.bodyPx(245),
      lungeMin: this.bodyPx(100),
      lungeMax: this.bodyPx(280),
      coverProbe: this.bodyPx(HORDE_AVOID.probePx),
      healRangeSq: Math.pow(this.bodyPx(170), 2),
      shooterFire: this.bodyPx(350),
      healerFire: this.bodyPx(380),
    };
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

      if (enemy.isBoss) {
        enemy.specialTimer = (enemy.specialTimer || 5) - dt;
        if (enemy.specialTimer <= 0) {
          enemy.specialTimer = 4.5 + Math.random() * 2;
          const target = alivePlayers[Math.floor(Math.random() * alivePlayers.length)];
          if (target) {
            this.enemies.push({
              id: this._nextEnemyId++,
              type: 'bomb',
              isBoss: false,
              elite: false,
              x: target.x,
              y: target.y,
              vx: 0,
              vy: 0,
              radius: this.bodyPx(80),
              speed: 0,
              hp: 9999,
              maxHp: 9999,
              damage: 0,
              attackEvery: Infinity,
              attackTimer: 1.5,
              healTimer: Infinity,
              angle: 0,
              hitTimer: 0,
              spawnDelay: 0,
              lungeTimer: 0,
              lungeCooldown: 0,
              summonThresholds: [],
              summonIndex: 0,
            });
          }
        }
      }

      if (enemy.type === 'bomb') {
        if (enemy.attackTimer <= 0) {
          playExplosion();
          // İntihar bombacısı: kill profili (alan hasarı + flaş + travma).
          this.fx.emit('kill', {
            x: enemy.x, y: enemy.y, color: ENEMY_BLOOD, size: enemy.radius || 80,
          });
          for (const p of alivePlayers) {
            if (distanceSq(p.x, p.y, enemy.x, enemy.y) <= Math.pow(enemy.radius + p.radius, 2)) {
              this.damagePlayer(p, 2);
            }
          }
          enemy.hp = 0;
          const idx = this.enemies.indexOf(enemy);
          if (idx >= 0) this.enemies.splice(idx, 1);
        }
        continue;
      }

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
      if (enemy.type === 'shooter' && distance < band.keep) moveMultiplier = -0.8;
      else if (enemy.type === 'shooter' && distance <= band.hold) moveMultiplier = 0;
      else if (enemy.type === 'healer' && distance < band.healerKeep) moveMultiplier = -0.65;
      if (enemy.elite && enemy.type === 'chaser' && enemy.lungeCooldown <= 0 && distance > band.lungeMin && distance < band.lungeMax) {
        enemy.lungeTimer = 0.42;
        enemy.lungeCooldown = 2.8;
      }
      const moveSpeed = enemy.speed * (enemy.lungeTimer > 0 ? 2.2 : 1);
      // Engel taraması: istenen yön tıkalıysa açılı adaylardan ilk boş yön
      // seçilir ve `commitSeconds` boyunca kilitli kalır. Eski hâli (tek ileri
      // örnek + dikine strafe + kare başına rastgele taraf çevirme) düşmanı
      // sütun dibinde titretip köşeye sıkıştırıyordu.
      let moveX = nx * moveMultiplier;
      let moveY = ny * moveMultiplier;
      const desiredMag = Math.hypot(moveX, moveY);
      enemy.avoidTimer = Math.max(0, (enemy.avoidTimer || 0) - dt);
      if (desiredMag > 0.001) {
        if (enemy.avoidTimer > 0) {
          moveX = enemy.avoidX * desiredMag;
          moveY = enemy.avoidY * desiredMag;
        } else {
          const steer = firstFreeDirection(
            enemy.x,
            enemy.y,
            moveX,
            moveY,
            enemy.radius + band.coverProbe,
            this.obstacles,
            enemy.radius,
            HORDE_AVOID.fan,
          );
          moveX = steer.dirX * desiredMag;
          moveY = steer.dirY * desiredMag;
          if (steer.blocked) {
            enemy.avoidX = steer.dirX;
            enemy.avoidY = steer.dirY;
            enemy.avoidTimer = HORDE_AVOID.commitSeconds;
          }
        }
      }
      const moveLength = Math.hypot(moveX, moveY) || 1;
      enemy.x += (moveX / moveLength) * moveSpeed * dt;
      enemy.y += (moveY / moveLength) * moveSpeed * dt;

      // İtilme: konum sıçraması değil, sönümlü hız (vurunca ışınlanma hissi).
      const knockVx = enemy.knockVx || 0;
      const knockVy = enemy.knockVy || 0;
      if (knockVx || knockVy) {
        enemy.x += knockVx * dt;
        enemy.y += knockVy * dt;
        const retain = damp(HORDE_TUNING.KNOCK_RETAIN_60, dt);
        enemy.knockVx = knockVx * retain;
        enemy.knockVy = knockVy * retain;
        if (Math.abs(enemy.knockVx) < 1 && Math.abs(enemy.knockVy) < 1) {
          enemy.knockVx = 0;
          enemy.knockVy = 0;
        }
      }

      if (enemy.type === 'healer' && enemy.healTimer <= 0) {
        enemy.healTimer = enemy.isBoss ? 3 : 5;
        for (const ally of this.enemies) {
          if (ally === enemy || ally.hp >= ally.maxHp || distanceSq(enemy.x, enemy.y, ally.x, ally.y) > band.healRangeSq) continue;
          ally.hp = Math.min(ally.maxHp, ally.hp + 2);
          ally.hitTimer = HORDE_TUNING.HIT_FLASH;
        }
      }

      if (enemy.attackTimer <= 0) {
        if (enemy.type === 'shooter' && distance < band.shooterFire) {
          if (enemy.elite) {
            for (const offset of [-0.16, 0, 0.16]) this.fireEnemyProjectile(enemy, enemy.angle + offset, enemy.damage, ENEMY_BLOOD);
          } else {
            this.fireEnemyProjectile(enemy, enemy.angle, enemy.damage, ENEMY_BLOOD);
          }
          enemy.attackTimer = enemy.attackEvery;
        } else if (enemy.type === 'healer' && distance < band.healerFire) {
          const shots = enemy.isBoss ? 6 : 5;
          for (let i = 0; i < shots; i++) this.fireEnemyProjectile(enemy, enemy.angle + i * Math.PI * 2 / shots, 1, ENEMY_HEAL);
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
    const shotSpeed = this.bodySpeed(HORDE_TUNING.ENEMY_SHOT_SPEED);
    this.addProjectile({
      owner: enemy.id,
      isEnemy: true,
      x: enemy.x + Math.cos(angle) * (enemy.radius + this.bodyPx(6)),
      y: enemy.y + Math.sin(angle) * (enemy.radius + this.bodyPx(6)),
      vx: Math.cos(angle) * shotSpeed,
      vy: Math.sin(angle) * shotSpeed,
      radius: this.bodyPx(enemy.isBoss ? 8 : 6),
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
          this.fx.emit('spark', { x: projectile.x, y: projectile.y, color: projectile.color || '#1A1A1A' });
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

  damageEnemy(enemy, damage, ownerIndex, knockback = 0, dirX = 0, dirY = 0) {
    if (!enemy || enemy.hp <= 0) return;
    enemy.hp -= damage;
    enemy.hitTimer = HORDE_TUNING.HIT_FLASH;
    if (knockback > 0) {
      const magnitude = Math.hypot(dirX, dirY) || 1;
      // `knockback` cihaz px'inden KATEDİLECEK toplam mesafedir; bunu bir
      // karede pozisyona eklemek ("ışınlanma") yerine, o mesafeyi
      // `KNOCK_RETAIN_60` sönümüyle bitiren bir hız veriyoruz.
      // Toplam yol = v0 · τ, τ = -1 / (60 · ln(retain)).
      const tau = -1 / (60 * Math.log(HORDE_TUNING.KNOCK_RETAIN_60));
      const impulse = knockback / tau;
      enemy.knockVx = (enemy.knockVx || 0) + (dirX / magnitude) * impulse;
      enemy.knockVy = (enemy.knockVy || 0) + (dirY / magnitude) * impulse;
    }
    // Vuruş geri bildirimi: isabet yönünde hit olayı (burst + halka; zaman
    // dondurma YOK, sarsıntı kısık). Kalabalıkta her mermi izi akışı kesmesin
    // diye his burst/halka/pop + knockback + seste kalır. Sahibi insansa minik
    // sarsıntı + haptik onun koltuğuna; bot vuruşu sarsıntısızdır.
    const ownerForHaptic = this.players[ownerIndex];
    const hitByHuman = ownerForHaptic?.slotType === 'human';
    this.fx.emit('hit', {
      x: enemy.x, y: enemy.y,
      color: enemy.type === 'healer' ? ENEMY_HEAL : ENEMY_BLOOD,
      dirX, dirY, slot: ownerIndex,
      haptic: hitByHuman,
    }, { hitStop: false, traumaScale: hitByHuman ? 0.35 : 0 });
    if (enemy.hp > 0) return;
    const index = this.enemies.indexOf(enemy);
    if (index >= 0) this.enemies.splice(index, 1);

    if (enemy.elite || enemy.isBoss) {
      if (Math.random() < (enemy.isBoss ? 1.0 : 0.35)) {
        const types = ['HEAL', 'SHIELD', 'FAST', 'TRIPLE'];
        const type = types[Math.floor(Math.random() * types.length)];
        if (!this.pickups) this.pickups = [];
        if (this.pickups.length < HORDE_TUNING.PICKUP_MAX + 2) {
          this.pickups.push({
            x: enemy.x,
            y: enemy.y,
            type,
            radius: this.bodyPx(HORDE_TUNING.PICKUP_SIZE * 0.5),
            size: this.bodyPx(HORDE_TUNING.PICKUP_SIZE),
            animTime: 0,
            life: 14.0,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
    }

    const owner = this.players[ownerIndex];
    const points = enemy.isBoss ? 3 : enemy.elite ? 2 : 1;
    if (owner) this.scores[owner.index] += points;
    // Ölüm olayı: sıradan NPC `slay` (burst + halka + pop; zaman dondurma YOK,
    // FLAŞ YOK); elit/boss `kill` (tam bütçe + tek-ekran flaşı). Sıradan ölümde
    // his görselde kalır, sarsıntı insanda kısık / botta daha kısık; özel ölüm
    // an olarak flaş + sarsıntıyı korur (sim zaten ayrı saatte aktığı için
    // akış kesilmez). (§ fxKit, sunum-odaklı hit-stop)
    const eliteKill = enemy.isBoss || enemy.elite;
    const killByHuman = owner?.slotType === 'human';
    this.fx.emit(eliteKill ? 'kill' : 'slay', {
      x: enemy.x, y: enemy.y,
      color: eliteKill ? '#FACC15' : ENEMY_BLOOD,
      size: enemy.radius || 30, angle: enemy.angle || 0,
      dirX, dirY, slot: ownerIndex,
      haptic: killByHuman,
    }, eliteKill ? undefined : { hitStop: false, traumaScale: killByHuman ? 0.5 : 0.2 });
    this.spawnFloatingText(enemy.x, enemy.y - enemy.radius, `+${points}`, owner?.color || '#D84727');
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
    this.fx.emit('hit', {
      x: player.x, y: player.y, color: player.color, slot: player.index,
      haptic: player.slotType === 'human',
    });
    playStumble();
    if (player.hp <= 0) {
      player.hp = 0;
      player.isAlive = false;
      this.clearAimInput(player.index, null, true);
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
    const reviveRadiusSq = this.bodyPx(HORDE_TUNING.REVIVE_RADIUS) ** 2;
    for (let i = this.tombs.length - 1; i >= 0; i--) {
      const tomb = this.tombs[i];
      const reviving = alivePlayers.some((player) => distanceSq(player.x, player.y, tomb.x, tomb.y) <= reviveRadiusSq);
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
    const radius = this.bodyPx(HORDE_TUNING.PORTAL_RADIUS);
    const margin = radius + 8;
    const point = [
      { x: this.arena.cx, y: this.arena.top + margin },
      { x: this.arena.right - margin, y: this.arena.cy },
      { x: this.arena.cx, y: this.arena.bottom - margin },
      { x: this.arena.left + margin, y: this.arena.cy },
    ][side];
    return { ...point, side, radius, timer: 0 };
  }

  advanceWave() {
    if (this.wave >= HORDE_TUNING.WAVES_PER_ROUND) return;
    this.wave += 1;
    this.startWave();
    spawnPickup(this, {
      types: ['HEAL', 'SHIELD'],
      max: 1,
      obstacles: this.obstacles,
      size: this.bodyPx(HORDE_TUNING.PICKUP_SIZE),
      pad: this.bodyPx(28),
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
      player.attackCooldown = 0;
      player.reloadTimer = 0;
      resetFireFeedback(player);
      player.idleReloadTimer = 0;
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
      player.steerX = 0;
      player.steerY = 0;
    }
  }

  spawnFloatingText(x, y, text, color) {
    this.floatingTexts.push({ x, y, text, color, vy: -28, alpha: 1, decay: 1.2 });
    if (this.floatingTexts.length > HORDE_VIEW_LIMITS.texts * 2) this.floatingTexts.shift();
  }

  updateEffects(dt) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const entry = this.floatingTexts[i];
      entry.y += entry.vy * dt;
      entry.alpha -= entry.decay * dt;
      if (entry.alpha <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player?.isJoined || !data) return;
    const isAimRelease = data.action === 'AIM_RELEASE' || data.intent?.phase === 'release';
    if (!['PLAYING', 'ROUND_PAUSE'].includes(this.state) && !isAimRelease) return;
    if (!player.isAlive && !isAimRelease) return;
    const isAimPacket = data.action === 'AIM_PRESS'
      || data.action === 'AIM_MOVE'
      || data.intent?.type === 'aim'
      || data.intent?.id === 'aim';
    if (this.state !== 'PLAYING' && isAimPacket && !isAimRelease) return;
    if (this.applyAimLifecycleInput(slotIndex, data)) return;
    if (!player.isAlive) return;
    if (isInputIntent(data, 'aim') || data.action === 'AIM_MOVE') {
      this.handleSlotAim(slotIndex, data, { source: data.intent?.source || 'network' });
      return;
    }
    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE') {
      const dx = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
      const dy = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : Math.hypot(dx, dy);
      player.remoteMoveActive = force > 0.05;
      player.steerX = dx;
      player.steerY = dy;
      // Aim aktifken bakış yönü sağ çubuğundur: move paketi targetAngle
      // yazmaz, updateHumanInput aim önceliğiyle çözer. Aim yoksa move yönü geçerli.
      if (player.remoteMoveActive && Number.isFinite(data.angle) && !this.getAimState(slotIndex)?.active) {
        player.targetAngle = normalizeAngle(data.angle);
      }
      const joy = this.joysticks[slotIndex];
      if (joy) {
        joy.active = player.remoteMoveActive;
        joy.angle = Number.isFinite(data.angle) ? data.angle : Math.atan2(dy, dx);
        joy.force = force;
      }
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
      player.keyDashLatch = false;
      player.keyFireLatch = false;
    }
  }

  render() {
    const { ctx } = this;
    ctx.save();
    const scene = mapHordeScene(this, HORDE_TUNING);
    // Sahanın dışı (masa) sarsıntıdan ETKİLENMEZ: tepsi masanın üstünde kayar,
    // masa kaymaz. Bu yüzden backdrop `applyScreenShake`ten ÖNCE basılır.
    paintBackdrop(ctx, this.viewport, this.arena, { theme: scene.theme });
    this.applyScreenShake(ctx);

    drawHordeWorld(ctx, this.arena, scene, { withFx: this.state === 'PLAYING', now: this.lastTime, selfSlot: this.localControlSlot ?? -1 });
    // FX katmanı ortak hordeView draw'ından gelir (host↔client aynı).
    drawHordeFxLayer(ctx, { pops: this.fx.pops, rings: this.fx.rings, particles: this.particles });

    if (this.state === 'PLAYING') {
      this.renderControls(ctx, { extraEntities: this.enemies });
    }

    // Skor + durum TEK başlıktadır (skor solda, tur/dalga sağda).
    const header = hordeHeaderStatus(this);
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
      statusText: header.text,
      statusTone: header.tone,
      matchOverHeadline: this.matchResult === 'win' ? t('horde.victory') : t('horde.defeat'),
      matchOverRows: this.players
        .filter((player) => player.isJoined)
        .sort((a, b) => this.scores[b.index] - this.scores[a.index])
        .map((player) => ({ color: player.color, name: player.name, value: `${this.scores[player.index] || 0}`, score: this.scores[player.index] || 0 })),
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

    // Kill flaşı sahne transformunun DIŞINDA: tam ekranı kaplar (tanks deseni).
    const flashAlpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (flashAlpha > 0) drawFxFlash(ctx, this.viewport.width, this.viewport.height, flashAlpha);
  }
}
