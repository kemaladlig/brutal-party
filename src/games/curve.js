// BRUTAL CURVE (Game 03): 2-4 Player Local Party Curve Fever with Gaps, Power-Ups & Bot AI
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playGap, playItemPickup, playDashWhoosh } from '../audio.js';
import { t } from '../i18n.js';
import { prefersReducedMotion } from '../ui/motion.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { drawPickup } from '../core/arenaKit.js';
import { resolveSlotName } from '../core/slotManager.js';
import { updateCurveBotAI } from '../ai/curveAI.js';
import { getSlotKeys, buildCodeToSlotMap, isSlotActionEvent } from '../core/inputMaps.js';
import { isInputIntent } from '../core/inputIntent.js';
import { getQuadrant, lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { distToSegmentSquared, clampToArena } from '../core/physics2d.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';
import { beginDrawRound, hasMatchResult, roundTimedOut } from '../core/roundLifecycle.js';
import { createCurveWorldPacket } from './curveView.js';
import { vibrate } from '../core/haptics.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';

export const CURVE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const CURVE_NAMES = ['P1', 'P2', 'P3', 'P4'];

// keyup ters haritası: sadece sol/sağ tuşlar (eklemeli steer)
const CURVE_KEY_SLOTS = buildCodeToSlotMap(['l', 'r']);
// Slot aksiyon tuşu → koltuk (P1 Space, P2 Enter, P3 O, P4 B): HIZLAN.
const SLOT_INDEX_BY_ACTION_CODE = buildCodeToSlotMap(['action']);

// İz sorgu ızgarası: uzun rauntlarda O(n) tarama yerine yakın hücreler.
// Oyun kuralı değişmez — sadece aday kümesi daralır.
const SEG_GRID_CELL = 48;
const SEG_MAX = 24000;
const CURVE_ROUND_LIMIT = 120;

// HIZLAN (NITRO): kumanda/masa-ortası/klavye tek dokunuşla açılan hız patlaması.
// Hız artarken dönüş yarıçapı genişler — hız kazancı karşılığında tepki payı düşer.
const CURVE_TUNING = {
  NITRO_DURATION: 1.4,
  NITRO_COOLDOWN: 4.0,
  NITRO_SPEED_MULT: 1.45,
  NITRO_TURN_MULT: 0.82,
};

export class CurveGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // Arena dimensions
    this.arena = {
      cx: 0,
      cy: 0,
      size: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    };

    // Slot types: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Tournament scores
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.roundTimer = 0;
    this.roundLimit = CURVE_ROUND_LIMIT;
    this.roundTransitionTimer = 0;
    this.spawnIntroTimer = 0;

    // Players, Trail Segments, Particles & Pickups
    this.players = [];
    this.segments = [];
    this.nextSegmentId = 1;
    this.particles = [];
    this.pickups = [];
    this.pickupSpawnTimer = 8.0;

    // Trail spatial grid (hücre → segment indeksleri) + sorgu damgası
    this.segGrid = new Map();
    this.segGridDirty = false;
    this._segQueryStamp = 0;

    // Keyboard Controls (P1 AD, P2 Oklar, P3 JL, P4 FH — sol tuş = sol butonla aynı yön)
    this.keys = {};
    this.initKeyboard();
  }

  createWorldPacket() {
    return createCurveWorldPacket(this);
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.isLocalInputActive && isSlotActionEvent(e, SLOT_INDEX_BY_ACTION_CODE[e.code])) {
        this.triggerBoost(SLOT_INDEX_BY_ACTION_CODE[e.code]);
        return;
      }
      if (!this.isLocalInputActive) return;
      this.keys[e.code] = true;
      this.keys[e.key] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this.keys[e.key] = false;
      // Tuş bırakma: o slotta dokunmatik direksiyon yoksa düz git
      // (dokunmatik basılıyken klavye bırakması dokunuşu ezmesin)
      const slot = CURVE_KEY_SLOTS[e.code];
      if (slot === undefined) return;
      if ((this.tabletopSteerState?.[slot] || 0) !== 0) return;
      const player = this.players[slot];
      if (player && player.slotType === 'human' && this.keyboardSteer(slot) === 0) {
        player.steer = 0;
      }
    });
  }

  // -1 sol, +1 sağ, 0 düz (ikisi birden/basılmıyorsa düz)
  keyboardSteer(index) {
    const map = getSlotKeys(index);
    if (!map) return 0;
    const l = this.keys[map.l] ? -1 : 0;
    const r = this.keys[map.r] ? 1 : 0;
    return l + r;
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };

    this.arena = computePlayfield(width, height, 'standard');

    // Maç ortası resize izleri/oyuncuları sıfırlamasın
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
      clampToArena(p, p.radius, this.arena, { zeroVelocity: true });
      p.prevX = p.x;
      p.prevY = p.y;
    }
    for (const seg of this.segments) {
      // remapPoint p.x/p.y yazar — seg iki uçlu olduğu için iki ucu ayrı eşle
      const a = { x: seg.x1, y: seg.y1 };
      const b = { x: seg.x2, y: seg.y2 };
      this.remapPoint(a, oldArena, this.arena);
      this.remapPoint(b, oldArena, this.arena);
      clampToArena(a, 0, this.arena);
      clampToArena(b, 0, this.arena);
      seg.x1 = a.x; seg.y1 = a.y; seg.x2 = b.x; seg.y2 = b.y;
    }
    this.segGridDirty = true;
    for (const item of this.pickups) this.remapPoint(item, oldArena, this.arena);
    this.particles = [];
  }

  initPlayers() {
    const { left, right, top, bottom, width, height, size } = this.arena;
    const padding = size * 0.22;

    const spawns = [
      { x: left + padding, y: bottom - padding, angle: -Math.PI * 0.25 }, // P1 Bottom-Left
      { x: left + padding, y: top + padding, angle: Math.PI * 0.25 },          // P2 Top-Left
      { x: right - padding, y: top + padding, angle: Math.PI * 0.75 },   // P3 Top-Right
      { x: right - padding, y: bottom - padding, angle: -Math.PI * 0.75 }, // P4 Bottom-Right
    ];

    this.players = spawns.map((s, i) => {
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      const existing = this.players?.[i];
      return {
        index: i,
        name: resolveSlotName(i, this.slotTypes[i], existing?.name),
        color: isBot ? persona.color : (custom.color || CURVE_COLORS[i]),
        x: s.x,
        y: s.y,
        prevX: s.x,
        prevY: s.y,
        angle: s.angle,
        // Gövde yarıçapı ve hız sahayla birlikte ölçeklenir: `headRadius 5`
        // sabitken telefonda saha kısa kenarının %1.29'u, masaüstünde %0.53'ü
        // (2.5x fark). Motor ölçekler, view `player.radius` okur, world packet
        // taşır (ARCHER/NINJA/LASER ile aynı desen).
        radius: fieldRadius(this.arena, 6, 0.006),
        speed: fieldSpeed(this.arena, 160),
        turnSpeed: 2.85,
        steer: 0, // -1 (left), 0 (none), +1 (right)
        isAlive: true,
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        gapTimer: 2.5 + Math.random() * 2.0,
        gapDuration: 0,
        isGap: false,
        ghostTimer: 0,
        turboTimer: 0,
        nitroTimer: 0,
        boostCooldown: 0,
        confusedTimer: 0,
        shrinkTimer: 0,
        thickTimer: 0,
        freezeTimer: 0,
        botCheckTimer: 0,
        botSteer: 0,
        botTurnCommitment: 0,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.roundTimer = 0;
    this.segments = [];
    this.nextSegmentId = 1;
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.particles = [];
    this.pickups = [];
    this.floatingTexts = [];
    this.onTouchesReset();
    this.trauma = 0;
    this.spawnIntroTimer = 0;
    this.lastTime = performance.now();
    this.initPlayers();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.startRound();
  }

  startNewRound() {
    this.startRound();
  }

  startRound() {
    this.state = 'PLAYING';
    this.segments = [];
    this.nextSegmentId = 1;
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.particles = [];
    this.pickups = [];
    this.floatingTexts = [];
    this.pickupSpawnTimer = 5.5;
    this.roundWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTimer = 0;
    this.spawnIntroTimer = 1.8;
    playStart();

    const { left, right, top, bottom, size } = this.arena;
    const padding = size * 0.24;

    const spawns = [
      { x: left + padding, y: bottom - padding, angle: -Math.PI * 0.25 },
      { x: left + padding, y: top + padding, angle: Math.PI * 0.25 },
      { x: right - padding, y: top + padding, angle: Math.PI * 0.75 },
      { x: right - padding, y: bottom - padding, angle: -Math.PI * 0.75 },
    ];

    this.players.forEach((p, i) => {
      const s = spawns[i];
      const randomAngleOffset = (Math.random() - 0.5) * 0.4;
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      p.color = isBot ? '#8E8E93' : custom.color;
      p.x = s.x;
      p.y = s.y;
      p.prevX = s.x;
      p.prevY = s.y;
      p.angle = s.angle + randomAngleOffset;
      p.steer = 0;
      p.slotType = this.slotTypes[i];
      p.isJoined = this.isSlotJoined(i);
      p.isAlive = p.isJoined;
      p.gapTimer = 2.0 + Math.random() * 2.2;
      p.gapDuration = 0;
      p.isGap = false;
      p.ghostTimer = 0;
      p.turboTimer = 0;
      p.confusedTimer = 0;
      p.shrinkTimer = 0;
      p.thickTimer = 0;
      p.freezeTimer = 0;
      p.botCheckTimer = 0;
      p.botSteer = 0;
      p.botTurnCommitment = 0;
    });
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('CURVE'),
      leftLabel: '◀',
      rightLabel: '▶',
      actions: [
        {
          id: 'boost',
          icon: 'zap',
          cooldownField: 'boostCooldown',
          maxCooldown: CURVE_TUNING.NITRO_COOLDOWN,
        },
      ],
    };
  }

  // steer HER ZAMAN ham niyettir; INVERT burada uygulanmaz (update'te tek noktada uygulanır).
  onSlotSteer(slotIndex, dir) {
    const player = this.players[slotIndex];
    if (this.state !== 'PLAYING' || this.spawnIntroTimer > 0) return;
    if (player && player.isJoined && player.isAlive && player.slotType === 'human') {
      player.steer = dir;
    }
  }

  triggerBoost(playerIndex) {
    if (this.state !== 'PLAYING' || this.spawnIntroTimer > 0) return;
    const player = this.players[playerIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (player.boostCooldown > 0) return;

    player.boostCooldown = CURVE_TUNING.NITRO_COOLDOWN;
    player.nitroTimer = CURVE_TUNING.NITRO_DURATION;
    playDashWhoosh();
    this.addTrauma(0.12);
    this.spawnFloatingText(player.x, player.y - 16, t('curve.nitro'), player.color);
    for (let i = 0; i < 10; i++) {
      const angle = player.angle + Math.PI + (Math.random() - 0.5) * 0.9;
      const speed = 60 + Math.random() * 110;
      this.particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.35,
        maxLife: 0.35,
        size: 3 + Math.random() * 3,
        color: i % 2 === 0 ? '#FFD122' : player.color,
      });
    }
  }

  // Masa-ortası köşe butonu + klavye aksiyon tuşu aynı kapıdan geçer.
  handleSlotAction(slotIndex, actionId, isDown) {
    if (isDown && actionId === 'boost') this.triggerBoost(slotIndex);
  }

  onTouchStart(touch) {
    if (this.handleRoundOverSkip()) return;

    // 1. Center Start Button (Lobby)
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

    // 2. Center Restart Button (Match Over)
    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => { this.resetMatch(); playJoin(); } });
      return;
    }

    // 3. Gameplay: Tabletop steering controls
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
    this.players.forEach((p) => (p.steer = 0));
  }

  spawnPickup() {
    spawnPickup(this, {
      types: ['SCISSORS', 'GHOST', 'TURBO', 'INVERT', 'SHRINK', 'FREEZE', 'BOMB', 'THICK'],
      max: 3,
      size: 24,
      life: 14.0,
    });
  }

  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  spawnFloatingText(x, y, text, color) {
    if (!this.floatingTexts) this.floatingTexts = [];
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 1.2,
      maxLife: 1.2,
    });
  }

  spawnBombBlast(x, y) {
    playExplosion();
    this.addTrauma(0.35);

    // 70px yarıçapındaki segmentleri sil
    const radiusSq = 70 * 70;
    let removed = false;
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const s = this.segments[i];
      const distSq = distToSegmentSquared(x, y, s.x1, s.y1, s.x2, s.y2);
      if (distSq < radiusSq) {
        this.segments.splice(i, 1);
        removed = true;
      }
    }
    if (removed) {
      this.segGridDirty = true;
    }

    // Patlama parçacıkları
    for (let i = 0; i < 28; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 150;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.6,
        maxLife: 0.6,
        size: 3 + Math.random() * 5,
        color: i % 2 === 0 ? '#FFD122' : '#FF473A',
      });
    }
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
    this.lastTime = now;

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - dt * 2.2);
    }

    if (this.spawnIntroTimer > 0) {
      this.spawnIntroTimer = Math.max(0, this.spawnIntroTimer - dt);
    }

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        if (hasMatchResult(this)) {
          this.state = 'MATCH_OVER';
        } else {
          this.startRound();
        }
      }
    }

    if (this.state === 'PLAYING') {
      this.roundTimer += dt;
      if (roundTimedOut(this.roundTimer, this.roundLimit)) {
        beginDrawRound(this, 'timeout', 1.6);
        return;
      }

      // Pickups timer & update
      this.pickupSpawnTimer -= dt;
      if (this.pickupSpawnTimer <= 0 && this.pickups.length < 3) {
        this.spawnPickup();
        this.pickupSpawnTimer = 6.5 + Math.random() * 3.5;
      }
      tickPickupTimers(this, dt);

      // Update Players
      for (const player of this.players) {
        if (!player.isJoined || !player.isAlive) continue;
        if (this.spawnIntroTimer > 0) {
          player.steer = 0;
          continue;
        }

        // Timers
        if (player.ghostTimer > 0) player.ghostTimer = Math.max(0, player.ghostTimer - dt);
        if (player.turboTimer > 0) player.turboTimer = Math.max(0, player.turboTimer - dt);
        if (player.nitroTimer > 0) player.nitroTimer = Math.max(0, player.nitroTimer - dt);
        if (player.boostCooldown > 0) player.boostCooldown = Math.max(0, player.boostCooldown - dt);
        if (player.confusedTimer > 0) player.confusedTimer = Math.max(0, player.confusedTimer - dt);
        if (player.shrinkTimer > 0) player.shrinkTimer = Math.max(0, player.shrinkTimer - dt);
        if (player.thickTimer > 0) player.thickTimer = Math.max(0, player.thickTimer - dt);
        if (player.freezeTimer > 0) player.freezeTimer = Math.max(0, player.freezeTimer - dt);

        // Gap Cycle Management
        if (player.isGap) {
          player.gapDuration -= dt;
          if (player.gapDuration <= 0) {
            player.isGap = false;
            player.gapTimer = 2.4 + Math.random() * 2.2;
          }
        } else {
          player.gapTimer -= dt;
          if (player.gapTimer <= 0) {
            player.isGap = true;
            player.gapDuration = 0.16; // ~25px gap
            playGap();
          }
        }

        // Run AI Controller
        if (player.slotType !== 'human') {
          this.updateBotAI(player, dt);
        }

        // Keyboard Fallback (BOMB deseni: eklemeli, dokunmatik/uzak girdiyi ezmez —
        // tuş basılıyken yazar, bırakınca keyup sıfırlar)
        if (player.slotType === 'human') {
          const ks = this.keyboardSteer(player.index);
          const touchSteer = this.tabletopSteerState?.[player.index] || 0;
          if (ks !== 0) {
            player.steer = ks;
          } else if (touchSteer !== 0) {
            player.steer = touchSteer;
          }
        }

        // Steer & Movement — INVERT TEK noktada burada uygulanır, yalnızca insan koltuklarına.
        // Botlar ayna gibi sürülmez (raycast kaçınmasını duvara çevirirdi); curveAI
        // karar kalitesini düşürür. FREEZE gibi hız etkileri her koltukta aynıdır.
        let speedMult = 1.0;
        let turnMult = 1.0;
        if (player.nitroTimer > 0) {
          speedMult *= CURVE_TUNING.NITRO_SPEED_MULT;
          turnMult *= CURVE_TUNING.NITRO_TURN_MULT;
        }
        if (player.turboTimer > 0) speedMult *= 1.5;
        if (player.freezeTimer > 0) speedMult *= 0.55;

        const confused = player.confusedTimer > 0 && player.slotType === 'human';
        player.angle += player.steer * player.turnSpeed * turnMult * (confused ? -1 : 1) * dt;

        const currentSpeed = player.speed * speedMult;
        player.prevX = player.x;
        player.prevY = player.y;
        player.x += Math.cos(player.angle) * currentSpeed * dt;
        player.y += Math.sin(player.angle) * currentSpeed * dt;

        // Record Trail Segment (ızgaraya işlenir; emniyet supabı taşanı budar)
        const newSeg = {
          id: this.nextSegmentId++,
          x1: player.prevX,
          y1: player.prevY,
          x2: player.x,
          y2: player.y,
          isGap: player.isGap,
          owner: player.index,
          color: player.color,
          shrink: player.shrinkTimer > 0,
          thick: player.thickTimer > 0,
          createdAt: performance.now(),
          _qstamp: 0,
        };
        this.segments.push(newSeg);
        this._indexSegment(newSeg, this.segments.length - 1);
        if (this.segments.length > SEG_MAX) {
          this.segments.splice(0, 2000);
          this.segGridDirty = true;
        }

        // Check Pickup Collision
        collectPickups(this, player, {
          radiusOf: (p) => (p.shrinkTimer > 0 ? 2.0 : 3.0) + 6,
          onCollect: (g, p, item) => this.applyPickup(p, item),
        });

        // Check Collision with Arena Walls & Trails
        if (this.checkCollision(player)) {
          this.eliminatePlayer(player);
        }
      }

      // Check Round End Condition
      const alivePlayers = this.players.filter((p) => p.isJoined && p.isAlive);
      if (alivePlayers.length <= 1) {
        this.handleRoundEnd(alivePlayers.length === 1 ? alivePlayers[0] : null);
      }
    }

    // Update Floating Texts
    if (this.floatingTexts) {
      for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
        const ft = this.floatingTexts[i];
        ft.y -= dt * 24;
        ft.life -= dt;
        if (ft.life <= 0) {
          this.floatingTexts.splice(i, 1);
        }
      }
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  }

  applyPickup(player, item) {
    playItemPickup();
    this.addTrauma(0.12);

    if (item.type === 'SCISSORS') {
      const mySegs = this.segments.filter((s) => s.owner === player.index);
      const toRemove = Math.floor(mySegs.length * 0.7);
      let removed = 0;
      for (let i = 0; i < this.segments.length; i++) {
        if (this.segments[i].owner === player.index) {
          this.segments.splice(i, 1);
          i--;
          removed++;
          if (removed >= toRemove) break;
        }
      }
      this.segGridDirty = true;
      this.spawnFloatingText(player.x, player.y - 14, t('curve.cut'), player.color);
    } else if (item.type === 'GHOST') {
      player.ghostTimer = 4.0;
      this.spawnFloatingText(player.x, player.y - 14, '👻 HAYALET!', '#70E000');
    } else if (item.type === 'TURBO') {
      player.turboTimer = 4.5;
      this.spawnFloatingText(player.x, player.y - 14, '⚡ TURBO!', '#FFD122');
    } else if (item.type === 'INVERT') {
      this.players.forEach((p) => {
        if (p.index !== player.index && p.isJoined && p.isAlive) {
          p.confusedTimer = 4.0;
          this.spawnFloatingText(p.x, p.y - 14, t('curve.rev'), '#FF473A');
        }
      });
      this.spawnFloatingText(player.x, player.y - 14, t('curve.revYou'), player.color);
    } else if (item.type === 'SHRINK') {
      player.shrinkTimer = 6.0;
      this.spawnFloatingText(player.x, player.y - 14, t('curve.mini'), '#00B4D8');
    } else if (item.type === 'FREEZE') {
      this.players.forEach((p) => {
        if (p.index !== player.index && p.isJoined && p.isAlive) {
          p.freezeTimer = 2.5;
          this.spawnFloatingText(p.x, p.y - 14, '❄️ DONDU!', '#90E0EF');
        }
      });
      this.spawnFloatingText(player.x, player.y - 14, t('curve.ice'), player.color);
    } else if (item.type === 'BOMB') {
      this.spawnBombBlast(player.x, player.y);
      this.spawnFloatingText(player.x, player.y - 14, '💣 PATLAMA!', '#FF473A');
    } else if (item.type === 'THICK') {
      player.thickTimer = 4.5;
      this.spawnFloatingText(player.x, player.y - 14, t('curve.wall'), '#D99B26');
    }
  }

  _gridKey(cx, cy) {
    return cx * 4096 + cy;
  }

  _indexSegment(seg, idx) {
    const minCX = Math.floor(Math.min(seg.x1, seg.x2) / SEG_GRID_CELL);
    const maxCX = Math.floor(Math.max(seg.x1, seg.x2) / SEG_GRID_CELL);
    const minCY = Math.floor(Math.min(seg.y1, seg.y2) / SEG_GRID_CELL);
    const maxCY = Math.floor(Math.max(seg.y1, seg.y2) / SEG_GRID_CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const key = this._gridKey(cx, cy);
        let bucket = this.segGrid.get(key);
        if (!bucket) {
          bucket = [];
          this.segGrid.set(key, bucket);
        }
        bucket.push(idx);
      }
    }
  }

  _rebuildSegGrid() {
    this.segGrid.clear();
    for (let i = 0; i < this.segments.length; i++) {
      this._indexSegment(this.segments[i], i);
    }
    this.segGridDirty = false;
  }

  // (x,y) noktasına pad mesafedeki segmentlerde cb(seg) çalıştırır;
  // cb true dönerse erken durur. Damga ile hücre çakışması elenir.
  forEachSegmentNear(x, y, pad, cb) {
    if (this.segGridDirty) this._rebuildSegGrid();
    const stamp = ++this._segQueryStamp;
    const minCX = Math.floor((x - pad) / SEG_GRID_CELL);
    const maxCX = Math.floor((x + pad) / SEG_GRID_CELL);
    const minCY = Math.floor((y - pad) / SEG_GRID_CELL);
    const maxCY = Math.floor((y + pad) / SEG_GRID_CELL);
    for (let cx = minCX; cx <= maxCX; cx++) {
      for (let cy = minCY; cy <= maxCY; cy++) {
        const bucket = this.segGrid.get(this._gridKey(cx, cy));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k++) {
          const seg = this.segments[bucket[k]];
          if (!seg || seg._qstamp === stamp) continue;
          seg._qstamp = stamp;
          if (cb(seg)) return true;
        }
      }
    }
    return false;
  }

  checkCollision(player) {
    if (player.ghostTimer > 0) return false;

    const { left, right, top, bottom } = this.arena;
    const r = player.shrinkTimer > 0 ? 2.0 : 3.0;

    // 1. Boundary Wall Collision
    if (player.x - r <= left || player.x + r >= right || player.y - r <= top || player.y + r >= bottom) {
      return true;
    }

    // Gap yalnızca iz çarpışmalarını geçici olarak kapatır; arena sınırı her zaman geçerlidir.
    if (player.isGap) return false;

    // 2. Line Segment Collision (ızgara adayları — kural aynı)
    const px = player.x;
    const py = player.y;
    const now = performance.now();
    const game = this;

    return this.forEachSegmentNear(px, py, 14, (seg) => {
      if (seg.isGap) return false;

      if (seg.owner === player.index && now - seg.createdAt < 220) {
        return false;
      }

      const segBonus = seg.thick ? 2.5 : (seg.shrink ? -1.0 : 0);
      const effectiveR = r + 1.8 + segBonus;
      const hitR = effectiveR * effectiveR;

      const minX = Math.min(seg.x1, seg.x2) - effectiveR;
      const maxX = Math.max(seg.x1, seg.x2) + effectiveR;
      const minY = Math.min(seg.y1, seg.y2) - effectiveR;
      const maxY = Math.max(seg.y1, seg.y2) + effectiveR;

      if (px < minX || px > maxX || py < minY || py > maxY) return false;

      const distSq = distToSegmentSquared(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
      return distSq <= hitR;
    });
  }

  distToSegmentSquared(px, py, vx, vy, wx, wy) {
    return distToSegmentSquared(px, py, vx, vy, wx, wy);
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.35);
    playExplosion();

    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 140;
      this.particles.push({
        x: player.x,
        y: player.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.55,
        maxLife: 0.55,
        size: 3 + Math.random() * 4,
        color: Math.random() > 0.3 ? player.color : '#1A1A1A',
      });
    }

    if (player.slotType === 'human' && typeof navigator !== 'undefined' && navigator.vibrate) {
      vibrate([40, 50, 70]);
    }

    this.players.forEach((p) => {
      if (p.index !== player.index && p.isJoined && p.isAlive) {
        this.scores[p.index]++;
        if (this.scores[p.index] >= this.targetScore) {
          this.matchWinner = p;
        }
      }
    });
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (this.state !== 'PLAYING' || this.spawnIntroTimer > 0) return;
    if (!player || !player.isJoined || !player.isAlive) return;
    if (isInputIntent(data, 'action', 'boost') || data.action === 'CURVE_BOOST') {
      this.triggerBoost(slotIndex);
      return;
    }
    if (isInputIntent(data, 'steer') || data.action === 'CURVE_STEER') {
      const dir = data.dir | 0;
      player.steer = Math.max(-1, Math.min(1, dir));
    }
  }

  handleRoundEnd(winner) {
    if (!winner) {
      beginDrawRound(this, 'no-survivor', 2.2);
      return;
    }
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.matchDraw = false;
    this.roundTransitionTimer = 2.2;
  }

  updateBotAI(bot, dt) {
    updateCurveBotAI(this, bot, dt);
  }

  render() {
    const { ctx } = this;
    ctx.save();

    // Background paper
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, this.viewport.width, this.viewport.height);

    if (this.trauma > 0 && !prefersReducedMotion()) {
      const shake = this.trauma * this.trauma * 16;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    const { left, top, width, height, size, right, bottom, cx, cy } = this.arena;

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    ctx.strokeStyle = '#E2DDD4';
    const u = this.arena.unit || (this.arena.size / 952);
    ctx.lineWidth = Math.max(1, 1.5 * u);
    const gridStep = size / 6;
    for (let x = left + gridStep; x < right; x += gridStep) {
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
    }
    for (let y = top + gridStep; y < bottom; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
    }

    // 4 Köşe Takviye Braketleri (L-plates)
    const bLen = Math.max(16, Math.round(size * 0.05));
    ctx.strokeStyle = '#2B2B28';
    ctx.lineWidth = Math.max(1, 3 * u);
    const cornerPlates = [
      [[left, top + bLen], [left, top], [left + bLen, top]],
      [[right - bLen, top], [right, top], [right, top + bLen]],
      [[left, bottom - bLen], [left, bottom], [left + bLen, bottom]],
      [[right - bLen, bottom], [right, bottom], [right, bottom - bLen]],
    ];
    for (const [[x1, y1], [x2, y2], [x3, y3]] of cornerPlates) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.stroke();
    }

    // Dış Sert Döküm Kenarlık & Gölge
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(right, top + 6, 6, height);
    ctx.fillRect(left + 6, bottom, width, 6);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = Math.max(2, Math.round(6 * u));
    ctx.strokeRect(left, top, width, height);

    // Trail Segments (Dinamik kalınlık: Mini 2px, Normal 4px, Kalın Duvar 8px)
    ctx.lineCap = 'round';
    for (const seg of this.segments) {
      if (seg.isGap) continue;
      ctx.lineWidth = Math.max(1, (seg.thick ? 8.5 : (seg.shrink ? 2.2 : 4)) * u);
      ctx.strokeStyle = seg.color;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    // Pickups (Canlı İkon Rozetleri) — host tam çözünürlükte çizer; telefonlar
    // curveView sıkıştırılmış iki katmanlı (near + field maskesi) draw'ını kullanır.
    for (const item of this.pickups) {
      drawPickup(ctx, item, { size: item.size || 24 });
    }

    // Floating Text Notifications (Kazanılan güçler)
    if (this.floatingTexts) {
      for (const ft of this.floatingTexts) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
        ctx.font = '900 12px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
        ctx.lineWidth = Math.max(1, 3.5 * u);
        ctx.strokeText(ft.text, ft.x, ft.y);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.restore();
      }
    }

    // Particles
    for (const p of this.particles) {
      const alpha = p.life / p.maxLife;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      ctx.globalAlpha = 1.0;
    }

    // Heads
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.save();
      const headRadius = player.shrinkTimer > 0 ? player.radius * 0.64 : player.radius;

      // Dondurma aurası
      if (player.freezeTimer > 0) {
        ctx.strokeStyle = '#00B4D8';
        ctx.lineWidth = Math.max(1, 2 * u);
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Barikat kalkanı aurası
      if (player.thickTimer > 0) {
        ctx.strokeStyle = '#D99B26';
        ctx.lineWidth = Math.max(1, 2.5 * u);
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 4.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Hayalet aurası
      if (player.ghostTimer > 0) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 5, 0, Math.PI * 2);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#70E000';
        ctx.lineWidth = Math.max(1, 1.8 * u);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (player.confusedTimer > 0) {
        ctx.strokeStyle = '#FF473A';
        ctx.lineWidth = Math.max(1, 2 * u);
        ctx.setLineDash([1, 3]);
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Gap Warning Halo (0.4s before gap opens)
      if (player.gapTimer <= 0.4 && !player.isGap) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#D84727';
        ctx.lineWidth = Math.max(1, 1.8 * u);
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Ana Kafa Noktası
      ctx.beginPath();
      ctx.arc(player.x, player.y, headRadius, 0, Math.PI * 2);
      ctx.fillStyle = player.color;
      ctx.fill();
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = Math.max(1, 2 * u);
      ctx.stroke();

      // Göz/Yön Noktası
      ctx.beginPath();
      ctx.arc(
        player.x + Math.cos(player.angle) * (headRadius * 0.6),
        player.y + Math.sin(player.angle) * (headRadius * 0.6),
        Math.max(1.2, headRadius * 0.35),
        0,
        Math.PI * 2
      );
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();
    }

    this.uiButtons = [];
    this.renderControls(ctx, { extraEntities: this.pickups });

    if (this.state === 'PLAYING' && this.spawnIntroTimer > 0) {
      this.renderSpawnBeacons(ctx);
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.curve'),
      guideEntries: [
        'P1 [A/D]',
        'P2 [←/→]',
        'P3 [J/L]',
        'P4 [F/H]',
      ],
      colors: this.players.map((p) => p.color),
      accent: '#D84727',
      matchOverHeadline: this.matchDraw ? t('game.draw') : t('curve.champ'),
      matchOverRows: this.players
        .filter((player) => player.isJoined)
        .map((player) => ({ color: player.color, text: `${player.name}: ${this.scores[player.index] || 0}★` })),
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

  renderSpawnBeacons(ctx) {
    const progress = this.spawnIntroTimer / 1.8;

    this.players.forEach((p) => {
      if (!p.isJoined || !p.isAlive) return;

      ctx.save();
      const ringR = 14 + (1 - progress) * 24;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringR, 0, Math.PI * 2);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(1, 2.5 * (this.arena.unit || 1));
      ctx.globalAlpha = Math.min(1.0, progress * 1.5);
      ctx.stroke();

      const tagW = 75;
      const tagH = 20;
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(p.x - tagW / 2 + 2, p.y - 32 + 2, tagW, tagH);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - tagW / 2, p.y - 32, tagW, tagH);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = Math.max(1, 1.5 * (this.arena.unit || 1));
      ctx.strokeRect(p.x - tagW / 2, p.y - 32, tagW, tagH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.name, p.x, p.y - 22);
      ctx.restore();
    });
  }

}
