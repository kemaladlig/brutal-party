// Core Game Engine: Arena with Corner Bumpers & Goal Mouths, Lobby, Fixed Physics Loop & Brutalist Rendering
import { Paddle, PLAYER_CONFIGS } from './paddle.js';
import { Ball } from './ball.js';
import { playJoin, playStart } from '../audio.js';
import { renderControlGuide, renderLobbySeatCard } from '../controlGuide.js';
import { BaseMiniGame } from '../core/BaseGame.js';

export class Game extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    // States: 'LOBBY', 'PLAYING', 'ROUND_PAUSE', 'GAME_OVER'
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
    this.roundPauseTimer = 1.3;
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
  }

  getGoalBounds(side) {
    const isHorizontal = side === 'bottom' || side === 'top';
    const minDim = Math.min(this.arena.width, this.arena.height);
    const goalSpan = Math.round(minDim * 0.70);
    const center = isHorizontal ? this.arena.cx : this.arena.cy;
    return {
      goalMin: center - goalSpan / 2,
      goalMax: center + goalSpan / 2,
      goalSpan,
    };
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

    // 3. In Gameplay: lock touch.id to player zone
    if (this.state === 'PLAYING') {
      const playerIndex = this.getPlayerZoneAt(touch);
      if (playerIndex !== -1 && this.isPlayerActive(playerIndex)) {
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
    return p && p.isJoined && !p.isEliminated;
  }

  getActivePlayerCount() {
    return this.paddles.filter((p) => p.isJoined && !p.isEliminated).length;
  }

  getJoinedPlayerCount() {
    return this.paddles.filter((p) => p.isJoined).length;
  }

  resize(width, height) {
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

    playStart();
  }

  launchBall() {
    this.ball.reset(this.arena.cx, this.arena.cy);
  }

  onPlayerScoredOn(playerIndex) {
    const remaining = this.paddles.filter((p) => p.isJoined && !p.isEliminated);

    if (remaining.length <= 1) {
      if (remaining.length === 1) {
        const setWinner = remaining[0];
        this.roundWinner = setWinner;
        this.setScores[setWinner.index] = (this.setScores[setWinner.index] || 0) + 1;

        if (this.setScores[setWinner.index] >= this.targetSets) {
          this.state = 'GAME_OVER';
          this.winner = setWinner;
          return;
        }
      } else {
        this.roundWinner = null;
      }
      this.state = 'ROUND_OVER';
      this.roundOverTimer = 2.0;
    } else {
      this.state = 'ROUND_PAUSE';
      this.roundPauseTimer = 1.3;
      this.ball.x = this.arena.cx;
      this.ball.y = this.arena.cy;
      this.ball.vx = 0;
      this.ball.vy = 0;
    }
  }

  update(now) {
    const frameTime = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

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
    }

    this.accumulator += frameTime;
    while (this.accumulator >= this.fixedStep) {
      this.fixedUpdate(this.fixedStep);
      this.accumulator -= this.fixedStep;
    }
  }

  fixedUpdate(dt) {
    for (const paddle of this.paddles) {
      paddle.update(dt);
    }

    if (this.state === 'PLAYING') {
      this.ball.fixedUpdate(dt, this.arena, this.paddles);
    }
  }

  handleRemoteInput(slotIndex, data) {
    const paddle = this.paddles[slotIndex];
    if (!paddle || !paddle.isJoined || paddle.isEliminated) return;
    if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
      paddle.setTarget(paddle.minCoord + (paddle.maxCoord - paddle.minCoord) * data.position);
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

    // Render Ball
    if (this.state === 'PLAYING' || this.state === 'ROUND_PAUSE') {
      this.ball.draw(ctx);
      this.renderTopHUD(ctx);
    }

    // Render UI Overlays
    this.uiButtons = [];
    if (this.state === 'LOBBY') {
      renderControlGuide(ctx, this.arena, 'PARMAĞINI KENDİ BÖLGENDE SÜRÜKLE', [
        'P1 KIRMIZI',
        'P2 MAVİ',
        'P3 SARI',
        'P4 YEŞİL',
      ]);
      this.renderLobbyUI(ctx);
    } else if (this.state === 'GAME_OVER') {
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

  renderTopHUD(ctx) {
    if (this.state !== 'PLAYING') return;
    if (this.ball.rallyCount >= 5) {
      const { cx, top } = this.arena;
      const pillW = 124;
      const pillH = 34;
      const pillX = cx - pillW / 2;
      const pillY = top + 12;

      ctx.save();
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(pillX + 3, pillY + 3, pillW, pillH);

      ctx.fillStyle = this.ball.rallyCount >= 10 ? '#D84727' : '#1C1C1A';
      ctx.fillRect(pillX, pillY, pillW, pillH);

      ctx.strokeStyle = '#1A1A1A';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(pillX, pillY, pillW, pillH);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 15px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`⚡ ${this.ball.rallyCount} VURUŞ`, cx, pillY + pillH / 2);
      ctx.restore();
    }
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
      ctx.save();
      const bW = Math.min(300, aW * 0.7);
      const bH = 74;
      const bX = cx - bW / 2;
      const bY = cy - bH / 2;

      ctx.fillStyle = '#1C1C1A';
      ctx.fillRect(bX + 5, bY + 5, bW, bH);
      ctx.fillStyle = '#FAF7F2';
      ctx.fillRect(bX, bY, bW, bH);
      ctx.strokeStyle = '#1C1C1A';
      ctx.lineWidth = 3;
      ctx.strokeRect(bX, bY, bW, bH);

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.roundWinner.color;
      ctx.font = '900 19px "Space Grotesk", sans-serif';
      ctx.fillText(`+1 SET: ${this.roundWinner.name}!`, cx, cy - 11);

      ctx.fillStyle = '#1C1C1A';
      ctx.font = '800 12px "JetBrains Mono", monospace';
      ctx.fillText(
        `TOPLAM SET: ${this.setScores[this.roundWinner.index]} / ${this.targetSets}`,
        cx,
        cy + 14
      );
      ctx.restore();
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
    const { left, right, top, bottom } = this.arena;
    const { goalMin: hGoalMin, goalMax: hGoalMax } = this.getGoalBounds('bottom');
    const { goalMin: vGoalMin, goalMax: vGoalMax } = this.getGoalBounds('left');
    const bLenH = hGoalMin - left;
    const bLenV = vGoalMin - top;
    const thick = 16;

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

    // Center Area: Information or "BAŞLAT" Button
    const btnW = Math.min(220, arena.width * 0.45);
    const btnH = 60;
    const btnX = arena.cx - btnW / 2;
    const btnY = arena.cy - btnH / 2;

    ctx.save();
    // Solid Shadow Box
    ctx.fillStyle = '#1A1A1A';
    ctx.fillRect(btnX + 5, btnY + 5, btnW, btnH);

    // Button Face
    ctx.fillStyle = joinedCount >= 2 ? '#D84727' : '#E5E0D6';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = joinedCount >= 2 ? '#FFFFFF' : '#75726B';
    ctx.font = joinedCount >= 2 ? '900 20px "Space Grotesk", sans-serif' : '800 13px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(joinedCount >= 2 ? '▶ MAÇI BAŞLAT' : '2 KİŞİ GEREKİYOR', arena.cx, arena.cy);
    ctx.restore();

    if (joinedCount >= 2) {
      this.uiButtons.push({
        x: btnX,
        y: btnY,
        w: btnW,
        h: btnH,
        onClick: () => this.startGame(),
      });
    }
  }

  renderPlayerLobbySlot(ctx, paddle) {
    const isJoined = paddle.isJoined;
    const { arena } = this;

    // Uniform slot card sizing regardless of screen aspect ratio
    const baseSize = Math.min(arena.width, arena.height);
    const cardLong = Math.max(130, Math.min(170, Math.floor(baseSize * 0.32)));
    const cardShort = Math.max(48, Math.min(56, Math.floor(cardLong * 0.34)));
    const gap = Math.max(16, Math.floor(baseSize * 0.035));

    let btnX, btnY, btnW, btnH;

    if (paddle.side === 'bottom') {
      btnW = cardLong;  btnH = cardShort;
      btnX = arena.cx - btnW / 2;
      btnY = arena.bottom - btnH - gap;
    } else if (paddle.side === 'top') {
      btnW = cardLong;  btnH = cardShort;
      btnX = arena.cx - btnW / 2;
      btnY = arena.top + gap;
    } else if (paddle.side === 'left') {
      btnW = cardShort;  btnH = cardLong;
      btnX = arena.left + gap;
      btnY = arena.cy - btnH / 2;
    } else if (paddle.side === 'right') {
      btnW = cardShort;  btnH = cardLong;
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
    const { arena } = this;
    const boxW = Math.min(320, arena.width * 0.75);
    const boxH = 220;
    const boxX = arena.cx - boxW / 2;
    const boxY = arena.cy - boxH / 2;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(boxX + 8, boxY + 8, boxW, boxH);

    ctx.fillStyle = '#FAF7F2';
    ctx.fillRect(boxX, boxY, boxW, boxH);

    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 4;
    ctx.strokeRect(boxX, boxY, boxW, boxH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.fillStyle = '#1C1C1A';
    ctx.font = '800 14px "Space Grotesk", sans-serif';
    ctx.fillText('ŞAMPİYONLUK KAZANILDI! 🏆', arena.cx, boxY + 34);

    if (this.winner) {
      ctx.fillStyle = this.winner.color;
      ctx.font = '900 24px "Space Grotesk", sans-serif';
      ctx.fillText(`${this.winner.color} // KAZANDI`, arena.cx, boxY + 66, boxW - 20);

      ctx.fillStyle = '#78736A';
      ctx.font = '800 11px "JetBrains Mono", monospace';
      this.paddles.filter((p) => p.isJoined).forEach((p, row) => {
        ctx.fillStyle = p.color;
        ctx.fillText(`${p.color}: ${this.setScores[p.index] || 0} SET`, arena.cx, boxY + 94 + row * 17);
      });
    } else {
      ctx.fillStyle = '#1C1C1A';
      ctx.font = '900 24px "Space Grotesk", sans-serif';
      ctx.fillText('BERABERE', arena.cx, boxY + 74);
    }

    const btnW = 190;
    const btnH = 46;
    const btnX = arena.cx - btnW / 2;
    const btnY = boxY + 154;

    ctx.fillStyle = '#1C1C1A';
    ctx.fillRect(btnX, btnY, btnW, btnH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 16px "Space Grotesk", sans-serif';
    ctx.fillText('YENİDEN OYNA', arena.cx, btnY + btnH / 2);

    this.uiButtons.push({
      x: btnX,
      y: btnY,
      w: btnW,
      h: btnH,
      onClick: () => {
        this.state = 'LOBBY';
        this.setScores = [0, 0, 0, 0];
        this.winner = null;
        this.roundWinner = null;
        this.paddles.forEach((p) => p.reset(p.isJoined));
      },
    });
  }
}
