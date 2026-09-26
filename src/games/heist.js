// BRUTAL HEIST (Game 05): 2-4 Player Local Party Gold & Vault Stealing
// Weight Physics, Shoulder Tackle Loot Knockout, Vault Banking & Raids, 45s Gold Rush & Bot AI
import { getSlotCustomization } from '../core/customizationManager.js';
import {
  playStart,
  playJoin,
  playDashWhoosh,
  playStumble,
  playCoinPickup,
  playCashRegister,
  playVaultAlarm,
  playHeavyImpact,
  playPiggyBreak,
} from '../audio.js';
import { t } from '../i18n.js';
import { matchesInputAction } from '../core/inputIntent.js';
import {
  renderArenaWatermarkTimer,
} from '../ui/hud.js';
import { pulse } from '../ui/motion.js';

import { BaseMiniGame } from '../core/BaseGame.js';
import { updateHeistBotAI } from '../ai/heistAI.js';
import { keyboardVectorFrom } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap } from '../core/touchFlow.js';
import { clampToArena, resolveAABB } from '../core/physics2d.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { createPlayer } from '../core/playerEntity.js';
import { beginDrawRound, hasMatchResult, roundTimedOut } from '../core/roundLifecycle.js';
import {
  createHeistWorldPacket,
  drawHeistArena,
  drawHeistVaults,
  drawHeistLoot,
  drawHeistPiggy,
  drawHeistPlayers,
  drawHeistTexts,
} from './heistView.js';
import { drawSquareParticles } from './worldCore.js';

export const HEIST_COLORS = ['#D84727', '#2B5B84', '#D99B26', '#2D6A4F'];
export const HEIST_NAMES = ['P1', 'P2', 'P3', 'P4'];

export const HEIST_TUNING = {
  TACKLE_COOLDOWN: 3.5,
  ROUND_TIME: 45,
  MAX_TIED_ROUNDS: 2,
};

export class HeistGame extends BaseMiniGame {
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

    // 4 Corner Vaults & 4 Obstacle Pillars
    this.vaults = [];
    this.pillars = [];

    // Slot types: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Tournament Scoring (Sets)
    this.targetScore = 2; // First to 2 round wins is Champion!
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.roundTransitionTimer = 0;

    // Timing
    this.roundTimer = 45.0; // 45 seconds match
    this.goldRushActive = false;
    this.lootSpawnTimer = 1.5;

    // Entities
    this.players = [];
    this.lootItems = [];
    this.particles = [];
    this.floatingTexts = [];
    this.piggyBank = null;
    this.piggySpawned30 = false;
    this.piggySpawned15 = false;

    // Screen Shake (Trauma)
    this.trauma = 0;
    this.lastTime = performance.now();

    this.initKeyboard();
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('HEIST'),
      actions: [
        {
          id: 'tackle',
          icon: '💥',
          cooldownField: 'tackleCooldown',
          maxCooldown: HEIST_TUNING.TACKLE_COOLDOWN,
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown || actionId !== 'tackle') return;
    this.triggerTackle(slotIndex);
  }

  initKeyboard() {
    this.bindStandardKeyboard((slot) => {
      this.triggerTackle(slot);
    });
  }

  createWorldPacket() {
    return createHeistWorldPacket(this);
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

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };

    this.arena = computePlayfield(width, height, 'standard');

    const { left, right, top, bottom, cx, cy, size } = this.arena;

    // 4 Corner Vault Zones (merkeze yakın: köşeden %8 içerde, %20 boy)
    const vW = Math.round(size * 0.20);
    const vH = Math.round(size * 0.20);
    const vInset = Math.round(size * 0.08);
    this.vaults = [
      { x: left + vInset, y: bottom - vH - vInset, w: vW, h: vH, playerIndex: 0 }, // P1: Bottom-Left
      { x: left + vInset, y: top + vInset, w: vW, h: vH, playerIndex: 1 },        // P2: Top-Left
      { x: right - vW - vInset, y: top + vInset, w: vW, h: vH, playerIndex: 2 },  // P3: Top-Right
      { x: right - vW - vInset, y: bottom - vH - vInset, w: vW, h: vH, playerIndex: 3 }, // P4: Bottom-Right
    ];

    // 4 Obstacle Pillars (köşegen dışında: doğuş noktasını kapatmaz, kasaya taşmaz)
    const pSize = Math.round(size * 0.09);
    const offX = Math.round(size * 0.34);
    const offY = Math.round(size * 0.20);
    this.pillars = [
      { x: cx - offX - pSize / 2, y: cy - offY - pSize / 2, w: pSize, h: pSize },
      { x: cx + offX - pSize / 2, y: cy - offY - pSize / 2, w: pSize, h: pSize },
      { x: cx - offX - pSize / 2, y: cy + offY - pSize / 2, w: pSize, h: pSize },
      { x: cx + offX - pSize / 2, y: cy + offY - pSize / 2, w: pSize, h: pSize },
    ];

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
    for (const item of this.lootItems) {
      this.remapPoint(item, oldArena, this.arena);
      clampToArena(item, item.radius || 9, this.arena);
    }
    if (this.piggyBank) {
      this.remapPoint(this.piggyBank, oldArena, this.arena);
      clampToArena(this.piggyBank, this.piggyBank.radius || 24, this.arena, { zeroVelocity: true });
      this.piggyBank.vx = 0; this.piggyBank.vy = 0;
    }
    this.particles = [];
    this.floatingTexts = [];
  }

  initPlayers() {
    const { cx, cy, size } = this.arena;
    const spawnDist = Math.round(size * 0.42);
    const r = fieldRadius(this.arena, 36, 0.028);

    const spawns = [
      { x: cx - spawnDist * 0.707, y: cy + spawnDist * 0.707, angle: -Math.PI * 0.25 }, // P1: Bottom-Left
      { x: cx - spawnDist * 0.707, y: cy - spawnDist * 0.707, angle: Math.PI * 0.25 },  // P2: Top-Left
      { x: cx + spawnDist * 0.707, y: cy - spawnDist * 0.707, angle: Math.PI * 0.75 },  // P3: Top-Right
      { x: cx + spawnDist * 0.707, y: cy + spawnDist * 0.707, angle: -Math.PI * 0.75 }, // P4: Bottom-Right
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      return createPlayer(i, s, {
        existingName: existing?.name,
        defaultNames: HEIST_NAMES,
        defaultColors: HEIST_COLORS,
        radius: r,
        speed: fieldSpeed(this.arena, 190),
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        baseSpeed: fieldSpeed(this.arena, 190),
        vaultGold: 0,
        carriedGold: 0,
        carriedItems: 0,
        carriedWeight: 0,
        tackleCooldown: 0,
        tackleTimer: 0,
        isTackling: false,
        stumbleTimer: 0,
        raidTimer: 0,
        raidTarget: -1,
        lastX: s.x,
        lastY: s.y,
        stuckAccumulator: 0,
        unstuckDuration: 0,
        unstuckAngle: 0,
        aiMoveX: 0,
        aiMoveY: 0,
        aiForce: 0,
        aiState: 'COLLECT',
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
    this.tiedRounds = 0;
    this.roundTimer = HEIST_TUNING.ROUND_TIME;
    this.goldRushActive = false;
    this.lootItems = [];
    this.particles = [];
    this.floatingTexts = [];
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
    this.uiButtons = [];
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
    this.startNewRound();
  }

  startNewRound() {
    this.uiButtons = [];
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }

    this.state = 'PLAYING';
    this.roundTimer = HEIST_TUNING.ROUND_TIME;
    this.goldRushActive = false;
    this.roundWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTied = false;
    this.roundTransitionTimer = 0;
    this.lootItems = [];
    this.particles = [];
    this.floatingTexts = [];

    // Respawn players & reset vaults for new round
    this.initPlayers();
    for (const p of this.players) {
      p.vaultGold = 0;
      p.carriedGold = 0;
      p.carriedItems = 0;
      p.carriedWeight = 0;
    }

    this.piggyBank = null;
    this.piggySpawned30 = false;
    this.piggySpawned15 = false;

    // Spawn initial wave of central gold
    for (let i = 0; i < 8; i++) {
      this.spawnLootItem('COIN');
    }
    this.spawnLootItem('DIAMOND');

    playStart();
  }

  // Kasa liderine set verir (hedefe ulaşırsa maç biter)
  awardVaultWinner(winner) {
    this.roundTied = false;
    this.tiedRounds = 0;
    this.matchDraw = false;
    this.roundWinner = winner;
    this.scores[winner.index]++;
    if (this.scores[winner.index] >= this.targetScore) {
      this.state = 'MATCH_OVER';
      this.matchWinner = winner;
      return;
    }
    this.state = 'ROUND_OVER';
    this.roundTransitionTimer = 2.8;
  }

  finishTiedRound(reason = 'tie') {
    if (!this.players.some((p) => p.isJoined)) {
      beginDrawRound(this, reason, 1.6);
      return;
    }
    this.roundTied = true;
    this.roundWinner = null;
    this.tiedRounds += 1;
    if (this.tiedRounds >= HEIST_TUNING.MAX_TIED_ROUNDS) {
      beginDrawRound(this, reason, 1.6);
      return;
    }
    this.state = 'ROUND_OVER';
    this.roundTransitionTimer = 2.8;
  }

  spawnPiggyBank() {
    const angle = Math.random() * Math.PI * 2;
    const speed = fieldSpeed(this.arena, 120);
    this.piggyBank = {
      x: this.arena.cx,
      y: this.arena.cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: fieldRadius(this.arena, 24, 0.026),
      hp: 3,
      maxHp: 3,
      hitTimer: 0,
      animTime: 0,
    };
    playVaultAlarm();
    this.trauma = 0.4;
    this.addFloatingText(this.arena.cx, this.arena.cy - 40, t('heist.pig'), '#FFDE59');
  }

  spawnLootItem(type = 'COIN', customX = null, customY = null) {
    const { cx, cy, size } = this.arena;
    const spawnRadius = size * 0.22;

    let px = customX;
    let py = customY;

    if (px === null || py === null) {
      const angle = Math.random() * Math.PI * 2;
      const d = Math.random() * spawnRadius;
      px = cx + Math.cos(angle) * d;
      py = cy + Math.sin(angle) * d;
    }

    const lootPoint = { x: px, y: py };
    clampToArena(lootPoint, type === 'CROWN' ? 14 : type === 'DIAMOND' ? 12 : 9, this.arena);
    px = lootPoint.x;
    py = lootPoint.y;

    const value = type === 'CROWN' ? 5 : type === 'DIAMOND' ? 3 : 1;
    const weight = type === 'CROWN' ? 3 : type === 'DIAMOND' ? 2 : 1;
    const radius = type === 'CROWN' ? 14 : type === 'DIAMOND' ? 12 : 9;

    this.lootItems.push({
      x: px,
      y: py,
      vx: (Math.random() - 0.5) * 80,
      vy: (Math.random() - 0.5) * 80,
      type: type,
      value: value,
      weight: weight,
      radius: radius,
      bounce: 0.6,
      animTime: Math.random() * 10,
    });
  }

  triggerTackle(playerIndex) {
    // Lobi/maç-sonunda kumandadan omuz tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    const p = this.players[playerIndex];
    if (!p || !p.isAlive || p.tackleCooldown > 0 || p.stumbleTimer > 0) return;

    p.tackleCooldown = HEIST_TUNING.TACKLE_COOLDOWN;
    p.tackleTimer = 0.22;
    p.isTackling = true;
    this.trauma = Math.min(1.0, this.trauma + 0.18);

    playDashWhoosh();

    // Spawn dust burst
    const behindAngle = p.facingAngle + Math.PI;
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: p.x + Math.cos(behindAngle) * p.radius,
        y: p.y + Math.sin(behindAngle) * p.radius,
        vx: Math.cos(behindAngle + (Math.random() - 0.5) * 0.8) * 80,
        vy: Math.sin(behindAngle + (Math.random() - 0.5) * 0.8) * 80,
        life: 0.28,
        maxLife: 0.4,
        color: '#D5D0C7',
        size: 4 + Math.random() * 3,
      });
    }
  }

  addFloatingText(x, y, text, color = '#FFDE59') {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 0.8,
      maxLife: 0.8,
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

    // 2. Masa-ortası butonları + joystick (tek merkezden, BaseGame)
    if (this.state === 'PLAYING') {
      this.handleTabletopTouchStart(touch);
    }
  }

  // --- BOT AI BEHAVIORS ---

  updateBotAI(bot, dt) {
    updateHeistBotAI(this, bot, dt);
  }

  // --- COLLISION RESOLUTION ---

  resolveCollisions(player) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.y)) {
      const { cx, cy } = this.arena;
      player.x = cx || 100;
      player.y = cy || 100;
      player.vx = 0;
      player.vy = 0;
    }
    clampToArena(player, player.radius, this.arena, { zeroVelocity: true });
    resolveAABB(player, this.pillars, player.radius);
    clampToArena(player, player.radius, this.arena, { zeroVelocity: true });
  }

  handleRemoteInput(slotIndex, data) {
    this.handleStandardRemoteJoystick(slotIndex, data, (slot, d) => {
      if (matchesInputAction(d, 'tackle', 'TACKLE')) {
        this.triggerTackle(slot);
      }
    });
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

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

    // Decrement Round Timer
    this.roundTimer -= dt;
    if (this.roundTimer <= 10.0 && !this.goldRushActive) {
      this.goldRushActive = true;
      this.trauma = 0.5;
      this.addFloatingText(this.arena.cx, this.arena.cy - 30, t('heist.rush'), '#FFDE59');
      playVaultAlarm();
      // Drop royal loot
      for (let i = 0; i < 4; i++) this.spawnLootItem('DIAMOND');
      this.spawnLootItem('CROWN');
    }

    // Piggy Bank schedule: 30sn ve 15sn kala sahaya iner (bayraklar raunt başı sıfırlanır)
    if (this.roundTimer <= 30.0 && !this.piggySpawned30) {
      this.piggySpawned30 = true;
      if (!this.piggyBank) this.spawnPiggyBank();
    }
    if (this.roundTimer <= 15.0 && !this.piggySpawned15) {
      this.piggySpawned15 = true;
      if (!this.piggyBank) this.spawnPiggyBank();
    }

    // Piggy physics: sekerek gezinir
    if (this.piggyBank) {
      const pig = this.piggyBank;
      pig.animTime += dt;
      if (pig.hitTimer > 0) pig.hitTimer = Math.max(0, pig.hitTimer - dt);
      pig.x += pig.vx * dt;
      pig.y += pig.vy * dt;
      const { left, right, top, bottom } = this.arena;
      if (pig.x - pig.radius < left) { pig.x = left + pig.radius; pig.vx = Math.abs(pig.vx); }
      if (pig.x + pig.radius > right) { pig.x = right - pig.radius; pig.vx = -Math.abs(pig.vx); }
      if (pig.y - pig.radius < top) { pig.y = top + pig.radius; pig.vy = Math.abs(pig.vy); }
      if (pig.y + pig.radius > bottom) { pig.y = bottom - pig.radius; pig.vy = -Math.abs(pig.vy); }
    }

    // Tek katılımcı kalınca süre beklenmez — kasa lideri raundu alır
    if (this.state === 'PLAYING') {
      const joined = this.players.filter((p) => p.isJoined);
      if (joined.length <= 1) {
        if (joined.length === 1) {
          this.awardVaultWinner(joined[0]);
        } else {
          this.finishTiedRound('no-players');
        }
        return;
      }
    }

    if (this.roundTimer <= 0 || roundTimedOut(this.roundTimer, HEIST_TUNING.ROUND_TIME)) {
      // Round Complete: tek lider + en az 1 banko gerekir; eşitlikte/boş
      // rauntta skor yazılmaz (önce düşük indeks hep kazanıyordu)
      let highestGold = -1;
      let winner = null;
      let tied = false;

      for (const p of this.players) {
        if (!p.isJoined) continue;
        if (p.vaultGold > highestGold) {
          highestGold = p.vaultGold;
          winner = p;
          tied = false;
        } else if (p.vaultGold === highestGold) {
          tied = true;
        }
      }

      this.roundTied = !winner || tied || highestGold <= 0;
      if (!this.roundTied) {
        this.awardVaultWinner(winner);
        return;
      } else {
        this.finishTiedRound('timeout');
        return;
      }
      this.state = 'ROUND_OVER';
      this.roundTransitionTimer = 2.8;
      return;
    }

    // Spawning central loot
    this.lootSpawnTimer -= dt;
    if (this.lootSpawnTimer <= 0 && this.lootItems.length < 18) {
      const type = Math.random() < 0.2 ? 'DIAMOND' : 'COIN';
      this.spawnLootItem(type);
      this.lootSpawnTimer = this.goldRushActive ? 0.7 : 1.6 + Math.random() * 0.8;
    }

    // Floating text update
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= dt * 25;
      ft.life -= dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    // Loot physics update
    for (const item of this.lootItems) {
      item.x += item.vx * dt;
      item.y += item.vy * dt;
      item.vx *= 0.94;
      item.vy *= 0.94;
      item.animTime += dt;
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.life -= dt;
      if (part.life <= 0) this.particles.splice(i, 1);
    }

    // Update Players
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.tackleCooldown > 0) player.tackleCooldown -= dt;
      if (player.tackleTimer > 0) {
        player.tackleTimer -= dt;
        if (player.tackleTimer <= 0) player.isTackling = false;
      }
      if (player.stumbleTimer > 0) player.stumbleTimer -= dt;

      // Determine Movement Input
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
        this.updateBotAI(player, dt);
        inputX = player.aiMoveX || 0;
        inputY = player.aiMoveY || 0;
      }

      // --- GREED WEIGHT CURVE: speed scales down with carried loot ---
      const base = Number.isFinite(player.baseSpeed) ? player.baseSpeed : (player.speed || 190);
      const weight = Number.isFinite(player.carriedWeight) ? player.carriedWeight : 0;
      let currentSpeed = Math.max(108, base - weight * 13);
      if (player.tackleTimer > 0) {
        currentSpeed = fieldSpeed(this.arena, 340); // Tackle surge speed!
      }
      if (player.stumbleTimer > 0) {
        currentSpeed *= 0.18; // Stun stumble!
      }

      const inputLen = Math.hypot(inputX, inputY);
      if (inputLen > 0.05 && Number.isFinite(currentSpeed)) {
        const normX = inputX / inputLen;
        const normY = inputY / inputLen;
        player.vx = normX * currentSpeed;
        player.vy = normY * currentSpeed;
        player.facingAngle = Math.atan2(normY, normX);

        if (player.tackleTimer > 0 && Math.random() < 0.4) {
          this.particles.push({
            x: player.x,
            y: player.y,
            vx: (Math.random() - 0.5) * 40,
            vy: (Math.random() - 0.5) * 40,
            life: 0.2,
            maxLife: 0.2,
            color: '#FFDE59',
            size: 4,
          });
        }
      } else {
        player.vx *= 0.7;
        player.vy *= 0.7;
      }

      player.x += player.vx * dt;
      player.y += player.vy * dt;

      // Arena Bounds & Obstacle Collisions
      this.resolveCollisions(player);

      // --- Interactions ---
      // 1. Central Loot Pickup
      for (let l = this.lootItems.length - 1; l >= 0; l--) {
        const item = this.lootItems[l];
        const dist = Math.hypot(player.x - item.x, player.y - item.y);
        if (dist < player.radius + item.radius) {
          player.carriedGold += item.value;
          player.carriedItems += 1;
          player.carriedWeight += item.weight;

          playCoinPickup();
          this.addFloatingText(item.x, item.y - 12, `+${item.value}`, item.type === 'DIAMOND' ? '#48CAE4' : '#FFDE59');
          this.lootItems.splice(l, 1);
        }
      }

      // --- 2. Banking in Own Corner Vault ---
      const myVault = this.vaults[player.index];
      if (
        myVault &&
        player.x >= myVault.x &&
        player.x <= myVault.x + myVault.w &&
        player.y >= myVault.y &&
        player.y <= myVault.y + myVault.h
      ) {
        if (player.carriedGold > 0) {
          const banked = player.carriedGold;
          player.vaultGold += banked;
          player.carriedGold = 0;
          player.carriedItems = 0;
          player.carriedWeight = 0;

          playCashRegister();
          this.trauma = 0.25;
          this.addFloatingText(myVault.x + myVault.w / 2, myVault.y + myVault.h / 2, `+${banked} KASALANDI!`, '#FFFFFF');

          // Golden sparkle burst inside vault
          for (let s = 0; s < 18; s++) {
            this.particles.push({
              x: player.x,
              y: player.y,
              vx: (Math.random() - 0.5) * 140,
              vy: (Math.random() - 0.5) * 140,
              life: 0.45,
              maxLife: 0.45,
              color: '#FFDE59',
              size: 4 + Math.random() * 3,
            });
          }
        }
      }

      // --- 3. Vault Raiding (Stealing directly from opponent's vault) ---
      let onEnemyVault = false;
      for (const v of this.vaults) {
        if (v.playerIndex !== player.index) {
          if (
            player.x >= v.x &&
            player.x <= v.x + v.w &&
            player.y >= v.y &&
            player.y <= v.y + v.h
          ) {
            onEnemyVault = true;
            const enemy = this.players[v.playerIndex];
            if (enemy && enemy.vaultGold > 0) {
              player.raidTarget = v.playerIndex;
              player.raidTimer += dt;
              if (player.raidTimer >= 1.0) {
                // Heist Success! Steal 2 gold from enemy vault
                const stolen = Math.min(2, enemy.vaultGold);
                enemy.vaultGold -= stolen;
                player.carriedGold += stolen;
                player.carriedItems += stolen;
                player.carriedWeight += stolen;
                player.raidTimer = 0;

                playVaultAlarm();
                this.trauma = 0.4;
                this.addFloatingText(player.x, player.y - 20, t('heist.stolen', stolen), '#D84727');
              }
            }
            break;
          }
        }
      }
      if (!onEnemyVault) {
        player.raidTimer = 0;
        player.raidTarget = -1;
      }
    }

    // --- 4. Shoulder Tackle Collision & Direct Loot Vampirism! ---
    for (let i = 0; i < this.players.length; i++) {
      const p1 = this.players[i];
      if (!p1.isJoined || !p1.isAlive) continue;

      for (let j = i + 1; j < this.players.length; j++) {
        const p2 = this.players[j];
        if (!p2.isJoined || !p2.isAlive) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = p1.radius + p2.radius;

        if (dist < minDist) {
          // Elastic nudge
          const overlap = minDist - dist;
          if (dist > 0.001) {
            const nx = dx / dist;
            const ny = dy / dist;
            p1.x -= nx * overlap * 0.5;
            p1.y -= ny * overlap * 0.5;
            p2.x += nx * overlap * 0.5;
            p2.y += ny * overlap * 0.5;
          }

          // Check if p1 tackled p2 (or vice versa)
          if (p1.isTackling && p2.stumbleTimer <= 0.15) {
            this.executeLootKnockout(p1, p2);
          } else if (p2.isTackling && p1.stumbleTimer <= 0.15) {
            this.executeLootKnockout(p2, p1);
          }
        }
      }
    }

    // Piggy Bank hits: omuz atan oyuncu kumbaraya değerse canı azalır,
    // 0 olunca altın saçar (dokunmatik/klavye/kumanda hepsi isTackling üzerinden gelir)
    if (this.piggyBank) {
      for (const p of this.players) {
        if (!p.isJoined || !p.isAlive || !p.isTackling) continue;
        const pig = this.piggyBank;
        if (!pig) break;
        if (Math.hypot(pig.x - p.x, pig.y - p.y) < pig.radius + p.radius + 26) {
          this.hitPiggyBank(p);
        }
      }
    }
  }

  hitPiggyBank(attacker) {
    const pig = this.piggyBank;
    if (!pig) return;
    attacker.isTackling = false; // hit landed
    pig.hp -= 1;
    pig.hitTimer = 0.25;
    playHeavyImpact();
    this.trauma = Math.min(1.0, this.trauma + 0.3);
    const dx = pig.x - attacker.x;
    const dy = pig.y - attacker.y;
    const dist = Math.hypot(dx, dy) || 1;
    pig.vx = (dx / dist) * 260;
    pig.vy = (dy / dist) * 260;
    if (pig.hp <= 0) {
      this.piggyBank = null;
      for (let i = 0; i < 5; i++) {
        this.spawnLootItem('COIN', pig.x + (Math.random() - 0.5) * 70, pig.y + (Math.random() - 0.5) * 70);
      }
      this.spawnLootItem('DIAMOND', pig.x, pig.y);
      for (let i = 0; i < 10; i++) {
        this.particles.push({
          x: pig.x, y: pig.y,
          vx: (Math.random() - 0.5) * 320, vy: (Math.random() - 0.5) * 320,
          life: 0.4, maxLife: 0.5, color: '#FFDE59', size: 4 + Math.random() * 4,
        });
      }
      this.addFloatingText(pig.x, pig.y - 34, 'KUMBARA KIRILDI!', '#FFDE59');
      playPiggyBreak();
    } else {
      this.addFloatingText(pig.x, pig.y - 34, t('heist.crack', pig.hp), '#FFFFFF');
    }
  }

  executeLootKnockout(attacker, victim) {
    playHeavyImpact();
    this.trauma = 0.65;
    victim.stumbleTimer = 1.0;
    attacker.isTackling = false; // hit landed

    // Violent knockback momentum
    const dx = victim.x - attacker.x;
    const dy = victim.y - attacker.y;
    const dist = Math.hypot(dx, dy) || 1;
    const nx = dx / dist;
    const ny = dy / dist;

    victim.vx = nx * 520;
    victim.vy = ny * 520;

    // 1. Home Vault Defense Check (Is burglar caught in attacker's vault?)
    const attackerVault = this.vaults[attacker.index];
    const isInsideMyVault = attackerVault && (
      victim.x >= attackerVault.x && victim.x <= attackerVault.x + attackerVault.w &&
      victim.y >= attackerVault.y && victim.y <= attackerVault.y + attackerVault.h
    );

    if (isInsideMyVault) {
      playCashRegister();
      playVaultAlarm();
      attacker.vaultGold += 3;
      this.addFloatingText(attacker.x, attacker.y - 30, '🛡️ KASA SAVUNMASI! (+3 BONUS)', '#FFDE59');
    }

    // 2. Direct Vampiric Theft (Loot Siphon)
    if (victim.carriedGold > 0) {
      // Attacker DIRECTLY steals up to 2 coins straight into their bag!
      const stolen = Math.min(2, victim.carriedGold);
      victim.carriedGold -= stolen;
      victim.carriedWeight = Math.max(0, victim.carriedWeight - stolen);

      attacker.carriedGold += stolen;
      attacker.carriedWeight += stolen;

      playCoinPickup();
      this.addFloatingText(attacker.x, attacker.y - 25, t('heist.robbed', stolen), '#FFDE59');
      this.addFloatingText(victim.x, victim.y - 25, `-${stolen} 🪙 SOYULDUN!`, '#D84727');

      // Golden particle beam siphon from victim to attacker
      for (let s = 0; s < 12; s++) {
        this.particles.push({
          x: victim.x,
          y: victim.y,
          vx: -nx * 190 + (Math.random() - 0.5) * 80,
          vy: -ny * 190 + (Math.random() - 0.5) * 80,
          life: 0.45,
          maxLife: 0.45,
          color: '#FFDE59',
          size: 5,
        });
      }

      // Drop the remaining carried loot onto the ground (chaos scramble!)
      const dropRest = victim.carriedGold;
      if (dropRest > 0) {
        victim.carriedGold = 0;
        victim.carriedWeight = 0;
        victim.carriedItems = 0;

        for (let c = 0; c < dropRest; c++) {
          const angle = Math.random() * Math.PI * 2;
          const spd = 80 + Math.random() * 150;
          this.lootItems.push({
            x: victim.x,
            y: victim.y,
            vx: Math.cos(angle) * spd,
            vy: Math.sin(angle) * spd,
            type: 'COIN',
            value: 1,
            weight: 1,
            radius: 9,
            animTime: 0,
          });
        }
        this.addFloatingText(victim.x, victim.y - 45, t('heist.spilled', dropRest), '#D84727');
      }
    } else if (victim.vaultGold > 0) {
      // Victim has no loose coins, but has banked gold in vault: KNOCK 1 COIN OUT OF VAULT!
      victim.vaultGold -= 1;
      const angle = Math.random() * Math.PI * 2;
      this.lootItems.push({
        x: victim.x,
        y: victim.y,
        vx: Math.cos(angle) * 120,
        vy: Math.sin(angle) * 120,
        type: 'COIN',
        value: 1,
        weight: 1,
        radius: 9,
        animTime: 0,
      });
      playStumble();
      this.addFloatingText(victim.x, victim.y - 25, t('heist.vaultDrop'), '#D84727');
    } else {
      // Victim is completely empty, still get satisfying slam!
      this.addFloatingText(victim.x, victim.y - 25, t('heist.boom'), '#FFFFFF');
    }

    // Comic book impact sparks
    for (let p = 0; p < 16; p++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 160;
      this.particles.push({
        x: (attacker.x + victim.x) / 2,
        y: (attacker.y + victim.y) / 2,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0.35,
        maxLife: 0.35,
        color: Math.random() > 0.5 ? '#FFFFFF' : '#FFDE59',
        size: 4 + Math.random() * 3,
      });
    }
  }

  // --- RENDERING PIPELINE ---

  render() {
    const { ctx } = this;
    ctx.save();
    this.uiButtons = [];

    // Background paper
    ctx.fillStyle = '#F4F0EA';
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    if (this.trauma > 0) {
      const shakeIntensity = this.trauma * this.trauma * 14;
      const offsetX = (Math.random() - 0.5) * 2 * shakeIntensity;
      const offsetY = (Math.random() - 0.5) * 2 * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }

    // Arena sahnesi ortak heistView draw'larından gelir (host↔client aynı).
    drawHeistArena(ctx, this.arena, this.pillars);
    if (this.state !== 'LOBBY') {
      const scenePlayers = this.players.map((p) => ({
        ...p,
        slot: p.index,
        stumble: p.stumbleTimer,
        tackling: p.isTackling === true,
        carried: p.carriedGold || 0,
        vault: p.vaultGold || 0,
        cd: p.tackleCooldown || 0,
        angle: p.facingAngle || 0,
      }));
      drawHeistVaults(ctx, this.vaults, scenePlayers);
      drawHeistLoot(ctx, this.lootItems);
      drawHeistPiggy(ctx, this.piggyBank ? {
        x: this.piggyBank.x,
        y: this.piggyBank.y,
        radius: this.piggyBank.radius,
        hp: this.piggyBank.hp,
        maxHp: this.piggyBank.maxHp,
        anim: this.piggyBank.animTime || 0,
      } : null);
      drawHeistPlayers(ctx, scenePlayers, { withFx: this.state === 'PLAYING' });
    }
    drawSquareParticles(ctx, this.particles);
    drawHeistTexts(ctx, this.floatingTexts);
    this.renderControls(ctx);

    // Host HUD: süre sayacı (world-view client'ı kendi HUD'unu kullanır)
    if (this.state === 'PLAYING') {
      const remain = Math.max(0, this.roundTimer);
      const isUrgent = remain <= 10.0;
      renderArenaWatermarkTimer(ctx, {
        arena: this.arena,
        text: `${Math.ceil(remain)}s`,
        subText: '',
        urgent: isUrgent,
        color: isUrgent ? '#D84727' : '#D99B26',
        alpha: isUrgent ? 0.70 : 0.46,
        ringProgress: Math.max(0, remain / HEIST_TUNING.ROUND_TIME),
      });
    }

    // Gold Rush border vignette
    if (this.state === 'PLAYING' && this.goldRushActive) {
      const pulseAlpha = pulse(0.18, 0.1, 0.012);
      ctx.fillStyle = `rgba(217, 155, 38, ${pulseAlpha})`;
      // Arena kenar şeritleri (CSS pikseli; canvas.width device-px olur, kullanılmaz)
      const { left, top, width, height, right, bottom } = this.arena;
      const edge = 16;
      ctx.fillRect(left, top - edge, width, edge);
      ctx.fillRect(left, bottom, width, edge);
      ctx.fillRect(left - edge, top - edge, edge, height + edge * 2);
      ctx.fillRect(right, top - edge, edge, height + edge * 2);
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.heist'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: HEIST_COLORS,
      playerNames: HEIST_NAMES,
      accent: '#D84727',
      roundBannerTitle: this.roundWinner
        ? `+1 SET: ${this.roundWinner.name}! (${this.roundWinner.vaultGold} ALTIN)`
        : (this.roundTied ? 'BERABERE!' : null),
      roundBannerColor: this.roundWinner?.color || '#FFFFFF',
      roundBannerSub: this.roundWinner
        ? `TOPLAM SET: ${this.scores[this.roundWinner.index]} / ${this.targetScore}`
        : (this.roundTied ? 'SKOR YAZILMADI' : ''),
      matchOverHeadline: this.matchDraw ? t('game.draw') : t('heist.champ'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}` })),
      onRestart: () => this.resetCurrentGame(),
    });

    ctx.restore();
  }



}