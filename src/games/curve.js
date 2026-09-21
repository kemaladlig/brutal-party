// BRUTAL CURVE (Game 03): 2-4 Player Local Party Curve Fever with Gaps, Power-Ups & Bot AI
import { getSlotCustomization, getLocalSeatColors } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playGap, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton, getSeatColorDotRect } from '../controlGuide.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { prefersReducedMotion } from '../ui/motion.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCurveBotAI } from '../ai/curveAI.js';

export const CURVE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const CURVE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

// Lokal klavye eşleşmesi: [sol, sağ] — P1 AD, P2 Oklar, P3 JL, P4 FH
const CURVE_KEY_SLOTS_PAIRS = [
  ['KeyA', 'KeyD'],
  ['ArrowLeft', 'ArrowRight'],
  ['KeyJ', 'KeyL'],
  ['KeyF', 'KeyH'],
];
const CURVE_KEY_SLOTS = {};
CURVE_KEY_SLOTS_PAIRS.forEach((pair, i) => pair.forEach((c) => (CURVE_KEY_SLOTS[c] = i)));

// İz sorgu ızgarası: uzun rauntlarda O(n) tarama yerine yakın hücreler.
// Oyun kuralı değişmez — sadece aday kümesi daralır.
const SEG_GRID_CELL = 48;
const SEG_MAX = 24000;

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
    this.roundTransitionTimer = 0;
    this.spawnIntroTimer = 0;

    // Players, Trail Segments, Particles & Pickups
    this.players = [];
    this.segments = [];
    this.particles = [];
    this.pickups = [];
    this.pickupSpawnTimer = 8.0;

    // Touch identifier mapping for corners: corner -> { id, action: 'left' | 'right' }
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];

    // Trail spatial grid (hücre → segment indeksleri) + sorgu damgası
    this.segGrid = new Map();
    this.segGridDirty = false;
    this._segQueryStamp = 0;

    // Keyboard Controls (P1 AD, P2 Oklar, P3 JL, P4 FH — sol tuş = sol butonla aynı yön)
    this.keys = {};
    this.initKeyboard();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
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
      if (this.cornerTouches[slot]?.id !== -1) return;
      const player = this.players[slot];
      if (player && player.slotType === 'human' && this.keyboardSteer(slot) === 0) {
        player.steer = 0;
      }
    });
  }

  // -1 sol, +1 sağ, 0 düz (ikisi birden/basılmıyorsa düz)
  keyboardSteer(index) {
    const pair = CURVE_KEY_SLOTS_PAIRS[index];
    if (!pair) return 0;
    const l = this.keys[pair[0]] ? -1 : 0;
    const r = this.keys[pair[1]] ? 1 : 0;
    return l + r;
  }

  resize(width, height) {
    const oldArena = { ...this.arena };
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;

    this.arena = {
      cx: width / 2,
      cy: height / 2,
      width: arenaW,
      height: arenaH,
      size: Math.min(arenaW, arenaH),
      left: marginX,
      right: marginX + arenaW,
      top: marginY,
      bottom: marginY + arenaH,
    };

    // Maç ortası resize izleri/oyuncuları sıfırlamasın
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
      p.prevX = p.x;
      p.prevY = p.y;
    }
    for (const seg of this.segments) {
      // remapPoint p.x/p.y yazar — seg iki uçlu olduğu için iki ucu ayrı eşle
      const a = { x: seg.x1, y: seg.y1 };
      const b = { x: seg.x2, y: seg.y2 };
      this.remapPoint(a, oldArena, this.arena);
      this.remapPoint(b, oldArena, this.arena);
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
      return {
        index: i,
        name: CURVE_NAMES[i],
        color: isBot ? '#8E8E93' : custom.color,
        x: s.x,
        y: s.y,
        prevX: s.x,
        prevY: s.y,
        angle: s.angle,
        speed: 160,
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
    this.segments = [];
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.particles = [];
    this.pickups = [];
    this.floatingTexts = [];
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];
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
    this.startRound();
  }

  startRound() {
    this.state = 'PLAYING';
    this.segments = [];
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.particles = [];
    this.pickups = [];
    this.floatingTexts = [];
    this.pickupSpawnTimer = 5.5;
    this.roundWinner = null;
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

  getCornerZone(pos) {
    const { cx, cy } = this.arena;
    const isLeft = pos.x < cx;
    const isTop = pos.y < cy;

    if (isLeft && !isTop) return 0; // P1 Bottom-Left
    if (isLeft && isTop) return 1;  // P2 Top-Left
    if (!isLeft && isTop) return 2; // P3 Top-Right
    return 3;                       // P4 Bottom-Right
  }

  getCornerButtonZones(cornerIndex) {
    const { left, right, top, bottom, size } = this.arena;
    const btnW = Math.max(140, Math.min(240, size * 0.44));
    const btnH = Math.max(56, Math.min(76, size * 0.16));
    const halfW = btnW / 2;

    let bx = left;
    let by = bottom - btnH;

    if (cornerIndex === 1) {
      bx = left;
      by = top;
    } else if (cornerIndex === 2) {
      bx = right - btnW;
      by = top;
    } else if (cornerIndex === 3) {
      bx = right - btnW;
      by = bottom - btnH;
    }

    return {
      leftBtn: { x: bx, y: by, w: halfW, h: btnH },
      rightBtn: { x: bx + halfW, y: by, w: halfW, h: btnH },
      box: { x: bx, y: by, w: btnW, h: btnH },
    };
  }

  determineSteerAction(cornerIndex, touch) {
    const zone = this.getCornerButtonZones(cornerIndex);
    const isTop = cornerIndex === 1 || cornerIndex === 2;
    const midX = zone.box.x + zone.box.w / 2;
    // For top players looking down at the screen, their left is towards +X
    if (isTop) {
      return touch.x >= midX ? 'left' : 'right';
    } else {
      return touch.x < midX ? 'left' : 'right';
    }
  }

  onTouchStart(touch) {
    const { cx, cy } = this.arena;
    const distToCenter = Math.hypot(touch.x - cx, touch.y - cy);

    // 1. Center Start Button (Lobby)
    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (distToCenter < 65) {
        const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
        if (joinedCount >= 2) {
          this.startNewMatch();
        }
        return;
      }

      const corner = this.getCornerZone(touch);
      if (corner === -1) return;

      this.cycleSlotType(corner);
      if (this.players[corner]) {
        this.players[corner].isJoined = this.isSlotJoined(corner);
        this.players[corner].slotType = this.slotTypes[corner];
      }
      playJoin();
      return;
    }

    // 2. Center Restart Button (Match Over)
    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (distToCenter < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    // 3. Gameplay: Generous quadrant steering controls
    if (this.state === 'PLAYING') {
      const corner = this.getCornerZone(touch);
      if (corner === -1) return;
      const player = this.players[corner];
      if (player && player.isJoined && player.isAlive && player.slotType === 'human') {
        const action = this.determineSteerAction(corner, touch);
        this.cornerTouches[corner] = { id: touch.id, action };
        const steerDir = action === 'left' ? -1 : 1;
        player.steer = player.confusedTimer > 0 ? -steerDir : steerDir;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;

    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human') {
          const action = this.determineSteerAction(i, touch);
          this.cornerTouches[i].action = action;
          const steerDir = action === 'left' ? -1 : 1;
          player.steer = player.confusedTimer > 0 ? -steerDir : steerDir;
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        this.cornerTouches[i] = { id: -1, action: null };
        const player = this.players[i];
        if (player && player.slotType === 'human') {
          player.steer = 0;
        }
        break;
      }
    }
  }

  onTouchesReset() {
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];
    this.players.forEach((p) => (p.steer = 0));
  }

  spawnPickup() {
    const { left, top, right, bottom } = this.arena;
    const types = ['SCISSORS', 'GHOST', 'TURBO', 'INVERT', 'SHRINK', 'FREEZE', 'BOMB', 'THICK'];
    const type = types[Math.floor(Math.random() * types.length)];
    const size = 24;

    const px = left + 45 + Math.random() * (right - left - 90);
    const py = top + 45 + Math.random() * (bottom - top - 90);

    this.pickups.push({
      x: px,
      y: py,
      size,
      type,
      life: 14.0,
      phase: Math.random() * Math.PI * 2,
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
      const distSq = this.distToSegmentSquared(x, y, s.x1, s.y1, s.x2, s.y2);
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
        if (this.matchWinner) {
          this.state = 'MATCH_OVER';
        } else {
          this.startRound();
        }
      }
    }

    if (this.state === 'PLAYING') {
      // Pickups timer
      this.pickupSpawnTimer -= dt;
      if (this.pickupSpawnTimer <= 0 && this.pickups.length < 3) {
        this.spawnPickup();
        this.pickupSpawnTimer = 6.5 + Math.random() * 3.5;
      }

      // Update pickups
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        this.pickups[i].life -= dt;
        if (this.pickups[i].life <= 0) {
          this.pickups.splice(i, 1);
        }
      }

      // Update Players
      for (const player of this.players) {
        if (!player.isJoined || !player.isAlive) continue;

        // Timers
        if (player.ghostTimer > 0) player.ghostTimer = Math.max(0, player.ghostTimer - dt);
        if (player.turboTimer > 0) player.turboTimer = Math.max(0, player.turboTimer - dt);
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
          if (ks !== 0) {
            player.steer = player.confusedTimer > 0 ? -ks : ks;
          }
        }

        // Steer & Movement
        const currentTurn = player.turnSpeed * (player.confusedTimer > 0 ? -1 : 1);
        player.angle += player.steer * currentTurn * dt;

        let speedMult = 1.0;
        if (player.turboTimer > 0) speedMult *= 1.5;
        if (player.freezeTimer > 0) speedMult *= 0.55;

        const currentSpeed = player.speed * speedMult;
        player.prevX = player.x;
        player.prevY = player.y;
        player.x += Math.cos(player.angle) * currentSpeed * dt;
        player.y += Math.sin(player.angle) * currentSpeed * dt;

        // Record Trail Segment (ızgaraya işlenir; emniyet supabı taşanı budar)
        const newSeg = {
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
        for (let pIdx = this.pickups.length - 1; pIdx >= 0; pIdx--) {
          const item = this.pickups[pIdx];
          if (Math.hypot(player.x - item.x, player.y - item.y) < item.size * 0.8 + 6) {
            this.applyPickup(player, item);
            this.pickups.splice(pIdx, 1);
            break;
          }
        }

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
      this.spawnFloatingText(player.x, player.y - 14, '✂️ İZİ SİL!', player.color);
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
          this.spawnFloatingText(p.x, p.y - 14, '🌀 TERS YÖN!', '#FF473A');
        }
      });
      this.spawnFloatingText(player.x, player.y - 14, '🌀 TERS ÇEVİR!', player.color);
    } else if (item.type === 'SHRINK') {
      player.shrinkTimer = 6.0;
      this.spawnFloatingText(player.x, player.y - 14, '🔬 MİNİ BOY!', '#00B4D8');
    } else if (item.type === 'FREEZE') {
      this.players.forEach((p) => {
        if (p.index !== player.index && p.isJoined && p.isAlive) {
          p.freezeTimer = 2.5;
          this.spawnFloatingText(p.x, p.y - 14, '❄️ DONDU!', '#90E0EF');
        }
      });
      this.spawnFloatingText(player.x, player.y - 14, '❄️ BUZ ÇAĞI!', player.color);
    } else if (item.type === 'BOMB') {
      this.spawnBombBlast(player.x, player.y);
      this.spawnFloatingText(player.x, player.y - 14, '💣 PATLAMA!', '#FF473A');
    } else if (item.type === 'THICK') {
      player.thickTimer = 4.5;
      this.spawnFloatingText(player.x, player.y - 14, '🚧 BARİKAT!', '#D99B26');
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

      const distSq = game.distToSegmentSquared(px, py, seg.x1, seg.y1, seg.x2, seg.y2);
      return distSq <= hitR;
    });
  }

  distToSegmentSquared(px, py, vx, vy, wx, wy) {
    const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
    if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
    let t = ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2;
    t = Math.max(0, Math.min(1, t));
    const projX = vx + t * (wx - vx);
    const projY = vy + t * (wy - vy);
    return (px - projX) * (px - projX) + (py - projY) * (py - projY);
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
      navigator.vibrate([40, 50, 70]);
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
    if (!player || !player.isJoined || !player.isAlive) return;
    if (data.action === 'CURVE_STEER') {
      const dir = data.dir | 0;
      player.steer = Math.max(-1, Math.min(1, dir));
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.roundTransitionTimer = 2.2;
  }

  updateBotAI(bot, dt) {
    updateCurveBotAI(this, bot, dt);
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    // Background paper
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.trauma > 0 && !prefersReducedMotion()) {
      const shake = this.trauma * this.trauma * 16;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    const { left, top, width, height, size, right, bottom, cx, cy } = this.arena;

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    // 4 Köşede Standart Yüksek Görünürlüklü Oyuncu Skorları
    if (this.state === 'PLAYING') {
      renderCornerScores(ctx, {
        arena: this.arena,
        entries: this.players.map((p) =>
          p.isJoined ? { color: p.color, text: `${this.scores[p.index] || 0}★` } : null
        ),
      });
    }

    ctx.strokeStyle = '#E2DDD4';
    ctx.lineWidth = 1.5;
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

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Trail Segments (Dinamik kalınlık: Mini 2px, Normal 4px, Kalın Duvar 8px)
    ctx.lineCap = 'round';
    for (const seg of this.segments) {
      if (seg.isGap) continue;
      ctx.lineWidth = seg.thick ? 8.5 : (seg.shrink ? 2.2 : 4);
      ctx.strokeStyle = seg.color;
      ctx.beginPath();
      ctx.moveTo(seg.x1, seg.y1);
      ctx.lineTo(seg.x2, seg.y2);
      ctx.stroke();
    }

    // Pickups
    const nowSec = performance.now() / 1000;
    for (const item of this.pickups) {
      ctx.save();
      const s = item.size;
      const bob = Math.sin(nowSec * 5 + (item.phase || 0)) * 2;
      const ix = item.x;
      const iy = item.y + bob;

      // Gölge
      ctx.fillStyle = 'rgba(26,26,26,0.18)';
      ctx.beginPath();
      ctx.ellipse(ix, iy + s * 0.6, s * 0.6, s * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();

      // Kutu
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(ix - s / 2 + 2, iy - s / 2 + 2, s, s);
      ctx.fillStyle = '#FAF7F2';
      ctx.fillRect(ix - s / 2, iy - s / 2, s, s);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.strokeRect(ix - s / 2, iy - s / 2, s, s);

      ctx.fillStyle = '#1A1A1A';
      ctx.font = '900 15px "Space Grotesk", "Apple Color Emoji", "Segoe UI Emoji", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon =
        item.type === 'SCISSORS'
          ? '✂️'
          : item.type === 'GHOST'
          ? '👻'
          : item.type === 'TURBO'
          ? '⚡'
          : item.type === 'INVERT'
          ? '🌀'
          : item.type === 'SHRINK'
          ? '🔬'
          : item.type === 'FREEZE'
          ? '❄️'
          : item.type === 'BOMB'
          ? '💣'
          : '🚧';
      ctx.fillText(icon, ix, iy + 1);
      ctx.restore();
    }

    // Floating Text Notifications (Kazanılan güçler)
    if (this.floatingTexts) {
      for (const ft of this.floatingTexts) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
        ctx.fillStyle = ft.color;
        ctx.font = '900 12px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
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
      const headRadius = player.shrinkTimer > 0 ? 3.2 : 5;

      // Dondurma aurası
      if (player.freezeTimer > 0) {
        ctx.strokeStyle = '#00B4D8';
        ctx.lineWidth = 2;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Barikat kalkanı aurası
      if (player.thickTimer > 0) {
        ctx.strokeStyle = '#D99B26';
        ctx.lineWidth = 2.5;
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
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Gap Warning Halo (0.4s before gap opens)
      if (player.gapTimer <= 0.4 && !player.isGap) {
        ctx.beginPath();
        ctx.arc(player.x, player.y, headRadius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#D84727';
        ctx.lineWidth = 1.8;
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
      ctx.lineWidth = 2;
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
    this.renderCornerControls(ctx);

    if (this.state === 'PLAYING' && this.spawnIntroTimer > 0) {
      this.renderSpawnBeacons(ctx);
    }

    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'SOL/SAĞ: YÖN VER • ÇARPMA • 5 PUAN ALAN KAZANIR', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'ROUND_OVER') {
      this.renderRoundBanner(ctx);
    } else if (this.state === 'MATCH_OVER') {
      this.renderMatchOverUI(ctx);
    }

    ctx.restore();
  }

  renderCornerControls(ctx) {
    const seatRects = this.state === 'LOBBY' ? getStandardSeatRects(this.arena) : null;

    for (let i = 0; i < 4; i++) {
      const player = this.players[i];
      const zones = this.getCornerButtonZones(i);
      const isJoined = this.isSlotJoined(i);
      const isTop = i === 1 || i === 2;

      // LOBBY: standart kare koltuk (tüm oyunlarla aynı ölçü) + uiButtons tap
      if (this.state === 'LOBBY') {
        const rect = seatRects[i];
        const localMode = !this.hideLobbyStartButton;
        const localColors = localMode ? getLocalSeatColors() : null;
        renderLobbySeatCard(ctx, {
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          slotIndex: i,
          slotType: player.slotType,
          playerName: player.name || '',
          playerColor: player.color,
          rotation: isTop ? Math.PI : 0,
          seatColor: localMode ? (localColors[i] || player.color) : null,
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
          x: rect.x,
          y: rect.y,
          w: rect.w,
          h: rect.h,
          onClick: () => {
            this.cycleSlotType(i);
            if (this.players[i]) {
              this.players[i].isJoined = this.isSlotJoined(i);
              this.players[i].slotType = this.slotTypes[i];
            }
            playJoin();
          },
        });
        continue;
      }

      ctx.save();
      // Rotate 180° for Top players so buttons and text face that player
      const cx = zones.box.x + zones.box.w / 2;
      const cy = zones.box.y + zones.box.h / 2;
      ctx.translate(cx, cy);
      if (isTop) {
        ctx.rotate(Math.PI);
      }

      const halfW = zones.box.w / 2;
      const halfH = zones.box.h / 2;

      if (isJoined && player.slotType === 'human' && player.isAlive) {
        const touching = this.cornerTouches[i] || { id: -1, action: null };

        // Player Name Header
        ctx.fillStyle = player.color;
        ctx.font = '900 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(player.name, 0, -halfH - 4);

        const leftActive = touching.action === 'left';
        ctx.fillStyle = leftActive ? player.color : '#FFFFFF';
        ctx.fillRect(-halfW, -halfH, halfW, zones.box.h);
        ctx.strokeStyle = '#1A1A1A';
        ctx.lineWidth = 2.5;
        ctx.strokeRect(-halfW, -halfH, halfW, zones.box.h);

        ctx.fillStyle = leftActive ? '#FFFFFF' : '#1A1A1A';
        ctx.font = '900 14px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('◄ SOL', -halfW / 2, 0);

        const rightActive = touching.action === 'right';
        ctx.fillStyle = rightActive ? player.color : '#FFFFFF';
        ctx.fillRect(0, -halfH, halfW, zones.box.h);
        ctx.strokeRect(0, -halfH, halfW, zones.box.h);

        ctx.fillStyle = rightActive ? '#FFFFFF' : '#1A1A1A';
        ctx.fillText('SAĞ ►', halfW / 2, 0);

      } else if (this.state === 'PLAYING' && isJoined) {
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = player.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(-halfW, -halfH, zones.box.w, zones.box.h);
        ctx.setLineDash([]);
        ctx.fillStyle = player.color;
        ctx.font = '800 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${player.name} [BOT]`, 0, 0);
      }
      ctx.restore();
    }
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
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = Math.min(1.0, progress * 1.5);
      ctx.stroke();

      const tagW = 75;
      const tagH = 20;
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(p.x - tagW / 2 + 2, p.y - 32 + 2, tagW, tagH);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - tagW / 2, p.y - 32, tagW, tagH);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(p.x - tagW / 2, p.y - 32, tagW, tagH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 10px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const role = p.slotType === 'bot_god' ? '⚡GOD' : p.slotType === 'bot_normal' ? '🤖BOT' : 'P' + (p.index + 1);
      ctx.fillText(`${role} // ${p.name}`, p.x, p.y - 22);
      ctx.restore();
    });
  }

  renderLobbyUI(ctx) {
    const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
    renderLobbyStartButton(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      joinedCount,
      accent: '#D84727',
      onStart: () => this.startNewMatch(),
      hidden: !!this.hideLobbyStartButton,
    });
  }

  renderRoundBanner(ctx) {
    renderRoundBanner(ctx, {
      arena: this.arena,
      title: this.roundWinner ? `${this.roundWinner.name} KAZANDI!` : 'BERABERE!',
      titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A',
    });
  }

  renderMatchOverUI(ctx) {
    renderMatchOver(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      headline: 'ÇİZGİ ŞAMPİYONU',
      winnerName: this.matchWinner ? this.matchWinner.name : '',
      winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A',
      rows: this.players
        .filter((player) => player.isJoined)
        .map((player) => ({ color: player.color, text: `${player.name}: ${this.scores[player.index] || 0}★` })),
      onRestart: () => this.startNewMatch(),
    });
  }
}
