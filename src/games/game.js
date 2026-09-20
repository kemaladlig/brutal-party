// Core Game Engine: Arena with Corner Bumpers & Goal Mouths, Lobby, Fixed Physics Loop & Brutalist Rendering
import { Paddle, PLAYER_CONFIGS } from './paddle.js';
import { Ball } from './ball.js';
import { playJoin, playStart, playPowerUp } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard, getStandardSeatSize, renderLobbyStartButton } from '../controlGuide.js';
import { renderCornerScores } from '../ui/hud.js';
import { renderRoundBanner, renderMatchOver } from '../ui/hud.js';
import { BaseMiniGame } from '../core/BaseGame.js';

export class Game extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // States: 'LOBBY', 'PLAYING', 'ROUND_PAUSE', 'MATCH_OVER'
    this.state = 'LOBBY';

    // Arena geometry (responsive rectangle)
    this.arena = {
      cx: 0,
      cy: 0,
      width: 0,
      height: 0,
      size: 0,
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
      cornerChamfer: 0,
      bumperRatio: 0.10,
      getGoalBounds: (side) => this.getGoalBounds(side),
    };

    // Entities
    this.paddles = PLAYER_CONFIGS.map((cfg) => new Paddle(cfg, this));
    this.ball = new Ball(this);

    // Screen shake / trauma (0.0 to 1.0)
    this.trauma = 0;

    // Timing & Fixed Physics Step (120Hz)
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.fixedStep = 1 / 120;

    // State Timers
    this.roundPauseTimer = 0;
    this.winner = null;

    // Interactive UI Rectangles
    this.uiButtons = [];

    // Assigned touch identifier for each player (0: Bottom, 1: Top, 2: Left, 3: Right)
    this.playerTouchIds = [-1, -1, -1, -1];
    // 🌀 Falso skill: oyuncu başına bekleme + çift-dokun takibi
    this.spinCooldowns = [0, 0, 0, 0];
    this.lastTapIdx = -1;
    this.lastTapTime = 0;
    // PC klavye durumu (P1 WASD, P2 oklar, P3 IJKL, P4 TFGH)
    this.keys = {};
    this.initKeyboard();
    this.matchScores = [0, 0, 0, 0];

    // Tournament Set Championship
    this.targetSets = 3;
    this.setScores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.roundOverTimer = 0;
  }

  resetCurrentGame() {
    this.state = 'LOBBY';
    this.winner = null;
    this.roundWinner = null;
    this.roundOverTimer = 0;
    this.roundPauseTimer = 0;
    this.trauma = 0;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.playerTouchIds = [-1, -1, -1, -1];
    this.spinCooldowns = [0, 0, 0, 0];
    this.stallTimer = 0;
    this.rallyStallT = 0;
    this.lastRallySeen = 0;
    this.setScores = [0, 0, 0, 0];
    this.matchScores = [0, 0, 0, 0];
    this.paddles.forEach((p) => {
      p.reset(p.isJoined);
      p.updateLayout(this.arena);
    });
    this.ball.reset(this.arena.cx, this.arena.cy);
  }

  resetMatch() {
    this.resetCurrentGame();
  }

  reset() {
    this.resetCurrentGame();
  }

  restartRound() {
    const joined = this.paddles.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.state = 'ROUND_PAUSE';
    this.roundPauseTimer = 0.9;
    this.winner = null;
    this.roundWinner = null;
    this.paddles.forEach((p) => {
      p.reset(p.isJoined);
      p.updateLayout(this.arena);
    });
    this.ball.x = this.arena.cx;
    this.ball.y = this.arena.cy;
    this.ball.vx = 0;
    this.ball.vy = 0;
    if (this.ball) this.ball.spin = 0;
  }

  initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (!this.isLocalInputActive) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      this.keys[e.code] = true;
      // Aksiyon tuşları: 🌀 falso (basımda bir kez)
      if (e.code === 'Space') this.triggerSpin(0);
      else if (e.code === 'Enter') this.triggerSpin(1);
      else if (e.code === 'KeyO') this.triggerSpin(2);
      else if (e.code === 'KeyB') this.triggerSpin(3);
    });
    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });
  }

  // 🌀 Falso skill: 20 sn bekleme, 6 sn kurulu pencere — bu sırada topa
  // değersen teğetsel vuruş x3 + top ~2 sn kavis çizer. Kullanılmazsa söner.
  triggerSpin(index) {
    if (this.state !== 'PLAYING') return false;
    const p = this.paddles[index];
    if (!p || !p.isJoined || p.isEliminated) return false;
    if (this.spinCooldowns[index] > 0) return false;
    if (!this.ball || this.ball.isDead) return false;
    p.spinCharge = 6.0;
    this.spinCooldowns[index] = 20;
    playPowerUp();
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate([25, 35]);
    return true;
  }

  // Lokal klavye: her slot kendi ekseninde sürer (bot/ölü/katılmamış etkilenmez)
  applyKeyboardControls(dt) {
    if (this.state !== 'PLAYING') return;
    const minDim = Math.min(this.arena.width, this.arena.height);
    const speed = minDim * 1.5;
    const K = this.keys;
    const dirs = [
      (K.KeyA ? -1 : 0) + (K.KeyD ? 1 : 0),
      (K.ArrowLeft ? -1 : 0) + (K.ArrowRight ? 1 : 0),
      (K.KeyI ? -1 : 0) + (K.KeyK ? 1 : 0),
      (K.KeyT ? -1 : 0) + (K.KeyG ? 1 : 0),
    ];
    this.paddles.forEach((p, i) => {
      if (!p.isJoined || p.isEliminated || p.isBot) return;
      const d = dirs[i];
      if (d) p.setTarget(p.targetCoord + d * speed * dt);
    });
  }

  getGoalBounds(side) {
    const isHorizontal = side === 'bottom' || side === 'top';
    // Kale açıklığı kendi kenarına oranlı: her duvarda %62 açık, her aspect'te adil.
    // (Eskiden minDim*0.70 sabitti; kısa kenar orantısız geniş kale açıyordu.)
    const edgeLen = isHorizontal ? this.arena.width : this.arena.height;
    const goalSpan = Math.round(edgeLen * 0.62);
    const center = isHorizontal ? this.arena.cx : this.arena.cy;
    return {
      goalMin: center - goalSpan / 2,
      goalMax: center + goalSpan / 2,
      goalSpan,
    };
  }

  // Köşe pahı bacağı (fizik + dikiş çizgisi aynı değerden beslenir).
  // Portrait'te duvarlar uzadığı için oran bumperRatio'dan gelir (ölü koddu, bağlandı).
  getChamferLeg() {
    const minDim = Math.min(this.arena.width, this.arena.height);
    return Math.round(minDim * (this.arena.bumperRatio || 0.085));
  }

  getPlayerZoneAt(point) {
    const { cx, cy, width, height } = this.arena;
    const w = width || window.innerWidth;
    const h = height || window.innerHeight;

    // In 2-player game (Bottom vs Top), simple vertical split
    const hasSidePlayers = (this.paddles[2] && this.paddles[2].isJoined) ||
                           (this.paddles[3] && this.paddles[3].isJoined);

    if (!hasSidePlayers && this.state === 'PLAYING') {
      return point.y > cy ? 0 : 1;
    }

    // Proportional normalized sector split across rectangular arena
    const nx = (point.x - cx) / (w * 0.5);
    const ny = (point.y - cy) / (h * 0.5);

    if (Math.abs(ny) >= Math.abs(nx)) {
      return ny > 0 ? 0 : 1; // 0: Bottom (P1), 1: Top (P2)
    } else {
      return nx < 0 ? 2 : 3; // 2: Left (P3), 3: Right (P4)
    }
  }

  onTouchStart(touch) {
    // 1. UI interactions (Center BAŞLAT / Restart buttons)
    const handled = this.handleUiTap(touch);
    if (handled) return;

    // 2. Generous Lobby Join: Touching anywhere in a player's region toggles their join status!
    if (this.state === 'LOBBY') {
      const playerIndex = this.getPlayerZoneAt(touch);
      if (playerIndex !== -1) {
        this.togglePlayerJoin(playerIndex);
        return;
      }
    }

    // 3. In Gameplay: lock touch.id to player zone (+ çift-dokun = 🌀)
    if (this.state === 'PLAYING') {
      const playerIndex = this.getPlayerZoneAt(touch);
      if (playerIndex !== -1 && this.isPlayerActive(playerIndex)) {
        const now = performance.now();
        if (playerIndex === this.lastTapIdx && now - this.lastTapTime < 320) {
          this.triggerSpin(playerIndex);
        }
        this.lastTapIdx = playerIndex;
        this.lastTapTime = now;
        this.playerTouchIds[playerIndex] = touch.id;
        this.updatePaddlePosition(playerIndex, touch);
      }
    }
  }

  onTouchMove(touch) {
    if (this.state !== 'PLAYING') return;
    for (let p = 0; p < 4; p++) {
      if (this.playerTouchIds[p] === touch.id) {
        this.updatePaddlePosition(p, touch);
        break;
      }
    }
  }

  onTouchEnd(touch) {
    for (let p = 0; p < 4; p++) {
      if (this.playerTouchIds[p] === touch.id) {
        this.playerTouchIds[p] = -1;
        break;
      }
    }
  }

  onTouchesReset() {
    this.playerTouchIds = [-1, -1, -1, -1];
  }

  updatePaddlePosition(playerIndex, pos) {
    const paddle = this.paddles[playerIndex];
    if (!paddle) return;
    if (paddle.axis === 'horizontal') {
      paddle.setTarget(pos.x);
    } else {
      paddle.setTarget(pos.y);
    }
  }

  isPlayerActive(index) {
    const p = this.paddles[index];
    // Klavye yoluyla aynı kapı (applyKeyboardControls): bot/ölü/katılmamış
    // dokunmatikle de sürülemez
    return p && p.isJoined && !p.isEliminated && !p.isBot;
  }

  getActivePlayerCount() {
    return this.paddles.filter((p) => p.isJoined && !p.isEliminated).length;
  }

  getJoinedPlayerCount() {
    return this.paddles.filter((p) => p.isJoined).length;
  }

  resize(width, height) {
    const oldArena = { ...this.arena };
    const isPortrait = height > width;
    const marginX = Math.max(12, Math.floor(width * 0.04));
    const marginY = isPortrait
      ? Math.max(48, Math.floor(height * 0.12))
      : Math.max(32, Math.floor(height * 0.06));
    const arenaW = width - marginX * 2;
    const arenaH = height - marginY * 2;

    this.arena.cx = width / 2;
    this.arena.cy = height / 2;
    this.arena.width = arenaW;
    this.arena.height = arenaH;
    this.arena.size = Math.min(arenaW, arenaH);
    this.arena.left = marginX;
    this.arena.right = marginX + arenaW;
    this.arena.top = marginY;
    this.arena.bottom = marginY + arenaH;

    // Bumper ratio – portrait has taller walls so opening must be proportionally wider
    this.arena.bumperRatio = isPortrait ? 0.09 : 0.10;

    // Update paddle bounds to fit new goal mouth
    this.paddles.forEach((paddle) => paddle.updateLayout(this.arena));

    // Dynamically scale ball speed to arena dimensions
    if (this.ball) {
      this.ball.scaleToArena(this.arena);
    }

    if (this.state === 'LOBBY' || this.state === 'ROUND_PAUSE') {
      this.ball.x = this.arena.cx;
      this.ball.y = this.arena.cy;
    } else if (this.ball) {
      // Maç ortası: top orantılı taşınır, hız korunur
      this.remapPoint(this.ball, oldArena, this.arena);
    }
  }

  togglePlayerJoin(index) {
    if (this.requestLobbySeatTap(index)) return;
    const p = this.paddles[index];
    p.cycleSlotType();
    playJoin();
  }

  // Registry standardı: tüm motorlar startNewMatch() ile çalışır.
  startNewMatch() {
    this.startGame();
  }

  startGame() {
    const joined = this.paddles.filter((p) => p.isJoined);
    if (joined.length < 2) return;

    this.state = 'ROUND_PAUSE';
    this.roundPauseTimer = 1.4;
    this.winner = null;
    this.roundWinner = null;
    this.roundOverTimer = 0;
    this.setScores = [0, 0, 0, 0];

    this.paddles.forEach((p) => {
      p.reset(p.isJoined);
      p.updateLayout(this.arena);
    });

    this.ball.x = this.arena.cx;
    this.ball.y = this.arena.cy;
    this.ball.vx = 0;
    this.ball.vy = 0;
    if (this.ball) this.ball.spin = 0;
    this.spinCooldowns = [0, 0, 0, 0];
    this.stallTimer = 0;
    this.rallyStallT = 0;
    this.lastRallySeen = 0;

    playStart();
  }

  launchBall() {
    this.ball.reset(this.arena.cx, this.arena.cy);
  }

  onPlayerScoredOn(playerIndex) {
    // Gol her şeyi sıfırlar: falso eğriliği + kurulu şarjlar temizlenir
    if (this.ball) this.ball.spin = 0;
    this.paddles.forEach((p) => { p.spinCharge = 0; });
    const remaining = this.paddles.filter((p) => p.isJoined && !p.isEliminated);

    if (remaining.length <= 1) {
      if (remaining.length === 1) {
        const setWinner = remaining[0];
        this.roundWinner = setWinner;
        this.setScores[setWinner.index] = (this.setScores[setWinner.index] || 0) + 1;

        if (this.setScores[setWinner.index] >= this.targetSets) {
          this.state = 'MATCH_OVER';
          this.winner = setWinner;
          return;
        }
      } else {
        this.roundWinner = null;
      }
      this.state = 'ROUND_OVER';
      this.roundOverTimer = 2.0;
    } else {
      // Gol sonrası kısa duraklama (uzun ölü top "donma" gibi hissettiriyor)
      this.state = 'ROUND_PAUSE';
      this.roundPauseTimer = 0.9;
      this.ball.x = this.arena.cx;
      this.ball.y = this.arena.cy;
      this.ball.vx = 0;
      this.ball.vy = 0;
    }
  }

  update(now) {
    const frameTime = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    // Falso beklemeleri her framede erir
    for (let i = 0; i < 4; i++) {
      if (this.spinCooldowns[i] > 0) {
        this.spinCooldowns[i] = Math.max(0, this.spinCooldowns[i] - frameTime);
      }
    }

    if (this.trauma > 0) {
      this.trauma = Math.max(0, this.trauma - frameTime * 2.2);
    }

    if (this.state === 'ROUND_PAUSE') {
      this.roundPauseTimer -= frameTime;
      if (this.roundPauseTimer <= 0) {
        this.state = 'PLAYING';
        this.launchBall();
      }
    } else if (this.state === 'ROUND_OVER') {
      this.roundOverTimer -= frameTime;
      if (this.roundOverTimer <= 0) {
        this.restartRound();
      }
    } else if (this.state === 'PLAYING') {
      // Tek aktif kalınca raunt hemen biter (gol beklenmez — ayrılma da bitirir)
      const active = this.paddles.filter((p) => p.isJoined && !p.isEliminated);
      if (active.length <= 1) {
        this.onPlayerScoredOn(-1);
        return;
      }
    }

    this.accumulator += frameTime;
    while (this.accumulator >= this.fixedStep) {
      this.fixedUpdate(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }
  }

  fixedUpdate(dt) {
    this.applyKeyboardControls(dt);
    for (const paddle of this.paddles) {
      paddle.update(dt);
    }

    if (this.state === 'PLAYING') {
      this.ball.fixedUpdate(dt, this.arena, this.paddles);
      this.breakStall(dt);
    }
  }

  // Takılma-kırıcı: top 2.5 sn'de 4px bile oynamadıysa VEYA ralli 6 sn'dir
  // ilerlemiyorsa (disk çevresi oyalanması) rastgele aktif kaleye şut çeker.
  // Fizik tuzaklarının (disk/cep/köşe) son sigortasıdır.
  breakStall(dt) {
    const b = this.ball;
    if (b.isDead) {
      this.stallTimer = 0;
      this.rallyStallT = 0;
      return;
    }
    if (b.rallyCount !== (this.lastRallySeen ?? b.rallyCount)) {
      this.lastRallySeen = b.rallyCount;
      this.rallyStallT = 0;
    } else {
      this.rallyStallT = (this.rallyStallT || 0) + dt;
    }
    const moved = Math.hypot(b.x - (this.stallX ?? b.x), b.y - (this.stallY ?? b.y));
    if (moved > 4) {
      this.stallTimer = 0;
      this.stallX = b.x;
      this.stallY = b.y;
    } else {
      this.stallTimer = (this.stallTimer || 0) + dt;
    }
    const posStuck = this.stallTimer >= 2.5;
    const rallyStuck = b.rallyCount >= 10 && (this.rallyStallT || 0) >= 6;
    if (!posStuck && !rallyStuck) return;
    this.stallTimer = 0;
    this.rallyStallT = 0;
    this.stallX = b.x;
    this.stallY = b.y;

    const targets = this.paddles.filter((p) => p.isJoined && !p.isEliminated);
    if (!targets.length) return;
    const goal = targets[Math.floor(Math.random() * targets.length)];
    const bounds = this.arena.getGoalBounds(goal.side);
    const gx = goal.axis === 'horizontal'
      ? (bounds.goalMin + bounds.goalMax) / 2
      : goal.side === 'left' ? this.arena.left : this.arena.right;
    const gy = goal.axis === 'horizontal'
      ? (goal.side === 'top' ? this.arena.top : this.arena.bottom)
      : (bounds.goalMin + bounds.goalMax) / 2;
    const dx = gx - b.x;
    const dy = gy - b.y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = b.currentMinSpeed * 1.2;
    b.vx = (dx / len) * sp;
    b.vy = (dy / len) * sp;
    b.x += (dx / len) * 4;
    b.y += (dy / len) * 4;
    b.spawnShockwave(b.x, b.y, '#D99B26');
  }

  handleRemoteInput(slotIndex, data) {
    const paddle = this.paddles[slotIndex];
    if (!paddle || !paddle.isJoined || paddle.isEliminated) return;
    if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number' && Number.isFinite(data.position)) {
      const pos = Math.max(0, Math.min(1, data.position));
      paddle.setTarget(paddle.minCoord + (paddle.maxCoord - paddle.minCoord) * pos);
    } else if (data.action === 'SPIN') {
      this.triggerSpin(slotIndex);
    }
  }

  render() {
    const { ctx, canvas } = this;
    ctx.save();

    // Background paper
    ctx.fillStyle = '#F4F0EA';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

    // Render player touch zone indicators (outside arena)
    this.renderTouchZones(ctx);

    // Screen Shake (Trauma)
    if (this.trauma > 0) {
      const shakeIntensity = this.trauma * this.trauma * 14;
      const offsetX = (Math.random() - 0.5) * 2 * shakeIntensity;
      const offsetY = (Math.random() - 0.5) * 2 * shakeIntensity;
      ctx.translate(offsetX, offsetY);
    }

    // Render Arena with Corner Bumpers & Goal Mouths
    this.renderArena(ctx);

    // Render Inactive Walls & Paddles
    for (const paddle of this.paddles) {
      paddle.draw(ctx, this.arena);
    }

    // Render Ball (streak hapı yok: ralli bilgisi telegraf/ENGEL ile verilir)
    if (this.state === 'PLAYING' || this.state === 'ROUND_PAUSE') {
      this.ball.draw(ctx);
    }

    // Standart köşe skorları (diğer oyunlarla aynı dil: saha üstü 4 köşe)
    if (this.state !== 'LOBBY') {
      renderCornerScores(ctx, {
        arena: this.arena,
        entries: this.paddles.map((p, i) =>
          p.isJoined && !p.isEliminated
            ? { color: p.color, text: `${this.setScores[i] || 0}★` }
            : null
        ),
      });
    }

    // Render UI Overlays
    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'SÜRÜKLE: RAKETİ YÖNET • 3 SET ALAN KAZANIR', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'MATCH_OVER') {
      this.renderGameOverUI(ctx);
    }

    ctx.restore();
  }

  renderTouchZones(ctx) {
    const { left, top, right, bottom, width: aW, height: aH } = this.arena;
    const isPortrait = aH > aW;
    const hasSidePlayers = (this.paddles[2] && this.paddles[2].isJoined) ||
                           (this.paddles[3] && this.paddles[3].isJoined);
    const labels = ['P1', 'P2', 'P3', 'P4'];

    ctx.save();
    for (const paddle of this.paddles) {
      if (!paddle.isJoined || paddle.isEliminated) continue;
      if (isPortrait && !hasSidePlayers && paddle.index > 1) continue;
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = paddle.color;

      if (paddle.side === 'bottom') {
        ctx.fillRect(left, bottom, aW, window.innerHeight - bottom);
      } else if (paddle.side === 'top') {
        ctx.fillRect(left, 0, aW, top);
      } else if (paddle.side === 'left') {
        ctx.fillRect(0, top, left, aH);
      } else if (paddle.side === 'right') {
        ctx.fillRect(right, top, window.innerWidth - right, aH);
      }
    }
    ctx.restore();
  }

  renderArena(ctx) {
    const { left, top, right, bottom, width: aW, height: aH, cx, cy } = this.arena;
    const minDim = Math.min(aW, aH);

    // Court Floor
    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(left, top, aW, aH);

    // Center Court Markings
    ctx.strokeStyle = '#D5D0C7';
    ctx.lineWidth = 2;

    // Center Circle
    ctx.beginPath();
    ctx.arc(cx, cy, minDim * 0.14, 0, Math.PI * 2);
    ctx.stroke();

    if (this.state === 'PLAYING' || this.state === 'ROUND_PAUSE') {
      const currentSpeed = Math.round(Math.hypot(this.ball.vx, this.ball.vy));

      // Overdrive Center Core Hazard (Rally >= 10) & Advance Warning Telegraph (Rally 7..9)
      if (this.ball.rallyCount >= 7 && this.ball.rallyCount < 10) {
        const pulse = (Math.sin(performance.now() * 0.012) + 1) * 0.5;
        const warnR = minDim * 0.075 * (0.92 + pulse * 0.16);

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, warnR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(216, 71, 39, ${0.45 + pulse * 0.5})`;
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 5]);
        ctx.stroke();

        ctx.fillStyle = '#D84727';
        ctx.font = '900 12px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`⚡ TEHLİKE YAKLAŞIYOR (${10 - this.ball.rallyCount}) ⚡`, cx, cy - 28);
        ctx.restore();
      } else if (this.ball.rallyCount >= 10) {
        const hazardR = minDim * 0.065;
        ctx.save();
        ctx.fillStyle = '#1C1C1A';
        ctx.beginPath();
        ctx.arc(cx, cy, hazardR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#D84727';
        ctx.lineWidth = 3.5;
        ctx.stroke();

        ctx.fillStyle = '#FFFFFF';
        ctx.font = '900 11px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⚡ ENGEL ⚡', cx, cy);
        ctx.restore();
      }

      ctx.save();
      if (this.state === 'ROUND_PAUSE') {
        const remaining = Math.max(0.1, this.roundPauseTimer);
        const progress = Math.min(1, remaining / 1.4);

        // Animated Countdown Ring around center
        ctx.beginPath();
        ctx.arc(cx, cy, minDim * 0.16 * (0.82 + progress * 0.18), 0, Math.PI * 2);
        ctx.strokeStyle = '#D84727';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.fillStyle = '#1C1C1A';
        ctx.font = '900 28px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('HAZIR!', cx, cy - 14);

        ctx.fillStyle = '#D84727';
        ctx.font = '900 22px "JetBrains Mono", monospace';
        ctx.fillText(`${remaining.toFixed(1)}s`, cx, cy + 18);
      }
      ctx.restore();
    }

    // Round Over Banner
    if (this.state === 'ROUND_OVER' && this.roundWinner) {
      renderRoundBanner(ctx, {
        arena: this.arena,
        title: `+1 SET: ${this.roundWinner.name}!`,
        titleColor: this.roundWinner.color,
        sub: `TOPLAM SET: ${this.setScores[this.roundWinner.index]} / ${this.targetSets}`,
      });
    } else {
      // Center Cross in Lobby
      const crossSize = 18;
      ctx.beginPath();
      ctx.moveTo(cx - crossSize, cy);
      ctx.lineTo(cx + crossSize, cy);
      ctx.moveTo(cx, cy - crossSize);
      ctx.lineTo(cx, cy + crossSize);
      ctx.stroke();
    }

    // Render 8 Solid Corner Bumper Posts (12% width at the corners)
    this.renderCornerBumpers(ctx);

    // Render Dashed Goal Lines across open goal mouths
    this.renderGoalLines(ctx);

    // Outer Arena Border Stroke
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 5;
    ctx.strokeRect(left, top, aW, aH);
  }

  renderCornerBumpers(ctx) {
    const { left, right, top, bottom, width: aW, height: aH } = this.arena;
    const { goalMin: hGoalMin, goalMax: hGoalMax } = this.getGoalBounds('bottom');
    const { goalMin: vGoalMin, goalMax: vGoalMax } = this.getGoalBounds('left');
    const bLenH = hGoalMin - left;
    const bLenV = vGoalMin - top;
    // Bumper kalınlığı arenaya oranlı (dar telefonda pahla orantı korunur)
    const thick = Math.max(10, Math.round(Math.min(aW, aH) * 0.03));

    ctx.fillStyle = '#8C8880';
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 2.5;

    // Helper to draw a hatched bumper rect
    const drawBumper = (x, y, w, h) => {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);

      // Brutalist hatching
      ctx.save();
      ctx.strokeStyle = '#5E5B54';
      ctx.lineWidth = 1.5;
      const step = 8;
      for (let offset = -Math.max(w, h); offset < Math.max(w, h) + 20; offset += step) {
        ctx.beginPath();
        if (w > h) {
          const sx = x + offset;
          if (sx >= x - h && sx <= x + w) {
            ctx.moveTo(Math.max(x, sx), y);
            ctx.lineTo(Math.min(x + w, sx + h), y + h);
          }
        } else {
          const sy = y + offset;
          if (sy >= y - w && sy <= y + h) {
            ctx.moveTo(x, Math.max(y, sy));
            ctx.lineTo(x + w, Math.min(y + h, sy + w));
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    };

    // Bottom Bumpers (Left & Right)
    drawBumper(left, bottom - thick, bLenH, thick);
    drawBumper(hGoalMax, bottom - thick, bLenH, thick);

    // Top Bumpers (Left & Right)
    drawBumper(left, top, bLenH, thick);
    drawBumper(hGoalMax, top, bLenH, thick);

    // Left Bumpers (Top & Bottom)
    drawBumper(left, top, thick, bLenV);
    drawBumper(left, vGoalMax, thick, bLenV);

    // Right Bumpers (Top & Bottom)
    drawBumper(right - thick, top, thick, bLenV);
    drawBumper(right - thick, vGoalMax, thick, bLenV);

    // 45° pah dikişleri: ince tek çizgi (fizik yüzüyle birebir, taşma yok)
    const L = this.getChamferLeg();
    const seams = [
      [[left + L, top], [left, top + L]],
      [[right - L, top], [right, top + L]],
      [[left + L, bottom], [left, bottom - L]],
      [[right - L, bottom], [right, bottom - L]],
    ];
    ctx.save();
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 3;
    for (const [[x1, y1], [x2, y2]] of seams) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  renderGoalLines(ctx) {
    ctx.save();
    ctx.strokeStyle = '#B3ADA2';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    for (const p of this.paddles) {
      if (!p.isJoined || p.isEliminated) continue;

      const { goalMin, goalMax } = this.arena.getGoalBounds(p.side);
      ctx.beginPath();
      if (p.side === 'bottom') {
        ctx.moveTo(goalMin, this.arena.bottom - 2);
        ctx.lineTo(goalMax, this.arena.bottom - 2);
      } else if (p.side === 'top') {
        ctx.moveTo(goalMin, this.arena.top + 2);
        ctx.lineTo(goalMax, this.arena.top + 2);
      } else if (p.side === 'left') {
        ctx.moveTo(this.arena.left + 2, goalMin);
        ctx.lineTo(this.arena.left + 2, goalMax);
      } else if (p.side === 'right') {
        ctx.moveTo(this.arena.right - 2, goalMin);
        ctx.lineTo(this.arena.right - 2, goalMax);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  renderLobbyUI(ctx) {
    const { arena } = this;
    const joinedCount = this.getJoinedPlayerCount();

    // Draw 4 Edge "KATIL / HAZIR" Buttons
    this.paddles.forEach((p) => {
      this.renderPlayerLobbySlot(ctx, p);
    });

    // Center Area: Information or "BAŞLAT" Button (standart)
    renderLobbyStartButton(ctx, {
      arena,
      uiButtons: this.uiButtons,
      joinedCount,
      accent: '#D84727',
      onStart: () => this.startGame(),
      hidden: !!this.hideLobbyStartButton,
    });
  }

  renderPlayerLobbySlot(ctx, paddle) {
    const isJoined = paddle.isJoined;
    const { arena } = this;

    // PONG istisnası: konum kenar-orta (paddle tarafı), ölçü standart kare
    const baseSize = Math.min(arena.width, arena.height);
    const S = getStandardSeatSize(arena);
    const gap = Math.max(16, Math.floor(baseSize * 0.035));

    let btnX, btnY;
    const btnW = S;
    const btnH = S;

    if (paddle.side === 'bottom') {
      btnX = arena.cx - btnW / 2;
      btnY = arena.bottom - btnH - gap;
    } else if (paddle.side === 'top') {
      btnX = arena.cx - btnW / 2;
      btnY = arena.top + gap;
    } else if (paddle.side === 'left') {
      btnX = arena.left + gap;
      btnY = arena.cy - btnH / 2;
    } else if (paddle.side === 'right') {
      btnX = arena.right - btnW - gap;
      btnY = arena.cy - btnH / 2;
    }

    let rotation = 0;
    if (paddle.side === 'top') {
      rotation = Math.PI;
    } else if (paddle.side === 'left') {
      rotation = Math.PI / 2;
    } else if (paddle.side === 'right') {
      rotation = -Math.PI / 2;
    }

    renderLobbySeatCard(ctx, {
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      slotIndex: paddle.index,
      slotType: paddle.slotType,
      playerName: paddle.name || '',
      playerColor: paddle.color,
      rotation,
    });

    this.uiButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      onClick: () => this.togglePlayerJoin(paddle.index),
    });
  }

  renderGameOverUI(ctx) {
    renderMatchOver(ctx, {
      arena: this.arena,
      uiButtons: this.uiButtons,
      headline: 'ŞAMPİYONLUK KAZANILDI! 🏆',
      winnerName: this.winner ? this.winner.name : '',
      winnerColor: this.winner ? this.winner.color : '#1A1A1A',
      rows: this.winner
        ? this.paddles
            .filter((p) => p.isJoined)
            .map((p) => ({ color: p.color, text: `${p.name}: ${this.setScores[p.index] || 0} SET` }))
        : [],
      onRestart: () => {
        this.state = 'LOBBY';
        this.setScores = [0, 0, 0, 0];
        this.winner = null;
        this.roundWinner = null;
        this.paddles.forEach((p) => p.reset(p.isJoined));
      },
    });
  }
}
