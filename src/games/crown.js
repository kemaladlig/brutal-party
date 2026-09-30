// BRUTAL CROWN (Game 07): 2-4 Player High-Contact Crown Brawler
// Full-arena brutalist layout, moving patrol pistons, conveyor belts (yürüyen zeminler),
// banana peel slip traps 🍌, turbo pickups ⚡, heavy crown physics (-34% speed), 0.85s stun & zero screen-shake.

import { getSlotCustomization } from '../core/customizationManager.js';
import {
  playStart,
  playJoin,
  playDashWhoosh,
  playStumble,
  playSlip,
  playHeavyImpact,
  playPiggyBreak,
  playWallHit,
  playPaddleHit,
  playCashRegister,
  playItemPickup,
  playTeleport,
} from '../audio.js';
import { t } from '../i18n.js';
import { matchesInputAction } from '../core/inputIntent.js';
import { renderTopPill, renderArenaWatermarkTimer } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { clampToArena, damp, resolveAABB, pointBlocked } from '../core/physics2d.js';
import { createPlayer } from '../core/playerEntity.js';
import { updateCrownBotAI } from '../ai/crownAI.js';
import { keyboardVectorFrom } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { spawnPickup } from '../core/pickupSystem.js';
import { beginDrawRound, beginRound, endMatch, roundTimedOut, tickRoundFlow } from '../core/roundLifecycle.js';
import { computePlayfield, fieldSpeed, fieldRadius } from '../core/playfield.js';
import { UI_COLORS, CROWN_COLORS } from '../ui/tokens.js';
import { createCrownWorldPacket, drawCrownWorld, drawCrownFxLayer } from './crownView.js';
import { createFxRuntime } from '../core/fxRuntime.js';

export { CROWN_COLORS };
export const CROWN_NAMES = ['P1', 'P2', 'P3', 'P4'];
export const CROWN_TUNING = {
  ROUND_TIME: 45,
  MAX_TIED_ROUNDS: 2,
  // Hareket bütçesi. Hız zaten en yüksekti (952/250 = 3.8sn), yavaşlık
  // GÖVDEDEN geliyordu: r43, aktif oyunların en büyüğüydü (2.9 gövde/sn,
  // BOMB 2.4 / ARCHER 3.5). 250 hız korunur, 43 → 36: gövde/sn 3.47'ye çıkar,
  // saha geçiş süresi değişmez. 4 corner spawn köşeye %38/%36 ofsetli olduğu
  // için küçülen gövde spawn'ları bozmaz.
  PLAYER_RADIUS: 36,
  MOVE_SPEED: 250,
};

export const CROWN_MAP_PRESETS = [
  { id: 'citadel_patrol', name: '01 // SARAY AVCILARI (SİPERLER, PİSTONLAR & MANTARLAR)' },
  { id: 'conveyors', name: '02 // KONVEYÖR HIZ YOLU (AKAN BANTLAR & HIZ PEDLERİ)' },
  { id: 'banana_maze', name: '03 // MUZ VE DİKEN LABİRENTİ (KORİDORLAR & 4 MANTAR)' },
  { id: 'moving_citadel', name: '04 // MERKEZ KALE (4 KAPILI SIĞINAK & KANAT PİSTONLARI)' },
  { id: 'chaos_flipper', name: '05 // KAOS FIRLATICI (6 YAYLI MANTAR & ÇAPRAZ BANTLAR)' },
];

export class CrownGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // Arena geometry
    this.arena = {
      cx: 0,
      cy: 0,
      width: 0,
      height: 0,
      size: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    };

    // Map Presets & Obstacles
    this.selectedMapIndex = 0;
    this.pillars = [];
    this.conveyors = [];
    this.movingHazards = [];
    this.bumpers = [];
    this.speedPads = [];
    this.bananaPeels = [];
    this.pickups = [];
    this.inkPuddles = [];
    this.pickupTimer = 5.0;

    // Slot types: 'empty' | 'human' | 'bot_normal' (clean 3-state cycle)
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];

    // Tournament Scoring
    this.targetScore = 2; // First to 2 rounds wins the match
    this.scores = [0, 0, 0, 0];
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.roundTimer = CROWN_TUNING.ROUND_TIME;
    this.targetCrownTime = 15.0; // 15 seconds holding the crown to win a round

    // Entities
    this.players = [];
    this.crown = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      // Tasarım yarıçapı. ÖLÇEK `resize()` içinde uygulanır: constructor'daki
      // `this.arena` el yapımı ve `unit` alanı YOK, burada `fieldRadius`
      // çağırmak NaN üretiyordu (ölçülen: taç yere düşünce toplanmıyordu).
      radius: 20,
      carrierIndex: null,
      pickupCooldown: 0,
      floatAnim: 0,
    };

    // FX runtime (MOTION_PLAN Faz 2b): partikül/ring/pop/hit-stop tek sahibi;
    // `this.particles` worldCore konvansiyonu için alias'tır. Travma lavabosu
    // YOK: CROWN "ZERO CAMERA SHAKE" tasarımlıdır, sarsıntı eklenmez.
    this.fx = createFxRuntime({ arenaProvider: () => this.arena });
    /** @type {any[]} */ this.particles = this.fx.particles;
    this.floatingTexts = [];
    this.initKeyboard();
  }

  getTabletopSchema() {    return {
      ...this.getCentralTabletopLayout('CROWN'),
      actions: [
        {
          id: 'tackle',
          icon: '💥',
          cooldownField: 'tackleCooldown',
          maxCooldown: 2.0,
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

  // Koltuk döngüsü BaseGame'de (persona rengi dahil); burada yalnız join sesi.
  onSeatCycled() {
    playJoin();
  }

  cycleMap() {
    this.selectedMapIndex = (this.selectedMapIndex + 1) % CROWN_MAP_PRESETS.length;
    this.buildMap();
    playJoin();
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };

    const activeMapState = {
      pickups: this.pickups.map((item) => ({ ...item })),
      bananaPeels: this.bananaPeels.map((item) => ({ ...item })),
      inkPuddles: this.inkPuddles.map((item) => ({ ...item })),
      hazardPhases: this.movingHazards.map((item) => item.pos),
    };

    this.arena = computePlayfield(width, height, 'crown');

    this.buildMap();
    // Maç ortası resize raundu sıfırlamasın (harita geometrisi yenilenir,
    // taç/oyuncular orantılı taşınır)
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
    } else {
      this.pickups = activeMapState.pickups;
      this.bananaPeels = activeMapState.bananaPeels;
      this.inkPuddles = activeMapState.inkPuddles;
      this.movingHazards.forEach((hazard, i) => {
        if (Number.isFinite(activeMapState.hazardPhases[i])) hazard.pos = activeMapState.hazardPhases[i];
        const progress = Math.sin(hazard.pos) * 0.5 + 0.5;
        if (hazard.axis === 'x') hazard.x = hazard.minPos + progress * (hazard.maxPos - hazard.minPos);
        else hazard.y = hazard.minPos + progress * (hazard.maxPos - hazard.minPos);
      });

      for (const p of this.players) {
        this.remapPoint(p, oldArena, this.arena);
        p.radius = fieldRadius(this.arena, CROWN_TUNING.PLAYER_RADIUS, 0);
        clampToArena(p, p.radius, this.arena, { zeroVelocity: true });
        p.vx = 0; p.vy = 0;
      }
      // Taç tek bir dünya nesnesi: yarıçapı saha ile birlikte yeniden türetilir
      // (constructor'daki arena `unit` içermediği için orada ölçeklenemez).
      if (this.crown) this.crown.radius = fieldRadius(this.arena, 20, 0);
      if (this.crown && this.crown.carrierIndex !== null && this.crown.carrierIndex !== undefined) {
        const carrier = this.players[this.crown.carrierIndex];
        if (carrier) { this.crown.x = carrier.x; this.crown.y = carrier.y; }
      } else if (this.crown) {
        this.remapPoint(this.crown, oldArena, this.arena);
        clampToArena(this.crown, this.crown.radius, this.arena, { zeroVelocity: true });
        this.crown.vx = 0; this.crown.vy = 0;
      }
      for (const item of this.pickups) {
        this.remapPoint(item, oldArena, this.arena);
        clampToArena(item, item.radius || 15, this.arena);
      }
      for (const ink of this.inkPuddles) {
        this.remapPoint(ink, oldArena, this.arena);
        clampToArena(ink, ink.radius || 22, this.arena);
      }
      // Biriken partiküller ESKİ arena ölçeğindeydi; yeni unit ile karışmasın.
      this.fx.clear();
    }
  }

  buildMap() {
    const { cx, cy, width, height, top, bottom } = this.arena;
    if (width <= 0 || height <= 0) return;

    this.pillars = [];
    this.conveyors = [];
    this.movingHazards = [];
    this.bumpers = [];
    this.speedPads = [];
    this.bananaPeels = [];
    this.pickups = [];
    this.inkPuddles = [];

    const bRad = 26;

    if (this.selectedMapIndex === 0) {
      // --- MAP 0: 🏰 SARAY AVCILARI (Siperler, Devriye Pistonları & 2 Yaylı Mantar) ---
      const pW = Math.round(width * 0.14);
      const pH = Math.round(height * 0.18);
      const offX = Math.round(width * 0.28);
      const offY = Math.round(height * 0.24);

      this.pillars = [
        { x: cx - offX - pW / 2, y: cy - offY - pH / 2, w: pW, h: pH }, // Top-Left
        { x: cx + offX - pW / 2, y: cy - offY - pH / 2, w: pW, h: pH }, // Top-Right
        { x: cx - offX - pW / 2, y: cy + offY - pH / 2, w: pW, h: pH }, // Bottom-Left
        { x: cx + offX - pW / 2, y: cy + offY - pH / 2, w: pW, h: pH }, // Bottom-Right
      ];

      // 2 Moving Patrol Bumpers sliding horizontally with visible tracks
      this.movingHazards = [
        {
          axis: 'x',
          x: cx,
          y: cy - height * 0.25,
          radius: bRad,
          minPos: cx - width * 0.22,
          maxPos: cx + width * 0.22,
          pos: 0,
          speed: 1.8,
          pulse: 0,
        },
        {
          axis: 'x',
          x: cx,
          y: cy + height * 0.25,
          radius: bRad,
          minPos: cx - width * 0.22,
          maxPos: cx + width * 0.22,
          pos: Math.PI,
          speed: 1.8,
          pulse: 0,
        },
      ];

      // 2 Bouncy Pinball Bumpers in center horizontal corridor
      this.bumpers = [
        { x: cx - width * 0.12, y: cy, radius: fieldRadius(this.arena, 25, 0), pulse: 0 },
        { x: cx + width * 0.12, y: cy, radius: fieldRadius(this.arena, 25, 0), pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx, y: cy - height * 0.13, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx, y: cy + height * 0.13, radius: fieldRadius(this.arena, 14, 0) },
      ];
    } else if (this.selectedMapIndex === 1) {
      // --- MAP 1: 🌀 KONVEYÖR HIZ YOLU (Akan Bantlar & Hız Pedleri) ---
      const cW = Math.round(width * 0.64);
      const cH = Math.round(height * 0.085);

      // Top conveyor flings East (▶), Bottom conveyor flings West (◀)
      this.conveyors = [
        { x: cx - cW / 2, y: cy - height * 0.24 - cH / 2, w: cW, h: cH, dirX: 1, dirY: 0, speed: fieldSpeed(this.arena, 180), animOffset: 0 },
        { x: cx - cW / 2, y: cy + height * 0.24 - cH / 2, w: cW, h: cH, dirX: -1, dirY: 0, speed: fieldSpeed(this.arena, 180), animOffset: 0 },
      ];

      // 2 Central Flank Block Pillars
      const blkW = Math.round(width * 0.10);
      const blkH = Math.round(height * 0.25);
      this.pillars = [
        { x: cx - width * 0.24 - blkW / 2, y: cy - blkH / 2, w: blkW, h: blkH },
        { x: cx + width * 0.24 - blkW / 2, y: cy - blkH / 2, w: blkW, h: blkH },
      ];

      // 2 Turbo Speed Boost Pads on north & south exits
      const spW = Math.round(width * 0.14);
      const spH = Math.round(height * 0.06);
      this.speedPads = [
        { x: cx - spW / 2, y: top + height * 0.06, w: spW, h: spH, dirX: 0, dirY: 1 },
        { x: cx - spW / 2, y: bottom - height * 0.12, w: spW, h: spH, dirX: 0, dirY: -1 },
      ];

      // 2 Bouncy Bumpers at outer flank bottlenecks
      this.bumpers = [
        { x: cx - width * 0.38, y: cy, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx + width * 0.38, y: cy, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx + width * 0.31, y: cy - height * 0.24, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx - width * 0.31, y: cy + height * 0.24, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx, y: cy, radius: fieldRadius(this.arena, 14, 0) },
      ];
    } else if (this.selectedMapIndex === 2) {
      // --- MAP 2: 🍌 MUZ VE DİKEN LABİRENTİ (Koridorlar & 4 Yaylı Mantar) ---
      const thick = Math.round(width * 0.045);
      const len = Math.round(height * 0.26);

      this.pillars = [
        { x: cx - width * 0.20 - thick / 2, y: cy - height * 0.16 - len / 2, w: thick, h: len },
        { x: cx + width * 0.20 - thick / 2, y: cy - height * 0.16 - len / 2, w: thick, h: len },
        { x: cx - width * 0.20 - thick / 2, y: cy + height * 0.16 - len / 2, w: thick, h: len },
        { x: cx + width * 0.20 - thick / 2, y: cy + height * 0.16 - len / 2, w: thick, h: len },
      ];

      // 4 Bouncy Pinball Bumpers in diamond formation
      this.bumpers = [
        { x: cx, y: cy - height * 0.20, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx, y: cy + height * 0.20, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx - width * 0.10, y: cy, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx + width * 0.10, y: cy, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
      ];

      // 1 Center Vertically Moving Piston
      this.movingHazards = [
        {
          axis: 'y',
          x: cx,
          y: cy,
          radius: fieldRadius(this.arena, 26, 0),
          minPos: cy - height * 0.28,
          maxPos: cy + height * 0.28,
          pos: 0,
          speed: 1.7,
          pulse: 0,
        },
      ];

      this.bananaPeels = [
        { x: cx - width * 0.32, y: cy - height * 0.18, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx + width * 0.32, y: cy - height * 0.18, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx - width * 0.32, y: cy + height * 0.18, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx + width * 0.32, y: cy + height * 0.18, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx, y: cy - height * 0.33, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx, y: cy + height * 0.33, radius: fieldRadius(this.arena, 14, 0) },
      ];
    } else if (this.selectedMapIndex === 3) {
      // --- MAP 3: ⚡ MERKEZ KALE (4 Kapılı Sığınak & Kanat Pistonları) ---
      const bW = Math.round(width * 0.14);
      const bH = Math.round(height * 0.13);

      this.pillars = [
        { x: cx - width * 0.12 - bW / 2, y: cy - height * 0.14 - bH / 2, w: bW, h: bH },
        { x: cx + width * 0.12 - bW / 2, y: cy - height * 0.14 - bH / 2, w: bW, h: bH },
        { x: cx - width * 0.12 - bW / 2, y: cy + height * 0.14 - bH / 2, w: bW, h: bH },
        { x: cx + width * 0.12 - bW / 2, y: cy + height * 0.14 - bH / 2, w: bW, h: bH },
      ];

      // 2 Moving Hazards on West and East outer flanks
      this.movingHazards = [
        {
          axis: 'y',
          x: cx - width * 0.36,
          y: cy,
          radius: fieldRadius(this.arena, 26, 0),
          minPos: cy - height * 0.25,
          maxPos: cy + height * 0.25,
          pos: 0,
          speed: 2.0,
          pulse: 0,
        },
        {
          axis: 'y',
          x: cx + width * 0.36,
          y: cy,
          radius: fieldRadius(this.arena, 26, 0),
          minPos: cy - height * 0.25,
          maxPos: cy + height * 0.25,
          pos: Math.PI,
          speed: 2.0,
          pulse: 0,
        },
      ];

      // 2 Bouncy Bumpers guarding north & south bunker doorways
      this.bumpers = [
        { x: cx, y: cy - height * 0.27, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx, y: cy + height * 0.27, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx - width * 0.05, y: cy, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx + width * 0.05, y: cy, radius: fieldRadius(this.arena, 14, 0) },
      ];
    } else if (this.selectedMapIndex === 4) {
      // --- MAP 4: 💥 KAOS FIRLATICI (6 Yaylı Mantar & 4 Çapraz Bant) ---
      const cW = Math.round(width * 0.24);
      const cH = Math.round(height * 0.08);

      // 4 Cross-directional conveyor belts in the 4 quadrants
      this.conveyors = [
        { x: cx - width * 0.28 - cW / 2, y: cy - height * 0.22 - cH / 2, w: cW, h: cH, dirX: 0, dirY: -1, speed: fieldSpeed(this.arena, 170), animOffset: 0 },
        { x: cx + width * 0.28 - cW / 2, y: cy - height * 0.22 - cH / 2, w: cW, h: cH, dirX: 1, dirY: 0, speed: fieldSpeed(this.arena, 170), animOffset: 0 },
        { x: cx - width * 0.28 - cW / 2, y: cy + height * 0.22 - cH / 2, w: cW, h: cH, dirX: -1, dirY: 0, speed: fieldSpeed(this.arena, 170), animOffset: 0 },
        { x: cx + width * 0.28 - cW / 2, y: cy + height * 0.22 - cH / 2, w: cW, h: cH, dirX: 0, dirY: 1, speed: fieldSpeed(this.arena, 170), animOffset: 0 },
      ];

      // 6 Bouncy Pinball Bumpers
      this.bumpers = [
        { x: cx - width * 0.12, y: cy, radius: fieldRadius(this.arena, 26, 0), pulse: 0 },
        { x: cx + width * 0.12, y: cy, radius: fieldRadius(this.arena, 26, 0), pulse: 0 },
        { x: cx, y: cy - height * 0.30, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx, y: cy + height * 0.30, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx - width * 0.36, y: cy, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
        { x: cx + width * 0.36, y: cy, radius: fieldRadius(this.arena, 24, 0), pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx, y: cy - height * 0.14, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx, y: cy + height * 0.14, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx - width * 0.20, y: cy, radius: fieldRadius(this.arena, 14, 0) },
        { x: cx + width * 0.20, y: cy, radius: fieldRadius(this.arena, 14, 0) },
      ];
    }
  }

  initPlayers() {
    const { cx, cy, width, height } = this.arena;
    const spawnOffX = width * 0.38;
    const spawnOffY = height * 0.36;
    const r = fieldRadius(this.arena, CROWN_TUNING.PLAYER_RADIUS, 0);

    // 4 Corner Spawns: BL (P1), TL (P2), TR (P3), BR (P4)
    const spawns = [
      { x: cx - spawnOffX, y: cy + spawnOffY },
      { x: cx - spawnOffX, y: cy - spawnOffY },
      { x: cx + spawnOffX, y: cy - spawnOffY },
      { x: cx + spawnOffX, y: cy + spawnOffY },
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      return createPlayer(i, s, {
        existingName: existing?.name,
        defaultNames: CROWN_NAMES,
        defaultColors: CROWN_COLORS,
        radius: r,
        speed: fieldSpeed(this.arena, CROWN_TUNING.MOVE_SPEED),
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        hasCrown: false,
        crownHoldTime: 0,
        tackleCooldown: 0,
        tackleTimer: 0,
        isTackling: false,
        tackleVx: 0,
        tackleVy: 0,
        stumbleTimer: 0,
        turboTimer: 0,
        slipTimer: 0,
        slipAngle: 0,
        inputX: 0,
        inputY: 0,
      });
    });

    if (this.state === 'LOBBY' || this.crown.carrierIndex === null) {
      this.crown.x = cx;
      this.crown.y = cy;
      this.crown.vx = 0;
      this.crown.vy = 0;
      this.crown.carrierIndex = null;
      this.crown.pickupCooldown = 0;
    }
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
    this.roundTimer = CROWN_TUNING.ROUND_TIME;
    this.fx.clear();
    this.floatingTexts = [];
    this.trauma = 0;
    this.lastTime = performance.now();
    this._cachedWorldPacket = null;
    this._lastWorldPacketTime = 0;
    for (let i = 0; i < 4; i++) {
      if (this.joysticks[i]) {
        this.joysticks[i].active = false;
        this.joysticks[i].id = -1;
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
    this.tiedRounds = 0;
    this.startNewRound();
  }

  startNewRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }

    this.state = 'PLAYING';
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTimer = CROWN_TUNING.ROUND_TIME;
    this.fx.clear();
    this.floatingTexts = [];
    this.pickupTimer = 4.0;
    this._cachedWorldPacket = null;
    this._lastWorldPacketTime = 0;

    this.buildMap();
    this.initPlayers();

    for (const p of this.players) {
      p.hasCrown = false;
      p.crownHoldTime = 0;
      p.tackleCooldown = 0;
      p.tackleTimer = 0;
      p.isTackling = false;
      p.stumbleTimer = 0;
      p.turboTimer = 0;
      p.slipTimer = 0;
      p.slipAngle = 0;
    }

    this.crown.x = this.arena.cx;
    this.crown.y = this.arena.cy;
    this.crown.vx = 0;
    this.crown.vy = 0;
    this.crown.carrierIndex = null;
    this.crown.pickupCooldown = 0.5;

    playStart();
  }

  resolveCrownTimeout() {
    let winner = null;
    let best = -1;
    let tied = false;
    for (const p of this.players) {
      if (!p.isJoined) continue;
      const value = p.crownHoldTime || 0;
      if (value > best) {
        best = value;
        winner = p;
        tied = false;
      } else if (value === best) {
        tied = true;
      }
    }
    if (!winner || best <= 0 || tied) {
      this.finishTiedRound('timeout');
      return;
    }
    this.awardCrownWinner(winner);
  }

  awardCrownWinner(winner) {
    this.tiedRounds = 0;
    this.scores[winner.index]++;
    // Raunt zaferi: score olayı (halka + haptik; sarsıntısız).
    this.fx.emit('score', {
      x: winner.x, y: winner.y, color: winner.color, slot: winner.index,
      haptic: winner.slotType === 'human',
    });
    if (this.scores[winner.index] >= this.targetScore) {
      this.roundWinner = winner;
      endMatch(this, winner, 'target-score');
      return;
    }
    beginRound(this, winner, 'crown');
  }

  finishTiedRound(reason = 'timeout') {
    if (!this.players.some((p) => p.isJoined)) {
      endMatch(this, null, reason);
      return;
    }
    this.tiedRounds += 1;
    if (this.tiedRounds >= CROWN_TUNING.MAX_TIED_ROUNDS) {
      endMatch(this, null, reason);
      return;
    }
    beginRound(this, null, reason);
  }

  triggerTackle(playerIndex) {
    if (this.state !== 'PLAYING') return;
    const player = this.players[playerIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (player.tackleCooldown > 0 || player.stumbleTimer > 0 || player.slipTimer > 0) return;

    player.tackleCooldown = 2.0;
    player.tackleTimer = 0.22;
    player.isTackling = true;

    let dirX = Math.cos(player.facingAngle);
    let dirY = Math.sin(player.facingAngle);
    const vLen = Math.hypot(player.vx, player.vy);
    if (vLen > 20) {
      dirX = player.vx / vLen;
      dirY = player.vy / vLen;
    }

    const tackleSpeed = fieldSpeed(this.arena, 480);
    player.tackleVx = dirX * tackleSpeed;
    player.tackleVy = dirY * tackleSpeed;
    player.vx = player.tackleVx;
    player.vy = player.tackleVy;

    playDashWhoosh();

    // Omuz hamlesi: dust bulutu (haptiksiz ortam olayı; whoosh sesi eşlik eder).
    this.fx.emit('dust', { x: player.x, y: player.y, color: player.color });
  }

  // Taç rastgele bir noktaya savrulur (haritada aksiyon dağılır)
  scatterCrown() {
    const { left, right, top, bottom } = this.arena;
    const pad = 70;
    for (let tries = 0; tries < 12; tries++) {
      const tx = left + pad + Math.random() * (right - left - pad * 2);
      const ty = top + pad + Math.random() * (bottom - top - pad * 2);
      let inside = false;
      for (const pil of this.pillars) {
        if (tx > pil.x - 24 && tx < pil.x + pil.w + 24 && ty > pil.y - 24 && ty < pil.y + pil.h + 24) {
          inside = true;
          break;
        }
      }
      if (!inside) {
        this.crown.x = tx;
        this.crown.y = ty;
        break;
      }
    }
    this.crown.vx = (Math.random() - 0.5) * 120;
    this.crown.vy = (Math.random() - 0.5) * 120;
    playDashWhoosh();
    // Taç savrulması: spark olayı (ortam efekti, haptiksiz).
    this.fx.emit('spark', { x: this.crown.x, y: this.crown.y, color: UI_COLORS.crownSpark });
  }

  addFloatingText(x, y, text, color = UI_COLORS.inkDark) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      life: 1.2,
      maxLife: 1.2,
    });
  }

  // Bariyer: katı duvar (içinden geçilmez) + çevresinde yavaşlatma alanı.
  // Sekme yok, ses yok — hissedilir ama sessiz engel.
  resolvePillarCollisions(entity, radius, isCrown = false) {
    for (const pil of this.pillars) {
      const closestX = Math.max(pil.x, Math.min(entity.x, pil.x + pil.w));
      const closestY = Math.max(pil.y, Math.min(entity.y, pil.y + pil.h));
      const dx = entity.x - closestX;
      const dy = entity.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (!isCrown && distSq < (radius + 26) * (radius + 26)) {
        entity.inSlow = true;
      }

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = radius - dist;
          entity.x += nx * overlap;
          entity.y += ny * overlap;

          const dot = entity.vx * nx + entity.vy * ny;
          if (dot < 0) {
            entity.vx -= 1.4 * dot * nx;
            entity.vy -= 1.4 * dot * ny;
          }
        }
      }
    }
  }

  // Rastgele pickup (bomba moduyla aynı: TURBO / TELEPORT / SLIP, 8-12 sn'de bir, max 2)
  spawnRandomPickup() {
    spawnPickup(this, {
      types: ['TURBO', 'TELEPORT', 'SLIP'],
      max: 2,
      obstacles: this.pillars,
    });
  }

  updateRoundLifecycle(dt) {
    if (tickRoundFlow(this, dt)) return false;

    if (this.state !== 'PLAYING') return false;

    this.roundTimer -= dt;
    if (this.roundTimer <= 0 || roundTimedOut(this.roundTimer, CROWN_TUNING.ROUND_TIME)) {
      this.resolveCrownTimeout();
      return false;
    }

    // Tek katılımcı kalınca taç süresi beklenmez — kalan raundu alır
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length <= 1) {
      if (joined.length === 1) {
        const survivor = joined[0];
        this.awardCrownWinner(survivor);
      } else {
        this.finishTiedRound('no-players');
      }
      return false;
    }

    return true;
  }

  updateEnvironment(dt) {
    // --- 1. Update Conveyor Belts ---
    for (const c of this.conveyors) {
      c.animOffset = ((c.animOffset || 0) + c.speed * dt);
    }

    // --- 2. Update Moving Hazards ---
    for (const h of this.movingHazards) {
      h.pos += h.speed * dt;
      const progress = Math.sin(h.pos) * 0.5 + 0.5;
      if (h.axis === 'x') {
        h.x = h.minPos + progress * (h.maxPos - h.minPos);
      } else {
        h.y = h.minPos + progress * (h.maxPos - h.minPos);
      }
      if (h.pulse > 0) h.pulse = Math.max(0, h.pulse - dt * 3.5);
      if (h.hitCool > 0) h.hitCool -= dt;
    }

    // --- Update Bumpers Pulse Decay ---
    for (const b of this.bumpers) {
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt * 3.5);
      if (b.hitCool > 0) b.hitCool -= dt;
    }

    // --- Bariyer yavaşlatma bayrağı her frame sıfırlanır ---
    if (this.rubCool > 0) this.rubCool -= dt;
  }

  updatePickupsAndInk(dt) {
    // --- 3. Dynamic Pickups (bomba temposu: 8-12 sn, max 2) & Mürekkep kuruma ---
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      if (this.pickups.length < 2) this.spawnRandomPickup();
      this.pickupTimer = 8.0 + Math.random() * 4.0;
    }
    for (let i = this.inkPuddles.length - 1; i >= 0; i--) {
      const ink = this.inkPuddles[i];
      ink.duration -= dt;
      if (ink.duration <= 0) this.inkPuddles.splice(i, 1);
    }
    for (const pk of this.pickups) pk.animTime = (pk.animTime || 0) + dt;
  }

  updateCrown(dt) {
    const { left, right, top, bottom, cx, cy } = this.arena;

    // --- 4. Update Crown State & Time ---
    this.crown.floatAnim += dt * 3.5;
    if (this.crown.pickupCooldown > 0) this.crown.pickupCooldown -= dt;

    if (this.crown.carrierIndex !== null) {
      const king = this.players[this.crown.carrierIndex];
      if (king && king.isAlive) {
        this.crown.x = king.x;
        this.crown.y = king.y - king.radius - 12 + Math.sin(this.crown.floatAnim) * 4;
        this.crown.vx = 0;
        this.crown.vy = 0;

        king.crownHoldTime += dt;

        if (king.crownHoldTime >= this.targetCrownTime) {
          playPiggyBreak();
          playCashRegister();
          this.addFloatingText(cx, cy, `${king.name} RAUNDU KAZANDI!`, king.color);
          this.awardCrownWinner(king);
          return true;
        }
      } else {
        this.crown.carrierIndex = null;
      }
    } else {
      // Conveyor drift on loose crown
      for (const c of this.conveyors) {
        if (this.crown.x >= c.x && this.crown.x <= c.x + c.w && this.crown.y >= c.y && this.crown.y <= c.y + c.h) {
          this.crown.x += c.dirX * c.speed * dt;
          this.crown.y += c.dirY * c.speed * dt;
          break;
        }
      }

      this.crown.x += this.crown.vx * dt;
      this.crown.y += this.crown.vy * dt;
      const crownDrag = damp(0.94, dt);
      this.crown.vx *= crownDrag;
      this.crown.vy *= crownDrag;

      const cr = this.crown.radius;
      if (this.crown.x - cr < left) { this.crown.x = left + cr; this.crown.vx *= -0.8; playWallHit(); }
      if (this.crown.x + cr > right) { this.crown.x = right - cr; this.crown.vx *= -0.8; playWallHit(); }
      if (this.crown.y - cr < top) { this.crown.y = top + cr; this.crown.vy *= -0.8; playWallHit(); }
      if (this.crown.y + cr > bottom) { this.crown.y = bottom - cr; this.crown.vy *= -0.8; playWallHit(); }

      this.resolvePillarCollisions(this.crown, cr, true);

      for (const h of this.movingHazards) {
        const dx = this.crown.x - h.x;
        const dy = this.crown.y - h.y;
        const dist = Math.hypot(dx, dy);
        const minDist = h.radius + cr;
        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          this.crown.x = h.x + nx * minDist;
          this.crown.y = h.y + ny * minDist;
          this.crown.vx = nx * 320;
          this.crown.vy = ny * 320;
          h.pulse = 1.0;
        }
      }

      for (const b of this.bumpers) {
        const dx = this.crown.x - b.x;
        const dy = this.crown.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = b.radius + cr;
        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          this.crown.x = b.x + nx * minDist;
          this.crown.y = b.y + ny * minDist;
          this.crown.vx = nx * 380;
          this.crown.vy = ny * 380;
          if (!b.hitCool || b.hitCool <= 0) {
            b.hitCool = 0.25;
            b.pulse = 1.0;
            playPaddleHit();
          }
        }
      }
    }
    return false;
  }

  updatePlayers(dt) {
    const { left, right, top, bottom } = this.arena;

    // --- 5. Update Players ---
    for (const p of this.players) {
      if (!p.isJoined || !p.isAlive) continue;
      p.inSlow = false;

      if (p.tackleCooldown > 0) p.tackleCooldown -= dt;
      if (p.tackleTimer > 0) {
        p.tackleTimer -= dt;
        if (p.tackleTimer <= 0) p.isTackling = false;
      }
      if (p.stumbleTimer > 0) p.stumbleTimer -= dt;
      if (p.turboTimer > 0) p.turboTimer -= dt;
      if (p.slipTimer > 0) {
        p.slipTimer -= dt;
        p.slipAngle += dt * 14;
      }

      let inX = 0;
      let inY = 0;

      if (p.slotType === 'human') {
        const joy = this.joysticks[p.index];
        if (joy.active && joy.force > 0.05) {
          inX = Math.cos(joy.angle) * joy.force;
          inY = Math.sin(joy.angle) * joy.force;
        }

        const kb = keyboardVectorFrom(this.keys, p.index);
        inX += kb.x;
        inY += kb.y;
      } else {
        updateCrownBotAI(this, p, dt);
        inX = p.inputX;
        inY = p.inputY;
      }

      // Heavy crown handicap: 165 px/s vs 250 px/s (tasarım px/s)
      let speed = fieldSpeed(this.arena, p.hasCrown ? 165 : CROWN_TUNING.MOVE_SPEED);
      if (p.turboTimer > 0) speed = fieldSpeed(this.arena, 340);
      if (p.inSlow) speed *= 0.55; // bariyer yavaşlatma alanı

      const inLen = Math.hypot(inX, inY);
      if (p.slipTimer > 0) {
        const slipDrag = damp(0.97, dt);
        p.vx *= slipDrag;
        p.vy *= slipDrag;
      } else if (p.stumbleTimer > 0) {
        // Sersemlikte savrulma korunur (uçuş hissi): hız ezilmez, sadece süzülür
        const stumbleDrag = Math.max(0, 1 - 2.2 * dt);
        p.vx *= stumbleDrag;
        p.vy *= stumbleDrag;
        if (inLen > 0.05) p.facingAngle = Math.atan2(inY, inX);
      } else {
        if (inLen > 0.05) {
          p.facingAngle = Math.atan2(inY, inX);
        }

        if (p.isTackling) {
          p.vx = p.tackleVx;
          p.vy = p.tackleVy;
        } else {
          if (inLen > 0.05) {
            p.vx = (inX / inLen) * speed;
            p.vy = (inY / inLen) * speed;
          } else {
            const idleDrag = damp(0.82, dt);
            p.vx *= idleDrag;
            p.vy *= idleDrag;
          }
        }
      }

      // Conveyor belt drift
      for (const c of this.conveyors) {
        if (p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h) {
          p.x += c.dirX * c.speed * dt;
          p.y += c.dirY * c.speed * dt;
          break;
        }
      }

      p.x += p.vx * dt;
      p.y += p.vy * dt;

      const pr = p.radius;
      if (p.x - pr < left) { p.x = left + pr; p.vx = 0; }
      if (p.x + pr > right) { p.x = right - pr; p.vx = 0; }
      if (p.y - pr < top) { p.y = top + pr; p.vy = 0; }
      if (p.y + pr > bottom) { p.y = bottom - pr; p.vy = 0; }

      this.resolvePillarCollisions(p, pr);

      // Moving Hazards
      for (const h of this.movingHazards) {
        const dx = p.x - h.x;
        const dy = p.y - h.y;
        const dist = Math.hypot(dx, dy);
        const minDist = h.radius + pr;
        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          p.x = h.x + nx * minDist;
          p.y = h.y + ny * minDist;

          const bounceSpeed = Math.max(460, Math.hypot(p.vx, p.vy) * 1.4);
          p.vx = nx * bounceSpeed;
          p.vy = ny * bounceSpeed;
          p.facingAngle = Math.atan2(ny, nx);
          // Sersem + ses soğumalı: piston üstünde duran kilitlenmesin
          if (!h.hitCool || h.hitCool <= 0) {
            h.hitCool = 1.0;
            h.pulse = 1.0;
            p.stumbleTimer = Math.max(p.stumbleTimer, 1.0);
            playWallHit();
            this.fx.emit('spark', { x: p.x, y: p.y, color: UI_COLORS.crownSpark });
          }
        }
      }

      // Bouncy Pinball Bumpers (Yaylı Mantarlar)
      for (const b of this.bumpers) {
        const dx = p.x - b.x;
        const dy = p.y - b.y;
        const dist = Math.hypot(dx, dy);
        const minDist = b.radius + pr;
        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          p.x = b.x + nx * minDist;
          p.y = b.y + ny * minDist;

          const bounceSpeed = Math.max(460, Math.hypot(p.vx, p.vy) * 1.35);
          p.vx = nx * bounceSpeed;
          p.vy = ny * bounceSpeed;
          p.facingAngle = Math.atan2(ny, nx);
          if (!b.hitCool || b.hitCool <= 0) {
            b.hitCool = 0.25;
            b.pulse = 1.0;
            playHeavyImpact();
            this.fx.emit('spark', { x: p.x, y: p.y, color: UI_COLORS.crownSpark });
          }
        }
      }

      // Speed Boost Pads
      for (const sp of this.speedPads) {
        if (p.x >= sp.x && p.x <= sp.x + sp.w && p.y >= sp.y && p.y <= sp.y + sp.h) {
          if (p.turboTimer < 1.0) {
            p.turboTimer = 1.6;
            p.vx += sp.dirX * 240;
            p.vy += sp.dirY * 240;
            playDashWhoosh();
            this.addFloatingText(p.x, p.y - 20, 'TURBO!', UI_COLORS.crownAmber);
          }
        }
      }

      // Banana Peel Collision 🍌
      for (let i = this.bananaPeels.length - 1; i >= 0; i--) {
        const b = this.bananaPeels[i];
        const distB = Math.hypot(p.x - b.x, p.y - b.y);
        if (distB < pr + b.radius && p.slipTimer <= 0) {
          p.slipTimer = 1.25;
          p.slipAngle = 0;
          playSlip();
          this.addFloatingText(p.x, p.y - 25, 'KAYDI!', UI_COLORS.crownSpark);
          this.fx.emit('spark', { x: b.x, y: b.y, color: UI_COLORS.crownSpark });

          this.bananaPeels.splice(i, 1);
          break;
        }
      }

      // Pickups (bomba moduyla aynı üçlü: TURBO / TELEPORT / SLIP)
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pk = this.pickups[i];
        const distPk = Math.hypot(p.x - pk.x, p.y - pk.y);
        if (distPk < pr + pk.radius) {
          playItemPickup();
          this.fx.emit('pickup', {
            x: p.x, y: p.y, color: p.color, slot: p.index,
            haptic: p.slotType === 'human',
          });
          if (pk.type === 'TURBO') {
            p.turboTimer = 3.5;
            this.addFloatingText(p.x, p.y - 25, 'TURBO!', UI_COLORS.crownGold);
          } else if (pk.type === 'TELEPORT') {
            // Taçtan en uzak köşeye kaçış
            const ref = this.crown.carrierIndex !== null && this.players[this.crown.carrierIndex]
              ? this.players[this.crown.carrierIndex]
              : this.crown;
            const pad = 60;
            const corners = [
              { x: left + pad, y: top + pad },
              { x: right - pad, y: top + pad },
              { x: left + pad, y: bottom - pad },
              { x: right - pad, y: bottom - pad },
            ];
            let best = corners[0];
            let bestD = -1;
            for (const c of corners) {
              const d = Math.hypot(c.x - ref.x, c.y - ref.y);
              if (d > bestD) { bestD = d; best = c; }
            }
            p.x = Math.max(left + pr, Math.min(right - pr, best.x));
            p.y = Math.max(top + pr, Math.min(bottom - pr, best.y));
            playTeleport();
            this.addFloatingText(p.x, p.y - 25, t('crown.escape'), UI_COLORS.crownTeleport);
          } else if (pk.type === 'SLIP') {
            this.inkPuddles.push({ x: p.x, y: p.y, radius: fieldRadius(this.arena, 22, 0), duration: 10.0 });
            this.addFloatingText(p.x, p.y - 25, 'TUZAK!', UI_COLORS.crownSpark);
          }
          this.pickups.splice(i, 1);
          break;
        }
      }

      // Mürekkep birikintisi (bomba moduyla aynı: 1.3 sn kayma)
      for (const ink of this.inkPuddles) {
        const dInk = Math.hypot(p.x - ink.x, p.y - ink.y);
        if (dInk < pr + ink.radius * 0.75 && p.slipTimer <= 0) {
          p.slipTimer = 1.3;
          playSlip();
          break;
        }
      }

      // Loose crown pickup
      if (this.crown.carrierIndex === null && this.crown.pickupCooldown <= 0) {
        const dCrown = Math.hypot(p.x - this.crown.x, p.y - this.crown.y);
        if (dCrown < pr + this.crown.radius) {
          this.crown.carrierIndex = p.index;
          p.hasCrown = true;
          p.crownHoldTime = 0;
          playCashRegister();
          this.addFloatingText(p.x, p.y - 30, 'KRAL OLDU!', p.color);
          this.fx.emit('pickup', {
            x: p.x, y: p.y, color: p.color, slot: p.index,
            haptic: p.slotType === 'human',
          });
        }
      }
    }
  }

  resolvePlayerCollisions() {
    // --- 6. Player vs Player Combat & Collisions ---
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

        if (dist < minDist && dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;

          const overlap = minDist - dist;
          p1.x -= nx * overlap * 0.5;
          p1.y -= ny * overlap * 0.5;
          p2.x += nx * overlap * 0.5;
          p2.y += ny * overlap * 0.5;

          const p1TacklesP2 = p1.isTackling && !p2.isTackling;
          const p2TacklesP1 = p2.isTackling && !p1.isTackling;
          const mutualTackle = p1.isTackling && p2.isTackling;

          if (p1TacklesP2 || p2TacklesP1 || mutualTackle) {
            let tackler = p1TacklesP2 ? p1 : (p2TacklesP1 ? p2 : null);
            let target = p1TacklesP2 ? p2 : (p2TacklesP1 ? p1 : null);

            if (mutualTackle) {
              p1.vx = -nx * 380;
              p1.vy = -ny * 380;
              p2.vx = nx * 380;
              p2.vy = ny * 380;
              p1.isTackling = false;
              p2.isTackling = false;
              // Karşılıklı omuz: hit olayı (orta nokta, haptik iki insana da değil bire).
              this.fx.emit('hit', {
                x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2,
                color: p1.color, dirX: nx, dirY: ny, slot: p1.index,
                haptic: p1.slotType === 'human',
              });
              playHeavyImpact();
            } else if (tackler && target) {
              tackler.isTackling = false;

              if (target.hasCrown) {
                target.hasCrown = false;
                target.crownHoldTime = 0;
                this.crown.carrierIndex = null;
                // 1s sersem ve yerden alma kilidi
                this.crown.pickupCooldown = 1.0;
                target.stumbleTimer = 1.0;
                this.scatterCrown();

                target.vx = (tackler === p1 ? nx : -nx) * 380;
                target.vy = (tackler === p1 ? ny : -ny) * 380;

                playHeavyImpact();
                playStumble();
                this.addFloatingText(target.x, target.y - 30, t('crown.dropped'), UI_COLORS.crownSpark);
                // Taç düşürme: hit olayı (yön takler→hedef, haptik hedefe).
                this.fx.emit('hit', {
                  x: target.x, y: target.y, color: tackler.color,
                  dirX: tackler === p1 ? nx : -nx, dirY: tackler === p1 ? ny : -ny,
                  slot: target.index,
                  haptic: target.slotType === 'human',
                });
              } else {
                target.vx = (tackler === p1 ? nx : -nx) * 340;
                target.vy = (tackler === p1 ? ny : -ny) * 340;
                target.stumbleTimer = 1.0;
                tackler.vx = -(tackler === p1 ? nx : -nx) * 120;
                tackler.vy = -(tackler === p1 ? ny : -ny) * 120;
                // Taçsız omuz: hit olayı (sarsıntısız — ZERO CAMERA SHAKE korunur).
                this.fx.emit('hit', {
                  x: target.x, y: target.y, color: tackler.color,
                  dirX: tackler === p1 ? nx : -nx, dirY: tackler === p1 ? ny : -ny,
                  slot: target.index,
                  haptic: target.slotType === 'human',
                });
                playPaddleHit(1.6);
              }
            }
          } else {
            const relVx = p2.vx - p1.vx;
            const relVy = p2.vy - p1.vy;
            const velAlongNormal = relVx * nx + relVy * ny;

            if (velAlongNormal < 0) {
              const impulse = -1.2 * velAlongNormal;
              p1.vx -= impulse * nx * 0.5;
              p1.vy -= impulse * ny * 0.5;
              p2.vx += impulse * nx * 0.5;
              p2.vy += impulse * ny * 0.5;
              // Sürtünme sesi: sert temas + soğumalı (yaslanınca makinelisi yok)
              if (-velAlongNormal > 160 && (!this.rubCool || this.rubCool <= 0)) {
                this.rubCool = 0.2;
                playPaddleHit(0.8);
              }
            }

            // Dokunma çalma: dash şart değil — taçlıya değen düşürür
            const crowned = p1.hasCrown ? p1 : (p2.hasCrown ? p2 : null);
            if (crowned) {
              crowned.hasCrown = false;
              crowned.crownHoldTime = 0;
              this.crown.carrierIndex = null;
              this.crown.pickupCooldown = 1.0;
              crowned.stumbleTimer = Math.max(crowned.stumbleTimer, 1.0);
              this.scatterCrown();
              playStumble();
              this.addFloatingText(crowned.x, crowned.y - 30, t('crown.free'), UI_COLORS.crownSpark);
            }
          }
        }
      }
    }
  }

  updateParticlesAndTexts(dt) {
    // --- 7. Update Floating Texts (partiküller fxRuntime'tadır) ---
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= dt * 30;
      ft.life -= dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }
  }

  update(now) {
    const rawDt = Math.max(0, Math.min(0.064, (now - this.lastTime) / 1000));
    this.lastTime = now;
    // Hit-stop TEK SAAT: host karesi yavaşlar, kumanda aynı kareyi görür (§2).
    // Travma lavabosu yok (ZERO CAMERA SHAKE korunur); hit-stop/flaş/haptik çalışır.
    const dt = this.fx.tick(rawDt);
    this.fx.update(dt);

    if (!this.updateRoundLifecycle(dt)) return;

    this.updateEnvironment(dt);
    this.updatePickupsAndInk(dt);
    const roundEnded = this.updateCrown(dt);
    if (roundEnded) return;

    this.updatePlayers(dt);
    this.resolvePlayerCollisions();
    this.updateParticlesAndTexts(dt);
  }

  // --- Render Loop (ZERO CAMERA SHAKE!) ---
  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    ctx.save();
    // Warm brutalist paper background
    ctx.fillStyle = UI_COLORS.crownPaper;
    ctx.fillRect(0, 0, width, height);

    drawCrownWorld(ctx, this, this.arena, this.players.map((p) => p.color), this.lastTime, this.targetCrownTime);

    // Sütun ve engellerin üzerinde net okunan taç süresi filigranı.
    // Skorbord `renderHUD`'un işidir (aşağıda `scoreboardEntities` ile) —
    // burada ikinci bir kopya çiziliyordu.
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      // Saha ortasında sütun ve engellerin üzerinde her zaman net görünen taç süresi filigranı
      const king = this.crown.carrierIndex !== null ? this.players[this.crown.carrierIndex] : null;
      if (king && king.isAlive) {
        const remain = Math.max(0, this.targetCrownTime - king.crownHoldTime);
        const urgent = remain <= 4.0;
        const progress = Math.min(1.0, king.crownHoldTime / this.targetCrownTime);
        renderArenaWatermarkTimer(ctx, {
          arena: this.arena,
          text: `${remain.toFixed(1)}s`,
          subText: '',
          urgent,
          color: urgent ? UI_COLORS.crownRed : king.color,
          alpha: urgent ? 0.70 : 0.48,
          ringProgress: 1.0 - progress,
          placement: 'top',
        });
      } else {
        renderArenaWatermarkTimer(ctx, {
          arena: this.arena,
          text: 'TACI KAP',
          subText: '',
          alpha: 0.35,
          placement: 'top',
        });
      }
    }

    // FX katmanı ortak crownView draw'ından gelir (host↔client aynı).
    drawCrownFxLayer(ctx, { pops: this.fx.pops, rings: this.fx.rings, particles: this.particles });

    // Masa-ortası sanal kontroller (joystick + TACKLE butonu, BaseGame tek kaynak)
    if (this.state === 'PLAYING') {
      this.renderControls(ctx, { players: this.players });
    }

    // Render Floating Texts
    for (const ft of this.floatingTexts) {
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '900 15px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = UI_COLORS.pureBlack;
      ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    this.renderHUD(ctx, {
      guideTitle: 'TACI KAP • 15 SN TUT • 2 RAUND ALAN KAZANIR',
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: CROWN_COLORS,
      playerNames: CROWN_NAMES,
      accent: UI_COLORS.crownRed,
      // Sütun da yakınlık hesabına girer: rozet onun üstüne gelmesin.
      scoreboardEntities: [...this.players.filter((p) => p.isJoined), this.crown],
      roundBannerTitle: this.roundWinner ? `${this.roundWinner.name} RAUNDU KAZANDI!` : t('crown.round'),
      roundBannerColor: this.roundWinner?.color || UI_COLORS.crownGold,
      roundBannerSub: t('crown.round'),
      matchOverHeadline: this.matchDraw ? t('game.draw') : (t('crown.champ') || 'ŞAMPİYON'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .map((p) => ({ color: p.color, name: p.name, value: `${this.scores[p.index]}★`, score: this.scores[p.index] })),
      onRestart: () => this.startNewMatch(),
      customControls: (c) => {
        const { cx, cy, width, height } = this.arena;
        const mapBtnW = Math.min(460, width * 0.8);
        const mapBtnH = 38;
        const mapBtnX = cx - mapBtnW / 2;
        const mapBtnY = cy - height * 0.14;

        c.save();
        c.fillStyle = UI_COLORS.inkDark;
        c.fillRect(mapBtnX + 3, mapBtnY + 3, mapBtnW, mapBtnH);
        c.fillStyle = UI_COLORS.white;
        c.fillRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);
        c.strokeStyle = UI_COLORS.lineDark;
        c.lineWidth = Math.max(1.5, 2.5 * (this.arena?.unit ?? 1));
        c.strokeRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);

        c.fillStyle = UI_COLORS.inkDark;
        c.font = '800 12px "JetBrains Mono", monospace';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(`${CROWN_MAP_PRESETS[this.selectedMapIndex].name} ▾`, cx, mapBtnY + mapBtnH / 2);
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


  onTouchStart(touch) {
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
    }

    // MATCH_OVER: kartın DIŞINDA dokunma = yeniden başlat (ortak kısayol).
    // Ölçülen kusur: bu dallar yalnız `handleUiTap` çalıştırıp geçiyordu,
    // yani maç sonunda ekrana dokunmak HİÇBİR ŞEY yapmıyordu — oyuncu
    // 'tekrar oynayalım' diyebilmek için yol yoktu. `matchOverRestartTap`
    // kartın içine dokunmayı yutar (yanlışlıkla yeniden başlatmayı önler).
    if (this.state === 'MATCH_OVER') {
      matchOverRestartTap(this, touch, { onRestart: () => this.startNewMatch() });
      return;
    }

    if (this.handleRoundOverSkip()) return;

    if (this.state === 'LOBBY') {
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch);
      return;
    }

    if (this.state === 'PLAYING') {
      this.handleTabletopTouchStart(touch);
    }
  }

  createWorldPacket(now = performance.now()) {
    if (this._cachedWorldPacket && now - this._lastWorldPacketTime < 33.3) {
      return this._cachedWorldPacket;
    }
    this._cachedWorldPacket = createCrownWorldPacket(this);
    this._lastWorldPacketTime = now;
    return this._cachedWorldPacket;
  }

  handleRemoteInput(slotIndex, data) {
    this.handleStandardRemoteJoystick(slotIndex, data, (slot, d) => {
      if (matchesInputAction(d, 'tackle', 'TACKLE')) {
        this.triggerTackle(slot);
      }
    });
  }
}
