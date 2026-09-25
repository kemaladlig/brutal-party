// BRUTAL BOMB (Game 04): 2-4 Player Local Party Bomb Tag / Saatli Bomba
// 360° Floating Corner Joysticks, Passing Physics, Whiskers & Waypoint Steering, Tackle Dash, 3 Maps & Panic Phase
import { getSlotCustomization } from '../core/customizationManager.js';
import {
  playExplosion,
  playStart,
  playJoin,
  playBombTick,
  playBombPass,
  playTeleport,
  playSlip,
  playItemPickup,
  playDashWhoosh,
  playPanicHeartbeat,
  playStumble,
} from '../audio.js';
import { t } from '../i18n.js';
import { matchesInputAction } from '../core/inputIntent.js';
import { renderArenaWatermarkTimer, renderAdaptiveScoreboard } from '../ui/hud.js';
import { getUiScale } from '../ui/tokens.js';
import { pulse } from '../ui/motion.js';

import { BaseMiniGame } from '../core/BaseGame.js';
import { buildLayout } from '../core/arenaKit.js';
import { updateBombBotAI } from '../ai/bombAI.js';
import { keyboardVectorFrom } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap } from '../core/touchFlow.js';
import { clampToArena, resolveAABB } from '../core/physics2d.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';
import { createPlayer, tickEffectTimers, advancePlayer } from '../core/playerEntity.js';
import { beginDrawRound, hasMatchResult, roundTimedOut } from '../core/roundLifecycle.js';
import {
  createBombWorldPacket,
  drawBombArena,
  drawBombInk,
  drawBombPickups,
  drawBombPlayers,
  drawBombParticles,
} from './bombView.js';

export const BOMB_COLORS = ['#D84727', '#2B5B84', '#D99B26', '#2D6A4F'];
export const BOMB_NAMES = ['P1', 'P2', 'P3', 'P4'];

// Depar bekleme süresi (sn) — triggerDash, entity HUD ve masa-ortası butonu aynı kaynaktan okur
const BOMB_DASH_COOLDOWN = 2.2;
const BOMB_ROUND_LIMIT = 90;

export const MAP_PRESETS = [
  { id: 'columns4', name: '01 // 4 SİPER KOLONU' },
  { id: 'bunker', name: '02 // MERKEZ SIĞINAK' },
  { id: 'crossfire', name: '03 // HAÇ & KORİDORLAR' },
  { id: 'courtyard', name: '04 // AVLU & DÖNER SİPER' },
  { id: 'split', name: '05 // İKİLİ BLOK BARİKAT' },
];

export class BombGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // Arena geometry
    this.arena = {
      cx: 0,
      cy: 0,
      size: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    };

    // Arena Maps & Obstacles
    this.selectedMapIndex = 0;
    this.pillars = [];

    // Slot types: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Set Tournament Scoring
    this.targetScore = 3;
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.roundTimer = 0;
    this.roundLimit = BOMB_ROUND_LIMIT;
    this.roundTransitionTimer = 0;

    // Entities & Mechanics
    this.players = [];
    this.bombCarrierIndex = -1;
    this.bombTimer = 15.0;
    this.bombMaxTime = 15.0;
    this.passCooldown = 0;
    this.lastTickTime = 0;
    this.lastHeartbeatTime = 0;

    // Tactical Pickups & Obstacles
    this.pickups = [];
    this.pickupSpawnTimer = 6.0;
    this.inkPuddles = [];
    this.particles = [];

    // Screen Shake (Trauma)
    this.trauma = 0;
    this.lastTime = performance.now();

    // UI Buttons
    this.uiButtons = [];

    // 4 Corner Floating Virtual Joysticks (P1: BL, P2: TL, P3: TR, P4: BR)
    this.joysticks = [
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
    ];

    // Keyboard Controls
    this.keys = {};
    this.initKeyboard();
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('BOMB'),
      actions: [
        {
          id: 'dash',
          icon: '⚡',
          color: '#FFDE59',
          cooldownField: 'dashCooldown',
          cooldownMaxField: 'dashMaxCooldown',
          maxCooldown: BOMB_DASH_COOLDOWN,
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown) return;
    if (actionId === 'dash') {
      this.triggerDash(slotIndex);
    }
  }

  initKeyboard() {
    this.bindStandardKeyboard((slot) => {
      this.triggerDash(slot);
    });
  }

  createWorldPacket() {
    return createBombWorldPacket(this);
  }

  cycleSlotType(index) {
    if (this.requestLobbySeatTap(index)) return;
    if (this.slotTypes[index] === 'empty') {
      this.slotTypes[index] = 'human';
    } else if (this.slotTypes[index] === 'human') {
      this.slotTypes[index] = 'bot_normal';
    } else if (this.slotTypes[index] === 'bot_normal') {
      this.slotTypes[index] = 'bot_god';
    } else {
      this.slotTypes[index] = 'empty';
    }
    this.syncSlotEntity(index);
    playJoin();
  }

  cycleMap() {
    this.selectedMapIndex = (this.selectedMapIndex + 1) % MAP_PRESETS.length;
    // Lobide elle seçilen harita bir sonraki rauntta korunur (oto-döndürme ezmez)
    this.mapPickedInLobby = true;
    this.buildMapPillars();
    playJoin();
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;
    const size = Math.min(arenaW, arenaH);

    this.arena = {
      cx: width / 2,
      cy: height / 2,
      width: arenaW,
      height: arenaH,
      size: size,
      left: marginX,
      right: width - marginX,
      top: marginY,
      bottom: height - marginY,
    };

    this.buildMapPillars();
    // Maç ortası resize raundu sıfırlamasın
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
      clampToArena(p, p.radius, this.arena, { zeroVelocity: true });
      resolveAABB(p, this.pillars, p.radius);
      p.vx = 0; p.vy = 0;
      p.lastX = p.x; p.lastY = p.y;
    }
    for (const item of this.pickups) {
      this.remapPoint(item, oldArena, this.arena);
      clampToArena(item, item.radius || item.size || 15, this.arena);
    }
    for (const ink of this.inkPuddles) {
      this.remapPoint(ink, oldArena, this.arena);
      clampToArena(ink, ink.radius || 22, this.arena);
    }
    this.particles = [];
  }

  buildMapPillars() {
    const preset = MAP_PRESETS[this.selectedMapIndex];
    const layoutName = preset ? preset.id : 'pillars';
    this.pillars = buildLayout(layoutName, this.arena);
  }

  initPlayers() {
    const { cx, cy, size } = this.arena;
    const spawnDist = Math.round(size * 0.36);
    const r = Math.max(14, Math.round(size * 0.038));

    const spawns = [
      { x: cx - spawnDist * 0.707, y: cy + spawnDist * 0.707 }, // P1: Bottom-Left
      { x: cx - spawnDist * 0.707, y: cy - spawnDist * 0.707 }, // P2: Top-Left
      { x: cx + spawnDist * 0.707, y: cy - spawnDist * 0.707 }, // P3: Top-Right
      { x: cx + spawnDist * 0.707, y: cy + spawnDist * 0.707 }, // P4: Bottom-Right
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      return createPlayer(i, s, {
        existingName: existing?.name,
        defaultNames: BOMB_NAMES,
        defaultColors: BOMB_COLORS,
        radius: r,
        speed: 175,
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        stepCycle: 0,
        lastX: s.x,
        lastY: s.y,
        stuckAccumulator: 0,
        unstuckDuration: 0,
        unstuckAngle: 0,
        aiMoveX: 0,
        aiMoveY: 0,
        aiForce: 0,
      });
    });
  }

  resetCurrentGame() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.roundTimer = 0;
    this.bombCarrierIndex = -1;
    this.pickups = [];
    this.inkPuddles = [];
    this.particles = [];
    this.trauma = 0;
    this.lastTime = performance.now();
    for (let i = 0; i < 4; i++) {
      if (this.joysticks[i]) {
        this.joysticks[i].active = false;
        this.joysticks[i].id = null;
        this.joysticks[i].force = 0;
      }
    }
    this.initPlayers();
  }

  resetMatch() {
    this.resetCurrentGame();
  }

  reset() {
    this.resetCurrentGame();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.startNewRound();
  }

  startNewRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }

    // Lobide seçilmediyse haritayı rastgele seç; seçildiyse kullanıcının seçimi kalır
    if (!this.mapPickedInLobby) {
      this.selectedMapIndex = Math.floor(Math.random() * MAP_PRESETS.length);
    }
    this.mapPickedInLobby = false;
    this.buildMapPillars();

    this.state = 'PLAYING';
    this.roundWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTimer = 0;
    this.roundTransitionTimer = 0;
    this.pickups = [];
    this.inkPuddles = [];
    this.particles = [];

    // Respawn players at corner positions
    this.initPlayers();

    // Pick random player to hold initial ticking bomb
    const randomIndex = Math.floor(Math.random() * joined.length);
    this.bombCarrierIndex = joined[randomIndex].index;
    this.bombTimer = 15.0;
    this.bombMaxTime = 15.0;
    this.passCooldown = 1.0;
    this.lastTickTime = performance.now();
    this.lastHeartbeatTime = performance.now();

    playStart();
  }

  triggerDash(playerIndex) {
    // Lobi/maç-sonunda kumandadan depar tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    const p = this.players[playerIndex];
    if (!p || !p.isAlive || p.dashCooldown > 0 || p.slipTimer > 0 || p.stumbleTimer > 0) return;

    p.dashCooldown = BOMB_DASH_COOLDOWN;
    p.dashMaxCooldown = BOMB_DASH_COOLDOWN;
    p.dashTimer = 0.22;
    p.isDashing = true;
    this.trauma = Math.min(1.0, this.trauma + 0.15);

    playDashWhoosh();

    // Spawn burst dust/smoke particles behind player
    const behindAngle = p.facingAngle + Math.PI;
    for (let i = 0; i < 9; i++) {
      const spd = 40 + Math.random() * 90;
      const spread = (Math.random() - 0.5) * 0.9;
      this.particles.push({
        x: p.x + Math.cos(behindAngle) * p.radius,
        y: p.y + Math.sin(behindAngle) * p.radius,
        vx: Math.cos(behindAngle + spread) * spd,
        vy: Math.sin(behindAngle + spread) * spd,
        life: 0.3 + Math.random() * 0.2,
        maxLife: 0.5,
        color: '#D5D0C7',
        size: 4 + Math.random() * 4,
      });
    }
  }

  transferBomb(toPlayerIndex) {
    if (this.passCooldown > 0) return;
    if (toPlayerIndex === this.bombCarrierIndex) return;

    const prevCarrierIndex = this.bombCarrierIndex;
    const prevCarrier = this.players[prevCarrierIndex];
    const newCarrier = this.players[toPlayerIndex];

    if (!newCarrier || newCarrier.immunityTimer > 0) return;

    this.bombCarrierIndex = toPlayerIndex;
    this.passCooldown = 1.6; // Solid window before another pass can occur
    this.trauma = 0.55;

    playBombPass();
    playStumble();

    // 1. Stumble Shock Delay on Receiver: heavily stunned/slowed for 0.6s!
    newCarrier.stumbleTimer = 0.6;

    // 2. Escaper Sprint & Immunity on Giver: guarantees head start to flee!
    if (prevCarrier) {
      prevCarrier.escapeBoostTimer = 1.2; // +35% escape sprint
      prevCarrier.immunityTimer = 1.6;    // immune to bomb for 1.6s
    }

    // 3. Kinetic separation: physically push runners apart by 32px
    if (prevCarrier) {
      const dx = newCarrier.x - prevCarrier.x;
      const dy = newCarrier.y - prevCarrier.y;
      const d = Math.hypot(dx, dy) || 1;
      const pushDist = 32;
      newCarrier.x += (dx / d) * pushDist;
      newCarrier.y += (dy / d) * pushDist;
      prevCarrier.x -= (dx / d) * pushDist;
      prevCarrier.y -= (dy / d) * pushDist;
      this.resolveCollisions(newCarrier);
      this.resolveCollisions(prevCarrier);
    }

    // Spawn sparks between runners
    for (let i = 0; i < 20; i++) {
      this.particles.push({
        x: newCarrier.x,
        y: newCarrier.y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.5) * 260,
        life: 0.35,
        maxLife: 0.35,
        color: '#FFDE59',
        size: 3 + Math.random() * 4,
      });
    }
  }

  explodeCarrier() {
    const carrier = this.players[this.bombCarrierIndex];
    if (!carrier || !carrier.isAlive) return;

    carrier.isAlive = false;
    this.trauma = 1.0;
    playExplosion();

    // Explosion shockwave and smoke debris
    for (let i = 0; i < 40; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 280;
      this.particles.push({
        x: carrier.x,
        y: carrier.y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.7 + Math.random() * 0.4,
        maxLife: 1.0,
        color: i % 2 === 0 ? '#1A1A1A' : '#D84727',
        size: 4 + Math.random() * 7,
      });
    }

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);

    if (alive.length <= 1) {
      this.resolveLoneSurvivor(alive);
    } else {
      // Multiple players still alive: pick survivor for next bomb
      const nextIndex = Math.floor(Math.random() * alive.length);
      this.bombCarrierIndex = alive[nextIndex].index;
      this.bombTimer = Math.max(9.0, 15.0 - (4 - alive.length) * 2.0);
      this.bombMaxTime = this.bombTimer;
      this.passCooldown = 1.2;
    }
  }

  // Tek katılımcı kalınca raunt hemen biter (patlama beklenmez)
  resolveLoneSurvivor(alive) {
    const remaining = alive || this.players.filter((p) => p.isJoined && p.isAlive);
    if (remaining.length > 1 || this.state !== 'PLAYING') return false;
    if (remaining.length === 1) {
      const survivor = remaining[0];
      this.roundWinner = survivor;
      this.scores[survivor.index]++;
      if (this.scores[survivor.index] >= this.targetScore) {
        this.state = 'MATCH_OVER';
        this.matchWinner = survivor;
        return true;
      }
    } else {
      beginDrawRound(this, 'no-survivor', 2.4);
      return true;
    }
    this.state = 'ROUND_OVER';
    this.matchDraw = false;
    this.roundTransitionTimer = 2.4;
    return true;
  }

  spawnPickup() {
    spawnPickup(this, {
      types: ['TURBO', 'TELEPORT', 'SLIP'],
      max: 2,
      obstacles: this.pillars,
    });
  }

  onTouchStart(touch) {
    // 1. UI Buttons tap handling (yalnızca Lobi ve Maç Sonu ekranlarında)
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
    }

    if (this.handleRoundOverSkip()) return;

    // 1.5. Generous Lobby Join fallback (tap anywhere in quadrant)
    if (this.state === 'LOBBY') {
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch);
      return;
    }

    // 2. Tabletop butonları + joystick (tek merkezden, BaseGame)
    if (this.state === 'PLAYING') {
      this.handleTabletopTouchStart(touch);
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    this.handleTabletopTouchMove(touch);
  }

  handleRemoteInput(slotIndex, data) {
    this.handleStandardRemoteJoystick(slotIndex, data, (slot, d) => {
      if (matchesInputAction(d, 'dash', 'DASH')) {
        this.triggerDash(slot);
      }
    });
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
  }

  // --- SMART BOT AI (Delegated to src/ai/bombAI.js) ---
  updateBotAI(bot, dt) {
    updateBombBotAI(this, bot, dt);
  }

  // --- COLLISION RESOLUTION ---

  resolveCollisions(player) {
    clampToArena(player, player.radius, this.arena, { zeroVelocity: true });
    resolveAABB(player, this.pillars, player.radius);
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Screen Shake decay
    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    // Round Over countdown
    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        if (hasMatchResult(this)) {
          this.state = 'MATCH_OVER';
        } else {
          this.startNewRound();
        }
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    this.roundTimer += dt;
    if (roundTimedOut(this.roundTimer, this.roundLimit)) {
      beginDrawRound(this, 'timeout', 1.6);
      return;
    }

    // Taşıyıcı ayrıldıysa/öldüyse bomba canlı birine geçer; kimse kalmadıysa bitir
    const activeCarrier = this.players[this.bombCarrierIndex];
    if (!activeCarrier || !activeCarrier.isJoined || !activeCarrier.isAlive) {
      const alive = this.players.filter((p) => p.isJoined && p.isAlive);
      if (alive.length <= 1) {
        this.resolveLoneSurvivor(alive);
        return;
      }
      const nextIndex = Math.floor(Math.random() * alive.length);
      this.bombCarrierIndex = alive[nextIndex].index;
      this.bombTimer = Math.max(9.0, 15.0 - (4 - alive.length) * 2.0);
      this.bombMaxTime = this.bombTimer;
      this.passCooldown = 1.2;
    }

    // Tek katılımcı kontrolü (ayrılma patlamayı beklemez)
    if (this.resolveLoneSurvivor()) return;

    // Decrement Bomb Timer & Audio
    this.bombTimer -= dt;
    if (this.passCooldown > 0) {
      this.passCooldown -= dt;
    }

    const urgency = 1.0 - Math.max(0, this.bombTimer / this.bombMaxTime);
    const isPanic = this.bombTimer <= 4.0;

    // Ticking audio interval
    const tickInterval = isPanic
      ? 0.1
      : urgency > 0.65
      ? 0.22
      : urgency > 0.4
      ? 0.45
      : 1.0;

    if (now - this.lastTickTime > tickInterval * 1000) {
      playBombTick(urgency);
      this.lastTickTime = now;
    }

    // Panic Phase Heartbeat audio
    if (isPanic && now - this.lastHeartbeatTime > 900) {
      playPanicHeartbeat();
      this.lastHeartbeatTime = now;
    }

    // Bomb Detonation!
    if (this.bombTimer <= 0) {
      this.explodeCarrier();
      return;
    }

    // Spawning Pickups & Timers
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupSpawnTimer = 8.0 + Math.random() * 4.0;
    }

    tickPickupTimers(this, dt);

    // Update Ink Puddles
    for (let i = this.inkPuddles.length - 1; i >= 0; i--) {
      const p = this.inkPuddles[i];
      p.duration -= dt;
      if (p.duration <= 0) {
        this.inkPuddles.splice(i, 1);
      }
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.life -= dt;
      if (part.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update Players
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      const isCarrier = player.index === this.bombCarrierIndex;

      // Status timers
      if (player.turboTimer > 0) player.turboTimer -= dt;
      if (player.dashCooldown > 0) player.dashCooldown -= dt;
      if (player.dashTimer > 0) {
        player.dashTimer -= dt;
        if (player.dashTimer <= 0) player.isDashing = false;
      }
      if (player.stumbleTimer > 0) player.stumbleTimer -= dt;
      if (player.immunityTimer > 0) player.immunityTimer -= dt;
      if (player.escapeBoostTimer > 0) player.escapeBoostTimer -= dt;
      if (player.slipTimer > 0) {
        player.slipTimer -= dt;
        player.slipAngle += dt * 16.0;
      }

      // Determine Movement Intent (dx, dy)
      let inputX = 0;
      let inputY = 0;

      if (player.slotType === 'human') {
        const joy = this.joysticks[player.index];
        if (joy.active && joy.force > 0.05) {
          inputX = Math.cos(joy.angle) * joy.force;
          inputY = Math.sin(joy.angle) * joy.force;
        }

        // Keyboard Fallback
        const kb = keyboardVectorFrom(this.keys, player.index);
        inputX += kb.x;
        inputY += kb.y;
      } else {
        // Smart Bot AI (Whiskers, Waypoints & Wall Tangent Slide)
        this.updateBotAI(player, dt);
        inputX = player.aiMoveX || 0;
        inputY = player.aiMoveY || 0;
      }

      // Speed modifiers
      let currentSpeed = player.speed;
      if (isCarrier) {
        currentSpeed *= 1.16; // Bomb carrier is faster to keep chases tense
      }
      if (player.turboTimer > 0) {
        currentSpeed *= 1.55;
      }
      if (player.escapeBoostTimer > 0) {
        currentSpeed *= 1.35; // Escaper burst sprint!
      }
      if (player.dashTimer > 0) {
        currentSpeed = 360; // Supersonic dash speed!
      }
      if (player.stumbleTimer > 0) {
        currentSpeed *= 0.15; // Receiver stumble delay: heavily slowed down for 0.6s!
      }

      if (player.slipTimer > 0) {
        // Low traction while slipping
        player.vx *= 0.96;
        player.vy *= 0.96;
      } else {
        const inputLen = Math.hypot(inputX, inputY);
        if (inputLen > 0.05) {
          const normX = inputX / inputLen;
          const normY = inputY / inputLen;
          player.vx = normX * currentSpeed;
          player.vy = normY * currentSpeed;
          player.facingAngle = Math.atan2(normY, normX);
          player.stepCycle += dt * 14;

          // Motion trails
          if ((player.turboTimer > 0 || player.dashTimer > 0) && Math.random() < 0.5) {
            this.particles.push({
              x: player.x,
              y: player.y,
              vx: (Math.random() - 0.5) * 30,
              vy: (Math.random() - 0.5) * 30,
              life: 0.22,
              maxLife: 0.22,
              color: player.dashTimer > 0 ? '#FFFFFF' : '#FFDE59',
              size: player.dashTimer > 0 ? 5 : 3,
            });
          }
        } else {
          player.vx *= 0.7;
          player.vy *= 0.7;
        }
      }

      // Position update & wall collisions
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      this.resolveCollisions(player);

      // Ink Puddles interaction
      for (const puddle of this.inkPuddles) {
        const dPuddle = Math.hypot(player.x - puddle.x, player.y - puddle.y);
        if (dPuddle < player.radius + puddle.radius * 0.75 && player.slipTimer <= 0) {
          player.slipTimer = 1.3;
          playSlip();
          break;
        }
      }

      // Pickups interaction
      collectPickups(this, player);
    }

    // Carrier vs Opponents Collision & Bomb Transfer!
    const carrier = this.players[this.bombCarrierIndex];
    if (carrier && carrier.isAlive) {
      for (const opponent of this.players) {
        if (
          opponent.index !== carrier.index &&
          opponent.isJoined &&
          opponent.isAlive
        ) {
          const dx = opponent.x - carrier.x;
          const dy = opponent.y - carrier.y;
          const dist = Math.hypot(dx, dy);
          const minDist = carrier.radius + opponent.radius;

          if (dist < minDist) {
            // Elastic separation
            const overlap = minDist - dist;
            if (dist > 0.001) {
              const nx = dx / dist;
              const ny = dy / dist;
              carrier.x -= nx * overlap * 0.5;
              carrier.y -= ny * overlap * 0.5;
              opponent.x += nx * overlap * 0.5;
              opponent.y += ny * overlap * 0.5;
            }

            // Transfer the bomb (only if cooldown expired and opponent is not immune)!
            if (this.passCooldown <= 0 && opponent.immunityTimer <= 0) {
              this.transferBomb(opponent.index);
            }
          }
        }
      }
    }
  }

  // --- RENDERING PIPELINE ---

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    // Background paper
    ctx.fillStyle = '#F4F0EA';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Screen Shake (Trauma)
    if (this.trauma > 0) {
      const shakeIntensity = this.trauma * this.trauma * 16;
      const offsetX = (Math.random() - 0.5) * 2 * shakeIntensity;
      const offsetY = (Math.random() - 0.5) * 2 * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }

    // Arena sahnesi ortak bombView draw'larından gelir (host↔client aynı).
    const carrierP = this.players[this.bombCarrierIndex];
    drawBombArena(ctx, this.arena, this.pillars, {
      carrier: carrierP && carrierP.isAlive
        ? { x: carrierP.x, y: carrierP.y, radius: carrierP.radius, alive: true }
        : null,
      bombTimer: this.bombTimer,
      bombMaxTime: this.bombMaxTime,
    });
    drawBombInk(ctx, this.inkPuddles);
    drawBombPickups(ctx, this.pickups);
    drawBombPlayers(ctx, this.players.map((p) => ({
      ...p,
      carrier: p.index === this.bombCarrierIndex,
      stumble: p.stumbleTimer, immunity: p.immunityTimer,
      dash: p.dashTimer, turbo: p.turboTimer,
      slip: p.slipTimer, slipAngle: p.slipAngle,
      cd: p.dashCooldown, cdMax: p.dashMaxCooldown,
      angle: p.facingAngle,
    })), {
      bombTimer: this.bombTimer,
      bombMaxTime: this.bombMaxTime,
      withFx: this.state === 'PLAYING',
    });
    drawBombParticles(ctx, this.particles);
    this.renderControls(ctx);

    // Host HUD: Skorbord + bomba geri sayımı (world-view client'ı kendi HUD'unu kullanır)
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderAdaptiveScoreboard(ctx, {
        arena: this.arena,
        players: this.players,
        scores: this.scores,
        entities: this.players.filter((p) => p.isJoined),
        isHosting: !!this.hideLobbyStartButton,
        state: this.state,
      });
      const remain = Math.max(0, this.bombTimer);
      const isPanic = remain <= 4.0;
      const carrierP2 = this.bombCarrierIndex !== null ? this.players[this.bombCarrierIndex] : null;
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${remain.toFixed(1)}s`,
        subText: '',
        urgent: isPanic,
        color: isPanic ? '#D84727' : (carrierP2 ? carrierP2.color : null),
        alpha: isPanic ? 0.72 : 0.50,
        ringProgress: Math.max(0, remain / this.bombMaxTime),
      });
    }

    // Panic Phase Red Border Vignette (Last 4 Seconds)
    if (this.state === 'PLAYING' && this.bombTimer <= 4.0) {
      const pulseAlpha = pulse(0.18, 0.12, 0.015);
      ctx.fillStyle = `rgba(216, 71, 39, ${pulseAlpha})`;
      // Arena kenar şeritleri (CSS pikseli; canvas.width device-px olur, kullanılmaz)
      const { left, top, width, height, right, bottom } = this.arena;
      const edge = 16;
      ctx.fillRect(left, top - edge, width, edge);
      ctx.fillRect(left, bottom, width, edge);
      ctx.fillRect(left - edge, top - edge, edge, height + edge * 2);
      ctx.fillRect(right, top - edge, edge, height + edge * 2);
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.bomb'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: BOMB_COLORS,
      playerNames: BOMB_NAMES,
      accent: '#D84727',
      roundBannerTitle: this.roundWinner ? `+1 SET: ${this.roundWinner.name}!` : null,
      roundBannerColor: this.roundWinner?.color,
      roundBannerSub: this.roundWinner ? `TOPLAM SET: ${this.scores[this.roundWinner.index]} / ${this.targetScore}` : '',
      matchOverHeadline: this.matchDraw ? t('game.draw') : t('game.champWon'),
      matchOverRows: this.matchWinner
        ? this.players
            .filter((p) => p.isJoined)
            .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★` }))
        : [],
      onRestart: () => this.resetCurrentGame(),
      customControls: (c) => {
        const { arena } = this;
        const mapBtnW = Math.min(220, arena.size * 0.52);
        const mapBtnH = 36;
        const mapBtnX = arena.cx - mapBtnW / 2;
        const mapBtnY = arena.cy - 72;
        c.save();
        c.fillStyle = '#1A1A1A';
        c.fillRect(mapBtnX + 3, mapBtnY + 3, mapBtnW, mapBtnH);
        c.fillStyle = '#FFFFFF';
        c.fillRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);
        c.strokeStyle = '#1C1C1A';
        c.lineWidth = 2.5;
        c.strokeRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);

        c.fillStyle = '#1C1C1A';
        c.font = '800 12px "JetBrains Mono", monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`🗺️ ${MAP_PRESETS[this.selectedMapIndex].name} ▾`, arena.cx, mapBtnY + mapBtnH / 2);
        c.restore();

        this.uiButtons.push({
          x: mapBtnX,
          y: mapBtnY,
          w: mapBtnW,
          h: mapBtnH,
          onClick: () => this.cycleMap(),
        });
      },
    });

    ctx.restore();
  }

}