// QUICK DRAW (Game 06): 2-4 Player Wild West Reflex Duel (Pure Human Tension)
// No bots - millisecond precision reaction timing, holster hold & release, false start disqualification

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

    // States: 'LOBBY', 'HOLSTER_WAIT', 'TENSION', 'DRAW_SIGNAL', 'ROUND_OVER', 'MATCH_OVER'
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
    };

    // Active human player slots (Index 0..3: Bottom, Top, Left, Right)
    // Default: P0 (Bottom) and P1 (Top) joined
    this.joinedPlayers = [true, true, false, false];

    // Tournament Scoring
    this.targetWins = 3; // First to 3 round wins is Champion!
    this.wins = [0, 0, 0, 0];
    this.roundWinner = null;
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
    this.tensionTimer = 0; // Countdown until DRAW
    this.tensionDuration = 0;
    this.tensionAudioTimer = 0;
    this.roundEndTimer = 0;

    // Per-player round state:
    // isHolding: boolean (finger on holster)
    // touchId: id of touch holding
    // hasFired: boolean
    // falseStart: boolean
    // reactionMs: number | null
    // rank: number (1 = winner, 2 = runner up, etc.)
    this.playerStatus = this.createInitialPlayerStatus();

    // Flash & Camera Shake
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
      isHolding: false,
      touchId: null,
      hasFired: false,
      falseStart: false,
      reactionMs: null,
      rank: 0,
      lastBestMs: null,
    }));
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const code = e.code;
      if (this.keys[code]) return; // Avoid repeat
      this.keys[code] = true;

      // P0: Space or ArrowDown or KeyS
      if (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') {
        this.handlePlayerHoldStart(0, 'key_p0');
      }
      // P1: ArrowUp or KeyW
      if (code === 'ArrowUp' || code === 'KeyW') {
        this.handlePlayerHoldStart(1, 'key_p1');
      }
      // P2: ArrowLeft or KeyA
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.handlePlayerHoldStart(2, 'key_p2');
      }
      // P3: ArrowRight or KeyD
      if (code === 'ArrowRight' || code === 'KeyD') {
        this.handlePlayerHoldStart(3, 'key_p3');
      }
    });

    window.addEventListener('keyup', (e) => {
      const code = e.code;
      this.keys[code] = false;

      // P0 release
      if (code === 'Space' || code === 'ArrowDown' || code === 'KeyS') {
        this.handlePlayerHoldEnd(0, 'key_p0');
      }
      // P1 release
      if (code === 'ArrowUp' || code === 'KeyW') {
        this.handlePlayerHoldEnd(1, 'key_p1');
      }
      // P2 release
      if (code === 'ArrowLeft' || code === 'KeyA') {
        this.handlePlayerHoldEnd(2, 'key_p2');
      }
      // P3 release
      if (code === 'ArrowRight' || code === 'KeyD') {
        this.handlePlayerHoldEnd(3, 'key_p3');
      }
    });
  }

  resize(width, height) {
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = height > width
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
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
    const padW = Math.min(size * 0.44, 210);
    const padH = Math.min(68, Math.max(50, size * 0.12));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Corner / edge action pads anchored tightly around the arena
    this.triggerPads = [
      // P0: Bottom
      {
        playerIndex: 0,
        x: cx - padW / 2,
        y: Math.min(bottom + 14, viewportHeight - padH - 12),
        w: padW,
        h: padH,
        label: 'KIRMIZI',
        sublabel: 'OYUNCU 1',
      },
      // P1: Top
      {
        playerIndex: 1,
        x: cx - padW / 2,
        y: Math.max(top - padH - 14, 12),
        w: padW,
        h: padH,
        label: 'MAVİ',
        sublabel: 'OYUNCU 2',
      },
      // P2: Left
      {
        playerIndex: 2,
        x: Math.max(left - padW - 14, 12),
        y: cy - padH / 2,
        w: padW,
        h: padH,
        label: 'SARI',
        sublabel: 'OYUNCU 3',
      },
      // P3: Right
      {
        playerIndex: 3,
        x: Math.min(right + 14, viewportWidth - padW - 12),
        y: cy - padH / 2,
        w: padW,
        h: padH,
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
    // Ensure at least 2 players can participate
    if (this.getActivePlayerCount() < 2) {
      // Don't auto-force, but UI will alert
    }
  }

  startMatch() {
    if (this.getActivePlayerCount() < 2) return;
    playStart();
    this.wins = [0, 0, 0, 0];
    this.matchWinner = null;
    this.roundWinner = null;
    this.startNewRound();
  }

  startNewRound() {
    this.state = 'HOLSTER_WAIT';
    this.roundWinner = null;
    this.signalTime = 0;
    this.tensionTimer = 0;
    this.roundEndTimer = 0;
    this.flashOpacity = 0;

    // Reset round statuses
    this.playerStatus.forEach((p, idx) => {
      p.isHolding = false;
      p.touchId = null;
      p.hasFired = false;
      p.falseStart = false;
      p.reactionMs = null;
      p.rank = 0;
    });
  }

  armDuelTension() {
    this.state = 'TENSION';
    // Random delay between 2.2 and 5.2 seconds for intense psychological standoff!
    this.tensionDuration = 2.2 + Math.random() * 3.0;
    this.tensionTimer = this.tensionDuration;
    this.tensionAudioTimer = 0;

    // 45% chance of psychological fakeout cue
    this.hasFakeout = Math.random() < 0.45;
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

  handlePlayerHoldStart(playerIdx, touchId) {
    if (!this.joinedPlayers[playerIdx]) return;
    const st = this.playerStatus[playerIdx];

    if (this.state === 'HOLSTER_WAIT') {
      st.isHolding = true;
      st.touchId = touchId;

      // Check if ALL joined players are now holding their holster
      const allReady = this.joinedPlayers.every((joined, i) => !joined || this.playerStatus[i].isHolding);
      if (allReady) {
        this.armDuelTension();
      }
    } else if (this.state === 'DRAW_SIGNAL') {
      // If someone wasn't holding or taps now during DRAW
      this.handlePlayerFire(playerIdx);
    }
  }

  handlePlayerHoldEnd(playerIdx, touchId) {
    if (!this.joinedPlayers[playerIdx]) return;
    const st = this.playerStatus[playerIdx];

    if (this.state === 'HOLSTER_WAIT') {
      st.isHolding = false;
      st.touchId = null;
    } else if (this.state === 'TENSION') {
      // FALSE START! PLAYER DREW EARLY!
      st.isHolding = false;
      st.touchId = null;
      st.falseStart = true;
      playStumble();

      this.trauma = 0.5;
      this.state = 'ROUND_OVER';
      this.roundEndTimer = 3.2;

      // Award round to the remaining unpenalized active player(s)
      const survivors = [];
      this.joinedPlayers.forEach((joined, i) => {
        if (joined && !this.playerStatus[i].falseStart) {
          survivors.push(i);
        }
      });

      if (survivors.length === 1) {
        this.roundWinner = survivors[0];
        this.wins[this.roundWinner]++;
        playCashRegister();
      } else {
        this.roundWinner = -1; // Multiple survivors or fault reset
      }

      this.checkMatchWin();
    } else if (this.state === 'DRAW_SIGNAL') {
      // AUTHENTIC QUICK DRAW! Releasing finger draws the weapon!
      this.handlePlayerFire(playerIdx);
    }
  }

  handlePlayerFire(playerIdx) {
    const st = this.playerStatus[playerIdx];
    if (st.hasFired || st.falseStart) return;

    st.hasFired = true;
    st.reactionMs = Math.max(1, Math.round(performance.now() - this.signalTime));
    st.isHolding = false;

    // Check rank
    const firedCount = this.playerStatus.filter((p) => p.hasFired).length;
    st.rank = firedCount;

    if (firedCount === 1) {
      // FIRST TO DRAW! WINNER OF THIS ROUND!
      this.roundWinner = playerIdx;
      this.wins[playerIdx]++;
      playGunshot();
      playCashRegister();
      this.trauma = 0.6;
      this.state = 'ROUND_OVER';
      this.roundEndTimer = 3.2;

      // Table Record check
      if (st.reactionMs < this.tableRecordMs) {
        this.tableRecordMs = st.reactionMs;
      }

      if (st.lastBestMs === null || st.reactionMs < st.lastBestMs) {
        st.lastBestMs = st.reactionMs;
      }

      // Laser Bullet Tracer from Winner Pad to Arena Center
      const pad = this.triggerPads[playerIdx];
      if (pad) {
        this.bulletTracers.push({
          x1: pad.x + pad.w / 2,
          y1: pad.y + pad.h / 2,
          x2: this.arena.cx,
          y2: this.arena.cy,
          life: 0.45,
          color: DUEL_COLORS[playerIdx],
        });
      }

      this.checkMatchWin();
    }
  }

  checkMatchWin() {
    this.joinedPlayers.forEach((joined, idx) => {
      if (joined && this.wins[idx] >= this.targetWins) {
        this.state = 'MATCH_OVER';
        this.matchWinner = idx;
        this.roundEndTimer = 0;
      }
    });
  }

  // --- Touch Manager Callbacks ---
  onTouchStart(touch) {
    const pos = { x: touch.x, y: touch.y };

    // Lobby UI Clicks
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

    if (this.state === 'ROUND_OVER') {
      // Any tap advances immediately if timer > 0.6s
      if (this.roundEndTimer < 2.6) {
        this.startNewRound();
        return;
      }
    }

    if (this.state === 'HOLSTER_WAIT' || this.state === 'TENSION' || this.state === 'DRAW_SIGNAL') {
      for (const pad of this.triggerPads) {
        if (
          pos.x >= pad.x &&
          pos.x <= pad.x + pad.w &&
          pos.y >= pad.y &&
          pos.y <= pad.y + pad.h
        ) {
          this.handlePlayerHoldStart(pad.playerIndex, touch.id);
          return;
        }
      }
    }
  }

  onTouchMove(touch) {
    // Keep hold active as long as touch is within reasonable margin of pad
  }

  onTouchEnd(touch) {
    // Check if this touch was holding any trigger pad
    for (const pad of this.triggerPads) {
      const st = this.playerStatus[pad.playerIndex];
      if (st.touchId === touch.id) {
        this.handlePlayerHoldEnd(pad.playerIndex, touch.id);
      }
    }
  }

  onTouchesReset() {
    this.playerStatus.forEach((st, idx) => {
      if (st.isHolding) {
        this.handlePlayerHoldEnd(idx, st.touchId);
      }
    });
  }

  reset() {
    this.wins = [0, 0, 0, 0];
    this.state = 'LOBBY';
    this.roundWinner = null;
    this.matchWinner = null;
    this.smokeParticles = [];
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

    // TENSION STATE: Count down to DRAW signal & Psychological Fakeout
    if (this.state === 'TENSION') {
      this.tensionTimer -= dt;
      this.tensionAudioTimer += dt;

      // Heartbeat pulse every 0.8s during standoff
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

    // ROUND OVER STATE: Auto advance to next round
    if (this.state === 'ROUND_OVER') {
      this.roundEndTimer -= dt;
      if (this.roundEndTimer <= 0) {
        this.startNewRound();
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

    // Background: Vintage Saloon Cream Paper
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, width, height);

    // Draw Wild West Arena (Wood Grain / Sandstone Tone)
    this.renderArena();

    // Draw Particles
    this.renderParticles();

    // State Renderings
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'KONTROL // TETİĞİ BASILI TUT • SİNYALDE BIRAK', [
        'KIRMIZI P1',
        'MAVİ P2',
        'SARI P3',
        'YEŞİL P4',
      ]);
      this.renderLobby();
    } else if (this.state === 'HOLSTER_WAIT') {
      this.renderHolsterWait();
    } else if (this.state === 'TENSION') {
      this.renderTension();
    } else if (this.state === 'DRAW_SIGNAL') {
      this.renderDrawSignal();
    } else if (this.state === 'ROUND_OVER') {
      this.renderRoundOver();
    } else if (this.state === 'MATCH_OVER') {
      this.renderMatchOver();
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

    // Diagonal Hazard Crosshairs (Subtle Standoff lines)
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
      // Central Skull / Revolver Emblem Watermark
      ctx.font = 'bold 36px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#2A2420';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ 06 // KOVBOY DÜELLOSU ⚡', cx, cy - size * 0.38);
    }

    // Scoreboard at Top Center
    if (this.state !== 'LOBBY') {
      this.renderScoreboard();
    }
  }

  renderScoreboard() {
    const { ctx } = this;
    const { cx, top } = this.arena;

    ctx.save();
    ctx.translate(cx, top + 26);

    const activeCount = this.getActivePlayerCount();
    const pillW = 340;
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
        scoreText += `${colorNames[idx]}: ${this.wins[idx]}★   `;
      }
    });
    scoreText += `[HEDEF: ${this.targetWins}]  ⚡REKOR: ${this.tableRecordMs}ms`;

    ctx.fillStyle = '#D99B26';
    ctx.fillText(scoreText.trim(), 0, 0);

    ctx.restore();
  }

  renderLobby() {
    const { ctx, canvas } = this;
    const { cx, cy, size } = this.arena;

    this.uiButtons = [];

    // Title Banner inside Arena
    const badgeY = cy - size * 0.38;
    const titleY = cy - size * 0.28;
    const subtitleY = cy - size * 0.20;

    // Header Badge
    ctx.save();
    ctx.fillStyle = '#2A201A';
    const badgeW = 240;
    const badgeH = 26;
    ctx.fillRect(cx - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#D99B26';
    ctx.strokeRect(cx - badgeW / 2, badgeY - badgeH / 2, badgeW, badgeH);

    ctx.font = '900 11px "Space Grotesk", monospace';
    ctx.fillStyle = '#D99B26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡ 06 // KOVBOY REFLEKS DÜELLOSU ⚡', cx, badgeY);
    ctx.restore();

    // Main Title
    ctx.font = '900 clamp(24px, 4vw, 36px) "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('QUICK DRAW', cx, titleY);

    // Subtitle
    ctx.font = '700 13px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#C08552';
    ctx.fillText('2-4 OYUNCU • KINDA TUT • SİNYALDE ÇEK', cx, subtitleY);

    // Clean 2x2 Player Slots Grid (Zero Collision)
    const btnW = Math.min(210, Math.floor((size - 48) / 2));
    const btnH = Math.min(52, Math.max(44, Math.floor(size * 0.10)));
    const gapX = 14;
    const gapY = 10;
    const totalGridW = btnW * 2 + gapX;
    const gridLeft = cx - totalGridW / 2;

    const row1Y = cy - 48;
    const row2Y = row1Y + btnH + gapY;

    const slotConfigs = [
      { idx: 0, col: 0, rowY: row1Y, posLabel: 'KIRMIZI' },
      { idx: 1, col: 1, rowY: row1Y, posLabel: 'MAVİ' },
      { idx: 2, col: 0, rowY: row2Y, posLabel: 'SARI' },
      { idx: 3, col: 1, rowY: row2Y, posLabel: 'YEŞİL' },
    ];

    slotConfigs.forEach((cfg) => {
      const slotX = gridLeft + cfg.col * (btnW + gapX);
      const slotY = cfg.rowY;
      const isJoined = this.joinedPlayers[cfg.idx];
      const color = DUEL_COLORS[cfg.idx];

      ctx.save();

      // Brutalist Drop Shadow
      ctx.fillStyle = '#000000';
      ctx.fillRect(slotX + 3, slotY + 3, btnW, btnH);

      // Card Background
      ctx.fillStyle = isJoined ? color : '#1F1B18';
      ctx.fillRect(slotX, slotY, btnW, btnH);

      // Card Border
      ctx.lineWidth = isJoined ? 3 : 2;
      ctx.strokeStyle = isJoined ? '#FAF8F5' : '#42362E';
      ctx.strokeRect(slotX, slotY, btnW, btnH);

      // Card Content
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Slot name header (small)
      ctx.font = '800 10px "Space Grotesk", sans-serif';
      ctx.fillStyle = isJoined ? 'rgba(255,255,255,0.75)' : '#7A6B62';
      ctx.fillText(`OYUNCU ${cfg.idx + 1}: ${cfg.posLabel}`, slotX + btnW / 2, slotY + 14);

      // Status label (prominent)
      ctx.font = '900 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = isJoined ? '#FAF8F5' : '#D99B26';
      ctx.fillText(isJoined ? '✓ HAZIR' : '+ KATIL', slotX + btnW / 2, slotY + 33);

      ctx.restore();

      this.uiButtons.push({
        x: slotX,
        y: slotY,
        w: btnW,
        h: btnH,
        onClick: () => this.togglePlayerJoin(cfg.idx),
      });
    });

    // Start Duel Button (Directly below 2x2 Grid, matching grid width)
    const activeCount = this.getActivePlayerCount();
    const canStart = activeCount >= 2;

    const startX = gridLeft;
    const startY = row2Y + btnH + 16;
    const startW = totalGridW;
    const startH = Math.min(58, Math.max(48, Math.floor(size * 0.11)));

    ctx.save();

    // Brutalist Drop Shadow
    ctx.fillStyle = '#000000';
    ctx.fillRect(startX + 4, startY + 4, startW, startH);

    // Button Fill
    ctx.fillStyle = canStart ? '#D99B26' : '#221E1B';
    ctx.fillRect(startX, startY, startW, startH);

    // Button Border
    ctx.lineWidth = canStart ? 4 : 2;
    ctx.strokeStyle = canStart ? '#FAF8F5' : '#45382F';
    ctx.strokeRect(startX, startY, startW, startH);

    // Button Text
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

    // Rules Note (Bottom of Arena)
    const rulesY = startY + startH + 18;
    ctx.save();
    ctx.font = '800 11.5px "Space Grotesk", monospace';
    ctx.fillStyle = '#A8998C';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const isNarrow = this.arena.width < 500;
    ctx.fillText(
      isNarrow ? 'KURAL: BASILI TUT • SİNYALDE BIRAK' : 'KURAL: TETİĞİ BASILI TUT • "ATEŞ!" DENDİĞİ AN EN HIZLI ÇEKEN KAZANIR!',
      cx,
      rulesY
    );

    ctx.font = '700 11px "Space Grotesk", monospace';
    ctx.fillStyle = '#7A6B62';
    ctx.fillText(
      isNarrow ? 'ERKEN ÇEKEN FAUL • PC: P1 SPACE / P2 W' : 'ERKEN ÇEKEN FAUL YAPAR! • PC TEST: P1 [Space/S] • P2 [W/Yukarı Ok]',
      cx,
      rulesY + 18
    );
    ctx.restore();
  }

  renderHolsterWait() {
    const { ctx } = this;
    const { cx, cy, width } = this.arena;
    const isNarrow = width < 500;

    // Big central instruction
    ctx.font = isNarrow ? '900 24px "Space Grotesk", sans-serif' : '900 28px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isNarrow ? 'BASILI TUTUN' : 'SİLAHLARI KININA KOYUN!', cx, cy - 30, width - 24);

    ctx.font = isNarrow ? '700 12px "Space Grotesk", sans-serif' : '700 16px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#D99B26';
    ctx.fillText(isNarrow ? 'RENK PADİNE BASILI TUT' : 'AŞAĞIDAKİ ALANA PARMAĞINIZI BASILI TUTUN', cx, cy + 10, width - 24);

    // Ready Status Counter
    const holdingCount = this.playerStatus.filter((p, i) => this.joinedPlayers[i] && p.isHolding).length;
    const totalJoined = this.getActivePlayerCount();

    ctx.font = isNarrow ? '900 17px "Space Grotesk", monospace' : '900 20px "Space Grotesk", monospace';
    ctx.fillStyle = holdingCount === totalJoined ? '#2D6A4F' : '#E76F51';
    ctx.fillText(`${holdingCount} / ${totalJoined} HAZIR`, cx, cy + 50, width - 24);

    this.renderTriggerPads();
  }

  renderTension() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    if (this.fakeoutDisplayTimer > 0) {
      // Psychological Fakeout Alert
      ctx.font = '900 40px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#E76F51';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚠️ ...DİKKAT! BEKLE!... ⚠️', cx, cy - 20);

      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#FFDE59';
      ctx.fillText('BLÖF! SİNYALİ BEKLE, ERKEN ÇEKEN YANAR!', cx, cy + 30);
    } else {
      // Intense pulsating glow
      const pulse = Math.sin(performance.now() * 0.01) * 0.5 + 0.5;

      ctx.font = '900 48px "Space Grotesk", sans-serif';
      ctx.fillStyle = pulse > 0.5 ? '#E63946' : '#FAF8F5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('KIPIRDAMA!...', cx, cy - 20);

      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#C08552';
      ctx.fillText('SİNYALİ BEKLE... ERKEN ÇEKEN FAUL YAPAR!', cx, cy + 30);
    }

    this.renderTriggerPads();
  }

  renderDrawSignal() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    // Huge Brutalist DRAW banner
    ctx.font = '900 84px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#D99B26';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💥 ATEŞ! 💥', cx, cy - 10);

    ctx.font = '900 22px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText('ÇEK! HEMEN ÇEK!', cx, cy + 55);

    this.renderTriggerPads();
  }

  renderRoundOver() {
    const { ctx } = this;
    const { cx, cy } = this.arena;

    if (this.roundWinner !== null && this.roundWinner >= 0) {
      const winnerName = DUEL_NAMES[this.roundWinner];
      const winMs = this.playerStatus[this.roundWinner].reactionMs;

      ctx.font = '900 36px "Space Grotesk", sans-serif';
      ctx.fillStyle = DUEL_COLORS[this.roundWinner];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚡ ${winnerName} VURDU! ⚡`, cx, cy - 50);

      ctx.font = '900 46px "Space Grotesk", monospace';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText(`${winMs} MS`, cx, cy);

      ctx.font = '700 15px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#D99B26';
      ctx.fillText('ŞİMŞEK KADAR HIZLI!', cx, cy + 42);
    } else {
      ctx.font = '900 36px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#E63946';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('❌ FAUL! ERKEN ÇEKİLDİ! ❌', cx, cy - 30);

      ctx.font = '700 16px "Space Grotesk", sans-serif';
      ctx.fillStyle = '#FAF8F5';
      ctx.fillText('DÜELLO KURALI ÇİĞNENDİ', cx, cy + 16);
    }

    // Reaction times breakdown for all joined players
    let yOff = cy + 78;
    this.joinedPlayers.forEach((joined, idx) => {
      if (!joined) return;
      const st = this.playerStatus[idx];
      const colorName = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][idx];
      let txt = `${colorName}: `;
      if (st.falseStart) {
        txt += 'ERKEN ÇEKİŞ (FAUL)';
      } else if (st.reactionMs !== null) {
        txt += `${st.reactionMs} ms ${idx === this.roundWinner ? '🏆' : ''}`;
      } else {
        txt += 'ÇEKEMEDİ!';
      }

      ctx.font = '700 14px "Space Grotesk", monospace';
      ctx.fillStyle = idx === this.roundWinner ? '#D99B26' : '#8A7A70';
      ctx.fillText(txt, cx, yOff);
      yOff += 24;
    });

    this.renderTriggerPads();
  }

  renderMatchOver() {
    const { ctx } = this;
    const { cx, cy, size } = this.arena;

    this.uiButtons = [];

    const colorNames = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
    const champName = colorNames[this.matchWinner];
    const champColor = DUEL_COLORS[this.matchWinner];
    const bestMs = this.playerStatus[this.matchWinner].lastBestMs;

    ctx.font = '900 44px "Space Grotesk", sans-serif';
    ctx.fillStyle = champColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('👑 KASABANIN EN HIZLISI 👑', cx, cy - 90);

    ctx.font = '900 36px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#FAF8F5';
    ctx.fillText(`${champName} // KAZANDI`, cx, cy - 40, this.arena.width - 24);

    if (bestMs) {
      ctx.font = '900 24px "Space Grotesk", monospace';
      ctx.fillStyle = '#D99B26';
      ctx.fillText(`EN İYİ REFLEKS: ${bestMs} MS`, cx, cy + 10);
    }

    ctx.font = '800 12px "JetBrains Mono", monospace';
    this.joinedPlayers.forEach((joined, index) => {
      if (!joined) return;
      ctx.fillStyle = DUEL_COLORS[index];
      ctx.fillText(`${colorNames[index]}: ${this.wins[index]} GALİBİYET`, cx, cy + 40 + index * 17);
    });

    // Play Again Button
    const btnW = size * 0.72;
    const btnH = 60;
    const btnX = cx - btnW / 2;
    const btnY = cy + 108;

    ctx.fillStyle = '#D99B26';
    ctx.fillRect(btnX, btnY, btnW, btnH);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#FAF8F5';
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.font = '900 20px "Space Grotesk", sans-serif';
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

  renderTriggerPads() {
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') return;

    const { ctx } = this;

    this.triggerPads.forEach((pad) => {
      const idx = pad.playerIndex;
      if (!this.joinedPlayers[idx]) return;

      const st = this.playerStatus[idx];
      const isHolding = st.isHolding;
      const falseStart = st.falseStart;
      const hasFired = st.hasFired;

      ctx.save();

      let bgColor = DUEL_COLORS[idx];
      let borderColor = '#FAF8F5';

      if (falseStart) {
        bgColor = '#E63946';
      } else if (isHolding) {
        bgColor = '#D99B26'; // Holding down
      }

      // Pad Background
      ctx.fillStyle = bgColor;
      ctx.fillRect(pad.x, pad.y, pad.w, pad.h);

      ctx.lineWidth = isHolding ? 5 : 3;
      ctx.strokeStyle = borderColor;
      ctx.strokeRect(pad.x, pad.y, pad.w, pad.h);

      // Pad text
      ctx.font = '900 14px "Space Grotesk", sans-serif';
      ctx.fillStyle = isHolding ? '#141414' : '#FAF8F5';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let stateText = pad.label;
      if (this.state === 'HOLSTER_WAIT') {
        stateText = isHolding ? '✓ TUTUYORSUN' : '✋ BASILI TUT!';
      } else if (this.state === 'TENSION') {
        stateText = isHolding ? 'KIPIRDAMA!' : '⚠️ FAUL!';
      } else if (this.state === 'DRAW_SIGNAL') {
        stateText = hasFired ? `💥 ${st.reactionMs} ms` : '⚡ ÇEK! ÇEK!';
      } else if (this.state === 'ROUND_OVER') {
        if (falseStart) stateText = '❌ FAUL!';
        else if (hasFired) stateText = `${st.reactionMs} ms`;
        else stateText = 'GEÇ KALDIN!';
      }

      ctx.fillText(stateText, pad.x + pad.w / 2, pad.y + pad.h / 2);

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

      // Outer gold glow
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(b.x1, b.y1);
      ctx.lineTo(b.x2, b.y2);
      ctx.stroke();

      // Core white laser beam
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
