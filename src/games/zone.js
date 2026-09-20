// BRUTAL ZONE (Game 08): 2-4 Player Territory Capture Party Game (paper.io style)
// Grid-based land grabbing: leave your base to draw a trail, close the loop to
// capture. Enemy steps on your trail -> you shatter back to base size + 2s stun
// (no elimination, party flow preserved). 90s rounds, first to 40% takes the
// round early, first to 2 rounds is the champion.
import {
  playStart,
  playJoin,
  playWallHit,
  playExplosion,
  playCoinPickup,
  playCashRegister,
  playStumble,
} from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton } from '../controlGuide.js';
import { renderTopPill, renderCornerScores, renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';
import { updateZoneBotAI } from '../ai/zoneAI.js';

export const ZONE_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
export const ZONE_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];

// Tek akort noktası: tüm sayısal denge burada.
export const ZONE_TUNING = {
  GRID: 64,          // capture alanı: 64x64 hücre
  BASE: 7,           // başlangıç base kenarı (7x7 hücre)
  SPEED: 7.5,        // hücre/sn
  TURN: 10.0,        // rad/sn yumuşak dönüş
  ROUND_TIME: 90.0,  // sn
  WIN_PCT: 40,       // erken zafer eşiği (%)
  STUN: 2.0,         // çarpışma dondurması (sn)
  TARGET_SCORE: 2,   // maçı alan raund sayısı
  TRAIL_CAP: 1500,   // güvenlik tavanı (aşılırsa iz silinir + stun)
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

  // Oyuncunun köşe base dikdörtgeni (hücre koordinatı): P1 sol-alt, P2 sol-üst, P3 sağ-üst, P4 sağ-alt
  baseRect(index) {
    const G = ZONE_TUNING.GRID;
    const B = ZONE_TUNING.BASE;
    if (index === 0) return { x0: 1, y0: G - B - 1, x1: B, y1: G - 2 };
    if (index === 1) return { x0: 1, y0: 1, x1: B, y1: B };
    if (index === 2) return { x0: G - B - 1, y0: 1, x1: G - 2, y1: B };
    return { x0: G - B - 1, y0: G - B - 1, x1: G - 2, y1: G - 2 };
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
    p.name = ZONE_NAMES[index];
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
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;
    this.arena = {
      cx: width / 2, cy: height / 2, width: arenaW, height: arenaH,
      size: Math.min(arenaW, arenaH),
      left: marginX, right: width - marginX, top: marginY, bottom: height - marginY,
    };

    // Kare capture alanı arena ortasında
    const s = Math.max(64, Math.min(arenaW, arenaH) - 8);
    this.field = { x: this.arena.cx - s / 2, y: this.arena.cy - s / 2, s };
    this.cell = s / ZONE_TUNING.GRID;

    // Mevcut maç varsa konumu yeni alana taşı (bölge sahipliği korunur)
    for (const p of this.players) {
      if (!p) continue;
      p.x = Math.min(Math.max(p.x, this.field.x + 2), this.field.x + this.field.s - 2);
      p.y = Math.min(Math.max(p.y, this.field.y + 2), this.field.y + this.field.s - 2);
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
      return {
        index: i, name: ZONE_NAMES[i], color: ZONE_COLORS[i],
        x: bcx, y: bcy, heading: outward,
        radius: Math.max(6, this.cell * 0.9),
        isJoined: this.isSlotJoined(i), slotType: this.slotTypes[i],
        trail: [], lastCell: -1,
        // İz-başlangıç anchor'ı: base'den çıkılan tam piksel nokta (render
        // kopukluğunu önler — ilk iz hücresinin merkezi değil, çıkış noktası).
        trailStartX: bcx, trailStartY: bcy,
        px: bcx, py: bcy,
        stunTimer: 0, blinkTimer: 0, wallCooldown: 0,
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
    this.particles = [];
    this.floatingTexts = [];
    this.trauma = 0;
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
    this.lastCaptureBy = -1;
    this.lastCaptureAt = 0;
    this.tieBreak = false;
    this.spawnProtect = 1.5;
    this.particles = [];
    this.floatingTexts = [];
    this.grid.fill(0);
    this.trailOwner.fill(-1);
    this.initPlayers();
    playStart();
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
    this.clearOwnership(victimIndex);
    this.wipeTrail(victimIndex);
    this.paintBase(victimIndex);
    const r = this.baseRect(victimIndex);
    // Base merkezi: dikdörtgen ortası (piksel)
    const bcx = this.field.x + ((r.x0 + r.x1 + 1) / 2) * this.cell;
    const bcy = this.field.y + ((r.y0 + r.y1 + 1) / 2) * this.cell;
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
      this.addFloatingText(v.x, v.y - 30, `✂ ${k ? k.name : ''} KESTİ!`, '#D84727');
      if (bounty > 0 && k) {
        this.addFloatingText(k.x, k.y - 30, `+${bounty} ÖDÜL BÖLGE!`, k.color);
      }
    } else {
      this.addFloatingText(v.x, v.y - 30, '✂ KENDİNİ KESTİN!', '#D84727');
    }
    this.addFloatingText(v.x, v.y - 12, 'BASE BOYUNA DÖNDÜN!', '#FFFFFF');
    this.recomputePct();
    this.burst(v.x, v.y, v.color, 22);
    this.addTrauma(0.55);
    playExplosion();
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
    }
    // Kademeli kapanış geri bildirimi: küçük hamle fısıldar, devasa hamle gümler
    if (gained >= 100) {
      this.addFloatingText(p.x, p.y - 22, `+%${this.pct[index]} DEVASA BÖLGE!`, p.color);
      this.burst(p.x, p.y, '#FFDE59', 30);
      this.addTrauma(0.45);
      playCoinPickup();
      playCashRegister();
    } else if (gained >= 20) {
      this.addFloatingText(p.x, p.y - 22, `+%${this.pct[index]} BÖLGE!`, p.color);
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

    this.roundTimer -= dt;
    if (this.spawnProtect > 0) this.spawnProtect = Math.max(0, this.spawnProtect - dt);
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

    const speed = this.cell * ZONE_TUNING.SPEED;

    for (const p of this.players) {
      if (!p.isJoined) continue;
      if (p.wallCooldown > 0) p.wallCooldown = Math.max(0, p.wallCooldown - dt);
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

      if (force > 0.05) {
        const target = Math.atan2(iy, ix);
        p.heading = this.turnToward(p.heading, target, ZONE_TUNING.TURN * dt);
      }
      const step = speed * (0.35 + 0.65 * Math.max(force, force > 0.05 ? 0.6 : 0));
      p.px = p.x; p.py = p.y;
      const mx = Math.cos(p.heading) * step * dt;
      const my = Math.sin(p.heading) * step * dt;

      // Duvar kayması: eksen eksen dene, takılan ekseni sabitle, diğeriyle
      // kaymaya devam et. Ceza mantığı: iz varken duvara vurmak izi siler +
      // dondurur; izsiz temas cezasızdır (duvara yaslanıp takılmak serbest).
      // wallCooldown zincir-stun'u önler (perma-stun bug'ının ilacı).
      let tryX = p.x + mx;
      let tryY = p.y + my;
      let hitX = false;
      let hitY = false;
      if (tryX < this.field.x + 1) { tryX = this.field.x + 1; hitX = true; }
      if (tryX > this.field.x + this.field.s - 1) { tryX = this.field.x + this.field.s - 1; hitX = true; }
      if (tryY < this.field.y + 1) { tryY = this.field.y + 1; hitY = true; }
      if (tryY > this.field.y + this.field.s - 1) { tryY = this.field.y + this.field.s - 1; hitY = true; }
      p.x = tryX; p.y = tryY;
      if ((hitX || hitY) && p.wallCooldown <= 0) {
        if (p.trail.length > 0) {
          this.wipeTrail(p.index);
          this.stunPlayer(p.index, true);
          p.wallCooldown = 1.5;
          playWallHit();
          continue;
        }
        p.wallCooldown = 0.25;
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
          // Kendi izine bastın: reset yok, iz silinir + donarsın
          this.wipeTrail(p.index);
          this.stunPlayer(p.index, true);
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
        p.trail.push(cellIdx);
        this.trailOwner[cellIdx] = p.index;
      }
    }

    // Kafa kafaya: iki iz de silinir, ikisi de donar (reset yok)
    for (let i = 0; i < this.players.length; i++) {
      const a = this.players[i];
      if (!a.isJoined || a.stunTimer > 0) continue;
      for (let j = i + 1; j < this.players.length; j++) {
        const b = this.players[j];
        if (!b.isJoined || b.stunTimer > 0) continue;
        const rr = (a.radius + b.radius) * 0.8;
        if (Math.hypot(a.x - b.x, a.y - b.y) < rr) {
          this.wipeTrail(i);
          this.wipeTrail(j);
          this.stunPlayer(i, true);
          this.stunPlayer(j, true);
          this.addFloatingText((a.x + b.x) / 2, (a.y + b.y) / 2 - 20, '💥 KAFA KAFAYA!', '#FFFFFF');
          this.addTrauma(0.3);
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
      renderControlGuide(ctx, this.arena, 'JOYSTICK: YÖN VER • İZİNİ KORU • %40 ALAN KAZANIR', [
        'P1 KIRMIZI', 'P2 MAVİ', 'P3 SARI', 'P4 YEŞİL',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'ROUND_OVER') {
      renderRoundBanner(ctx, {
        arena: this.arena,
        title: this.roundWinner ? `${this.roundWinner.name} ALDI!` : 'BERABERE!',
        titleColor: this.roundWinner ? this.roundWinner.color : '#1A1A1A',
        sub: this.roundWinner
          ? `%${this.pct[this.roundWinner.index]} BÖLGE • ${this.kills[this.roundWinner.index]} KESME${this.tieBreak ? ' • SON HAMLE!' : ''}`
          : '',
      });
    } else if (this.state === 'MATCH_OVER') {
      renderMatchOver(ctx, {
        arena: this.arena,
        uiButtons: this.uiButtons,
        headline: 'BÖLGE ŞAMPİYONU',
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

    // Açık izler (anchor çıkış noktasından başlar — kopukluk yok)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const p of this.players) {
      if (!p.isJoined || p.trail.length === 0) continue;
      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = this.cell * 0.85;
      ctx.beginPath();
      ctx.moveTo(p.trailStartX, p.trailStartY);
      for (const ci of p.trail) {
        const c = this.cellCenter(ci);
        ctx.lineTo(c.x, c.y);
      }
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.strokeStyle = p.color;
      ctx.lineWidth = this.cell * 0.55;
      ctx.stroke();
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
    // Dar hap: süre + önder (128px sabit ölçü korunur, taşmayı kes)
    const text = leader && leader.isJoined
      ? `⏱ ${Math.ceil(remain)}s ${leader.name.slice(0, 5)} %${this.pct[leader.index]}`
      : `⏱ ${Math.ceil(remain)}s`;
    renderTopPill(ctx, { arena: this.arena, text, urgent: remain <= 10.0 });
    renderCornerScores(ctx, {
      arena: this.arena,
      entries: this.players.map((p) =>
        p.isJoined
          ? { color: p.color, text: `%${this.pct[p.index]}${this.scores[p.index] > 0 ? `★${this.scores[p.index]}` : ''}` }
          : null
      ),
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

      // Lider tacı
      if (this.state === 'PLAYING' && p.index === this.leaderIndex && this.pct[p.index] > 0) {
        ctx.font = '16px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('👑', 0, -p.radius - 26);
      }

      // Gölge + gövde
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath();
      ctx.arc(3, 3, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = p.stunTimer > 0 ? '#48CAE4' : '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Yön oku
      ctx.save();
      ctx.rotate(p.heading);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.radius + 10, 0);
      ctx.lineTo(p.radius + 1, -5);
      ctx.lineTo(p.radius + 3.5, 0);
      ctx.lineTo(p.radius + 1, 5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // İsim + canlı % plakası
      const label = `${p.index + 1} • %${this.pct[p.index]}`;
      ctx.font = '900 11px "Space Grotesk", sans-serif';
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(-tw / 2, p.radius + 4, tw, 18);
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, p.radius + 13);
      if (p.stunTimer > 0) {
        ctx.fillStyle = '#48CAE4';
        ctx.font = '900 10px "JetBrains Mono", monospace';
        ctx.fillText('DONDU', 0, p.radius + 30);
      }

      ctx.restore();
    }
  }

  renderFx(ctx) {
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
        ctx.fillText(`${p.name.slice(0, 3)} SÜRÜKLE`, 0, 0);
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
    for (let i = 0; i < 4; i++) {
      const rect = seatRects[i];
      const isTop = i === 1 || i === 2;
      renderLobbySeatCard(ctx, {
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        slotIndex: i, slotType: this.slotTypes[i],
        playerName: this.players[i] ? this.players[i].name : '',
        playerColor: ZONE_COLORS[i],
        rotation: isTop ? Math.PI : 0,
      });
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
    });
  }
}
