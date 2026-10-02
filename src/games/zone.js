// BRUTAL ZONE (Game 08): 2-4 Player Territory Capture Party Game (paper.io style)
// Grid-based land grabbing: leave your base to draw a trail, close the loop to
// capture. Enemy steps on your trail -> you shatter back to base size + 2s stun
// (no elimination, party flow preserved). 90s rounds, first to 40% takes the
// round early, first to 2 rounds is the champion.
import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import {
  playStart,
  playJoin,
  playDashWhoosh,
  playExplosion,
  playCoinPickup,
  playCashRegister,
  playStumble,
  playPowerUp,
} from '../audio.js';
import { t } from '../i18n.js';
import { matchesInputAction } from '../core/inputIntent.js';
import {
  renderTopPill,
  renderSpatialBadge,
  renderArenaWatermarkTimer,
} from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateZoneBotAI } from '../ai/zoneAI.js';
import { keyboardVectorFrom, slotForActionCode } from '../core/inputMaps.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import {
  createZoneWorldPacket,
  packZoneGridRle,
  drawZoneField,
  drawZonePlayers,
  drawZoneWaves,
  drawZoneFxLayer,
  ZONE_THEME_25D,
} from './zoneView.js';
import { drawAlphaTexts, drawFxFlash } from './worldCore.js';
import { beginDrawRound, beginRound, endMatch, roundTimedOut, tickRoundFlow } from '../core/roundLifecycle.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { fxFlashAlpha } from '../core/fxKit.js';
import { TILTED_25D_CAMERA } from '../core/projection2d.js';
import { createTiltedScene } from '../core/tiltedScene.js';
import { UI_COLORS } from '../ui/tokens.js';

export const ZONE_COLORS = Object.freeze([...UI_COLORS.players]);
export const ZONE_NAMES = ['P1', 'P2', 'P3', 'P4'];

// Relic tipleri: Arena içinde nötr/orta alanda beliren taktiksel güç kristalleri
// (glyph/icon tek kaynak tabletopIcons registry anahtarıdır — tel üstünde ham emoji yok)
export const ZONE_RELIC_DEFS = {
  FLASH: {
    id: 'FLASH',
    name: 'FLASH CORE',
    badge: '⚡',
    icon: 'zap',
    glyph: 'zap',
    title: 'HIZ KORU',
    color: '#FFD122',
    glowColor: 'rgba(255, 209, 34, 0.45)',
    desc: 'DEPAR SIFIRLANDI + EKSTRA HIZ',
  },
  SEISMIC: {
    id: 'SEISMIC',
    name: 'SEISMIC PULSE',
    badge: '💥',
    icon: 'flame',
    glyph: 'flame',
    title: 'SİSMİK DARBE',
    color: '#FF473A',
    glowColor: 'rgba(255, 71, 58, 0.45)',
    desc: '5x5 ÇAPINDA ALAN PATLAMASI',
  },
};

// Tek akort noktası: tüm sayısal denge burada.
export const ZONE_TUNING = {
  GRID: 64,          // capture alanı: 64x64 hücre
  BASE: 7,           // başlangıç base kenarı (7x7 hücre)
  SPEED: 12.8,       // hücre/sn
  TURF_SPEED_MULT: 1.15, // Kendi bölgesinde %15 defansif hız bonusu (Home Turf)
  TURN: 12.5,        // rad/sn yumuşak dönüş
  ROUND_TIME: 90.0,  // sn
  WIN_PCT: 40,       // erken zafer eşiği (%)
  STUN: 2.0,         // çarpışma dondurması (sn)
  TARGET_SCORE: 2,   // maçı alan raund sayısı
  TRAIL_CAP: 1500,   // güvenlik tavanı (aşılırsa iz silinir + stun)
  TRAIL_RISK_WARN: 15, // Yüksek risk iz uyarısı
  TRAIL_HAZARD: 22,   // Tehlikeli iz kritik seviyesi (yanıp sönen şerit)
  DASH_MULT: 2.2,    // depar hız çarpanı
  DASH_TIME: 0.22,   // depar süresi (sn)
  DASH_CD: 4.0,      // depar bekleme (sn)
  AVATAR_R_MULT: 1.15, // karakter yarıçapı = hücre * bu (iri görünüm, grid'e dokunmaz)
  // FIELD_TIERS §normal bandı (28–36): BOMB/CROWN/HEIST ile aynı gövde.
  // Hücre ~14.8px'te gövde 2.4 hücre — pilot eşitleme (2026-09).
  PLAYER_RADIUS: 36,   // tasarım referans yarıçapı (px)
  MOVE_SPEED: 190,     // tasarım referans hareket hızı (px/s) — SPEED × hücre ile birebir
  AVATAR_R_MIN: 0.018,
  TRAIL_W_MULT: 0.95,  // açık iz çizgi kalınlığı = hücre * bu
  TRAIL_GLOW_MULT: 1.05, // risk uyarısı dış parlama = hücre * bu (hazard'da +0.2)
  RELIC_SPAWN_INIT: 4.5, // İlk relic çıkış süresi (sn)
  RELIC_SPAWN_CD: 8.5,   // Relic çıkış periyodu (sn)
  MAX_RELICS: 2,         // Sahada aynı anda en fazla relic sayısı
  MAX_TIED_ROUNDS: 2,     // üst üste beraberlikte maç draw sınırı
};

export class ZoneGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // 2.5D sahne zarfı: kamera arena+viewport+sabit temadan sığdırılır; ONLINE
    // client AYNI sabit temayla aynı sahneyi kurar (sahne birebir eşleşir).
    this.scene = createTiltedScene({ camera: TILTED_25D_CAMERA.zone });
    this.proj = this.scene.proj;
    this.arena = { cx: 0, cy: 0, width: 0, height: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    // Kare capture alanı (arena içinde ortalı): { x, y, s } + hücre px boyu
    this.field = { x: 0, y: 0, s: 0 };
    this.cell = 0;

    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];

    this.targetScore = ZONE_TUNING.TARGET_SCORE;
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.roundTransitionTimer = 0;

    this.roundTimer = ZONE_TUNING.ROUND_TIME;
    this.pct = [0, 0, 0, 0];
    this.kills = [0, 0, 0, 0];
    // Tur köşe kurası: oyuncu index'i → köşe (0..3). null iken lobide sabit köşeler.
    this.baseCorner = null;
    this.leaderIndex = -1;
    // Beraberlik çözücü: son toprak kazananın damgası
    this.lastCaptureBy = -1;
    this.lastCaptureAt = 0;
    this.tieBreak = false;
    // Spawn koruması (P1-4): raund başı 1.5sn düşman kesmesi işlemez
    this.spawnProtect = 0;

    // Bölge sahipliği: 0=nötr, 1-4 oyuncu (index+1). Host-only, ağa çıkmaz.
    this.grid = new Uint8Array(ZONE_TUNING.GRID * ZONE_TUNING.GRID);
    // Açık iz sahipliği: -1=iz yok, yoksa oyuncu index'i.
    this.trailOwner = new Int8Array(ZONE_TUNING.GRID * ZONE_TUNING.GRID).fill(-1);

    this.players = [];
    this.relics = [];
    this.relicSpawnTimer = ZONE_TUNING.RELIC_SPAWN_INIT;
    this.captureWaves = [];
    // FX runtime (MOTION_PLAN Faz 2c): toz/patlama/kapanış olaylarının tek sahibi.
    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    /** @type {any[]} */ this.particles = this.fx.particles;
    this.floatingTexts = [];
    this.territoryDirty = true;
    this.territoryLayer = document.createElement('canvas');
    this.territoryLayer.width = ZONE_TUNING.GRID;
    this.territoryLayer.height = ZONE_TUNING.GRID;

    this.initKeyboard();
  }

  createWorldPacket() {
    return createZoneWorldPacket(this);
  }

  initKeyboard() {
    this.bindStandardKeyboard((slot) => {
      this.triggerDash(slot);
    });
  }

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('ZONE'),
      actions: [
        {
          id: 'dash',
          icon: '⚡',
          cooldownField: 'dashCooldown',
          maxCooldown: ZONE_TUNING.DASH_CD,
        },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    if (!isDown || actionId !== 'dash') return;
    this.triggerDash(slotIndex);
  }

  onSeatCycled() {
    playJoin();
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  // --- Grid yardımcıları (bot AI da kullanır) ---

  gridSize() {
    return ZONE_TUNING.GRID;
  }

  // Konum → hücre. Konum zaten saha içine CLAMP'li olduğu için kenar payı
  // takviyesi YOK: gövde yarıçapı kadar içeride duran oyuncu 0. hücreye
  // yazılırsa iz çizgisi karakterden ~3 hücre kopuk çizilir (köşeye
  // sürtününce çizgi kopuyordu). Dış halka yalnız yarıçap payı kadar
  // fethedilemez — bu, nötr sınır bandıdır.
  posToCell(x, y) {
    if (!this.field || !this.cell) return -1;
    const G = ZONE_TUNING.GRID;
    const cx = Math.floor((x - this.field.x) / this.cell);
    const cy = Math.floor((y - this.field.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= G || cy >= G) return -1;
    return cy * G + cx;
  }

  /**
   * Bir karelik hareket segmentinin geçtiği hücreler: sırayla, tekrar yok,
   * başlangıç hücresi hariç. Izgara DDA'sı (Amanatides–Woo): kesik atlama
   * YAPMAZ, köşe geçişinde de ara hücreyi yazar — ardışık hücreler daima
   * 4-komşu kalır.
   *
   * Neden tek kaynak: kesme tespiti (`checkTrailCrossing`) ve iz KAYDI aynı
   * listeyi okur. Tespit sık, kayıt seyrek olsaydı iz sahipliğinde boşluk
   * kalır, çizgi köşeyi keser ve kendi izinden geçmek cezasız olurdu.
   */
  cellsCrossed(fromX, fromY, toX, toY) {
    if (!this.field || !this.cell) return [];
    const G = ZONE_TUNING.GRID;
    const cell = this.cell;
    const fx = (fromX - this.field.x) / cell;
    const fy = (fromY - this.field.y) / cell;
    const dx = (toX - fromX) / cell;
    const dy = (toY - fromY) / cell;
    if (dx === 0 && dy === 0) return [];

    let cx = Math.floor(fx);
    let cy = Math.floor(fy);
    const stepX = dx > 0 ? 1 : -1;
    const stepY = dy > 0 ? 1 : -1;
    // Bir sonraki ızgara çizgisine kalan parametrik mesafe (t ∈ [0,1]).
    const invX = dx !== 0 ? 1 / Math.abs(dx) : Infinity;
    const invY = dy !== 0 ? 1 / Math.abs(dy) : Infinity;
    let tMaxX = dx !== 0 ? (dx > 0 ? cx + 1 - fx : fx - cx) * invX : Infinity;
    let tMaxY = dy !== 0 ? (dy > 0 ? cy + 1 - fy : fy - cy) * invY : Infinity;

    const out = [];
    for (let guard = 0; guard < G * 2; guard++) {
      // Eşitlikte X önce: köşe geçişi iki adıma bölünür, ara hücre yazılır.
      if (tMaxX <= tMaxY) {
        cx += stepX;
        tMaxX += invX;
      } else {
        cy += stepY;
        tMaxY += invY;
      }
      if (cx < 0 || cy < 0 || cx >= G || cy >= G) break;
      out.push(cy * G + cx);
      if (tMaxX > 1 && tMaxY > 1) break;
    }
    return out;
  }

  cellCenter(cellIdx) {
    const G = ZONE_TUNING.GRID;
    const cx = cellIdx % G;
    const cy = Math.floor(cellIdx / G);
    return { x: this.field.x + (cx + 0.5) * this.cell, y: this.field.y + (cy + 0.5) * this.cell };
  }

  ownerAt(cellIdx) {
    if (cellIdx < 0 || cellIdx >= this.grid.length) return -1;
    return this.grid[cellIdx];
  }

  // Oyuncunun köşe base dikdörtgeni (hücre koordinatı). Tur kurası varsa
  // (baseCorner) rastgele köşe, yoksa lobide sabit köşe: 0 sol-alt, 1 sol-üst,
  // 2 sağ-üst, 3 sağ-alt.
  baseRect(index) {
    const G = ZONE_TUNING.GRID;
    const B = ZONE_TUNING.BASE;
    const c = this.baseCorner?.[index] ?? index;
    if (c === 0) return { x0: 0, y0: G - B, x1: B - 1, y1: G - 1 };
    if (c === 1) return { x0: 0, y0: 0, x1: B - 1, y1: B - 1 };
    if (c === 2) return { x0: G - B, y0: 0, x1: G - 1, y1: B - 1 };
    return { x0: G - B, y0: G - B, x1: G - 1, y1: G - 1 };
  }

  // Tur başı köşe kurası: katılanlar 4 köşeye rastgele dağıtılır.
  drawBaseCorners(joined) {
    const corners = [0, 1, 2, 3];
    for (let i = corners.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      [corners[i], corners[j]] = [corners[j], corners[i]];
    }
    this.baseCorner = {};
    joined.forEach((pi, k) => { this.baseCorner[pi] = corners[k]; });
  }

  paintBase(index) {
    const r = this.baseRect(index);
    const G = ZONE_TUNING.GRID;
    for (let cy = r.y0; cy <= r.y1; cy++) {
      for (let cx = r.x0; cx <= r.x1; cx++) {
        this.grid[cy * G + cx] = index + 1;
      }
    }
    this.territoryDirty = true;
  }

  clearBase(index) {
    const r = this.baseRect(index);
    const G = ZONE_TUNING.GRID;
    for (let cy = r.y0; cy <= r.y1; cy++) {
      for (let cx = r.x0; cx <= r.x1; cx++) {
        this.grid[cy * G + cx] = 0;
      }
    }
    this.territoryDirty = true;
  }

  // Lobi koltuk tap'i: tam sıfırlama YOK — sadece ilgili koltuk güncellenir
  // (initPlayers grid'i silip yeniden boyuyordu, her tap'te önizleme kırpışıyordu).
  syncLobbySeat(index) {
    const p = this.players[index];
    if (!p) return;
    const wasJoined = p.isJoined;
    p.isJoined = this.isSlotJoined(index);
    p.slotType = this.slotTypes[index];
    if (!p.name) p.name = `P${index + 1}`;
    if (p.isJoined && !wasJoined) {
      const r = this.baseRect(index);
      p.x = this.field.x + ((r.x0 + r.x1 + 1) / 2) * this.cell;
      p.y = this.field.y + ((r.y0 + r.y1 + 1) / 2) * this.cell;
      p.trail = [];
      p.lastCell = this.posToCell(p.x, p.y);
      this.paintBase(index);
    } else if (!p.isJoined && wasJoined) {
      p.trail = [];
      this.wipeTrail(index);
      this.clearBase(index);
    }
    this.recomputePct();
    this.territoryDirty = true;
  }

  clearOwnership(index) {
    const tag = index + 1;
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === tag) this.grid[i] = 0;
    }
    this.territoryDirty = true;
  }

  wipeTrail(index) {
    const p = this.players[index];
    if (p) {
      p.trail = [];
      p.trailStartX = p.x;
      p.trailStartY = p.y;
    }
    for (let i = 0; i < this.trailOwner.length; i++) {
      if (this.trailOwner[i] === index) this.trailOwner[i] = -1;
    }
  }

  recomputePct() {
    const total = this.grid.length;
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < this.grid.length; i++) {
      const o = this.grid[i];
      if (o >= 1 && o <= 4) counts[o - 1]++;
    }
    let best = -1;
    let bestVal = -1;
    for (let i = 0; i < 4; i++) {
      const pl = this.players[i];
      this.pct[i] = pl && pl.isJoined ? Math.floor((counts[i] / total) * 100) : 0;
      if (pl && pl.isJoined && this.pct[i] > bestVal) {
        bestVal = this.pct[i];
        best = i;
      }
    }
    this.leaderIndex = best;
  }

  resize(width, height) {
    this.updateViewport(width, height);

    this.arena = computePlayfield(width, height, 'standard');
    const { width: arenaW, height: arenaH } = this.arena;

    // Kare capture alanı arena ortasında
    const s = Math.max(64, Math.min(arenaW, arenaH) - 4);
    this.field = { x: this.arena.cx - s / 2, y: this.arena.cy - s / 2, s };
    this.cell = s / ZONE_TUNING.GRID;

    // Mevcut maç varsa konumu yeni alana taşı (bölge sahipliği korunur)
    for (const p of this.players) {
      if (!p) continue;
      p.radius = fieldRadius(this.arena, ZONE_TUNING.PLAYER_RADIUS, 0);
      p.speed = fieldSpeed(this.arena, ZONE_TUNING.MOVE_SPEED);
      const rr = (p.radius || 6) + 1;
      p.x = Math.min(Math.max(p.x, this.field.x + rr), this.field.x + this.field.s - rr);
      p.y = Math.min(Math.max(p.y, this.field.y + rr), this.field.y + this.field.s - rr);
      p.lastCell = this.posToCell(p.x, p.y);
    }
    if (this.players.length === 0) this.initPlayers();
    this.territoryDirty = true;
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((i) => {
      const r = this.baseRect(i);
      const G = ZONE_TUNING.GRID;
      const bcx = this.field.x + ((r.x0 + r.x1 + 1) / 2) * this.cell;
      const bcy = this.field.y + ((r.y0 + r.y1 + 1) / 2) * this.cell;
      const outward = Math.atan2(this.arena.cy - bcy, this.arena.cx - bcx);
      const custom = getSlotCustomization(i);
      const isBot = this.slotTypes[i] === 'bot_normal' || this.slotTypes[i] === 'bot_god';
      const isGod = this.slotTypes[i] === 'bot_god';
      const persona = isBot ? getBotPersona(i, isGod) : null;
      const existing = this.players?.[i];
      return {
        index: i,
        name: existing?.name || (isBot ? persona.name : `P${i + 1}`),
        color: isBot ? persona.color : (custom.color || ZONE_COLORS[i]),
        x: bcx, y: bcy, heading: outward,
        radius: fieldRadius(this.arena, ZONE_TUNING.PLAYER_RADIUS, 0),
        speed: fieldSpeed(this.arena, ZONE_TUNING.MOVE_SPEED),
        // BaseGame.handleStandardRemoteJoystick `!player.isAlive` olan uzak
        // JOYSTICK_MOVE paketlerini düşürür; ZONE'da ölüm yok → daima true.
        isJoined: this.isSlotJoined(i), isAlive: true, slotType: this.slotTypes[i],
        trail: [], lastCell: -1,
        // İz-başlangıç anchor'ı: base'den çıkılan tam piksel nokta (render
        // kopukluğunu önler — ilk iz hücresinin merkezi değil, çıkış noktası).
        trailStartX: bcx, trailStartY: bcy,
        px: bcx, py: bcy,
        stunTimer: 0, blinkTimer: 0,
        dashTimer: 0, dashCooldown: 0, isDashing: false,
        aiMoveX: 0, aiMoveY: 0, aiForce: 0,
        aiMode: 'EXPAND', aiPath: [], aiTarget: -1, aiThink: Math.random() * 0.3,
        aiPlan: null, stuckTimer: 0, stuckX: bcx, stuckY: bcy,
        lastTapTime: 0,
      };
    });
    // Lobi önizlemesi: nötr zemin + base lekeleri
    this.grid.fill(0);
    this.trailOwner.fill(-1);
    for (let i = 0; i < 4; i++) {
      if (this.isSlotJoined(i)) this.paintBase(i);
    }
    this.recomputePct();
    this.territoryDirty = true;
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.kills = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId = 0;
    this.tiedRounds = 0;
    this.roundTimer = ZONE_TUNING.ROUND_TIME;
    this.leaderIndex = -1;
    this.lastCaptureBy = -1;
    this.lastCaptureAt = 0;
    this.tieBreak = false;
    this.spawnProtect = 0;
    this.relics = [];
    this.relicSpawnTimer = ZONE_TUNING.RELIC_SPAWN_INIT;
    this.captureWaves = [];
    this.fx.clear();
    this.floatingTexts = [];
    this.trauma = 0;
    this.baseCorner = null;
    this.lastTime = performance.now();
    for (const joy of this.joysticks) {
      joy.active = false; joy.id = -1; joy.force = 0;
    }
    this.initPlayers();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.kills = [0, 0, 0, 0];
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.tiedRounds = 0;
    this.startNewRound();
  }

  startNewRound() {
    const joined = [0, 1, 2, 3].filter((i) => this.isSlotJoined(i));
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'PLAYING';
    this.roundTimer = ZONE_TUNING.ROUND_TIME;
    this.roundWinner = null;
    this.matchDraw = false;
    this.roundResolutionReason = null;
    this.roundId += 1;
    this.roundTransitionTimer = 0;
    // Her tur köşeler yeniden çekilir — doğum bölgeleri rastgele
    this.drawBaseCorners(joined);
    this.lastCaptureBy = -1;
    this.lastCaptureAt = 0;
    this.tieBreak = false;
    this.spawnProtect = 1.5;
    this.relics = [];
    this.relicSpawnTimer = ZONE_TUNING.RELIC_SPAWN_INIT;
    this.captureWaves = [];
    this.fx.clear();
    this.floatingTexts = [];
    this.trauma = 0;
    // Raund hijyeni: önceki turdan joystick/tuş girdisi sarkmasın
    // (takılı input yeni turda hayalet hareket/donma yapıyordu).
    for (const joy of this.joysticks) {
      joy.active = false; joy.id = -1; joy.force = 0; joy.angle = 0;
    }
    this.keys = {};
    this.grid.fill(0);
    this.trailOwner.fill(-1);
    this.initPlayers();
    playStart();
  }

  // --- Güç Kristalleri (Relics): Flash Core & Seismic Pulse ---

  spawnRelic() {
    if (this.relics.length >= ZONE_TUNING.MAX_RELICS) return;
    const G = ZONE_TUNING.GRID;
    // Nötr ya da çekişmeli orta kuşakta uygun boş hücre ara
    const type = Math.random() < 0.55 ? 'FLASH' : 'SEISMIC';
    let bestCell = -1;
    let minOwnerCount = 999;
    for (let attempts = 0; attempts < 16; attempts++) {
      const cx = 14 + Math.floor(Math.random() * (G - 28));
      const cy = 14 + Math.floor(Math.random() * (G - 28));
      const ci = cy * G + cx;
      if (this.relics.some((r) => r.cellIdx === ci)) continue;
      const owner = this.grid[ci];
      if (owner === 0) {
        bestCell = ci;
        break;
      } else if (owner < minOwnerCount) {
        minOwnerCount = owner;
        bestCell = ci;
      }
    }
    if (bestCell < 0) return;
    const center = this.cellCenter(bestCell);
    this.relics.push({
      id: Math.random().toString(36).slice(2, 7),
      type,
      x: center.x,
      y: center.y,
      cellIdx: bestCell,
      lifetime: 20.0,
      maxLife: 20.0,
      bobPhase: Math.random() * Math.PI * 2,
      scale: 0,
    });
    this.fx.emit('spark', { x: center.x, y: center.y, color: ZONE_RELIC_DEFS[type].color });
  }

  collectRelic(playerIndex, relicIndex) {
    const p = this.players[playerIndex];
    const r = this.relics[relicIndex];
    if (!p || !r) return;

    const def = ZONE_RELIC_DEFS[r.type];
    this.relics.splice(relicIndex, 1);

    if (r.type === 'FLASH') {
      p.dashCooldown = 0;
      p.dashTimer = ZONE_TUNING.DASH_TIME * 1.5;
      p.isDashing = true;
      this.addFloatingText(p.x, p.y - 34, 'FLASH DEPAR!', '#FFD122');
      // Relic pickup: `zone` olayı (halka + travma + haptik).
      this.fx.emit('zone', {
        x: r.x, y: r.y, color: '#FFD122',
        dirX: Math.cos(p.heading), dirY: Math.sin(p.heading),
        slot: playerIndex, haptic: p.slotType === 'human',
      });
      playPowerUp();
      playDashWhoosh();
    } else if (r.type === 'SEISMIC') {
      // 5x5 çapında dairesel alan fethi
      const G = ZONE_TUNING.GRID;
      const rc = r.cellIdx;
      const cx = rc % G;
      const cy = (rc / G) | 0;
      const radius = 3;
      const tag = playerIndex + 1;
      let claimedCount = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > (radius + 0.5) * (radius + 0.5)) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= G || ny >= G) continue;
          const nci = ny * G + nx;
          
          // Patlama içindeki düşman açık izlerini kes
          const to = this.trailOwner[nci];
          if (to >= 0 && to !== playerIndex && this.spawnProtect <= 0) {
            this.shatterPlayer(to, playerIndex);
          }

          if (this.grid[nci] !== tag) {
            this.grid[nci] = tag;
            claimedCount++;
          }
        }
      }

      this.recomputePct();
      this.territoryDirty = true;
      this.addFloatingText(p.x, p.y - 34, t('zone.quake', claimedCount), '#FF473A');
      // Deprem: `kill` olayı — ekran seviyesi an (burst+ring+pop+hit-stop+flaş).
      this.fx.emit('kill', {
        x: r.x, y: r.y, color: '#FF473A', size: this.cell * 4,
        ringRadius: this.cell * 8,
        slot: playerIndex, haptic: p.slotType === 'human',
      });
      this.captureWaves.push({
        x: r.x,
        y: r.y,
        radius: this.cell * 2,
        maxRadius: this.cell * 8,
        color: '#FF473A',
        alpha: 1.0,
        speed: this.cell * 24,
      });
      playExplosion();
      playCashRegister();
    }
  }

  // --- Cezalar ---

  stunPlayer(index, announce) {
    const p = this.players[index];
    if (!p || !p.isJoined) return;
    p.stunTimer = ZONE_TUNING.STUN;
    p.blinkTimer = 0;
    if (announce) {
      this.addFloatingText(p.x, p.y - 24, 'DONDU!', '#FFFFFF');
      playStumble();
    }
  }

  triggerDash(playerIndex) {
    // Lobi/maç-sonunda kumandadan depar tetiklenemez (uzak girdi kapısı)
    if (this.state !== 'PLAYING') return;
    const p = this.players[playerIndex];
    if (!p || !p.isJoined || p.stunTimer > 0 || p.dashCooldown > 0) return;
    p.dashCooldown = ZONE_TUNING.DASH_CD;
    p.dashTimer = ZONE_TUNING.DASH_TIME;
    p.isDashing = true;
    // Depar: `zone` olayı (halka + travma + haptik) — toz bulutu profille gelir.
    this.fx.emit('zone', {
      x: p.x - Math.cos(p.heading) * p.radius,
      y: p.y - Math.sin(p.heading) * p.radius,
      color: '#D5D0C7',
      dirX: Math.cos(p.heading), dirY: Math.sin(p.heading),
      slot: playerIndex, haptic: p.slotType === 'human',
    });
    playDashWhoosh();
  }

  // Katil ödülü: kurbanın base-dışı hücrelerini katile uzaklığına göre dizer,
  // en yakın %20'yi katile geçirir. Base hücresi havuza girmez (kurbanın).
  // Dönüş: verilen hücre sayısı.
  awardKillBounty(victimIndex, killerIndex) {
    const G = ZONE_TUNING.GRID;
    const vTag = victimIndex + 1;
    const kTag = killerIndex + 1;
    const k = this.players[killerIndex];
    if (!k) return 0;
    const start = this.posToCell(k.x, k.y);
    if (start < 0) return 0;

    // BFS mesafe haritası (kesme başına bir kez, 4K hücre)
    const dist = new Int32Array(this.grid.length).fill(-1);
    const queue = [start];
    dist[start] = 0;
    let head = 0;
    while (head < queue.length) {
      const cur = queue[head++];
      const cx = cur % G;
      const cy = (cur / G) | 0;
      const nd = dist[cur] + 1;
      if (cx > 0 && dist[cur - 1] === -1) { dist[cur - 1] = nd; queue.push(cur - 1); }
      if (cx < G - 1 && dist[cur + 1] === -1) { dist[cur + 1] = nd; queue.push(cur + 1); }
      if (cy > 0 && dist[cur - G] === -1) { dist[cur - G] = nd; queue.push(cur - G); }
      if (cy < G - 1 && dist[cur + G] === -1) { dist[cur + G] = nd; queue.push(cur + G); }
    }

    const br = this.baseRect(victimIndex);
    const pool = [];
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] !== vTag) continue;
      const cx = i % G;
      const cy = (i / G) | 0;
      if (cx >= br.x0 && cx <= br.x1 && cy >= br.y0 && cy <= br.y1) continue; // base kurbanın
      pool.push(i);
    }
    if (pool.length === 0) return 0;
    pool.sort((a, b) => dist[a] - dist[b]);
    const award = Math.max(1, Math.floor(pool.length * 0.2));
    for (let i = 0; i < award; i++) {
      this.grid[pool[i]] = kTag;
    }
    this.territoryDirty = true;
    return award;
  }

  // Kuyruğu kesilen oyuncu: her şeyini kaybeder, base boyutuna döner + 2sn donar.
  // Katil ödülü (P0-1): kurbanın base-dışı toprağının katile en yakın %20'si
  // katile geçer — kartopu kontrollü, %40 eşiği erişilebilir kalır.
  shatterPlayer(victimIndex, killerIndex) {
    const v = this.players[victimIndex];
    if (!v || !v.isJoined) return;
    if (v.stunTimer > 0 && v.trail.length === 0) return; // zincir-kesilme koruması
    let bounty = 0;
    if (killerIndex !== null && killerIndex !== undefined && killerIndex >= 0) {
      bounty = this.awardKillBounty(victimIndex, killerIndex);
    }
    const oldTrail = [...v.trail];
    this.clearOwnership(victimIndex);
    this.wipeTrail(victimIndex);
    this.paintBase(victimIndex);
    const r = this.baseRect(victimIndex);
    // Base merkezi: dikdörtgen ortası (piksel)
    const bcx = this.field.x + ((r.x0 + r.x1 + 1) / 2) * this.cell;
    const bcy = this.field.y + ((r.y0 + r.y1 + 1) / 2) * this.cell;

    // Shatter Fragment Recall: İz parçacıkları üsse geri uçar (`kill` olayının
    // burst'ı bu işi tek çağrıyla yapar — ızgaradan örneklenen yön yerine
    // merkezden dışa yayılan profil burst'ı).
    if (oldTrail.length > 0) {
      this.fx.emit('dust', { x: bcx, y: bcy, color: v.color });
    }

    v.x = bcx; v.y = bcy;
    v.px = bcx; v.py = bcy;
    v.trailStartX = bcx; v.trailStartY = bcy;
    // Bot beyni sıfırla: eski OUT/SWEEP/HOME planıyla hayalet hedefe yürümesin
    v.aiPlan = null;
    v.aiPath = [];
    v.aiTarget = -1;
    v.aiThink = 0;
    v.heading = Math.atan2(this.arena.cy - bcy, this.arena.cx - bcx);
    v.lastCell = this.posToCell(bcx, bcy);
    // Avcı bonusu (P1-3): son 15sn'de liderin 10+ puan gerisindeki katil
    // keserse kurban 2.5sn donar — comeback kıvılcımı.
    let stunDur = ZONE_TUNING.STUN;
    if (killerIndex !== null && killerIndex !== undefined && killerIndex >= 0
        && this.roundTimer <= 15 && this.leaderIndex >= 0 && this.leaderIndex !== killerIndex
        && this.pct[killerIndex] + 10 <= this.pct[this.leaderIndex]) {
      stunDur = ZONE_TUNING.STUN + 0.5;
      const kb = this.players[killerIndex];
      if (kb) this.addFloatingText(kb.x, kb.y - 46, 'AVCI BONUSU!', kb.color);
    }
    v.stunTimer = stunDur;
    if (killerIndex !== null && killerIndex !== undefined && killerIndex >= 0) {
      this.kills[killerIndex]++;
      const k = this.players[killerIndex];
      this.addFloatingText(v.x, v.y - 30, t('zone.cut', k ? k.name : ''), '#D84727');
      if (bounty > 0 && k) {
        this.addFloatingText(k.x, k.y - 30, t('zone.bounty', bounty), k.color);
      }
    } else {
      this.addFloatingText(v.x, v.y - 30, t('zone.selfCut'), '#D84727');
    }
    this.addFloatingText(v.x, v.y - 12, t('zone.baseBack'), '#FFFFFF');
    this.recomputePct();
    // Kesilme: `kill` olayı (burst+ring+pop+hit-stop+flaş+travma 0.4) —
    // eski 0.55 travma ekran bütçesinin (0.4) altına indi.
    this.fx.emit('kill', {
      x: v.x, y: v.y, color: v.color, size: v.radius || 18, angle: v.heading,
      dirX: v.x - bcx, dirY: v.y - bcy,
      slot: v.index, haptic: v.slotType === 'human',
    });
    playExplosion();
  }

  // Kafa kafaya çarpışma: Her iki oyuncu da üsse geri ışınlanır, izleri silinir
  // ve üsse en uzak %50 toprakları nötr bölgeye geri döner (orta yol cezası).
  handleHeadOnCollision(i, j) {
    const a = this.players[i];
    const b = this.players[j];
    if (!a || !b) return;

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.addFloatingText(midX, midY - 20, 'KAFA KAFAYA!', '#FFFFFF');
    // Kafa kafa: `kill` olayı (tek ekran-seviyesi an; her iki koltuk de görür).
    this.fx.emit('kill', { x: midX, y: midY, color: '#FFFFFF', size: this.cell * 3, haptic: false });
    playExplosion();

    const penalizeAndReset = (idx) => {
      const p = this.players[idx];
      if (!p || !p.isJoined) return;

      const oldTrail = [...p.trail];
      this.wipeTrail(idx);

      const r = this.baseRect(idx);
      const bcx = this.field.x + ((r.x0 + r.x1 + 1) / 2) * this.cell;
      const bcy = this.field.y + ((r.y0 + r.y1 + 1) / 2) * this.cell;

      // İz parçacıkları üsse geri uçar (`dust` olayı — profil burst'ı).
      if (oldTrail.length > 0) {
        this.fx.emit('dust', { x: bcx, y: bcy, color: p.color });
      }

      // %50 Toprak Kaybı: Base dışı hücrelerin en uzaktaki %50'si nötrleşir
      const G = ZONE_TUNING.GRID;
      const tag = idx + 1;
      const nonBase = [];
      const baseMidX = (r.x0 + r.x1) / 2;
      const baseMidY = (r.y0 + r.y1) / 2;
      for (let ci = 0; ci < this.grid.length; ci++) {
        if (this.grid[ci] !== tag) continue;
        const cx = ci % G;
        const cy = (ci / G) | 0;
        if (cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1) continue;
        const dist = Math.hypot(cx - baseMidX, cy - baseMidY);
        nonBase.push({ ci, dist });
      }

      if (nonBase.length > 0) {
        nonBase.sort((n1, n2) => n2.dist - n1.dist);
        const removeCount = Math.floor(nonBase.length * 0.5);
        for (let k = 0; k < removeCount; k++) {
          this.grid[nonBase[k].ci] = 0;
        }
        this.territoryDirty = true;
      }
      this.paintBase(idx);

      p.x = bcx; p.y = bcy;
      p.px = bcx; p.py = bcy;
      p.trailStartX = bcx; p.trailStartY = bcy;
      p.aiPlan = null;
      p.aiPath = [];
      p.aiTarget = -1;
      p.aiThink = 0;
      p.heading = Math.atan2(this.arena.cy - bcy, this.arena.cx - bcx);
      p.lastCell = this.posToCell(bcx, bcy);
      p.stunTimer = ZONE_TUNING.STUN;
      this.addFloatingText(bcx, bcy - 20, t('zone.baseBack2'), '#FFFFFF');
      this.fx.emit('pickup', { x: bcx, y: bcy, color: p.color, haptic: p.slotType === 'human' });
    };

    penalizeAndReset(i);
    penalizeAndReset(j);
    this.recomputePct();
  }

  // İz kapanışı: iz hücreleri + çevrili kalan nötr/düşman hücreler kapanana geçer.
  closeTrail(index) {
    const p = this.players[index];
    if (!p || p.trail.length === 0) return;
    const G = ZONE_TUNING.GRID;
    const tag = index + 1;
    for (const cellIdx of p.trail) {
      if (cellIdx >= 0 && cellIdx < this.grid.length) this.grid[cellIdx] = tag;
    }
    // Kenarlardan sel: kendi bölgem/izim olmayan yerden ulaşılabilen her şey açık alandır.
    const open = new Uint8Array(this.grid.length);
    const stack = [];
    for (let x = 0; x < G; x++) {
      stack.push(x, (G - 1) * G + x);
    }
    for (let y = 1; y < G - 1; y++) {
      stack.push(y * G, y * G + G - 1);
    }
    while (stack.length > 0) {
      const ci = stack.pop();
      if (open[ci]) continue;
      if (this.grid[ci] === tag) continue;
      open[ci] = 1;
      const cx = ci % G;
      const cy = (ci / G) | 0;
      if (cx > 0) stack.push(ci - 1);
      if (cx < G - 1) stack.push(ci + 1);
      if (cy > 0) stack.push(ci - G);
      if (cy < G - 1) stack.push(ci + G);
    }
    let gained = 0;
    for (let i = 0; i < this.grid.length; i++) {
      if (!open[i] && this.grid[i] !== tag) {
        this.grid[i] = tag;
        gained++;
      }
    }
    this.wipeTrail(index);
    this.recomputePct();
    this.territoryDirty = true;
    if (gained > 0) {
      this.lastCaptureBy = index;
      this.lastCaptureAt = performance.now();
      // Wavefront Capture Ring
      this.captureWaves.push({
        x: p.x,
        y: p.y,
        radius: this.cell * 2,
        maxRadius: this.cell * Math.min(22, Math.max(7, Math.sqrt(gained) * 2.4)),
        color: p.color,
        alpha: 0.95,
        speed: this.cell * 30,
      });
    }
    // Kademeli kapanış geri bildirimi: küçük hamle fısıldar, devasa hamle gümler
    if (gained >= 100) {
      this.addFloatingText(p.x, p.y - 22, t('zone.mega', this.pct[index]), p.color);
      this.fx.emit('kill', { x: p.x, y: p.y, color: '#FFDE59', size: p.radius || 18, slot: index, haptic: p.slotType === 'human' });
      playCoinPickup();
      playCashRegister();
    } else if (gained >= 20) {
      this.addFloatingText(p.x, p.y - 22, t('zone.area', this.pct[index]), p.color);
      this.fx.emit('hit', { x: p.x, y: p.y, color: '#FFDE59', slot: index, haptic: p.slotType === 'human' });
      playCoinPickup();
    } else if (gained > 0) {
      this.addFloatingText(p.x, p.y - 22, `+%${this.pct[index]}`, p.color);
      this.fx.emit('pickup', { x: p.x, y: p.y, color: '#FFDE59', slot: index, haptic: p.slotType === 'human' });
      playCoinPickup();
    }
    if (this.pct[index] >= ZONE_TUNING.WIN_PCT && this.state === 'PLAYING') {
      this.finishRound(p);
    }
  }

  finishTiedRound(reason = 'tie') {
    if (!this.players.some((p) => p.isJoined)) {
      endMatch(this, null, reason);
      return;
    }
    this.tiedRounds += 1;
    if (this.tiedRounds >= ZONE_TUNING.MAX_TIED_ROUNDS) {
      endMatch(this, null, reason);
      return;
    }
    beginRound(this, null, reason);
  }

  finishRound(winner) {
    if (this.state !== 'PLAYING') return;
    if (!winner) {
      this.finishTiedRound('no-winner');
      return;
    }
    this.tiedRounds = 0;
    this.scores[winner.index]++;
    playCashRegister();
    if (this.scores[winner.index] >= this.targetScore) {
      this.roundWinner = winner;
      endMatch(this, winner, 'target-score');
      return;
    }
    beginRound(this, winner, 'win-pct');
  }

  addFloatingText(x, y, text, color = '#FFDE59') {
    this.floatingTexts.push({ x, y, text, color, life: 1.1, maxLife: 1.1 });
  }

  turnToward(current, target, maxStep) {
    let d = target - current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= maxStep) return target;
    return current + Math.sign(d) * maxStep;
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
    }

    if (this.handleRoundOverSkip()) return;

    if (this.state === 'LOBBY') {
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch, { onSeatChange: (q) => this.syncLobbySeat(q) });
      return;
    }
    if (this.state === 'MATCH_OVER') {
      matchOverRestartTap(this, touch, { radius: Infinity, onRestart: () => { this.startNewMatch(); playJoin(); } });
      return;
    }
    if (this.state === 'PLAYING') {
      this.handleTabletopTouchStart(touch);
    }
  }

  handleRemoteInput(slotIndex, data) {
    this.handleStandardRemoteJoystick(slotIndex, data, (slot, d) => {
      if (matchesInputAction(d, 'dash', 'DASH')) {
        this.triggerDash(slot);
      }
    });
  }

  keyboardVector(index) {
    return keyboardVectorFrom(this.keys, index);
  }

  checkTrailCrossing(player, fromX, fromY, toX, toY) {
    for (const cellIdx of this.cellsCrossed(fromX, fromY, toX, toY)) {
      const owner = this.trailOwner[cellIdx];
      if (owner >= 0 && owner !== player.index) {
        if (this.spawnProtect <= 0) {
          this.shatterPlayer(owner, player.index);
          return true;
        }
      } else if (owner === player.index) {
        const recentIndex = player.trail.lastIndexOf(cellIdx);
        const isImmediateTail = recentIndex >= 0 && (player.trail.length - 1 - recentIndex) <= 3;
        if (!isImmediateTail) {
          this.shatterPlayer(player.index, null);
          return true;
        }
      }
    }
    return false;
  }

  update(now) {
    const rawDt = this.clampDt(now, this.lastTime);
    this.lastTime = now;
    // Hit-stop TEK SAAT: host karesi yavaşlar, kumanda aynı kareyi görür (§2).
    const dt = this.fx.tick(rawDt);
    this.updateTrauma(dt);

    // Raunt/maç geçişi ortak akışta; efektler boşluk boyunca da akar (toz
    // ve kıvılcımlar sahne donmasın).
    if (tickRoundFlow(this, dt)) {
      this.updateFx(dt);
      return;
    }
    if (this.state !== 'PLAYING') {
      this.updateFx(dt);
      return;
    }

    // Tek katılımcı kalınca süre beklenmez — kalan raundu alır
    {
      const joined = this.players.filter((p) => p.isJoined);
      if (joined.length <= 1) {
        this.finishRound(joined.length === 1 ? joined[0] : null);
        return;
      }
    }

    this.roundTimer -= dt;
    if (this.spawnProtect > 0) this.spawnProtect = Math.max(0, this.spawnProtect - dt);

    // Relic Doğuş & Süre Yönetimi
    this.relicSpawnTimer -= dt;
    if (this.relicSpawnTimer <= 0) {
      this.spawnRelic();
      this.relicSpawnTimer = ZONE_TUNING.RELIC_SPAWN_CD + (Math.random() * 2 - 1);
    }
    for (let ri = this.relics.length - 1; ri >= 0; ri--) {
      const rel = this.relics[ri];
      rel.lifetime -= dt;
      rel.scale = Math.min(1.0, rel.scale + dt * 4);
      if (rel.lifetime <= 0) {
        this.fx.emit('dust', { x: rel.x, y: rel.y, color: ZONE_RELIC_DEFS[rel.type].color });
        this.relics.splice(ri, 1);
      }
    }

    if (this.roundTimer <= 0 || roundTimedOut(this.roundTimer, ZONE_TUNING.ROUND_TIME)) {
      this.roundTimer = 0;
      // Beraberlikte son capture'ı yapan alır (tieBreak bayrağı banner'a yansır)
      let best = null;
      let bestPct = -1;
      const tied = [];
      for (const p of this.players) {
        if (!p.isJoined) continue;
        if (this.pct[p.index] > bestPct) {
          bestPct = this.pct[p.index];
          best = p;
          tied.length = 0;
          tied.push(p);
        } else if (this.pct[p.index] === bestPct) {
          tied.push(p);
        }
      }
      if (tied.length > 1) {
        if (this.lastCaptureBy >= 0 && tied.some((p) => p.index === this.lastCaptureBy)) {
          best = this.players[this.lastCaptureBy];
          this.tieBreak = true;
        } else {
          best = null;
          this.tieBreak = false;
        }
      }
      this.finishRound(best);
      return;
    }

    const baseSpeed = this.cell * ZONE_TUNING.SPEED;
    this.moveSpeed = baseSpeed;

    for (const p of this.players) {
      if (!p.isJoined) continue;
      // Underdog comeback (Son 20sn geride olanın depar cooldown'ı %25 hızlı erir)
      const isUnderdog = this.roundTimer <= 20 && this.leaderIndex >= 0 && this.leaderIndex !== p.index && (this.pct[p.index] + 8 <= this.pct[this.leaderIndex]);
      const cdRate = isUnderdog ? dt * 1.3 : dt;

      // Depar sayaçları stun'dan bağımsız işler (donarken süre erir)
      if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - cdRate);
      if (p.dashTimer > 0) {
        p.dashTimer -= dt;
        if (p.dashTimer <= 0) p.isDashing = false;
      }
      if (p.stunTimer > 0) {
        p.stunTimer = Math.max(0, p.stunTimer - dt);
        p.blinkTimer += dt;
        // Donarken hücre kaydını taze tut: yoksa stun bitince üstünde durduğu
        // düşman izi "aynı hücre" sayılıp kesme ıskalanırdı.
        p.lastCell = this.posToCell(p.x, p.y);
        p.px = p.x; p.py = p.y;
        continue;
      }

      // Girdi: joystick / klavye / bot
      let ix = 0; let iy = 0; let force = 0;
      if (p.slotType === 'human') {
        const joy = this.joysticks[p.index];
        if (joy.active && joy.force > 0.05) {
          ix = Math.cos(joy.angle); iy = Math.sin(joy.angle); force = Math.min(1, joy.force);
        } else {
          const kv = this.keyboardVector(p.index);
          const len = Math.hypot(kv.x, kv.y);
          if (len > 0.01) {
            ix = kv.x / len; iy = kv.y / len; force = 1;
          }
        }
      } else {
        updateZoneBotAI(this, p, dt);
        const len = Math.hypot(p.aiMoveX, p.aiMoveY);
        if (len > 0.01) {
          ix = p.aiMoveX / len; iy = p.aiMoveY / len; force = Math.min(1, p.aiForce || 1);
        }
      }

      const currentCell = this.posToCell(p.x, p.y);
      const onHomeTurf = currentCell >= 0 && this.grid[currentCell] === (p.index + 1);
      p.onHomeTurf = onHomeTurf;

      const dashing = p.dashTimer > 0;
      if (force > 0.05) {
        const target = Math.atan2(iy, ix);
        // Depar anında dönüş yarıya iner (hız kararlılığı)
        p.heading = this.turnToward(p.heading, target, ZONE_TUNING.TURN * dt * (dashing ? 0.5 : 1));
      }

      let speed = baseSpeed * (0.35 + 0.65 * Math.max(force, force > 0.05 ? 0.6 : 0));
      // Kendi toprağında %15 hız avantajı (Home Turf Advantage)
      if (onHomeTurf) speed *= ZONE_TUNING.TURF_SPEED_MULT;
      if (dashing) speed *= ZONE_TUNING.DASH_MULT;

      // Home Turf hafif rüzgar/kıvılcım efekti (`dust` olayı)
      if (onHomeTurf && Math.random() < 0.18) {
        this.fx.emit('dust', {
          x: p.x + (Math.random() - 0.5) * p.radius,
          y: p.y + (Math.random() - 0.5) * p.radius,
          color: p.color,
        });
      }

      p.px = p.x; p.py = p.y;
      const stepX = Math.cos(p.heading) * speed * dt;
      const stepY = Math.sin(p.heading) * speed * dt;
      const wr = p.radius + 1;

      // Duvar kayması: eksenler bağımsız clamp'lenir, sonra kalan yön
      // HIZINI KORUR. Düz per-axis clamp'te çapraz duvar sürtünmesi hızı
      // ikiye böler (45°'de yarıya iner) — oyuncu köşeye yaslanınca
      // "yavaşladı" diye durur. Burada bloklanan eksen atılır, kalan
      // yön istenen tam hıza geri ölçeklenir. Duvar teması cezasızdır:
      // iz silinmez, donma yok, ses yok.
      const minX = this.field.x + wr;
      const maxX = this.field.x + this.field.s - wr;
      const minY = this.field.y + wr;
      const maxY = this.field.y + this.field.s - wr;
      const clampX = (v) => Math.min(Math.max(v, minX), maxX);
      const clampY = (v) => Math.min(Math.max(v, minY), maxY);
      const blockedX = clampX(p.x + stepX) !== p.x + stepX;
      const blockedY = clampY(p.y + stepY) !== p.y + stepY;
      if (blockedX || blockedY) {
        const want = Math.hypot(stepX, stepY);
        const ax = clampX(p.x + stepX) - p.x;
        const ay = clampY(p.y + stepY) - p.y;
        const got = Math.hypot(ax, ay);
        if (got > 1e-6) {
          const k = want / got;
          p.x = clampX(p.x + ax * k);
          p.y = clampY(p.y + ay * k);
        } else {
          p.x = clampX(p.x + stepX);
          p.y = clampY(p.y + stepY);
        }
      } else {
        p.x += stepX;
        p.y += stepY;
      }

      // Relic Toplama Kontrolü
      for (let ri = this.relics.length - 1; ri >= 0; ri--) {
        const rel = this.relics[ri];
        const dist = Math.hypot(p.x - rel.x, p.y - rel.y);
        if (dist < p.radius + this.cell * 0.9) {
          this.collectRelic(p.index, ri);
          break;
        }
      }

      // Güvenlik: konum/başlık bozulursa (NaN) tabana dön —
      // yoksa oyuncu görünmez/donmuş kalır.
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.heading)) {
        const br = this.baseRect(p.index);
        p.x = this.field.x + ((br.x0 + br.x1 + 1) / 2) * this.cell;
        p.y = this.field.y + ((br.y0 + br.y1 + 1) / 2) * this.cell;
        p.px = p.x; p.py = p.y;
        p.heading = Math.atan2(this.arena.cy - p.y, this.arena.cx - p.x);
        this.wipeTrail(p.index);
        p.lastCell = this.posToCell(p.x, p.y);
        continue;
      }

      if (this.checkTrailCrossing(p, p.px, p.py, p.x, p.y)) continue;

      // İz hücreleri: kare içinde geçilen HER hücre yazılır (ara hücreler
      // dâhil). Depar hâlinde iki kare arasında 1+ hücre atlanabiliyordu;
      // atlanan hücre sahiplik dışı kalır, çizgi köşeyi keser ve o hücreden
      // geçmek cezasız olurdu.
      for (const cellIdx of this.cellsCrossed(p.px, p.py, p.x, p.y)) {
        if (cellIdx === p.lastCell) continue;
        p.lastCell = cellIdx;

        if (this.grid[cellIdx] === p.index + 1) {
          if (p.trail.length > 0) this.closeTrail(p.index);
          break;
        }

        const trailOwnerId = this.trailOwner[cellIdx];
        if (trailOwnerId >= 0 && trailOwnerId !== p.index) {
          // Düşman izine bastın: iz sahibi base boyuna döner + donar.
          // Spawn koruması varken kesme işlemez (üstünden geçilir).
          if (this.spawnProtect <= 0) this.shatterPlayer(trailOwnerId, p.index);
        } else if (trailOwnerId === p.index) {
          // Kendi izine bastın: sadece önceki eski ize basılırsa öl (son 3 hücre hemen arkandadır, dönüş yaparken intihar olmasın)
          const recentIndex = p.trail.lastIndexOf(cellIdx);
          const isImmediateTail = recentIndex >= 0 && (p.trail.length - 1 - recentIndex) <= 3;
          if (!isImmediateTail) {
            this.shatterPlayer(p.index, null);
            break;
          }
        }
        if (p.trail.length >= ZONE_TUNING.TRAIL_CAP) {
          this.wipeTrail(p.index);
          this.stunPlayer(p.index, true);
          break;
        }
        if (p.trail.length === 0) {
          // İz burada başlıyor: anchor = bir kare önceki konum (base çıkış
          // noktası). Render çizgiyi buradan başlatır, kopukluk görünmez.
          p.trailStartX = p.px;
          p.trailStartY = p.py;
        }
        if (p.trail[p.trail.length - 1] !== cellIdx) {
          // Yüksek risk uyarısı (16 hücreye ulaştığında bir kez uyar)
          if (p.trail.length === ZONE_TUNING.TRAIL_RISK_WARN) {
            this.addFloatingText(p.x, p.y - 20, t('zone.risk'), '#D84727');
          }
          p.trail.push(cellIdx);
          this.trailOwner[cellIdx] = p.index;
        }
      }
    }

    // Kafa kafaya çarpışma: iki oyuncu da %50 toprak kaybıyla base'e döner + stun
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (!a.isJoined || a.stunTimer > 0) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j];
        if (!b.isJoined || b.stunTimer > 0) continue;
        const rr = (a.radius + b.radius) * 0.8;
        if (Math.hypot(a.x - b.x, a.y - b.y) < rr) {
          this.handleHeadOnCollision(i, j);
        }
      }
    }

    this.updateFx(dt);
  }

  updateFx(dt) {
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y -= dt * 25;
      ft.life -= dt;
      if (ft.life <= 0) this.floatingTexts.splice(i, 1);
    }
    // Partikül/halka/pop yaşam döngüsü fxRuntime'ın (`draw*FxLayer` de oradan).
    this.fx.update(dt);
    for (let i = this.captureWaves.length - 1; i >= 0; i--) {
      const cw = this.captureWaves[i];
      cw.radius += cw.speed * dt;
      cw.alpha = Math.max(0, 1.0 - cw.radius / cw.maxRadius);
      if (cw.radius >= cw.maxRadius || cw.alpha <= 0) {
        this.captureWaves.splice(i, 1);
      }
    }
  }

  // --- territory offscreen katmanı (sadece kirlenince yeniden çizilir) ---
  repaintTerritory() {
    const G = ZONE_TUNING.GRID;
    const tctx = this.territoryLayer.getContext('2d');
    tctx.clearRect(0, 0, G, G);
    for (let i = 0; i < this.grid.length; i++) {
      const o = this.grid[i];
      if (o === 0) continue;
      const playerColor = this.players?.[o - 1]?.color || ZONE_COLORS[o - 1] || '#888888';
      tctx.fillStyle = playerColor;
      tctx.fillRect(i % G, (i / G) | 0, 1, 1);
    }
    this.territoryDirty = false;
    this.gridVersion = (Number(this.gridVersion) || 0) + 1;
    return this.territoryLayer;
  }

  /** Host sahne çizimi: bölge + relic + izler ortak zoneView draw'larından (client ile aynı kaynak). */
  renderField(ctx) {
    const nowSec = performance.now() / 1000;
    const scenePlayers = this.players.map((p) => ({
      ...p,
      slot: p.index,
      angle: p.heading,
      trailStart: [p.trailStartX ?? p.x ?? 0, p.trailStartY ?? p.y ?? 0],
      dashProg: p.dashCooldown > 0
        ? 1 - Math.max(0, Math.min(1, p.dashCooldown / ZONE_TUNING.DASH_CD)) : null,
      pct: this.pct[p.index] || 0,
    }));
    const colors = this.players.map((p, i) => p?.color || ZONE_COLORS[i]);
    drawZoneField(
      ctx,
      [this.field.x, this.field.y, this.field.s],
      this.cell,
      this.grid,
      colors,
      scenePlayers,
      this.relics,
      nowSec,
      this.territoryDirty ? this.repaintTerritory() : this.territoryLayer,
      1,
      { roundId: this.roundId, proj: this.proj },
    );
  }

  /** Raunt sayacı — ekran-uzayı HUD (sahne kapandıktan sonra çizilir). */
  renderRoundTimer(ctx) {
    if (this.state !== 'PLAYING') return;
    const remain = Math.max(0, this.roundTimer);
    const leader = this.leaderIndex >= 0 ? this.players[this.leaderIndex] : null;
    const isUrgent = remain <= 10.0 || (leader && this.pct[leader.index] >= 35);
    renderArenaWatermarkTimer(ctx, {
      arena: this.arena,
      text: `${Math.ceil(remain)}s`,
      subText: '',
      urgent: isUrgent,
      color: isUrgent ? '#D84727' : (leader ? leader.color : null),
      alpha: isUrgent ? 0.70 : 0.46,
      ringProgress: Math.max(0, remain / 90),
      // Sayaç oyun alanının ÜSTÜNDEDİR. Ölçülen kusur: merkez konumunda
      // devasa sayı bir oyuncunun üstüne biniyordu (BOMB ekran görüntüsünde
      // '10.5s' doğrudan P1'in üstündeydi) — merkez, oyunun olduğu yerdir.
      placement: 'top',
    });
  }

  render() {
    const { ctx } = this;
    ctx.save();
    // 2.5D sahne zarfı: masa zemini `drawField25d` içinde boyanır (paintBackdrop
    // çizilmez); kuyruk `scene.close` ile boşalır.
    this.scene.open(ctx, {
      viewport: this.viewport,
      arena: this.arena,
      theme: ZONE_THEME_25D,
    });
    this.applyScreenShake(ctx, 14);

    this.renderField(ctx);
    this.renderZoneScene(ctx);
    this.scene.close(ctx);

    // Ekran-uzayı HUD (sahne kapandıktan sonra) — sahne kuyruğu üstünü örtmesin.
    this.renderRoundTimer(ctx);
    this.renderControls(ctx);

    this.renderHUD(ctx, {
      guideTitle: t('guide.zone'),
      guideEntries: [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ],
      colors: this.players.map((p, i) => p?.color || ZONE_COLORS[i]),
      accent: '#2F6A4F',
      roundBannerTitle: this.roundWinner ? t('zone.took', this.roundWinner.name) : t('game.draw'),
      roundBannerColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A',
      roundBannerSub: this.roundWinner
        ? t('zone.roundSub', this.pct[this.roundWinner.index], this.kills[this.roundWinner.index], this.tieBreak ? t('zone.lastMove') : '')
        : '',
      matchOverHeadline: t('zone.champ'),
      matchOverRows: this.players
        .filter((p) => p.isJoined)
        .map((p) => ({ color: p.color, name: p.name, value: `${this.scores[p.index] || 0}★ • %${this.pct[p.index]} • ${this.kills[p.index]}✂`, score: this.scores[p.index] || 0 })),
      onSeatChange: (i) => this.syncLobbySeat(i),
      onRestart: () => this.startNewMatch(),
    });

    ctx.restore();

    // Kesilme flaşı sahne transformunun DIŞINDA: tam ekranı kaplar.
    const flashAlpha = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    if (flashAlpha > 0) drawFxFlash(ctx, this.viewport.width, this.viewport.height, flashAlpha);
  }

  /** Host sahne çizimi: dalga/oyuncu/partikül/metin katmanları ortak zoneView/worldCore draw'larından. */
  renderZoneScene(ctx) {
    const withFx = this.state === 'PLAYING';
    const scenePlayers = this.players.map((p) => ({
      ...p,
      slot: p.index,
      angle: p.heading,
      dashProg: p.dashCooldown > 0
        ? 1 - Math.max(0, Math.min(1, p.dashCooldown / ZONE_TUNING.DASH_CD)) : null,
      pct: this.pct[p.index] || 0,
    }));
    drawZoneWaves(ctx, this.captureWaves, this.cell, this.proj);
    if (this.state !== 'LOBBY') {
      drawZonePlayers(ctx, scenePlayers, { cell: this.cell, leaderIndex: this.leaderIndex, withFx, selfSlot: this.localControlSlot ?? -1, proj: this.proj });
    }
    // FX katmanı ortak zoneView draw'ından gelir (host↔client aynı).
    drawZoneFxLayer(ctx, { pops: this.fx.pops, rings: this.fx.rings, particles: this.particles }, this.proj);
    drawAlphaTexts(ctx, this.floatingTexts, { size: 13, outline: true });
  }
}
