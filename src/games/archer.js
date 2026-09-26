// BRUTAL ARCHERY: 2-4 oyunculu okçuluk arenası — serbest hareket, basılı tutarak
// yay ger, bırakınca ok at. Nişan = bakış yönü + salınım (tam geriş daha stabil).
// Yakın mesafe vuruş 2 puan, uzak vuruş 1 puan. 60sn raundu en çok puanla bitiren
// raundu alır; 2 raund alan şampiyon.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup, playTeleport, playDashWhoosh, playPowerUp } from '../audio.js';
import { notifyFireBlocked, notifyFireShot } from '../core/fireFeedbackEffects.js';
import { resetFireFeedback, updateFireFeedback } from '../core/fireFeedback.js';
import { t } from '../i18n.js';
import { renderArenaWatermarkTimer } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateArcherBotAI } from '../ai/archerAI.js';
import { buildLayout } from '../core/arenaKit.js';
import { readSlotKeys } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { pointBlocked, updateMovers, clampToArena, resolveAABB, segmentCircleIntersection, segmentAabbIntersection } from '../core/physics2d.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import {
  createArcherWorldPacket,
  drawArcherArena,
  drawArcherPickups,
  drawArcherArrows,
  drawArcherPlayers,
  drawArcherParticles,
} from './archerView.js';

export const ARCHER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const ARCHER_NAMES = ['P1', 'P2', 'P3', 'P4'];

// Tasarım yarıçapı (1920x1080 referansı). ÇALIŞMA ZAMANI yarıçapı sabit
// DEĞİLDİR: her oyuncu `fieldRadius(this.arena, ...)` ile kendi `radius`
// alanını taşır. Aşağıdaki her kullanım o alandan okur. Sabit kalsaydı
// telefonda saha yüksekliğinin %4.65'ini, masaüstünde %1.89'unu kaplıyordu
// (2.5x şişik).
//
// 18 → 22: ARCHER'ın gövde/saha oranı (%1.89) tüm motorlar arasında EN KÜÇÜKÜ
//ydi (BOMB %3.78, CROWN %4.47, TANKS %3.20) — masaüstünde karakter diğer
// oyunlara göre belirgin şekilde küçük duruyordu. 22px → %2.31, araya girer.
const ARCHER_RADIUS = 22;
// Taban yok: `minUnit` (0.30) alan çöktüğünde alt sınırı veriyor. Burada bir
// taban daha önce 0.02 idi ve tasarım payının ÜSTÜNDE olduğu için masaüstünde
// de +%6 şişiriyordu.
// Tasarım px/s; `fieldSpeed` ile sahayla birlikte ölçeklenir.
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
    this.controlMode = 'ARCHER';
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.roundWins = [0, 0, 0, 0];
    this.roundsToWin = 2;
    this.players = [];
    this.arrows = [];
    this.nextArrowId = 1;
    this.obstacles = [];
    this.particles = [];
    this.roundTime = ARCHER_ROUND_TIME;
    this.roundTimer = ARCHER_ROUND_TIME;
    this.roundId = 0;
    this.roundHits = [0, 0, 0, 0];
    this.tieRounds = 0;
    this.matchDraw = false;
    this.pickups = [];
    this.pickupTimer = 8.0;
    this.mapIndex = 0;
    this.mapTime = 0;
    this.keys = {};
    this.roundTransitionTimer = 0;

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

  createWorldPacket() {
    return createArcherWorldPacket(this);
  }

  keyboardInput(index) {
    return readSlotKeys(this.keys, index);
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };

    const previousObstacles = Array.isArray(this.obstacles) ? this.obstacles : [];
    const previousPhases = previousObstacles.map((obs) => obs?.mover?.phase);

    this.arena = computePlayfield(width, height, 'standard');

    this.buildMap();
    if (this.state !== 'LOBBY' && previousObstacles.length === this.obstacles.length) {
      this.obstacles.forEach((obs, index) => {
        if (obs.mover && Number.isFinite(previousPhases[index])) obs.mover.phase = previousPhases[index];
      });
    }

    // Maç ortası resize ışınlamaz: geometri yenilenir, oyuncular orantılı taşınır
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
    for (const a of this.arrows) this.remapPoint(a, oldArena, this.arena);
  }

  buildMap() {
    this.mapTime = 0;
    const presetNames = ['pillars', 'cross', 'scatter'];
    const name = presetNames[this.mapIndex] || 'pillars';
    // Geçiş tabanı oyuncunun kendi çapından türer: iki engel arasındaki en dar
    // cep karakterin çapından geniş olmalı, yoksa o boşluk dekoratif görünür
    // ama oyuncu içine giremez. Preset'ler `size`'dan türeyen sabitlerle
    // çalıştığı için oyuncu 22px'e çıkınca `cross`'in dikey geçişi kapanmıştı.
    this.obstacles = buildLayout(name, this.arena, {
      minPassage: fieldRadius(this.arena, ARCHER_RADIUS, 0) * 2.4,
    });
  }

  updateMovers(dt) {
    updateMovers(this.obstacles, dt, 'sine');
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
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || ARCHER_COLORS[i]),
        x: s.x, y: s.y, angle: 0,
        radius: fieldRadius(this.arena, ARCHER_RADIUS, 0),
        speed: fieldSpeed(this.arena, ARCHER_SPEED), steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        charging: false, charge: 0, shotCooldown: 0, fireCooldownMax: ARCHER_SHOT_COOLDOWN,
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
    this.matchDraw = false;
    this.roundId = 0;
    this.roundHits = [0, 0, 0, 0];
    this.tieRounds = 0;
    this.roundTransitionTimer = 0;
    this.arrows = [];
    this.nextArrowId = 1;
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
    this.matchDraw = false;
    this.tieRounds = 0;
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
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.roundId += 1;
    this.roundHits = [0, 0, 0, 0];
    this.roundTime = ARCHER_ROUND_TIME;
    this.roundTimer = ARCHER_ROUND_TIME;
    this.arrows = [];
    this.nextArrowId = 1;
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
      player.fireCooldownMax = ARCHER_SHOT_COOLDOWN;
      resetFireFeedback(player);
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
    if (player.shotCooldown > 0) {
      notifyFireBlocked(player);
      return;
    }
    if (player.stun > 0) return;
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
    if (player.shotCooldown > 0) {
      player.charge = 0;
      notifyFireBlocked(player);
      return;
    }
    const charge = player.charge;
    player.charge = 0;
    if (charge < 0.08) return;
    player.shotCooldown = ARCHER_SHOT_COOLDOWN;
    notifyFireShot(player);

    const aim = this.aimAngle(player);
    const speed = fieldSpeed(this.arena, 300 + 420 * charge);
    const shots = player.multiShots > 0 ? 3 : 1;
    if (player.multiShots > 0) player.multiShots -= 1;
    for (let s = 0; s < shots; s++) {
      const spread = shots === 1 ? 0 : (s - 1) * 0.16;
      const ang = aim + spread;
      this.arrows.push({
        id: this.nextArrowId++,
        x: player.x + Math.cos(ang) * (player.radius + 6),
        y: player.y + Math.sin(ang) * (player.radius + 6),
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

  spawnPickup() {
    spawnPickup(this, {
      types: ARCHER_PICKUP_TYPES,
      max: 2,
      obstacles: this.obstacles,
      pad: 0,
    });
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

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('ARCHER'),
      actions: [],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (actionId === 'charge') {
      const angle = player.angle;
      const input = {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        angle,
        force: 1,
      };
      if (isDown) this.handleSlotAimStart(slotIndex, input, { source: 'touch' });
      else this.handleSlotAimEnd(slotIndex, input, { source: 'touch', cancelled: false });
    }
  }

  onSlotAimHold(slotIndex, isDown, {
    cancelled = false,
    hasDirection = false,
    angle = null,
  } = {}) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (isDown) {
      this.beginCharge(player);
      return;
    }
    if (!this.isReleaseToFireAim() || cancelled || !hasDirection) {
      player.charging = false;
      player.charge = 0;
      return;
    }
    if (Number.isFinite(angle)) player.angle = angle;
    this.looseArrow(player);
  }

  onTouchStart(touch) {
    if (this.handleRoundOverSkip()) return;

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch, {
        onSeatChange: (q) => {
          if (this.players[q]) {
            this.players[q].isJoined = this.isSlotJoined(q);
            this.players[q].slotType = this.slotTypes[q];
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
      if (this.handleTabletopTouchStart(touch)) return;
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
      p.charging = false;
      p.charge = 0;
      p.keyActionLatch = false;
    });
  }

  pointBlocked(x, y) {
    return pointBlocked(x, y, this.obstacles, 0);
  }

  update(now) {
    const dt = Math.max(0, Math.min((now - this.lastTime) / 1000, 0.08));
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
    tickPickupTimers(this, dt);

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.shotCooldown > 0) {
        player.shotCooldown = Math.max(0, player.shotCooldown - dt);
      }
      updateFireFeedback(player);
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
        const joy = this.joysticks[player.index];
        if (joy && joy.active && joy.force > 0.08) {
          player.steerX = Math.cos(joy.angle) * joy.force;
          player.steerY = Math.sin(joy.angle) * joy.force;
        } else if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
        } else if (!player.remoteActive) {
          player.steerX = 0;
          player.steerY = 0;
        }
        const aim = this.getAimVector(player.index);
        if (this.getAimState(player.index)?.active) {
          player.angle = aim.angle;
        } else if (joy && joy.active && joy.force > 0.08) {
          player.angle = joy.angle;
        } else if (ki.dx !== 0 || ki.dy !== 0) {
          player.angle = Math.atan2(ki.dy, ki.dx);
        }

        // Klavye de aynı aim lifecycle'ını kullanır; movement yönü attack
        // açısı olarak canonical state'e yazılır.
        if (ki.action) {
          if (!player.keyActionLatch) {
            const angle = player.angle;
            this.handleSlotAimStart(player.index, {
              dx: Math.cos(angle),
              dy: Math.sin(angle),
              angle,
              force: 1,
            }, { source: 'keyboard' });
            player.keyActionLatch = true;
          }
        } else if (player.keyActionLatch) {
          player.keyActionLatch = false;
          const angle = player.angle;
          this.handleSlotAimEnd(player.index, {
            dx: Math.cos(angle),
            dy: Math.sin(angle),
            angle,
            force: 1,
          }, { source: 'keyboard', cancelled: false });
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

      clampToArena(player, player.radius, this.arena);
      resolveAABB(player, this.obstacles, player.radius);
    }

    // Oklar: swept segment collision prevents endpoint tunneling on slow frames.
    for (let ai = this.arrows.length - 1; ai >= 0; ai--) {
      const a = this.arrows[ai];
      const step = Math.hypot(a.vx, a.vy) * dt;
      const startX = a.x;
      const startY = a.y;
      const endX = startX + a.vx * dt;
      const endY = startY + a.vy * dt;
      a.life -= dt;

      let dead = a.life <= 0;
      let hit = null;

      if (!dead && step > 0) {
        for (const obstacle of this.obstacles) {
          const candidate = segmentAabbIntersection(startX, startY, endX, endY, obstacle, 3);
          if (candidate && (!hit || candidate.t < hit.t)) {
            hit = { type: 'obstacle', ...candidate };
          }
        }
        for (const victim of this.players) {
          if (!victim.isJoined || !victim.isAlive || victim.index === a.owner || victim.spawnProt > 0) continue;
          const candidate = segmentCircleIntersection(
            startX, startY, endX, endY,
            victim.x, victim.y, victim.radius + 6,
          );
          if (candidate && (!hit || candidate.t < hit.t)) {
            hit = { type: 'player', victim, ...candidate };
          }
        }
      }

      if (hit) {
        a.x = hit.x;
        a.y = hit.y;
        a.dist += step * hit.t;
        if (hit.type === 'obstacle') {
          this.spawnHitBurst(a.x, a.y, '#9C988F', false);
          dead = true;
        } else {
          const victim = hit.victim;
          // KALKAN bir ok emer: skor/stun yok
          if (victim.shield > 0) {
            victim.shield -= 1;
            this.spawnHitBurst(victim.x, victim.y, '#06B6D4', true);
            playExplosion();
            dead = true;
          } else {
            const close = a.dist < ARCHER_CLOSE_DIST;
            const pts = close ? 2 : 1;
            this.scores[a.owner] += pts;
            this.roundHits[a.owner] = (this.roundHits[a.owner] || 0) + 1;
            // Yakın mesafede stun çok kısa (spam kilitlenmesin), uzakta tam stun
            const stunDur = a.dist < 110 ? 0.12 : (close ? 0.3 : 0.8);
            victim.stun = Math.max(victim.stun, stunDur);
            victim.charging = false;
            victim.charge = 0;
            const kx = victim.x - a.x;
            const ky = victim.y - a.y;
            const kd = Math.hypot(kx, ky) || 1;
            victim.x = Math.max(this.arena.left + victim.radius, Math.min(this.arena.right - victim.radius, victim.x + (kx / kd) * 26));
            victim.y = Math.max(this.arena.top + victim.radius, Math.min(this.arena.bottom - victim.radius, victim.y + (ky / kd) * 26));
            this.spawnHitBurst(victim.x, victim.y, victim.color, close);
            this.addTrauma(close ? 0.45 : 0.25);
            playExplosion();
            dead = true;
          }
        }
      } else if (!dead) {
        a.x = endX;
        a.y = endY;
        a.dist += step;
      }

      if (!dead && (a.x < this.arena.left || a.x > this.arena.right || a.y < this.arena.top || a.y > this.arena.bottom)) {
        dead = true;
      }
      if (dead) this.arrows.splice(ai, 1);
    }

    // Power-up toplama
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;
      collectPickups(this, player, {
        radiusOf: () => player.radius,
        onCollect: (g, p, pk) => this.applyPickup(p, pk),
      });
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
    if (!player || !player.isJoined || !data) return;
    const isAimRelease = data.action === 'AIM_RELEASE' || data.intent?.phase === 'release';
    const isAimPacket = data.action === 'AIM_PRESS'
      || data.action === 'AIM_MOVE'
      || data.intent?.type === 'aim'
      || data.intent?.id === 'aim';
    if (!['PLAYING', 'ROUND_PAUSE'].includes(this.state) && !isAimRelease) return;
    if (this.state !== 'PLAYING' && isAimPacket && !isAimRelease) return;
    if (!player.isAlive && !isAimRelease) return;

    if (this.applyAimLifecycleInput(slotIndex, data)) return;
    if (!player.isAlive) return;
    if (isInputIntent(data, 'aim') || data.action === 'AIM_MOVE') {
      this.handleSlotAim(slotIndex, data, { source: data.intent?.source || 'network' });
      return;
    }
    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
      const force = Number.isFinite(data.force) ? data.force : Math.hypot(data.dx || 0, data.dy || 0);
      if (force > 0.05) {
        player.steerX = Number.isFinite(data.dx) ? Math.max(-1, Math.min(1, data.dx)) : 0;
        player.steerY = Number.isFinite(data.dy) ? Math.max(-1, Math.min(1, data.dy)) : 0;
        // Aim aktifken bakış sağ çubuktadır, move paketi açı ezmemeli.
        const aimActive = this.getAimState(slotIndex)?.active === true;
        if (!aimActive) {
          if (Number.isFinite(data.angle)) {
            player.angle = data.angle;
          } else if (player.steerX !== 0 || player.steerY !== 0) {
            player.angle = Math.atan2(player.steerY, player.steerX);
          }
        }
        player.remoteActive = true;
      } else {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
    } else if (matchesInputAction(data, 'charge', 'ARCHER_CHARGE', 'press') || data.action === 'ARCHER_CHARGE') {
      const angle = player.angle;
      this.handleSlotAimStart(slotIndex, {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        angle,
        force: 1,
      }, { source: data.intent?.source || 'network' });
    } else if (matchesInputAction(data, 'charge', 'ARCHER_CHARGE_END', 'release') || data.action === 'ARCHER_CHARGE_END') {
      const angle = player.angle;
      this.handleSlotAimEnd(slotIndex, {
        dx: Math.cos(angle),
        dy: Math.sin(angle),
        angle,
        force: 1,
      }, { source: data.intent?.source || 'network', cancelled: false });
    }
  }

  handleRoundEnd(_winner) {
    // 60sn sonu: en çok puanlı raundu alır. Eşitlikte önce isabet sayısı,
    // sonra ikinci beraberlik maçı BERABERE sonlanır; sonsuz döngü oluşmaz.
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

    let roundWinner = winners.length === 1 ? winners[0] : null;
    if (!roundWinner && winners.length > 1) {
      const bestHits = Math.max(...winners.map((p) => this.roundHits[p.index] || 0));
      const hitWinners = winners.filter((p) => (this.roundHits[p.index] || 0) === bestHits);
      if (hitWinners.length === 1) roundWinner = hitWinners[0];
    }

    this.state = 'ROUND_OVER';
    this.roundWinner = roundWinner;
    this.roundTransitionTimer = 2.5;

    if (roundWinner) {
      this.tieRounds = 0;
      this.roundWins[roundWinner.index]++;
      if (this.roundWins[roundWinner.index] >= this.roundsToWin) {
        this.matchWinner = roundWinner;
      }
      return;
    }

    this.tieRounds += 1;
    if (this.tieRounds >= 2) {
      this.matchWinner = null;
      this.matchDraw = true;
      this.state = 'MATCH_OVER';
    }
  }

  render() {
    const { ctx } = this;
    ctx.save();

    ctx.fillStyle = '#D6D3CD';
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);
    this.applyScreenShake(ctx);

    // Arenanın scene kısmı ortak archerView draw'larından gelir (host↔client aynı).
    drawArcherArena(ctx, this.arena, this.obstacles);
    drawArcherPickups(ctx, this.pickups);

    // Engellerin üzerinde her zaman net, yüksek görünürlüklü süre sayacı
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
    }

    // Oklar
    drawArcherArrows(ctx, this.arrows);

    // Oyuncular
    drawArcherPlayers(ctx, this.players, { showFx: this.state === 'PLAYING' });

    // Parçacıklar
    drawArcherParticles(ctx, this.particles);

    this.renderControls(ctx, { extraEntities: this.arrows });
    this.renderHUD(ctx, {
      guideTitle: t('guide.archer'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: ARCHER_COLORS,
      accent: '#8B5CF6',
      scoreboardEntities: [...this.players.filter((p) => p.isJoined && p.isAlive), ...this.arrows],
      matchOverHeadline: t('archer.champ'),
      matchOverRows: this.players.filter((p) => p.isJoined).map((p) => ({
        color: p.color,
        text: `${p.name}: ${this.scores[p.index]}★ · ${this.roundWins[p.index]}R`,
      })),
      onSeatChange: (i) => {
        if (this.players[i]) {
          this.players[i].isJoined = this.isSlotJoined(i);
          this.players[i].slotType = this.slotTypes[i];
        }
        playJoin();
      },
    });
    ctx.restore();
  }
}
