// QUICK DRAW (Game 06): 2-4 Player Wild West Reflex Duel (Brutal Party // 4P)
// Tap on Signal ("İlk Basan Kazanır") with dynamic 2/3/4 player scoring, false start penalties,
// millisecond reaction timer, and 4-way rotated player pods.

import {
  playStart,
  playJoin,
  playGunshot,
  playDrawTension,
  playStumble,
  playCashRegister,
  playFakeoutCrow,
} from './audio.js';
import { renderControlGuide } from './controlGuide.js';

export const DUEL_COLORS = ['#8C4830', '#1F4E5B', '#C08552', '#3E5C76'];
export const DUEL_NAMES = ['KOVBOY 1', 'KOVBOY 2', 'KOVBOY 3', 'KOVBOY 4'];

export class DuelGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // States: 'LOBBY', 'STANDOFF_COUNTDOWN', 'TENSION', 'DRAW_SIGNAL', 'ROUND_OVER', 'MATCH_OVER'
    this.state = 'LOBBY';

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
    }));
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (this.keys[code]) return;
      this.keys[code] = true;

      // P0: Space or ArrowDown or KeyS
      if (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') {
        this.handlePlayerTap(0);
      }
      // P1: ArrowUp or KeyW
      if (code === 'ArrowUp' || code === 'KeyW') {
        this.handlePlayerTap(1);
      }
      // P2: ArrowLeft or KeyA
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.handlePlayerTap(2);
      }
      // P3: ArrowRight or KeyD
      if (code === 'ArrowRight' || code === 'KeyD') {
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
        sublabel: 'OYUNCU 1',
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
        sublabel: 'OYUNCU 2',
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
        sublabel: 'OYUNCU 3',
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
        sublabel: 'OYUNCU 4',
      },
    ];
  }

  getActivePlayerCount() {
    return this.joinedPlayers.filter((j) => j).length;
  }

  togglePlayerJoin(index) {
    playJoin();
    this.joinedPlayers[index] = !this.joinedPlayers[index];
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

    // Reset round statuses
    this.playerStatus.forEach((p) => {
      p.hasFired = false;
      p.falseStart = false;
      p.reactionMs = null;
      p.rank = 0;
      p.pointsEarned = 0;
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

    // 2. TAP ON SIGNAL -> RECORD MILLISECOND REACTION & SCORE
    if (this.state === 'DRAW_SIGNAL') {
      if (st.hasFired || st.falseStart) return;

      st.hasFired = true;
      st.reactionMs = Math.max(1, Math.round(performance.now() - this.signalTime));

      const activeCount = this.getActivePlayerCount();
      const firedCount = this.playerStatus.filter((p) => p.hasFired).length;
      st.rank = firedCount;

      const pts = this.getPointsForRank(firedCount, activeCount);
      st.pointsEarned = pts;
      this.scores[playerIdx] += pts;

      // First to draw (Champion of this round!)
      if (firedCount === 1) {
        this.roundWinner = playerIdx;
        playGunshot();
        playCashRegister();
        this.trauma = 0.6;
        this.drawWindowTimer = 1.1; // Allow remaining players 1.1s to tap for 2nd/3rd place

        // Record checks
        if (st.reactionMs < this.tableRecordMs) {
          this.tableRecordMs = st.reactionMs;
        }
        if (st.lastBestMs === null || st.reactionMs < st.lastBestMs) {
          st.lastBestMs = st.reactionMs;
        }

        // Bullet Tracer from Winner Pad to Arena Center
        const pad = this.triggerPads[playerIdx];
        if (pad) {
          this.bulletTracers.push({
            x1: pad.cx,
            y1: pad.cy,
            x2: this.arena.cx,
            y2: this.arena.cy,
            life: 0.45,
            color: DUEL_COLORS[playerIdx],
          });
        }
      } else {
        // Runner up hit
        playGunshot();
      }

      // If all active players have fired, end round immediately
      const allFired = this.playerStatus.filter((p, i) => this.joinedPlayers[i] && p.hasFired).length === activeCount;
      if (allFired) {
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
      for (const btn of this.uiButtons) {
        if (
          pos.x >= btn.x &&
          pos.x <= btn.x + btn.w &&
          pos.y >= btn.y &&
          pos.y <= btn.y + btn.h
        ) {
          btn.onClick();
          return;
        }
      }
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

      // Heartbeat pulse every 0.8s
      if (this.tensionAudioTimer >= 0.8) {
        this.tensionAudioTimer = 0;
        playDrawTension();
      }

      // Psychological Fakeout Cue
      if (this.hasFakeout && !this.fakeoutFired && this.tensionTimer <= this.fakeoutTriggerTime) {
        this.fakeoutFired = true;
        this.fakeoutDisplayTimer = 0.6;
        playFakeoutCrow();
      }

      if (this.fakeoutDisplayTimer > 0) {
        this.fakeoutDisplayTimer -= dt;
      }

      if (this.tensionTimer <= 0) {
        this.triggerDrawSignal();
      }
    }

    // DRAW SIGNAL STATE (Multi-tap reaction window)
    if (this.state === 'DRAW_SIGNAL') {
      if (this.drawWindowTimer > 0) {
        this.drawWindowTimer -= dt;
        if (this.drawWindowTimer <= 0) {
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
    if (this.trauma > 0) {
      const shakeX = (Math.random() - 0.5) * this.trauma * 24;
      const shakeY = (Math.random() - 0.5) * this.trauma * 24;
      ctx.translate(shakeX, shakeY);
    }

    // Vintage Saloon Sandstone / Dark background
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, width, height);

    // Draw Western Arena
    this.renderArena();

    // Draw Particles
    this.renderParticles();

    // State Renderings
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'SİNYALDE İLK BASAN KAZANIR • ERKEN BASAN -1 PUAN', [
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
      // Central Watermark
      ctx.font = 'bold 36px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#2A2420';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ 06 // KOVBOY DÜELLOSU ⚡', cx, cy - size * 0.38);

      // Scoreboard at Top Center
      this.renderScoreboard();
    }
  }

  renderScoreboard() {
    const { ctx } = this;
    const { cx, top } = this.arena;

    ctx.save();
    ctx.translate(cx, top + 26);

    const pillW = 360;
    const pillH = 34;

    ctx.fillStyle = '#0F0D0C';
    ctx.fillRect(-pillW / 2, -pillH / 2, pillW, pillH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#C08552';
    ctx.strokeRect(-pillW / 2, -pillH / 2, pillW, pillH);

    ctx.font = '900 12px "Space Grotesk", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const colorNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
    let scoreText = '';
    this.joinedPlayers.forEach((joined, idx) => {
      if (joined) {
        scoreText += `${colorNames[idx]}: ${this.scores[idx]}P   `;
      }
    });
    scoreText += `[HEDEF: ${this.targetScore}P]  ⚡REKOR: ${this.tableRecordMs}ms`;

    ctx.fillStyle = '#D99B26';
    ctx.fillText(scoreText.trim(), 0, 0);

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
    ctx.fillText('KOVBOY DÜELLOSU', cx, titleY);

    ctx.font = '700 14px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#D99B26';
    ctx.fillText('İLK BASAN KAZANIR • ERKEN BASAN -1 PUAN ALIR', cx, titleY + 30);

    // Scoring Breakdown Badge
    const activeCount = this.getActivePlayerCount();
    let scoringRuleText = '';
    if (activeCount === 2) scoringRuleText = 'PUANLAMA (2P): 1. = +2 PUAN | 2. = 0 PUAN';
    else if (activeCount === 3) scoringRuleText = 'PUANLAMA (3P): 1. = +3 PUAN | 2. = +1 PUAN | 3. = 0 PUAN';
    else scoringRuleText = 'PUANLAMA (4P): 1. = +3 PUAN | 2. = +2 PUAN | 3. = +1 PUAN';

    ctx.font = '800 12px "Space Grotesk", monospace';
    ctx.fillStyle = '#FFDE59';
    ctx.fillText(scoringRuleText, cx, titleY + 54);
    ctx.restore();

    // 2x2 Player Slot Cards
    const totalGridW = Math.min(size * 0.88, 380);
    const totalGridH = Math.min(size * 0.36, 120);
    const btnW = (totalGridW - 14) / 2;
    const btnH = (totalGridH - 12) / 2;
    const gridLeft = cx - totalGridW / 2;
    const gridTop = cy - 20;

    const slotConfigs = [
      { idx: 0, x: gridLeft, y: gridTop, posLabel: 'ALT' },
      { idx: 1, x: gridLeft + btnW + 14, y: gridTop, posLabel: 'ÜST' },
      { idx: 2, x: gridLeft, y: gridTop + btnH + 12, posLabel: 'SOL' },
      { idx: 3, x: gridLeft + btnW + 14, y: gridTop + btnH + 12, posLabel: 'SAĞ' },
    ];

    slotConfigs.forEach((cfg) => {
      const isJoined = this.joinedPlayers[cfg.idx];
      const color = DUEL_COLORS[cfg.idx];

      ctx.save();
      // Drop Shadow
      ctx.fillStyle = '#000000';
      ctx.fillRect(cfg.x + 3, cfg.y + 3, btnW, btnH);

      // Fill
      ctx.fillStyle = isJoined ? color : '#1F1B18';
      ctx.fillRect(cfg.x, cfg.y, btnW, btnH);

      // Border
      ctx.lineWidth = isJoined ? 3 : 2;
      ctx.strokeStyle = isJoined ? '#FAF8F5' : '#42362E';
      ctx.strokeRect(cfg.x, cfg.y, btnW, btnH);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.font = '800 10px "Space Grotesk", sans-serif';
      ctx.fillStyle = isJoined ? 'rgba(255,255,255,0.85)' : '#7A6B62';
      ctx.fillText(`OYUNCU ${cfg.idx + 1}: ${cfg.posLabel}`, cfg.x + btnW / 2, cfg.y + 14);

      ctx.font = '900 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = isJoined ? '#FAF8F5' : '#D99B26';
      ctx.fillText(isJoined ? '✓ HAZIR' : '+ KATIL', cfg.x + btnW / 2, cfg.y + 33);
      ctx.restore();

      this.uiButtons.push({
        x: cfg.x,
        y: cfg.y,
        w: btnW,
        h: btnH,
        onClick: () => this.togglePlayerJoin(cfg.idx),
      });
    });

    // Start Button
    const canStart = activeCount >= 2;
    const startX = gridLeft;
    const startY = gridTop + totalGridH + 20;
    const startW = totalGridW;
    const startH = Math.min(56, Math.max(48, Math.floor(size * 0.11)));

    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 4, startY + 4, startW, startH);

    ctx.fillStyle = canStart ? '#D99B26' : '#221E1B';
    ctx.fillRect(startX, startY, startW, startH);

    ctx.lineWidth = canStart ? 4 : 2;
    ctx.strokeStyle = canStart ? '#FAF8F5' : '#45382F';
    ctx.strokeRect(startX, startY, startW, startH);

    ctx.font = '900 17px "Space Grotesk", sans-serif';
    ctx.fillStyle = canStart ? '#141414' : '#6A5B52';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      canStart ? `🤠 DÜELLOYU BAŞLAT (${activeCount} KOVBOY)` : '⚠️ EN AZ 2 OYUNCU KATILMALI',
      startX + startW / 2,
      startY + startH / 2
    );
    ctx.restore();

    if (canStart) {
      this.uiButtons.push({
        x: startX,
        y: startY,
        w: startW,
        h: startH,
        onClick: () => this.startMatch(),
      });
    }

    // Instructions
    const rulesY = startY + startH + 20;
    ctx.save();
    ctx.font = '800 12px "Space Grotesk", monospace';
    ctx.fillStyle = '#A8998C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DİKKAT: "ATEŞ!" DENDİĞİ AN KENDİ PADİNE İLK SEN DOKUN!', cx, rulesY);

    ctx.font = '700 11px "Space Grotesk", monospace';
    ctx.fillStyle = '#E76F51';
    ctx.fillText('ERKEN BASARSAN 1 PUAN KAYBEDERSİN!', cx, rulesY + 18);
    ctx.restore();
  }

  renderCountdown() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    ctx.font = '900 40px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#D99B26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ELLER HAZIR!...', cx, cy - 20);

    ctx.font = '700 16px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText('SİNYALİ BEKLEYİN, SAKIN DOKUNMAYIN!', cx, cy + 28);
  }

  renderTension() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    if (this.fakeoutDisplayTimer > 0) {
      // Psychological Bluff
      ctx.font = '900 44px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#E76F51';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚠️ ...DİKKAT! BEKLE!... ⚠️', cx, cy - 20);

      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#FFDE59';
      ctx.fillText('BLÖF! SİNYALİ BEKLE, ERKEN BASAN -1 PUAN ALIR!', cx, cy + 30);
    } else {
      const pulse = Math.sin(performance.now() * 0.01) * 0.5 + 0.5;

      ctx.font = '900 52px "Space Grotesk", sans-serif';
      ctx.fillStyle = pulse > 0.5 ? '#E63946' : '#FAF8F5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('KIPIRDAMA!...', cx, cy - 20);

      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#C08552';
      ctx.fillText('ERKEN DOKUNAN FAUL YAPAR (-1 PUAN)!', cx, cy + 32);
    }
  }

  renderDrawSignal() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    // Huge DRAW banner
    ctx.font = '900 84px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#D99B26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💥 ATEŞ! 💥', cx, cy - 10);

    ctx.font = '900 24px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText('HEMEN DOKUN! İLK BASAN KAZANIR!', cx, cy + 55);
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
      ctx.fillText('❌ FAUL! ERKEN BASILDI! ❌', cx, cy - 40);

      ctx.font = '900 20px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText(`${offenderName} ERKEN BASTI (-1 PUAN CEZA)`, cx, cy);

      ctx.font = '700 15px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#D99B26';
      ctx.fillText('DEVAM ETMEK İÇİN EKRANA DOKUNUN', cx, cy + 45);
    } else if (this.roundWinner !== null && this.roundWinner >= 0) {
      const winnerName = DUEL_NAMES[this.roundWinner];
      const winMs = this.playerStatus[this.roundWinner].reactionMs;

      ctx.font = '900 36px "Space Grotesk", sans-serif';
      ctx.fillStyle = DUEL_COLORS[this.roundWinner];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚡ ${winnerName} VURDU! ⚡`, cx, cy - 48);

      ctx.font = '900 44px "Space Grotesk", monospace';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText(`${winMs} MS`, cx, cy);

      // Score breakdown list
      let yOff = cy + 44;
      const rankBadges = ['', '🥇 1.', '🥈 2.', '🥉 3.', '4.'];

      this.joinedPlayers.forEach((joined, idx) => {
        if (!joined) return;
        const st = this.playerStatus[idx];
        const colorName = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][idx];

        let txt = `${colorName}: `;
        if (st.hasFired) {
          const badge = rankBadges[st.rank] || `${st.rank}.`;
          txt += `${badge} (+${st.pointsEarned}P) • ${st.reactionMs} ms`;
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
    ctx.fillText('👑 KASABANIN EN HIZLISI 👑', cx, cy - 90);

    ctx.font = '900 36px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText(`${champName} // ŞAMPİYON!`, cx, cy - 40, this.arena.width - 24);

    if (bestMs) {
      ctx.font = '900 24px "Space Grotesk", monospace';
      ctx.fillStyle = '#D99B26';
      ctx.fillText(`EN İYİ REFLEKS: ${bestMs} MS`, cx, cy + 10);
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
    ctx.fillText('🔄 YENİ DÜELLO OYNA', cx, btnY + btnH / 2);

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

      let bgColor = DUEL_COLORS[idx];
      let borderColor = '#FAF8F5';

      if (falseStart) {
        bgColor = '#E63946';
      } else if (hasFired) {
        bgColor = st.rank === 1 ? '#D99B26' : '#2D6A4F';
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

      // Player Label + Score Header
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '900 12px "Space Grotesk", monospace';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.fillText(`${DUEL_NAMES[idx]} [${this.scores[idx]} PUAN]`, 0, -14);

      // State Action / Reaction
      let actionText = pad.label;
      if (this.state === 'STANDOFF_COUNTDOWN' || this.state === 'TENSION') {
        actionText = '✋ DOKUNMA! BEKLE';
      } else if (this.state === 'DRAW_SIGNAL') {
        if (hasFired) {
          actionText = `✓ ${st.reactionMs} ms (+${st.pointsEarned}P)`;
        } else {
          actionText = '💥 BAS! BAS!';
        }
      } else if (this.state === 'ROUND_OVER') {
        if (falseStart) actionText = '❌ ERKEN BASTIN (-1P)';
        else if (hasFired) actionText = `${st.rank}. SIRA (${st.reactionMs} ms)`;
        else actionText = 'GEÇ KALDIN!';
      }

      ctx.font = '900 15px "Space Grotesk", sans-serif';
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
      const alpha = Math.max(0, b.life / 0.45);
      ctx.globalAlpha = alpha;

      ctx.strokeStyle = '#FFDE59';
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
