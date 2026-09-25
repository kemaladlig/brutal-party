// BRUTAL SNAKE: 2-4 oyunculu yılan — yemle büyü, duvara/kuyruğa/engellere çarpma, taktiksel boost.
// Uzayan kuyruk ızgarada sorgulanır (uzun oyunda O(n) tarama yok).
// Çoklu rastgele harita varyasyonları, boost enerji mekaniği ve canlı meyve türleri.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { t } from '../i18n.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateSnakeBotAI } from '../ai/snakeAI.js';
import {
  createSnakeWorldPacket,
  drawSnakeArena,
  drawSnakeFoods,
  drawSnakeParticles,
  drawSnakePlayers,
} from './snakeView.js';
import { getSlotKeys, buildCodeToSlotMap } from '../core/inputMaps.js';
import { getQuadrant, lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { distToSegmentSquared, getProjectileSubsteps, clampToArena } from '../core/physics2d.js';
import { beginDrawRound, hasMatchResult, roundTimedOut } from '../core/roundLifecycle.js';

export const SNAKE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const SNAKE_NAMES = ['P1', 'P2', 'P3', 'P4'];

// keyup ters haritası (tuş code → slot); harita inputMaps STANDARD'dan türetilir
const SNAKE_KEY_SLOTS = buildCodeToSlotMap();

// Kuyruk boyu tavanı: uzayan oyunda ızgara-rebuild sınırlı kalır
const SNAKE_MAX_LEN = 320;
const SNAKE_MAX_FOODS = 32;
const SNAKE_ROUND_LIMIT = 120;
const SEG_GRID_CELL = 48;

// Harita Varyasyonları (Her maç/raunt otomatik rastgele seçilir)
export const SNAKE_MAPS = [
  {
    id: 'open',
    name: 'AÇIK ARENA',
    createWalls: () => [],
  },
  {
    id: 'pillars',
    name: '4 SÜTUN',
    createWalls: (arena) => {
      const { cx, cy, size } = arena;
      const offset = size * 0.20;
      const s = Math.max(26, size * 0.08);
      return [
        { x: cx - offset - s / 2, y: cy - offset - s / 2, w: s, h: s },
        { x: cx + offset - s / 2, y: cy - offset - s / 2, w: s, h: s },
        { x: cx - offset - s / 2, y: cy + offset - s / 2, w: s, h: s },
        { x: cx + offset - s / 2, y: cy + offset - s / 2, w: s, h: s },
      ];
    },
  },
  {
    id: 'cross',
    name: 'MERKEZİ HAÇ',
    createWalls: (arena) => {
      const { cx, cy, size } = arena;
      const len = size * 0.32;
      const thick = Math.max(18, size * 0.05);
      return [
        { x: cx - len / 2, y: cy - thick / 2, w: len, h: thick },
        { x: cx - thick / 2, y: cy - len / 2, w: thick, h: len },
      ];
    },
  },
  {
    id: 'lanes',
    name: '3 KORİDOR',
    createWalls: (arena) => {
      const { cx, cy, size } = arena;
      const offset = size * 0.24;
      const thick = Math.max(18, size * 0.045);
      const h = size * 0.44;
      return [
        { x: cx - offset - thick / 2, y: cy - h / 2, w: thick, h },
        { x: cx + offset - thick / 2, y: cy - h / 2, w: thick, h },
      ];
    },
  },
];

export class SnakeGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
    this.foods = [];
    this.particles = [];
    this.walls = [];
    this.mapIndex = 0;
    this.roundId = 0;
    this.roundTimer = 0;
    this.roundLimit = SNAKE_ROUND_LIMIT;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this._worldSeq = 0;

    // İz sorgu ızgarası (hücre → segment referansları) + sorgu damgası
    this.segGrid = new Map();
    this.segGridDirty = false;
    this._segQueryStamp = 0;

    this.keys = {};
    this.initKeyboard();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      const slot = SNAKE_KEY_SLOTS[e.code];
      if (slot === undefined) return;
      const player = this.players[slot];
      if (!player || player.slotType !== 'human') return;
      const ki = this.keyboardInput(slot);
      if ((this.tabletopSteerState?.[slot] || 0) === 0 && ki.steer === 0) {
        player.steer = 0;
      }
      player.isBoost = ki.boost || !!this.tabletopActionState?.[slot]?.boost;
    });
  }

  keyboardInput(index) {
    const map = getSlotKeys(index);
    if (!map) return { steer: 0, boost: false, targetAngle: null };
    const up = !!this.keys[map.u];
    const down = !!this.keys[map.d];
    const left = !!this.keys[map.l];
    const right = !!this.keys[map.r];
    const boostKey = !!this.keys[map.action];

    const l = left ? -1 : 0;
    const r = right ? 1 : 0;
    const boost = boostKey || up || down;
    return { steer: l + r, boost, targetAngle: null };
  }

  pickRandomMap() {
    this.mapIndex = Math.floor(Math.random() * SNAKE_MAPS.length);
    this.buildMapWalls();
  }

  buildMapWalls() {
    const mapDef = SNAKE_MAPS[this.mapIndex] || SNAKE_MAPS[0];
    this.walls = mapDef.createWalls(this.arena);
  }

  resize(width, height) {
    this.updateViewport(width, height);
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

    this.buildMapWalls();

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
      clampToArena(p, 5, this.arena, { zeroVelocity: true });
    }
    for (const p of this.players) {
      for (const seg of p.segments) {
        const a = { x: seg.x1, y: seg.y1 };
        const b = { x: seg.x2, y: seg.y2 };
        this.remapPoint(a, oldArena, this.arena);
        this.remapPoint(b, oldArena, this.arena);
        clampToArena(a, 0, this.arena);
        clampToArena(b, 0, this.arena);
        seg.x1 = a.x; seg.y1 = a.y; seg.x2 = b.x; seg.y2 = b.y;
      }
    }
    this.segGridDirty = true;
    for (const f of this.foods) {
      this.remapPoint(f, oldArena, this.arena);
      clampToArena(f, f.size || 13, this.arena);
    }
  }

  initPlayers() {
    const { left, right, top, bottom, size } = this.arena;
    const padding = size * 0.22;
    const spawns = [
      { x: left + padding, y: bottom - padding, angle: -Math.PI * 0.25 },
      { x: left + padding, y: top + padding, angle: Math.PI * 0.25 },
      { x: right - padding, y: top + padding, angle: Math.PI * 0.75 },
      { x: right - padding, y: bottom - padding, angle: -Math.PI * 0.75 },
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || SNAKE_COLORS[i]),
        x: s.x, y: s.y, angle: s.angle, targetAngle: null, speed: 140, turnSpeed: 3.4,
        steer: 0, isBoost: false, boostEnergy: 100, boostMaxEnergy: 100, boostLocked: false,
        isAlive: true, isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i], segments: [], currentLen: 0, targetLen: 65,
        botCheckTimer: 0, tongueTimer: Math.random() * 2,
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
    this.foods = [];
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.onTouchesReset();
    this.pickRandomMap();
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
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'PLAYING';
    this.roundId += 1;
    this.roundTimer = 0;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.foods = [];
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.onTouchesReset();
    this.pickRandomMap();
    playStart();
    this.initPlayers();
    this.players.forEach((p) => { p.isAlive = p.isJoined; });
    for (let i = 0; i < 4; i++) this.spawnFood();
  }

  createWorldPacket() {
    return createSnakeWorldPacket(this);
  }

  spawnFood(x, y, forceType = null) {
    if (this.foods.length >= SNAKE_MAX_FOODS) return null;
    if (x === undefined || y === undefined) {
      // Yemin duvarların veya köşe kontrollerin tam üstüne düşmesini engelle
      let attempts = 0;
      let valid = false;
      const corners = this.getTabletopControlCorners();
      while (!valid && attempts < 25) {
        attempts++;
        x = this.arena.left + 35 + Math.random() * (this.arena.width - 70);
        y = this.arena.top + 35 + Math.random() * (this.arena.height - 70);

        valid = true;
        // Duvar kontrolü
        for (const w of this.walls) {
          if (x >= w.x - 15 && x <= w.x + w.w + 15 && y >= w.y - 15 && y <= w.y + w.h + 15) {
            valid = false;
            break;
          }
        }
        // Köşe buton kutularından kaçınma
        for (let i = 0; i < 4; i++) {
          const zone = corners[i];
          if (zone?.box && x >= zone.box.x - 10 && x <= zone.box.x + zone.box.w + 10 &&
              y >= zone.box.y - 10 && y <= zone.box.y + zone.box.h + 10) {
            valid = false;
            break;
          }
        }
      }
    }

    // Yem Türleri: Apple 🍎 (Standart), Golden Star 🌟 (Nadir, +3), Turbo Berry 🍇 (Hız enerjisi doldurur)
    let type = forceType;
    if (!type) {
      const r = Math.random();
      if (r < 0.18) type = 'GOLDEN_STAR';
      else if (r < 0.38) type = 'TURBO_BERRY';
      else type = 'APPLE';
    }

    this.foods.push({
      x, y,
      type,
      size: type === 'GOLDEN_STAR' ? 17 : (type === 'TURBO_BERRY' ? 15 : 13),
      id: Math.random(),
      pulse: Math.random() * Math.PI * 2,
    });
  }

  _gridKey(cx, cy) { return cx * 4096 + cy; }

  _rebuildSegGrid() {
    this.segGrid.clear();
    for (const p of this.players) {
      if (!p.isAlive) continue;
      for (const seg of p.segments) {
        const minCX = Math.floor(Math.min(seg.x1, seg.x2) / SEG_GRID_CELL);
        const maxCX = Math.floor(Math.max(seg.x1, seg.x2) / SEG_GRID_CELL);
        const minCY = Math.floor(Math.min(seg.y1, seg.y2) / SEG_GRID_CELL);
        const maxCY = Math.floor(Math.max(seg.y1, seg.y2) / SEG_GRID_CELL);
        for (let cx = minCX; cx <= maxCX; cx++) {
          for (let cy = minCY; cy <= maxCY; cy++) {
            const key = this._gridKey(cx, cy);
            if (!this.segGrid.has(key)) this.segGrid.set(key, []);
            this.segGrid.get(key).push(seg);
          }
        }
      }
    }
    this.segGridDirty = false;
  }

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
        for (const seg of bucket) {
          if (seg._qstamp === stamp) continue;
          seg._qstamp = stamp;
          if (cb(seg)) return true;
        }
      }
    }
    return false;
  }

  getTabletopSchema() {
    return {
      steer: true,
      leftLabel: '◀',
      rightLabel: '▶',
      actions: [
        {
          id: 'boost',
          icon: '🚀',
          keyHint: 'SPACE',
          holdToCharge: true,
          chargeField: 'boostEnergy',
          maxChargeField: 'boostMaxEnergy',
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (actionId === 'boost') {
      const player = this.players[slotIndex];
      if (player && player.slotType === 'human') {
        player.isBoost = isDown;
      }
    }
  }

  onSlotSteer(slotIndex, dir) {
    const player = this.players[slotIndex];
    if (player && player.slotType === 'human') {
      player.steer = dir;
      if (dir !== 0) player.targetAngle = null;
    }
  }

  onTouchStart(touch) {
    if (this.handleRoundOverSkip()) return;

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

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => { this.resetMatch(); playJoin(); } });
      return;
    }

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
    this.players.forEach((p) => { p.steer = 0; p.isBoost = false; });
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
        if (hasMatchResult(this)) {
          this.state = 'MATCH_OVER';
        } else {
          this.startRound();
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

    this.segGridDirty = true;

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      player.tongueTimer -= dt;
      if (player.tongueTimer <= 0) player.tongueTimer = 1.8 + Math.random() * 2.2;

      if (player.slotType !== 'human') {
        updateSnakeBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        const steerTouch = this.tabletopSteerState?.[player.index] || 0;
        if (ki.targetAngle !== null) {
          player.targetAngle = ki.targetAngle;
          player.steer = 0;
        } else if (ki.steer !== 0) {
          player.steer = ki.steer;
          player.targetAngle = null;
        } else if (steerTouch !== 0) {
          player.steer = steerTouch;
          player.targetAngle = null;
        } else if (!player.remoteSteerActive) {
          player.steer = 0;
        }
        player.isBoost = ki.boost || !!this.tabletopActionState?.[player.index]?.boost || !!player.remoteBoostActive;
      }

      // ⚡ BOOST ENERJİSİ / STAMİNA MEKANİĞİ
      if (player.isBoost) {
        if (!player.boostLocked && player.boostEnergy > 0) {
          player.boostEnergy = Math.max(0, player.boostEnergy - dt * 36);
          // Kuyruk arkasından kıvılcım & duman parçacığı
          if (Math.random() < 0.6) {
            const tailSeg = player.segments[0];
            const tx = tailSeg ? tailSeg.x1 : player.x;
            const ty = tailSeg ? tailSeg.y1 : player.y;
            this.spawnExhaust(tx, ty, player.color);
          }
          if (player.boostEnergy <= 0) {
            player.boostLocked = true;
            player.isBoost = false;
          }
        } else {
          player.isBoost = false;
        }
      } else {
        // Boost basılı değilken enerji yavaşça dolar
        player.boostEnergy = Math.min(100, player.boostEnergy + dt * 24);
        if (player.boostEnergy >= 25) {
          player.boostLocked = false;
        }
      }

      if (player.targetAngle !== null && player.targetAngle !== undefined) {
        let diff = player.targetAngle - player.angle;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        if (Math.abs(diff) > Math.PI * 0.88) {
          diff = Math.sign(diff || 1) * Math.PI * 0.88;
        }
        const maxTurn = player.turnSpeed * 1.8 * dt;
        player.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
        if (Math.abs(diff) < 0.05) {
          player.angle = player.targetAngle;
        }
      } else {
        player.angle += player.steer * player.turnSpeed * dt;
      }

      const moveSpeed = player.isBoost ? player.speed * 1.65 : player.speed;
      const prevX = player.x;
      const prevY = player.y;
      const targetX = prevX + Math.cos(player.angle) * moveSpeed * dt;
      const targetY = prevY + Math.sin(player.angle) * moveSpeed * dt;
      const distMoved = Math.hypot(targetX - prevX, targetY - prevY);
      const substeps = getProjectileSubsteps(distMoved, 4);
      let hit = false;

      for (let step = 1; step <= substeps; step++) {
        const ratio = step / substeps;
        player.x = prevX + (targetX - prevX) * ratio;
        player.y = prevY + (targetY - prevY) * ratio;
        if (this.checkCollision(player, now)) {
          hit = true;
          break;
        }
      }

      if (!hit) {
        player.x = targetX;
        player.y = targetY;
      }

      const moved = Math.hypot(player.x - prevX, player.y - prevY);
      const newSeg = { x1: prevX, y1: prevY, x2: player.x, y2: player.y, owner: player.index, dist: moved, createdAt: now, _qstamp: 0 };
      player.segments.push(newSeg);
      player.currentLen += moved;

      if (player.targetLen > SNAKE_MAX_LEN) player.targetLen = SNAKE_MAX_LEN;
      while (player.currentLen > player.targetLen && player.segments.length > 0) {
        const removed = player.segments.shift();
        player.currentLen -= removed.dist;
      }

      // Yem yeme kontrolü
      for (let i = this.foods.length - 1; i >= 0; i--) {
        const f = this.foods[i];
        if (Math.hypot(player.x - f.x, player.y - f.y) < f.size + 4) {
          if (f.type === 'GOLDEN_STAR') {
            player.targetLen += 70;
            player.foodCount = (player.foodCount || 0) + 3;
            this.spawnSparkles(f.x, f.y, '#FFDE59', 16);
          } else if (f.type === 'TURBO_BERRY') {
            player.targetLen += 40;
            player.foodCount = (player.foodCount || 0) + 1;
            player.boostEnergy = Math.min(100, player.boostEnergy + 55);
            player.boostLocked = false;
            this.spawnSparkles(f.x, f.y, '#A259FF', 12);
          } else {
            player.targetLen += 38;
            player.foodCount = (player.foodCount || 0) + 1;
            player.boostEnergy = Math.min(100, player.boostEnergy + 15);
            this.spawnSparkles(f.x, f.y, '#D84727', 8);
          }

          if (player.targetLen > SNAKE_MAX_LEN) player.targetLen = SNAKE_MAX_LEN;
          this.foods.splice(i, 1);
          this.spawnFood();
          playItemPickup();
        }
      }

      if (hit) {
        this.eliminatePlayer(player);
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

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length <= 1) {
      this.handleRoundEnd(alive.length === 1 ? alive[0] : null);
    }
  }

  checkCollision(player, now) {
    const { left, right, top, bottom } = this.arena;
    const r = 5;

    // Dış Saha Sınırları
    if (player.x - r <= left || player.x + r >= right || player.y - r <= top || player.y + r >= bottom) return true;

    // Harita Engel Duvarları (AABB çarpışması)
    for (const w of this.walls) {
      if (player.x + r > w.x && player.x - r < w.x + w.w &&
          player.y + r > w.y && player.y - r < w.y + w.h) {
        return true;
      }
    }

    // Kendi ve diğer yılanların kuyruk gövdeleri
    return this.forEachSegmentNear(player.x, player.y, 12, (seg) => {
      if (seg.owner === player.index && now - seg.createdAt < 220) return false;

      const distSq = distToSegmentSquared(player.x, player.y, seg.x1, seg.y1, seg.x2, seg.y2);
      return distSq <= (r + 3) * (r + 3);
    });
  }

  distToSegmentSquared(px, py, vx, vy, wx, wy) {
    const l2 = (wx - vx) * (wx - vx) + (wy - vy) * (wy - vy);
    if (l2 === 0) return (px - vx) * (px - vx) + (py - vy) * (py - vy);
    const t = Math.max(0, Math.min(1, ((px - vx) * (wx - vx) + (py - vy) * (wy - vy)) / l2));
    const projX = vx + t * (wx - vx);
    const projY = vy + t * (wy - vy);
    return (px - projX) * (px - projX) + (py - projY) * (py - projY);
  }

  spawnExhaust(x, y, color) {
    this.particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 30,
      vy: (Math.random() - 0.5) * 30,
      color: Math.random() < 0.5 ? '#FFDE59' : color,
      radius: 2 + Math.random() * 2.5,
      alpha: 0.8,
      decay: 3.5,
    });
  }

  spawnSparkles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const spd = 35 + Math.random() * 70;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color,
        radius: 2.5 + Math.random() * 2,
        alpha: 1.0,
        decay: 2.2,
      });
    }
  }

  spawnExplosion(x, y, color) {
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 130;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 2 === 0 ? color : '#1A1A1A',
        radius: 3 + Math.random() * 3.5,
        alpha: 1.0,
        decay: 1.6,
      });
    }
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.4);
    playExplosion();
    this.spawnExplosion(player.x, player.y, player.color);

    // Ölen yılanın vücudu zengin meyve parçalarına dönüşür
    let dropCount = 0;
    for (let i = 0; i < player.segments.length; i += 7) {
      if (dropCount >= 7) break;
      const seg = player.segments[i];
      this.spawnFood(seg.x1, seg.y1);
      dropCount++;
    }
    player.segments = [];
    this.segGridDirty = true;
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'SNAKE_DIR') {
      if (Number.isFinite(data.angle)) {
        player.targetAngle = data.angle;
      } else if (Number.isFinite(data.dx) && Number.isFinite(data.dy) && (data.dx !== 0 || data.dy !== 0)) {
        player.targetAngle = Math.atan2(data.dy, data.dx);
      }
      player.steer = 0;
      player.remoteSteerActive = false;
    } else if (data.action === 'SNAKE_STEER' || data.action === 'CURVE_STEER') {
      player.steer = Number.isFinite(data.dir) ? data.dir : 0;
      player.remoteSteerActive = (player.steer !== 0);
      if (player.steer !== 0) player.targetAngle = null;
    } else if (data.action === 'JOYSTICK_MOVE') {
      const dx = data.dx || 0;
      const dy = data.dy || 0;
      if (Math.hypot(dx, dy) > 0.3) {
        player.targetAngle = Math.atan2(dy, dx);
        player.steer = 0;
        player.remoteSteerActive = false;
      }
    } else if (data.action === 'SNAKE_BOOST') {
      player.isBoost = true;
      player.remoteBoostActive = true;
    } else if (data.action === 'SNAKE_BOOST_RELEASE') {
      player.isBoost = false;
      player.remoteBoostActive = false;
    }
  }

  handleRoundEnd(winner) {
    if (!winner) {
      beginDrawRound(this, 'no-survivor', 2.5);
      return;
    }
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.matchDraw = false;
    this.scores[winner.index]++;
    if (this.scores[winner.index] >= this.targetScore) {
      this.state = 'MATCH_OVER';
      this.matchWinner = winner;
      return;
    }
    this.roundTransitionTimer = 2.5;
  }

  render() {
    const { ctx, canvas } = this;
    const now = performance.now();
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    drawSnakeArena(ctx, this.arena, this.walls);

    // masa-ortası kontrolleri sahnenin üstünde, varlıkların altında kalır.
    this.uiButtons = [];
    this.renderControls(ctx, { extraEntities: this.foods });
    drawSnakeFoods(ctx, this.foods, now);
    drawSnakePlayers(ctx, this.players, now);
    drawSnakeParticles(ctx, this.particles);

    this.renderHUD(ctx, {
      guideTitle: t('guide.snake'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: SNAKE_COLORS,
      accent: '#2F6A4F',
      matchOverHeadline: this.matchDraw ? t('game.draw') : t('snake.champ'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★` })),
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

