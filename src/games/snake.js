// BRUTAL SNAKE: 2-4 oyunculu yılan — yemle büyü, duvara/kuyruğa çarpma, boost.
// Uzayan kuyruk ızgarada sorgulanır (uzun oyunda O(n) tarama yok).

import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateSnakeBotAI } from '../ai/snakeAI.js';

export const SNAKE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const SNAKE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

// Lokal klavye: [sol, sağ, boost] — P1 WASD+Space, P2 Oklar+Enter, P3 IJKL+O, P4 TFGH+B
const SNAKE_KEY_SLOTS_PAIRS = [
  ['KeyA', 'KeyD', 'Space'],
  ['ArrowLeft', 'ArrowRight', 'Enter'],
  ['KeyJ', 'KeyL', 'KeyO'],
  ['KeyF', 'KeyH', 'KeyB'],
];
const SNAKE_KEY_SLOTS = {};
SNAKE_KEY_SLOTS_PAIRS.forEach((pair, i) => pair.forEach((c) => (SNAKE_KEY_SLOTS[c] = i)));

// Kuyruk boyu tavanı: uzayan oyunda ızgara-rebuild sınırlı kalır
const SNAKE_MAX_LEN = 300;
const SEG_GRID_CELL = 48;

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

    // İz sorgu ızgarası (hücre → segment referansları) + sorgu damgası
    this.segGrid = new Map();
    this.segGridDirty = false;
    this._segQueryStamp = 0;

    // Köşe dokunmatik: corner -> { id, action } + parmak boost'u
    this.cornerTouches = [
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
      { id: -1, action: null },
    ];
    this.touchBoost = [false, false, false, false];

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
      // Tuş bırakma: o slotta basılı yön kalmadıysa + dokunmatik yoksa düz git
      const slot = SNAKE_KEY_SLOTS[e.code];
      if (slot === undefined) return;
      if (this.cornerTouches[slot]?.id !== -1) return;
      const player = this.players[slot];
      if (player && player.slotType === 'human' && this.keyboardInput(slot).steer === 0) {
        player.steer = 0;
      }
    });
  }

  keyboardInput(index) {
    const keys = SNAKE_KEY_SLOTS_PAIRS[index];
    if (!keys) return { steer: 0, boost: false };
    const l = this.keys[keys[0]] ? -1 : 0;
    const r = this.keys[keys[1]] ? 1 : 0;
    return { steer: l + r, boost: !!this.keys[keys[2]] };
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

    // Maç ortası resize sıfırlamaz: geometri yenilenir, varlıklar orantılı taşınır
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
    }
    for (const p of this.players) {
      for (const seg of p.segments) {
        const a = { x: seg.x1, y: seg.y1 };
        const b = { x: seg.x2, y: seg.y2 };
        this.remapPoint(a, oldArena, this.arena);
        this.remapPoint(b, oldArena, this.arena);
        seg.x1 = a.x; seg.y1 = a.y; seg.x2 = b.x; seg.y2 = b.y;
      }
    }
    this.segGridDirty = true;
    for (const f of this.foods) this.remapPoint(f, oldArena, this.arena);
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
      // Raunt başı TV isimleri silinmez (CROWN deseni)
      const existing = this.players[i];
      return {
        index: i, name: existing?.name || SNAKE_NAMES[i], color: SNAKE_COLORS[i],
        x: s.x, y: s.y, angle: s.angle, speed: 140, turnSpeed: 3.0,
        steer: 0, isBoost: false, isAlive: true, isJoined: this.isSlotJoined(i),
        slotType: this.slotTypes[i], segments: [], currentLen: 0, targetLen: 60,
        botCheckTimer: 0,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.foods = [];
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.onTouchesReset();
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
    this.foods = [];
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.segGrid = new Map();
    this.segGridDirty = false;
    this.onTouchesReset();
    playStart();
    this.initPlayers();
    this.players.forEach((p) => { p.isAlive = p.isJoined; });
    for (let i = 0; i < 3; i++) this.spawnFood();
  }

  spawnFood(x, y) {
    if (x === undefined || y === undefined) {
      x = this.arena.left + 30 + Math.random() * (this.arena.width - 60);
      y = this.arena.top + 30 + Math.random() * (this.arena.height - 60);
    }
    this.foods.push({ x, y, size: 14, id: Math.random() });
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

  getCornerZone(pos) {
    const { cx, cy } = this.arena;
    const isLeft = pos.x < cx;
    const isTop = pos.y < cy;
    if (isLeft && !isTop) return 0;
    if (isLeft && isTop) return 1;
    if (!isLeft && isTop) return 2;
    return 3;
  }

  determineSteer(cornerIndex, touch) {
    const { cx, left, right } = this.arena;
    const isLeftQuadrant = cornerIndex === 0 || cornerIndex === 1;
    const qMidX = isLeftQuadrant ? (left + cx) / 2 : (cx + right) / 2;
    const isTop = cornerIndex === 1 || cornerIndex === 2;
    if (isTop) {
      // Üst oyuncu karşıdan bakar: ekran sağı onun soludur
      return touch.x >= qMidX ? -1 : 1;
    } else {
      // Alt oyuncu: ekran solu onun soludur
      return touch.x < qMidX ? -1 : 1;
    }
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
      const corner = this.getCornerZone(touch);
      const player = this.players[corner];
      if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;
      // İkinci parmak aynı köşede = boost basılı
      if (this.cornerTouches[corner].id !== -1) {
        this.touchBoost[corner] = true;
        player.isBoost = true;
        return;
      }
      const steerVal = this.determineSteer(corner, touch);
      this.cornerTouches[corner] = { id: touch.id, action: steerVal < 0 ? 'left' : 'right' };
      player.steer = steerVal;
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        const steerVal = this.determineSteer(i, touch);
        const action = steerVal < 0 ? 'left' : 'right';
        this.cornerTouches[i].action = action;
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human') {
          player.steer = steerVal;
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouches[i] && this.cornerTouches[i].id === touch.id) {
        this.cornerTouches[i] = { id: -1, action: null };
        this.touchBoost[i] = false;
        const player = this.players[i];
        if (player && player.slotType === 'human') {
          player.steer = 0;
          player.isBoost = this.keyboardInput(i).boost;
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
    this.touchBoost = [false, false, false, false];
    this.players.forEach((p) => { p.steer = 0; p.isBoost = false; });
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.08);
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

    // Her frame kuyruk kısaldığı için ızgara kirli işaretlenir (tavanlı boyda ucuz)
    this.segGridDirty = true;

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.slotType !== 'human') {
        updateSnakeBotAI(this, player, dt);
      } else {
        // Klavye eklemeli: basılı yön yazar, basılı değilse ve kumanda/dokunmatik yoksa düz git
        const ki = this.keyboardInput(player.index);
        if (ki.steer !== 0) {
          player.steer = ki.steer;
        } else if (!player.remoteSteerActive && this.cornerTouches[player.index]?.id === -1) {
          player.steer = 0;
        }
        player.isBoost = ki.boost || this.touchBoost[player.index] || !!player.remoteBoostActive;
      }

      player.angle += player.steer * player.turnSpeed * dt;
      const moveSpeed = player.isBoost ? player.speed * 1.6 : player.speed;
      const prevX = player.x;
      const prevY = player.y;

      player.x += Math.cos(player.angle) * moveSpeed * dt;
      player.y += Math.sin(player.angle) * moveSpeed * dt;

      const distMoved = Math.hypot(player.x - prevX, player.y - prevY);

      const newSeg = { x1: prevX, y1: prevY, x2: player.x, y2: player.y, owner: player.index, dist: distMoved, createdAt: now, _qstamp: 0 };
      player.segments.push(newSeg);
      player.currentLen += distMoved;

      // Kuyruk boyu tavanlı (hedef + mevcut birlikte budanır)
      if (player.targetLen > SNAKE_MAX_LEN) player.targetLen = SNAKE_MAX_LEN;
      while (player.currentLen > player.targetLen && player.segments.length > 0) {
        const removed = player.segments.shift();
        player.currentLen -= removed.dist;
      }

      // Yem yeme kontrolü
      for (let i = this.foods.length - 1; i >= 0; i--) {
        if (Math.hypot(player.x - this.foods[i].x, player.y - this.foods[i].y) < 16) {
          player.targetLen += 40;
          if (player.targetLen > SNAKE_MAX_LEN) player.targetLen = SNAKE_MAX_LEN;
          player.foodCount = (player.foodCount || 0) + 1;
          this.spawnSparkles(this.foods[i].x, this.foods[i].y, player.color);
          this.foods.splice(i, 1);
          this.spawnFood();
          playItemPickup();
        }
      }

      if (this.checkCollision(player, now)) {
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
    const r = 4;

    if (player.x - r <= left || player.x + r >= right || player.y - r <= top || player.y + r >= bottom) return true;

    return this.forEachSegmentNear(player.x, player.y, 12, (seg) => {
      if (seg.owner === player.index && now - seg.createdAt < 250) return false;

      const distSq = this.distToSegmentSquared(player.x, player.y, seg.x1, seg.y1, seg.x2, seg.y2);
      return distSq <= (r + 2) * (r + 2);
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

  spawnSparkles(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      const spd = 30 + Math.random() * 60;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: '#FFDE59',
        radius: 2.5 + Math.random() * 2,
        alpha: 1.0,
        decay: 2.5,
      });
    }
  }

  spawnExplosion(x, y, color) {
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 120;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 2 === 0 ? color : '#1A1A1A',
        radius: 3 + Math.random() * 3,
        alpha: 1.0,
        decay: 1.8,
      });
    }
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.4);
    playExplosion();
    this.spawnExplosion(player.x, player.y, player.color);

    // Ölenin kuyruğu yeme dönüşür (max 6)
    let dropCount = 0;
    for (let i = 0; i < player.segments.length; i += 8) {
      if (dropCount >= 6) break;
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
    if (data.action === 'SNAKE_STEER' || data.action === 'CURVE_STEER') {
      player.steer = Number.isFinite(data.dir) ? data.dir : 0;
      player.remoteSteerActive = (player.steer !== 0);
    } else if (data.action === 'JOYSTICK_MOVE') {
      const dir = Number.isFinite(data.dir) ? data.dir : (Number.isFinite(data.dx) ? data.dx : 0);
      player.steer = Math.max(-1, Math.min(1, dir));
      player.remoteSteerActive = (player.steer !== 0);
    } else if (data.action === 'SNAKE_BOOST') {
      player.isBoost = true;
      player.remoteBoostActive = true;
    } else if (data.action === 'SNAKE_BOOST_RELEASE') {
      player.isBoost = false;
      player.remoteBoostActive = false;
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    if (winner) {
      this.scores[winner.index]++;
      if (this.scores[winner.index] >= this.targetScore) {
        this.state = 'MATCH_OVER';
        this.matchWinner = winner;
        return;
      }
    }
    this.roundTransitionTimer = 2.5;
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

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 6;
    ctx.strokeRect(left, top, width, height);

    // Yemler
    for (const f of this.foods) {
      ctx.fillStyle = '#1A1A1A';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.size / 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#D99B26';
      ctx.beginPath(); ctx.arc(f.x - 2, f.y - 2, f.size / 4, 0, Math.PI * 2); ctx.fill();
    }

    // Yılanlar
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      ctx.lineWidth = 8;
      ctx.strokeStyle = player.color;
      ctx.beginPath();
      if (player.segments.length > 0) {
        ctx.moveTo(player.segments[0].x1, player.segments[0].y1);
        for (const seg of player.segments) ctx.lineTo(seg.x2, seg.y2);
      }
      ctx.stroke();

      // Kafa (+ boost parlaması)
      if (player.isBoost) {
        ctx.fillStyle = '#FFDE59';
        ctx.beginPath(); ctx.arc(player.x, player.y, 9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = player.color;
      ctx.beginPath(); ctx.arc(player.x, player.y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#FFF';
      ctx.beginPath(); ctx.arc(player.x + Math.cos(player.angle) * 3, player.y + Math.sin(player.angle) * 3, 2, 0, Math.PI * 2); ctx.fill();
    }

    // Parçacık çizimi
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'SOL/SAĞ: YÖN VER • ÇİFT PARMAK: HIZLAN • DUVARA ÇARPMA', [
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
          playerColor: SNAKE_COLORS[i],
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
      renderLobbyStartButton(ctx, { arena: this.arena, uiButtons: this.uiButtons, joinedCount, accent: '#2F6A4F', onStart: () => this.startNewMatch(), hidden: !!this.hideLobbyStartButton });
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? `${this.roundWinner.name} KAZANDI!` : 'BERABERE!', titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, {
        arena: this.arena,
        uiButtons: this.uiButtons,
        headline: 'YILAN ŞAMPİYONU!',
        winnerName: this.matchWinner ? this.matchWinner.name : '',
        winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A',
        rows: this.players
          .filter((p) => p.isJoined)
          .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★` })),
        onRestart: () => this.startNewMatch(),
      });
    }

    ctx.restore();
  }
}
