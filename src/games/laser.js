// BRUTAL LASER v2: 2-4 oyunculu hareketli lazer-tag — koş, sekme önizlemesiyle
// nişan al, ateş et. 3 can + dash i-frame + respawn + 90sn kill yarışı + pickup.
// Tek çubuk: joystick yönü hem hareket hem nişan verir (it=koş+nişan, bırak=dur).

import { playExplosion, playStart, playJoin, playGunshot, playDashWhoosh, playItemPickup, playStumble } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderTopPill, renderCornerScores, renderMatchOver, renderArenaWatermarkTimer } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateLaserBotAI } from '../ai/laserAI.js';

export const LASER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const LASER_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

// Lokal klavye: Hareket + Ateş + Dash
// (P1 WASD+Space, P2 Oklar+Enter, P3 IJKL+O, P4 TFGH+B sözleşmesi korunur; dash eklenir)
const LASER_KEY_SLOTS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', fire: 'Space', dash: 'ShiftLeft' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', fire: 'Enter', dash: 'ShiftRight' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', fire: 'KeyO', dash: 'KeyU' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', fire: 'KeyB', dash: 'KeyR' },
];

export const LASER_TUNING = {
  SPEED: 220,          // koşu hızı (px/s)
  FIRE_CD: 1.0,        // ateş bekleme (sn)
  MAX_ACTIVE: 2,       // oyuncu başına havada max lazer
  LASER_SPEED: 600,    // lazer hızı (px/s)
  FAST_MULT: 1.5,      // ⚡ pickup hız çarpanı
  FAST_TIME: 8.0,      // ⚡ süresi (sn)
  BOUNCES: 4,          // sekme hakkı
  MAX_HP: 3,           // can
  INVULN: 0.8,         // vuruş sonrası dokunulmazlık (sn)
  RESPAWN: 2.0,        // yeniden doğma (sn)
  SPAWN_PROTECT: 1.5,  // doğma koruması (sn)
  DASH_MULT: 2.2,      // depar hız çarpanı (ZONE kanıtlı)
  DASH_TIME: 0.22,     // depar süresi (sn)
  DASH_CD: 4.0,        // depar bekleme (sn)
  MATCH_TIME: 90,      // maç süresi (sn)
  TARGET_KILLS: 10,    // erken zafer kill sayısı
  PICKUP_EVERY: 15.0,  // pickup aralığı (sn)
  DOUBLE_TAP_MS: 280,  // lokal çift-dokunuş dash penceresi
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
    this.pickups = [];
    this.particles = [];
    this.floatingTexts = [];
    this.keys = {};
    this.selectedMapIndex = 0;
    this.matchTimer = LASER_TUNING.MATCH_TIME;
    this.pickupTimer = LASER_TUNING.PICKUP_EVERY;
    this.pickupFlip = false;
    this.lastTime = performance.now();

    // Lokal dokunmatik: köşe başına yüzen joystick (hareket+nişan)
    this.touches = [
      { active: false, ox: 0, oy: 0, id: -1 },
      { active: false, ox: 0, oy: 0, id: -1 },
      { active: false, ox: 0, oy: 0, id: -1 },
      { active: false, ox: 0, oy: 0, id: -1 },
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
    const map = LASER_KEY_SLOTS[index];
    if (!map) return { dx: 0, dy: 0, fire: false, dash: false };
    const dx = (this.keys[map.r] ? 1 : 0) - (this.keys[map.l] ? 1 : 0);
    const dy = (this.keys[map.d] ? 1 : 0) - (this.keys[map.u] ? 1 : 0);
    return { dx, dy, fire: !!this.keys[map.fire], dash: !!this.keys[map.dash] };
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
    const { cx, cy, size, width, height, left, top } = this.arena;
    const preset = LASER_MAPS[this.selectedMapIndex]?.id || 'klasik';
    if (preset === 'siginak') {
      // Merkez blok + 4 köşe diş
      const bw = size * 0.22;
      this.obstacles.push({ x: cx - bw / 2, y: cy - bw / 2, w: bw, h: bw });
      const t = size * 0.1;
      this.obstacles.push(
        { x: left + size * 0.2, y: top + size * 0.2, w: t, h: t },
        { x: left + width - size * 0.2 - t, y: top + size * 0.2, w: t, h: t },
        { x: left + size * 0.2, y: top + height - size * 0.2 - t, w: t, h: t },
        { x: left + width - size * 0.2 - t, y: top + height - size * 0.2 - t, w: t, h: t },
      );
    } else if (preset === 'koridor') {
      // Haç: dikey + yatay bar (ortada küçük boşluk)
      const gap = size * 0.09;
      const th = size * 0.05;
      this.obstacles.push(
        { x: cx - th / 2, y: cy - size * 0.32, w: th, h: size * 0.23 - gap / 2 },
        { x: cx - th / 2, y: cy + gap / 2, w: th, h: size * 0.23 - gap / 2 },
        { x: cx - size * 0.32, y: cy - th / 2, w: size * 0.23 - gap / 2, h: th },
        { x: cx + gap / 2, y: cy - th / 2, w: size * 0.23 - gap / 2, h: th },
      );
    } else {
      // Klasik çapraz sekme engelleri
      const bw = size * 0.15;
      const bh = size * 0.05;
      this.obstacles.push(
        { x: cx - bw * 1.5, y: cy - bw, w: bw, h: bh },
        { x: cx + bw * 0.5, y: cy - bw, w: bw, h: bh },
        { x: cx - bw * 1.5, y: cy + bw - bh, w: bw, h: bh },
        { x: cx + bw * 0.5, y: cy + bw - bh, w: bw, h: bh },
        { x: cx - bh / 2, y: cy - bw * 1.5, w: bh, h: bw },
        { x: cx - bh / 2, y: cy + bw * 0.5, w: bh, h: bw }
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
      const s = this.spawnPoint(i);
      return {
        index: i, name: existing?.name || LASER_NAMES[i], color: LASER_COLORS[i],
        x: s.x, y: s.y, angle: s.angle, targetAngle: s.angle,
        steerX: 0, steerY: 0, kbx: 0, kby: 0,
        hp: LASER_TUNING.MAX_HP, cooldown: 0,
        dashTimer: 0, dashCooldown: 0,
        invulnTimer: 0, respawnTimer: 0, fastTimer: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        botCheckTimer: Math.random(), botStrafeDir: Math.random() < 0.5 ? 1 : -1,
        botRetarget: 0, keyFireLatch: false, keyDashLatch: false, keyHeld: false, lastTapTime: 0,
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
    this.onTouchesReset();
    playStart();
    this.players.forEach((p) => {
      const s = this.spawnPoint(p.index);
      p.x = s.x; p.y = s.y;
      p.angle = s.angle; p.targetAngle = s.angle;
      p.steerX = 0; p.steerY = 0; p.kbx = 0; p.kby = 0;
      p.hp = LASER_TUNING.MAX_HP;
      p.isAlive = p.isJoined;
      p.cooldown = 1.0;
      p.dashTimer = 0; p.dashCooldown = 0;
      p.invulnTimer = p.isJoined ? LASER_TUNING.SPAWN_PROTECT : 0;
      p.respawnTimer = 0; p.fastTimer = 0;
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

  fireLaser(player) {
    // Uzak/yakın tüm tetikleyiciler için kapı: PLAYING + canlı + katılmış
    if (this.state !== 'PLAYING') return;
    if (!player || !player.isJoined || !player.isAlive) return;
    if (player.cooldown > 0 || player.respawnTimer > 0) return;
    let active = 0;
    for (const lz of this.lasers) if (lz.owner === player.index) active++;
    if (active >= LASER_TUNING.MAX_ACTIVE) return;
    player.cooldown = LASER_TUNING.FIRE_CD;
    playGunshot();
    const spd = LASER_TUNING.LASER_SPEED * (player.fastTimer > 0 ? LASER_TUNING.FAST_MULT : 1);
    this.lasers.push({
      x: player.x + Math.cos(player.angle) * 20,
      y: player.y + Math.sin(player.angle) * 20,
      vx: Math.cos(player.angle) * spd,
      vy: Math.sin(player.angle) * spd,
      owner: player.index,
      color: player.color,
      bounces: LASER_TUNING.BOUNCES,
      history: [],
    });
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
    if (this.pickups.length > 0) return;
    const { cx, cy, size } = this.arena;
    const type = this.pickupFlip ? 'HEAL' : 'FAST';
    this.pickupFlip = !this.pickupFlip;
    const a = Math.random() * Math.PI * 2;
    const r = size * 0.08 * Math.random();
    this.pickups.push({
      x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r,
      type, radius: 15, animTime: Math.random() * 10,
    });
  }

  getCornerZone(pos) {
    const { cx, cy } = this.arena;
    const isLeft = pos.x < cx;
    const isTop = pos.y < cy;
    if (isLeft && !isTop) return 0;
    if (isLeft && isTop) return 1;
    if (!isLeft && isTop) return 2;
    return 3;
  }

  onTouchStart(touch) {
    const { cx, cy } = this.arena;
    const distToCenter = Math.hypot(touch.x - cx, touch.y - cy);

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (distToCenter < 65) {
        const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
        if (joinedCount >= 2) this.startNewMatch();
        return;
      }
      const corner = this.getCornerZone(touch);
      this.cycleSlotType(corner);
      if (this.players[corner]) {
        this.players[corner].isJoined = this.isSlotJoined(corner);
        this.players[corner].slotType = this.slotTypes[corner];
      }
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (distToCenter < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    if (this.state === 'PLAYING') {
      if (this.handleUiTap(touch)) return;
      const corner = this.getCornerZone(touch);
      const player = this.players[corner];
      if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;
      const t = this.touches[corner];
      // İkinci parmak aynı kadran = ateş
      if (t.active && t.id !== -1) {
        this.fireLaser(player);
        return;
      }
      // Çift dokunuş = dash (BOMB deseni)
      const now = performance.now();
      if (now - player.lastTapTime < LASER_TUNING.DOUBLE_TAP_MS) {
        this.triggerDash(corner);
      }
      player.lastTapTime = now;
      t.active = true;
      t.id = touch.id;
      t.ox = touch.x;
      t.oy = touch.y;
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.active && t.id === touch.id) {
        const player = this.players[i];
        if (player && player.isJoined && player.isAlive && player.slotType === 'human') {
          const dx = touch.x - t.ox;
          const dy = touch.y - t.oy;
          const dist = Math.hypot(dx, dy);
          if (dist > 10) {
            player.steerX = dx / dist;
            player.steerY = dy / dist;
            player.targetAngle = Math.atan2(dy, dx);
          }
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.id === touch.id) {
        t.active = false;
        t.id = -1;
        const player = this.players[i];
        if (player && player.slotType === 'human') {
          player.steerX = 0;
          player.steerY = 0;
        }
      }
    }
  }

  onTouchesReset() {
    this.touches = [
      { active: false, ox: 0, oy: 0, id: -1 },
      { active: false, ox: 0, oy: 0, id: -1 },
      { active: false, ox: 0, oy: 0, id: -1 },
      { active: false, ox: 0, oy: 0, id: -1 },
    ];
  }

  collideObstacles(p, r) {
    for (const obs of this.obstacles) {
      const nx = Math.max(obs.x, Math.min(p.x, obs.x + obs.w));
      const ny = Math.max(obs.y, Math.min(p.y, obs.y + obs.h));
      let dx = p.x - nx;
      let dy = p.y - ny;
      let d = Math.hypot(dx, dy);
      if (d < r) {
        if (d < 0.001) {
          // Merkez içeride: en sığ yüzden dışarı it
          const l = p.x - obs.x, rr = obs.x + obs.w - p.x;
          const t = p.y - obs.y, b = obs.y + obs.h - p.y;
          const m = Math.min(l, rr, t, b);
          if (m === l) p.x = obs.x - r;
          else if (m === rr) p.x = obs.x + obs.w + r;
          else if (m === t) p.y = obs.y - r;
          else p.y = obs.y + obs.h + r;
        } else {
          p.x = nx + (dx / d) * r;
          p.y = ny + (dy / d) * r;
        }
      }
    }
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    if (this.state !== 'PLAYING') return;

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
    for (const pk of this.pickups) pk.animTime += dt;

    // 1. Oyuncular
    for (const player of this.players) {
      if (!player.isJoined) continue;

      if (player.cooldown > 0) player.cooldown -= dt;
      if (player.dashCooldown > 0) player.dashCooldown -= dt;
      if (player.dashTimer > 0) player.dashTimer -= dt;
      if (player.invulnTimer > 0) player.invulnTimer -= dt;
      if (player.fastTimer > 0) player.fastTimer -= dt;
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
          player.cooldown = 0.5;
          playJoin();
        }
        continue;
      }

      if (player.slotType !== 'human') {
        updateLaserBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        if (ki.dx !== 0 || ki.dy !== 0) {
          // Klavye sahiplenir (dokunmatik/uzak girdiyi ezerken basılı tutar)
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
          player.targetAngle = Math.atan2(ki.dy, ki.dx);
          player.keyHeld = true;
        } else if (player.keyHeld) {
          // Klavye bırakıldı: sadece kendi yazdığını siler (uzak/dokunmatik korunur)
          player.keyHeld = false;
          if (!this.touches[player.index].active) {
            player.steerX = 0;
            player.steerY = 0;
          }
        }
        if (ki.fire && !player.keyFireLatch) {
          this.fireLaser(player);
          player.keyFireLatch = true;
        } else if (!ki.fire) {
          player.keyFireLatch = false;
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

      // Hareket: depar 2.2x, i-frame dash süresince
      let spd = LASER_TUNING.SPEED;
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

      const r = 14;
      player.x = Math.max(this.arena.left + r, Math.min(this.arena.right - r, player.x));
      player.y = Math.max(this.arena.top + r, Math.min(this.arena.bottom - r, player.y));
      this.collideObstacles(player, r);

      // Pickup yeme
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        if (Math.hypot(player.x - pk.x, player.y - pk.y) < 28) {
          if (pk.type === 'HEAL') {
            player.hp = Math.min(LASER_TUNING.MAX_HP + 1, player.hp + 1);
          } else {
            player.fastTimer = LASER_TUNING.FAST_TIME;
          }
          this.pickups.splice(i, 1);
          playItemPickup();
          break;
        }
      }
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

        for (const obs of this.obstacles) {
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
    } else if (data.action === 'TANK_FIRE') {
      this.fireLaser(player);
    } else if (data.action === 'DASH') {
      this.triggerDash(slotIndex);
    }
  }

  // Nişan önizlemesi: ilk 2 sekmenin izdüşümü (noktalı çizgi)
  traceAim(player) {
    const pts = [{ x: player.x, y: player.y }];
    let x = player.x + Math.cos(player.angle) * 20;
    let y = player.y + Math.sin(player.angle) * 20;
    let vx = Math.cos(player.angle);
    let vy = Math.sin(player.angle);
    let bounces = 2;
    const step = 8;
    pts.push({ x, y });
    for (let s = 0; s < 120 && bounces >= 0; s++) {
      x += vx * step;
      y += vy * step;
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
      for (const obs of this.obstacles) {
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

    const { left, top, width, height } = this.arena;
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    if (this.state === 'PLAYING') {
      const remain = Math.max(0, Math.ceil(this.matchTimer));
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${remain}s`,
        subText: `HEDEF: ${LASER_TUNING.TARGET_KILLS} KILL`,
        urgent: remain <= 10,
        alpha: remain <= 10 ? 0.22 : 0.14,
        ringProgress: 1.0 - (remain / 90),
      });

      renderTopPill(ctx, {
        arena: this.arena,
        text: `⏱ ${remain}s • 🎯 ${LASER_TUNING.TARGET_KILLS} KILL`,
        urgent: remain <= 10,
      });
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    ctx.fillStyle = '#1A1A1A';
    for (const obs of this.obstacles) {
      ctx.fillRect(obs.x, obs.y, obs.w, obs.h);
    }

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Pickup'lar
    for (const pk of this.pickups) {
      const pulse = 1 + Math.sin(pk.animTime * 6) * 0.12;
      ctx.save();
      ctx.translate(pk.x, pk.y);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = pk.type === 'HEAL' ? '#2F6A4F' : '#FFDE59';
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#1A1A1A'; ctx.stroke();
      ctx.fillStyle = '#1A1A1A';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pk.type === 'HEAL' ? '❤' : '⚡', 0, 1);
      ctx.restore();
    }

    // Nişan önizlemeleri (canlı oyuncular, 2 sekme, silik noktalı)
    if (this.state === 'PLAYING') {
      ctx.save();
      for (const player of this.players) {
        if (!player.isJoined || !player.isAlive) continue;
        const pts = this.traceAim(player);
        ctx.strokeStyle = player.color;
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Lazerler
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const laser of this.lasers) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = laser.color;
      ctx.beginPath();
      if (laser.history.length > 0) {
        ctx.moveTo(laser.history[0].x, laser.history[0].y);
        for (let i = 1; i < laser.history.length; i++) {
          ctx.lineTo(laser.history[i].x, laser.history[i].y);
        }
      }
      ctx.lineTo(laser.x, laser.y);
      ctx.stroke();

      ctx.fillStyle = '#FFF';
      ctx.beginPath(); ctx.arc(laser.x, laser.y, 3, 0, Math.PI * 2); ctx.fill();
    }

    // Oyuncular
    const blink = Math.floor(performance.now() / 120) % 2 === 0;
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;
      // Vuruş dokunulmazlığında göz kırp
      if (player.invulnTimer > 0 && player.respawnTimer <= 0 && blink) continue;

      ctx.save();
      ctx.translate(player.x, player.y);

      // Dash hazır halkası
      ctx.lineWidth = 3;
      ctx.strokeStyle = player.dashCooldown > 0 ? '#B9B2A6' : '#FFFFFF';
      ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.stroke();

      ctx.rotate(player.angle);

      ctx.fillStyle = player.color;
      ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#1A1A1A'; ctx.stroke();

      // Namlu: cooldown'da gri, ⚡ varken sarı
      ctx.fillStyle = player.fastTimer > 0 ? '#FFDE59' : (player.cooldown > 0 ? '#888' : '#FFF');
      ctx.fillRect(8, -4, 14, 8);
      ctx.strokeRect(8, -4, 14, 8);
      ctx.restore();

      // HP pip'leri
      const total = Math.max(player.hp, LASER_TUNING.MAX_HP);
      const pw = 8;
      const startX = player.x - (total * (pw + 2)) / 2;
      for (let h = 0; h < total; h++) {
        ctx.fillStyle = h < player.hp ? player.color : '#D5D0C7';
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(startX + h * (pw + 2) + pw / 2, player.y - 26, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    // Parçacıklar (lazer kıvılcımları)
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Uçuşan metinler (+1 KILL ★)
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, ft.alpha));
      ctx.font = 'bold 16px monospace';
      ctx.fillStyle = ft.color;
      ctx.textAlign = 'center';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'JOYSTICK: KOŞ+NİŞAN • ATEŞ: VUR • ÇİFT DOKUN: DASH • 3 CAN', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      const seatRects = getStandardSeatRects(this.arena);
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
          playerColor: LASER_COLORS[i],
          rotation: isTop ? Math.PI : 0,
        });
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
      renderLobbyStartButton(ctx, { arena: this.arena, uiButtons: this.uiButtons, joinedCount, accent: '#D84727', onStart: () => this.startNewMatch(), hidden: !!this.hideLobbyStartButton });
      // Harita seçici (start butonunun altında küçük buton)
      const mapName = LASER_MAPS[this.selectedMapIndex]?.name || '';
      const mw = 210; const mh = 34;
      const mx = this.arena.cx - mw / 2;
      const my = this.arena.cy + 78;
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 3;
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.fillStyle = '#1A1A1A';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`🗺 ${mapName}`, this.arena.cx, my + mh / 2);
      ctx.restore();
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
    } else if (this.state === 'MATCH_OVER') {
      const rows = this.players
        .filter((p) => p.isJoined)
        .sort((a, b) => (this.scores[b.index] || 0) - (this.scores[a.index] || 0))
        .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★` }));
      renderMatchOver(ctx, {
        arena: this.arena,
        uiButtons: this.uiButtons,
        headline: this.matchWinner ? 'LAZER ŞAMPİYONU!' : 'BERABERE!',
        winnerName: this.matchWinner ? this.matchWinner.name : '',
        winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A',
        rows,
        onRestart: () => this.startNewMatch(),
      });
    }
    ctx.restore();
  }
}
