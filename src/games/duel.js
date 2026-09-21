// QUICK DRAW (Game 06): 2-4 Player Wild West Aim Duel (Brutal Party // 4P)
// Fire on Signal with swaying aim lines (TAM/SIYIRMA/ISKA tiers), roaming tumbleweed
// blocker (BLOKE), dynamic 2/3/4 player scoring, false start penalties,
// millisecond reaction timer, bot AI (normal/god), and 4-way rotated player pods.

import { getSlotCustomization } from '../core/customizationManager.js';
import {
  playStart,
  playJoin,
  playGunshot,
  playDrawTension,
  playStumble,
  playCashRegister,
  playFakeoutCrow,
  playRicochet,
  playDryFire,
  playHeavyImpact,
} from '../audio.js';
import { updateDuelBotAI } from '../ai/duelAI.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatRects, renderLobbyStartButton, getSeatColorDotRect } from '../controlGuide.js';
import { t } from '../i18n.js';
import { getLocalSeatColors, ensureLocalSeatColor } from '../core/customizationManager.js';
import { UI_COLORS, getUiScale } from '../ui/tokens.js';
import { renderSpatialBadge, checkProximity } from '../ui/hud.js';
import { prefersReducedMotion } from '../ui/motion.js';
import { BaseMiniGame } from '../core/BaseGame.js';

// Kanonik parti paleti (TV lobi + kumanda şeridi ile birebir; koyu salonda kontrast daha iyi).
export const DUEL_COLORS = UI_COLORS.players;
export const DUEL_NAMES = ['KOVBOY 1', 'KOVBOY 2', 'KOVBOY 3', 'KOVBOY 4'];

export class DuelGame extends BaseMiniGame {
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
      width: 0,
      height: 0,
    };

    // Active human player slots (Index 0: Bottom, 1: Top, 2: Left, 3: Right)
    this.joinedPlayers = [true, true, false, false];
    this.playerNames = ['', '', '', ''];
    // Slot türleri: 'empty' | 'human' | 'bot_normal' | 'bot_god' (joinedPlayers ile çift yönlü senkron)
    this.slotTypes = ['human', 'human', 'empty', 'empty'];

    // Salınan Namlu + Gezgin Siper (Faz-1): deterministik, host-only görsel + isabet hesabı
    this.roundSeed = 0;
    this.aimTime = 0;
    this.aimPhase = [0, 0, 0, 0];
    this.aimSpeed = [2.6, 2.6, 2.6, 2.6];
    this.aimAmpDeg = 11;
    this.aimSpread = 1.0;
    this.fakeoutSpreadTimer = 0;
    this.blockerT = 0;
    this.blockerX = 0;
    this.blockerDir = 1;

    // Tournament Scoring (First to 10 points wins!)
    this.targetScore = 10;
    this.scores = [0, 0, 0, 0];
    this.wins = this.scores; // Compatibility alias
    this.roundWinner = null;
    this.falseStartPlayer = null;
    this.matchWinner = null;

    // All-time Table Reflex Record
    this.tableRecordMs = 178;

    // Tension & Fakeout Mechanics
    this.hasFakeout = false;
    this.fakeoutTriggerTime = 0;
    this.fakeoutFired = false;
    this.fakeoutDisplayTimer = 0;
    this.bulletTracers = [];

    // Timing & Reaction
    this.signalTime = 0;
    this.countdownTimer = 0;
    this.tensionTimer = 0;
    this.tensionDuration = 0;
    this.tensionAudioTimer = 0;
    this.drawWindowTimer = 0;
    this.roundEndTimer = 0;

    // Per-player round state:
    this.playerStatus = this.createInitialPlayerStatus();

    // Visual Juice & Screen Shake
    this.flashOpacity = 0;
    this.flashColor = '#FFFDF0';
    this.trauma = 0;
    this.smokeParticles = [];

    // UI Buttons & Trigger Zones
    this.uiButtons = [];
    this.triggerPads = [];

    // Keyboard controls for desktop testing
    this.keys = {};
    this.initKeyboard();

    this.lastTime = performance.now();
  }

  createInitialPlayerStatus() {
    return [0, 1, 2, 3].map(() => ({
      hasFired: false,
      falseStart: false,
      reactionMs: null,
      rank: 0,
      pointsEarned: 0,
      lastBestMs: null,
      offsetDeg: null,
      accuracy: null, // 'TAM' | 'SIYIRMA' | 'ISKA' | 'BLOKE'
      blocked: false,
      botFireAt: 0,
      botPlanned: false,
    }));
  }

  getPlayerColor(idx) {
    if (this.playerColors?.[idx]) return this.playerColors[idx];
    const custom = getSlotCustomization(idx);
    const isBot = this.slotTypes[idx] === 'bot_normal' || this.slotTypes[idx] === 'bot_god';
    return isBot ? '#8E8E93' : (custom?.color || DUEL_COLORS[idx]);
  }

  // slotTypes <-> joinedPlayers çift yönlü senkron (LOCAL cycle + host sync ortak)
  syncJoinFromSlots() {
    for (let i = 0; i < 4; i++) {
      this.joinedPlayers[i] = this.slotTypes[i] !== 'empty';
    }
  }

  isBotSlot(index) {
    const t = this.slotTypes?.[index];
    return t === 'bot_normal' || t === 'bot_god';
  }

  // Anlık nişan ofseti (derece): amp * spread * sin(aimTime*hız+faz)
  getAimOffsetDeg(index) {
    const spread = this.state === 'DRAW_SIGNAL' ? this.aimSpread * 0.65 : this.aimSpread;
    return this.aimAmpDeg * spread * Math.sin(this.aimTime * this.aimSpeed[index] + this.aimPhase[index]);
  }

  // Gezgin siper merkezde mi? (tüm atışlar merkeze yakınsar → tek eşik yeterli)
  isBlockerClosed() {
    return Math.abs(this.blockerX) < this.getBlockerRadius() * 0.9;
  }

  getBlockerRadius() {
    return Math.max(14, this.arena.size * 0.055);
  }

  getBlockerRange() {
    return this.arena.size * 0.22;
  }

  getBlockerPos() {
    return { x: this.arena.cx + this.blockerX, y: this.arena.cy };
  }

  puffBlockerDust() {
    const b = this.getBlockerPos();
    for (let i = 0; i < 10; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 40 + Math.random() * 120;
      this.smokeParticles.push({
        x: b.x,
        y: b.y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        radius: 5 + Math.random() * 10,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
        color: '#C08552',
      });
    }
  }

  // Tur birincisi: en çok puan alan; eşitlikte erken ateşleyen (rank küçük) kazanır
  resolveRoundWinner() {
    let best = -1;
    let bestPts = -1;
    let bestRank = 99;
    this.joinedPlayers.forEach((joined, idx) => {
      if (!joined) return;
      const st = this.playerStatus[idx];
      if (!st.hasFired || st.falseStart) return;
      if (st.pointsEarned > bestPts || (st.pointsEarned === bestPts && st.rank < bestRank)) {
        best = idx;
        bestPts = st.pointsEarned;
        bestRank = st.rank;
      }
    });
    // Hiç isabet yoksa (hepsi ISKA/BLOKE/ateşsiz) ilk ateşleyen vitrine çıkar ama puansız
    if (best === -1) {
      this.joinedPlayers.forEach((joined, idx) => {
        if (!joined) return;
        const st = this.playerStatus[idx];
        if (st.hasFired && best === -1) best = idx;
      });
    }
    this.roundWinner = best === -1 ? null : best;
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      const code = e.code;
      if (this.keys[code]) return;
      this.keys[code] = true;

      // P1 (slot 0): Space + alternatifler
      if (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') {
        this.handlePlayerTap(0);
      }
      // P2 (slot 1): Oklar + Enter
      if (code === 'ArrowUp' || code === 'KeyW' || code === 'Enter') {
        this.handlePlayerTap(1);
      }
      // P3 (slot 2): IJKL + O
      if (code === 'ArrowLeft' || code === 'KeyA' || code === 'KeyO') {
        this.handlePlayerTap(2);
      }
      // P4 (slot 3): TFGH + B
      if (code === 'ArrowRight' || code === 'KeyD' || code === 'KeyB') {
        this.handlePlayerTap(3);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  resize(width, height) {
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(52, Math.floor(height * 0.12))
      : Math.max(36, Math.floor(height * 0.07));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;
    const size = Math.min(arenaW, arenaH, 560);

    this.arena.width = arenaW;
    this.arena.height = arenaH;
    this.arena.size = size;
    this.arena.cx = width / 2;
    this.arena.cy = height / 2;
    this.arena.left = marginX;
    this.arena.right = width - marginX;
    this.arena.top = marginY;
    this.arena.bottom = height - marginY;

    this.updateTriggerPads();
  }

  updateTriggerPads() {
    const { cx, cy, left, right, top, bottom, size } = this.arena;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const padW = Math.min(size * 0.44, 220);
    const padH = Math.min(68, Math.max(52, size * 0.12));

    // Define 4 rotated trigger pads anchored around the perimeter
    this.triggerPads = [
      // P0: Bottom (Player 1) - Faces 0° (upright)
      {
        playerIndex: 0,
        cx: cx,
        cy: Math.min(bottom + padH / 2 + 10, viewportHeight - padH / 2 - 8),
        w: padW,
        h: padH,
        rotation: 0,
        label: 'KIRMIZI',
        sublabel: this.playerNames?.[0] || 'OYUNCU 1',
      },
      // P1: Top (Player 2) - Faces 180° (upright for opponent across table)
      {
        playerIndex: 1,
        cx: cx,
        cy: Math.max(top - padH / 2 - 10, padH / 2 + 8),
        w: padW,
        h: padH,
        rotation: Math.PI,
        label: 'MAVİ',
        sublabel: this.playerNames?.[1] || 'OYUNCU 2',
      },
      // P2: Left (Player 3) - Faces 90° (upright for player on left edge)
      {
        playerIndex: 2,
        cx: Math.max(left - padH / 2 - 8, padH / 2 + 6),
        cy: cy,
        w: padW,
        h: padH,
        rotation: Math.PI / 2,
        label: 'SARI',
        sublabel: this.playerNames?.[2] || 'OYUNCU 3',
      },
      // P3: Right (Player 4) - Faces -90° (upright for player on right edge)
      {
        playerIndex: 3,
        cx: Math.min(right + padH / 2 + 8, viewportWidth - padH / 2 - 6),
        cy: cy,
        w: padW,
        h: padH,
        rotation: -Math.PI / 2,
        label: 'YEŞİL',
        sublabel: this.playerNames?.[3] || 'OYUNCU 4',
      },
    ];
  }

  getActivePlayerCount() {
    return this.joinedPlayers.filter((j) => j).length;
  }

  togglePlayerJoin(index) {
    if (this.requestLobbySeatTap(index)) return;
    playJoin();
    // Lokal: empty → human → bot_normal → bot_god → empty (diğer motorlarla aynı zincir)
    const cur = this.slotTypes[index] || 'empty';
    const next =
      cur === 'empty' ? 'human'
      : cur === 'human' ? 'bot_normal'
      : cur === 'bot_normal' ? 'bot_god'
      : 'empty';
    this.slotTypes[index] = next;
    this.syncJoinFromSlots();
    // LOCAL: yeni insan koltuğuna boş renk ata (hook dönmediyse lokaldir)
    if (next === 'human' && !this.hideLobbyStartButton) {
      const hex = ensureLocalSeatColor(index);
      if (Array.isArray(this.playerColors)) this.playerColors[index] = hex;
    }
  }

  // Registry standardı: tüm motorlar startNewMatch() ile çalışır.
  startNewMatch() {
    this.startMatch();
  }

  startMatch() {
    if (this.getActivePlayerCount() < 2) return;
    playStart();
    this.scores = [0, 0, 0, 0];
    this.wins = this.scores;
    this.matchWinner = null;
    this.roundWinner = null;
    this.falseStartPlayer = null;
    this.startNewRound();
  }

  startNewRound() {
    this.state = 'STANDOFF_COUNTDOWN';
    this.countdownTimer = 1.2;
    this.roundWinner = null;
    this.falseStartPlayer = null;
    this.signalTime = 0;
    this.tensionTimer = 0;
    this.drawWindowTimer = 0;
    this.roundEndTimer = 0;
    this.flashOpacity = 0;

    // Nişan + siper sıfırla (deterministik tur tohumu)
    this.roundSeed = Math.random() * 1000;
    this.aimTime = 0;
    this.aimSpread = 1.0;
    this.fakeoutSpreadTimer = 0;
    this.blockerT = Math.random() * 2;
    this.blockerX = 0;
    this.blockerDir = Math.random() > 0.5 ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      this.aimPhase[i] = Math.random() * Math.PI * 2;
      this.aimSpeed[i] = 2.2 + Math.random() * 1.6;
    }

    // Reset round statuses
    this.playerStatus.forEach((p) => {
      p.hasFired = false;
      p.falseStart = false;
      p.reactionMs = null;
      p.rank = 0;
      p.pointsEarned = 0;
      p.offsetDeg = null;
      p.accuracy = null;
      p.blocked = false;
      p.botFireAt = 0;
      p.botPlanned = false;
    });
  }

  armDuelTension() {
    this.state = 'TENSION';
    // Random psychological standoff duration between 2.0 and 4.6 seconds
    this.tensionDuration = 2.0 + Math.random() * 2.6;
    this.tensionTimer = this.tensionDuration;
    this.tensionAudioTimer = 0;

    // 40% chance of psychological fakeout cue
    this.hasFakeout = Math.random() < 0.40;
    this.fakeoutTriggerTime = this.tensionDuration * (0.35 + Math.random() * 0.35);
    this.fakeoutFired = false;
    this.fakeoutDisplayTimer = 0;

    playDrawTension();
  }

  triggerDrawSignal() {
    this.state = 'DRAW_SIGNAL';
    this.signalTime = performance.now();
    this.flashOpacity = 1.0;
    this.flashColor = '#FFFFFF';
    this.trauma = 0.8;
    this.fakeoutDisplayTimer = 0;
    this.drawWindowTimer = 0;
    // Sinyalde nişan daralır (spread çarpanı getAimOffsetDeg içinde 0.65'e iner)
    this.aimSpread = 1.0;
    // Botlar için ateş planı kur (reaksiyon + nişan + siper bekleme)
    for (let i = 0; i < 4; i++) {
      if (this.joinedPlayers[i] && this.isBotSlot(i)) {
        this.planBotShot(i);
      }
    }

    playGunshot();

    // Spawn dramatic muzzle smoke at arena center
    for (let i = 0; i < 24; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 60 + Math.random() * 180;
      this.smokeParticles.push({
        x: this.arena.cx,
        y: this.arena.cy,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        radius: 8 + Math.random() * 16,
        life: 0.6 + Math.random() * 0.6,
        maxLife: 1.2,
        color: Math.random() > 0.4 ? '#FAF8F5' : '#D99B26',
      });
    }
  }

  // Bot ateş planı: reaksiyon + nişan sıfır-geçişi + siper bekleme (host-only)
  planBotShot(index) {
    const st = this.playerStatus[index];
    const god = this.slotTypes[index] === 'bot_god';
    const now = performance.now();
    // Baz reaksiyon: normal 220-360ms, god 150-230ms
    let delay = god ? 150 + Math.random() * 80 : 220 + Math.random() * 140;
    // Nişan: ileriye dönük ilk iyi pencereyi bekle (maks +350ms)
    const wantDeg = god ? 4 : 6;
    const stepMs = 25;
    for (let fwd = 0; fwd <= 350; fwd += stepMs) {
      const t = this.aimTime + (delay + fwd) / 1000;
      const spread = 0.65; // DRAW_SIGNAL daralması
      const off = this.aimAmpDeg * spread * Math.sin(t * this.aimSpeed[index] + this.aimPhase[index]);
      if (Math.abs(off) <= wantDeg) {
        delay += fwd;
        break;
      }
    }
    // Siper: planlanan anda çalı merkezde olacaksa bekle (normal bazen aldırmaz)
    const blockerFreq = (Math.PI * 2) / 1.8;
    const range = this.getBlockerRange();
    const radius = this.getBlockerRadius() * 0.9;
    const tFire = this.blockerT + delay / 1000;
    const xFire = Math.sin(tFire * blockerFreq) * range * this.blockerDir;
    if (Math.abs(xFire) < radius && (god || Math.random() > 0.35)) {
      delay += 120 + Math.random() * 80;
    }
    st.botFireAt = now + delay;
    st.botPlanned = true;
  }

  // İsabet kademesi: TAM (tam puan) · SIYIRMA (tavan-1, min 1) · ISKA/BLOKE (0)
  getAccuracyForOffset(absDeg) {
    if (absDeg <= 4) return 'TAM';
    if (absDeg <= 10) return 'SIYIRMA';
    return 'ISKA';
  }

  handleRemoteInput(slotIndex, data) {
    if (data.action === 'DUEL_TAP') {
      this.handlePlayerTap(slotIndex);
    }
  }

  // Dynamic point system based on 2, 3, or 4 active players
  getPointsForRank(rank, activeCount) {
    if (activeCount === 2) {
      if (rank === 1) return 2;
      return 0;
    } else if (activeCount === 3) {
      if (rank === 1) return 3;
      if (rank === 2) return 1;
      return 0;
    } else {
      // 4 Players
      if (rank === 1) return 3;
      if (rank === 2) return 2;
      if (rank === 3) return 1;
      return 0;
    }
  }

  handlePlayerTap(playerIdx) {
    if (!this.joinedPlayers[playerIdx]) return;
    const st = this.playerStatus[playerIdx];

    // 1. EARLY TAP DURING TENSION / COUNTDOWN -> FALSE START PENALTY (-1 PT)
    if (this.state === 'STANDOFF_COUNTDOWN' || this.state === 'TENSION') {
      st.falseStart = true;
      this.falseStartPlayer = playerIdx;

      // Penalize: -1 Point (floor at 0)
      this.scores[playerIdx] = Math.max(0, this.scores[playerIdx] - 1);
      st.pointsEarned = -1;

      playStumble();
      this.trauma = 0.55;
      this.state = 'ROUND_OVER';
      this.roundEndTimer = 3.0;
      return;
    }

    // 2. TAP ON SIGNAL -> REACTION + AIM OFFSET + BLOCKER -> TIERED SCORE
    if (this.state === 'DRAW_SIGNAL') {
      if (st.hasFired || st.falseStart) return;

      st.hasFired = true;
      st.reactionMs = Math.max(1, Math.round(performance.now() - this.signalTime));
      st.offsetDeg = this.getAimOffsetDeg(playerIdx);

      const activeCount = this.getActivePlayerCount();
      const firedCount = this.playerStatus.filter((p) => p.hasFired).length;
      st.rank = firedCount;

      const base = this.getPointsForRank(firedCount, activeCount);
      st.blocked = this.isBlockerClosed();
      if (st.blocked) {
        st.accuracy = 'BLOKE';
        st.pointsEarned = 0;
      } else {
        st.accuracy = this.getAccuracyForOffset(Math.abs(st.offsetDeg));
        if (st.accuracy === 'TAM') {
          st.pointsEarned = base;
        } else if (st.accuracy === 'SIYIRMA') {
          st.pointsEarned = base > 0 ? Math.max(1, base - 1) : 0;
        } else {
          st.pointsEarned = 0;
        }
      }
      this.scores[playerIdx] += st.pointsEarned;

      // Tracer rengi kademeye göre
      const tracerColor =
        st.accuracy === 'TAM' ? '#FFDE59'
        : st.accuracy === 'SIYIRMA' ? '#2D6A4F'
        : st.accuracy === 'BLOKE' ? '#E63946'
        : '#8A7A70';
      const pad = this.triggerPads[playerIdx];
      if (pad) {
        this.bulletTracers.push({
          x1: pad.cx,
          y1: pad.cy,
          x2: st.blocked ? this.arena.cx + this.blockerX : this.arena.cx,
          y2: this.arena.cy,
          life: st.accuracy === 'TAM' ? 0.55 : 0.4,
          color: tracerColor,
        });
      }

      // First to draw (Champion of this round!)
      if (firedCount === 1) {
        this.roundWinner = playerIdx;
        this.trauma = 0.6;
        this.drawWindowTimer = 1.1; // Allow remaining players 1.1s to tap for 2nd/3rd place

        if (st.accuracy === 'TAM') {
          playGunshot();
          playCashRegister();
          // Rekor sadece TAM vuruşta kırılır
          if (st.reactionMs < this.tableRecordMs) {
            this.tableRecordMs = st.reactionMs;
          }
          if (st.lastBestMs === null || st.reactionMs < st.lastBestMs) {
            st.lastBestMs = st.reactionMs;
          }
        } else if (st.accuracy === 'SIYIRMA') {
          playGunshot();
          playRicochet();
          if (st.lastBestMs === null || st.reactionMs < st.lastBestMs) {
            st.lastBestMs = st.reactionMs;
          }
        } else if (st.blocked) {
          playGunshot();
          playHeavyImpact();
          this.puffBlockerDust();
        } else {
          playGunshot();
          playDryFire();
        }
      } else {
        // Runner up hit
        if (st.accuracy === 'TAM') {
          playGunshot();
          if (st.lastBestMs === null || st.reactionMs < st.lastBestMs) {
            st.lastBestMs = st.reactionMs;
          }
        } else if (st.accuracy === 'SIYIRMA') {
          playGunshot();
          playRicochet();
        } else if (st.blocked) {
          playHeavyImpact();
          this.puffBlockerDust();
        } else {
          playDryFire();
        }
      }

      // If all active players have fired, end round immediately
      const allFired = this.playerStatus.filter((p, i) => this.joinedPlayers[i] && p.hasFired).length === activeCount;
      if (allFired) {
        this.resolveRoundWinner();
        this.state = 'ROUND_OVER';
        this.roundEndTimer = 3.0;
        this.checkMatchWin();
      }
    }
  }

  checkMatchWin() {
    this.joinedPlayers.forEach((joined, idx) => {
      if (joined && this.scores[idx] >= this.targetScore) {
        this.state = 'MATCH_OVER';
        this.matchWinner = idx;
        this.roundEndTimer = 0;
      }
    });
  }

  // --- Touch Input Handling with Rotated Bounds Detection ---
  onTouchStart(touch) {
    const pos = { x: touch.x, y: touch.y };

    // Lobby UI Clicks (Start Button)
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') {
      if (this.handleUiTap(pos)) return;
    }

    // Lobby Pad Click (Player join toggle)
    if (this.state === 'LOBBY') {
      for (const pad of this.triggerPads) {
        if (this.isPointInsidePad(pos, pad, 24)) {
          this.togglePlayerJoin(pad.playerIndex);
          return;
        }
      }
    }

    // Round Over Skip Tap
    if (this.state === 'ROUND_OVER') {
      if (this.roundEndTimer < 2.4) {
        this.startNewRound();
        return;
      }
    }

    // In-game tap
    if (
      this.state === 'STANDOFF_COUNTDOWN' ||
      this.state === 'TENSION' ||
      this.state === 'DRAW_SIGNAL'
    ) {
      for (const pad of this.triggerPads) {
        if (this.isPointInsidePad(pos, pad, 28)) {
          this.handlePlayerTap(pad.playerIndex);
          return;
        }
      }
    }
  }

  onTouchMove() {}
  onTouchEnd() {}
  onTouchesReset() {}

  // Rotated Hit Testing for Player Pods
  isPointInsidePad(point, pad, margin = 20) {
    const dx = point.x - pad.cx;
    const dy = point.y - pad.cy;
    const cos = Math.cos(-pad.rotation);
    const sin = Math.sin(-pad.rotation);
    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    return (
      localX >= -pad.w / 2 - margin &&
      localX <= pad.w / 2 + margin &&
      localY >= -pad.h / 2 - margin &&
      localY <= pad.h / 2 + margin
    );
  }

  reset() {
    this.scores = [0, 0, 0, 0];
    this.wins = this.scores;
    this.state = 'LOBBY';
    this.roundWinner = null;
    this.falseStartPlayer = null;
    this.matchWinner = null;
    this.smokeParticles = [];
    this.bulletTracers = [];
    this.signalTime = 0;
    this.countdownTimer = 0;
    this.tensionTimer = 0;
    this.drawWindowTimer = 0;
    this.roundEndTimer = 0;
    this.flashOpacity = 0;
    this.trauma = 0;
    this.aimTime = 0;
    this.aimSpread = 1.0;
    this.fakeoutSpreadTimer = 0;
    this.blockerT = 0;
    this.blockerX = 0;
    this.lastTime = performance.now();
    this.playerStatus = this.createInitialPlayerStatus();
  }

  resetMatch() {
    this.reset();
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    // Screen shake decay
    this.trauma = Math.max(0, this.trauma - dt * 2.2);

    // Flash fade
    if (this.flashOpacity > 0) {
      this.flashOpacity = Math.max(0, this.flashOpacity - dt * 2.8);
    }

    // Smoke particles
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) {
        this.smokeParticles.splice(i, 1);
      }
    }

    // Bullet Tracers decay
    for (let i = this.bulletTracers.length - 1; i >= 0; i--) {
      const b = this.bulletTracers[i];
      b.life -= dt;
      if (b.life <= 0) this.bulletTracers.splice(i, 1);
    }

    // Tek katılımcı kalınca sinyal beklenmez — kalan raundu alır
    if (this.state === 'STANDOFF_COUNTDOWN' || this.state === 'TENSION' || this.state === 'DRAW_SIGNAL') {
      const joinedIdx = [];
      this.joinedPlayers.forEach((j, i) => { if (j) joinedIdx.push(i); });
      if (joinedIdx.length <= 1) {
        if (joinedIdx.length === 1) {
          const survivor = joinedIdx[0];
          this.roundWinner = survivor;
          const pts = this.getPointsForRank(1, Math.max(2, this.getActivePlayerCount()));
          this.scores[survivor] += pts;
          this.playerStatus[survivor].pointsEarned = pts;
        } else {
          this.roundWinner = null;
        }
        this.state = 'ROUND_OVER';
        this.roundEndTimer = 3.0;
        this.checkMatchWin();
        return;
      }
    }

    // COUNTDOWN STATE
    if (this.state === 'STANDOFF_COUNTDOWN') {
      this.countdownTimer -= dt;
      if (this.countdownTimer <= 0) {
        this.armDuelTension();
      }
    }

    // TENSION STATE
    if (this.state === 'TENSION') {
      this.tensionTimer -= dt;
      this.tensionAudioTimer += dt;
      // Nişan sarkacı + gezgin siper ilerler
      this.aimTime += dt;
      this.blockerT += dt;
      this.blockerX = Math.sin(this.blockerT * ((Math.PI * 2) / 1.8)) * this.getBlockerRange() * this.blockerDir;
      if (this.fakeoutSpreadTimer > 0) {
        this.fakeoutSpreadTimer -= dt;
        this.aimSpread = 1.5;
      } else {
        this.aimSpread = 1.0;
      }

      // Heartbeat pulse every 0.8s
      if (this.tensionAudioTimer >= 0.8) {
        this.tensionAudioTimer = 0;
        playDrawTension();
      }

      // Psychological Fakeout Cue
      if (this.hasFakeout && !this.fakeoutFired && this.tensionTimer <= this.fakeoutTriggerTime) {
        this.fakeoutFired = true;
        this.fakeoutDisplayTimer = 0.6;
        this.fakeoutSpreadTimer = 0.45; // blöf anında namlu açılır
        playFakeoutCrow();
      }

      if (this.fakeoutDisplayTimer > 0) {
        this.fakeoutDisplayTimer -= dt;
      }

      // Bot blöf hatası (erken basma)
      for (let i = 0; i < 4; i++) {
        if (this.joinedPlayers[i] && this.isBotSlot(i)) {
          updateDuelBotAI(this, i, dt);
        }
      }

      if (this.tensionTimer <= 0) {
        this.triggerDrawSignal();
      }
    }

    // DRAW SIGNAL STATE (Multi-tap reaction window)
    if (this.state === 'DRAW_SIGNAL') {
      this.aimTime += dt;
      this.blockerT += dt;
      this.blockerX = Math.sin(this.blockerT * ((Math.PI * 2) / 1.8)) * this.getBlockerRange() * this.blockerDir;
      // Bot ateşleri (planlanan zamanda)
      for (let i = 0; i < 4; i++) {
        if (this.joinedPlayers[i] && this.isBotSlot(i)) {
          updateDuelBotAI(this, i, dt);
        }
      }
      if (this.drawWindowTimer > 0) {
        this.drawWindowTimer -= dt;
        if (this.drawWindowTimer <= 0) {
          this.resolveRoundWinner();
          this.state = 'ROUND_OVER';
          this.roundEndTimer = 3.2;
          this.checkMatchWin();
        }
      }
    }

    // ROUND OVER STATE
    if (this.state === 'ROUND_OVER') {
      this.roundEndTimer -= dt;
      if (this.roundEndTimer <= 0) {
        this.checkMatchWin();
        if (this.state !== 'MATCH_OVER') {
          this.startNewRound();
        }
      }
    }
  }

  render() {
    const { ctx, canvas } = this;
    const width = canvas.width;
    const height = canvas.height;

    ctx.save();

    // Camera Shake
    if (this.trauma > 0 && !prefersReducedMotion()) {
      const shakeX = (Math.random() - 0.5) * this.trauma * 24;
      const shakeY = (Math.random() - 0.5) * this.trauma * 24;
      ctx.translate(shakeX, shakeY);
    }

    // Vintage Saloon Sandstone / Dark background
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, width, height);

    // Draw Western Arena
    this.renderArena();

    // Nişan çizgileri + gezgin siper (maç akışında)
    if (this.state === 'TENSION' || this.state === 'DRAW_SIGNAL' || this.state === 'ROUND_OVER') {
      this.renderAimLines();
      this.renderBlocker();
    }

    // Draw Particles
    this.renderParticles();

    // State Renderings
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, t('guide.duel'), [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobby();
    } else if (this.state === 'STANDOFF_COUNTDOWN') {
      this.renderCountdown();
    } else if (this.state === 'TENSION') {
      this.renderTension();
    } else if (this.state === 'DRAW_SIGNAL') {
      this.renderDrawSignal();
    } else if (this.state === 'ROUND_OVER') {
      this.renderRoundOver();
    } else if (this.state === 'MATCH_OVER') {
      this.renderMatchOver();
    }

    // 4-Way Rotated Trigger Pads
    if (this.state !== 'LOBBY') {
      this.renderTriggerPads();
    }

    // Flash Overlay
    if (this.flashOpacity > 0) {
      ctx.fillStyle = `rgba(255, 255, 240, ${this.flashOpacity})`;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.restore();
  }

  renderArena() {
    const { ctx } = this;
    const { left, top, width, height, size, cx, cy } = this.arena;

    // Western Arena Boundary
    ctx.fillStyle = '#1A1816';
    ctx.fillRect(left, top, width, height);

    // Devasa Zemin Filigranı (Crown standardı: sahaya gömülü devasa durum göstergesi)
    if (this.state !== 'LOBBY') {
      const bigSize = Math.max(90, Math.min(180, Math.floor(Math.min(width, height) * 0.24)));
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (this.state === 'DRAW_SIGNAL') {
        ctx.globalAlpha = 0.44;
        ctx.font = `900 ${bigSize}px "Space Grotesk", sans-serif`;
        ctx.fillStyle = '#FFDE59';
        ctx.fillText(t('duel.fire'), cx, cy);
      } else if (this.state === 'TENSION' || this.state === 'STANDOFF_COUNTDOWN') {
        ctx.globalAlpha = 0.26;
        ctx.font = `900 ${Math.floor(bigSize * 0.85)}px "Space Grotesk", sans-serif`;
        ctx.fillStyle = '#C08552';
        ctx.fillText('BEKLE', cx, cy);
      } else if (this.state === 'ROUND_OVER' && this.roundWinner !== null) {
        const winTime = this.playerStatus[this.roundWinner]?.reactionMs;
        const winnerColor = DUEL_COLORS[this.roundWinner];
        ctx.globalAlpha = 0.38;
        ctx.font = `900 ${Math.floor(bigSize * 0.75)}px "Space Grotesk", sans-serif`;
        ctx.fillStyle = winnerColor || '#D99B26';
        if (winTime && winTime > 0) {
          ctx.fillText(`${Math.round(winTime)} MS`, cx, cy);
        }
      }
      ctx.restore();
    }

    ctx.lineWidth = 6;
    ctx.strokeStyle = '#3A2E26';
    ctx.strokeRect(left, top, width, height);

    // Subtle Crosshairs
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2A2420';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + width, top + height);
    ctx.moveTo(left + width, top);
    ctx.lineTo(left, top + height);
    ctx.stroke();

    // Center Standoff Ring
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#4A3B30';
    ctx.stroke();

    if (this.state !== 'LOBBY') {
      // Scoreboard at Top Center
      this.renderScoreboard();
    }
  }

  // Salınan namlu çizgileri: pad → merkez, ofset kadar açıyla sapar
  renderAimLines() {
    const { ctx } = this;
    const { cx, cy } = this.arena;
    const motionOK = !prefersReducedMotion();
    this.triggerPads.forEach((pad) => {
      const idx = pad.playerIndex;
      if (!this.joinedPlayers[idx]) return;
      const st = this.playerStatus[idx];
      if (st.hasFired || st.falseStart) return;
      const offDeg = this.state === 'ROUND_OVER' ? 0 : this.getAimOffsetDeg(idx);
      const offRad = (offDeg * Math.PI) / 180;
      const baseAng = Math.atan2(cy - pad.cy, cx - pad.cx);
      const ang = baseAng + offRad;
      const len = Math.hypot(cx - pad.cx, cy - pad.cy);
      const ex = pad.cx + Math.cos(ang) * len;
      const ey = pad.cy + Math.sin(ang) * len;
      const absOff = Math.abs(offDeg);
      const col = absOff <= 4 ? '#FFDE59' : absOff <= 10 ? '#E9C46A' : '#8A7A70';
      ctx.save();
      ctx.globalAlpha = this.state === 'DRAW_SIGNAL' ? 0.85 : 0.4;
      ctx.strokeStyle = col;
      ctx.lineWidth = this.state === 'DRAW_SIGNAL' ? 3 : 2;
      ctx.setLineDash(motionOK ? [] : [6, 6]);
      ctx.beginPath();
      ctx.moveTo(pad.cx, pad.cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      // Uç nokta işareti
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(ex, ey, this.state === 'DRAW_SIGNAL' ? 6 : 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  // Gezgin siper: merkez halkada gidip gelen tumbleweed
  renderBlocker() {
    const { ctx } = this;
    const { cy } = this.arena;
    const b = this.getBlockerPos();
    const r = this.getBlockerRadius();
    const closed = this.isBlockerClosed();
    const spin = this.blockerT * 3.1;
    ctx.save();
    // Gölge
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(b.x, cy + r * 0.9, r * 1.05, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Çalı gövdesi
    ctx.fillStyle = closed ? '#E76F51' : '#C08552';
    ctx.beginPath();
    ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#3A2E26';
    ctx.stroke();
    // Dönen dallar
    ctx.strokeStyle = '#6B4F3A';
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(b.x - Math.cos(a) * r, b.y - Math.sin(a) * r);
      ctx.quadraticCurveTo(b.x, b.y, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
      ctx.stroke();
    }
    // Kapalıysa uyarı halkası
    if (closed && (this.state === 'TENSION' || this.state === 'DRAW_SIGNAL')) {
      ctx.strokeStyle = '#E63946';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r + 5, 0, Math.PI * 2);
      ctx.stroke();
      renderSpatialBadge(ctx, {
        x: b.x,
        y: b.y - r - 12,
        text: t('duel.cover'),
        icon: '🛡️',
        urgent: true,
        scale: 0.95,
      });
    }
    ctx.restore();
  }

  renderScoreboard() {
    const { ctx } = this;
    const { cx, top, width } = this.arena;
    const scale = getUiScale(this.arena);

    ctx.save();
    const stripW = Math.min(width * 0.95, Math.round(580 * Math.min(1.35, scale)));
    const stripH = Math.round(44 * Math.min(1.35, scale));
    const stripX = cx - stripW / 2;
    const stripY = top + Math.round(10 * scale);
    const shadow = Math.max(2, Math.round(3 * Math.min(1.4, scale)));

    // Proximity ghosting: Siper veya oyuncu şeride yaklaşırsa saydamlaş
    const isNearby = checkProximity({ x: stripX, y: stripY, w: stripW, h: stripH }, this.tumbleweeds, 25);
    ctx.globalAlpha = isNearby ? 0.25 : 0.96;

    // Solid Shadow & Board
    ctx.fillStyle = '#000000';
    ctx.fillRect(stripX + shadow, stripY + shadow, stripW, stripH);
    ctx.fillStyle = '#1A1816';
    ctx.fillRect(stripX, stripY, stripW, stripH);
    ctx.lineWidth = Math.max(2.5, Math.round(2.5 * Math.min(1.3, scale)));
    ctx.strokeStyle = '#C08552';
    ctx.strokeRect(stripX, stripY, stripW, stripH);

    const activeCount = this.joinedPlayers.filter(Boolean).length || 1;
    const recTagW = Math.round(124 * Math.min(1.25, scale));
    const slotW = (stripW - recTagW - 10) / activeCount;
    let currSlot = 0;

    const fontPx = Math.round(13 * Math.min(1.3, scale));
    this.joinedPlayers.forEach((joined, idx) => {
      if (joined) {
        const px = stripX + currSlot * slotW;
        const color = this.getPlayerColor(idx);
        // Swatch
        ctx.fillStyle = color;
        ctx.fillRect(px + 6, stripY + 7, Math.round(10 * Math.min(1.3, scale)), stripH - 14);

        ctx.fillStyle = '#FAF8F5';
        ctx.font = `900 ${fontPx}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const pName = this.playerNames?.[idx] || DUEL_NAMES[idx];
        ctx.fillText(`${pName}: ${this.scores[idx]}P`, px + Math.round(22 * Math.min(1.3, scale)), stripY + stripH / 2, slotW - 24);
        currSlot++;
      }
    });

    // Right Record Tag
    const recX = stripX + stripW - recTagW - 4;
    ctx.fillStyle = '#0F0D0C';
    ctx.fillRect(recX, stripY + 5, recTagW, stripH - 10);
    ctx.strokeStyle = '#D99B26';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(recX, stripY + 5, recTagW, stripH - 10);

    ctx.fillStyle = '#FFDE59';
    ctx.font = `900 ${Math.round(12 * Math.min(1.25, scale))}px "JetBrains Mono", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`⚡ ${this.tableRecordMs}ms`, recX + recTagW / 2, stripY + stripH / 2);

    ctx.restore();
  }

  renderLobby() {
    const { ctx } = this;
    const { cx, cy, size } = this.arena;

    this.uiButtons = [];

    // Title Banner
    const titleY = cy - size * 0.26;

    ctx.save();
    ctx.font = '900 32px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('duel.title'), cx, titleY);

    ctx.font = '700 14px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#D99B26';
    ctx.fillText(t('duel.rules1'), cx, titleY + 30);

    // Scoring Breakdown Badge
    const activeCount = this.getActivePlayerCount();
    let scoringRuleText = '';
    if (activeCount === 2) scoringRuleText = t('duel.score2');
    else if (activeCount === 3) scoringRuleText = t('duel.score3');
    else scoringRuleText = t('duel.score4');

    ctx.font = '800 12px "Space Grotesk", monospace';
    ctx.fillStyle = '#FFDE59';
    ctx.fillText(scoringRuleText, cx, titleY + 54);
    ctx.restore();

    // Standart kare koltuklar (4 köşe, tüm oyunlarla aynı ölçü)
    const slotRects = getStandardSeatRects(this.arena);
    const localMode = !this.hideLobbyStartButton;
    const localColors = localMode ? getLocalSeatColors() : null;

    slotRects.forEach((rect, idx) => {
      renderLobbySeatCard(ctx, {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        slotIndex: idx,
        slotType: this.slotTypes[idx] || 'empty',
        playerName: this.playerNames[idx] || '',
        playerColor: DUEL_COLORS[idx],
        rotation: 0,
        seatColor: localMode ? (localColors[idx] || DUEL_COLORS[idx]) : null,
        showColorDot: localMode,
      });

      // Nokta önce: tap dispatch ilk eşleşmede durur, nokta kartın içindedir.
      if (localMode) {
        const dot = getSeatColorDotRect(rect);
        this.uiButtons.push({
          x: dot.x,
          y: dot.y,
          w: dot.w,
          h: dot.h,
          onClick: () => this.cycleLocalSeat(idx),
        });
      }

      this.uiButtons.push({
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        onClick: () => this.togglePlayerJoin(idx),
      });
    });

    // Start Button (standart)
    const startRect = renderLobbyStartButton(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      joinedCount: activeCount,
      accent: '#D99B26',
      textColor: '#141414',
      onStart: () => this.startMatch(),
      hidden: !!this.hideLobbyStartButton,
    });

    // Instructions (host modunda buton gizliyse merkez referans alınır)
    const rulesY = startRect ? startRect.y + startRect.h + 20 : this.arena.cy + 50;
    ctx.save();
    ctx.font = '800 12px "Space Grotesk", monospace';
    ctx.fillStyle = '#A8998C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('duel.rules2'), cx, rulesY);

    ctx.font = '700 11px "Space Grotesk", monospace';
    ctx.fillStyle = '#E76F51';
    ctx.fillText(t('duel.rules3'), cx, rulesY + 18);
    ctx.restore();
  }

  renderCountdown() {
    const { ctx } = this;
    const { cx, cy } = this.arena;
    const scale = getUiScale(this.arena);

    ctx.font = `900 ${Math.round(44 * scale)}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = '#D99B26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('duel.hands'), cx, cy - Math.round(22 * scale));

    ctx.font = `700 ${Math.round(18 * scale)}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText(t('duel.waitAll'), cx, cy + Math.round(30 * scale));
  }

  renderTension() {
    const { ctx } = this;
    const { cx, cy } = this.arena;
    const scale = getUiScale(this.arena);

    if (this.fakeoutDisplayTimer > 0) {
      // Psychological Bluff
      ctx.font = `900 ${Math.round(48 * scale)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = '#E76F51';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('duel.careful'), cx, cy - Math.round(22 * scale));

      ctx.font = `700 ${Math.round(18 * scale)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = '#FFDE59';
      ctx.fillText(t('duel.bluff'), cx, cy + Math.round(32 * scale));
    } else {
      const pulse = Math.sin(performance.now() * 0.01) * 0.5 + 0.5;

      ctx.font = `900 ${Math.round(56 * scale)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = pulse > 0.5 ? '#E63946' : '#FAF8F5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('duel.freeze'), cx, cy - Math.round(22 * scale));

      ctx.font = `700 ${Math.round(18 * scale)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = '#C08552';
      ctx.fillText(t('duel.foulTouch'), cx, cy + Math.round(34 * scale));
    }
  }

  renderDrawSignal() {
    const { ctx } = this;
    const { cx, cy } = this.arena;
    const scale = getUiScale(this.arena);

    // Huge DRAW banner
    ctx.font = `900 ${Math.round(92 * scale)}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = '#D99B26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('duel.fireBig'), cx, cy - Math.round(12 * scale));

    ctx.font = `900 ${Math.round(26 * scale)}px "Space Grotesk", sans-serif`;
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText(t('duel.tapNow'), cx, cy + Math.round(62 * scale));
  }

  renderRoundOver() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    if (this.falseStartPlayer !== null) {
      // False start display
      const offenderName = DUEL_NAMES[this.falseStartPlayer];
      ctx.font = '900 34px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#E63946';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t('duel.foul'), cx, cy - 40);

      ctx.font = '900 20px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText(t('duel.foulWho', offenderName), cx, cy);

      ctx.font = '700 15px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#D99B26';
      ctx.fillText(t('duel.touchCont'), cx, cy + 45);
    } else if (this.roundWinner !== null && this.roundWinner >= 0) {
      const winnerName = DUEL_NAMES[this.roundWinner];
      const winMs = this.playerStatus[this.roundWinner].reactionMs;

      ctx.font = '900 36px "Space Grotesk", sans-serif';
      ctx.fillStyle = DUEL_COLORS[this.roundWinner];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚡ ${winnerName} VURDU! ⚡`, cx, cy - 48, this.arena.width - 24);

      ctx.font = '900 44px "Space Grotesk", monospace';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText(`${winMs} MS`, cx, cy);

      // Score breakdown list
      let yOff = cy + 44;
      const rankBadges = ['', '🥇 1.', '🥈 2.', '🥉 3.', '4.'];
      const accTag = { TAM: t('duel.accFull'), SIYIRMA: t('duel.accGraze'), ISKA: t('duel.accMiss'), BLOKE: t('duel.accBlock') };

      this.joinedPlayers.forEach((joined, idx) => {
        if (!joined) return;
        const st = this.playerStatus[idx];
        const colorName = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][idx];

        let txt = `${colorName}: `;
        if (st.hasFired) {
          const badge = rankBadges[st.rank] || `${st.rank}.`;
          const acc = accTag[st.accuracy] || '';
          const off = st.offsetDeg !== null && st.offsetDeg !== undefined ? `${Math.abs(st.offsetDeg).toFixed(0)}°` : '';
          txt += `${badge} ${acc} (+${st.pointsEarned}P) • ${st.reactionMs}ms ${off}`;
        } else {
          txt += 'BASAMADI (0P)';
        }

        ctx.font = '800 14px "Space Grotesk", monospace';
        ctx.fillStyle = idx === this.roundWinner ? '#D99B26' : '#8A7A70';
        ctx.fillText(txt, cx, yOff);
        yOff += 22;
      });
    }
  }

  renderMatchOver() {
    const { ctx } = this;
    const { cx, cy, size } = this.arena;

    this.uiButtons = [];

    const colorNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
    const champName = colorNames[this.matchWinner];
    const champColor = DUEL_COLORS[this.matchWinner];
    const bestMs = this.playerStatus[this.matchWinner].lastBestMs;

    ctx.font = '900 42px "Space Grotesk", sans-serif';
    ctx.fillStyle = champColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('duel.fastest'), cx, cy - 90, this.arena.width - 24);

    ctx.font = '900 36px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText(t('duel.champIs', champName), cx, cy - 40, this.arena.width - 24);

    if (bestMs) {
      ctx.font = '900 24px "Space Grotesk", monospace';
      ctx.fillStyle = '#D99B26';
      ctx.fillText(t('duel.best', bestMs), cx, cy + 10);
    }

    ctx.font = '800 13px "JetBrains Mono", monospace';
    this.joinedPlayers.forEach((joined, index) => {
      if (!joined) return;
      ctx.fillStyle = DUEL_COLORS[index];
      ctx.fillText(`${colorNames[index]}: ${this.scores[index]} PUAN`, cx, cy + 44 + index * 18);
    });

    // Play Again Button
    const btnW = size * 0.72;
    const btnH = 58;
    const btnX = cx - btnW / 2;
    const btnY = cy + 116;

    ctx.fillStyle = '#D99B26';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FAF8F5';
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.font = '900 19px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#141414';
      ctx.fillText(t('duel.new'), cx, btnY + btnH / 2);

    this.uiButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      onClick: () => this.reset(),
    });
  }

  // 4-Way Rotated Pods with Millisecond Reaction Display & Score
  renderTriggerPads() {
    const { ctx } = this;

    this.triggerPads.forEach((pad) => {
      const idx = pad.playerIndex;
      if (!this.joinedPlayers[idx]) return;

      const st = this.playerStatus[idx];
      const hasFired = st.hasFired;
      const falseStart = st.falseStart;

      ctx.save();
      ctx.translate(pad.cx, pad.cy);
      ctx.rotate(pad.rotation);

      let bgColor = this.getPlayerColor(idx);
      let borderColor = '#FAF8F5';

      if (falseStart) {
        bgColor = '#E63946';
      } else if (hasFired) {
        bgColor =
          st.accuracy === 'TAM' ? '#D99B26'
          : st.accuracy === 'SIYIRMA' ? '#2D6A4F'
          : st.accuracy === 'BLOKE' ? '#9D0208'
          : '#5C5C5C';
      }

      // Brutalist Drop Shadow
      ctx.fillStyle = '#000000';
      ctx.fillRect(-pad.w / 2 + 3, -pad.h / 2 + 3, pad.w, pad.h);

      // Pad Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);

      ctx.lineWidth = hasFired ? 4 : 3;
      ctx.strokeStyle = borderColor;
      ctx.strokeRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);

      // Player Label & Score
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
      const botTag = this.isBotSlot(idx) ? '🤖' : '';
      ctx.fillText(`${botTag}${DUEL_NAMES[idx]} // ${this.scores[idx] || 0}★`, 0, -14);

      // State Action / Reaction
      let actionText = pad.label;
      if (this.state === 'STANDOFF_COUNTDOWN' || this.state === 'TENSION') {
        actionText = this.isBlockerClosed() ? t('duel.blockedWait') : t('duel.tapWait');
      } else if (this.state === 'DRAW_SIGNAL') {
        if (hasFired) {
          const short = st.accuracy === 'TAM' ? '🎯' : st.accuracy === 'SIYIRMA' ? '↗' : st.accuracy === 'BLOKE' ? '🌵' : '💨';
          actionText = `${short} ${st.reactionMs}ms (+${st.pointsEarned}P)`;
        } else {
          actionText = this.isBlockerClosed() ? t('duel.blockWait') : t('duel.smash');
        }
      } else if (this.state === 'ROUND_OVER') {
        if (falseStart) actionText = t('duel.early');
        else if (hasFired) {
          const short = st.accuracy === 'TAM' ? '🎯' : st.accuracy === 'SIYIRMA' ? '↗' : st.accuracy === 'BLOKE' ? '🌵' : '💨';
          actionText = `${short} ${st.rank}. (${st.reactionMs}ms)`;
        } else actionText = t('duel.late');
      }

      ctx.font = '900 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText(actionText, 0, 14);

      ctx.restore();
    });
  }

  renderParticles() {
    const { ctx } = this;

    // Laser Bullet Tracers
    this.bulletTracers.forEach((b) => {
      ctx.save();
      const alpha = Math.max(0, b.life / 0.55);
      ctx.globalAlpha = alpha;

      ctx.strokeStyle = b.color || '#FFDE59';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();

      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();

      ctx.restore();
    });

    this.smokeParticles.forEach((p) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fill();
      ctx.restore();
    });
  }
}
