// BRUTAL CROWN (Game 07): 2-4 Player High-Contact Crown Brawler
// Full-arena brutalist layout, moving patrol pistons, conveyor belts (yürüyen zeminler),
// banana peel slip traps 🍌, turbo pickups ⚡, heavy crown physics (-34% speed), 0.85s stun & zero screen-shake.

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
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderTopPill, renderCornerScores } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCrownBotAI } from '../ai/crownAI.js';

export const CROWN_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const CROWN_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

export const CROWN_MAP_PRESETS = [
  { id: 'citadel_patrol', name: '01 // 🏰 SARAY AVCILARI (SİPERLER, PİSTONLAR & MANTARLAR)' },
  { id: 'conveyors', name: '02 // 🌀 KONVEYÖR HIZ YOLU (AKAN BANTLAR & HIZ PEDLERİ)' },
  { id: 'banana_maze', name: '03 // 🍌 MUZ VE DİKEN LABİRENTİ (KORİDORLAR & 4 MANTAR)' },
  { id: 'moving_citadel', name: '04 // ⚡ MERKEZ KALE (4 KAPILI SIĞINAK & KANAT PİSTONLARI)' },
  { id: 'chaos_flipper', name: '05 // 💥 KAOS FIRLATICI (6 YAYLI MANTAR & ÇAPRAZ BANTLAR)' },
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
    this.targetCrownTime = 15.0; // 15 seconds holding the crown to win a round

    // Entities
    this.players = [];
    this.crown = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 20,
      carrierIndex: null,
      pickupCooldown: 0,
      floatAnim: 0,
    };

    this.particles = [];
    this.floatingTexts = [];

    // UI Buttons
    this.uiButtons = [];
    this.tackleButtons = [];

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

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      this.keys[e.key] = true;
      if (e.key) this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code] = true;

      // Tackle shortcuts
      if (this.state === 'PLAYING') {
        if (e.code === 'Space' || e.code === 'KeyE' || e.key === 'e' || e.key === 'E' || e.code === 'ShiftLeft') {
          this.triggerTackle(0);
        }
        if (e.code === 'Enter' || e.code === 'Numpad0' || e.code === 'ControlRight') {
          this.triggerTackle(1);
        }
        if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') {
          this.triggerTackle(2);
        }
        if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') {
          this.triggerTackle(3);
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
      if (e.key) this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code] = false;
    });

    // P1 mouse click fallback for solo PC testing
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state === 'PLAYING') {
        const rect = this.canvas.getBoundingClientRect();
        const clickX = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
        const clickY = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
        for (const tBtn of this.tackleButtons) {
          if (
            clickX >= tBtn.x - tBtn.w / 2 &&
            clickX <= tBtn.x + tBtn.w / 2 &&
            clickY >= tBtn.y - tBtn.h / 2 &&
            clickY <= tBtn.y + tBtn.h / 2
          ) {
            this.triggerTackle(tBtn.playerIndex);
            return;
          }
        }
        if (this.players[0]?.slotType === 'human' && this.players[0]?.isJoined) {
          this.triggerTackle(0);
        }
      }
    });
  }

  // Standart slot döngüsü (diğer motorlarla aynı): BOŞ -> İNSAN -> BOT -> GOD -> BOŞ
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
    playJoin();
  }

  cycleMap() {
    this.selectedMapIndex = (this.selectedMapIndex + 1) % CROWN_MAP_PRESETS.length;
    this.buildMap();
    playJoin();
  }

  resize(width, height) {
    const oldArena = { ...this.arena };
    const marginX = Math.max(16, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(34, Math.floor(height * 0.065));
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

    this.buildMap();
    // Maç ortası resize raundu sıfırlamasın (harita geometrisi yenilenir,
    // taç/oyuncular orantılı taşınır)
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
    } else {
      for (const p of this.players) {
        this.remapPoint(p, oldArena, this.arena);
        p.vx = 0; p.vy = 0;
      }
      if (this.crown && this.crown.carrierIndex !== null && this.crown.carrierIndex !== undefined) {
        const carrier = this.players[this.crown.carrierIndex];
        if (carrier) { this.crown.x = carrier.x; this.crown.y = carrier.y; }
      } else if (this.crown) {
        this.remapPoint(this.crown, oldArena, this.arena);
        this.crown.vx = 0; this.crown.vy = 0;
      }
      for (const item of this.pickups) this.remapPoint(item, oldArena, this.arena);
      for (const ink of this.inkPuddles) this.remapPoint(ink, oldArena, this.arena);
      this.particles = [];
    }

    // Setup Tackle Buttons for Tabletop Mobile
    const btnSize = Math.max(52, Math.min(74, Math.round(size * 0.14)));
    const pad = 12;
    this.tackleButtons = [
      { playerIndex: 0, x: this.arena.left + pad + btnSize / 2, y: this.arena.bottom - pad - btnSize / 2, w: btnSize, h: btnSize },
      { playerIndex: 1, x: this.arena.left + pad + btnSize / 2, y: this.arena.top + pad + btnSize / 2, w: btnSize, h: btnSize },
      { playerIndex: 2, x: this.arena.right - pad - btnSize / 2, y: this.arena.top + pad + btnSize / 2, w: btnSize, h: btnSize },
      { playerIndex: 3, x: this.arena.right - pad - btnSize / 2, y: this.arena.bottom - pad - btnSize / 2, w: btnSize, h: btnSize },
    ];
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
        { x: cx - width * 0.12, y: cy, radius: 25, pulse: 0 },
        { x: cx + width * 0.12, y: cy, radius: 25, pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx, y: cy - height * 0.13, radius: 14 },
        { x: cx, y: cy + height * 0.13, radius: 14 },
      ];
    } else if (this.selectedMapIndex === 1) {
      // --- MAP 1: 🌀 KONVEYÖR HIZ YOLU (Akan Bantlar & Hız Pedleri) ---
      const cW = Math.round(width * 0.64);
      const cH = Math.round(height * 0.085);

      // Top conveyor flings East (▶), Bottom conveyor flings West (◀)
      this.conveyors = [
        { x: cx - cW / 2, y: cy - height * 0.24 - cH / 2, w: cW, h: cH, dirX: 1, dirY: 0, speed: 180, animOffset: 0 },
        { x: cx - cW / 2, y: cy + height * 0.24 - cH / 2, w: cW, h: cH, dirX: -1, dirY: 0, speed: 180, animOffset: 0 },
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
        { x: cx - width * 0.38, y: cy, radius: 24, pulse: 0 },
        { x: cx + width * 0.38, y: cy, radius: 24, pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx + width * 0.31, y: cy - height * 0.24, radius: 14 },
        { x: cx - width * 0.31, y: cy + height * 0.24, radius: 14 },
        { x: cx, y: cy, radius: 14 },
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
        { x: cx, y: cy - height * 0.20, radius: 24, pulse: 0 },
        { x: cx, y: cy + height * 0.20, radius: 24, pulse: 0 },
        { x: cx - width * 0.10, y: cy, radius: 24, pulse: 0 },
        { x: cx + width * 0.10, y: cy, radius: 24, pulse: 0 },
      ];

      // 1 Center Vertically Moving Piston
      this.movingHazards = [
        {
          axis: 'y',
          x: cx,
          y: cy,
          radius: 26,
          minPos: cy - height * 0.28,
          maxPos: cy + height * 0.28,
          pos: 0,
          speed: 1.7,
          pulse: 0,
        },
      ];

      this.bananaPeels = [
        { x: cx - width * 0.32, y: cy - height * 0.18, radius: 14 },
        { x: cx + width * 0.32, y: cy - height * 0.18, radius: 14 },
        { x: cx - width * 0.32, y: cy + height * 0.18, radius: 14 },
        { x: cx + width * 0.32, y: cy + height * 0.18, radius: 14 },
        { x: cx, y: cy - height * 0.33, radius: 14 },
        { x: cx, y: cy + height * 0.33, radius: 14 },
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
          radius: 26,
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
          radius: 26,
          minPos: cy - height * 0.25,
          maxPos: cy + height * 0.25,
          pos: Math.PI,
          speed: 2.0,
          pulse: 0,
        },
      ];

      // 2 Bouncy Bumpers guarding north & south bunker doorways
      this.bumpers = [
        { x: cx, y: cy - height * 0.27, radius: 24, pulse: 0 },
        { x: cx, y: cy + height * 0.27, radius: 24, pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx - width * 0.05, y: cy, radius: 14 },
        { x: cx + width * 0.05, y: cy, radius: 14 },
      ];
    } else if (this.selectedMapIndex === 4) {
      // --- MAP 4: 💥 KAOS FIRLATICI (6 Yaylı Mantar & 4 Çapraz Bant) ---
      const cW = Math.round(width * 0.24);
      const cH = Math.round(height * 0.08);

      // 4 Cross-directional conveyor belts in the 4 quadrants
      this.conveyors = [
        { x: cx - width * 0.28 - cW / 2, y: cy - height * 0.22 - cH / 2, w: cW, h: cH, dirX: 0, dirY: -1, speed: 170, animOffset: 0 },
        { x: cx + width * 0.28 - cW / 2, y: cy - height * 0.22 - cH / 2, w: cW, h: cH, dirX: 1, dirY: 0, speed: 170, animOffset: 0 },
        { x: cx - width * 0.28 - cW / 2, y: cy + height * 0.22 - cH / 2, w: cW, h: cH, dirX: -1, dirY: 0, speed: 170, animOffset: 0 },
        { x: cx + width * 0.28 - cW / 2, y: cy + height * 0.22 - cH / 2, w: cW, h: cH, dirX: 0, dirY: 1, speed: 170, animOffset: 0 },
      ];

      // 6 Bouncy Pinball Bumpers
      this.bumpers = [
        { x: cx - width * 0.12, y: cy, radius: 26, pulse: 0 },
        { x: cx + width * 0.12, y: cy, radius: 26, pulse: 0 },
        { x: cx, y: cy - height * 0.30, radius: 24, pulse: 0 },
        { x: cx, y: cy + height * 0.30, radius: 24, pulse: 0 },
        { x: cx - width * 0.36, y: cy, radius: 24, pulse: 0 },
        { x: cx + width * 0.36, y: cy, radius: 24, pulse: 0 },
      ];

      this.bananaPeels = [
        { x: cx, y: cy - height * 0.14, radius: 14 },
        { x: cx, y: cy + height * 0.14, radius: 14 },
        { x: cx - width * 0.20, y: cy, radius: 14 },
        { x: cx + width * 0.20, y: cy, radius: 14 },
      ];
    }
  }

  initPlayers() {
    const { cx, cy, width, height } = this.arena;
    const spawnOffX = width * 0.38;
    const spawnOffY = height * 0.36;
    const r = Math.max(16, Math.round(Math.min(width, height) * 0.045));

    // 4 Corner Spawns: BL (P1), TL (P2), TR (P3), BR (P4)
    const spawns = [
      { x: cx - spawnOffX, y: cy + spawnOffY },
      { x: cx - spawnOffX, y: cy - spawnOffY },
      { x: cx + spawnOffX, y: cy - spawnOffY },
      { x: cx + spawnOffX, y: cy + spawnOffY },
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      return {
        index: i,
        x: s.x,
        y: s.y,
        vx: 0,
        vy: 0,
        radius: r,
        color: CROWN_COLORS[i],
        name: existing?.name || CROWN_NAMES[i],
        isJoined: this.isSlotJoined(i),
        isAlive: true,
        slotType: this.slotTypes[i],
        facingAngle: 0,
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
      };
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
    this.particles = [];
    this.floatingTexts = [];
    this.trauma = 0;
    this.lastTime = performance.now();
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
    this.particles = [];
    this.floatingTexts = [];
    this.pickupTimer = 4.0;

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

    const tackleSpeed = 480;
    player.tackleVx = dirX * tackleSpeed;
    player.tackleVy = dirY * tackleSpeed;
    player.vx = player.tackleVx;
    player.vy = player.tackleVy;

    playDashWhoosh();

    for (let i = 0; i < 8; i++) {
      this.particles.push({
        x: player.x + (Math.random() - 0.5) * 16,
        y: player.y + (Math.random() - 0.5) * 16,
        vx: -dirX * (60 + Math.random() * 40),
        vy: -dirY * (60 + Math.random() * 40),
        color: player.color,
        size: 5 + Math.random() * 4,
        life: 0.25,
      });
    }
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
    for (let k = 0; k < 14; k++) {
      this.particles.push({
        x: this.crown.x,
        y: this.crown.y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.5) * 260,
        color: '#FFDE59',
        size: 4 + Math.random() * 5,
        life: 0.45,
      });
    }
  }

  addFloatingText(x, y, text, color = '#1A1A1A') {
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
    const { left, top, width, height } = this.arena;
    const types = ['TURBO', 'TELEPORT', 'SLIP'];
    const type = types[Math.floor(Math.random() * types.length)];
    const px = left + width * 0.15 + Math.random() * (width * 0.7);
    const py = top + height * 0.15 + Math.random() * (height * 0.7);

    for (const pil of this.pillars) {
      if (px >= pil.x - 20 && px <= pil.x + pil.w + 20 && py >= pil.y - 20 && py <= pil.y + pil.h + 20) {
        return;
      }
    }

    this.pickups.push({ x: px, y: py, type, radius: 15, animTime: 0 });
  }

  update(now) {
    const dt = Math.min(0.064, (now - this.lastTime) / 1000);
    this.lastTime = now;

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) {
        this.startNewRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

    // Tek katılımcı kalınca taç süresi beklenmez — kalan raundu alır
    {
      const joined = this.players.filter((p) => p.isJoined);
      if (joined.length <= 1) {
        if (joined.length === 1) {
          const survivor = joined[0];
          this.roundWinner = survivor;
          this.scores[survivor.index]++;
          playCashRegister();
          this.addFloatingText(this.arena.cx, this.arena.cy, `👑 ${survivor.name} RAUNDU KAZANDI!`, survivor.color);
          if (this.scores[survivor.index] >= this.targetScore) {
            this.state = 'MATCH_OVER';
            this.matchWinner = survivor;
            return;
          }
        } else {
          this.roundWinner = null;
        }
        this.state = 'ROUND_OVER';
        this.roundTransitionTimer = 2.8;
        return;
      }
    }

    const { left, right, top, bottom, cx, cy } = this.arena;

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

        if (Math.random() < 0.35) {
          this.particles.push({
            x: king.x + (Math.random() - 0.5) * king.radius * 2,
            y: king.y + (Math.random() - 0.5) * king.radius * 2,
            vx: (Math.random() - 0.5) * 30,
            vy: -20 - Math.random() * 40,
            color: '#FFDE59',
            size: 3 + Math.random() * 4,
            life: 0.35,
          });
        }

        if (king.crownHoldTime >= this.targetCrownTime) {
          this.roundWinner = king;
          this.scores[king.index]++;
          playPiggyBreak();
          playCashRegister();
          this.addFloatingText(cx, cy, `👑 ${king.name} RAUNDU KAZANDI!`, king.color);

          if (this.scores[king.index] >= this.targetScore) {
            this.state = 'MATCH_OVER';
            this.matchWinner = king;
            return;
          } else {
            this.state = 'ROUND_OVER';
            this.roundTransitionTimer = 2.8;
            return;
          }
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
      this.crown.vx *= 0.94;
      this.crown.vy *= 0.94;

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

    // --- Update Bumpers Pulse Decay ---
    for (const b of this.bumpers) {
      if (b.pulse > 0) b.pulse = Math.max(0, b.pulse - dt * 3.5);
      if (b.hitCool > 0) b.hitCool -= dt;
    }

    // --- Bariyer yavaşlatma bayrağı her frame sıfırlanır ---
    if (this.rubCool > 0) this.rubCool -= dt;

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

        if (p.index === 0) {
          if (this.keys['KeyA'] || this.keys['a']) inX -= 1;
          if (this.keys['KeyD'] || this.keys['d']) inX += 1;
          if (this.keys['KeyW'] || this.keys['w']) inY -= 1;
          if (this.keys['KeyS'] || this.keys['s']) inY += 1;
        } else if (p.index === 1) {
          if (this.keys['ArrowLeft']) inX -= 1;
          if (this.keys['ArrowRight']) inX += 1;
          if (this.keys['ArrowUp']) inY -= 1;
          if (this.keys['ArrowDown']) inY += 1;
        } else if (p.index === 2) {
          if (this.keys['KeyJ'] || this.keys['j']) inX -= 1;
          if (this.keys['KeyL'] || this.keys['l']) inX += 1;
          if (this.keys['KeyI'] || this.keys['i']) inY -= 1;
          if (this.keys['KeyK'] || this.keys['k']) inY += 1;
        } else if (p.index === 3) {
          if (this.keys['KeyF'] || this.keys['f']) inX -= 1;
          if (this.keys['KeyH'] || this.keys['h']) inX += 1;
          if (this.keys['KeyT'] || this.keys['t']) inY -= 1;
          if (this.keys['KeyG'] || this.keys['g']) inY += 1;
        }
      } else {
        updateCrownBotAI(this, p, dt);
        inX = p.inputX;
        inY = p.inputY;
      }

      // Heavy crown handicap: 165 px/s vs 250 px/s
      let speed = p.hasCrown ? 165 : 250;
      if (p.turboTimer > 0) speed = 340;
      if (p.inSlow) speed *= 0.55; // bariyer yavaşlatma alanı

      const inLen = Math.hypot(inX, inY);
      if (p.slipTimer > 0) {
        p.vx *= 0.97;
        p.vy *= 0.97;
      } else if (p.stumbleTimer > 0) {
        // Sersemlikte savrulma korunur (uçuş hissi): hız ezilmez, sadece süzülür
        const damp = Math.max(0, 1 - 2.2 * dt);
        p.vx *= damp;
        p.vy *= damp;
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
            p.vx *= 0.82;
            p.vy *= 0.82;
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
          }

          for (let k = 0; k < 6; k++) {
            this.particles.push({
              x: h.x + nx * h.radius,
              y: h.y + ny * h.radius,
              vx: (nx + (Math.random() - 0.5) * 0.8) * 120,
              vy: (ny + (Math.random() - 0.5) * 0.8) * 120,
              color: '#FFDE59',
              size: 4 + Math.random() * 4,
              life: 0.25,
            });
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
          }

          for (let k = 0; k < 7; k++) {
            this.particles.push({
              x: b.x + nx * b.radius,
              y: b.y + ny * b.radius,
              vx: (nx + (Math.random() - 0.5) * 0.8) * 130,
              vy: (ny + (Math.random() - 0.5) * 0.8) * 130,
              color: '#FFDE59',
              size: 4 + Math.random() * 4,
              life: 0.25,
            });
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
            this.addFloatingText(p.x, p.y - 20, '⚡ TURBO!', '#F59E0B');
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
          this.addFloatingText(p.x, p.y - 25, '🍌 KAYDI!', '#FFDE59');

          for (let k = 0; k < 8; k++) {
            this.particles.push({
              x: b.x,
              y: b.y,
              vx: (Math.random() - 0.5) * 120,
              vy: (Math.random() - 0.5) * 120,
              color: '#FFDE59',
              size: 4 + Math.random() * 3,
              life: 0.35,
            });
          }

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
          if (pk.type === 'TURBO') {
            p.turboTimer = 3.5;
            this.addFloatingText(p.x, p.y - 25, '⚡ TURBO!', '#D99B26');
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
            this.addFloatingText(p.x, p.y - 25, '🌀 KAÇIŞ!', '#48CAE4');
          } else if (pk.type === 'SLIP') {
            this.inkPuddles.push({ x: p.x, y: p.y, radius: 22, duration: 10.0 });
            this.addFloatingText(p.x, p.y - 25, '🍌 TUZAK!', '#FFDE59');
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
          playCashRegister();
          this.addFloatingText(p.x, p.y - 30, '👑 KRAL OLDU!', p.color);

          for (let k = 0; k < 16; k++) {
            this.particles.push({
              x: p.x,
              y: p.y,
              vx: (Math.random() - 0.5) * 140,
              vy: (Math.random() - 0.5) * 140,
              color: '#FFDE59',
              size: 5 + Math.random() * 5,
              life: 0.4,
            });
          }
        }
      }
    }

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
              playHeavyImpact();
            } else if (tackler && target) {
              tackler.isTackling = false;

              if (target.hasCrown) {
                target.hasCrown = false;
                this.crown.carrierIndex = null;
                // 1s sersem ve yerden alma kilidi
                this.crown.pickupCooldown = 1.0;
                target.stumbleTimer = 1.0;
                this.scatterCrown();

                target.vx = (tackler === p1 ? nx : -nx) * 380;
                target.vy = (tackler === p1 ? ny : -ny) * 380;

                playHeavyImpact();
                playStumble();
                this.addFloatingText(target.x, target.y - 30, '💥 TAÇ DÜŞTÜ!', '#FFDE59');

                for (let k = 0; k < 32; k++) {
                  this.particles.push({
                    x: target.x,
                    y: target.y,
                    vx: (Math.random() - 0.5) * 240,
                    vy: (Math.random() - 0.5) * 240,
                    color: Math.random() < 0.6 ? '#FFDE59' : tackler.color,
                    size: 4 + Math.random() * 6,
                    life: 0.5,
                  });
                }
              } else {
                target.vx = (tackler === p1 ? nx : -nx) * 340;
                target.vy = (tackler === p1 ? ny : -ny) * 340;
                target.stumbleTimer = 1.0;
                tackler.vx = -(tackler === p1 ? nx : -nx) * 120;
                tackler.vy = -(tackler === p1 ? ny : -ny) * 120;
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
                this.crown.carrierIndex = null;
                this.crown.pickupCooldown = 1.0;
                crowned.stumbleTimer = Math.max(crowned.stumbleTimer, 1.0);
                this.scatterCrown();
                playStumble();
                this.addFloatingText(crowned.x, crowned.y - 30, '👑 TAÇ BOŞTA!', '#FFDE59');
              }
            }
        }
      }
    }

    // --- 7. Update Floating Texts & Particles ---
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= dt * 30;
      ft.life -= dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.life -= dt;
      if (part.life <= 0) this.particles.splice(i, 1);
    }
  }

  // --- Render Loop (ZERO CAMERA SHAKE!) ---
  render() {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const { left, top, right, bottom, width: aW, height: aH } = this.arena;

    ctx.save();
    // Warm brutalist paper background
    ctx.fillStyle = '#F4F0EA';
    ctx.fillRect(0, 0, width, height);

    // Arena Floor
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, aW, aH);

    // 4 Köşede Standart Yüksek Görünürlüklü Oyuncu Skorları
    if (this.state === 'PLAYING') {
      renderCornerScores(ctx, {
        arena: this.arena,
        entries: this.players.map((p, i) =>
          p.isJoined ? { color: p.color, text: `${this.scores[i] || 0}★` } : null
        ),
      });
    }

    // Subtle Arena Grid
    ctx.strokeStyle = '#E5DFD5';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + aW * 0.12, top + aH * 0.12, aW * 0.76, aH * 0.76);

    // Arena Cast-Iron Border & Drop Shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(right, top + 6, 6, aH);
    ctx.fillRect(left + 6, bottom, aW, 6);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(left, top, aW, aH);

    // 0. Render Speed Boost Pads
    for (const sp of this.speedPads) {
      this.renderSpeedPad(ctx, sp);
    }

    // 1. Render Conveyor Belts (Akan Yürüyen Zeminler)
    this.renderConveyors(ctx);

    // 2. Render Moving Hazard Rails
    for (const h of this.movingHazards) {
      this.renderMovingHazardTrack(ctx, h);
    }

    // 3. Render Pillars
    for (const pil of this.pillars) {
      this.renderPillar(ctx, pil);
    }

    // 3.5. Render Bouncy Pinball Bumpers (Yaylı Mantarlar)
    for (const b of this.bumpers) {
      this.renderBumper(ctx, b);
    }

    // 4. Render Moving Hazards
    for (const h of this.movingHazards) {
      this.renderMovingHazard(ctx, h);
    }

    // 5. Render Banana Peels 🍌
    for (const b of this.bananaPeels) {
      this.renderBananaPeel(ctx, b);
    }

    // 5.5. Render Ink Puddles (SLIP tuzağı)
    for (const ink of this.inkPuddles) {
      this.renderInkPuddle(ctx, ink);
    }

    // 6. Render Pickups (Turbo ⚡)
    for (const pk of this.pickups) {
      this.renderPickup(ctx, pk);
    }

    // 7. Render Particles
    for (const p of this.particles) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    // 8. Render Loose Crown
    if (this.crown.carrierIndex === null) {
      this.renderCrown(ctx, this.crown.x, this.crown.y, 1.0, true);
    }

    // 9. Render Players
    for (const p of this.players) {
      if (!p.isJoined || !p.isAlive) continue;
      this.renderPlayer(ctx, p);
    }

    // 10. Render Crown on Player
    if (this.crown.carrierIndex !== null) {
      const king = this.players[this.crown.carrierIndex];
      if (king && king.isAlive) {
        this.renderCrown(ctx, this.crown.x, this.crown.y, 0.85, false);
      }
    }

    // 11. Render Touch Virtual Joysticks & Tackle Buttons
    if (this.state === 'PLAYING') {
      this.renderTouchControls(ctx);
    }

    // 12. Render Floating Texts
    for (const ft of this.floatingTexts) {
      const alpha = Math.max(0, ft.life / ft.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '900 15px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000000';
      ctx.fillText(ft.text, ft.x + 2, ft.y + 2);
      ctx.fillStyle = ft.color;
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    // 13. Render HUD & Control Guide
    this.renderHUD(ctx);

    // 14. Render Lobby Overlay if LOBBY
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'TACI KAP • 15 SN TUT • 2 RAUND ALAN KAZANIR', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobby(ctx);
    }

    // 15. Render Round / Match Over Overlay
    if (this.state === 'ROUND_OVER' || this.state === 'MATCH_OVER') {
      this.renderGameOver(ctx);
    }

    ctx.restore();
  }

  renderSpeedPad(ctx, sp) {
    ctx.save();
    // Drop shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(sp.x + 3, sp.y + 3, sp.w, sp.h);

    // Pad body
    ctx.fillStyle = '#262624';
    ctx.fillRect(sp.x, sp.y, sp.w, sp.h);
    ctx.strokeStyle = '#D99B26';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(sp.x, sp.y, sp.w, sp.h);

    // Animated chevrons
    ctx.fillStyle = '#FFDE59';
    ctx.font = '900 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const chevron = sp.dirX > 0 ? '▶▶' : (sp.dirX < 0 ? '◀◀' : (sp.dirY > 0 ? '▼▼' : '▲▲'));
    ctx.fillText(chevron, sp.x + sp.w / 2, sp.y + sp.h / 2);
    ctx.restore();
  }

  renderBumper(ctx, b) {
    ctx.save();
    const r = b.radius;

    // Drop shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.arc(b.x + 3, b.y + 4, r, 0, Math.PI * 2);
    ctx.fill();

    // Outer rim
    ctx.fillStyle = b.pulse > 0.1 ? '#FFFFFF' : '#D84727';
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Inner spring dome
    ctx.fillStyle = b.pulse > 0.1 ? '#FFDE59' : '#F59E0B';
    ctx.beginPath();
    ctx.arc(b.x, b.y, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Star icon
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '900 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⭐', b.x, b.y);

    // Expanding shockwave ring when pulsed
    if (b.pulse > 0.1) {
      ctx.strokeStyle = `rgba(255, 222, 89, ${b.pulse})`;
      ctx.lineWidth = 3 * b.pulse;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + (1 - b.pulse) * 16, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
  }

  renderConveyors(ctx) {
    for (const c of this.conveyors) {
      ctx.save();
      // Drop shadow
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(c.x + 3, c.y + 3, c.w, c.h);

      // Belt bed
      ctx.fillStyle = '#262624';
      ctx.fillRect(c.x, c.y, c.w, c.h);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(c.x, c.y, c.w, c.h);

      // Animated chevron arrows
      ctx.save();
      ctx.beginPath();
      ctx.rect(c.x, c.y, c.w, c.h);
      ctx.clip();

      ctx.fillStyle = '#D99B26';
      ctx.font = '900 13px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const spacing = 42;
      const arrowChar = c.dirX > 0 ? '▶' : (c.dirX < 0 ? '◀' : (c.dirY > 0 ? '▼' : '▲'));
      if (c.dirX !== 0) {
        const offset = ((c.animOffset || 0) * (c.dirX > 0 ? 1 : -1)) % spacing;
        const startX = c.x + offset - spacing;
        for (let x = startX; x < c.x + c.w + spacing; x += spacing) {
          ctx.fillText(arrowChar, x, c.y + c.h / 2);
        }
      } else {
        const offset = ((c.animOffset || 0) * (c.dirY > 0 ? 1 : -1)) % spacing;
        const startY = c.y + offset - spacing;
        for (let y = startY; y < c.y + c.h + spacing; y += spacing) {
          ctx.fillText(arrowChar, c.x + c.w / 2, y);
        }
      }
      ctx.restore();

      ctx.restore();
    }
  }

  renderMovingHazardTrack(ctx, h) {
    ctx.save();
    ctx.strokeStyle = '#E0DAD0';
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (h.axis === 'x') {
      ctx.moveTo(h.minPos, h.y);
      ctx.lineTo(h.maxPos, h.y);
    } else {
      ctx.moveTo(h.x, h.minPos);
      ctx.lineTo(h.x, h.maxPos);
    }
    ctx.stroke();

    // Center groove slot
    ctx.strokeStyle = '#8A857C';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    ctx.stroke();
    ctx.restore();
  }

  renderPillar(ctx, pil) {
    ctx.save();
    // Yavaşlatma alanı halesi (yeşil soluk)
    ctx.fillStyle = 'rgba(47, 106, 79, 0.16)';
    ctx.fillRect(pil.x - 8, pil.y - 8, pil.w + 16, pil.h + 16);

    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(pil.x + 5, pil.y + 5, pil.w, pil.h);

    ctx.fillStyle = '#2B2B28';
    ctx.fillRect(pil.x, pil.y, pil.w, pil.h);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(pil.x, pil.y, pil.w, pil.h);

    ctx.strokeStyle = '#4A4A45';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pil.x + 4, pil.y + 4);
    ctx.lineTo(pil.x + pil.w - 4, pil.y + pil.h - 4);
    ctx.moveTo(pil.x + pil.w - 4, pil.y + 4);
    ctx.lineTo(pil.x + 4, pil.y + pil.h - 4);
    ctx.stroke();
    ctx.restore();
  }

  renderMovingHazard(ctx, h) {
    ctx.save();
    const r = h.radius;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.arc(h.x + 4, h.y + 4, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = h.pulse > 0.1 ? '#FFFFFF' : '#D99B26';
    ctx.beginPath();
    ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(h.x, h.y, r * 0.58, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#FFDE59';
    ctx.font = '900 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', h.x, h.y);

    ctx.restore();
  }

  renderBananaPeel(ctx, b) {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(b.x + 2, b.y + 4, 14, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🍌', b.x, b.y);
    ctx.restore();
  }

  renderPickup(ctx, pk) {
    ctx.save();
    const pulse = 1 + Math.sin((pk.animTime || 0) * 6) * 0.08;
    ctx.translate(pk.x, pk.y);
    ctx.scale(pulse, pulse);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(3, 3, pk.radius, 0, Math.PI * 2);
    ctx.fill();

    // Bomba moduyla aynı rozet renkleri
    ctx.fillStyle = pk.type === 'TURBO' ? '#FFDE59' : pk.type === 'TELEPORT' ? '#48CAE4' : '#2D2D2A';
    ctx.beginPath();
    ctx.arc(0, 0, pk.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    ctx.fillStyle = pk.type === 'SLIP' ? '#FFFFFF' : '#1A1A1A';
    ctx.font = '900 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pk.type === 'TURBO' ? '⚡' : pk.type === 'TELEPORT' ? '🌀' : '🍌', 0, 0);
    ctx.restore();
  }

  renderInkPuddle(ctx, ink) {
    ctx.save();
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(ink.x, ink.y, ink.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333330';
    ctx.beginPath();
    ctx.arc(ink.x - 6, ink.y - 4, ink.radius * 0.4, 0, Math.PI * 2);
    ctx.arc(ink.x + 8, ink.y + 5, ink.radius * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  renderCrown(ctx, x, y, scale = 1.0, isLoose = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    if (isLoose) {
      const pulseR = 26 + Math.sin(this.crown.floatAnim) * 4;
      ctx.strokeStyle = 'rgba(217, 155, 38, 0.45)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 10, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F59E0B';
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(-16, 6);
    ctx.lineTo(-18, -8);
    ctx.lineTo(-8, -2);
    ctx.lineTo(0, -14);
    ctx.lineTo(8, -2);
    ctx.lineTo(18, -8);
    ctx.lineTo(16, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#FFDE59';
    ctx.beginPath();
    ctx.rect(-15, 2, 30, 4);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#D84727';
    ctx.beginPath();
    ctx.arc(0, -7, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2D6A4F';
    ctx.beginPath();
    ctx.arc(-11, -3, 2.5, 0, Math.PI * 2);
    ctx.arc(11, -3, 2.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  renderPlayer(ctx, p) {
    ctx.save();
    const { x, y, radius: r, color, facingAngle } = p;

    if (p.slipTimer > 0) {
      ctx.translate(x, y);
      ctx.rotate(p.slipAngle);
      ctx.translate(-x, -y);
    }

    if (p.stumbleTimer > 0) {
      ctx.save();
      const dazeAngle = performance.now() * 0.008;
      const starR = r + 14;
      ctx.font = '900 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let s = 0; s < 3; s++) {
        const a = dazeAngle + (s * Math.PI * 2) / 3;
        const sx = x + Math.cos(a) * starR;
        const sy = y + Math.sin(a) * (starR * 0.4) - r - 10;
        ctx.fillText('💫', sx, sy);
      }

      ctx.strokeStyle = '#D99B26';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#D99B26';
      ctx.font = '900 13px "JetBrains Mono", monospace';
      ctx.fillText('💥 SERSEM!', x, y - r - 26);
      ctx.restore();
    }

    if (p.hasCrown) {
      ctx.fillStyle = 'rgba(217, 155, 38, 0.2)';
      ctx.beginPath();
      ctx.arc(x, y, r * 1.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#D99B26';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.arc(x + 3, y + 4, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.isTackling ? '#FFFFFF' : '#1A1A1A';
    ctx.lineWidth = p.isTackling ? 4.5 : 3;
    ctx.stroke();

    // Tackle readiness / cooldown ring indicator
    if (p.isAlive) {
      if (p.tackleCooldown > 0) {
        const cdRatio = 1.0 - (p.tackleCooldown / 2.0);
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + cdRatio * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (p.stumbleTimer <= 0 && p.slipTimer <= 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    if (p.hasCrown) {
      const progress = Math.min(1.0, p.crownHoldTime / this.targetCrownTime);
      const remain = Math.max(0, this.targetCrownTime - p.crownHoldTime);
      const urgent = remain <= 5.0;
      // Zemin halka (koyu) + ilerleme (altın, son 5 sn kırmızı) + kocaman geri sayım
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.4)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = urgent ? '#D84727' : '#D99B26';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(x, y, r + 9, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.stroke();
    }

    const eyeX = x + Math.cos(facingAngle) * (r * 0.48);
    const eyeY = y + Math.sin(facingAngle) * (r * 0.48);
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1A1A1A';
    ctx.beginPath();
    ctx.arc(eyeX + Math.cos(facingAngle) * 2, eyeY + Math.sin(facingAngle) * 2, r * 0.14, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1A1A1A';
    ctx.font = '900 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`P${p.index + 1}`, x, y + r + 5);

    ctx.restore();
  }

  renderTouchControls(ctx) {
    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      const p = this.players[q];
      if (p && p.isJoined && p.slotType === 'human' && joy.active) {
        ctx.save();
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(joy.originX, joy.originY, 46, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(joy.currX, joy.currY, 20, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    for (const btn of this.tackleButtons) {
      const p = this.players[btn.playerIndex];
      if (!p || !p.isJoined || p.slotType !== 'human') continue;

      ctx.save();
      const isReady = p.tackleCooldown <= 0;
      ctx.fillStyle = isReady ? p.color : '#A5A096';
      ctx.fillRect(btn.x - btn.w / 2, btn.y - btn.h / 2, btn.w, btn.h);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 3;
      ctx.strokeRect(btn.x - btn.w / 2, btn.y - btn.h / 2, btn.w, btn.h);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 11px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (isReady) {
        ctx.fillText('💥 OMUZ', btn.x, btn.y - 6);
        ctx.font = '800 9px "JetBrains Mono", monospace';
        ctx.fillText('HAZIR', btn.x, btn.y + 8);
      } else {
        ctx.fillText('⏳ BEKLE', btn.x, btn.y - 6);
        ctx.font = '800 9px "JetBrains Mono", monospace';
        ctx.fillText(`${p.tackleCooldown.toFixed(1)}s`, btn.x, btn.y + 8);
      }
      ctx.restore();
    }
  }

  renderHUD(ctx) {
    if (this.state === 'PLAYING') {
      const king = this.crown.carrierIndex !== null ? this.players[this.crown.carrierIndex] : null;
      if (king && king.isAlive) {
        const remain = Math.max(0, this.targetCrownTime - king.crownHoldTime);
        renderTopPill(ctx, {
          arena: this.arena,
          text: `👑 ${remain.toFixed(1)}s`,
          urgent: remain <= 4.0,
        });
      } else {
        renderTopPill(ctx, { arena: this.arena, text: '👑 TACI KAP' });
      }
    }
  }

  renderLobby(ctx) {
    const { cx, cy, left, right, top, bottom, width, height } = this.arena;
    this.uiButtons = [];

    ctx.save();
    ctx.fillStyle = 'rgba(250, 247, 242, 0.78)';
    ctx.fillRect(left, top, width, height);

    ctx.fillStyle = '#1A1A1A';
    ctx.font = '900 32px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑 BRUTAL CROWN', cx, cy - height * 0.28);

    ctx.fillStyle = '#75726B';
    ctx.font = '700 13px "Space Grotesk", sans-serif';
    ctx.fillText('TACI KAP, MUZLARDAN KAÇ, 15 SANİYE TUT VE KAZAN!', cx, cy - height * 0.28 + 28);

    const mapBtnW = Math.min(460, width * 0.8);
    const mapBtnH = 38;
    const mapBtnX = cx - mapBtnW / 2;
    const mapBtnY = cy - height * 0.14;

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);

    ctx.fillStyle = '#1A1A1A';
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🗺️ ${CROWN_MAP_PRESETS[this.selectedMapIndex].name} ▾`, cx, mapBtnY + mapBtnH / 2);

    this.uiButtons.push({
      x: mapBtnX,
      y: mapBtnY,
      w: mapBtnW,
      h: mapBtnH,
      onClick: () => this.cycleMap(),
    });

    // Standart kare koltuklar (4 köşe, tüm oyunlarla aynı ölçü)
    const positions = getStandardSeatRects(this.arena);

    for (let i = 0; i < 4; i++) {
      const pos = positions[i];
      const type = this.slotTypes[i];
      const p = this.players[i];
      const custom = p && p.name && p.name !== CROWN_NAMES[i] ? p.name : '';

      renderLobbySeatCard(ctx, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        slotIndex: i,
        slotType: type,
        playerName: custom,
        playerColor: CROWN_COLORS[i],
        rotation: 0,
      });

      this.uiButtons.push({
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        onClick: () => this.cycleSlotType(i),
      });
    }

    // Standart başlat butonu (harita butonunun altında)
    const joinedCount = this.players.filter((p) => p.isJoined).length;
    renderLobbyStartButton(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      joinedCount,
      accent: '#D84727',
      onStart: () => this.startNewMatch(),
      centerYOffset: 46,
      hidden: !!this.hideLobbyStartButton,
    });

    ctx.restore();
  }

  renderGameOver(ctx) {
    const { cx, cy, width } = this.arena;
    // Lobi butonları finalde ölü olmalı: önce temizle.
    this.uiButtons = [];
    ctx.save();
    const boxW = Math.min(width * 0.8, 440);
    ctx.fillStyle = 'rgba(250, 247, 242, 0.94)';
    ctx.fillRect(cx - boxW / 2, cy - 80, boxW, 160);
    ctx.strokeStyle = '#D99B26';
    ctx.lineWidth = 3.5;
    ctx.strokeRect(cx - boxW / 2, cy - 80, boxW, 160);

    const isMatch = this.state === 'MATCH_OVER';
    const winner = isMatch ? this.matchWinner : this.roundWinner;

    ctx.fillStyle = '#1A1A1A';
    ctx.font = '900 28px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isMatch ? '🏆 TAÇ ŞAMPİYONU!' : '👑 RAUND KAZANILDI!', cx, cy - 24, boxW - 20);

    if (winner) {
      ctx.fillStyle = winner.color;
      ctx.font = '800 20px "JetBrains Mono", monospace';
      ctx.fillText(`${winner.name} KAZANDI!`, cx, cy + 18, boxW - 20);
    }
    ctx.restore();

    // Maç sonu (raund değil): yeni maç butonu. Raund sonu sayaçla ilerler.
    if (isMatch) {
      const btnW = 190;
      const btnH = 46;
      const btnX = cx - btnW / 2;
      const btnY = cy + 80 + 14;

      ctx.save();
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 16px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('YENİDEN OYNA', cx, btnY + btnH / 2);
      ctx.restore();

      this.uiButtons.push({
        x: btnX,
        y: btnY,
        w: btnW,
        h: btnH,
        onClick: () => this.startNewMatch(),
      });
    }
  }

  getCornerQuadrant(point) {
    const { cx, cy } = this.arena;
    if (point.x < cx && point.y >= cy) return 0;
    if (point.x < cx && point.y < cy) return 1;
    if (point.x >= cx && point.y < cy) return 2;
    return 3;
  }

  onTouchStart(touch) {
    for (const btn of this.uiButtons) {
      if (
        touch.x >= btn.x &&
        touch.x <= btn.x + btn.w &&
        touch.y >= btn.y &&
        touch.y <= btn.y + btn.h
      ) {
        btn.onClick?.();
        return;
      }
    }

    if (this.state === 'LOBBY') {
      const q = this.getCornerQuadrant(touch);
      this.cycleSlotType(q);
      return;
    }

    if (this.state === 'PLAYING') {
      for (const tBtn of this.tackleButtons) {
        if (
          touch.x >= tBtn.x - tBtn.w / 2 &&
          touch.x <= tBtn.x + tBtn.w / 2 &&
          touch.y >= tBtn.y - tBtn.h / 2 &&
          touch.y <= tBtn.y + tBtn.h / 2
        ) {
          this.triggerTackle(tBtn.playerIndex);
          return;
        }
      }

      const q = this.getCornerQuadrant(touch);
      const joy = this.joysticks[q];
      const p = this.players[q];

      if (p && p.isJoined && p.slotType === 'human' && !joy.active) {
        const now = performance.now();
        if (p.lastTapTime && now - p.lastTapTime < 300) {
          this.triggerTackle(q);
        }
        p.lastTapTime = now;

        joy.id = touch.id;
        joy.originX = touch.x;
        joy.originY = touch.y;
        joy.currX = touch.x;
        joy.currY = touch.y;
        joy.active = true;
        joy.angle = 0;
        joy.force = 0;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;

    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        const dx = touch.x - joy.originX;
        const dy = touch.y - joy.originY;
        const dist = Math.hypot(dx, dy);
        const maxRadius = 46;

        joy.angle = Math.atan2(dy, dx);
        joy.force = Math.min(1.0, dist / maxRadius);

        if (dist > maxRadius) {
          joy.currX = joy.originX + Math.cos(joy.angle) * maxRadius;
          joy.currY = joy.originY + Math.sin(joy.angle) * maxRadius;
        } else {
          joy.currX = touch.x;
          joy.currY = touch.y;
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        joy.active = false;
        joy.id = -1;
        joy.force = 0;
      }
    }
  }

  onTouchesReset() {
    for (const joy of this.joysticks) {
      joy.active = false;
      joy.id = -1;
      joy.force = 0;
    }
  }

  handleRemoteInput(slotIndex, data) {
    const joy = this.joysticks[slotIndex];
    if (!joy) return;
    const player = this.players?.[slotIndex];
    if (data.action === 'JOYSTICK_MOVE') {
      if (player && (!player.isJoined || !player.isAlive)) return;
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : 0;
      joy.active = force > 0.05;
      joy.angle = Number.isFinite(data.angle) ? data.angle : 0;
      joy.force = force;
    } else if (data.action === 'TACKLE') {
      this.triggerTackle(slotIndex);
    }
  }
}
