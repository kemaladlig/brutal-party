// Paddle implementation with multi-tier Bot AI (Normal & God Mode), full-span movement and brutalist rendering

export const PLAYER_CONFIGS = [
  { index: 0, name: 'ALT', side: 'bottom', axis: 'horizontal', color: '#D84727' },
  { index: 1, name: 'ÜST', side: 'top', axis: 'horizontal', color: '#1D5D8A' },
  { index: 2, name: 'SOL', side: 'left', axis: 'vertical', color: '#D99B26' },
  { index: 3, name: 'SAĞ', side: 'right', axis: 'vertical', color: '#2F6A4F' },
];

export class Paddle {
  constructor(config, game) {
    this.index = config.index;
    this.name = config.name;
    this.side = config.side;
    this.axis = config.axis;
    this.color = config.color;
    this.game = game;

    this.lives = 3;
    // Slot type: 'empty' | 'human' | 'bot_normal' | 'bot_god'
    this.slotType = 'empty';
    this.isJoined = false;
    this.isEliminated = false;

    // Dimensions
    this.length = 100;
    this.thickness = 18;

    // Movement & Position
    this.coord = 0;
    this.targetCoord = 0;
    this.prevCoord = 0;
    this.velocity = 0;

    // Boundaries
    this.minCoord = 0;
    this.maxCoord = 0;
    this.fixedPerpendicular = 0;

    // Bot AI state
    this.botErrorOffset = 0;
    this.botErrorTimer = 0;
  }

  cycleSlotType() {
    if (this.slotType === 'empty') {
      this.slotType = 'human';
      this.isJoined = true;
    } else if (this.slotType === 'human') {
      this.slotType = 'bot_normal';
      this.isJoined = true;
    } else if (this.slotType === 'bot_normal') {
      this.slotType = 'bot_god';
      this.isJoined = true;
    } else {
      this.slotType = 'empty';
      this.isJoined = false;
    }
  }

  get isBot() {
    return this.slotType === 'bot_normal' || this.slotType === 'bot_god';
  }

  get isGodBot() {
    return this.slotType === 'bot_god';
  }

  reset(isJoined = true) {
    this.isJoined = isJoined;
    this.lives = 3;
    this.isEliminated = !isJoined;
    this.velocity = 0;
    this.centerInBounds();
  }

  updateLayout(arena) {
    const horizDim = arena.width  || arena.size;
    const vertDim  = arena.height || arena.size;
    const minDim = Math.min(horizDim, vertDim);

    const goalBounds = arena.getGoalBounds ? arena.getGoalBounds(this.side) : null;
    const goalSpan = goalBounds ? (goalBounds.goalMax - goalBounds.goalMin) : Math.round(minDim * 0.70);

    // Paddle spans ~32% of the goal opening – fair and balanced on all walls
    this.length    = Math.max(68, Math.floor(goalSpan * 0.32));
    this.thickness = Math.max(14, Math.floor(minDim * 0.034));

    const halfPad = this.length / 2;
    const margin  = minDim * 0.024;

    if (this.axis === 'horizontal') {
      const gMin = goalBounds ? goalBounds.goalMin : arena.left;
      const gMax = goalBounds ? goalBounds.goalMax : arena.right;
      this.minCoord = gMin + halfPad;
      this.maxCoord = gMax - halfPad;
      if (this.side === 'bottom') {
        this.fixedPerpendicular = arena.bottom - margin - this.thickness / 2;
      } else {
        this.fixedPerpendicular = arena.top + margin + this.thickness / 2;
      }
    } else {
      const gMin = goalBounds ? goalBounds.goalMin : arena.top;
      const gMax = goalBounds ? goalBounds.goalMax : arena.bottom;
      this.minCoord = gMin + halfPad;
      this.maxCoord = gMax - halfPad;
      if (this.side === 'left') {
        this.fixedPerpendicular = arena.left + margin + this.thickness / 2;
      } else {
        this.fixedPerpendicular = arena.right - margin - this.thickness / 2;
      }
    }

    if (!this.coord) {
      this.centerInBounds();
    } else {
      this.coord = Math.max(this.minCoord, Math.min(this.maxCoord, this.coord));
      this.targetCoord = this.coord;
    }
  }

  centerInBounds() {
    this.coord = (this.minCoord + this.maxCoord) / 2;
    this.targetCoord = this.coord;
    this.prevCoord = this.coord;
    this.velocity = 0;
  }

  setTarget(value) {
    if (!this.isJoined || this.isEliminated) return;
    this.targetCoord = Math.max(this.minCoord, Math.min(this.maxCoord, value));
  }

  update(dt) {
    if (!this.isJoined || this.isEliminated) return;

    // Run AI Controller if bot
    if (this.isBot && this.game.state === 'PLAYING') {
      this.updateBotAI(dt);
    }

    this.prevCoord = this.coord;

    // Smooth follow – fast lerp to target for crisp 1:1 finger tracking without lag.
    const lerpSpeed = 36; // >99% closure within 2 frames, crisp response with true velocity
    this.coord += (this.targetCoord - this.coord) * Math.min(1, lerpSpeed * dt);
    this.coord = Math.max(this.minCoord, Math.min(this.maxCoord, this.coord));

    if (dt > 0) {
      const instantaneous = (this.coord - this.prevCoord) / dt;
      this.velocity = this.velocity * 0.3 + instantaneous * 0.7;
    }
  }

  updateBotAI(dt) {
    const ball = this.game.ball;
    if (!ball || ball.isDead) return;

    const arena = this.game.arena;
    const isHorizontal = this.axis === 'horizontal';

    // Check if ball is heading towards this paddle
    let isHeadingTowards = false;
    if (this.side === 'bottom') isHeadingTowards = ball.vy > 0;
    else if (this.side === 'top') isHeadingTowards = ball.vy < 0;
    else if (this.side === 'left') isHeadingTowards = ball.vx < 0;
    else if (this.side === 'right') isHeadingTowards = ball.vx > 0;

    let desiredCoord = (this.minCoord + this.maxCoord) / 2;

    if (this.isGodBot) {
      // ⚡ GOD MODE BOT: Full multi-bounce vector raycast & tactical smash swipe
      if (isHeadingTowards) {
        const predicted = this.predictBallLanding(ball, arena);
        desiredCoord = predicted;

        // Tactical smash flick when ball is close:
        // Intentionally offset to hit with the outer 30% of the paddle for devastating spin & swipe velocity!
        const distToBall = isHorizontal
          ? Math.abs(this.fixedPerpendicular - ball.y)
          : Math.abs(this.fixedPerpendicular - ball.x);

        if (distToBall < 110) {
          // Swipe towards whichever side has opposing open goals
          const swipeOffset = Math.sin(performance.now() * 0.004) > 0 ? this.length * 0.35 : -this.length * 0.35;
          desiredCoord += swipeOffset;
        }
      } else {
        // Return swiftly to center
        desiredCoord = (this.minCoord + this.maxCoord) / 2;
      }

      // God Mode moves scaled to arena
      const arenaRef = Math.min(this.game.arena.width || 400, this.game.arena.height || 400);
      const godSpeed = arenaRef * 1.4 + Math.min(arenaRef * 0.4, (this.game.ball ? this.game.ball.rallyCount : 0) * arenaRef * 0.03);
      const maxMove = godSpeed * dt;
      const diff = desiredCoord - this.coord;
      this.coord += Math.sign(diff) * Math.min(Math.abs(diff), maxMove);
      this.targetCoord = Math.max(this.minCoord, Math.min(this.maxCoord, this.coord));

    } else {
      // 🤖 NORMAL BOT: Human-like latency, soft tracking, occasional misses
      this.botErrorTimer -= dt;
      if (this.botErrorTimer <= 0) {
        this.botErrorOffset = (Math.random() - 0.5) * 32;
        this.botErrorTimer = 0.4 + Math.random() * 0.3;
      }

      if (isHeadingTowards) {
        // Track current ball position with slight error
        const ballPos = isHorizontal ? ball.x : ball.y;
        desiredCoord = ballPos + this.botErrorOffset;
      } else {
        desiredCoord = (this.minCoord + this.maxCoord) / 2;
      }

      // Normal Bot moves at human-relative speed
      const arenaRef = Math.min(this.game.arena.width || 400, this.game.arena.height || 400);
      const maxMove = arenaRef * 0.85 * dt;
      const diff = desiredCoord - this.coord;
      this.coord += Math.sign(diff) * Math.min(Math.abs(diff), maxMove);
      this.targetCoord = Math.max(this.minCoord, Math.min(this.maxCoord, this.coord));
    }
  }

  predictBallLanding(ball, arena) {
    // Multi-bounce geometric trajectory simulation
    let simX = ball.x;
    let simY = ball.y;
    let simVx = ball.vx;
    let simVy = ball.vy;

    const isHorizontal = this.axis === 'horizontal';
    const targetPerp = this.fixedPerpendicular;
    const dtSim = 1 / 180;
    const maxSteps = 240;

    for (let step = 0; step < maxSteps; step++) {
      simX += simVx * dtSim;
      simY += simVy * dtSim;

      // Bounce off lateral walls
      if (isHorizontal) {
        if (simX <= arena.left + ball.radius) {
          simVx = Math.abs(simVx);
          simX = arena.left + ball.radius;
        } else if (simX >= arena.right - ball.radius) {
          simVx = -Math.abs(simVx);
          simX = arena.right - ball.radius;
        }

        // Check arrival at horizontal paddle line
        if (this.side === 'bottom' && simY >= targetPerp) return simX;
        if (this.side === 'top' && simY <= targetPerp) return simX;
      } else {
        if (simY <= arena.top + ball.radius) {
          simVy = Math.abs(simVy);
          simY = arena.top + ball.radius;
        } else if (simY >= arena.bottom - ball.radius) {
          simVy = -Math.abs(simVy);
          simY = arena.bottom - ball.radius;
        }

        if (this.side === 'left' && simX <= targetPerp) return simY;
        if (this.side === 'right' && simX >= targetPerp) return simY;
      }
    }

    return isHorizontal ? simX : simY;
  }

  takeDamage() {
    if (this.isEliminated) return;
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives === 0) {
      this.isEliminated = true;
    }
  }

  getBounds() {
    let curLen = this.length;
    // Sudden Death / Overdrive shrink after rally 10
    if (this.game && this.game.ball && this.game.ball.rallyCount >= 10) {
      curLen = Math.max(65, this.length * 0.82);
    }
    const halfLen = curLen / 2;
    const halfThick = this.thickness / 2;

    if (this.axis === 'horizontal') {
      return {
        left: this.coord - halfLen,
        right: this.coord + halfLen,
        top: this.fixedPerpendicular - halfThick,
        bottom: this.fixedPerpendicular + halfThick,
      };
    } else {
      return {
        left: this.fixedPerpendicular - halfThick,
        right: this.fixedPerpendicular + halfThick,
        top: this.coord - halfLen,
        bottom: this.coord + halfLen,
      };
    }
  }

  draw(ctx, arena) {
    if (!this.isJoined || this.isEliminated) {
      this.drawFullClosedWall(ctx, arena);
      return;
    }

    const bounds = this.getBounds();
    const w = bounds.right - bounds.left;
    const h = bounds.bottom - bounds.top;

    // Draw Brutalist Paddle
    ctx.fillStyle = this.color;
    ctx.fillRect(bounds.left, bounds.top, w, h);

    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 3;
    ctx.strokeRect(bounds.left, bounds.top, w, h);

    // If bot, draw bot indicator badge inside paddle
    if (this.isBot) {
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = this.isGodBot ? '⚡GOD' : '🤖BOT';
      ctx.fillText(label, this.coord, this.fixedPerpendicular);
      ctx.restore();
    }

    // Clean, high-visibility score indicator and lives next to paddle
    if (this.game && this.game.setScores) {
      ctx.save();
      const score = this.game.setScores[this.index] || 0;
      ctx.fillStyle = this.color;
      ctx.font = '900 22px "Space Grotesk", sans-serif';

      const livesStr = this.lives > 0 ? '● '.repeat(this.lives).trim() : 'ELENDİ';

      if (this.axis === 'horizontal') {
        // Score on left, lives on right
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${score}★`, bounds.left - 14, this.fixedPerpendicular);

        ctx.textAlign = 'left';
        ctx.font = '900 16px "JetBrains Mono", monospace';
        ctx.fillText(livesStr, bounds.right + 14, this.fixedPerpendicular);
      } else {
        // Score on top, lives on bottom
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`${score}★`, this.fixedPerpendicular, bounds.top - 10);

        ctx.textBaseline = 'top';
        ctx.font = '900 16px "JetBrains Mono", monospace';
        ctx.fillText(livesStr, this.fixedPerpendicular, bounds.bottom + 10);
      }
      ctx.restore();
    }
  }

  drawFullClosedWall(ctx, arena) {
    const wallThick = 20;
    ctx.fillStyle = '#938F86';
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = 3;

    let x = 0, y = 0, w = 0, h = 0;
    if (this.side === 'bottom') {
      x = arena.left;
      y = arena.bottom - wallThick;
      w = arena.width || arena.size;
      h = wallThick;
    } else if (this.side === 'top') {
      x = arena.left;
      y = arena.top;
      w = arena.width || arena.size;
      h = wallThick;
    } else if (this.side === 'left') {
      x = arena.left;
      y = arena.top;
      w = wallThick;
      h = arena.height || arena.size;
    } else if (this.side === 'right') {
      x = arena.right - wallThick;
      y = arena.top;
      w = wallThick;
      h = arena.height || arena.size;
    }

    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);

    // Warning hatch stripes
    ctx.save();
    ctx.strokeStyle = '#6E6B64';
    ctx.lineWidth = 2;
    const longDim = Math.max(arena.width || arena.size, arena.height || arena.size);
    const step = 18;
    for (let i = -50; i < longDim + 50; i += step) {
      ctx.beginPath();
      if (this.axis === 'horizontal') {
        const lx = x + i;
        if (lx >= x && lx <= x + w) {
          ctx.moveTo(lx, y);
          ctx.lineTo(lx + 12, y + h);
        }
      } else {
        const ly = y + i;
        if (ly >= y && ly <= y + h) {
          ctx.moveTo(x, ly);
          ctx.lineTo(x + w, ly + 12);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}
