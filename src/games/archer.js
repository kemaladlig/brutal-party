// BRUTAL ARCHERY: 2-4 oyunculu okçuluk arenası — serbest hareket, basılı tutarak
// yay ger, bırakınca ok at. Nişan = bakış yönü + salınım (tam geriş daha stabil).
// Yakın mesafe vuruş 2 puan, uzak vuruş 1 puan. 60sn raundu en çok puanla bitiren
// raundu alır; 2 raund alan şampiyon.

import { playExplosion, playStart, playJoin, playItemPickup, playTeleport, playDashWhoosh, playPowerUp } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton, getSeatColorDotRect } from '../controlGuide.js';
import { t } from '../i18n.js';
import { getLocalSeatColors } from '../core/customizationManager.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver, renderArenaWatermarkTimer } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateArcherBotAI } from '../ai/archerAI.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { drawObstacle, drawPickup } from '../core/arenaKit.js';

export const ARCHER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const ARCHER_NAMES = ['P1', 'P2', 'P3', 'P4'];

const ARCHER_KEY_SLOTS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', action: 'Space' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', action: 'Enter' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', action: 'KeyO' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', action: 'KeyB' },
];

const ARCHER_RADIUS = 18;
const ARCHER_SPEED = 150;
const ARCHER_CHARGE_TIME = 1.0;
const ARCHER_SHOT_COOLDOWN = 0.8;
const ARCHER_ROUND_TIME = 60;
const ARCHER_CLOSE_DIST = 150;
const ARCHER_ARROW_LIFE = 1.1;
const ARCHER_PICKUP_TYPES = ['TURBO', 'TELEPORT', 'SLIP', 'MULTI', 'QUICKDRAW', 'SHIELD'];

export class ArcherGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.roundsToWin = 2;
    this.players = [];
    this.arrows = [];
    this.obstacles = [];
    this.particles = [];
    this.roundTime = ARCHER_ROUND_TIME;
    this.roundTimer = ARCHER_ROUND_TIME;
    this.pickups = [];
    this.pickupTimer = 8.0;
    this.mapIndex = 0;
    this.mapTime = 0;
    this.keys = {};
    this.roundTransitionTimer = 0;
    this.touches = [
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
    ];

    this.initKeyboard();
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
    const map = ARCHER_KEY_SLOTS[index];
    if (!map) return { dx: 0, dy: 0, action: false };
    const dx = (this.keys[map.r] ? 1 : 0) - (this.keys[map.l] ? 1 : 0);
    const dy = (this.keys[map.d] ? 1 : 0) - (this.keys[map.u] ? 1 : 0);
    return { dx, dy, action: !!this.keys[map.action] };
  }

  resize(width, height) {
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

    // Maç ortası resize ışınlamaz: geometri yenilenir, oyuncular orantılı taşınır
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
    for (const a of this.arrows) this.remapPoint(a, oldArena, this.arena);
  }

  buildMap() {
    this.obstacles = [];
    this.mapTime = 0;
    const { cx, cy, size } = this.arena;

    if (this.mapIndex === 1) {
      // CROSS — artı biçiminde orta duvarlar (kuzey/güney/doğu/batı kollar)
      const armL = size * 0.26;
      const armT = size * 0.055;
      this.obstacles.push(
        { x: cx - armL - armT / 2, y: cy - armT / 2, w: armL * 0.85, h: armT },
        { x: cx + armT / 2, y: cy - armT / 2, w: armL * 0.85, h: armT },
        { x: cx - armT / 2, y: cy - armL - armT / 2, w: armT, h: armL * 0.85 },
        { x: cx - armT / 2, y: cy + armT / 2, w: armT, h: armL * 0.85 },
        { x: cx - armT * 1.4, y: cy - armT * 1.4, w: armT * 2.8, h: armT * 2.8 }
      );
      return;
    }

    if (this.mapIndex === 2) {
      // SCATTER + MOVERS — dağınık bloklar + 2 hareketli duvar
      const bw = size * 0.13;
      this.obstacles.push(
        { x: cx - size * 0.30, y: cy - size * 0.05, w: bw, h: bw * 0.7 },
        { x: cx + size * 0.18, y: cy - size * 0.05, w: bw, h: bw * 0.7 },
        { x: cx - size * 0.05, y: cy - size * 0.30, w: bw * 0.7, h: bw },
        { x: cx - size * 0.05, y: cy + size * 0.20, w: bw * 0.7, h: bw },
        { x: cx - size * 0.34, y: cy - size * 0.34, w: bw * 0.8, h: bw * 0.8 },
        { x: cx + size * 0.28, y: cy + size * 0.28, w: bw * 0.8, h: bw * 0.8 }
      );
      // Hareketli duvarlar (sinek kaydırmalı — base + axis + amp)
      const mw = size * 0.05;
      this.obstacles.push(
        { x: cx - size * 0.22, y: cy + size * 0.40, w: size * 0.16, h: mw, mover: { baseX: cx - size * 0.22, baseY: cy + size * 0.40, axis: 'x', amp: size * 0.16, speed: 0.9, phase: 0 } },
        { x: cx + size * 0.40, y: cy - size * 0.22, w: mw, h: size * 0.16, mover: { baseX: cx + size * 0.40, baseY: cy - size * 0.22, axis: 'y', amp: size * 0.16, speed: 1.2, phase: Math.PI / 2 } }
      );
      return;
    }

    // PILLARS (varsayılan) — 4 köşe sütun + merkez alçak siper
    const bw = size * 0.16;
    this.obstacles.push(
      { x: cx - bw * 1.4 - bw / 2, y: cy - bw - bw / 2, w: bw, h: bw },
      { x: cx + bw * 1.4 - bw / 2, y: cy - bw - bw / 2, w: bw, h: bw },
      { x: cx - bw * 1.4 - bw / 2, y: cy + bw - bw / 2, w: bw, h: bw },
      { x: cx + bw * 1.4 - bw / 2, y: cy + bw - bw / 2, w: bw, h: bw },
      { x: cx - bw * 0.35, y: cy - bw * 0.35, w: bw * 0.7, h: bw * 0.7 }
    );
  }

  updateMovers(dt) {
    this.mapTime += dt;
    for (const obs of this.obstacles) {
      if (!obs.mover) continue;
      const m = obs.mover;
      const off = Math.sin(this.mapTime * m.speed + m.phase) * m.amp;
      if (m.axis === 'x') obs.x = m.baseX + off;
      else obs.y = m.baseY + off;
    }
  }

  initPlayers() {
    const p = this.arena.size * 0.25;
    const spawns = [
      { x: this.arena.cx - p, y: this.arena.cy + p },
      { x: this.arena.cx - p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy + p },
    ];

    this.players = spawns.map((s, i) => {
      // Raunt başı TV isimleri silinmez (CROWN deseni)
      const existing = this.players[i];
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      return {
        index: i, name: existing?.name || `P${i + 1}`, color: isBot ? '#8E8E93' : (custom.color || ARCHER_COLORS[i]),
        x: s.x, y: s.y, angle: 0,
        speed: ARCHER_SPEED, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        charging: false, charge: 0, shotCooldown: 0,
        swayPhase: Math.random() * Math.PI * 2,
        stun: 0, spawnProt: 0,
        turboTimer: 0, quickdrawTimer: 0, multiShots: 0, shield: 0, slipTimer: 0,
        botTimer: 0.5, botTargetX: s.x, botTargetY: s.y, botStrafe: 1,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.arrows = [];
    this.particles = [];
    this.pickups = [];
    this.mapIndex = 0;
    this.buildMap();
    this.initPlayers();
    this.onTouchesReset();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.matchWinner = null;
    this.startRound();
  }

  startRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'PLAYING';
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.roundTime = ARCHER_ROUND_TIME;
    this.roundTimer = ARCHER_ROUND_TIME;
    this.arrows = [];
    this.particles = [];
    this.pickups = [];
    this.pickupTimer = 8.0;
    // Raund başına rastgele harita
    this.mapIndex = Math.floor(Math.random() * 3);
    this.buildMap();
    this.onTouchesReset();
    playStart();

    const p = this.arena.size * 0.25;
    const spawns = [
      { x: this.arena.cx - p, y: this.arena.cy + p },
      { x: this.arena.cx - p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy + p },
    ];

    this.players.forEach((player, i) => {
      player.x = spawns[i].x;
      player.y = spawns[i].y;
      player.isAlive = player.isJoined;
      player.steerX = 0;
      player.steerY = 0;
      player.charging = false;
      player.charge = 0;
      player.shotCooldown = 0;
      player.stun = 0;
      player.spawnProt = 1.0;
      player.turboTimer = 0;
      player.quickdrawTimer = 0;
      player.multiShots = 0;
      player.shield = 0;
      player.slipTimer = 0;
      player.botTimer = 0.5;
    });
  }

  beginCharge(player) {
    if (this.state !== 'PLAYING') return;
    if (!player.isJoined || !player.isAlive) return;
    if (player.stun > 0 || player.shotCooldown > 0) return;
    player.charging = true;
  }

  looseArrow(player) {
    if (this.state !== 'PLAYING') {
      player.charging = false;
      player.charge = 0;
      return;
    }
    if (!player.charging) return;
    player.charging = false;
    if (!player.isJoined || !player.isAlive || player.stun > 0) {
      player.charge = 0;
      return;
    }
    const charge = player.charge;
    player.charge = 0;
    if (charge < 0.08) return;
    player.shotCooldown = ARCHER_SHOT_COOLDOWN;

    const aim = this.aimAngle(player);
    const speed = 300 + 420 * charge;
    const shots = player.multiShots > 0 ? 3 : 1;
    if (player.multiShots > 0) player.multiShots -= 1;
    for (let s = 0; s < shots; s++) {
      const spread = shots === 1 ? 0 : (s - 1) * 0.16;
      const ang = aim + spread;
      this.arrows.push({
        x: player.x + Math.cos(ang) * (ARCHER_RADIUS + 6),
        y: player.y + Math.sin(ang) * (ARCHER_RADIUS + 6),
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        owner: player.index,
        color: player.color,
        dist: 0,
        life: ARCHER_ARROW_LIFE,
        power: charge,
      });
    }
    playItemPickup();
  }

  aimAngle(player) {
    const wobble = 0.03 + 0.12 * (1 - player.charge);
    return player.angle + Math.sin(player.swayPhase) * wobble;
  }

  spawnHitBurst(x, y, color, big) {
    const n = big ? 20 : 12;
    for (let i = 0; i < n; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 3 === 0 ? '#FFFFFF' : color,
        radius: 2 + Math.random() * 3,
        alpha: 1.0,
        decay: 2.6,
      });
    }
  }

  getQuadrant(x, y) {
    const { cx, cy } = this.arena;
    if (x < cx && y >= cy) return 0;
    if (x < cx && y < cy) return 1;
    if (x >= cx && y < cy) return 2;
    return 3;
  }

  spawnPickup() {
    const type = ARCHER_PICKUP_TYPES[Math.floor(Math.random() * ARCHER_PICKUP_TYPES.length)];
    const { left, top, size } = this.arena;
    const margin = size * 0.15;
    for (let tries = 0; tries < 8; tries++) {
      const px = left + margin + Math.random() * (size - margin * 2);
      const py = top + margin + Math.random() * (size - margin * 2);
      if (this.pointBlocked(px, py)) continue;
      let nearPlayer = false;
      for (const p of this.players) {
        if (p.isJoined && Math.hypot(p.x - px, p.y - py) < 70) { nearPlayer = true; break; }
      }
      if (nearPlayer) continue;
      this.pickups.push({ x: px, y: py, type, radius: 15, animTime: 0 });
      return;
    }
  }

  applyPickup(player, pk) {
    playItemPickup();
    if (pk.type === 'TURBO') {
      player.turboTimer = 3.5;
      playPowerUp();
    } else if (pk.type === 'TELEPORT') {
      const { left, right, top, bottom, size } = this.arena;
      const pad = size * 0.16;
      const corners = [
        { x: left + pad, y: top + pad },
        { x: right - pad, y: top + pad },
        { x: left + pad, y: bottom - pad },
        { x: right - pad, y: bottom - pad },
      ];
      let best = corners[0];
      let bestD = -1;
      for (const c of corners) {
        const d = Math.hypot(c.x - player.x, c.y - player.y);
        if (d > bestD) { bestD = d; best = c; }
      }
      player.x = best.x;
      player.y = best.y;
      playTeleport();
    } else if (pk.type === 'SLIP') {
      player.slipTimer = 0.55;
      playDashWhoosh();
    } else if (pk.type === 'MULTI') {
      player.multiShots += 3;
      playPowerUp();
    } else if (pk.type === 'QUICKDRAW') {
      player.quickdrawTimer = 8.0;
      playPowerUp();
    } else if (pk.type === 'SHIELD') {
      player.shield = 1;
      playPowerUp();
    }
  }

  onTouchStart(touch) {
    // Round Over Skip Tap
    if (this.state === 'ROUND_OVER' && this.roundTransitionTimer > 0) {
      this.roundTransitionTimer = 0;
      return;
    }

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 65) {
        if (this.slotTypes.filter((s) => s !== 'empty').length >= 2) this.startNewMatch();
        return;
      }
      const q = this.getQuadrant(touch.x, touch.y);
      this.cycleSlotType(q);
      if (this.players[q]) {
        this.players[q].isJoined = this.isSlotJoined(q);
        this.players[q].slotType = this.slotTypes[q];
      }
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    if (this.state === 'PLAYING') {
      const q = this.getQuadrant(touch.x, touch.y);
      const player = this.players[q];
      if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;

      const t = this.touches[q];
      const isRightSide = (q === 0 || q === 1)
        ? (touch.x > this.arena.left + this.arena.width / 4)
        : (touch.x > this.arena.right - this.arena.width / 4);

      if (isRightSide && t.actionId === -1) {
        t.actionId = touch.id;
        this.beginCharge(player);
      } else if (!isRightSide && t.id === -1) {
        t.active = true;
        t.id = touch.id;
        t.cx = touch.x;
        t.cy = touch.y;
        t.jx = touch.x;
        t.jy = touch.y;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.active && t.id === touch.id) {
        t.jx = touch.x;
        t.jy = touch.y;
        const dx = t.jx - t.cx;
        const dy = t.jy - t.cy;
        const dist = Math.hypot(dx, dy);
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human' && dist > 10) {
          player.steerX = dx / dist;
          player.steerY = dy / dist;
          player.angle = Math.atan2(dy, dx);
        }
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.id === touch.id) {
        t.active = false;
        t.id = -1;
        if (this.players[i] && this.players[i].slotType === 'human') {
          this.players[i].steerX = 0;
          this.players[i].steerY = 0;
        }
      }
      if (t.actionId === touch.id) {
        t.actionId = -1;
        // Yay düğmesi bırakıldı: oku sal
        if (this.players[i] && this.players[i].slotType === 'human') {
          this.looseArrow(this.players[i]);
        }
      }
    }
  }

  onTouchesReset() {
    this.touches.forEach((t) => { t.active = false; t.id = -1; t.actionId = -1; });
    this.players.forEach((p) => { p.steerX = 0; p.steerY = 0; p.charging = false; p.charge = 0; });
  }

  pointBlocked(x, y) {
    for (const obs of this.obstacles) {
      if (x > obs.x && x < obs.x + obs.w && y > obs.y && y < obs.y + obs.h) return true;
    }
    return false;
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        this.matchWinner ? this.state = 'MATCH_OVER' : this.startRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    this.roundTime -= dt;
    this.roundTimer = Math.max(0, this.roundTime);
    if (this.roundTime <= 0) {
      this.handleRoundEnd(null);
      return;
    }

    this.updateMovers(dt);

    // Power-up spawn ritmi (bomb gibi: 8-12sn, max 2)
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupTimer = 8.0 + Math.random() * 4.0;
    }
    for (const pk of this.pickups) pk.animTime += dt;

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.shotCooldown > 0) player.shotCooldown -= dt;
      if (player.stun > 0) player.stun -= dt;
      if (player.spawnProt > 0) player.spawnProt -= dt;
      if (player.turboTimer > 0) player.turboTimer -= dt;
      if (player.quickdrawTimer > 0) player.quickdrawTimer -= dt;
      if (player.slipTimer > 0) player.slipTimer -= dt;
      player.swayPhase += dt * (4 + 6 * (1 - player.charge));

      if (player.slotType !== 'human') {
        updateArcherBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
          player.angle = Math.atan2(ki.dy, ki.dx);
        } else if (!this.touches[player.index].active && !player.remoteActive) {
          player.steerX = 0;
          player.steerY = 0;
        }

        if (ki.action) {
          this.beginCharge(player);
        } else if (player.charging) {
          this.looseArrow(player);
        }
      }

      if (player.charging) {
        // QUICKDRAW: 1.2s→0.35s çekiliş
        const chargeTime = player.quickdrawTimer > 0 ? 0.35 : ARCHER_CHARGE_TIME;
        player.charge = Math.min(1, player.charge + dt / chargeTime);
      }

      // Yay gererken yavaş hareket (klasik okçu cezası) · TURBO hızlandırır · SLIP kontrolsüz kaydırır
      const spd = player.stun > 0 ? 0 : player.speed * (player.charging ? 0.45 : 1);
      if (player.stun > 0) {
        // sersemken hareket yok
      } else if (player.slipTimer > 0) {
        const slipSpeed = Math.max(spd, 320) * (player.turboTimer > 0 ? 1.55 : 1);
        player.x += Math.cos(player.angle) * slipSpeed * dt;
        player.y += Math.sin(player.angle) * slipSpeed * dt;
      } else {
        let moveSpd = spd;
        if (player.turboTimer > 0) moveSpd *= 1.55;
        player.x += player.steerX * moveSpd * dt;
        player.y += player.steerY * moveSpd * dt;
      }

      const r = ARCHER_RADIUS;
      player.x = Math.max(this.arena.left + r, Math.min(this.arena.right - r, player.x));
      player.y = Math.max(this.arena.top + r, Math.min(this.arena.bottom - r, player.y));

      // Siper blokları
      for (const obs of this.obstacles) {
        const minX = obs.x - r;
        const maxX = obs.x + obs.w + r;
        const minY = obs.y - r;
        const maxY = obs.y + obs.h + r;

        if (player.x > minX && player.x < maxX && player.y > minY && player.y < maxY) {
          const dists = [
            Math.abs(player.x - minX), Math.abs(player.x - maxX),
            Math.abs(player.y - minY), Math.abs(player.y - maxY),
          ];
          const minD = Math.min(...dists);
          if (minD === dists[0]) player.x = minX;
          else if (minD === dists[1]) player.x = maxX;
          else if (minD === dists[2]) player.y = minY;
          else player.y = maxY;
        }
      }
    }

    // Oklar
    for (let ai = this.arrows.length - 1; ai >= 0; ai--) {
      const a = this.arrows[ai];
      const step = Math.hypot(a.vx, a.vy) * dt;
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.dist += step;
      a.life -= dt;

      let dead = a.life <= 0;
      dead = dead || a.x < this.arena.left || a.x > this.arena.right || a.y < this.arena.top || a.y > this.arena.bottom;
      if (!dead && this.pointBlocked(a.x, a.y)) {
        this.spawnHitBurst(a.x, a.y, '#9C988F', false);
        dead = true;
      }

      if (!dead) {
        for (const victim of this.players) {
          if (!victim.isJoined || !victim.isAlive || victim.index === a.owner) continue;
          if (victim.spawnProt > 0) continue;
          if (Math.hypot(a.x - victim.x, a.y - victim.y) < ARCHER_RADIUS + 6) {
            // KALKAN bir ok emer: skor/stun yok
            if (victim.shield > 0) {
              victim.shield -= 1;
              this.spawnHitBurst(victim.x, victim.y, '#06B6D4', true);
              playExplosion();
              dead = true;
              break;
            }
            const close = a.dist < ARCHER_CLOSE_DIST;
            const pts = close ? 2 : 1;
            this.scores[a.owner] += pts;
            // Yakın mesafede stun çok kısa (spam kilitlenmesin), uzakta tam stun
            const stunDur = a.dist < 110 ? 0.12 : (close ? 0.3 : 0.8);
            victim.stun = Math.max(victim.stun, stunDur);
            victim.charging = false;
            victim.charge = 0;
            const kx = victim.x - a.x;
            const ky = victim.y - a.y;
            const kd = Math.hypot(kx, ky) || 1;
            victim.x = Math.max(this.arena.left + ARCHER_RADIUS, Math.min(this.arena.right - ARCHER_RADIUS, victim.x + (kx / kd) * 26));
            victim.y = Math.max(this.arena.top + ARCHER_RADIUS, Math.min(this.arena.bottom - ARCHER_RADIUS, victim.y + (ky / kd) * 26));
            this.spawnHitBurst(victim.x, victim.y, victim.color, close);
            this.addTrauma(close ? 0.45 : 0.25);
            playExplosion();
            dead = true;
            break;
          }
        }
      }

      if (dead) this.arrows.splice(ai, 1);
    }

    // Power-up toplama
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (Math.hypot(player.x - pk.x, player.y - pk.y) < ARCHER_RADIUS + pk.radius) {
          this.applyPickup(player, pk);
          this.pickups.splice(i, 1);
        }
      }
    }

    // Parçacıklar
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha -= p.decay * dt;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
      const force = Number.isFinite(data.force) ? data.force : Math.hypot(data.dx || 0, data.dy || 0);
      if (force > 0.05) {
        player.steerX = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
        player.steerY = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
        if (Number.isFinite(data.angle)) {
          player.angle = data.angle;
        } else if (player.steerX !== 0 || player.steerY !== 0) {
          player.angle = Math.atan2(player.steerY, player.steerX);
        }
        player.remoteActive = true;
      } else {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
    } else if (data.action === 'ARCHER_CHARGE') {
      this.beginCharge(player);
    } else if (data.action === 'ARCHER_CHARGE_END') {
      this.looseArrow(player);
    }
  }

  handleRoundEnd(_winner) {
    // 60sn sonu: en çok puanlı raundu alır; beraberlikte raund kimseye yazılmaz
    let best = -1;
    let winners = [];
    this.players.forEach((p, i) => {
      if (!p.isJoined) return;
      if (this.scores[i] > best) {
        best = this.scores[i];
        winners = [p];
      } else if (this.scores[i] === best) {
        winners.push(p);
      }
    });
    const roundWinner = winners.length === 1 ? winners[0] : null;
    this.state = 'ROUND_OVER';
    this.roundWinner = roundWinner;
    this.roundTransitionTimer = 2.5;
    if (roundWinner) {
      this.roundWins[roundWinner.index]++;
      if (this.roundWins[roundWinner.index] >= this.roundsToWin) {
        this.matchWinner = roundWinner;
      }
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    ctx.fillStyle = '#D6D3CD';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    const { left, top, width, height } = this.arena;
    ctx.fillStyle = '#E8E5DF';
    ctx.fillRect(left, top, width, height);

    // Siper blokları (ortak arenaKit)
    for (const obs of this.obstacles) drawObstacle(ctx, obs, { variant: 'stone' });

    // Power-up rozetleri (ortak arenaKit)
    for (const pk of this.pickups) drawPickup(ctx, pk);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Engellerin üzerinde her zaman net, yüksek görünürlüklü süre sayacı & köşe skorları
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      const remain = Math.max(0, Math.ceil(this.roundTime));
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${remain}s`,
        subText: '',
        urgent: remain <= 10,
        alpha: remain <= 10 ? 0.70 : 0.46,
        ringProgress: Math.max(0, remain / ARCHER_ROUND_TIME),
      });

      renderCornerScores(ctx, {
        arena: this.arena,
        entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null),
        entities: this.players.filter((p) => p.isJoined && p.isAlive),
      });
    }

    // Oklar
    for (const a of this.arrows) {
      const ang = Math.atan2(a.vy, a.vx);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      ctx.lineTo(10, 0);
      ctx.stroke();
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Oyuncular
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.rotate(player.angle);

      // Nişan çizgisi (yay gerilirken)
      if (player.charging && this.state === 'PLAYING') {
        const aim = Math.sin(player.swayPhase) * (0.03 + 0.12 * (1 - player.charge));
        ctx.save();
        ctx.rotate(aim);
        ctx.strokeStyle = player.charge >= 1 ? '#8B5CF6' : 'rgba(26,26,26,0.35)';
        ctx.lineWidth = player.charge >= 1 ? 3 : 2;
        ctx.setLineDash([8, 6]);
        ctx.beginPath();
        ctx.moveTo(ARCHER_RADIUS + 8, 0);
        ctx.lineTo(ARCHER_RADIUS + 60 + player.charge * 90, 0);
        ctx.stroke();
        ctx.restore();
      }

      // Yay (gerilme halkası)
      if (this.state === 'PLAYING') {
        ctx.save();
        ctx.strokeStyle = player.charging ? '#8B5CF6' : 'rgba(26,26,26,0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 6, -1.1, 1.1);
        ctx.stroke();
        if (player.charging) {
          ctx.fillStyle = '#8B5CF6';
          ctx.beginPath();
          ctx.arc(ARCHER_RADIUS + 6, 0, 3 + player.charge * 3, 0, Math.PI * 2);
          ctx.fill();
        }
        // KALKAN halkası
        if (player.shield > 0) {
          ctx.strokeStyle = '#06B6D4';
          ctx.lineWidth = 3;
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.arc(0, 0, ARCHER_RADIUS + 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      drawBrutalAvatar(ctx, 0, 0, ARCHER_RADIUS, {
        color: player.stun > 0 ? '#9C988F' : player.color,
        slotIndex: player.index,
        facingAngle: 0, // already translated and rotated to player.angle
        label: `P${player.index + 1}`,
        expression: player.charging ? 'angry' : (player.stun > 0 ? 'dizzy' : 'normal'),
        accessory: 'headband',
        showPointer: true,
        borderColor: '#1A1A1A',
        borderWidth: 2.5,
      });

      // Ok Dolum / Yeniden Yükleme ve Sersemleme Cooldown Arkı (Zemin ve okların üstünde her zaman görünür)
      if (player.reloadCooldown > 0) {
        const cdProg = 1.0 - Math.max(0, Math.min(1, player.reloadCooldown / 0.8));
        ctx.save();
        ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#8B5CF6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, ARCHER_RADIUS + 5, -Math.PI / 2, -Math.PI / 2 + cdProg * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    }

    // Parçacıklar
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (this.state === 'PLAYING' && this.isLocalInputActive) {
      for (let i = 0; i < 4; i++) {
        const tc = this.touches[i];
        if (tc.active) {
          ctx.beginPath(); ctx.arc(tc.cx, tc.cy, 30, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(tc.jx, tc.jy, 15, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fill();
        }
      }
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, t('guide.archer'), [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ]);
      const seatRects = getStandardSeatRects(this.arena);
      const localMode = !this.hideLobbyStartButton;
      const localColors = localMode ? getLocalSeatColors() : null;
      for (let i = 0; i < 4; i++) {
        const rect = seatRects[i];
        const isTop = i === 1 || i === 2;
        renderLobbySeatCard(ctx, {
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          slotIndex: i,
          slotType: this.players[i]?.slotType || this.slotTypes[i],
          playerName: this.players[i]?.name || '',
          playerColor: ARCHER_COLORS[i],
          rotation: isTop ? Math.PI : 0,
          seatColor: localMode ? (localColors[i] || ARCHER_COLORS[i]) : null,
          showColorDot: localMode,
        });
        // Nokta önce: tap dispatch ilk eşleşmede durur, nokta kartın içindedir.
        if (localMode) {
          const dot = getSeatColorDotRect(rect);
          this.uiButtons.push({
            x: dot.x, y: dot.y, w: dot.w, h: dot.h,
            onClick: () => this.cycleLocalSeat(i),
          });
        }
        this.uiButtons.push({
          x: rect.x, y: rect.y, w: rect.w, h: rect.h,
          onClick: () => {
            this.cycleSlotType(i);
            if (this.players[i]) {
              this.players[i].isJoined = this.isSlotJoined(i);
              this.players[i].slotType = this.slotTypes[i];
            }
            playJoin();
          },
        });
      }
      const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
      renderLobbyStartButton(ctx, { arena: this.arena, uiButtons: this.uiButtons, joinedCount, accent: '#8B5CF6', onStart: () => this.startNewMatch(), hidden: !!this.hideLobbyStartButton });
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? t('game.won', this.roundWinner.name) : t('game.draw'), titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, { arena: this.arena, uiButtons: this.uiButtons, headline: t('archer.champ'), winnerName: this.matchWinner ? this.matchWinner.name : '', winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A', rows: this.players.filter((p) => p.isJoined).map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★ · ${this.roundWins[p.index]}R` })), onRestart: () => this.startNewMatch() });
    }
    ctx.restore();
  }
}
