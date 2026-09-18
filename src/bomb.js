// BRUTAL BOMB (Game 04): 2-4 Player Local Party Bomb Tag / Saatli Bomba
// 360° Floating Corner Joysticks, Passing Physics, Whiskers & Waypoint Steering, Tackle Dash, 3 Maps & Panic Phase
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
} from './audio.js';
import { renderControlGuide } from './controlGuide.js';

export const BOMB_COLORS = ['#D84727', '#2B5B84', '#D99B26', '#2D6A4F'];
export const BOMB_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

export const MAP_PRESETS = [
  { id: 'pillars', name: '01 // 4 SİPER KOLONU' },
  { id: 'bunker', name: '02 // MERKEZ SIĞINAK' },
  { id: 'cross', name: '03 // HAÇ & KORİDORLAR' },
  { id: 'courtyard', name: '04 // AVLU & DÖNER SİPER' },
  { id: 'split', name: '05 // İKİLİ BLOK BARİKAT' },
];

export class BombGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // States: 'LOBBY', 'PLAYING', 'ROUND_OVER', 'GAME_OVER'
    this.state = 'LOBBY';

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
    this.dashButtons = [];

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
      this.keys[e.key] = true;
      this.keys[e.code] = true;

      // Tackle Dash shortcut triggers
      if (this.state === 'PLAYING') {
        if (e.code === 'Space') this.triggerDash(0);
        if (e.code === 'Enter') this.triggerDash(1);
        if (e.code === 'KeyO' || e.key === 'o' || e.key === 'O') this.triggerDash(2);
        if (e.code === 'KeyB' || e.key === 'b' || e.key === 'B') this.triggerDash(3);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
      this.keys[e.code] = false;
    });
  }

  cycleSlotType(index) {
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
    this.selectedMapIndex = (this.selectedMapIndex + 1) % MAP_PRESETS.length;
    this.buildMapPillars();
    playJoin();
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  resize(width, height) {
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
    this.initPlayers();
  }

  buildMapPillars() {
    const { cx, cy, size } = this.arena;
    if (size <= 0) return;

    this.pillars = [];

    if (this.selectedMapIndex === 0) {
      // --- MAP 0: 4 SİPER KOLONU (Klasik 4 Köşe Kolonu) ---
      const pSize = Math.round(size * 0.125);
      const offset = Math.round(size * 0.22);
      this.pillars = [
        { x: cx - offset - pSize / 2, y: cy - offset - pSize / 2, w: pSize, h: pSize }, // Top-Left
        { x: cx + offset - pSize / 2, y: cy - offset - pSize / 2, w: pSize, h: pSize }, // Top-Right
        { x: cx - offset - pSize / 2, y: cy + offset - pSize / 2, w: pSize, h: pSize }, // Bottom-Left
        { x: cx + offset - pSize / 2, y: cy + offset - pSize / 2, w: pSize, h: pSize }, // Bottom-Right
      ];
    } else if (this.selectedMapIndex === 1) {
      // --- MAP 1: MERKEZ SIĞINAK (Bunker with 4 open doorways) ---
      const bSize = Math.round(size * 0.13);
      const bOffset = Math.round(size * 0.155);
      // 4 bunker corner posts + 2 edge barricades
      this.pillars = [
        { x: cx - bOffset - bSize / 2, y: cy - bOffset - bSize / 2, w: bSize, h: bSize },
        { x: cx + bOffset - bSize / 2, y: cy - bOffset - bSize / 2, w: bSize, h: bSize },
        { x: cx - bOffset - bSize / 2, y: cy + bOffset - bSize / 2, w: bSize, h: bSize },
        { x: cx + bOffset - bSize / 2, y: cy + bOffset - bSize / 2, w: bSize, h: bSize },
        // Outer flank covers
        { x: cx - size * 0.38, y: cy - size * 0.05, w: size * 0.09, h: size * 0.1 },
        { x: cx + size * 0.29, y: cy - size * 0.05, w: size * 0.09, h: size * 0.1 },
      ];
    } else if (this.selectedMapIndex === 2) {
      // --- MAP 2: HAÇ & LABİRENT (Crossfire Corridors) ---
      const thick = Math.round(size * 0.08);
      const len = Math.round(size * 0.23);
      const gap = Math.round(size * 0.15);
      this.pillars = [
        // North & South vertical wings
        { x: cx - thick / 2, y: cy - gap - len, w: thick, h: len },
        { x: cx - thick / 2, y: cy + gap, w: thick, h: len },
        // West & East horizontal wings
        { x: cx - gap - len, y: cy - thick / 2, w: len, h: thick },
        { x: cx + gap, y: cy - thick / 2, w: len, h: thick },
      ];
    } else if (this.selectedMapIndex === 3) {
      // --- MAP 3: AVLU & DÖNER SİPER (Courtyard) ---
      const bW = Math.round(size * 0.28);
      const bH = Math.round(size * 0.07);
      this.pillars = [
        { x: cx - bW / 2, y: cy - size * 0.23 - bH / 2, w: bW, h: bH },
        { x: cx - bW / 2, y: cy + size * 0.23 - bH / 2, w: bW, h: bH },
        { x: cx - size * 0.23 - bH / 2, y: cy - bW / 2, w: bH, h: bW },
        { x: cx + size * 0.23 - bH / 2, y: cy - bW / 2, w: bH, h: bW },
      ];
    } else if (this.selectedMapIndex === 4) {
      // --- MAP 4: İKİLİ BLOK BARİKAT (Split Blocks) ---
      const blkW = Math.round(size * 0.16);
      const blkH = Math.round(size * 0.36);
      this.pillars = [
        { x: cx - size * 0.22 - blkW / 2, y: cy - blkH / 2, w: blkW, h: blkH },
        { x: cx + size * 0.22 - blkW / 2, y: cy - blkH / 2, w: blkW, h: blkH },
      ];
    }
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
      return {
        index: i,
        name: BOMB_NAMES[i],
        color: BOMB_COLORS[i],
        x: s.x,
        y: s.y,
        vx: 0,
        vy: 0,
        radius: r,
        facingAngle: 0,
        speed: 175,
        isAlive: true,
        isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        turboTimer: 0,
        slipTimer: 0,
        slipAngle: 0,
        invulnTimer: 0,
        stepCycle: 0,
        // Dash / Hamle
        dashCooldown: 0,
        dashTimer: 0,
        isDashing: false,
        // Stumble Shock Delay & Escaper Immunity
        stumbleTimer: 0,
        immunityTimer: 0,
        escapeBoostTimer: 0,
        // Anti-Stuck & Navigation Watchdog
        lastX: s.x,
        lastY: s.y,
        stuckAccumulator: 0,
        unstuckDuration: 0,
        unstuckAngle: 0,
        aiMoveX: 0,
        aiMoveY: 0,
        aiForce: 0,
      };
    });
  }

  resetCurrentGame() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
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
    this.startNewRound();
  }

  startNewRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }

    // Auto-rotate map preset every round to keep gameplay varied
    this.selectedMapIndex = (this.selectedMapIndex + 1) % MAP_PRESETS.length;
    this.buildMapPillars();

    this.state = 'PLAYING';
    this.roundWinner = null;
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
    const p = this.players[playerIndex];
    if (!p || !p.isAlive || p.dashCooldown > 0 || p.slipTimer > 0) return;

    p.dashCooldown = 2.2;
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
    this.passCooldown = 1.4; // Solid window before another pass can occur
    this.trauma = 0.4;

    playBombPass();
    playStumble();

    // 1. Stumble Shock Delay on Receiver: heavily stunned/slowed for 0.45s!
    newCarrier.stumbleTimer = 0.45;

    // 2. Escaper Sprint & Immunity on Giver: guarantees head start to flee!
    if (prevCarrier) {
      prevCarrier.escapeBoostTimer = 1.1; // +35% escape sprint
      prevCarrier.immunityTimer = 1.5;    // immune to bomb for 1.5s
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
      if (alive.length === 1) {
        const survivor = alive[0];
        this.roundWinner = survivor;
        this.scores[survivor.index]++;

        if (this.scores[survivor.index] >= this.targetScore) {
          this.state = 'GAME_OVER';
          this.matchWinner = survivor;
          return;
        }
      } else {
        this.roundWinner = null;
      }
      this.state = 'ROUND_OVER';
      this.roundTransitionTimer = 2.4;
    } else {
      // Multiple players still alive: pick survivor for next bomb
      const nextIndex = Math.floor(Math.random() * alive.length);
      this.bombCarrierIndex = alive[nextIndex].index;
      this.bombTimer = Math.max(9.0, 15.0 - (4 - alive.length) * 2.0);
      this.bombMaxTime = this.bombTimer;
      this.passCooldown = 1.2;
    }
  }

  spawnPickup() {
    const types = ['TURBO', 'TELEPORT', 'SLIP'];
    const type = types[Math.floor(Math.random() * types.length)];

    const { left, top, size } = this.arena;
    const margin = size * 0.15;
    const px = left + margin + Math.random() * (size - margin * 2);
    const py = top + margin + Math.random() * (size - margin * 2);

    // Make sure it doesn't spawn inside a pillar
    for (const pil of this.pillars) {
      if (
        px >= pil.x - 20 &&
        px <= pil.x + pil.w + 20 &&
        py >= pil.y - 20 &&
        py <= pil.y + pil.h + 20
      ) {
        return;
      }
    }

    this.pickups.push({
      x: px,
      y: py,
      type: type,
      radius: 15,
      animTime: 0,
    });
  }

  getCornerQuadrant(point) {
    const { cx, cy } = this.arena;

    if (point.x < cx && point.y >= cy) return 0; // Bottom-Left (P1)
    if (point.x < cx && point.y < cy) return 1;  // Top-Left (P2)
    if (point.x >= cx && point.y < cy) return 2; // Top-Right (P3)
    return 3; // Bottom-Right (P4)
  }

  onTouchStart(touch) {
    // 1. UI Buttons tap handling
    for (const btn of this.uiButtons) {
      if (
        touch.x >= btn.x &&
        touch.x <= btn.x + btn.w &&
        touch.y >= btn.y &&
        touch.y <= btn.y + btn.h
      ) {
        btn.onClick();
        return;
      }
    }

    // 1.5. Generous Lobby Join fallback (tap anywhere in quadrant)
    if (this.state === 'LOBBY') {
      const q = this.getCornerQuadrant(touch);
      this.cycleSlotType(q);
      return;
    }

    // 2. Dash button tap handling
    if (this.state === 'PLAYING') {
      for (const dBtn of this.dashButtons) {
        if (
          touch.x >= dBtn.x - dBtn.w / 2 - 12 &&
          touch.x <= dBtn.x + dBtn.w / 2 + 12 &&
          touch.y >= dBtn.y - dBtn.h / 2 - 12 &&
          touch.y <= dBtn.y + dBtn.h / 2 + 12
        ) {
          this.triggerDash(dBtn.playerIndex);
          return;
        }
      }
    }

    // 3. Multi-Touch 360° Floating Joystick per corner quadrant + Double-Tap Dash
    if (this.state === 'PLAYING') {
      const q = this.getCornerQuadrant(touch);
      const joy = this.joysticks[q];
      const p = this.players[q];

      if (p && p.isJoined && p.slotType === 'human' && !joy.active) {
        const now = performance.now();
        if (p.lastTapTime && now - p.lastTapTime < 280) {
          this.triggerDash(q);
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
        const maxRadius = 48;

        joy.angle = Math.atan2(dy, dx);
        joy.force = Math.min(1.0, dist / maxRadius);

        // Clamp visual joystick knob so it never drifts across boundaries
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

  handleRemoteInput(slotIndex, data) {
    const joy = this.joysticks[slotIndex];
    if (!joy) return;

    if (data.action === 'JOYSTICK_MOVE') {
      joy.active = data.force > 0.05;
      joy.angle = data.angle || 0;
      joy.force = data.force || 0;
    } else if (data.action === 'DASH') {
      this.triggerDash(slotIndex);
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

  // --- RAYCASTING & LINE OF SIGHT HELPER FUNCTIONS ---

  lineIntersectsRect(x1, y1, x2, y2, rect, pad = 12) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    const rx1 = rect.x - pad;
    const ry1 = rect.y - pad;
    const rx2 = rect.x + rect.w + pad;
    const ry2 = rect.y + rect.h + pad;

    if (maxX < rx1 || minX > rx2 || maxY < ry1 || minY > ry2) {
      return false;
    }

    // Line intersection against 4 sides
    return (
      this.segmentsIntersect(x1, y1, x2, y2, rx1, ry1, rx2, ry1) ||
      this.segmentsIntersect(x1, y1, x2, y2, rx2, ry1, rx2, ry2) ||
      this.segmentsIntersect(x1, y1, x2, y2, rx2, ry2, rx1, ry2) ||
      this.segmentsIntersect(x1, y1, x2, y2, rx1, ry2, rx1, ry1)
    );
  }

  segmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if (Math.abs(denom) < 0.0001) return false;
    const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }

  checkLineOfSight(x1, y1, x2, y2, pad = 12) {
    for (const pil of this.pillars) {
      if (this.lineIntersectsRect(x1, y1, x2, y2, pil, pad)) {
        return false;
      }
    }
    return true;
  }

  // --- SMART BOT AI: WHISKERS, WAYPOINT STEERING & ANTI-STUCK ---

  updateBotAI(bot, dt) {
    const carrier = this.players[this.bombCarrierIndex];
    const isCarrier = bot.index === this.bombCarrierIndex;
    const isGod = bot.slotType === 'bot_god';
    const { left, right, top, bottom, cx, cy } = this.arena;

    let moveX = 0;
    let moveY = 0;

    // --- 1. CHASE OR FLEE CORE INTENT ---
    if (isCarrier) {
      // Find closest living opponent
      let nearestOpponent = null;
      let minDist = Infinity;

      for (const other of this.players) {
        if (other.index !== bot.index && other.isJoined && other.isAlive) {
          const d = Math.hypot(other.x - bot.x, other.y - bot.y);
          if (d < minDist) {
            minDist = d;
            nearestOpponent = other;
          }
        }
      }

      if (nearestOpponent) {
        let targetX = nearestOpponent.x;
        let targetY = nearestOpponent.y;

        // God Mode: Trajectory Prediction
        if (isGod) {
          targetX += nearestOpponent.vx * 0.4;
          targetY += nearestOpponent.vy * 0.4;
        }

        // Tactical Dash: lunge if close and facing target
        if (minDist < (isGod ? 135 : 100) && bot.dashCooldown <= 0) {
          const toTargetAngle = Math.atan2(targetY - bot.y, targetX - bot.x);
          const angleDiff = Math.abs(bot.facingAngle - toTargetAngle);
          if (angleDiff < 0.6) {
            this.triggerDash(bot.index);
          }
        }

        // WAYPOINT BYPASS: Check if line of sight to target is blocked by any pillar
        let blockingPillar = null;
        for (const pil of this.pillars) {
          if (this.lineIntersectsRect(bot.x, bot.y, targetX, targetY, pil, bot.radius + 10)) {
            blockingPillar = pil;
            break;
          }
        }

        if (blockingPillar) {
          // Find pillar clearance corner that gives the shortest clear path
          const clearance = bot.radius + 18;
          const corners = [
            { x: blockingPillar.x - clearance, y: blockingPillar.y - clearance },
            { x: blockingPillar.x + blockingPillar.w + clearance, y: blockingPillar.y - clearance },
            { x: blockingPillar.x + blockingPillar.w + clearance, y: blockingPillar.y + blockingPillar.h + clearance },
            { x: blockingPillar.x - clearance, y: blockingPillar.y + blockingPillar.h + clearance },
          ];

          let bestCorner = null;
          let bestTotalDist = Infinity;

          for (const c of corners) {
            // Must have clear line of sight to corner
            if (this.checkLineOfSight(bot.x, bot.y, c.x, c.y, 4)) {
              const dTotal = Math.hypot(c.x - bot.x, c.y - bot.y) + Math.hypot(targetX - c.x, targetY - c.y);
              if (dTotal < bestTotalDist) {
                bestTotalDist = dTotal;
                bestCorner = c;
              }
            }
          }

          if (bestCorner) {
            targetX = bestCorner.x;
            targetY = bestCorner.y;
          }
        }

        const angle = Math.atan2(targetY - bot.y, targetX - bot.x);
        moveX = Math.cos(angle);
        moveY = Math.sin(angle);
      }
    } else {
      // --- FLEE MODE: Run away from bomb carrier & use cover ---
      if (carrier && carrier.isAlive) {
        const dx = bot.x - carrier.x;
        const dy = bot.y - carrier.y;
        const distToCarrier = Math.hypot(dx, dy);

        // Tactical Dash: escape lunge if carrier is breathing down our neck
        if (distToCarrier < (isGod ? 95 : 75) && bot.dashCooldown <= 0) {
          this.triggerDash(bot.index);
        }

        // Direct flee vector away from carrier
        if (distToCarrier > 0.001) {
          moveX = dx / distToCarrier;
          moveY = dy / distToCarrier;
        }

        // Seek cover on the opposite side of nearest pillar
        let bestPillar = null;
        let bestDist = Infinity;

        for (const pil of this.pillars) {
          const pilCx = pil.x + pil.w / 2;
          const pilCy = pil.y + pil.h / 2;
          const d = Math.hypot(pilCx - bot.x, pilCy - bot.y);
          if (d < bestDist) {
            bestDist = d;
            bestPillar = pil;
          }
        }

        if (bestPillar && distToCarrier < 260) {
          const pilCx = bestPillar.x + bestPillar.w / 2;
          const pilCy = bestPillar.y + bestPillar.h / 2;
          const carrierToPilAngle = Math.atan2(pilCy - carrier.y, pilCx - carrier.x);
          const coverDist = Math.max(bestPillar.w, bestPillar.h) * 0.9 + bot.radius;
          const coverX = pilCx + Math.cos(carrierToPilAngle) * coverDist;
          const coverY = pilCy + Math.sin(carrierToPilAngle) * coverDist;

          const toCoverX = coverX - bot.x;
          const toCoverY = coverY - bot.y;
          const distCover = Math.hypot(toCoverX, toCoverY);

          if (distCover > 12) {
            const weight = isGod ? 1.6 : 1.1;
            moveX += (toCoverX / distCover) * weight;
            moveY += (toCoverY / distCover) * weight;
          }
        }

        // Sniping nearby Teleport or Turbo pickups
        if (this.pickups.length > 0 && distToCarrier > 90) {
          const pickup = this.pickups[0];
          const dPick = Math.hypot(pickup.x - bot.x, pickup.y - bot.y);
          if (dPick < (isGod ? 180 : 100)) {
            moveX += ((pickup.x - bot.x) / dPick) * 1.3;
            moveY += ((pickup.y - bot.y) / dPick) * 1.3;
          }
        }
      }
    }

    // --- 2. DYNAMIC WALL TANGENT DEFLECTION & CORNER ESCAPE ---
    const r = bot.radius;
    const wallMargin = 72;
    const dLeft = bot.x - (left + r);
    const dRight = right - r - bot.x;
    const dTop = bot.y - (top + r);
    const dBottom = bottom - r - bot.y;

    const nearLeft = dLeft < wallMargin;
    const nearRight = dRight < wallMargin;
    const nearTop = dTop < wallMargin;
    const nearBottom = dBottom < wallMargin;

    // Corner Trap Detection: if near two walls at once, steer forcefully towards arena center!
    const cornerWalls = (nearLeft ? 1 : 0) + (nearRight ? 1 : 0) + (nearTop ? 1 : 0) + (nearBottom ? 1 : 0);
    if (cornerWalls >= 2) {
      const toCenterX = cx - bot.x;
      const toCenterY = cy - bot.y;
      const distCenter = Math.hypot(toCenterX, toCenterY);
      if (distCenter > 1) {
        moveX = (toCenterX / distCenter) * 1.6;
        moveY = (toCenterY / distCenter) * 1.6;
      }
    } else {
      // Near single wall: deflect movement along wall tangent (prevent slamming into wall)
      if (nearLeft) {
        const push = (wallMargin - dLeft) / wallMargin;
        moveX = Math.max(0, moveX) + push * 1.5;
        // Slide vertically along wall
        if (Math.abs(moveY) < 0.25) {
          moveY = (bot.y < cy ? -1 : 1) * 0.9;
        }
      }
      if (nearRight) {
        const push = (wallMargin - dRight) / wallMargin;
        moveX = Math.min(0, moveX) - push * 1.5;
        if (Math.abs(moveY) < 0.25) {
          moveY = (bot.y < cy ? -1 : 1) * 0.9;
        }
      }
      if (nearTop) {
        const push = (wallMargin - dTop) / wallMargin;
        moveY = Math.max(0, moveY) + push * 1.5;
        if (Math.abs(moveX) < 0.25) {
          moveX = (bot.x < cx ? -1 : 1) * 0.9;
        }
      }
      if (nearBottom) {
        const push = (wallMargin - dBottom) / wallMargin;
        moveY = Math.min(0, moveY) - push * 1.5;
        if (Math.abs(moveX) < 0.25) {
          moveX = (bot.x < cx ? -1 : 1) * 0.9;
        }
      }
    }

    // --- 3. PILLAR WHISKER DEFLECTION ---
    for (const pil of this.pillars) {
      const pilCx = pil.x + pil.w / 2;
      const pilCy = pil.y + pil.h / 2;
      const dPil = Math.hypot(bot.x - pilCx, bot.y - pilCy);
      const pilThreshold = Math.max(pil.w, pil.h) * 0.75 + r + 15;

      if (dPil < pilThreshold && dPil > 0.001) {
        // Strong repulsion directly from pillar center
        const nx = (bot.x - pilCx) / dPil;
        const ny = (bot.y - pilCy) / dPil;
        const push = (pilThreshold - dPil) / pilThreshold;
        moveX += nx * push * 1.8;
        moveY += ny * push * 1.8;
      }
    }

    // --- 4. INK PUDDLES AVOIDANCE ---
    for (const puddle of this.inkPuddles) {
      const dPuddle = Math.hypot(bot.x - puddle.x, bot.y - puddle.y);
      if (dPuddle < puddle.radius + 35 && dPuddle > 0.01) {
        const avoidW = isGod ? 2.4 : 1.2;
        moveX += ((bot.x - puddle.x) / dPuddle) * avoidW;
        moveY += ((bot.y - puddle.y) / dPuddle) * avoidW;
      }
    }

    // --- 5. ANTI-STUCK WATCHDOG ---
    const frameMove = Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY);
    bot.lastX = bot.x;
    bot.lastY = bot.y;

    if (frameMove < 20 * dt) {
      bot.stuckAccumulator = (bot.stuckAccumulator || 0) + dt;
    } else {
      bot.stuckAccumulator = Math.max(0, (bot.stuckAccumulator || 0) - dt * 2.5);
    }

    if (bot.stuckAccumulator > 0.16) {
      // Bot is stuck against an obstacle! Trigger instant escape slide toward arena center
      bot.unstuckDuration = 0.38;
      const angleToCenter = Math.atan2(cy - bot.y, cx - bot.x);
      bot.unstuckAngle = angleToCenter + (Math.random() > 0.5 ? 0.7 : -0.7);
      bot.stuckAccumulator = 0;
    }

    if (bot.unstuckDuration > 0) {
      bot.unstuckDuration -= dt;
      moveX = Math.cos(bot.unstuckAngle) * 1.5;
      moveY = Math.sin(bot.unstuckAngle) * 1.5;
    }

    // Final normalized movement intent
    const mag = Math.hypot(moveX, moveY);
    if (mag > 0.001) {
      bot.aiMoveX = moveX / mag;
      bot.aiMoveY = moveY / mag;
      bot.aiForce = 1.0;
    } else {
      bot.aiMoveX = 0;
      bot.aiMoveY = 0;
      bot.aiForce = 0;
    }
  }

  // --- COLLISION RESOLUTION ---

  resolveCollisions(player) {
    const { left, right, top, bottom } = this.arena;
    const r = player.radius;

    // Arena outer walls
    if (player.x - r < left) {
      player.x = left + r;
      player.vx = 0;
    }
    if (player.x + r > right) {
      player.x = right - r;
      player.vx = 0;
    }
    if (player.y - r < top) {
      player.y = top + r;
      player.vy = 0;
    }
    if (player.y + r > bottom) {
      player.y = bottom - r;
      player.vy = 0;
    }

    // Symmetrical Pillars (AABB vs Circle)
    for (const pil of this.pillars) {
      const closestX = Math.max(pil.x, Math.min(player.x, pil.x + pil.w));
      const closestY = Math.max(pil.y, Math.min(player.y, pil.y + pil.h));

      const dx = player.x - closestX;
      const dy = player.y - closestY;
      const distSq = dx * dx + dy * dy;

      if (distSq < r * r) {
        const dist = Math.sqrt(distSq);
        if (dist > 0.001) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = r - dist;
          player.x += nx * overlap;
          player.y += ny * overlap;

          // Slide along pillar surface
          const dot = player.vx * nx + player.vy * ny;
          if (dot < 0) {
            player.vx -= dot * nx;
            player.vy -= dot * ny;
          }
        } else {
          // Inside pillar center emergency ejection
          player.x += r;
        }
      }
    }
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
        this.startNewRound();
      }
      return;
    }

    if (this.state !== 'PLAYING') return;

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

    // Spawning Pickups
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupSpawnTimer = 8.0 + Math.random() * 4.0;
    }

    // Pickups animation
    for (const pickup of this.pickups) {
      pickup.animTime += dt;
    }

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
        if (player.index === 0) {
          if (this.keys['KeyA'] || this.keys['a']) inputX -= 1;
          if (this.keys['KeyD'] || this.keys['d']) inputX += 1;
          if (this.keys['KeyW'] || this.keys['w']) inputY -= 1;
          if (this.keys['KeyS'] || this.keys['s']) inputY += 1;
        } else if (player.index === 1) {
          if (this.keys['ArrowLeft']) inputX -= 1;
          if (this.keys['ArrowRight']) inputX += 1;
          if (this.keys['ArrowUp']) inputY -= 1;
          if (this.keys['ArrowDown']) inputY += 1;
        } else if (player.index === 2) {
          if (this.keys['KeyJ'] || this.keys['j']) inputX -= 1;
          if (this.keys['KeyL'] || this.keys['l']) inputX += 1;
          if (this.keys['KeyI'] || this.keys['i']) inputY -= 1;
          if (this.keys['KeyK'] || this.keys['k']) inputY += 1;
        } else if (player.index === 3) {
          if (this.keys['KeyF'] || this.keys['f']) inputX -= 1;
          if (this.keys['KeyH'] || this.keys['h']) inputX += 1;
          if (this.keys['KeyT'] || this.keys['t']) inputY -= 1;
          if (this.keys['KeyG'] || this.keys['g']) inputY += 1;
        }
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
        currentSpeed *= 0.15; // Receiver stumble delay: heavily slowed down for 0.45s!
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
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const item = this.pickups[i];
        const distItem = Math.hypot(player.x - item.x, player.y - item.y);
        if (distItem < player.radius + item.radius) {
          playItemPickup();

          if (item.type === 'TURBO') {
            player.turboTimer = 3.5;
          } else if (item.type === 'TELEPORT') {
            const carrier = this.players[this.bombCarrierIndex];
            const { left, right, top, bottom, size } = this.arena;
            const pad = size * 0.16;
            const corners = [
              { x: left + pad, y: top + pad },
              { x: right - pad, y: top + pad },
              { x: left + pad, y: bottom - pad },
              { x: right - pad, y: bottom - pad },
            ];
            let bestCorner = corners[0];
            let maxDist = -1;
            for (const c of corners) {
              const d = Math.hypot(c.x - carrier.x, c.y - carrier.y);
              if (d > maxDist) {
                maxDist = d;
                bestCorner = c;
              }
            }
            player.x = bestCorner.x;
            player.y = bestCorner.y;
            playTeleport();
          } else if (item.type === 'SLIP') {
            this.inkPuddles.push({
              x: player.x,
              y: player.y,
              radius: 22,
              duration: 10.0,
            });
          }

          this.pickups.splice(i, 1);
        }
      }
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

    this.renderArena(ctx);
    this.renderInkPuddles(ctx);
    this.renderPickups(ctx);
    this.renderPlayers(ctx);
    this.renderParticles(ctx);
    this.renderVirtualJoysticks(ctx);
    this.renderDashButtons(ctx);

    // Panic Phase Red Border Vignette (Last 4 Seconds)
    if (this.state === 'PLAYING' && this.bombTimer <= 4.0) {
      const pulseAlpha = 0.18 + Math.sin(performance.now() * 0.015) * 0.12;
      ctx.fillStyle = `rgba(216, 71, 39, ${pulseAlpha})`;
      // Top, bottom, left, right edge hazard stripes
      const edge = 16;
      ctx.fillRect(0, 0, canvas.width, edge);
      ctx.fillRect(0, canvas.height - edge, canvas.width, edge);
      ctx.fillRect(0, 0, edge, canvas.height);
      ctx.fillRect(canvas.width - edge, 0, edge, canvas.height);
    }

    // Render UI Overlays
    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'JOYSTICK SÜRÜKLE • DOKUN: DEPAR AT', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'ROUND_OVER') {
      this.renderRoundOverUI(ctx);
    } else if (this.state === 'GAME_OVER') {
      this.renderGameOverUI(ctx);
    }

    ctx.restore();
  }

  renderArena(ctx) {
    const { left, top, right, bottom, width, height, size, cx, cy } = this.arena;

    // Arena Floor
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    // Arena Grid
    ctx.strokeStyle = '#E2DCD2';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + width * 0.15, top + height * 0.15, width * 0.7, height * 0.7);

    // Arena Outer Heavy Cast Iron Border & Drop Shadow
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(right, top + 6, 6, height);
    ctx.fillRect(left + 6, bottom, width, 6);

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(left, top, width, height);

    // Pillars / Obstacles
    for (const pil of this.pillars) {
      // Solid Shadow
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(pil.x + 5, pil.y + 5, pil.w, pil.h);

      // Pillar Face
      ctx.fillStyle = '#2B2B28';
      ctx.fillRect(pil.x, pil.y, pil.w, pil.h);

      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 3;
      ctx.strokeRect(pil.x, pil.y, pil.w, pil.h);

      // Cross Rivet pattern
      ctx.strokeStyle = '#42423E';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pil.x + 4, pil.y + 4);
      ctx.lineTo(pil.x + pil.w - 4, pil.y + pil.h - 4);
      ctx.moveTo(pil.x + pil.w - 4, pil.y + 4);
      ctx.lineTo(pil.x + 4, pil.y + pil.h - 4);
      ctx.stroke();
    }

    // Set Championship Scoreboard Strip at Top
    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      const joined = this.players.filter((p) => p.isJoined);
      if (joined.length > 0) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const stripW = Math.min(size * 0.94, 440);
        const stripH = 32;
        const stripX = cx - stripW / 2;
        const stripY = top + 12;

        ctx.fillStyle = '#E5E1D8';
        ctx.fillRect(stripX, stripY, stripW, stripH);
        ctx.strokeStyle = '#1C1C1A';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(stripX, stripY, stripW, stripH);

        const scoreSummary = joined
          .map((p) => `${p.name}: ${this.scores[p.index] || 0}`)
          .join('  |  ');

        ctx.font = '900 13px "JetBrains Mono", monospace';
        ctx.fillStyle = '#1C1C1A';
        ctx.fillText(
          `SET SKORU // ${scoreSummary} // HEDEF: ${this.targetScore}`,
          cx,
          stripY + stripH / 2
        );
        ctx.restore();
      }
    }
    // Dynamic Floor Hazard Ring Under Bomb Carrier
    const carrier = this.players[this.bombCarrierIndex];
    if (carrier && carrier.isAlive && this.state === 'PLAYING') {
      ctx.save();
      const urgency = 1 - Math.max(0, this.bombTimer / this.bombMaxTime);
      const ringRadius = carrier.radius + 18 + Math.sin(performance.now() * 0.01) * 4;

      ctx.strokeStyle = urgency > 0.6 ? '#D84727' : '#D99B26';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(carrier.x, carrier.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      // Floor warning crosshair
      const chLen = 8;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(carrier.x - ringRadius - chLen, carrier.y);
      ctx.lineTo(carrier.x - ringRadius + 2, carrier.y);
      ctx.moveTo(carrier.x + ringRadius - 2, carrier.y);
      ctx.lineTo(carrier.x + ringRadius + chLen, carrier.y);
      ctx.moveTo(carrier.x, carrier.y - ringRadius - chLen);
      ctx.lineTo(carrier.x, carrier.y - ringRadius + 2);
      ctx.moveTo(carrier.x, carrier.y + ringRadius - 2);
      ctx.lineTo(carrier.x, carrier.y + ringRadius + chLen);
      ctx.stroke();
      ctx.restore();
    }
  }

  renderInkPuddles(ctx) {
    for (const puddle of this.inkPuddles) {
      ctx.save();
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath();
      ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
      ctx.fill();

      // Splatter blobs
      ctx.fillStyle = '#333330';
      ctx.beginPath();
      ctx.arc(puddle.x - 6, puddle.y - 4, puddle.radius * 0.4, 0, Math.PI * 2);
      ctx.arc(puddle.x + 8, puddle.y + 5, puddle.radius * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  renderPickups(ctx) {
    for (const item of this.pickups) {
      ctx.save();
      const pulse = 1 + Math.sin(item.animTime * 6) * 0.08;

      ctx.translate(item.x, item.y);
      ctx.scale(pulse, pulse);

      // Solid Shadow
      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-14 + 3, -14 + 3, 28, 28);

      // Background badge
      ctx.fillStyle =
        item.type === 'TURBO' ? '#FFDE59' : item.type === 'TELEPORT' ? '#48CAE4' : '#2D2D2A';
      ctx.fillRect(-14, -14, 28, 28);

      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-14, -14, 28, 28);

      // Icon
      ctx.fillStyle = item.type === 'SLIP' ? '#FFFFFF' : '#1C1C1A';
      ctx.font = '900 14px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = item.type === 'TURBO' ? '⚡' : item.type === 'TELEPORT' ? '🌀' : '🍌';
      ctx.fillText(label, 0, 0);

      ctx.restore();
    }
  }

  renderPlayers(ctx) {
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      const isCarrier = player.index === this.bombCarrierIndex;
      ctx.save();
      ctx.translate(player.x, player.y);

      // Slipping rotation
      if (player.slipTimer > 0) {
        ctx.rotate(player.slipAngle);
      }

      // Receiver Stumble Jitter & Dizzy Indicator
      if (player.stumbleTimer > 0) {
        ctx.translate((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 5);
      }

      // Escaper Immunity Shield Ring (cannot be given bomb back)
      if (player.immunityTimer > 0) {
        ctx.save();
        ctx.strokeStyle = '#2D6A4F';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, player.radius + 7, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#2D6A4F';
        ctx.font = '900 10px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🛡️ GÜVENDE', 0, -player.radius - 12);
        ctx.restore();
      }

      // Danger Pulse Ring around Bomb Carrier
      if (isCarrier) {
        const urgency = 1 - Math.max(0, this.bombTimer / this.bombMaxTime);
        const pulseSpeed = 1 + urgency * 4;
        const pulseR =
          player.radius + 8 + Math.sin(performance.now() * 0.015 * pulseSpeed) * 4;
        ctx.strokeStyle = urgency > 0.7 ? '#FFDE59' : '#D84727';
        ctx.lineWidth = urgency > 0.7 ? 4 : 3;
        ctx.beginPath();
        ctx.arc(0, 0, pulseR, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Runner Body Shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.beginPath();
      ctx.arc(3, 3, player.radius, 0, Math.PI * 2);
      ctx.fill();

      // Runner Circle Face
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = player.dashTimer > 0 ? '#FFFFFF' : '#1C1C1A';
      ctx.lineWidth = player.dashTimer > 0 ? 4.5 : 3;
      ctx.stroke();

      // Directional Heading Indicator Pointer (extending beyond body)
      ctx.save();
      ctx.rotate(player.facingAngle);
      ctx.fillStyle = isCarrier ? '#FFDE59' : '#FFFFFF';
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(player.radius + 14, 0);
      ctx.lineTo(player.radius + 2, -6);
      ctx.lineTo(player.radius + 5, 0);
      ctx.lineTo(player.radius + 2, 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Player Label
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 11px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const pLabel = (player.name && player.name !== BOMB_NAMES[player.index])
        ? player.name.slice(0, 6)
        : `P${player.index + 1}`;
      ctx.fillText(pLabel, 0, 0);

      // --- Ticking Bomb Visuals for Carrier ---
      if (isCarrier) {
        const bombY = -player.radius - 18;

        // Bomb sphere
        ctx.fillStyle = '#1C1C1A';
        ctx.beginPath();
        ctx.arc(0, bombY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FAF7F2';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Burning Fuse
        ctx.strokeStyle = '#D84727';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, bombY - 10);
        ctx.quadraticCurveTo(6, bombY - 16, 4, bombY - 20);
        ctx.stroke();

        // Spark at tip of fuse
        ctx.fillStyle = Math.random() > 0.5 ? '#FFDE59' : '#D84727';
        ctx.beginPath();
        ctx.arc(4, bombY - 20, 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Countdown Timer Badge (Panic mode highlighted)
        const isPanic = this.bombTimer <= 4.0;
        const timerText = isPanic
          ? `⚡ ${Math.max(0, this.bombTimer).toFixed(1)}s`
          : `${Math.max(0, this.bombTimer).toFixed(1)}s`;

        const badgeW = isPanic ? 56 : 46;
        ctx.fillStyle = isPanic ? '#D84727' : '#1C1C1A';
        ctx.fillRect(-badgeW / 2, bombY - 34, badgeW, 16);
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-badgeW / 2, bombY - 34, badgeW, 16);

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 11px "JetBrains Mono", monospace';
        ctx.fillText(timerText, 0, bombY - 25);
      }

      ctx.restore();
    }
  }

  renderParticles(ctx) {
    for (const part of this.particles) {
      ctx.save();
      const alpha = Math.max(0, part.life / part.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = part.color;
      ctx.fillRect(part.x - part.size / 2, part.y - part.size / 2, part.size, part.size);
      ctx.restore();
    }
  }

  renderVirtualJoysticks(ctx) {
    if (this.state !== 'PLAYING') return;

    const { left, right, top, bottom, width, height } = this.arena;
    const anchors = [
      { x: left + width * 0.14, y: bottom - height * 0.14 },
      { x: left + width * 0.14, y: top + height * 0.14 },
      { x: right - width * 0.14, y: top + height * 0.14 },
      { x: right - width * 0.14, y: bottom - height * 0.14 },
    ];

    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      const player = this.players[q];
      if (!player.isJoined || player.slotType !== 'human') continue;

      if (!joy.active) {
        ctx.save();
        ctx.translate(anchors[q].x, anchors[q].y);
        if (q === 1 || q === 2) ctx.rotate(Math.PI);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, 36, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = player.color;
        ctx.font = '800 11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${player.name.slice(0, 3)} SÜRÜKLE`, 0, 0);
        ctx.restore();
        continue;
      }

      ctx.save();
      // Base Ring
      ctx.strokeStyle = 'rgba(28, 28, 26, 0.4)';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(joy.originX, joy.originY, 48, 0, Math.PI * 2);
      ctx.stroke();

      // Thumbstick Knob
      ctx.setLineDash([]);
      ctx.fillStyle = player.color;
      ctx.beginPath();
      ctx.arc(joy.currX, joy.currY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  renderDashButtons(ctx) {
    if (this.state !== 'PLAYING') return;

    this.dashButtons = [];
    const { canvas, arena } = this;
    const btnW = 82;
    const btnH = 36;

    // Check vertical margin outside arena
    const bottomSpace = canvas.height - arena.bottom;
    const topSpace = arena.top;

    const bottomY = bottomSpace >= 42 ? arena.bottom + 26 : arena.bottom - 22;
    const topY = topSpace >= 42 ? arena.top - 26 : arena.top + 22;

    const positions = [
      { x: arena.left + arena.size * 0.35, y: bottomY },
      { x: arena.left + arena.size * 0.35, y: topY },
      { x: arena.right - arena.size * 0.16, y: topY },
      { x: arena.right - arena.size * 0.16, y: bottomY },
    ];

    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      if (!p.isJoined || !p.isAlive || p.slotType !== 'human') continue;

      const pos = positions[i];
      const isReady = p.dashCooldown <= 0;
      const isDashing = p.dashTimer > 0;

      ctx.save();
      ctx.translate(pos.x, pos.y);
      if (i === 1 || i === 2) {
        ctx.rotate(Math.PI);
      }

      // Drop Shadow
      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-btnW / 2 + 3, -btnH / 2 + 3, btnW, btnH);

      // Face
      ctx.fillStyle = isDashing ? '#FFFFFF' : isReady ? '#FFDE59' : '#D5D0C7';
      ctx.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);

      ctx.strokeStyle = isDashing ? '#FFDE59' : '#1C1C1A';
      ctx.lineWidth = isDashing ? 3.5 : 2.5;
      ctx.strokeRect(-btnW / 2, -btnH / 2, btnW, btnH);

      ctx.fillStyle = '#1C1C1A';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (isDashing) {
        ctx.font = '900 13px "Space Grotesk", sans-serif';
        ctx.fillText('⚡ DEPAR!', 0, 0);
      } else if (isReady) {
        ctx.font = '900 13px "Space Grotesk", sans-serif';
        ctx.fillText('⚡ ATIL', 0, 0);
      } else {
        const remaining = Math.max(0.1, p.dashCooldown);
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.fillText(`⏳ ${remaining.toFixed(1)}s`, 0, 0);
      }
      ctx.restore();

      this.dashButtons.push({
        x: pos.x,
        y: pos.y,
        w: btnW,
        h: btnH,
        playerIndex: i,
      });
    }
  }

  renderLobbyUI(ctx) {
    const { arena } = this;

    // Corner Slots for 4 Players
    const corners = [
      { x: arena.left + 24, y: arena.bottom - 60 }, // P1
      { x: arena.left + 24, y: arena.top + 24 },    // P2
      { x: arena.right - 184, y: arena.top + 24 },  // P3
      { x: arena.right - 184, y: arena.bottom - 60 }, // P4
    ];

    for (let i = 0; i < 4; i++) {
      const pos = corners[i];
      const slotType = this.slotTypes[i];
      const p = this.players[i];

      let label = '+ KATIL';
      let bgColor = '#E3DFD5';
      let textColor = '#1C1C1A';

      if (slotType === 'human') {
        label = `✓ ${p.name}`;
        bgColor = p.color;
        textColor = '#FFFFFF';
      } else if (slotType === 'bot_normal') {
        label = `🤖 ${p.name} (BOT)`;
        bgColor = '#3A3A38';
        textColor = '#FAF7F2';
      } else if (slotType === 'bot_god') {
        label = `⚡ ${p.name} (GOD)`;
        bgColor = '#1A1A1A';
        textColor = '#FFDE59';
      }

      const btnW = 160;
      const btnH = 46;

      ctx.save();
      ctx.fillStyle = bgColor;
      ctx.fillRect(pos.x, pos.y, btnW, btnH);
      ctx.strokeStyle = slotType === 'bot_god' ? '#FFDE59' : '#1C1C1A';
      ctx.lineWidth = slotType === 'bot_god' ? 4 : 3;
      ctx.strokeRect(pos.x, pos.y, btnW, btnH);

      ctx.fillStyle = textColor;
      ctx.font = '800 13px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, pos.x + btnW / 2, pos.y + btnH / 2);
      ctx.restore();

      this.uiButtons.push({
        x: pos.x,
        y: pos.y,
        w: btnW,
        h: btnH,
        onClick: () => this.cycleSlotType(i),
      });
    }

    // Map Selector Button in Lobby
    const mapBtnW = 200;
    const mapBtnH = 36;
    const mapBtnX = arena.cx - mapBtnW / 2;
    const mapBtnY = arena.cy - 72;

    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(mapBtnX, mapBtnY, mapBtnW, mapBtnH);

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`🗺️ ${MAP_PRESETS[this.selectedMapIndex].name} ▾`, arena.cx, mapBtnY + mapBtnH / 2);
    ctx.restore();

    this.uiButtons.push({
      x: mapBtnX,
      y: mapBtnY,
      w: mapBtnW,
      h: mapBtnH,
      onClick: () => this.cycleMap(),
    });

    // Center Start Button
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length >= 2) {
      const btnW = Math.min(220, arena.size * 0.5);
      const btnH = 64;
      const btnX = arena.cx - btnW / 2;
      const btnY = arena.cy - 12;

      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(btnX + 6, btnY + 6, btnW, btnH);

      ctx.fillStyle = '#D84727';
      ctx.fillRect(btnX, btnY, btnW, btnH);

      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.strokeRect(btnX, btnY, btnW, btnH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '800 24px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('BAŞLAT', arena.cx, btnY + btnH / 2);

      this.uiButtons.push({
        x: btnX,
        y: btnY,
        w: btnW,
        h: btnH,
        onClick: () => this.startNewMatch(),
      });
    } else {
      ctx.fillStyle = '#1C1C1A';
      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('EN AZ 2 OYUNCU GEREKLİ', arena.cx, arena.cy - 6);
      ctx.font = '500 13px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#75726B';
      ctx.fillText('Köşelere dokunarak katılın', arena.cx, arena.cy + 18);
    }
  }

  renderRoundOverUI(ctx) {
    if (!this.roundWinner) return;
    const { arena } = this;
    const bW = Math.min(300, arena.size * 0.82);
    const bH = 80;
    const bX = arena.cx - bW / 2;
    const bY = arena.cy - bH / 2;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(bX + 5, bY + 5, bW, bH);
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(bX, bY, bW, bH);
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(bX, bY, bW, bH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.roundWinner.color;
    ctx.font = '900 20px "Space Grotesk", sans-serif';
    ctx.fillText(`+1 SET: ${this.roundWinner.name}!`, arena.cx, arena.cy - 12);

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 12px "JetBrains Mono", monospace';
    ctx.fillText(
      `TOPLAM SET: ${this.scores[this.roundWinner.index]} / ${this.targetScore}`,
      arena.cx,
      arena.cy + 15
    );
  }

  renderGameOverUI(ctx) {
    const { arena } = this;
    const boxW = Math.min(320, arena.size * 0.85);
    const boxH = 220;
    const boxX = arena.cx - boxW / 2;
    const boxY = arena.cy - boxH / 2;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(boxX + 8, boxY + 8, boxW, boxH);

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 14px "Space Grotesk", sans-serif';
    ctx.fillText('ŞAMPİYONLUK KAZANILDI! 🏆', arena.cx, boxY + 34);

    if (this.matchWinner) {
      ctx.fillStyle = this.matchWinner.color;
      ctx.font = '900 22px "Space Grotesk", sans-serif';
      ctx.fillText(`${this.matchWinner.color} // KAZANDI`, arena.cx, boxY + 66, boxW - 20);

      ctx.font = '800 12px "JetBrains Mono", monospace';
      this.players.filter((p) => p.isJoined).forEach((p, row) => {
        ctx.fillStyle = p.color;
        ctx.fillText(`${p.color}: ${this.scores[p.index] || 0} SET`, arena.cx, boxY + 94 + row * 17);
      });
    }

    const btnW = 190;
    const btnH = 46;
    const btnX = arena.cx - btnW / 2;
    const btnY = boxY + 154;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 16px "Space Grotesk", sans-serif';
    ctx.fillText('YENİDEN OYNA', arena.cx, btnY + btnH / 2);

    this.uiButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      onClick: () => {
        this.resetCurrentGame();
      },
    });
  }
}
