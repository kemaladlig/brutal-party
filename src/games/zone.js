// BRUTAL ZONE (Game 08): 2-4 Player Territory Capture Party Game (paper.io style)
// Grid-based land grabbing: leave your base to draw a trail, close the loop to
// capture. Enemy steps on your trail -> you shatter back to base size + 2s stun
// (no elimination, party flow preserved). 90s rounds, first to 40% takes the
// round early, first to 2 rounds is the champion.
import { getSlotCustomization, ensureLocalSeatColor, getLocalSeatColors } from '../core/customizationManager.js';
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
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton, getSeatColorDotRect } from '../controlGuide.js';
import { t } from '../i18n.js';
import {
  renderTopPill,
  renderCornerScores,
  renderSpatialBadge,
  renderRoundBanner,
  renderMatchOver,
  renderArenaWatermarkTimer,
} from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateZoneBotAI } from '../ai/zoneAI.js';
import { drawBrutalAvatar } from '../ui/characterRenderer.js';

export const ZONE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const ZONE_NAMES = ['P1', 'P2', 'P3', 'P4'];

// Relic tipleri: Arena içinde nötr/orta alanda beliren taktiksel güç kristalleri
export const ZONE_RELIC_DEFS = {
  FLASH: {
    id: 'FLASH',
    name: 'FLASH CORE',
    badge: 'HIZ',
    icon: 'HIZ',
    title: 'HIZ KORU',
    color: '#FFD122',
    glowColor: 'rgba(255, 209, 34, 0.45)',
    desc: 'DEPAR SIFIRLANDI + EKSTRA HIZ',
  },
  SEISMIC: {
    id: 'SEISMIC',
    name: 'SEISMIC PULSE',
    badge: 'DARBE',
    icon: 'DARBE',
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
  SPEED: 10.5,       // hücre/sn
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
  AVATAR_R_MIN: 8,     // küçük ekranda taban yarıçap (px)
  TRAIL_W_MULT: 0.95,  // açık iz çizgi kalınlığı = hücre * bu
  TRAIL_GLOW_MULT: 1.05, // risk uyarısı dış parlama = hücre * bu (hazard'da +0.2)
  RELIC_SPAWN_INIT: 4.5, // İlk relic çıkış süresi (sn)
  RELIC_SPAWN_CD: 8.5,   // Relic çıkış periyodu (sn)
  MAX_RELICS: 2,         // Sahada aynı anda en fazla relic sayısı
};

export class ZoneGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    this.arena = { cx: 0, cy: 0, width: 0, height: 0, size: 0, left: 0, right: 0, top: 0, bottom: 0 };
    // Kare capture alanı (arena içinde ortalı): { x, y, s } + hücre px boyu
    this.field = { x: 0, y: 0, s: 0 };
    this.cell = 0;

    this.slotTypes = ['human', 'bot_normal', 'empty', 'empty'];

    this.targetScore = ZONE_TUNING.TARGET_SCORE;
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
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
    this.particles = [];
    this.floatingTexts = [];
    this.territoryDirty = true;
    this.territoryLayer = document.createElement('canvas');
    this.territoryLayer.width = ZONE_TUNING.GRID;
    this.territoryLayer.height = ZONE_TUNING.GRID;

    this.uiButtons = [];

    // 4 köşe yüzen sanal joystick (HEIST/CROWN deseni)
    this.joysticks = [
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
      { id: -1, originX: 0, originY: 0, currX: 0, currY: 0, active: false, angle: 0, force: 0 },
    ];

    this.keys = {};
    this.initKeyboard();
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
      if (e.key) this.keys[e.key.toLowerCase()] = true;
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
      if (e.key) this.keys[e.key.toLowerCase()] = false;
      this.keys[e.code] = false;
    });
    // Depar kısayolları (BOMB eşlemesi): P1 Space, P2 Enter, P3 O, P4 B
    window.addEventListener('keydown', (e) => {
      if (e.repeat || !this.isLocalInputActive) return;
      if (this.state !== 'PLAYING') return;
      if (e.code === 'Space') this.triggerDash(0);
      else if (e.code === 'Enter') this.triggerDash(1);
      else if (e.code === 'KeyO') this.triggerDash(2);
      else if (e.code === 'KeyB') this.triggerDash(3);
    });
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
    playJoin();
  }

  isSlotJoined(index) {
    return this.slotTypes[index] !== 'empty';
  }

  // --- Grid yardımcıları (bot AI da kullanır) ---

  gridSize() {
    return ZONE_TUNING.GRID;
  }

  posToCell(x, y) {
    const G = ZONE_TUNING.GRID;
    const cx = Math.floor((x - this.field.x) / this.cell);
    const cy = Math.floor((y - this.field.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= G || cy >= G) return -1;
    return cy * G + cx;
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
    if (c === 0) return { x0: 1, y0: G - B - 1, x1: B, y1: G - 2 };
    if (c === 1) return { x0: 1, y0: 1, x1: B, y1: B };
    if (c === 2) return { x0: G - B - 1, y0: 1, x1: G - 2, y1: B };
    return { x0: G - B - 1, y0: G - B - 1, x1: G - 2, y1: G - 2 };
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
    const marginX = Math.max(8, Math.floor(width * 0.025));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(24, Math.floor(height * 0.045));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;
    this.arena = {
      cx: width / 2, cy: height / 2, width: arenaW, height: arenaH,
      size: Math.min(arenaW, arenaH),
      left: marginX, right: width - marginX, top: marginY, bottom: height - marginY,
    };

    // Kare capture alanı arena ortasında
    const s = Math.max(64, Math.min(arenaW, arenaH) - 4);
    this.field = { x: this.arena.cx - s / 2, y: this.arena.cy - s / 2, s };
    this.cell = s / ZONE_TUNING.GRID;

    // Mevcut maç varsa konumu yeni alana taşı (bölge sahipliği korunur)
    for (const p of this.players) {
      if (!p) continue;
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
      const existing = this.players?.[i];
      return {
        index: i, name: existing?.name || `P${i + 1}`, color: isBot ? '#8E8E93' : (custom.color || ZONE_COLORS[i]),
        x: bcx, y: bcy, heading: outward,
        radius: Math.max(ZONE_TUNING.AVATAR_R_MIN, this.cell * ZONE_TUNING.AVATAR_R_MULT),
        isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
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
    this.roundTimer = ZONE_TUNING.ROUND_TIME;
    this.leaderIndex = -1;
    this.lastCaptureBy = -1;
    this.lastCaptureAt = 0;
    this.tieBreak = false;
    this.spawnProtect = 0;
    this.relics = [];
    this.relicSpawnTimer = ZONE_TUNING.RELIC_SPAWN_INIT;
    this.captureWaves = [];
    this.particles = [];
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
    this.particles = [];
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
    this.burst(center.x, center.y, ZONE_RELIC_DEFS[type].color, 12);
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
      this.addFloatingText(p.x, p.y - 34, '⚡ FLASH DEPAR!', '#FFD122');
      this.burst(r.x, r.y, '#FFD122', 26);
      this.addTrauma(0.2);
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
      this.burst(r.x, r.y, '#FF473A', 36);
      this.captureWaves.push({
        x: r.x,
        y: r.y,
        radius: this.cell * 2,
        maxRadius: this.cell * 8,
        color: '#FF473A',
        alpha: 1.0,
        speed: this.cell * 24,
      });
      this.addTrauma(0.45);
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
      this.addFloatingText(p.x, p.y - 24, '❄ DONDU!', '#FFFFFF');
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
    this.addTrauma(0.15);
    playDashWhoosh();
    // Depar toz bulutu (arka taraf)
    for (let i = 0; i < 9; i++) {
      const a = p.heading + Math.PI + (Math.random() - 0.5) * 0.9;
      const spd = 40 + Math.random() * 90;
      this.particles.push({
        x: p.x - Math.cos(p.heading) * p.radius,
        y: p.y - Math.sin(p.heading) * p.radius,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        life: 0.3 + Math.random() * 0.2, maxLife: 0.5,
        color: '#D5D0C7', size: 4 + Math.random() * 4,
      });
    }
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
      if (cy < G - 1 && dist[cur + 1] === -1) { dist[cur + G] = nd; queue.push(cur + G); }
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

    // Shatter Fragment Recall: İz parçacıkları üsse geri uçar
    if (oldTrail.length > 0) {
      const step = Math.max(1, Math.floor(oldTrail.length / 10));
      for (let ti = 0; ti < oldTrail.length; ti += step) {
        const tc = this.cellCenter(oldTrail[ti]);
        const dx = bcx - tc.x;
        const dy = bcy - tc.y;
        const dist = Math.hypot(dx, dy) || 1;
        const spd = 120 + Math.random() * 160;
        this.particles.push({
          x: tc.x,
          y: tc.y,
          vx: (dx / dist) * spd,
          vy: (dy / dist) * spd,
          life: 0.55,
          maxLife: 0.55,
          color: v.color,
          size: 4 + Math.random() * 3,
        });
      }
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
      if (kb) this.addFloatingText(kb.x, kb.y - 46, '🏹 AVCI BONUSU!', kb.color);
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
    this.burst(v.x, v.y, v.color, 24);
    this.addTrauma(0.55);
    playExplosion();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 50, 70]);
  }

  // Kafa kafaya çarpışma: Her iki oyuncu da üsse geri ışınlanır, izleri silinir
  // ve üsse en uzak %50 toprakları nötr bölgeye geri döner (orta yol cezası).
  handleHeadOnCollision(i, j) {
    const a = this.players[i];
    const b = this.players[j];
    if (!a || !b) return;

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    this.addFloatingText(midX, midY - 20, '💥 KAFA KAFAYA!', '#FFFFFF');
    this.burst(midX, midY, '#FFFFFF', 28);
    this.addTrauma(0.45);
    playExplosion();

    const penalizeAndReset = (idx) => {
      const p = this.players[idx];
      if (!p || !p.isJoined) return;

      const oldTrail = [...p.trail];
      this.wipeTrail(idx);

      const r = this.baseRect(idx);
      const bcx = this.field.x + ((r.x0 + r.x1 + 1) / 2) * this.cell;
      const bcy = this.field.y + ((r.y0 + r.y1 + 1) / 2) * this.cell;

      // İz parçacıkları üsse geri uçar
      if (oldTrail.length > 0) {
        const step = Math.max(1, Math.floor(oldTrail.length / 8));
        for (let ti = 0; ti < oldTrail.length; ti += step) {
          const tc = this.cellCenter(oldTrail[ti]);
          const dx = bcx - tc.x, dy = bcy - tc.y;
          const dist = Math.hypot(dx, dy) || 1;
          this.particles.push({
            x: tc.x, y: tc.y,
            vx: (dx / dist) * 160, vy: (dy / dist) * 160,
            life: 0.5, maxLife: 0.5,
            color: p.color, size: 4,
          });
        }
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
      this.burst(bcx, bcy, p.color, 16);
    };

    penalizeAndReset(i);
    penalizeAndReset(j);
    this.recomputePct();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([40, 50, 70]);
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
      this.burst(p.x, p.y, '#FFDE59', 30);
      this.addTrauma(0.45);
      playCoinPickup();
      playCashRegister();
    } else if (gained >= 20) {
      this.addFloatingText(p.x, p.y - 22, t('zone.area', this.pct[index]), p.color);
      this.burst(p.x, p.y, '#FFDE59', 16);
      this.addTrauma(0.25);
      playCoinPickup();
    } else if (gained > 0) {
      this.addFloatingText(p.x, p.y - 22, `+%${this.pct[index]}`, p.color);
      this.burst(p.x, p.y, '#FFDE59', 8);
      this.addTrauma(0.1);
      playCoinPickup();
    }
    if (this.pct[index] >= ZONE_TUNING.WIN_PCT && this.state === 'PLAYING') {
      this.finishRound(p);
    }
  }

  finishRound(winner) {
    if (this.state !== 'PLAYING') return;
    this.roundWinner = winner;
    if (winner) {
      this.scores[winner.index]++;
      playCashRegister();
      if (this.scores[winner.index] >= this.targetScore) {
        this.state = 'MATCH_OVER';
        this.matchWinner = winner;
        return;
      }
    }
    this.state = 'ROUND_OVER';
    this.roundTransitionTimer = 2.8;
  }

  addFloatingText(x, y, text, color = '#FFDE59') {
    this.floatingTexts.push({ x, y, text, color, life: 1.1, maxLife: 1.1 });
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 160;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.45, maxLife: 0.45,
        color: Math.random() > 0.35 ? color : '#1A1A1A',
        size: 3 + Math.random() * 4,
      });
    }
  }

  addTrauma(amount) {
    this.trauma = Math.min(1.0, this.trauma + amount);
  }

  turnToward(current, target, maxStep) {
    let d = target - current;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) <= maxStep) return target;
    return current + Math.sign(d) * maxStep;
  }

  getCornerQuadrant(point) {
    const { cx, cy } = this.arena;
    if (point.x < cx && point.y >= cy) return 0;
    if (point.x < cx && point.y < cy) return 1;
    if (point.x >= cx && point.y < cy) return 2;
    return 3;
  }

  onTouchStart(touch) {
    if (this.handleUiTap(touch)) return;

    // Round Over Skip Tap
    if (this.state === 'ROUND_OVER' && this.roundTransitionTimer > 0) {
      this.roundTransitionTimer = 0;
      return;
    }

    if (this.state === 'LOBBY') {
      const q = this.getCornerQuadrant(touch);
      this.cycleSlotType(q);
      this.syncLobbySeat(q);
      return;
    }
    if (this.state === 'MATCH_OVER') {
      this.resetMatch();
      playJoin();
      return;
    }
    if (this.state === 'PLAYING') {
      const q = this.getCornerQuadrant(touch);
      const joy = this.joysticks[q];
      const p = this.players[q];
      if (p && p.isJoined && p.slotType === 'human' && !joy.active) {
        joy.id = touch.id;
        joy.originX = touch.x; joy.originY = touch.y;
        joy.currX = touch.x; joy.currY = touch.y;
        joy.active = true; joy.angle = 0; joy.force = 0;
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
        if (dist > maxRadius) {
          joy.currX = joy.originX + Math.cos(joy.angle) * maxRadius;
          joy.currY = joy.originY + Math.sin(joy.angle) * maxRadius;
        } else {
          joy.currX = touch.x; joy.currY = touch.y;
        }
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let q = 0; q < 4; q++) {
      const joy = this.joysticks[q];
      if (joy.active && joy.id === touch.id) {
        joy.active = false; joy.id = -1; joy.force = 0;
      }
    }
  }

  onTouchesReset() {
    for (const joy of this.joysticks) {
      joy.active = false; joy.id = -1; joy.force = 0;
    }
  }

  handleRemoteInput(slotIndex, data) {
    const joy = this.joysticks[slotIndex];
    if (!joy) return;
    const player = this.players?.[slotIndex];
    if (data.action === 'JOYSTICK_MOVE') {
      if (player && (!player.isJoined || player.slotType !== 'human')) return;
      joy.active = data.force > 0.05;
      joy.angle = data.angle || 0;
      joy.force = data.force || 0;
    } else if (data.action === 'DASH') {
      if (player && (!player.isJoined || player.slotType !== 'human')) return;
      this.triggerDash(slotIndex);
    }
  }

  keyboardVector(index) {
    const k = this.keys;
    let x = 0; let y = 0;
    if (index === 0) {
      if (k['KeyA'] || k['a']) x -= 1;
      if (k['KeyD'] || k['d']) x += 1;
      if (k['KeyW'] || k['w']) y -= 1;
      if (k['KeyS'] || k['s']) y += 1;
    } else if (index === 1) {
      if (k['ArrowLeft']) x -= 1;
      if (k['ArrowRight']) x += 1;
      if (k['ArrowUp']) y -= 1;
      if (k['ArrowDown']) y += 1;
    } else if (index === 2) {
      if (k['KeyJ'] || k['j']) x -= 1;
      if (k['KeyL'] || k['l']) x += 1;
      if (k['KeyI'] || k['i']) y -= 1;
      if (k['KeyK'] || k['k']) y += 1;
    } else if (index === 3) {
      if (k['KeyF'] || k['f']) x -= 1;
      if (k['KeyH'] || k['h']) x += 1;
      if (k['KeyT'] || k['t']) y -= 1;
      if (k['KeyG'] || k['g']) y += 1;
    }
    return { x, y };
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.updateTrauma(dt);

    if (this.state === 'ROUND_OVER') {
      this.roundTransitionTimer -= dt;
      if (this.roundTransitionTimer <= 0) this.startNewRound();
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
        this.burst(rel.x, rel.y, ZONE_RELIC_DEFS[rel.type].color, 8);
        this.relics.splice(ri, 1);
      }
    }

    if (this.roundTimer <= 0) {
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
      if (tied.length > 1 && this.lastCaptureBy >= 0
          && tied.some((p) => p.index === this.lastCaptureBy)) {
        best = this.players[this.lastCaptureBy];
        this.tieBreak = true;
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

      // Home Turf hafif rüzgar/kıvılcım efekti
      if (onHomeTurf && Math.random() < 0.18) {
        this.particles.push({
          x: p.x + (Math.random() - 0.5) * p.radius,
          y: p.y + (Math.random() - 0.5) * p.radius,
          vx: -Math.cos(p.heading) * 20,
          vy: -Math.sin(p.heading) * 20,
          life: 0.22,
          maxLife: 0.22,
          color: p.color,
          size: 2.5,
        });
      }

      p.px = p.x; p.py = p.y;
      const mx = Math.cos(p.heading) * speed * dt;
      const my = Math.sin(p.heading) * speed * dt;

      // Duvar kayması: yarıçap payıyla clamp'le, eksenler bağımsız kayar.
      // Duvar teması cezasızdır — iz silinmez, donma yok, ses yok.
      const wr = p.radius + 1;
      p.x = Math.min(Math.max(p.x + mx, this.field.x + wr), this.field.x + this.field.s - wr);
      p.y = Math.min(Math.max(p.y + my, this.field.y + wr), this.field.y + this.field.s - wr);

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

      const cellIdx = this.posToCell(p.x, p.y);
      if (cellIdx < 0) continue;
      if (cellIdx === p.lastCell) continue;
      p.lastCell = cellIdx;

      const owner = this.grid[cellIdx];
      if (owner === p.index + 1) {
        if (p.trail.length > 0) this.closeTrail(p.index);
      } else {
        const t = this.trailOwner[cellIdx];
        if (t >= 0 && t !== p.index) {
          // Düşman izine bastın: iz sahibi base boyuna döner + donar.
          // Spawn koruması varken kesme işlemez (üstünden geçilir).
          if (this.spawnProtect <= 0) this.shatterPlayer(t, p.index);
        } else if (t === p.index) {
          // Kendi izine bastın: öldün — base boyuna dön + don
          // (shatterPlayer katilsiz çağrısı 'KENDİNİ KESTİN!' akışını çalıştırır)
          this.shatterPlayer(p.index, null);
          continue;
        }
        if (p.trail.length >= ZONE_TUNING.TRAIL_CAP) {
          this.wipeTrail(p.index);
          this.stunPlayer(p.index, true);
          continue;
        }
        if (p.trail.length === 0) {
          // İz burada başlıyor: anchor = bir kare önceki konum (base çıkış
          // noktası). Render çizgiyi buradan başlatır, kopukluk görünmez.
          p.trailStartX = p.px;
          p.trailStartY = p.py;
        }
        // Yüksek risk uyarısı (16 hücreye ulaştığında bir kez uyar)
        if (p.trail.length === ZONE_TUNING.TRAIL_RISK_WARN) {
          this.addFloatingText(p.x, p.y - 20, t('zone.risk'), '#D84727');
        }
        p.trail.push(cellIdx);
        this.trailOwner[cellIdx] = p.index;
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
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.life -= dt;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }
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
      tctx.fillStyle = ZONE_COLORS[o - 1];
      tctx.fillRect(i % G, (i / G) | 0, 1, 1);
    }
    this.territoryDirty = false;
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.applyScreenShake(ctx, 14);

    const { left, top, width, height } = this.arena;
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, width, height);

    this.renderField(ctx);

    if (this.state === 'PLAYING') this.renderTopHUD(ctx);

    this.renderPlayers(ctx);
    this.renderFx(ctx);
    this.renderJoystickHints(ctx);

    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, t('guide.zone'), [
        'P1 [WASD/SPACE]',
        'P2 [OKLAR/ENTER]',
        'P3 [IJKL/O]',
        'P4 [TFGH/B]',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, {
        arena: this.arena,
        title: this.roundWinner ? t('zone.took', this.roundWinner.name) : t('game.draw'),
        titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A',
        sub: this.roundWinner
          ? t('zone.roundSub', this.pct[this.roundWinner.index], this.kills[this.roundWinner.index], this.tieBreak ? t('zone.lastMove') : '')
          : '',
      });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, {
        arena: this.arena,
        uiButtons: this.uiButtons,
        headline: t('zone.champ'),
        winnerName: this.matchWinner ? this.matchWinner.name : '',
        winnerColor: this.matchWinner ? this.matchWinner.color : '#1A1A1A',
        rows: this.players
          .filter((p) => p.isJoined)
          .map((p) => ({ color: p.color, text: `${p.name}: ${this.scores[p.index] || 0}★ • %${this.pct[p.index]} • ${this.kills[p.index]}✂` })),
        onRestart: () => this.startNewMatch(),
      });
    }

    ctx.restore();
  }

  renderField(ctx) {
    const { x, y, s } = this.field;
    if (this.territoryDirty) this.repaintTerritory();

    // Zemin + bölge katmanı
    ctx.fillStyle = '#EFEAE0';
    ctx.fillRect(x, y, s, s);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.territoryLayer, x, y, s, s);
    ctx.imageSmoothingEnabled = true;

    // Hücre ızgarası (8'de bir, silik)
    ctx.strokeStyle = 'rgba(26,26,26,0.08)';
    ctx.lineWidth = 1;
    const step = s / 8;
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      ctx.moveTo(x + i * step, y);
      ctx.lineTo(x + i * step, y + s);
      ctx.moveTo(x, y + i * step);
      ctx.lineTo(x + s, y + i * step);
    }
    ctx.stroke();

    // 4 Köşe Takviye Braketleri (L-plates) ve İç Sınır Çizgisi
    const bLen = Math.max(16, Math.round(s * 0.05));
    ctx.strokeStyle = '#2B2B28';
    ctx.lineWidth = 3;
    const cornerPlates = [
      [[x, y + bLen], [x, y], [x + bLen, y]],
      [[x + s - bLen, y], [x + s, y], [x + s, y + bLen]],
      [[x, y + s - bLen], [x, y + s], [x + bLen, y + s]],
      [[x + s - bLen, y + s], [x + s, y + s], [x + s, y + s - bLen]],
    ];
    for (const [[x1, y1], [x2, y2], [x3, y3]] of cornerPlates) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.stroke();
    }

    // Saha ortasında net, yüksek görünürlüklü süre sayacı
    if (this.state === 'PLAYING') {
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
      });
    }

    // Güç Kristalleri (Relics) Çizimi
    const nowSec = performance.now() / 1000;
    for (const rel of this.relics) {
      const def = ZONE_RELIC_DEFS[rel.type];
      const bob = Math.sin(nowSec * 4 + rel.bobPhase) * 4;
      const rx = rel.x;
      const ry = rel.y + bob;
      const rSize = (this.cell * 1.6) * rel.scale;

      ctx.save();
      ctx.translate(rx, ry);

      // Zemin gölgesi
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, 10 - bob * 0.5, rSize * 0.7, rSize * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nabız Işıltısı / Halo
      const pulse = 0.5 + 0.5 * Math.sin(nowSec * 6 + rel.bobPhase);
      ctx.strokeStyle = def.color;
      ctx.globalAlpha = 0.4 + 0.3 * pulse;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-rSize * 0.65, -rSize * 0.65, rSize * 1.3, rSize * 1.3);

      // Kristal Gövde (Neo-Brutalist 45° elmas)
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = def.color;
      ctx.beginPath();
      ctx.moveTo(0, -rSize);
      ctx.lineTo(rSize, 0);
      ctx.lineTo(0, rSize);
      ctx.lineTo(-rSize, 0);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // İç İkon / Tipografi
      ctx.fillStyle = '#1C1C1A';
      ctx.font = '900 11px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(def?.badge || '★', 0, 1);

      ctx.restore();
    }

    // Açık izler: dinamik risk renklendirmesi ve yüksek tehlike şeritleri
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of this.players) {
      if (!p.isJoined || p.trail.length === 0) continue;
      const trailLen = p.trail.length;
      const isRiskWarn = trailLen >= ZONE_TUNING.TRAIL_RISK_WARN;
      const isHazard = trailLen >= ZONE_TUNING.TRAIL_HAZARD;

      ctx.save();
      // Yüksek risk uyarısında neon kırmızı parlama katmanı
      if (isRiskWarn) {
        ctx.strokeStyle = isHazard ? '#D84727' : p.color;
        ctx.lineWidth = this.cell * (isHazard ? ZONE_TUNING.TRAIL_GLOW_MULT + 0.2 : ZONE_TUNING.TRAIL_GLOW_MULT);
        ctx.globalAlpha = isHazard ? (0.6 + 0.4 * Math.sin(nowSec * 16)) : 0.4;
        ctx.beginPath();
        ctx.moveTo(p.trailStartX, p.trailStartY);
        for (const ci of p.trail) {
          const c = this.cellCenter(ci);
          ctx.lineTo(c.x, c.y);
        }
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      // Ana iz çizgisi
      ctx.globalAlpha = 1.0;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = this.cell * ZONE_TUNING.TRAIL_W_MULT;
      if (isHazard) {
        // Kritik seviyede animasyonlu tehlike şeridi (moving dash pattern)
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -(nowSec * 32) % 14;
      }
      ctx.beginPath();
      ctx.moveTo(p.trailStartX, p.trailStartY);
      for (const ci of p.trail) {
        const c = this.cellCenter(ci);
        ctx.lineTo(c.x, c.y);
      }
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.restore();
    }

    // Dış çerçeve + sert gölge
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(x + s, y + 6, 6, s);
    ctx.fillRect(x + 6, y + s, s, 6);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 5;
    ctx.strokeRect(x, y, s, s);
  }

  renderTopHUD(ctx) {
    const remain = Math.max(0, this.roundTimer);
    const leader = this.leaderIndex >= 0 ? this.players[this.leaderIndex] : null;
    const isUrgent = remain <= 10.0 || (leader && this.pct[leader.index] >= 35);
    const text = leader && leader.isJoined
      ? `⏱ ${Math.ceil(remain)}s • ${leader.name} %${this.pct[leader.index]}`
      : `⏱ ${Math.ceil(remain)}s`;
    renderTopPill(ctx, { arena: this.arena, text, urgent: isUrgent });
    renderCornerScores(ctx, {
      arena: this.arena,
      entries: this.players.map((p) =>
        p.isJoined
          ? { color: p.color, text: `%${this.pct[p.index]}${this.scores[p.index] > 0 ? `★${this.scores[p.index]}` : ''}` }
          : null
      ),
      entities: this.players.filter((p) => p.isJoined),
    });
  }

  renderPlayers(ctx) {
    if (this.state === 'LOBBY') return;
    for (const p of this.players) {
      if (!p.isJoined) continue;
      // Donma yanıltması: 0.15sn aralıklarla yanıp söner
      if (p.stunTimer > 0 && Math.floor(p.blinkTimer / 0.15) % 2 === 0) continue;

      ctx.save();
      ctx.translate(p.x, p.y);

      // Home Turf Aura (Kendi alanında parıldayan halka)
      if (p.onHomeTurf && p.stunTimer <= 0) {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 3.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1.0;
      }

      // Lider tacı
      if (this.state === 'PLAYING' && p.index === this.leaderIndex && this.pct[p.index] > 0) {
        ctx.font = '16px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('👑', 0, -p.radius - 26);
      }

      let currentExp = 'normal';
      if (p.stunTimer > 0) currentExp = 'dizzy';
      else if (p.trail.length >= ZONE_TUNING.TRAIL_HAZARD) currentExp = 'panic';
      else if (p.relicTimer > 0) currentExp = 'excited';

      drawBrutalAvatar(ctx, 0, 0, p.radius, {
        color: p.color,
        slotIndex: p.index,
        facingAngle: p.heading,
        label: `P${p.index + 1}`,
        expression: currentExp,
        showPointer: true,
        borderColor: p.stunTimer > 0 ? '#48CAE4' : '#1C1C1A',
        borderWidth: 3,
      });

      // Depar (Dash) Cooldown Göstergesi (Bölge ve şekillerin üstünde her zaman net görünür)
      if (p.dashCooldown > 0) {
        const cdProg = 1.0 - Math.max(0, Math.min(1, p.dashCooldown / ZONE_TUNING.DASH_CD));
        ctx.save();
        ctx.strokeStyle = 'rgba(26, 26, 26, 0.45)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = '#FFDE59';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, p.radius + 5, -Math.PI / 2, -Math.PI / 2 + cdProg * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // İsim + canlı % plakası
      const label = `P${p.index + 1} • %${this.pct[p.index]}`;
      ctx.font = '900 11px "Space Grotesk", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-tw / 2, p.radius + 6, tw, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, p.radius + 15);

      if (p.stunTimer > 0) {
        renderSpatialBadge(ctx, {
          x: 0,
          y: p.radius + 33,
          text: 'DONDU',
          icon: '❄️',
          color: '#1C1C1A',
          bg: '#48CAE4',
          scale: 0.9,
        });
      } else if (p.trail.length >= ZONE_TUNING.TRAIL_HAZARD) {
        renderSpatialBadge(ctx, {
          x: 0,
          y: p.radius + 33,
          text: t('game.danger'),
          icon: '⚡',
          urgent: true,
          scale: 0.9,
        });
      }

      ctx.restore();
    }
  }

  renderFx(ctx) {
    // Wavefront Capture Şok Dalgaları
    for (const cw of this.captureWaves) {
      ctx.save();
      ctx.strokeStyle = cw.color;
      ctx.globalAlpha = cw.alpha;
      ctx.lineWidth = Math.max(2, this.cell * 0.45 * cw.alpha);
      ctx.beginPath();
      ctx.arc(cw.x, cw.y, cw.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
      ctx.restore();
    }
    for (const ft of this.floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.life / ft.maxLife);
      ctx.fillStyle = ft.color;
      ctx.font = '900 13px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  renderJoystickHints(ctx) {
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
      const p = this.players[q];
      if (!p || !p.isJoined || p.slotType !== 'human') continue;
      if (!joy.active) {
        ctx.save();
        ctx.translate(anchors[q].x, anchors[q].y);
        if (q === 1 || q === 2) ctx.rotate(Math.PI);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.arc(0, 0, 34, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = p.color;
        ctx.font = '800 11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(t('game.drag', p.name.slice(0, 3)), 0, 0);
        ctx.restore();
        continue;
      }
      ctx.save();
      ctx.strokeStyle = 'rgba(28,28,26,0.4)';
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(joy.originX, joy.originY, 48, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(joy.currX, joy.currY, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }
  }

  renderLobbyUI(ctx) {
    const joinedCount = this.slotTypes.filter((s) => s !== 'empty').length;
    const seatRects = getStandardSeatRects(this.arena);
    const localMode = !this.hideLobbyStartButton;
    const localColors = localMode ? getLocalSeatColors() : null;
    for (let i = 0; i < 4; i++) {
      const rect = seatRects[i];
      const isTop = i === 1 || i === 2;
      renderLobbySeatCard(ctx, {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        slotIndex: i, slotType: this.slotTypes[i],
        playerName: this.players[i] ? this.players[i].name : '',
        playerColor: ZONE_COLORS[i],
        rotation: isTop ? Math.PI : 0,
        seatColor: localMode ? (localColors[i] || ZONE_COLORS[i]) : null,
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
          this.syncLobbySeat(i);
        },
      });
    }
    renderLobbyStartButton(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      joinedCount,
      accent: '#2F6A4F',
      onStart: () => this.startNewMatch(),
      hidden: !!this.hideLobbyStartButton,
    });
  }
}
