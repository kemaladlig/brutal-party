// BRUTAL COLLAPSE: 2-4 oyunculu çöken zemin — ayakta kal, zıplayarak boşlukları geç,
// rakipleri iniş şokuyla it, güçlendirmeleri topla ve sona kalan ol.
// Otomatik rastgele harita varyasyonları, 3D derinlikli zeminler ve dinamik parçalanma.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { playExplosion, playStart, playJoin, playItemPickup } from '../audio.js';
import { t } from '../i18n.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { bindKeyboard } from '../core/keyboardDispatch.js';
import { updateCollapseBotAI } from '../ai/collapseAI.js';
import { readSlotKeys } from '../core/inputMaps.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import {
  createCollapseWorldPacket,
  drawCollapseFalling,
  drawCollapseGrid,
  drawCollapseWaves,
  drawCollapsePickups,
  drawCollapsePlayers,
  drawCollapseFxLayer,
} from './collapseView.js';
import { drawFxFlash } from './worldCore.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { beginRound, endMatch, tickRoundFlow } from '../core/roundLifecycle.js';
import { tickPickupTimers } from '../core/pickupSystem.js';
import { computePlayfield, fieldSpeed, fieldRadius } from '../core/playfield.js';
import { paintBackdrop } from '../core/fieldKit.js';

export const COLLAPSE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const COLLAPSE_NAMES = ['P1', 'P2', 'P3', 'P4'];

const COLLAPSE_JUMP_COOLDOWN = 1.6;
const COLLAPSE_ROUND_TIME = 60;
const COLLAPSE_MAX_TIED_ROUNDS = 2;
const COLLAPSE_RADIUS = 36;
const COLLAPSE_MOVE_SPEED = 190;

// 5 Farklı Rastgele Harita Tasarımı — hepsi geniş tutulur (min ~%75 dolu):
// çeşitlilik deliklerle değil kenar formuyla gelir (klasik/islands/atoll/
// elmas/plaza). Mantık ızgarası 13x13 aynı kalır, yalnız görsel derinlik
// collapseView'dadır.
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
          // Geniş adalar + 5 hücre genişliğinde köprüler + 5x5 merkez.
          const inIsland = (r < midR - 1 || r > midR + 1) && (c < midC - 1 || c > midC + 1);
          const isBridge = (
            (Math.abs(r - midR) <= 2 && c >= 1 && c < cols - 1) ||
            (Math.abs(c - midC) <= 2 && r >= 1 && r < rows - 1)
          );
          const isCenter = Math.abs(r - midR) <= 2 && Math.abs(c - midC) <= 2;
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
          // Hendek yok: merkez + halka örtüşür, dış sınır 6.6'ya kadar dolu.
          const isCenter = dist <= 3.2;
          const isRing = dist >= 2.6 && dist <= 6.5;
          const isCrossWalk = (Math.abs(r - midR) <= 1.5 || Math.abs(c - midC) <= 1.5) && dist <= 6.6;
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
          // Eskiden 6.2'ydi (%50 alan); 8.5 ile büyük elmas.
          row.push(manhattan <= 8.5 ? 0 : 2);
        }
        g.push(row);
      }
      return g;
    },
  },
  {
    id: 'corridors',
    name: 'GENİŞ KORİDORLAR',
    generate: (rows, cols) => {
      // Tam plaza: tek hücre köşeler dışında her yer dolu. Koridor hissi
      // görsel derzlerle verilir, delikle değil — en büyük arena.
      const g = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) {
          const isCorner = (r === 0 && c === 0) || (r === 0 && c === cols - 1) ||
                           (r === rows - 1 && c === 0) || (r === rows - 1 && c === cols - 1);
          row.push(isCorner ? 2 : 0);
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
    // Maç hedefi ve raunt süresi — kısaltma (collapse.js).
// Gerekçe: parti oyununda maç uzunluğu = yeniden başlatma sayısı. Ölçülen
// durum: hedefler 2-5 arası dağınıktı ve bir kısmı 5'ti (NINJA/
// SNAKE/COLLAPSE/CURVE); ilk açılışta 5 hedef, dakikalar süren bir maç
// demek, yani oyuncu iki dakika içinde 'tekrar oynayalım' demiyor.
// Kural: çoğu oyun 2 hedefte biter (ilk-iki kuralı — bir parti turunda
// kazanan çabuk bellenir, maç tekrarına yer kalır). LOSER'a özgü
// süreler korunur: HORDE kill/süre oyunudur, onda hedef 2
// olmak turu anlamsız kılardı.
this.targetScore = 2;
    this.players = [];
    // FX runtime (MOTION_PLAN Faz 2b): partikül/ring/pop/hit-stop tek sahibi;
    // `this.particles` worldCore konvansiyonu için alias'tır.
    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    /** @type {any[]} */ this.particles = this.fx.particles;
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
    this.roundId = 0;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
    this.roundTime = COLLAPSE_ROUND_TIME;
    this.roundTransitionTimer = 0;

    this.initKeyboard();
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('COLLAPSE'),
      actions: [
        {
          id: 'jump',
          icon: '🦘',
          cooldownField: 'jumpCooldown',
          maxCooldown: COLLAPSE_JUMP_COOLDOWN,
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown || actionId !== 'jump') return;
    const player = this.players[slotIndex];
    if (player && player.isJoined && player.isAlive && player.slotType === 'human') {
      this.attemptJump(player);
    }
  }

  createWorldPacket() {
    return createCollapseWorldPacket(this);
  }

  initKeyboard() {
    bindKeyboard(this, {
      keydown: (e) => {
        if (!this.isLocalInputActive) return;
        this.keys[e.code] = true;
      },
      keyup: (e) => {
        this.keys[e.code] = false;
      },
    });
  }

  keyboardInput(index) {
    return readSlotKeys(this.keys, index);
  }

  pickRandomMap() {
    this.mapIndex = Math.floor(Math.random() * COLLAPSE_MAPS.length);
    this.buildGrid();
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };

    this.arena = computePlayfield(width, height, 'standard');

    this.cellSize = this.arena.size / this.gridCOLS;
    this.offsetX = this.arena.cx - (this.gridCOLS * this.cellSize) / 2;
    this.offsetY = this.arena.cy - (this.gridROWS * this.cellSize) / 2;

    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
      this.buildGrid();
    } else {
      const gridLeft = this.offsetX + this.cellSize * 0.5;
      const gridRight = this.offsetX + this.gridCOLS * this.cellSize - this.cellSize * 0.5;
      const gridTop = this.offsetY + this.cellSize * 0.5;
      const gridBottom = this.offsetY + this.gridROWS * this.cellSize - this.cellSize * 0.5;
      for (const p of this.players) {
        this.remapPoint(p, oldArena, this.arena);
        p.radius = fieldRadius(this.arena, COLLAPSE_RADIUS);
        p.speed = fieldSpeed(this.arena, COLLAPSE_MOVE_SPEED);
        p.x = Math.max(gridLeft, Math.min(gridRight, p.x));
        p.y = Math.max(gridTop, Math.min(gridBottom, p.y));
        p.vx = 0;
        p.vy = 0;
      }
      for (const pickup of this.pickups) {
        this.remapPoint(pickup, oldArena, this.arena);
        pickup.x = Math.max(gridLeft, Math.min(gridRight, pickup.x));
        pickup.y = Math.max(gridTop, Math.min(gridBottom, pickup.y));
      }
      for (const tile of this.fallingTiles) this.remapPoint(tile, oldArena, this.arena);
      for (const wave of this.shockwaves) this.remapPoint(wave, oldArena, this.arena);
    }
    // Biriken partiküller ESKİ arena ölçeğindeydi; yeni unit ile karışmasın.
    this.fx.clear();
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
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || COLLAPSE_COLORS[i]),
        x: s.x, y: s.y, angle: 0,
        radius: fieldRadius(this.arena, COLLAPSE_RADIUS),
        speed: fieldSpeed(this.arena, COLLAPSE_MOVE_SPEED), steerX: 0, steerY: 0,
        vx: 0, vy: 0,
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
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.roundTime = COLLAPSE_ROUND_TIME;
    this.roundTransitionTimer = 0;
    this.pickups = [];
    this.fx.clear();
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
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
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
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTime = COLLAPSE_ROUND_TIME;
    this.roundTransitionTimer = 0;
    this.pickups = [];
    this.fallingTiles = [];
    this.shockwaves = [];
    this.fx.clear();
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

  finishRound(winner, reason = 'elimination', awardPoint = false) {
    if (this.state !== 'PLAYING') return;
    if (winner) {
      this.tiedRounds = 0;
      if (awardPoint) this.scores[winner.index] += 1;
      if (this.scores[winner.index] >= this.targetScore) this.matchWinner = winner;
      beginRound(this, winner, reason);
      return;
    }

    this.tiedRounds += 1;
    if (!this.players.some((p) => p.isJoined) || this.tiedRounds >= COLLAPSE_MAX_TIED_ROUNDS) {
      endMatch(this, null, reason);
      return;
    }
    beginRound(this, null, reason);
  }

  resolveTimeout() {
    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length === 1) this.finishRound(alive[0], 'timeout', true);
    else this.finishRound(null, 'timeout');
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
    // API kabuğu korundu (2 çağrı noktası); sayı profilden gelir (kademe ölçekli).
    this.fx.emit('dust', { x, y });
  }

  triggerLandingStomp(player) {
    // İniş Şok Dalgası: Yakındaki rakipleri hafifçe dışarı iter
    this.fx.emit('hit', {
      x: player.x, y: player.y, color: player.color, slot: player.index,
      haptic: player.slotType === 'human',
    });
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

  onTouchStart(touch) {
    if (this.handleRoundOverSkip()) return;

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch, {
        onSeatChange: (q) => {
          if (this.players[q]) {
            this.players[q].isJoined = this.isSlotJoined(q);
            this.players[q].slotType = this.slotTypes[q];
          }
        },
      });
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      matchOverRestartTap(this, touch, { onRestart: () => { this.startNewMatch(); playJoin(); } });
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
    this.players.forEach((p) => { p.steerX = 0; p.steerY = 0; });
  }

  update(now) {
    const rawDt = this.clampDt(now, this.lastTime);
    this.lastTime = now;
    // Hit-stop TEK SAAT: host karesi yavaşlar, kumanda aynı kareyi görür (§2).
    const dt = this.fx.tick(rawDt);

    this.updateTrauma(dt);
    this.fx.update(dt);

    if (tickRoundFlow(this, dt)) return;

    if (this.state !== 'PLAYING') return;

    this.roundTime = Math.max(0, this.roundTime - dt);
    if (this.roundTime <= 0) {
      this.resolveTimeout();
      return;
    }

    // Güçlendirme periyodu
    this.pickupSpawnTimer -= dt;
    if (this.pickupSpawnTimer <= 0 && this.pickups.length < 2) {
      this.spawnPickup();
      this.pickupSpawnTimer = 6.0 + Math.random() * 4.0;
    }
    tickPickupTimers(this, dt);

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
            // Düşen 3D blok efekti (dönerek düşer, renk varyasyonu)
            const tileColors = ['#D99B26', '#D84727', '#C85A00', '#B8760A'];
            this.fallingTiles.push({
              x: cx, y: cy, size: this.cellSize * 0.9,
              vy: 60, scale: 1.0, rot: (Math.random() - 0.5) * 2,
              rotSpd: (Math.random() - 0.5) * 8,
              alpha: 1.0,
              colorVariant: tileColors[Math.floor(Math.random() * tileColors.length)],
            });
          }
        }
      }
    }

    // Düşen blokların fiziği (döndürme dahil)
    for (let i = this.fallingTiles.length - 1; i >= 0; i--) {
      const ft = this.fallingTiles[i];
      ft.y += ft.vy * dt;
      ft.vy += 200 * dt; // yerçekimi hızlanması
      ft.rot += (ft.rotSpd || 0) * dt;
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
        const joy = this.joysticks[player.index];
        if (joy && joy.active && joy.force > 0.08) {
          player.steerX = Math.cos(joy.angle) * joy.force;
          player.steerY = Math.sin(joy.angle) * joy.force;
        } else if (ki.dx !== 0 || ki.dy !== 0) {
          const mag = Math.hypot(ki.dx, ki.dy) || 1;
          player.steerX = ki.dx / mag;
          player.steerY = ki.dy / mag;
        } else if (!player.remoteActive) {
          // Klavye bırakıldı: sadece kendi yazdığını siler (uzak/dokunmatik korunur)
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

      const fromX = player.x;
      const fromY = player.y;
      const spd = player.jumpTimer > 0 ? player.speed * 1.85 : player.speed;
      player.x += player.steerX * spd * dt;
      player.y += player.steerY * spd * dt;
      this.writeSteerVelocity(player, player.steerX * spd, player.steerY * spd);

      // Zemin etkileşimi (sadece yerdeyken); hızlı karelerde aradaki boşluğu atlamaz.
      if (player.jumpTimer <= 0) {
        const distance = Math.hypot(player.x - fromX, player.y - fromY);
        const steps = Math.max(1, Math.ceil(distance / Math.max(1, this.cellSize * 0.45)));
        let fell = false;
        for (let step = 1; step <= steps; step++) {
          const ratio = step / steps;
          const sampleX = fromX + (player.x - fromX) * ratio;
          const sampleY = fromY + (player.y - fromY) * ratio;
          const cx = Math.floor((sampleX - this.offsetX) / this.cellSize);
          const cy = Math.floor((sampleY - this.offsetY) / this.cellSize);
          if (cx < 0 || cx >= this.gridCOLS || cy < 0 || cy >= this.gridROWS || this.grid[cy][cx].state === 2) {
            this.eliminatePlayer(player);
            fell = true;
            break;
          }
        }
        if (fell) continue;

        const cx = Math.floor((player.x - this.offsetX) / this.cellSize);
        const cy = Math.floor((player.y - this.offsetY) / this.cellSize);
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

    const alive = this.players.filter((p) => p.isJoined && p.isAlive);
    if (alive.length <= 1) {
      this.handleRoundEnd(alive.length === 1 ? alive[0] : null);
    }
  }

  spawnCrumble(x, y) {
    // Çöken karo ufalanması: dust profili (ortam olayı, haptiksiz).
    this.fx.emit('dust', { x, y });
  }

  eliminatePlayer(player) {
    player.isAlive = false;
    // KILL olayı: burst + halka + ölüm pop'u + hit-stop + flaş + travma tek profilden.
    this.fx.emit('kill', {
      x: player.x, y: player.y, color: player.color,
      size: player.radius || 36, angle: 0, slot: player.index,
      haptic: player.slotType === 'human',
    });
    playExplosion();
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !player.isAlive) return;
    if (this.state !== 'PLAYING') {
      player.steerX = 0;
      player.steerY = 0;
      player.remoteActive = false;
      return;
    }

    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE' || data.action === 'MOVE') {
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
    } else if (matchesInputAction(data, 'jump', 'DASH') || data.action === 'JUMP') {
      this.attemptJump(player);
    }
  }

  handleRoundEnd(winner) {
    this.finishRound(winner, 'elimination', true);
  }

  render() {
    const { ctx } = this;
    const now = performance.now();
    ctx.save();

    // Sahanın dışı (uçurum / masa) — `fieldKit` tek sahibi
    paintBackdrop(ctx, this.viewport, this.arena, { mode: 'COLLAPSE' });
    this.applyScreenShake(ctx);

    // 2. DÜŞEN 3D BLOKLAR (Uçurumda aşağı düşenler — dönerek düşer)
    drawCollapseFalling(ctx, this.fallingTiles);

    // 3. 3D IZGARA ZEMİNİ (Derinlikli Bloklar) — ortak collapseView draw'ı
    const gridStates = new Array(this.gridROWS * this.gridCOLS);
    const gridWarn = [];
    for (let r = 0; r < this.gridROWS; r++) {
      for (let c = 0; c < this.gridCOLS; c++) {
        const tile = this.grid[r][c];
        const state = tile && (tile.state === 1 || tile.state === 2) ? tile.state : 0;
        const idx = r * this.gridCOLS + c;
        gridStates[idx] = state;
        if (state === 1) gridWarn.push([idx, tile.timer]);
      }
    }
    drawCollapseGrid(ctx, this.arena, this.cellSize, gridStates, gridWarn, {
      withFx: this.state === 'PLAYING',
      now,
    });

    // 4. ŞOK DALGALARI
    drawCollapseWaves(ctx, this.shockwaves);

    // 5. GÜÇLENDİRMELER (Pickups)
    drawCollapsePickups(ctx, this.pickups, now);

    // 6. OYUNCULAR (Havada yükselme, gölge derinliği ve şok halkası)
    drawCollapsePlayers(ctx, this.players, { selfSlot: this.localControlSlot ?? -1 });

    // 7. FX KATMANI (ortak collapseView draw'ı — host↔client aynı)
    drawCollapseFxLayer(ctx, { pops: this.fx.pops, rings: this.fx.rings, particles: this.particles });

    if (this.state === 'PLAYING') {
      this.renderControls(ctx);
    }

    this.renderHUD(ctx, {
      guideTitle: t('guide.collapse'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: COLLAPSE_COLORS,
      accent: '#D84727',
      matchOverHeadline: t('collapse.champ'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .map((p) => ({ color: p.color, name: p.name, value: `${this.scores[p.index]}★`, score: this.scores[p.index] })),
      onRestart: () => this.startNewMatch(),
      onSeatChange: (i) => {
        if (this.players[i]) {
          this.players[i].isJoined = this.isSlotJoined(i);
          this.players[i].slotType = this.slotTypes[i];
        }
        playJoin();
      },
    });

    ctx.restore();

    // Kill flaşı sahne transformunun DIŞINDA: tam ekranı kaplar (tanks deseni).
    const flashAlpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (flashAlpha > 0) drawFxFlash(ctx, this.viewport.width, this.viewport.height, flashAlpha);
  }
}
