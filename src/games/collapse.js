// BRUTAL COLLAPSE: 2-4 oyunculu çöken zemin — ayakta kal, zıplayarak boşlukları geç,
// rakipleri iniş şokuyla it, güçlendirmeleri topla ve sona kalan ol.
// Otomatik rastgele harita varyasyonları, 3D derinlikli zeminler ve dinamik parçalanma.

import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton, getSeatColorDotRect } from '../controlGuide.js';
import { getLocalSeatColors } from '../core/customizationManager.js';
import { renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateCollapseBotAI } from '../ai/collapseAI.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';

export const COLLAPSE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const COLLAPSE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

const COLLAPSE_KEY_SLOTS = [
  { u: 'KeyW', d: 'KeyS', l: 'KeyA', r: 'KeyD', action: 'Space' },
  { u: 'ArrowUp', d: 'ArrowDown', l: 'ArrowLeft', r: 'ArrowRight', action: 'Enter' },
  { u: 'KeyI', d: 'KeyK', l: 'KeyJ', r: 'KeyL', action: 'KeyO' },
  { u: 'KeyT', d: 'KeyG', l: 'KeyF', r: 'KeyH', action: 'KeyB' },
];

const COLLAPSE_JUMP_COOLDOWN = 1.6;

// 5 Farklı Rastgele Harita Tasarımı
export const COLLAPSE_MAPS = [
  {
    id: 'classic',
    name: 'STANDART ARENA',
    generate: (rows, cols) => {
      const g = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          const isCorner = (r <= 1 && c <= 1 && r + c < 2) ||
                           (r <= 1 && c >= cols - 2 && (cols - 1 - c) + r < 2) ||
                           (r >= rows - 2 && c <= 1 && (rows - 1 - r) + c < 2) ||
                           (r >= rows - 2 && c >= cols - 2 && (rows - 1 - r) + (cols - 1 - c) < 2);
          row.push(isCorner ? 2 : 0);
        }
        g.push(row);
      }
      return g;
    },
  },
  {
    id: 'islands',
    name: '4 ADA & KÖPRÜLER',
    generate: (rows, cols) => {
      const g = [];
      const midR = Math.floor(rows / 2);
      const midC = Math.floor(cols / 2);
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          // Ada sınırları
          const inIsland = (r < midR - 1 || r > midR + 1) && (c < midC - 1 || c > midC + 1);
          // Köprüler
          const isBridge = (r === midR && c > 1 && c < cols - 2) || (c === midC && r > 1 && r < rows - 2);
          const isCenter = r === midR && c === midC;
          row.push(inIsland || isBridge || isCenter ? 0 : 2);
        }
        g.push(row);
      }
      return g;
    },
  },
  {
    id: 'donut',
    name: 'HALKA & MERKEZ',
    generate: (rows, cols) => {
      const g = [];
      const midR = (rows - 1) / 2;
      const midC = (cols - 1) / 2;
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          const dist = Math.hypot(r - midR, c - midC);
          const isCenter = dist <= 1.8;
          const isRing = dist >= 3.4 && dist <= 5.4;
          const isCrossWalk = (Math.abs(r - midR) <= 0.5 || Math.abs(c - midC) <= 0.5) && dist <= 3.8;
          row.push(isCenter || isRing || isCrossWalk ? 0 : 2);
        }
        g.push(row);
      }
      return g;
    },
  },
  {
    id: 'diamond',
    name: 'ELMAS PİRAMİT',
    generate: (rows, cols) => {
      const g = [];
      const midR = (rows - 1) / 2;
      const midC = (cols - 1) / 2;
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          const manhattan = Math.abs(r - midR) + Math.abs(c - midC);
          row.push(manhattan <= 6.2 ? 0 : 2);
        }
        g.push(row);
      }
      return g;
    },
  },
  {
    id: 'corridors',
    name: 'DAR KORİDORLAR',
    generate: (rows, cols) => {
      const g = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          const isBorder = r === 0 || r === rows - 1 || c === 0 || c === cols - 1;
          const isOuterCorridor = r === 2 || r === rows - 3 || c === 2 || c === cols - 3;
          const isCenterCross = (r === 6 && c >= 3 && c <= 9) || (c === 6 && r >= 3 && r <= 9);
          row.push(!isBorder && (isOuterCorridor || isCenterCross) ? 0 : 2);
        }
        g.push(row);
      }
      return g;
    },
  },
];

export class CollapseGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.arena = { cx: 0, cy: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];
    this.scores = [0, 0, 0, 0];
    this.targetScore = 5;
    this.players = [];
    this.particles = [];
    this.fallingTiles = [];
    this.pickups = [];
    this.shockwaves = [];

    // Izgara: 0 sağlam, 1 uyarı (çöküyor), 2 boşluk
    this.gridCOLS = 13;
    this.gridROWS = 13;
    this.grid = [];
    this.cellSize = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.mapIndex = 0;
    this.pickupSpawnTimer = 3.0;

    this.keys = {};
    this.roundTransitionTimer = 0;
    this.touches = [
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
      { active: false, cx: 0, cy: 0, jx: 0, jy: 0, id: -1, actionId: -1 },
    ];

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

  keyboardInput(index) {
    const map = COLLAPSE_KEY_SLOTS[index];
    if (!map) return { dx: 0, dy: 0, action: false };
    const dx = (this.keys[map.r] ? 1 : 0) - (this.keys[map.l] ? 1 : 0);
    const dy = (this.keys[map.d] ? 1 : 0) - (this.keys[map.u] ? 1 : 0);
    return { dx, dy, action: !!this.keys[map.action] };
  }

  pickRandomMap() {
    this.mapIndex = Math.floor(Math.random() * COLLAPSE_MAPS.length);
    this.buildGrid();
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

    this.cellSize = this.arena.size / this.gridCOLS;
    this.offsetX = this.arena.cx - (this.gridCOLS * this.cellSize) / 2;
    this.offsetY = this.arena.cy - (this.gridROWS * this.cellSize) / 2;

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      this.buildGrid();
    } else {
      for (const p of this.players) this.remapPoint(p, oldArena, this.arena);
    }
  }

  buildGrid() {
    const mapDef = COLLAPSE_MAPS[this.mapIndex] || COLLAPSE_MAPS[0];
    const rawGrid = mapDef.generate(this.gridROWS, this.gridCOLS);
    this.grid = [];
    for (let r = 0; r < this.gridROWS; r++) {
      const row = [];
      for (let c = 0; c < this.gridCOLS; c++) {
        row.push({ state: rawGrid[r][c], timer: 0 });
      }
      this.grid.push(row);
    }
  }

  initPlayers() {
    const p = this.arena.size * 0.26;
    const spawns = [
      { x: this.arena.cx - p, y: this.arena.cy + p },
      { x: this.arena.cx - p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy - p },
      { x: this.arena.cx + p, y: this.arena.cy + p },
    ];

    this.players = spawns.map((s, i) => {
      const existing = this.players[i];
      return {
        index: i, name: existing?.name || COLLAPSE_NAMES[i], color: COLLAPSE_COLORS[i],
        x: s.x, y: s.y, angle: 0,
        speed: 125, steerX: 0, steerY: 0,
        isAlive: true, isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        jumpTimer: 0, jumpCooldown: 0, wasJumping: false,
        superJumpTimer: 0,
        botCheckTimer: 0, keyActionLatch: false,
      };
    });
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.pickups = [];
    this.fallingTiles = [];
    this.shockwaves = [];
    this.pickRandomMap();
    this.initPlayers();
    this.onTouchesReset();
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
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.pickups = [];
    this.fallingTiles = [];
    this.shockwaves = [];
    this.pickupSpawnTimer = 3.5;
    this.onTouchesReset();
    playStart();
    this.pickRandomMap();

    // Doğma noktalarının sağlam zemin olduğundan emin ol
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
      player.jumpTimer = 0;
      player.jumpCooldown = 0;
      player.wasJumping = false;
      player.superJumpTimer = 0;
      player.steerX = 0;
      player.steerY = 0;

      // Oyuncunun altındaki 2x2 alanı güvenli yap
      const cx = Math.floor((player.x - this.offsetX) / this.cellSize);
      const cy = Math.floor((player.y - this.offsetY) / this.cellSize);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const tx = cx + dx, ty = cy + dy;
          if (tx >= 0 && tx < this.gridCOLS && ty >= 0 && ty < this.gridROWS) {
            this.grid[ty][tx] = { state: 0, timer: 0 };
          }
        }
      }
    });
  }

  attemptJump(player) {
    if (this.state !== 'PLAYING') return;
    if (player.jumpCooldown <= 0) {
      const isSuper = player.superJumpTimer > 0;
      player.jumpTimer = isSuper ? 0.65 : 0.45;
      player.jumpCooldown = isSuper ? 0.8 : COLLAPSE_JUMP_COOLDOWN;
      player.wasJumping = true;
      playItemPickup();
      this.spawnJumpDust(player.x, player.y);
    }
  }

  spawnJumpDust(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 40;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: '#FAF7F2',
        radius: 2.5 + Math.random() * 2,
        alpha: 0.8,
        decay: 3.0,
      });
    }
  }

  triggerLandingStomp(player) {
    // İniş Şok Dalgası: Yakındaki rakipleri hafifçe dışarı iter
    this.addTrauma(0.2);
    this.shockwaves.push({ x: player.x, y: player.y, radius: 8, maxRadius: 52, color: player.color, alpha: 0.8 });
    this.spawnJumpDust(player.x, player.y);

    for (const victim of this.players) {
      if (!victim.isJoined || !victim.isAlive || victim.index === player.index || victim.jumpTimer > 0) continue;
      const dx = victim.x - player.x;
      const dy = victim.y - player.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 48 && dist > 1) {
        const pushForce = (48 - dist) * 1.8;
        victim.x += (dx / dist) * pushForce;
        victim.y += (dy / dist) * pushForce;
      }
    }
  }

  spawnPickup() {
    // Rastgele sağlam bir karo seç
    const validTiles = [];
    for (let r = 0; r < this.gridROWS; r++) {
      for (let c = 0; c < this.gridCOLS; c++) {
        if (this.grid[r][c].state === 0) {
          validTiles.push({ r, c });
        }
      }
    }
    if (!validTiles.length) return;
    const t = validTiles[Math.floor(Math.random() * validTiles.length)];
    const x = this.offsetX + (t.c + 0.5) * this.cellSize;
    const y = this.offsetY + (t.r + 0.5) * this.cellSize;

    const types = ['SUPER_JUMP', 'REPAIR_TILES', 'BLAST_WAVE'];
    const type = types[Math.floor(Math.random() * types.length)];

    this.pickups.push({
      x, y,
      type,
      id: Math.random(),
      life: 12.0,
      pulse: 0,
    });
  }

  getQuadrant(x, y) {
    const { cx, cy } = this.arena;
    if (x < cx && y >= cy) return 0;
    if (x < cx && y < cy) return 1;
    if (x >= cx && y < cy) return 2;
    return 3;
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 65) {
        if (this.slotTypes.filter((s) => s !== 'empty').length >= 2) this.startNewMatch();
        return;
      }
      const q = this.getQuadrant(touch.x, touch.y);
      this.cycleSlotType(q);
      if (this.players[q]) {
        this.players[q].isJoined = this.isSlotJoined(q);
        this.players[q].slotType = this.slotTypes[q];
      }
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 75) {
        this.resetMatch();
        playJoin();
      }
      return;
    }

    if (this.state === 'PLAYING') {
      const q = this.getQuadrant(touch.x, touch.y);
      const player = this.players[q];
      if (!player || !player.isJoined || !player.isAlive || player.slotType !== 'human') return;

      const t = this.touches[q];
      const isRightSide = (q === 0 || q === 1)
        ? (touch.x > this.arena.left + this.arena.width / 4)
        : (touch.x > this.arena.right - this.arena.width / 4);

      if (isRightSide && t.actionId === -1) {
        t.actionId = touch.id;
        this.attemptJump(player);
      } else if (!isRightSide && t.id === -1) {
        t.active = true;
        t.id = touch.id;
        t.cx = touch.x;
        t.cy = touch.y;
        t.jx = touch.x;
        t.jy = touch.y;
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.active && t.id === touch.id) {
        t.jx = touch.x;
        t.jy = touch.y;
        const dx = t.jx - t.cx;
        const dy = t.jy - t.cy;
        const dist = Math.hypot(dx, dy);
        const player = this.players[i];
        if (player && player.isAlive && player.slotType === 'human' && dist > 10) {
          player.steerX = dx / dist;
          player.steerY = dy / dist;
        }
      }
    }
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      const t = this.touches[i];
      if (t.id === touch.id) {
        t.active = false;
        t.id = -1;
        if (this.players[i] && this.players[i].slotType === 'human') {
          this.players[i].steerX = 0;
          this.players[i].steerY = 0;
        }
      }
      if (t.actionId === touch.id) {
        t.actionId = -1;
      }
    }
  }

  onTouchesReset() {
    this.touches.forEach((t) => { t.active = false; t.id = -1; t.actionId = -1; });
    this.players.forEach((p) => { p.steerX = 0; p.steerY = 0; });
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

    // Güçlendirme periyodu
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupSpawnTimer = 6.0 + Math.random() * 4.0;
    }

    // Izgara zamanlayıcıları: uyarı süresi dolan kare 3D boşluğa düşer
    for (let r = 0; r < this.gridROWS; r++) {
      for (let c = 0; c < this.gridCOLS; c++) {
        const tile = this.grid[r][c];
        if (tile.state === 1) {
          tile.timer -= dt;
          if (tile.timer <= 0) {
            tile.state = 2;
            const cx = this.offsetX + (c + 0.5) * this.cellSize;
            const cy = this.offsetY + (r + 0.5) * this.cellSize;
            this.spawnCrumble(cx, cy);
            // Düşen 3D blok efekti
            this.fallingTiles.push({
              x: cx, y: cy, size: this.cellSize * 0.9,
              vy: 60, vz: 180, scale: 1.0, rot: (Math.random() - 0.5) * 2,
              alpha: 1.0,
            });
          }
        }
      }
    }

    // Düşen blokların fiziği
    for (let i = this.fallingTiles.length - 1; i >= 0; i--) {
      const ft = this.fallingTiles[i];
      ft.y += ft.vy * dt;
      ft.scale -= dt * 0.7;
      ft.alpha -= dt * 1.3;
      if (ft.alpha <= 0 || ft.scale <= 0) {
        this.fallingTiles.splice(i, 1);
      }
    }

    // Şok dalgaları
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.radius += dt * 110;
      sw.alpha -= dt * 1.8;
      if (sw.alpha <= 0 || sw.radius >= sw.maxRadius) {
        this.shockwaves.splice(i, 1);
      }
    }

    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      if (player.jumpCooldown > 0) player.jumpCooldown -= dt;
      if (player.superJumpTimer > 0) player.superJumpTimer -= dt;

      if (player.jumpTimer > 0) {
        player.jumpTimer -= dt;
        if (player.jumpTimer <= 0 && player.wasJumping) {
          player.wasJumping = false;
          this.triggerLandingStomp(player);
        }
      }

      if (player.slotType !== 'human') {
        updateCollapseBotAI(this, player, dt);
      } else {
        const ki = this.keyboardInput(player.index);
        if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
          player.keyHeld = true;
        } else if (player.keyHeld) {
          player.keyHeld = false;
          if (!this.touches[player.index].active && !player.remoteActive) {
            player.steerX = 0;
            player.steerY = 0;
          }
        } else if (!this.touches[player.index].active && !player.remoteActive) {
          player.steerX = 0;
          player.steerY = 0;
        }

        if (ki.action && !player.keyActionLatch) {
          this.attemptJump(player);
          player.keyActionLatch = true;
        } else if (!ki.action) {
          player.keyActionLatch = false;
        }
      }

      const spd = player.jumpTimer > 0 ? player.speed * 1.85 : player.speed;
      player.x += player.steerX * spd * dt;
      player.y += player.steerY * spd * dt;

      // Zemin etkileşimi (sadece yerdeyken)
      if (player.jumpTimer <= 0) {
        const cx = Math.floor((player.x - this.offsetX) / this.cellSize);
        const cy = Math.floor((player.y - this.offsetY) / this.cellSize);

        if (cx < 0 || cx >= this.gridCOLS || cy < 0 || cy >= this.gridROWS || this.grid[cy][cx].state === 2) {
          this.eliminatePlayer(player);
          continue;
        }

        if (this.grid[cy][cx].state === 0) {
          this.grid[cy][cx].state = 1;
          this.grid[cy][cx].timer = 0.85;
        }
      }

      // Güçlendirme toplama
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const pu = this.pickups[i];
        if (Math.hypot(player.x - pu.x, player.y - pu.y) < 24) {
          playItemPickup();
          if (pu.type === 'SUPER_JUMP') {
            player.superJumpTimer = 6.0;
            player.jumpCooldown = 0;
          } else if (pu.type === 'REPAIR_TILES') {
            // Etrafındaki 3x3 karoları onar
            const cx = Math.floor((player.x - this.offsetX) / this.cellSize);
            const cy = Math.floor((player.y - this.offsetY) / this.cellSize);
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const tx = cx + dx, ty = cy + dy;
                if (tx >= 0 && tx < this.gridCOLS && ty >= 0 && ty < this.gridROWS) {
                  this.grid[ty][tx] = { state: 0, timer: 0 };
                }
              }
            }
          } else if (pu.type === 'BLAST_WAVE') {
            this.triggerLandingStomp(player);
          }
          this.pickups.splice(i, 1);
        }
      }
    }

    // İtme: havadakiler itişe katılmaz
    for (let i = 0; i < this.players.length; i++) {
      const p1 = this.players[i];
      if (!p1.isJoined || !p1.isAlive || p1.jumpTimer > 0) continue;

      for (let j = i + 1; j < this.players.length; j++) {
        const p2 = this.players[j];
        if (!p2.isJoined || !p2.isAlive || p2.jumpTimer > 0) continue;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        const minDist = 18;

        if (dist < minDist && dist > 0.1) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
          p1.x -= nx * overlap * 0.5;
          p1.y -= ny * overlap * 0.5;
          p2.x += nx * overlap * 0.5;
          p2.y += ny * overlap * 0.5;
        }
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

  spawnCrumble(x, y) {
    for (let i = 0; i < 8; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 20 + Math.random() * 60;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd + 35,
        color: '#D99B26',
        radius: 2 + Math.random() * 2.5,
        alpha: 1.0,
        decay: 2.0,
      });
    }
  }

  spawnVoidDust(x, y, color) {
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 30 + Math.random() * 90;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: i % 2 === 0 ? color : '#FAF7F2',
        radius: 3 + Math.random() * 3,
        alpha: 1.0,
        decay: 1.8,
      });
    }
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    this.addTrauma(0.45);
    playExplosion();
    this.spawnVoidDust(player.x, player.y, player.color);
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
      const force = Number.isFinite(data.force) ? data.force : Math.hypot(data.dx || 0, data.dy || 0);
      if (force > 0.08) {
        if (Number.isFinite(data.angle)) {
          player.steerX = Math.cos(data.angle);
          player.steerY = Math.sin(data.angle);
        } else {
          const dx = Number.isFinite(data.dx) ? data.dx : 0;
          const dy = Number.isFinite(data.dy) ? data.dy : 0;
          const mag = Math.hypot(dx, dy) || 1;
          player.steerX = dx / mag;
          player.steerY = dy / mag;
        }
        player.remoteActive = true;
      } else {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
    } else if (data.action === 'DASH' || data.action === 'JUMP') {
      this.attemptJump(player);
    }
  }

  handleRoundEnd(winner) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winner;
    this.roundTransitionTimer = 2.5;
    if (winner) {
      this.scores[winner.index]++;
      if (this.scores[winner.index] >= this.targetScore) {
        this.matchWinner = winner;
      }
    }
  }

  render() {
    const { ctx, canvas } = this;
    const now = performance.now();
    ctx.save();

    // 1. KARANLIK UÇURUM ARKA PLANI
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx);

    // Boşluk derinlik ızgarası
    ctx.strokeStyle = '#1F1F1F';
    ctx.lineWidth = 1;
    const abyssStep = 40;
    for (let x = 0; x < canvas.width; x += abyssStep) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += abyssStep) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER') {
      renderCornerScores(ctx, { arena: this.arena, entries: this.players.map((p) => p.isJoined ? { color: p.color, text: `${this.scores[p.index]}★` } : null) });
    }

    // 2. DÜŞEN 3D BLOKLAR (Uçurumda aşağı düşenler)
    for (const ft of this.fallingTiles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.translate(ft.x, ft.y);
      ctx.scale(ft.scale, ft.scale);
      ctx.fillStyle = '#D99B26';
      ctx.fillRect(-ft.size / 2, -ft.size / 2, ft.size, ft.size);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2;
      ctx.strokeRect(-ft.size / 2, -ft.size / 2, ft.size, ft.size);
      ctx.restore();
    }

    // 3. 3D IZGARA ZEMİNİ (Derinlikli Bloklar)
    const padding = 1.5;
    const bevel = 4;

    for (let r = 0; r < this.gridROWS; r++) {
      for (let c = 0; c < this.gridCOLS; c++) {
        const tile = this.grid[r][c];
        if (tile.state === 2) continue;

        const tx = this.offsetX + c * this.cellSize;
        const ty = this.offsetY + r * this.cellSize;
        const tw = this.cellSize - padding * 2;
        const th = this.cellSize - padding * 2;

        let wobbleX = 0, wobbleY = 0;
        if (tile.state === 1) {
          wobbleX = (Math.random() - 0.5) * 3;
          wobbleY = (Math.random() - 0.5) * 3;
        }

        const bx = tx + padding + wobbleX;
        const by = ty + padding + wobbleY;

        // 3D Taban Gölgesi
        ctx.fillStyle = '#0B0B0B';
        ctx.fillRect(bx, by + bevel, tw, th);

        if (tile.state === 0) {
          // Sağlam zemin
          ctx.fillStyle = '#FAF7F2';
          ctx.fillRect(bx, by, tw, th);
          ctx.strokeStyle = '#2B2B2B';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(bx, by, tw, th);
        } else {
          // Uyarı / Çöken Zemin (Sarıdan kızıl kırmızıya + çatlaklar)
          const ratio = Math.max(0, Math.min(1, tile.timer / 0.85));
          ctx.fillStyle = `rgb(255, ${Math.floor(ratio * 180 + 30)}, 40)`;
          ctx.fillRect(bx, by, tw, th);
          ctx.strokeStyle = '#D84727';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, tw, th);

          // Çatlak Çizgileri
          ctx.strokeStyle = 'rgba(26,26,26,0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bx + 4, by + 4);
          ctx.lineTo(bx + tw * 0.45, by + th * 0.55);
          ctx.lineTo(bx + tw - 4, by + th - 4);
          ctx.moveTo(bx + tw - 4, by + 4);
          ctx.lineTo(bx + tw * 0.5, by + th * 0.5);
          ctx.stroke();
        }
      }
    }

    // 4. ŞOK DALGALARI
    for (const sw of this.shockwaves) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, sw.alpha);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. GÜÇLENDİRMELER (Pickups)
    for (const pu of this.pickups) {
      const pulse = 1 + Math.sin(now / 200 + pu.pulse) * 0.12;
      const r = 13 * pulse;

      ctx.save();
      ctx.translate(pu.x, pu.y);

      // Zemin Halka Işığı
      ctx.strokeStyle = pu.type === 'SUPER_JUMP' ? '#FFDE59' : (pu.type === 'REPAIR_TILES' ? '#2F6A4F' : '#1D5D8A');
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();

      ctx.fillStyle = '#FAF7F2';
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1A1A1A'; ctx.lineWidth = 2; ctx.stroke();

      ctx.font = '900 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const icon = pu.type === 'SUPER_JUMP' ? '🦘' : (pu.type === 'REPAIR_TILES' ? '🔨' : '💨');
      ctx.fillText(icon, 0, 0);

      ctx.restore();
    }

    // 6. OYUNCULAR (Havada yükselme, gölge derinliği ve şok halkası)
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      const isJumping = player.jumpTimer > 0;
      const jumpProgress = isJumping ? (player.jumpTimer / 0.45) : 0;
      const jumpHeight = isJumping ? Math.sin(jumpProgress * Math.PI) * 16 : 0;
      const scale = 1.0 + (jumpHeight / 16) * 0.45;

      ctx.save();
      // Zemin Gölgesi
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.arc(player.x, player.y + 4, Math.max(4, 9 - jumpHeight * 0.3), 0, Math.PI * 2);
      ctx.fill();

      // Oyuncu Gövdesi (Zıplama yüksekliği kadar yukarı çizilir)
      ctx.translate(player.x, player.y - jumpHeight);
      ctx.scale(scale, scale);

      // Süper Zıplama Aurası
      if (player.superJumpTimer > 0) {
        ctx.strokeStyle = '#FFDE59';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2); ctx.stroke();
      }

      drawBrutalAvatar(ctx, 0, 0, 9.5, {
        color: player.color,
        slotIndex: player.index,
        label: `P${player.index + 1}`,
        expression: isJumping ? 'excited' : (player.superJumpTimer > 0 ? 'wink' : 'normal'),
        showPointer: false,
        borderWidth: 2.5,
        shadowOffset: 2,
      });

      ctx.restore();
    }

    // 7. PARÇACIKLAR
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.alpha));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Lokal Dokunmatik Kontroller
    if (this.state === 'PLAYING' && this.isLocalInputActive) {
      for (let i = 0; i < 4; i++) {
        const t = this.touches[i];
        if (t.active) {
          ctx.beginPath(); ctx.arc(t.cx, t.cy, 32, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(t.jx, t.jy, 16, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
        }
      }
    }

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'JOYSTICK: HAREKET ET • AKSİYON: ZIPLA & ŞOK DALGASI AT', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      const seatRects = getStandardSeatRects(this.arena);
      const localMode = !this.hideLobbyStartButton;
      const localColors = localMode ? getLocalSeatColors() : null;
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
          playerColor: COLLAPSE_COLORS[i],
          rotation: isTop ? Math.PI : 0,
          seatColor: localMode ? (localColors[i] || COLLAPSE_COLORS[i]) : null,
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
      renderLobbyStartButton(ctx, { arena: this.arena, uiButtons: this.uiButtons, joinedCount, accent: '#D84727', onStart: () => this.startNewMatch(), hidden: !!this.hideLobbyStartButton });
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, { arena: this.arena, title: this.roundWinner ? `${this.roundWinner.name} KAZANDI!` : 'BERABERE!', titleColor: this.roundWinner ? this.roundWinner.color : '#FFFFFF' });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, { arena: this.arena, uiButtons: this.uiButtons, headline: 'ÇÖKÜŞ ŞAMPİYONU', winnerName: this.matchWinner ? this.matchWinner.name : '', winnerColor: this.matchWinner ? this.matchWinner.color : '#FFFFFF', rows: this.players.filter((p) => p.isJoined).map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index]}★` })), onRestart: () => this.startNewMatch() });
    }

    ctx.restore();
  }
}
