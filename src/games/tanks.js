// Micro-Tanks: 8 Labyrinths with Multi-Tier Bot AI (Normal & God Mode), Tactical Crates & Sudden Death
import { getSlotCustomization, ensureLocalSeatColor, getBotPersona } from '../core/customizationManager.js';
import { playShoot, playRicochet, playExplosion, playDryFire, playStart, playJoin, playPowerUp } from '../audio.js';
import { t } from '../i18n.js';
import { renderTopPill } from '../ui/hud.js';
import { prefersReducedMotion } from '../ui/motion.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { resolveSlotName } from '../core/slotManager.js';
import { updateTankBotAI as runTankBotAI } from '../ai/tankAI.js';
import { getSlotKeys, buildCodeToSlotMap } from '../core/inputMaps.js';
import { lobbyCenterStartTap } from '../core/touchFlow.js';
import {
  createTanksWorldPacket,
  getTankAmmoVisual,
  drawTanksArena,
  drawTanksBullets,
  drawTanksTracers,
  drawTanksCrates,
  drawTanksTanks,
} from './tanksView.js';
import { drawSquareParticles } from './worldCore.js';

export const TANK_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const TANK_NAMES = ['P1', 'P2', 'P3', 'P4'];

// 8 Handcrafted Brutalist Labyrinth Layouts with custom tactical spawns
export const MAP_LAYOUTS = [
  {
    name: '01 // LABİRENT (THE MAZE)',
    obstacles: [
      { x: 0.28, y: 0.20, w: 0.04, h: 0.28 },
      { x: 0.68, y: 0.20, w: 0.04, h: 0.28 },
      { x: 0.28, y: 0.52, w: 0.04, h: 0.28 },
      { x: 0.68, y: 0.52, w: 0.04, h: 0.28 },
      { x: 0.20, y: 0.48, w: 0.24, h: 0.04 },
      { x: 0.56, y: 0.48, w: 0.24, h: 0.04 },
      { x: 0.46, y: 0.30, w: 0.08, h: 0.40 },
    ],
    spawns: [
      { x: 0.12, y: 0.86, angle: -Math.PI * 0.25 },
      { x: 0.12, y: 0.14, angle: Math.PI * 0.25 },
      { x: 0.88, y: 0.14, angle: Math.PI * 0.75 },
      { x: 0.88, y: 0.86, angle: -Math.PI * 0.75 },
    ],
  },
  {
    name: '02 // SIĞINAK (THE BUNKER)',
    obstacles: [
      { x: 0.32, y: 0.32, w: 0.12, h: 0.04 },
      { x: 0.56, y: 0.32, w: 0.12, h: 0.04 },
      { x: 0.32, y: 0.64, w: 0.12, h: 0.04 },
      { x: 0.56, y: 0.64, w: 0.12, h: 0.04 },
      { x: 0.32, y: 0.32, w: 0.04, h: 0.12 },
      { x: 0.32, y: 0.56, w: 0.04, h: 0.12 },
      { x: 0.64, y: 0.32, w: 0.04, h: 0.12 },
      { x: 0.64, y: 0.56, w: 0.04, h: 0.12 },
      { x: 0.18, y: 0.48, w: 0.06, h: 0.04 },
      { x: 0.76, y: 0.48, w: 0.06, h: 0.04 },
    ],
    spawns: [
      { x: 0.16, y: 0.84, angle: -Math.PI * 0.35 },
      { x: 0.50, y: 0.14, angle: Math.PI * 0.5 },
      { x: 0.84, y: 0.16, angle: Math.PI * 0.85 },
      { x: 0.50, y: 0.86, angle: -Math.PI * 0.5 },
    ],
  },
  {
    name: '03 // KAVŞAK (THE CROSS)',
    obstacles: [
      { x: 0.47, y: 0.15, w: 0.06, h: 0.24 },
      { x: 0.47, y: 0.61, w: 0.06, h: 0.24 },
      { x: 0.15, y: 0.47, w: 0.24, h: 0.06 },
      { x: 0.61, y: 0.47, w: 0.24, h: 0.06 },
      { x: 0.26, y: 0.26, w: 0.08, h: 0.08 },
      { x: 0.66, y: 0.26, w: 0.08, h: 0.08 },
      { x: 0.26, y: 0.66, w: 0.08, h: 0.08 },
      { x: 0.66, y: 0.66, w: 0.08, h: 0.08 },
    ],
    spawns: [
      { x: 0.50, y: 0.90, angle: -Math.PI * 0.5 },
      { x: 0.50, y: 0.10, angle: Math.PI * 0.5 },
      { x: 0.90, y: 0.50, angle: Math.PI },
      { x: 0.10, y: 0.50, angle: 0 },
    ],
  },
  {
    name: '04 // SÜTUNLAR (THE PILLARS)',
    obstacles: [
      { x: 0.26, y: 0.26, w: 0.09, h: 0.09 },
      { x: 0.455, y: 0.26, w: 0.09, h: 0.09 },
      { x: 0.65, y: 0.26, w: 0.09, h: 0.09 },
      { x: 0.26, y: 0.455, w: 0.09, h: 0.09 },
      { x: 0.455, y: 0.455, w: 0.09, h: 0.09 },
      { x: 0.65, y: 0.455, w: 0.09, h: 0.09 },
      { x: 0.26, y: 0.65, w: 0.09, h: 0.09 },
      { x: 0.455, y: 0.65, w: 0.09, h: 0.09 },
      { x: 0.65, y: 0.65, w: 0.09, h: 0.09 },
    ],
    spawns: [
      { x: 0.14, y: 0.50, angle: 0 },
      { x: 0.50, y: 0.14, angle: Math.PI * 0.5 },
      { x: 0.86, y: 0.50, angle: Math.PI },
      { x: 0.50, y: 0.86, angle: -Math.PI * 0.5 },
    ],
  },
  {
    name: '05 // BLOKLAR (THE L-BLOCKS)',
    obstacles: [
      { x: 0.22, y: 0.22, w: 0.18, h: 0.05 },
      { x: 0.22, y: 0.22, w: 0.05, h: 0.18 },
      { x: 0.60, y: 0.22, w: 0.18, h: 0.05 },
      { x: 0.73, y: 0.22, w: 0.05, h: 0.18 },
      { x: 0.22, y: 0.73, w: 0.18, h: 0.05 },
      { x: 0.22, y: 0.60, w: 0.05, h: 0.18 },
      { x: 0.60, y: 0.73, w: 0.18, h: 0.05 },
      { x: 0.73, y: 0.60, w: 0.05, h: 0.18 },
      { x: 0.46, y: 0.46, w: 0.08, h: 0.08 },
    ],
    spawns: [
      { x: 0.34, y: 0.66, angle: -Math.PI * 0.25 },
      { x: 0.34, y: 0.34, angle: Math.PI * 0.25 },
      { x: 0.66, y: 0.34, angle: Math.PI * 0.75 },
      { x: 0.66, y: 0.66, angle: -Math.PI * 0.75 },
    ],
  },
  {
    name: '06 // AVLU (THE COURTYARD)',
    obstacles: [
      { x: 0.35, y: 0.28, w: 0.30, h: 0.04 },
      { x: 0.35, y: 0.68, w: 0.30, h: 0.04 },
      { x: 0.20, y: 0.36, w: 0.04, h: 0.28 },
      { x: 0.76, y: 0.36, w: 0.04, h: 0.28 },
      { x: 0.44, y: 0.44, w: 0.12, h: 0.12 },
    ],
    spawns: [
      { x: 0.14, y: 0.86, angle: -Math.PI * 0.3 },
      { x: 0.50, y: 0.14, angle: Math.PI * 0.5 },
      { x: 0.86, y: 0.14, angle: Math.PI * 0.8 },
      { x: 0.50, y: 0.86, angle: -Math.PI * 0.5 },
    ],
  },
  {
    name: '07 // SARMAL (THE SPIRAL)',
    obstacles: [
      { x: 0.30, y: 0.24, w: 0.40, h: 0.04 },
      { x: 0.66, y: 0.24, w: 0.04, h: 0.40 },
      { x: 0.30, y: 0.72, w: 0.40, h: 0.04 },
      { x: 0.30, y: 0.36, w: 0.04, h: 0.40 },
      { x: 0.46, y: 0.46, w: 0.08, h: 0.08 },
    ],
    spawns: [
      { x: 0.16, y: 0.84, angle: -Math.PI * 0.4 },
      { x: 0.16, y: 0.16, angle: Math.PI * 0.25 },
      { x: 0.84, y: 0.16, angle: Math.PI * 0.75 },
      { x: 0.84, y: 0.84, angle: -Math.PI * 0.75 },
    ],
  },
  {
    name: '08 // SİPERLER (THE TRENCHES)',
    obstacles: [
      { x: 0.18, y: 0.30, w: 0.42, h: 0.04 },
      { x: 0.40, y: 0.48, w: 0.42, h: 0.04 },
      { x: 0.18, y: 0.66, w: 0.42, h: 0.04 },
      { x: 0.72, y: 0.20, w: 0.04, h: 0.22 },
      { x: 0.24, y: 0.58, w: 0.04, h: 0.22 },
    ],
    spawns: [
      { x: 0.14, y: 0.84, angle: -Math.PI * 0.5 },
      { x: 0.86, y: 0.16, angle: Math.PI * 0.5 },
      { x: 0.64, y: 0.38, angle: Math.PI },
      { x: 0.36, y: 0.60, angle: 0 },
    ],
  },
];

export class TanksGame extends BaseMiniGame {
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

    this.currentMapIndex = 0;
    this.obstacles = [];

    // Tanks & Projectiles
    this.tanks = [];
    this.bullets = [];
    this.particles = [];
    this.shotTracers = [];

    // Match Scores & Target
    this.scores = [0, 0, 0, 0];
    this.targetScore = 3;
    this.roundWinner = null;
    this.matchWinner = null;
    this.roundTransitionTimer = 0;
    this.spawnIntroTimer = 0;

    // Corner touch mapping & Slot States: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.cornerTouchIds = [-1, -1, -1, -1];
    this.cornerTouchOrigins = [null, null, null, null];
    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty']; // P1 Human, P2 Normal Bot default

    // Keyboard Controls (P1 WASD+Space, P2 Oklar+Enter, P3 IJKL+O, P4 TFGH+B)
    this.keys = {};
    // Sürüş sahibi: 'kb' | 'touch' | 'remote' | null — bırakma sinyali sadece
    // kendi latch'ini temizler, diğer kaynağın sürüşünü ezmez
    this.driveOwner = [null, null, null, null];
    this.initKeyboard();

    // Tactical Supply Crates & Sudden Death
    this.crates = [];
    this.crateSpawnTimer = 6.0;
    this.roundTimer = 0;

    this.trauma = 0;
    this.lastTime = performance.now();
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.roundWinner = null;
    this.bullets = [];
    this.particles = [];
    this.crates = [];
    this.shotTracers = [];
    this.cornerTouchIds = [-1, -1, -1, -1];
    this.cornerTouchOrigins = [null, null, null, null];
    this.trauma = 0;
    this.roundTimer = 0;
    this.roundTransitionTimer = 0;
    this.spawnIntroTimer = 0;
    this.lastTime = performance.now();
    this.pickRandomMap();
    this.initTanks();
  }

  reset() {
    this.resetMatch();
  }

  // Lokal klavye: basılı hareket tuşu = sür (dokunmatik TUT ile aynı),
  // bırakma = dur + ateş (dokunmatik BIRAK ile aynı). Kumanda girdisiyle
  // aynı alana yazar (last-writer-wins); kbDriving bayrağı klavyenin
  // bıraktığı latch'i, uzaktaki sürüşü ezmeden temizler.
  createWorldPacket() {
    return createTanksWorldPacket(this);
  }

  ammoVisual(tank) {
    return getTankAmmoVisual(tank);
  }

  initKeyboard() {
    // Hareket/set ve ateş tuşları inputMaps STANDARD'tan türetilir (kopya yok)
    const MOVE_KEYS = [0, 1, 2, 3].map((i) => {
      const m = getSlotKeys(i);
      return [m.u, m.d, m.l, m.r];
    });
    const FIRE_KEYS = [0, 1, 2, 3].map((i) => getSlotKeys(i).action);
    const slotOfMove = buildCodeToSlotMap(['u', 'd', 'l', 'r']);
    const isHumanAlive = (i) => {
      const tank = this.tanks[i];
      return tank && tank.isJoined && tank.isAlive && tank.slotType === 'human' ? tank : null;
    };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (!this.isLocalInputActive) return;
      this.keys[e.code] = true;
      this.keys[e.key] = true;
      if (this.state !== 'PLAYING') return;
      const slot = slotOfMove[e.code];
      if (slot !== undefined) {
        e.preventDefault();
        const tank = isHumanAlive(slot);
        if (tank) {
          this.driveOwner[slot] = 'kb';
          tank.isDriving = true;
        }
        return;
      }
      const fireSlot = FIRE_KEYS.indexOf(e.code);
      if (fireSlot !== -1) {
        e.preventDefault();
        const tank = isHumanAlive(fireSlot);
        if (tank) this.attemptFire(tank);
      }
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this.keys[e.key] = false;
      const slot = slotOfMove[e.code];
      if (slot === undefined) return;
      if (MOVE_KEYS[slot].some((c) => this.keys[c])) return;
      // Sadece klavye sürdüyse dur+ateş; kumanda/dokunmatik sürüşüne dokunma
      if (this.driveOwner[slot] !== 'kb') return;
      this.driveOwner[slot] = null;
      const tank = this.tanks[slot];
      if (!tank) return;
      tank.isDriving = false;
      if (this.state === 'PLAYING' && tank.isJoined && tank.isAlive && tank.slotType === 'human') {
        this.attemptFire(tank);
      }
    });
  }

  restartRound() {
    this.startRound();
  }

  getTabletopSchema() {
    return {
      // Sürüüş köşe-tut mantığıyla çalışır; ped yalnızca görsel rehberdir
      joystick: true,
      actions: [
        {
          id: 'fire',
          icon: '💣',
          cooldownField: 'reloadTimer',
          cooldownMaxField: 'reloadCooldown',
          readyField: 'chamber',
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown || actionId !== 'fire') return;
    const tank = this.tanks[slotIndex];
    if (tank && tank.isJoined && tank.isAlive && tank.slotType === 'human') {
      this.attemptFire(tank);
    }
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
    // LOCAL: yeni insan koltuğuna boş renk ata (hook dönmediyse lokaldir)
    if (this.slotTypes[index] === 'human' && !this.hideLobbyStartButton) {
      this.applyLocalSeatColor(index, ensureLocalSeatColor(index));
    }
    if (this.tanks[index]) {
      this.tanks[index].slotType = this.slotTypes[index];
      this.tanks[index].isJoined = this.isSlotJoined(index);
      this.tanks[index].name = resolveSlotName(index, this.slotTypes[index]);
    }
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = Math.max(32, Math.floor(height * 0.06));
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

    this.loadMap(this.currentMapIndex);
    // Maç ortası resize raundu sıfırlamasın: geometri yenilenir, canlı
    // varlıklar orantılı taşınır (ölü dirilmez, şarjör/skor korunur)
    if (this.state === 'LOBBY' || !this.tanks.length) {
      this.initTanks();
      return;
    }
    for (const tank of this.tanks) {
      this.remapPoint(tank, oldArena, this.arena);
    }
    for (const b of this.bullets) this.remapPoint(b, oldArena, this.arena);
    for (const c of this.crates) this.remapPoint(c, oldArena, this.arena);
    this.particles = [];
    this.shotTracers = [];
  }

  loadMap(index) {
    this.currentMapIndex = index % MAP_LAYOUTS.length;
    const mapDef = MAP_LAYOUTS[this.currentMapIndex];
    const { left, top, width: aW, height: aH } = this.arena;

    this.obstacles = mapDef.obstacles.map((obs) => ({
      x: left + obs.x * aW,
      y: top + obs.y * aH,
      w: obs.w * aW,
      h: obs.h * aH,
    }));
  }

  pickRandomMap() {
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * MAP_LAYOUTS.length);
    } while (nextIndex === this.currentMapIndex && MAP_LAYOUTS.length > 1);
    this.loadMap(nextIndex);
  }

  initTanks() {
    const mapDef = MAP_LAYOUTS[this.currentMapIndex];
    const { left, top, width: aW, height: aH } = this.arena;

    this.tanks = mapDef.spawns.map((spawn, i) => {
      const sx = left + spawn.x * aW;
      const sy = top + spawn.y * aH;
      const isJoined = this.isSlotJoined(i);
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      const existing = this.tanks?.[i];
      return {
        index: i,
        name: resolveSlotName(i, this.slotTypes[i], existing?.name),
        color: isBot ? persona.color : (custom.color || TANK_COLORS[i]),
        x: sx,
        y: sy,
        startX: sx,
        startY: sy,
        startAngle: spawn.angle,
        angle: spawn.angle,
        rotationSpeed: 2.8,
        spinDirection: i % 2 === 0 ? 1 : -1,
        driveSpeed: 175,
        isDriving: false,
        isAlive: true,
        isJoined: isJoined,
        slotType: this.slotTypes[i],
        size: 26,
        reloadCooldown: 0.55,
        reloadTimer: 0,
        muzzleFlashTimer: 0,
        maxBullets: 2,
        botPatrolTimer: 0,
        botWantsDrive: false,
        turboTimer: 0,
        hasTripleShot: false,
        hasShield: false,
      };
    });
  }

  spawnCrate() {
    const { left, top, right, bottom } = this.arena;
    const types = ['TURBO', 'TRIPLE', 'SHIELD'];
    const type = types[Math.floor(Math.random() * types.length)];
    const crateSize = 22;

    for (let attempt = 0; attempt < 25; attempt++) {
      const cx = left + 40 + Math.random() * (right - left - 80);
      const cy = top + 40 + Math.random() * (bottom - top - 80);

      if (this.checkTankCollision(cx, cy, crateSize / 2 + 8)) continue;

      this.crates.push({
        x: cx,
        y: cy,
        size: crateSize,
        type: type,
        life: 18.0,
      });
      break;
    }
  }

  getCornerZone(pos) {
    const { cx, cy } = this.arena;
    // Center button area is reserved for Start / Restart
    if (Math.hypot(pos.x - cx, pos.y - cy) < 65) {
      return -1;
    }

    // Full quadrant mapping: eliminates deadzones at phone edges/margins
    const isLeft = pos.x < cx;
    const isTop = pos.y < cy;

    if (isLeft && !isTop) return 0; // P1 Bottom-Left
    if (isLeft && isTop) return 1;  // P2 Top-Left
    if (!isLeft && isTop) return 2; // P3 Top-Right
    return 3;                       // P4 Bottom-Right
  }

  getCornerControlRect(index) {
    const { left, right, top, bottom } = this.arena;
    const size = this.arena.size * (this.arena.height > this.arena.width ? 0.3 : 0.26);
    if (index === 0) return { x: left, y: bottom - size, w: size, h: size };
    if (index === 1) return { x: left, y: top, w: size, h: size };
    if (index === 2) return { x: right - size, y: top, w: size, h: size };
    return { x: right - size, y: bottom - size, w: size, h: size };
  }

  getCornerCenter(index) {
    const zone = this.getCornerControlRect(index);
    return { x: zone.x + zone.w / 2, y: zone.y + zone.h / 2 };
  }

  onTouchStart(touch) {
    if (this.handleRoundOverSkip()) return;

    if (this.state === 'LOBBY') {
      if (this.handleUiTap(touch)) return;
      if (lobbyCenterStartTap(this, touch)) return;

      const corner = this.getCornerZone(touch);
      if (corner === -1) return;

      this.cycleSlotType(corner);
      if (this.tanks[corner]) {
        this.tanks[corner].isJoined = this.isSlotJoined(corner);
        this.tanks[corner].slotType = this.slotTypes[corner];
      }
      playJoin();
      return;
    }

    if (this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
      if (Math.hypot(touch.x - this.arena.cx, touch.y - this.arena.cy) < 75) {
        this.state = 'LOBBY';
        this.scores = [0, 0, 0, 0];
        playJoin();
      }
      return;
    }

    if (this.state === 'PLAYING') {
      // Masa-ortası ATEŞ butonları önce (varsa); köşe-tut sürüşü ardından
      if (this.handleTabletopTouchStart(touch)) return;
      const corner = this.getCornerZone(touch);
      if (corner === -1) return;
      const tank = this.tanks[corner];
      // Only humans respond to physical touch!
      if (tank && tank.isJoined && tank.isAlive && tank.slotType === 'human') {
        this.cornerTouchIds[corner] = touch.id;
        this.cornerTouchOrigins[corner] = { x: touch.x, y: touch.y };
        this.driveOwner[corner] = 'touch';
        tank.isDriving = true;
      }
    }
  }

  onTouchMove(touch) {
    // Direction is intentionally automatic: hold to drive and wait for the shot window.
  }

  onTouchEnd(touch) {
    for (let i = 0; i < 4; i++) {
      if (this.cornerTouchIds[i] === touch.id) {
        this.cornerTouchIds[i] = -1;
        this.cornerTouchOrigins[i] = null;
        const tank = this.tanks[i];
        if (this.driveOwner[i] === 'touch') this.driveOwner[i] = null;
        if (tank && tank.isJoined && tank.isAlive && tank.slotType === 'human' && this.state === 'PLAYING') {
          tank.isDriving = false;
          this.attemptFire(tank);
        }
        break;
      }
    }
  }

  onTouchesReset() {
    this.cornerTouchIds = [-1, -1, -1, -1];
    this.cornerTouchOrigins = [null, null, null, null];
    this.driveOwner = [null, null, null, null];
    this.tanks.forEach((t) => (t.isDriving = false));
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.startRound();
  }

  startNewRound() {
    this.startRound();
  }

  startRound() {
    this.pickRandomMap();
    const mapDef = MAP_LAYOUTS[this.currentMapIndex];
    const { left, top, width: aW, height: aH } = this.arena;

    this.state = 'PLAYING';
    this.bullets = [];
    this.particles = [];
    this.shotTracers = [];
    this.crates = [];
    this.crateSpawnTimer = 6.0;
    this.roundTimer = 0;
    this.roundWinner = null;
    this.spawnIntroTimer = 2.0;
    playStart();

    this.tanks.forEach((tank, i) => {
      const spawn = mapDef.spawns[i];
      const sx = left + spawn.x * aW;
      const sy = top + spawn.y * aH;

      tank.x = sx;
      tank.y = sy;
      tank.startX = sx;
      tank.startY = sy;
      tank.angle = spawn.angle;
      tank.startAngle = spawn.angle;
      tank.slotType = this.slotTypes[i];
      tank.isJoined = this.isSlotJoined(i);
      tank.isAlive = tank.isJoined;
      tank.isDriving = false;
      this.driveOwner[i] = null;
      tank.reloadTimer = 0;
      tank.reloadCooldown = 1.1;
      tank.maxBullets = 2;
      tank.chamber = tank.maxBullets;
      tank.muzzleFlashTimer = 0;
      tank.botPatrolTimer = 0;
      tank.botWantsDrive = false;
      tank.turboTimer = 0;
      tank.hasTripleShot = false;
      tank.hasShield = false;
    });
  }

  attemptFire(tank) {
    // Lobi/maç-sonunda kumandadan ateş tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    // Şarjör mantığı: dolu yuva varsa ateşlenir (peş peşe 2 el mümkün).
    // Dolum sayacı sadece boş yuvayı doldurur, hazır mermiyi kilitlemez.
    if ((tank.chamber ?? tank.maxBullets) <= 0) {
      if (tank.slotType === 'human') {
        playDryFire();
      }
      return;
    }

    tank.chamber = Math.max(0, (tank.chamber ?? tank.maxBullets) - 1);
    if (tank.reloadTimer <= 0) tank.reloadTimer = tank.reloadCooldown;
    tank.muzzleFlashTimer = 0.12;

    const barrelLen = tank.size * 0.82;
    const speed = 440;

    if (tank.hasTripleShot) {
      tank.hasTripleShot = false;
      const angles = [tank.angle - 0.22, tank.angle, tank.angle + 0.22];
      for (const a of angles) {
        const bx = tank.x + Math.cos(a) * barrelLen;
        const by = tank.y + Math.sin(a) * barrelLen;
        this.bullets.push({
          x: bx,
          y: by,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          bounces: 0,
          maxBounces: 2,
          owner: tank.index,
          radius: 4.5,
        });
      }
    } else {
      const bx = tank.x + Math.cos(tank.angle) * barrelLen;
      const by = tank.y + Math.sin(tank.angle) * barrelLen;
      this.bullets.push({
        x: bx,
        y: by,
        vx: Math.cos(tank.angle) * speed,
        vy: Math.sin(tank.angle) * speed,
        bounces: 0,
        maxBounces: 2,
        owner: tank.index,
        radius: 4.5,
      });
    }

    playShoot();
    this.addTrauma(0.08);

    if (tank.slotType === 'human' && typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(22);
    }

    this.shotTracers.push({
      x1: tank.x + Math.cos(tank.angle) * barrelLen,
      y1: tank.y + Math.sin(tank.angle) * barrelLen,
      x2: tank.x + Math.cos(tank.angle) * (barrelLen + 46),
      y2: tank.y + Math.sin(tank.angle) * (barrelLen + 46),
      color: tank.color,
      life: 0.12,
    });
  }

  handleRemoteInput(slotIndex, data) {
    const tank = this.tanks[slotIndex];
    if (!tank || !tank.isJoined || !tank.isAlive) return;

    if (data.action === 'TANK_DRIVE') {
      tank.isDriving = !!data.driving;
      if (data.driving) {
        this.driveOwner[slotIndex] = 'remote';
      } else if (this.driveOwner[slotIndex] === 'remote') {
        this.driveOwner[slotIndex] = null;
      }
    } else if (data.action === 'TANK_FIRE') {
      this.attemptFire(tank);
    }
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
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
      this.roundTimer += dt;
      this.crateSpawnTimer -= dt;
      if (this.crateSpawnTimer <= 0 && this.crates.length < 2) {
        this.spawnCrate();
        this.crateSpawnTimer = 9.0 + Math.random() * 4.0;
      }

      // Check crate collection
      for (let cIdx = this.crates.length - 1; cIdx >= 0; cIdx--) {
        const crate = this.crates[cIdx];
        crate.life -= dt;
        if (crate.life <= 0) {
          this.crates.splice(cIdx, 1);
          continue;
        }

        for (const tank of this.tanks) {
          if (!tank.isAlive || !tank.isJoined) continue;
          if (Math.hypot(tank.x - crate.x, tank.y - crate.y) < tank.size * 0.75) {
            playPowerUp();
            this.spawnRicochetSparks(crate.x, crate.y);
            if (crate.type === 'TURBO') {
              tank.turboTimer = 6.0;
            } else if (crate.type === 'TRIPLE') {
              tank.hasTripleShot = true;
              tank.chamber = tank.maxBullets;
              tank.reloadTimer = 0;
            } else if (crate.type === 'SHIELD') {
              tank.hasShield = true;
            }
            this.crates.splice(cIdx, 1);
            break;
          }
        }
      }
    }

    if (this.state === 'PLAYING' || this.state === 'ROUND_OVER' || this.state === 'LOBBY') {
      for (const tank of this.tanks) {
        if (!tank.isJoined || !tank.isAlive) continue;

        if (tank.reloadTimer > 0) {
          tank.reloadTimer = Math.max(0, tank.reloadTimer - dt);
          if (tank.reloadTimer <= 0 && tank.chamber < tank.maxBullets) {
            tank.chamber++;
            if (tank.chamber < tank.maxBullets) tank.reloadTimer = tank.reloadCooldown;
          }
        } else if (tank.chamber < tank.maxBullets) {
          tank.reloadTimer = tank.reloadCooldown;
        }
        if (tank.muzzleFlashTimer > 0) {
          tank.muzzleFlashTimer = Math.max(0, tank.muzzleFlashTimer - dt);
        }

        if (tank.turboTimer > 0) {
          tank.turboTimer = Math.max(0, tank.turboTimer - dt);
          if (Math.random() < 0.25) {
            this.spawnTreadDust(tank.x, tank.y);
          }
        }

        // Run AI logic for Bot tanks
        if (tank.slotType !== 'human' && this.state === 'PLAYING') {
          this.updateTankBotAI(tank, dt);
        }

        if (this.state === 'PLAYING' && tank.slotType === 'human' && !tank.isDriving) {
          tank.angle += tank.rotationSpeed * tank.spinDirection * dt;
        }

        if (tank.isDriving && this.state === 'PLAYING') {
          this.moveTankWithCollision(tank, dt);
        } else if (tank.slotType !== 'human' && !tank._aiSteered) {
          // AI bu kare aktif direksiyon yapmadıysa boşta yavaşça dön (lobi/ruh hali)
          tank.angle += tank.rotationSpeed * dt;
        }
        tank._aiSteered = false;
      }

      this.updateBullets(dt);
      this.updateParticles(dt);
      for (let i = this.shotTracers.length - 1; i >= 0; i--) {
        this.shotTracers[i].life -= dt;
        if (this.shotTracers[i].life <= 0) this.shotTracers.splice(i, 1);
      }

      if (this.state === 'PLAYING') {
        const aliveTanks = this.tanks.filter((t) => t.isJoined && t.isAlive);
        if (aliveTanks.length <= 1) {
          this.handleRoundEnd(aliveTanks.length === 1 ? aliveTanks[0] : null);
        }
      }
    }
  }

  updateTankBotAI(tank, dt) {
    runTankBotAI(this, tank, dt);
  }

  spawnTreadDust(x, y) {
    this.particles.push({
      x: x + (Math.random() - 0.5) * 12,
      y: y + (Math.random() - 0.5) * 12,
      vx: (Math.random() - 0.5) * 25,
      vy: (Math.random() - 0.5) * 25,
      life: 0.25,
      maxLife: 0.25,
      size: 3,
      color: '#99948A',
    });
  }

  moveTankWithCollision(tank, dt) {
    const currentSpeed = tank.turboTimer > 0 ? 285 : (this.roundTimer > 35 ? 220 : tank.driveSpeed);
    const moveX = Math.cos(tank.angle) * currentSpeed * dt;
    const moveY = Math.sin(tank.angle) * currentSpeed * dt;
    const half = tank.size / 2;
    const startX = tank.x;
    const startY = tank.y;

    let nextX = tank.x + moveX;
    let nextY = tank.y;

    if (!this.checkTankCollision(nextX, nextY, half)) {
      tank.x = nextX;
    }

    nextX = tank.x;
    nextY = tank.y + moveY;

    if (!this.checkTankCollision(nextX, nextY, half)) {
      tank.y = nextY;
    }

    if (tank.x === startX && tank.y === startY) {
      const slideX = -Math.sin(tank.angle) * currentSpeed * dt * 0.7;
      const slideY = Math.cos(tank.angle) * currentSpeed * dt * 0.7;
      if (!this.checkTankCollision(tank.x + slideX, tank.y + slideY, half)) {
        tank.x += slideX;
        tank.y += slideY;
      } else if (!this.checkTankCollision(tank.x - slideX, tank.y - slideY, half)) {
        tank.x -= slideX;
        tank.y -= slideY;
      }
    }
  }

  checkTankCollision(x, y, half) {
    const { left, right, top, bottom } = this.arena;

    if (x - half <= left || x + half >= right || y - half <= top || y + half >= bottom) {
      return true;
    }

    for (const obs of this.obstacles) {
      if (
        x + half > obs.x &&
        x - half < obs.x + obs.w &&
        y + half > obs.y &&
        y - half < obs.y + obs.h
      ) {
        return true;
      }
    }
    return false;
  }

  updateBullets(dt) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const nextX = b.x + b.vx * dt;
      const nextY = b.y + b.vy * dt;
      let bounced = false;

      if (nextX - b.radius <= this.arena.left) {
        b.vx = Math.abs(b.vx);
        b.x = this.arena.left + b.radius + 1;
        bounced = true;
      } else if (nextX + b.radius >= this.arena.right) {
        b.vx = -Math.abs(b.vx);
        b.x = this.arena.right - b.radius - 1;
        bounced = true;
      }

      if (nextY - b.radius <= this.arena.top) {
        b.vy = Math.abs(b.vy);
        b.y = this.arena.top + b.radius + 1;
        bounced = true;
      } else if (nextY + b.radius >= this.arena.bottom) {
        b.vy = -Math.abs(b.vy);
        b.y = this.arena.bottom - b.radius - 1;
        bounced = true;
      }

      for (const obs of this.obstacles) {
        if (
          nextX + b.radius > obs.x &&
          nextX - b.radius < obs.x + obs.w &&
          nextY + b.radius > obs.y &&
          nextY - b.radius < obs.y + obs.h
        ) {
          const prevLeftDist = Math.abs(b.x - obs.x);
          const prevRightDist = Math.abs(b.x - (obs.x + obs.w));
          const prevTopDist = Math.abs(b.y - obs.y);
          const prevBottomDist = Math.abs(b.y - (obs.y + obs.h));
          const minH = Math.min(prevLeftDist, prevRightDist);
          const minV = Math.min(prevTopDist, prevBottomDist);

          if (minH < minV) {
            b.vx = -b.vx;
          } else {
            b.vy = -b.vy;
          }
          bounced = true;
          break;
        }
      }

      if (bounced) {
        b.bounces++;
        playRicochet();
        this.spawnRicochetSparks(b.x, b.y);

        if (b.bounces > b.maxBounces) {
          this.bullets.splice(i, 1);
          continue;
        }
      } else {
        b.x = nextX;
        b.y = nextY;
      }

      for (const tank of this.tanks) {
        if (!tank.isAlive || !tank.isJoined) continue;
        // Kendi attığı mermiden hasar almaz (öz-hasar koruması)
        if (b.owner === tank.index) continue;

        if (Math.hypot(b.x - tank.x, b.y - tank.y) < tank.size * 0.65) {
          if (tank.hasShield) {
            tank.hasShield = false;
            this.bullets.splice(i, 1);
            this.spawnRicochetSparks(tank.x, tank.y);
            playRicochet();
            this.addTrauma(0.2);
            break;
          }

          tank.isAlive = false;
          this.bullets.splice(i, 1);
          this.spawnTankExplosion(tank.x, tank.y, tank.color);
          playExplosion();
          this.addTrauma(0.4);

          if (tank.slotType === 'human' && typeof navigator !== 'undefined' && navigator.vibrate) {
            navigator.vibrate([40, 50, 80]);
          }
          break;
        }
      }
    }
  }

  spawnRicochetSparks(x, y) {
    for (let i = 0; i < 4; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 80;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.22,
        maxLife: 0.22,
        size: 3,
        color: '#1A1A1A',
      });
    }
  }

  spawnTankExplosion(x, y, color) {
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 50 + Math.random() * 150;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.65,
        maxLife: 0.65,
        size: 4 + Math.random() * 4,
        color: Math.random() > 0.4 ? color : '#1A1A1A',
      });
    }
  }

  updateParticles(dt) {
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

  handleRoundEnd(winnerTank) {
    this.state = 'ROUND_OVER';
    this.roundWinner = winnerTank;
    this.roundTransitionTimer = 1.8;

    if (winnerTank) {
      this.scores[winnerTank.index]++;
      if (this.scores[winnerTank.index] >= this.targetScore) {
        this.matchWinner = winnerTank;
      }
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (this.trauma > 0 && !prefersReducedMotion()) {
      const intensity = this.trauma * this.trauma * 16;
      ctx.translate((Math.random() - 0.5) * intensity, (Math.random() - 0.5) * intensity);
    }

    // Arena sahnesi ortak tanksView draw'larından gelir (host↔client aynı).
    drawTanksArena(ctx, this.arena, this.obstacles);

    this.uiButtons = [];

    drawTanksBullets(ctx, this.bullets, TANK_COLORS);
    drawSquareParticles(ctx, this.particles);
    drawTanksTracers(ctx, this.shotTracers);
    drawTanksCrates(ctx, this.crates);

    const sceneTanks = this.tanks.map((tk) => ({
      ...tk,
      slot: tk.index,
      driving: tk.isDriving === true,
      muzzle: tk.muzzleFlashTimer || 0,
      bot: tk.slotType === 'bot_normal' || tk.slotType === 'bot_god',
      god: tk.slotType === 'bot_god',
      shield: tk.hasShield === true,
      eshield: tk.shield === true,
      stun: (tk.stunTimer || 0) > 0,
      chamber: Math.max(0, Number(tk.chamber ?? tk.maxBullets ?? 2) || 0),
      maxAmmo: Math.max(1, Number(tk.maxBullets) || 2),
      reload: tk.reloadTimer || 0,
      reloadCd: tk.reloadCooldown || 1.1,
      triple: tk.hasTripleShot === true,
    }));
    drawTanksTanks(ctx, sceneTanks, { arena: this.arena, withFx: this.state === 'PLAYING' });

    if (this.state === 'PLAYING' && this.spawnIntroTimer > 0) {
      this.renderSpawnBeacons(ctx);
    }

    // Sudden Death Top HUD Pill
    if (this.state === 'PLAYING' && this.roundTimer > 35) {
      renderTopPill(ctx, { arena: this.arena, text: t('tanks.sudden'), urgent: true });
    }

    this.renderControls(ctx, { extraEntities: this.bullets });
    this.renderHUD(ctx, {
      guideTitle: t('guide.tanks'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: TANK_COLORS,
      playerNames: this.tanks.map((tank, i) => (tank && tank.name && tank.name !== TANK_NAMES[i]) ? tank.name : ''),
      accent: '#D84727',
      scoreboardEntities: [
        ...this.tanks.filter((t) => t.isJoined && t.isAlive).map((t) => ({ x: t.x, y: t.y, radius: t.size || 20 })),
        ...this.bullets.map((b) => ({ x: b.x, y: b.y, radius: 10 })),
      ],
      matchOverHeadline: t('tanks.champ'),
      matchOverRows: this.tanks
        .filter((tank) => tank.isJoined)
        .map((tank) => ({ color: tank.color, text: `${tank.name}: ${this.scores[tank.index] || 0}★` })),
      onSeatChange: (i) => {
        if (this.tanks[i]) {
          this.tanks[i].isJoined = this.isSlotJoined(i);
          this.tanks[i].slotType = this.slotTypes[i];
        }
        playJoin();
      },
    });

    ctx.restore();
  }

  renderSpawnBeacons(ctx) {
    const progress = this.spawnIntroTimer / 2.0;

    this.tanks.forEach((tank) => {
      if (!tank.isJoined || !tank.isAlive) return;

      const cornerCenter = this.getCornerCenter(tank.index);

      ctx.save();
      ctx.strokeStyle = tank.color;
      ctx.lineWidth = 2;
      ctx.globalAlpha = Math.min(1.0, progress * 1.5);
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(cornerCenter.x, cornerCenter.y);
      ctx.lineTo(tank.x, tank.y);
      ctx.stroke();

      const ringRadius = tank.size * 0.9 + (1 - progress) * 26;
      ctx.setLineDash([]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(tank.x, tank.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      const tagW = 104;
      const tagH = 26;
      const tagX = tank.x - tagW / 2;
      const tagY = tank.y - tank.size - 26;

      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(tagX + 3, tagY + 3, tagW, tagH);

      ctx.fillStyle = tank.color;
      ctx.fillRect(tagX, tagY, tagW, tagH);
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(tagX, tagY, tagW, tagH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 12.5px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const role = tank.slotType === 'bot_god' ? '⚡GOD' : tank.slotType === 'bot_normal' ? '🤖BOT' : 'P' + (tank.index + 1);
      ctx.fillText(`${role} • ${tank.name}`, tank.x, tagY + tagH / 2);
      ctx.restore();
    });
  }



}
