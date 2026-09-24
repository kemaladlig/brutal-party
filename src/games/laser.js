// BRUTAL LASER v2: 2-4 oyunculu hareketli lazer-tag — koş, sekme önizlemesiyle
// nişan al, ateş et. 3 can + dash i-frame + respawn + 90sn kill yarışı + pickup.
// Tek çubuk: joystick yönü hem hareket hem nişan verir (it=koş+nişan, bırak=dur).
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playGunshot, playDashWhoosh, playItemPickup, playStumble } from '../audio.js';
import { t } from '../i18n.js';
import { renderArenaWatermarkTimer } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateLaserBotAI } from '../ai/laserAI.js';
import { readSlotKeys, getSecondActionKey } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { clampToArena, resolveAABB, updateMovers } from '../core/physics2d.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';
import {
  createLaserWorldPacket,
  mapLaserPlayers,
  drawLaserArena,
  drawLaserPickups,
  drawLaserAims,
  drawLaserShots,
  drawLaserPlayers,
} from './laserView.js';
import { drawCircleParticles, drawAlphaTexts } from './worldCore.js';

export const LASER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const LASER_NAMES = ['P1', 'P2', 'P3', 'P4'];

export const LASER_TUNING = {
  SPEED: 220,          // koşu hızı (px/s)
  AIM_SPEED_MULT: 0.50,// nişan alma / tetiğe basılı tutarken hız çarpanı (%50 yavaşlama, Archer stili)
  MAX_AMMO: 2,         // şarjör kapasitesi (mermi sayısı)
  RELOAD_TIME: 0.9,    // tek mermi dolum süresi (sn)
  SHOT_INTERVAL: 0.22, // ardışık iki atış arası tetik beklemesi (sn)
  FIRE_CD: 0.9,        // genel bekleme referansı
  MAX_ACTIVE: 3,       // oyuncu başına havada max seken lazer güvenlik tavanı
  LASER_SPEED: 620,    // lazer hızı (px/s)
  FAST_MULT: 1.45,     // ⚡ pickup hız çarpanı
  FAST_TIME: 8.0,      // ⚡ süresi (sn)
  TRIPLE_TIME: 8.0,    // 💥 üçlü lazer süresi (sn)
  BOUNCES: 4,          // sekme hakkı
  MAX_HP: 3,           // can
  INVULN: 0.8,         // vuruş sonrası dokunulmazlık (sn)
  RESPAWN: 2.0,        // yeniden doğma (sn)
  SPAWN_PROTECT: 1.5,  // doğma koruması (sn)
  DASH_MULT: 2.2,      // depar hız çarpanı
  DASH_TIME: 0.22,     // depar süresi (sn)
  DASH_CD: 4.0,        // depar bekleme (sn)
  MATCH_TIME: 90,      // maç süresi (sn)
  TARGET_KILLS: 10,    // erken zafer kill sayısı
  PICKUP_EVERY: 10.0,  // pickup aralığı (sn)
};

export const LASER_MAPS = [
  { id: 'klasik', name: '01 // KLASİK ÇAPRAZ' },
  { id: 'siginak', name: '02 // MERKEZ SIĞINAK' },
  { id: 'koridor', name: '03 // HAÇ KORİDOR' },
];

function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class LaserGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.players = [];
    this.lasers = [];
    this.obstacles = [];
    this.movingWalls = [];
    this.pickups = [];
    this.particles = [];
    this.floatingTexts = [];
    this.keys = {};
    this.selectedMapIndex = 0;
    this.matchTimer = LASER_TUNING.MATCH_TIME;
    this.pickupTimer = LASER_TUNING.PICKUP_EVERY;
    this.pickupFlip = false;
    this.lastTime = performance.now();

    this.initKeyboard();
  }

  getTabletopSchema() {
    return {
      joystick: true,
      actions: [
        // Basılı tut = nişan (yavaşla), bırak = ateş; şarj barı isAiming'den gelir
        { id: 'fire', icon: '🎯', holdToCharge: true },
        { id: 'dash', icon: '⚡', cooldownField: 'dashCooldown', maxCooldown: LASER_TUNING.DASH_CD },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;
    if (actionId === 'fire') {
      if (isDown) {
        this.beginAim(player);
      } else {
        this.releaseAim(player);
      }
    } else if (actionId === 'dash' && isDown) {
      this.triggerDash(slotIndex);
    }
  }

  createWorldPacket() {
    return createLaserWorldPacket(this, LASER_TUNING);
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  keyboardInput(index) {
    const base = readSlotKeys(this.keys, index);
    return { dx: base.dx, dy: base.dy, fire: base.action, dash: !!this.keys[getSecondActionKey('dash', index)] };
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width ? Math.max(48, Math.floor(height * 0.12)) : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;

    this.arena = {
      cx: width / 2, cy: height / 2, width: arenaW, height: arenaH,
      size: Math.min(arenaW, arenaH), left: marginX, right: marginX + arenaW,
      top: marginY, bottom: marginY + arenaH,
    };

    this.buildMap();

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
    for (const lz of this.lasers) this.remapPoint(lz, oldArena, this.arena);
    for (const pk of this.pickups) this.remapPoint(pk, oldArena, this.arena);
  }

  buildMap() {
    this.obstacles = [];
    this.movingWalls = [];
    const { cx, cy, size, width, height, left, top } = this.arena;
    const preset = LASER_MAPS[this.selectedMapIndex]?.id || 'klasik';

    if (preset === 'siginak') {
      // 02 // MERKEZ SIĞINAK: Merkez blok küçültüldü + köşe dişler güvenli mesafede
      const bw = size * 0.17;
      this.obstacles.push({ x: cx - bw / 2, y: cy - bw / 2, w: bw, h: bw });
      const t = Math.max(16, size * 0.065);
      const margin = size * 0.22;
      this.obstacles.push(
        { x: left + margin, y: top + margin, w: t, h: t },
        { x: left + width - margin - t, y: top + margin, w: t, h: t },
        { x: left + margin, y: top + height - margin - t, w: t, h: t },
        { x: left + width - margin - t, y: top + height - margin - t, w: t, h: t }
      );

      // Hareketli duvarlar: Üst ve alt koridorda yavaşça yatay kayan 2 sürgülü siper
      const mwW = Math.max(36, size * 0.11);
      const mwH = Math.max(12, size * 0.032);
      const mSpd = Math.max(22, size * 0.07);
      this.movingWalls.push(
        {
          x: cx - mwW / 2,
          y: cy - size * 0.28,
          w: mwW,
          h: mwH,
          vx: mSpd,
          vy: 0,
          minX: cx - size * 0.2,
          maxX: cx + size * 0.2 - mwW,
          minY: cy - size * 0.28,
          maxY: cy - size * 0.28,
          axis: 'x',
        },
        {
          x: cx - mwW / 2,
          y: cy + size * 0.28 - mwH,
          w: mwW,
          h: mwH,
          vx: -mSpd,
          vy: 0,
          minX: cx - size * 0.2,
          maxX: cx + size * 0.2 - mwW,
          minY: cy + size * 0.28 - mwH,
          maxY: cy + size * 0.28 - mwH,
          axis: 'x',
        }
      );
    } else if (preset === 'koridor') {
      // 03 // HAÇ KORİDOR: Merkez geçiş boşluğu genişletildi (min 56px, karakter sıkışmaz)
      const gap = Math.max(56, size * 0.16);
      const th = Math.max(16, size * 0.045);
      const armLen = Math.max(30, size * 0.22 - gap / 2);
      this.obstacles.push(
        { x: cx - th / 2, y: cy - gap / 2 - armLen, w: th, h: armLen },
        { x: cx - th / 2, y: cy + gap / 2, w: th, h: armLen },
        { x: cx - gap / 2 - armLen, y: cy - th / 2, w: armLen, h: th },
        { x: cx + gap / 2, y: cy - th / 2, w: armLen, h: th }
      );

      // Hareketli duvarlar: Yan kanatlarda dikey kayan 2 mini koruma plakası
      const mwW = Math.max(12, size * 0.032);
      const mwH = Math.max(36, size * 0.11);
      const mSpd = Math.max(22, size * 0.07);
      this.movingWalls.push(
        {
          x: cx - size * 0.28,
          y: cy - mwH / 2,
          w: mwW,
          h: mwH,
          vx: 0,
          vy: mSpd,
          minX: cx - size * 0.28,
          maxX: cx - size * 0.28,
          minY: cy - size * 0.18,
          maxY: cy + size * 0.18 - mwH,
          axis: 'y',
        },
        {
          x: cx + size * 0.28 - mwW,
          y: cy - mwH / 2,
          w: mwW,
          h: mwH,
          vx: 0,
          vy: -mSpd,
          minX: cx + size * 0.28 - mwW,
          maxX: cx + size * 0.28 - mwW,
          minY: cy - size * 0.18,
          maxY: cy + size * 0.18 - mwH,
          axis: 'y',
        }
      );
    } else {
      // 01 // KLASİK ÇAPRAZ: Geçiş aralıkları artırıldı
      const bw = size * 0.13;
      const bh = Math.max(15, size * 0.04);
      this.obstacles.push(
        { x: cx - bw * 1.5, y: cy - bw, w: bw, h: bh },
        { x: cx + bw * 0.5, y: cy - bw, w: bw, h: bh },
        { x: cx - bw * 1.5, y: cy + bw - bh, w: bw, h: bh },
        { x: cx + bw * 0.5, y: cy + bw - bh, w: bw, h: bh },
        { x: cx - bh / 2, y: cy - bw * 1.4, w: bh, h: bw * 0.85 },
        { x: cx - bh / 2, y: cy + bw * 0.55, w: bh, h: bw * 0.85 }
      );

      // Hareketli duvarlar: Merkez çevresinde yavaş yatay kayan 2 dikey bar
      const mwW = Math.max(14, size * 0.035);
      const mwH = Math.max(34, size * 0.12);
      const mSpd = Math.max(20, size * 0.065);
      this.movingWalls.push(
        {
          x: cx - size * 0.22,
          y: cy - size * 0.24,
          w: mwW,
          h: mwH,
          vx: mSpd,
          vy: 0,
          minX: cx - size * 0.22,
          maxX: cx + size * 0.22 - mwW,
          minY: cy - size * 0.24,
          maxY: cy - size * 0.24,
          axis: 'x',
        },
        {
          x: cx + size * 0.22 - mwW,
          y: cy + size * 0.12,
          w: mwW,
          h: mwH,
          vx: -mSpd,
          vy: 0,
          minX: cx - size * 0.22,
          maxX: cx + size * 0.22 - mwW,
          minY: cy + size * 0.12,
          maxY: cy + size * 0.12,
          axis: 'x',
        }
      );
    }
  }

  spawnPoint(i) {
    const { left, right, top, bottom, size } = this.arena;
    const p = size * 0.14;
    const spawns = [
      { x: left + p, y: bottom - p, angle: -Math.PI / 4 },
      { x: left + p, y: top + p, angle: Math.PI / 4 },
      { x: right - p, y: top + p, angle: Math.PI * 0.75 },
      { x: right - p, y: bottom - p, angle: -Math.PI * 0.75 },
    ];
    return spawns[i] || spawns[0];
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((i) => {
      const existing = this.players[i];
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      const s = this.spawnPoint(i);
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || LASER_COLORS[i]),
        x: s.x, y: s.y, angle: s.angle, targetAngle: s.angle,
        steerX: 0, steerY: 0, kbx: 0, kby: 0,
        hp: LASER_TUNING.MAX_HP, cooldown: 0,
        ammo: LASER_TUNING.MAX_AMMO, reloadTimer: 0, shotCooldown: 0, isAiming: false,
        dashTimer: 0, dashCooldown: 0,
        invulnTimer: 0, respawnTimer: 0, fastTimer: 0, tripleTimer: 0,
        shield: false, wasReady: true,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        botCheckTimer: Math.random(), botStrafeDir: Math.random() < 0.5 ? 1 : -1,
        botRetarget: 0, keyFireLatch: false, keyDashLatch: false,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.roundWinner = null;
    this.matchTimer = LASER_TUNING.MATCH_TIME;
    this.pickupTimer = LASER_TUNING.PICKUP_EVERY;
    this.lasers = [];
    this.pickups = [];
    this.particles = [];
    this.floatingTexts = [];
    this.onTouchesReset();
    // Seçili harita korunur (BOMB deseni)
    this.buildMap();
    this.initPlayers();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.startRound();
  }

  startNewRound() {
    this.startRound();
  }

  startRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'PLAYING';
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.lasers = [];
    this.pickups = [];
    this.particles = [];
    this.floatingTexts = [];
    this.matchTimer = LASER_TUNING.MATCH_TIME;
    this.pickupTimer = LASER_TUNING.PICKUP_EVERY;
    this.selectedMapIndex = Math.floor(Math.random() * LASER_MAPS.length);
    this.buildMap();
    this.onTouchesReset();
    playStart();
    this.players.forEach((p) => {
      const s = this.spawnPoint(p.index);
      p.x = s.x; p.y = s.y;
      p.angle = s.angle; p.targetAngle = s.angle;
      p.steerX = 0; p.steerY = 0; p.kbx = 0; p.kby = 0;
      p.hp = LASER_TUNING.MAX_HP;
      p.isAlive = p.isJoined;
      p.cooldown = 0;
      p.ammo = LASER_TUNING.MAX_AMMO;
      p.reloadTimer = 0;
      p.shotCooldown = 0.3;
      p.isAiming = false;
      p.dashTimer = 0; p.dashCooldown = 0;
      p.invulnTimer = p.isJoined ? LASER_TUNING.SPAWN_PROTECT : 0;
      p.respawnTimer = 0; p.fastTimer = 0; p.tripleTimer = 0;
      p.shield = false; p.wasReady = true;
    });
  }

  spawnSparks(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 120;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        radius: 2 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 2.2,
      });
    }
  }

  spawnFloatingText(x, y, text, color) {
    this.floatingTexts.push({
      x, y,
      text,
      color,
      vy: -30,
      alpha: 1.0,
      decay: 1.2,
    });
  }

  beginAim(player) {
    if (this.state !== 'PLAYING') return;
    if (!player || !player.isJoined || !player.isAlive || player.respawnTimer > 0) return;
    player.isAiming = true;
  }

  releaseAim(player) {
    if (!player) return;
    player.isAiming = false;
    this.fireLaser(player);
  }

  fireLaser(player) {
    // Uzak/yakın tüm tetikleyiciler için kapı: PLAYING + canlı + katılmış
    if (this.state !== 'PLAYING') return;
    if (!player || !player.isJoined || !player.isAlive) return;
    if (player.respawnTimer > 0) return;
    if (player.shotCooldown > 0) return;
    if ((player.ammo ?? 2) <= 0) return;

    let active = 0;
    for (const lz of this.lasers) if (lz.owner === player.index) active++;
    if (active >= LASER_TUNING.MAX_ACTIVE) return;

    player.ammo = Math.max(0, (player.ammo ?? 2) - 1);
    player.shotCooldown = LASER_TUNING.SHOT_INTERVAL;
    const reloadDuration = player.fastTimer > 0 ? LASER_TUNING.RELOAD_TIME * 0.5 : LASER_TUNING.RELOAD_TIME;
    if (player.reloadTimer <= 0) {
      player.reloadTimer = reloadDuration;
    }
    player.cooldown = player.reloadTimer;

    playGunshot();
    const spd = LASER_TUNING.LASER_SPEED * (player.fastTimer > 0 ? LASER_TUNING.FAST_MULT : 1);
    
    // Triple Laser modu aktifse: 3 yöne ateş (-16°, 0°, +16°)
    const angles = player.tripleTimer > 0 ? [player.angle - 0.28, player.angle, player.angle + 0.28] : [player.angle];
    for (const ang of angles) {
      this.lasers.push({
        x: player.x + Math.cos(ang) * 20,
        y: player.y + Math.sin(ang) * 20,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        owner: player.index,
        color: player.color,
        bounces: LASER_TUNING.BOUNCES,
        history: [],
      });
    }
    this.addTrauma(0.12);
  }

  triggerDash(playerIndex) {
    // Uzak girdi kapısı: sadece PLAYING'de
    if (this.state !== 'PLAYING') return;
    const p = this.players[playerIndex];
    if (!p || !p.isJoined || !p.isAlive || p.respawnTimer > 0) return;
    if (p.dashCooldown > 0) return;
    p.dashCooldown = LASER_TUNING.DASH_CD;
    p.dashTimer = LASER_TUNING.DASH_TIME;
    this.addTrauma(0.12);
    playDashWhoosh();
  }

  damagePlayer(victim, laser) {
    if (!victim.isJoined || !victim.isAlive) return;
    // Dash i-frame + vuruş dokunulmazlığı
    if (victim.dashTimer > 0 || victim.invulnTimer > 0) return;

    // 🛡️ KALKAN VURULDUYSA: Hasarı tamamen absorbe et
    if (victim.shield) {
      victim.shield = false;
      victim.invulnTimer = 0.5;
      this.spawnSparks(victim.x, victim.y, '#0EA5E9', 16);
      this.spawnFloatingText(victim.x, victim.y - 20, '🛡️ KALKAN KORUDU!', '#0EA5E9');
      this.addTrauma(0.2);
      playStumble();
      return;
    }

    victim.hp -= 1;
    victim.invulnTimer = LASER_TUNING.INVULN;
    this.spawnSparks(victim.x, victim.y, laser.color, 8);
    // Geri tepme: lazer yönünde itiş
    const spd = Math.hypot(laser.vx, laser.vy) || 1;
    victim.kbx += (laser.vx / spd) * 260;
    victim.kby += (laser.vy / spd) * 260;
    if (victim.hp <= 0) {
      victim.isAlive = false;
      victim.respawnTimer = LASER_TUNING.RESPAWN;
      victim.steerX = 0; victim.steerY = 0;
      victim.shield = false; victim.fastTimer = 0; victim.tripleTimer = 0;
      this.spawnSparks(victim.x, victim.y, victim.color, 24);
      this.spawnFloatingText(victim.x, victim.y - 20, '+1 KILL ★', '#2F6A4F');
      const owner = this.players[laser.owner];
      if (owner && owner.isJoined) {
        this.scores[owner.index]++;
        if (this.scores[owner.index] >= LASER_TUNING.TARGET_KILLS) {
          this.endMatch(owner);
          return;
        }
      }
      this.addTrauma(0.5);
      playExplosion();
    } else {
      this.addTrauma(0.25);
      playStumble();
    }
  }

  endMatch(winnerOrNull) {
    this.state = 'MATCH_OVER';
    this.matchWinner = winnerOrNull;
  }

  finishOnTime() {
    let best = -1; let bestScore = -1; let tied = false;
    for (const p of this.players) {
      if (!p.isJoined) continue;
      if (this.scores[p.index] > bestScore) {
        bestScore = this.scores[p.index]; best = p.index; tied = false;
      } else if (this.scores[p.index] === bestScore) {
        tied = true;
      }
    }
    this.endMatch(tied ? null : this.players[best] || null);
  }

  spawnPickup() {
    spawnPickup(this, {
      types: ['HEAL', 'FAST', 'SHIELD', 'TRIPLE'],
      max: 2,
      obstacles: this.obstacles,
    });
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch, {
        onSeatChange: (corner) => {
          if (this.players[corner]) {
            this.players[corner].isJoined = this.isSlotJoined(corner);
            this.players[corner].slotType = this.slotTypes[corner];
          }
        },
      });
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => { this.resetMatch(); playJoin(); } });
      return;
    }

    if (this.state === 'PLAYING') {
      if (this.handleUiTap(touch)) return;
      this.handleTabletopTouchStart(touch);
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    this.handleTabletopTouchMove(touch);
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
    this.players.forEach((p) => {
      p.steerX = 0;
      p.steerY = 0;
      p.isAiming = false;
    });
  }

  collideObstacles(p, r) {
    const all = this.movingWalls.length ? [...this.obstacles, ...this.movingWalls] : this.obstacles;
    resolveAABB(p, all, r);
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    if (this.state !== 'PLAYING') return;

    // Hareketli duvarlar (ping-pong, yavaş & tahmin edilebilir)
    updateMovers(this.movingWalls, dt, 'pingpong');

    // Maç saati + pickup
    this.matchTimer -= dt;
    if (this.matchTimer <= 0) {
      this.matchTimer = 0;
      this.finishOnTime();
      return;
    }
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      this.pickupTimer = LASER_TUNING.PICKUP_EVERY;
      this.spawnPickup();
    }
    tickPickupTimers(this, dt);

    // 1. Oyuncular
    for (const player of this.players) {
      if (!player.isJoined) continue;

      if (player.shotCooldown > 0) player.shotCooldown -= dt;
      if (player.dashCooldown > 0) player.dashCooldown -= dt;
      if (player.dashTimer > 0) player.dashTimer -= dt;
      if (player.invulnTimer > 0) player.invulnTimer -= dt;
      if (player.fastTimer > 0) player.fastTimer -= dt;
      if (player.tripleTimer > 0) player.tripleTimer -= dt;

      // Mermi (ammo) dolum döngüsü
      const maxAmmo = LASER_TUNING.MAX_AMMO || 2;
      const reloadDuration = player.fastTimer > 0 ? LASER_TUNING.RELOAD_TIME * 0.5 : LASER_TUNING.RELOAD_TIME;
      if ((player.ammo ?? maxAmmo) < maxAmmo) {
        player.reloadTimer = (player.reloadTimer ?? reloadDuration) - dt;
        if (player.reloadTimer <= 0) {
          player.ammo = Math.min(maxAmmo, (player.ammo ?? 0) + 1);
          this.spawnSparks(
            player.x + Math.cos(player.angle) * 18,
            player.y + Math.sin(player.angle) * 18,
            player.color,
            6
          );
          if (player.ammo < maxAmmo) {
            player.reloadTimer = reloadDuration;
          } else {
            player.reloadTimer = 0;
          }
        }
      } else {
        player.reloadTimer = 0;
      }
      player.cooldown = player.reloadTimer;

      // Cooldown bittiğinde görsel mermi hazır flaşı
      let activeLasers = 0;
      for (const lz of this.lasers) if (lz.owner === player.index) activeLasers++;
      const isReadyNow = (player.ammo > 0) && (player.shotCooldown <= 0) && (activeLasers < LASER_TUNING.MAX_ACTIVE);
      if (isReadyNow && !player.wasReady) {
        this.spawnSparks(
          player.x + Math.cos(player.angle) * 18,
          player.y + Math.sin(player.angle) * 18,
          player.color,
          5
        );
      }
      player.wasReady = isReadyNow;

      // Geri tepme sönümü
      player.kbx *= Math.max(0, 1 - dt * 6);
      player.kby *= Math.max(0, 1 - dt * 6);

      if (!player.isAlive) {
        player.respawnTimer -= dt;
        if (player.respawnTimer <= 0) {
          const s = this.spawnPoint(player.index);
          player.x = s.x; player.y = s.y;
          player.angle = s.angle; player.targetAngle = s.angle;
          player.hp = LASER_TUNING.MAX_HP;
          player.isAlive = true;
          player.invulnTimer = LASER_TUNING.SPAWN_PROTECT;
          player.ammo = LASER_TUNING.MAX_AMMO;
          player.reloadTimer = 0;
          player.shotCooldown = 0.3;
          player.isAiming = false;
          player.cooldown = 0;
          player.shield = false;
          player.fastTimer = 0;
          player.tripleTimer = 0;
          playJoin();
        }
        continue;
      }

      if (player.slotType !== 'human') {
        updateLaserBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        const joy = this.joysticks[player.index];
        if (joy && joy.active && joy.force > 0.08) {
          player.steerX = Math.cos(joy.angle) * joy.force;
          player.steerY = Math.sin(joy.angle) * joy.force;
          player.targetAngle = joy.angle;
        } else if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
          player.targetAngle = Math.atan2(ki.dy, ki.dx);
        } else if (!player.remoteActive) {
          // Klavye bırakıldı: sadece kendi yazdığını siler (uzak/dokunmatik korunur)
          player.steerX = 0;
          player.steerY = 0;
        }

        // Nişan: klavye geçiş-temelli (latch) — uzak oyuncunun isAiming'ini
        // yerel tuş yokken boş frame'de tetiklemez; masa-ortası butonu basılıysa korur
        if (ki.fire) {
          if (!player.keyFireLatch) {
            this.beginAim(player);
            player.keyFireLatch = true;
          }
        } else if (player.keyFireLatch) {
          player.keyFireLatch = false;
          if (!this.tabletopActionState[player.index]?.fire) {
            this.releaseAim(player);
          }
        }
        if (ki.dash && !player.keyDashLatch) {
          this.triggerDash(player.index);
          player.keyDashLatch = true;
        } else if (!ki.dash) {
          player.keyDashLatch = false;
        }
      }

      // Nişan yumuşatma
      const diff = normalizeAngle(player.targetAngle - player.angle);
      player.angle += diff * Math.min(1.0, dt * 15);

      // Hareket: nişan alırken %50 yavaşlama (Archer stili), depar 2.2x, i-frame dash süresince
      let spd = LASER_TUNING.SPEED;
      if (player.isAiming) spd *= (LASER_TUNING.AIM_SPEED_MULT || 0.50);
      if (player.dashTimer > 0) spd *= LASER_TUNING.DASH_MULT;
      const mag = Math.hypot(player.steerX, player.steerY);
      if (mag > 0.05) {
        const nx = player.steerX / Math.max(1, mag);
        const ny = player.steerY / Math.max(1, mag);
        const f = Math.min(1, mag);
        player.x += nx * spd * f * dt;
        player.y += ny * spd * f * dt;
      }
      player.x += player.kbx * dt;
      player.y += player.kby * dt;

      clampToArena(player, 14, this.arena);
      this.collideObstacles(player, 14);

      // Pickup yeme
      collectPickups(this, player, {
        radiusOf: () => 14,
        onCollect: (g, p, pk) => {
          if (pk.type === 'HEAL') {
            p.hp = Math.min(LASER_TUNING.MAX_HP + 1, p.hp + 1);
            this.spawnFloatingText(p.x, p.y - 20, '❤ +1 CAN', '#2F6A4F');
          } else if (pk.type === 'FAST') {
            p.fastTimer = LASER_TUNING.FAST_TIME;
            this.spawnFloatingText(p.x, p.y - 20, t('laser.rapid'), '#FFDE59');
          } else if (pk.type === 'SHIELD') {
            p.shield = true;
            this.spawnFloatingText(p.x, p.y - 20, t('laser.shield'), '#0EA5E9');
          } else if (pk.type === 'TRIPLE') {
            p.tripleTimer = LASER_TUNING.TRIPLE_TIME;
            this.spawnFloatingText(p.x, p.y - 20, t('laser.triple'), '#F97316');
          }
        },
      });
    }

    // 2. Lazer fiziği (hıza oranlı alt-adım: mermi köşelerden geçmez)
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const laser = this.lasers[i];
      const steps = Math.max(1, Math.ceil((Math.hypot(laser.vx, laser.vy) * dt) / 5));
      let destroyed = false;

      for (let s = 0; s < steps; s++) {
        const subDt = dt / steps;
        laser.history.push({ x: laser.x, y: laser.y });
        if (laser.history.length > 10) laser.history.shift();

        laser.x += laser.vx * subDt;
        laser.y += laser.vy * subDt;

        if (laser.x < this.arena.left || laser.x > this.arena.right) {
          laser.vx *= -1;
          laser.x = Math.max(this.arena.left, Math.min(this.arena.right, laser.x));
          laser.bounces--;
          this.spawnSparks(laser.x, laser.y, laser.color, 4);
        }
        if (laser.y < this.arena.top || laser.y > this.arena.bottom) {
          laser.vy *= -1;
          laser.y = Math.max(this.arena.top, Math.min(this.arena.bottom, laser.y));
          laser.bounces--;
          this.spawnSparks(laser.x, laser.y, laser.color, 4);
        }

        const allObs = this.movingWalls.length ? [...this.obstacles, ...this.movingWalls] : this.obstacles;
        for (const obs of allObs) {
          if (laser.x > obs.x && laser.x < obs.x + obs.w && laser.y > obs.y && laser.y < obs.y + obs.h) {
            const dx1 = laser.x - obs.x;
            const dx2 = (obs.x + obs.w) - laser.x;
            const dy1 = laser.y - obs.y;
            const dy2 = (obs.y + obs.h) - laser.y;
            const min = Math.min(dx1, dx2, dy1, dy2);
            if (min === dx1 || min === dx2) laser.vx *= -1;
            else laser.vy *= -1;
            laser.bounces--;
            this.spawnSparks(laser.x, laser.y, laser.color, 4);
            break;
          }
        }

        if (laser.bounces < 0) {
          destroyed = true;
          break;
        }

        for (const p of this.players) {
          if (!p.isJoined || !p.isAlive) continue;
          if (p.index === laser.owner && laser.history.length < 8) continue;
          if (p.dashTimer > 0 || p.invulnTimer > 0) continue;

          if (Math.hypot(laser.x - p.x, laser.y - p.y) < 16) {
            this.damagePlayer(p, laser);
            destroyed = true;
            break;
          }
        }
        if (destroyed) break;
        if (this.state !== 'PLAYING') return;
      }

      if (destroyed) {
        this.lasers.splice(i, 1);
      }
      if (this.state !== 'PLAYING') return;
    }

    // Parçacıklar
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }

    // Uçuşan metinler
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy * dt;
      ft.alpha -= ft.decay * dt;
      if (ft.alpha <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE') {
      // Tek çubuk = koş + nişan (itince döner, bırakınca son nişanı korur)
      if (player.slotType !== 'human') return;
      player.steerX = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
      player.steerY = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
      if (Number.isFinite(data.angle) && (data.force || 0) > 0.05) {
        player.targetAngle = normalizeAngle(data.angle);
      }
    } else if (data.action === 'LASER_AIM') {
      this.beginAim(player);
    } else if (data.action === 'LASER_FIRE' || data.action === 'LASER_FIRE_RELEASE') {
      this.releaseAim(player);
    } else if (data.action === 'TANK_FIRE') {
      this.fireLaser(player);
    } else if (data.action === 'DASH') {
      this.triggerDash(slotIndex);
    }
  }

  // Nişan önizlemesi: Sınırlı menzil (uzağı göstermez) + en fazla 1 sekme
  traceAim(player) {
    const pts = [{ x: player.x, y: player.y }];
    let x = player.x + Math.cos(player.angle) * 20;
    let y = player.y + Math.sin(player.angle) * 20;
    let vx = Math.cos(player.angle);
    let vy = Math.sin(player.angle);
    let bounces = 1;
    const step = 7;
    const maxRange = Math.min(this.arena.size * 0.36, 190);
    let traveled = 0;
    pts.push({ x, y });
    const allObs = this.movingWalls.length ? [...this.obstacles, ...this.movingWalls] : this.obstacles;

    while (traveled < maxRange && bounces >= 0) {
      x += vx * step;
      y += vy * step;
      traveled += step;
      let bounced = false;
      if (x < this.arena.left || x > this.arena.right) {
        vx *= -1;
        x = Math.max(this.arena.left, Math.min(this.arena.right, x));
        bounced = true;
      }
      if (y < this.arena.top || y > this.arena.bottom) {
        vy *= -1;
        y = Math.max(this.arena.top, Math.min(this.arena.bottom, y));
        bounced = true;
      }
      for (const obs of allObs) {
        if (x > obs.x && x < obs.x + obs.w && y > obs.y && y < obs.y + obs.h) {
          const dx1 = x - obs.x;
          const dx2 = (obs.x + obs.w) - x;
          const dy1 = y - obs.y;
          const dy2 = (obs.y + obs.h) - y;
          const min = Math.min(dx1, dx2, dy1, dy2);
          if (min === dx1 || min === dx2) vx *= -1;
          else vy *= -1;
          bounced = true;
          break;
        }
      }
      if (bounced) {
        bounces--;
        pts.push({ x, y });
      }
    }
    pts.push({ x, y });
    return pts;
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    // Arena sahnesi ortak laserView draw'larından gelir (host↔client aynı).
    const withFx = this.state === 'PLAYING';
    const scenePlayers = mapLaserPlayers(
      this.players, this.lasers, LASER_TUNING, (p) => this.traceAim(p), withFx,
    );
    drawLaserArena(ctx, this.arena, this.obstacles, this.movingWalls);

    // Duvar ve engellerin üzerinde her zaman net görünen sayaç & köşe skorları
    if (this.state === 'PLAYING') {
      const remain = Math.max(0, Math.ceil(this.matchTimer));
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${remain}s`,
        subText: '',
        urgent: remain <= 10,
        alpha: remain <= 10 ? 0.70 : 0.46,
        ringProgress: Math.max(0, remain / 90),
      });

    }

    // Pickup'lar (Canlı İkon Rozetleri)
    drawLaserPickups(ctx, this.pickups);

    // Nişan önizlemeleri (canlı oyuncular, 2 sekme)
    if (withFx) drawLaserAims(ctx, scenePlayers);

    // Lazerler
    drawLaserShots(ctx, this.lasers);

    // Oyuncular
    drawLaserPlayers(ctx, scenePlayers, { arena: this.arena, withFx });

    // Parçacıklar (lazer kıvılcımları)
    drawCircleParticles(ctx, this.particles);

    // Uçuşan metinler (+1 KILL ★)
    drawAlphaTexts(ctx, this.floatingTexts, { size: 16, outline: true });

    if (this.state === 'PLAYING') {
      this.renderControls(ctx, { extraEntities: this.lasers });
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.laser'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: LASER_COLORS,
      accent: '#D84727',
      matchOverHeadline: this.matchWinner ? t('laser.champ') : t('game.draw'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .sort((a, b) => (this.scores[b.index] || 0) - (this.scores[a.index] || 0))
        .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★` })),
      onRestart: () => this.startNewMatch(),
      onSeatChange: (i) => {
        if (this.players[i]) {
          this.players[i].isJoined = this.isSlotJoined(i);
          this.players[i].slotType = this.slotTypes[i];
        }
        playJoin();
      },
      customControls: (c) => {
        // Harita seçici (start butonunun altında küçük buton)
        const mapName = LASER_MAPS[this.selectedMapIndex]?.name || '';
        const mw = 210; const mh = 34;
        const mx = this.arena.cx - mw / 2;
        const my = this.arena.cy + 78;
        c.save();
        c.fillStyle = '#FFFFFF';
        c.strokeStyle = '#1A1A1A';
        c.lineWidth = 3;
        c.fillRect(mx, my, mw, mh);
        c.strokeRect(mx, my, mw, mh);
        c.fillStyle = '#1A1A1A';
        c.font = 'bold 13px sans-serif';
        c.textAlign = 'center'; c.textBaseline = 'middle';
        c.fillText(`🗺 ${mapName}`, this.arena.cx, my + mh / 2);
        c.restore();
        this.uiButtons.push({
          x: mx, y: my, w: mw, h: mh,
          onClick: () => {
            this.selectedMapIndex = (this.selectedMapIndex + 1) % LASER_MAPS.length;
            this.buildMap();
            const s = this.spawnPoint.bind(this);
            this.players.forEach((p, i) => {
              const sp = s(i);
              p.x = sp.x; p.y = sp.y;
              p.angle = sp.angle; p.targetAngle = sp.angle;
            });
            playJoin();
          },
        });
      },
    });
    ctx.restore();
  }
}
