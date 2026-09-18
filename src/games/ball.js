// Ball physics with progressive speed escalation, smash mechanics, sonic booms & overdrive hazards
import { playPaddleHit, playWallHit, playGoal, playShoot, playSonicBoom } from '../audio.js';

export class Ball {
  constructor(game) {
    this.game = game;

    // Physical attributes
    this.radius = 11;
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;

    // Progressive Speed Scaling - dynamically scaled to arena
    this.baseMinSpeed = 420;
    this.baseMaxSpeed = 1100;
    this.currentMinSpeed = 420;
    this.currentMaxSpeed = 1100;
    this.dragFactor = 0.9996;
    this.spinInfluence = 0.48;

    this.trail = [];
    this.maxTrailLength = 7;
    this.isDead = false;

    // Shockwaves
    this.shockwaves = [];

    // Rally & Smash system
    this.rallyCount = 0;
    this.isSmash = false;
    this.lastHitPlayer = -1;

    // Anti-loop tracker
    this.consecutiveWallBounces = 0;
  }

  scaleToArena(arena) {
    const shortSide = Math.min(arena.width, arena.height) || 400;
    const longSide  = Math.max(arena.width, arena.height) || 600;

    // Ball radius scales with the shorter dimension (~1.8-2.0%)
    this.radius = Math.max(9, Math.min(16, Math.round(shortSide * 0.019)));

    // Speed anchored to the shorter dimension for consistent feel on any layout
    this.baseMinSpeed = shortSide * 0.70;
    this.baseMaxSpeed = longSide  * 1.30;
    this.currentMinSpeed = this.baseMinSpeed;
    this.currentMaxSpeed = this.baseMaxSpeed;
  }

  spawnShockwave(x, y, color = '#1A1A1A') {
    this.shockwaves.push({
      x,
      y,
      radius: 8,
      maxRadius: 48,
      life: 0.28,
      maxLife: 0.28,
      color,
    });
  }

  reset(cx, cy, directionAngle = null) {
    this.x = cx;
    this.y = cy;
    this.trail = [];
    this.shockwaves = [];
    this.isDead = false;
    this.consecutiveWallBounces = 0;

    // Reset progressive rally escalations
    this.rallyCount = 0;
    this.currentMinSpeed = this.baseMinSpeed;
    this.currentMaxSpeed = this.baseMaxSpeed;
    this.isSmash = false;
    this.lastHitPlayer = -1;

    let angle = directionAngle;
    if (angle === null || angle === undefined) {
      const baseAngles = [
        Math.PI * 0.21,
        Math.PI * 0.32,
        Math.PI * 0.68,
        Math.PI * 0.79,
        Math.PI * 1.21,
        Math.PI * 1.32,
        Math.PI * 1.68,
        Math.PI * 1.79,
      ];
      const base = baseAngles[Math.floor(Math.random() * baseAngles.length)];
      angle = base + (Math.random() - 0.5) * 0.12;
    }

    this.vx = Math.cos(angle) * this.currentMinSpeed;
    this.vy = Math.sin(angle) * this.currentMinSpeed;
  }

  fixedUpdate(dt, arena, paddles) {
    if (this.isDead) return;

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dt;
      sw.radius += (sw.maxRadius - sw.radius) * (dt * 18);
      if (sw.life <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }

    // Adaptive sub-stepping – thresholds scale with arena so tunneling never occurs
    const currentSpeed = Math.hypot(this.vx, this.vy);
    const fastThresh = this.baseMaxSpeed * 1.05;
    const midThresh  = this.baseMinSpeed * 1.15;
    const subSteps = currentSpeed > fastThresh ? 3 : currentSpeed > midThresh ? 2 : 1;
    const subDt = dt / subSteps;

    for (let step = 0; step < subSteps; step++) {
      if (this.isDead) break;
      this.singleSubStep(subDt, arena, paddles);
    }

    // Trail updates
    this.trail.unshift({ x: this.x, y: this.y, isSmash: this.isSmash, speed: currentSpeed });
    this.maxTrailLength = Math.min(18, 6 + Math.floor(this.rallyCount / 2));
    if (this.trail.length > this.maxTrailLength) {
      this.trail.pop();
    }
  }

  singleSubStep(dt, arena, paddles) {
    // 1. Air drag (floored at current escalating minSpeed)
    let currentSpeed = Math.hypot(this.vx, this.vy);
    if (currentSpeed > this.currentMinSpeed) {
      currentSpeed = Math.max(this.currentMinSpeed, currentSpeed * this.dragFactor);
      const dirX = this.vx / (currentSpeed || 1);
      const dirY = this.vy / (currentSpeed || 1);
      this.vx = dirX * currentSpeed;
      this.vy = dirY * currentSpeed;
    }

    // 2. Predict position
    let nextX = this.x + this.vx * dt;
    let nextY = this.y + this.vy * dt;

    // 3. Collision with Overdrive Center Core Hazard (Rally >= 10)
    if (this.rallyCount >= 10) {
      const hazardRadius = Math.min(arena.width, arena.height) * 0.065;
      const hdx = nextX - arena.cx;
      const hdy = nextY - arena.cy;
      const hDist = Math.hypot(hdx, hdy);

      if (hDist < hazardRadius + this.radius) {
        const nx = hdx / (hDist || 1);
        const ny = hdy / (hDist || 1);
        const dot = this.vx * nx + this.vy * ny;
        this.vx = this.vx - 2 * dot * nx;
        this.vy = this.vy - 2 * dot * ny;
        this.x = arena.cx + nx * (hazardRadius + this.radius + 2);
        this.y = arena.cy + ny * (hazardRadius + this.radius + 2);
        playWallHit();
        this.spawnShockwave(this.x, this.y, '#D84727');
        this.game.addTrauma(0.18);
        return;
      }
    }

    // 4. Collision with active paddles
    for (const paddle of paddles) {
      if (!paddle.isJoined || paddle.isEliminated) continue;

      if (this.checkPaddleCollision(nextX, nextY, paddle)) {
        // Snap ball to predicted position before resolving so normal is computed correctly
        this.x = nextX;
        this.y = nextY;
        this.resolvePaddleCollision(paddle);
        this.consecutiveWallBounces = 0;
        nextX = this.x + this.vx * dt;
        nextY = this.y + this.vy * dt;
        break;
      }
    }

    // 5. Arena Boundary, Bumpers & Wide Goal
    this.resolveArenaCollisions(nextX, nextY, arena, paddles);
  }

  checkPaddleCollision(nextX, nextY, paddle) {
    const b = paddle.getBounds();
    const closestX = Math.max(b.left, Math.min(nextX, b.right));
    const closestY = Math.max(b.top, Math.min(nextY, b.bottom));

    const dx = nextX - closestX;
    const dy = nextY - closestY;
    return dx * dx + dy * dy <= this.radius * this.radius;
  }

  resolvePaddleCollision(paddle) {
    const b = paddle.getBounds();
    const closestX = Math.max(b.left, Math.min(this.x, b.right));
    const closestY = Math.max(b.top, Math.min(this.y, b.bottom));

    let dx = this.x - closestX;
    let dy = this.y - closestY;
    let dist = Math.hypot(dx, dy);

    let nx = 0;
    let ny = 0;

    if (dist > 0.001) {
      nx = dx / dist;
      ny = dy / dist;
    } else {
      if (paddle.side === 'bottom') ny = -1;
      else if (paddle.side === 'top') ny = 1;
      else if (paddle.side === 'left') nx = 1;
      else if (paddle.side === 'right') nx = -1;
    }

    // Inward normal enforcement
    if (paddle.side === 'bottom' && ny > -0.2) ny = -1;
    if (paddle.side === 'top' && ny < 0.2) ny = 1;
    if (paddle.side === 'left' && nx < 0.2) nx = 1;
    if (paddle.side === 'right' && nx > -0.2) nx = -1;

    const nLen = Math.hypot(nx, ny) || 1;
    nx /= nLen;
    ny /= nLen;

    // Separate ball from paddle
    this.x = closestX + nx * (this.radius + 1.5);
    this.y = closestY + ny * (this.radius + 1.5);

    // ESCALATION: Logaritmik / Azalan ivme (ralli uzadıkça hız artışı yumuşar, tepe hız tavanı aşılmaz)
    this.rallyCount++;
    this.lastHitPlayer = paddle.index;

    // Check POWER SMASH: Fast swipe > 65% of base min-speed
    const smashThreshold = this.baseMinSpeed * 0.65;
    const isSmashStrike = Math.abs(paddle.velocity) > smashThreshold;
    this.isSmash = isSmashStrike;

    // Tepe hız tavanı: baseMaxSpeed'in 1.25 katı ile sınırlandırılır (kontrolsüz hız patlamasını önler)
    const speedCap = this.baseMaxSpeed * 1.25;
    let incomingSpeed = Math.hypot(this.vx, this.vy);

    // Doygunluk eğrisi: Hız tavana yaklaştıkça vuruş başına kazanılan ek hız yumuşar
    const headroom = Math.max(0, speedCap - incomingSpeed);
    const boostStep = (isSmashStrike ? 0.25 : 0.09) * headroom;
    let targetSpeed = Math.min(speedCap, Math.max(this.baseMinSpeed, incomingSpeed + boostStep));

    this.currentMinSpeed = Math.min(speedCap * 0.9, this.baseMinSpeed + Math.min(250, this.rallyCount * 12));
    this.currentMaxSpeed = speedCap;

    if (targetSpeed > this.baseMaxSpeed * 0.95 || isSmashStrike) {
      this.spawnShockwave(this.x, this.y, isSmashStrike ? '#D84727' : '#1A1A1A');
    }
    if (targetSpeed > this.baseMaxSpeed * 1.1) {
      playSonicBoom();
    }

    // Vector reflection
    const dot = this.vx * nx + this.vy * ny;
    let rx = this.vx - 2 * dot * nx;
    let ry = this.vy - 2 * dot * ny;

    // Enforce strong inward push
    let minInward = Math.min(this.baseMinSpeed * 0.8, this.baseMinSpeed * 0.55 + this.rallyCount * (this.baseMinSpeed * 0.02));
    let vNorm = rx * nx + ry * ny;
    if (vNorm < minInward) {
      rx += nx * (minInward - vNorm);
      ry += ny * (minInward - vNorm);
    }

    // Tangential momentum transfer (Paddle sliding velocity / Falso)
    const tx = -ny;
    const ty = nx;

    let paddleTangentVel = 0;
    if (paddle.axis === 'horizontal') {
      paddleTangentVel = paddle.velocity * tx;
    } else {
      paddleTangentVel = paddle.velocity * ty;
    }
    rx += tx * (paddleTangentVel * this.spinInfluence);
    ry += ty * (paddleTangentVel * this.spinInfluence);

    // Offset curvature (convex racket curve) – scaled proportionally to arena speed
    const halfLen = paddle.length / 2;
    const curveStrength = this.baseMinSpeed * 0.19;  // ~19% of base min speed
    let offset = 0;
    if (paddle.axis === 'horizontal') {
      offset = Math.max(-1, Math.min(1, (this.x - paddle.coord) / halfLen));
      rx += offset * curveStrength;
    } else {
      offset = Math.max(-1, Math.min(1, (this.y - paddle.coord) / halfLen));
      ry += offset * curveStrength;
    }

    const newMag = Math.hypot(rx, ry) || 1;
    this.vx = (rx / newMag) * targetSpeed;
    this.vy = (ry / newMag) * targetSpeed;

    // Audio & Haptics
    const pitchIntensity = Math.min(2.2, 1.0 + this.rallyCount * 0.08);
    if (isSmashStrike) {
      playShoot();
      this.game.addTrauma(0.24);
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate([25, 40]);
      }
    } else {
      playPaddleHit(pitchIntensity);
      this.game.addTrauma(0.12 + Math.min(0.18, this.rallyCount * 0.015));
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        navigator.vibrate(18);
      }
    }
  }

  resolveArenaCollisions(nextX, nextY, arena, paddles) {
    const r = this.radius;
    const sides = ['left', 'right', 'top', 'bottom'];

    for (let i = 0; i < 4; i++) {
      const side = sides[i];
      const pIndex = side === 'bottom' ? 0 : side === 'top' ? 1 : side === 'left' ? 2 : 3;
      const paddle = paddles[pIndex];
      const isPlayerActive = paddle.isJoined && !paddle.isEliminated;
      const { goalMin, goalMax } = arena.getGoalBounds(side);

      if (side === 'left') {
        if (nextX - r <= arena.left) {
          const inGoalMouth = nextY >= goalMin && nextY <= goalMax;
          if (isPlayerActive && inGoalMouth) {
            if (nextX - r <= arena.left - 8) {
              this.handleGoal(pIndex, paddle);
              return;
            }
          } else {
            this.x = arena.left + r;
            this.vx = Math.abs(this.vx);
            this.onWallBounce(arena, 'vertical');
            return;
          }
        }
      } else if (side === 'right') {
        if (nextX + r >= arena.right) {
          const inGoalMouth = nextY >= goalMin && nextY <= goalMax;
          if (isPlayerActive && inGoalMouth) {
            if (nextX + r >= arena.right + 8) {
              this.handleGoal(pIndex, paddle);
              return;
            }
          } else {
            this.x = arena.right - r;
            this.vx = -Math.abs(this.vx);
            this.onWallBounce(arena, 'vertical');
            return;
          }
        }
      } else if (side === 'top') {
        if (nextY - r <= arena.top) {
          const inGoalMouth = nextX >= goalMin && nextX <= goalMax;
          if (isPlayerActive && inGoalMouth) {
            if (nextY - r <= arena.top - 8) {
              this.handleGoal(pIndex, paddle);
              return;
            }
          } else {
            this.y = arena.top + r;
            this.vy = Math.abs(this.vy);
            this.onWallBounce(arena, 'horizontal');
            return;
          }
        }
      } else if (side === 'bottom') {
        if (nextY + r >= arena.bottom) {
          const inGoalMouth = nextX >= goalMin && nextX <= goalMax;
          if (isPlayerActive && inGoalMouth) {
            if (nextY + r >= arena.bottom + 8) {
              this.handleGoal(pIndex, paddle);
              return;
            }
          } else {
            this.y = arena.bottom - r;
            this.vy = -Math.abs(this.vy);
            this.onWallBounce(arena, 'horizontal');
            return;
          }
        }
      }
    }

    this.x = nextX;
    this.y = nextY;
  }

  onWallBounce(arena, wallAxis = 'horizontal') {
    this.consecutiveWallBounces++;
    playWallHit();
    this.game.addTrauma(0.06);
    this.spawnShockwave(this.x, this.y, '#5E5B54');

    // Pure deterministic bounce: only ensure the ball doesn't glide 100% flat along a wall
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 1) {
      if (wallAxis === 'vertical') {
        const minVx = speed * 0.16;
        if (Math.abs(this.vx) < minVx) {
          this.vx = (this.vx >= 0 ? 1 : -1) * minVx;
          const newVy = Math.sqrt(Math.max(1, speed * speed - this.vx * this.vx));
          this.vy = (this.vy >= 0 ? 1 : -1) * newVy;
        }
      } else {
        const minVy = speed * 0.16;
        if (Math.abs(this.vy) < minVy) {
          this.vy = (this.vy >= 0 ? 1 : -1) * minVy;
          const newVx = Math.sqrt(Math.max(1, speed * speed - this.vy * this.vy));
          this.vx = (this.vx >= 0 ? 1 : -1) * newVx;
        }
      }
    }
  }

  handleGoal(playerIndex, paddle) {
    this.isDead = true;
    this.consecutiveWallBounces = 0;
    paddle.takeDamage();
    playGoal();

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([40, 50, 70]);
    }

    this.game.addTrauma(0.38);
    this.game.onPlayerScoredOn(playerIndex);
  }

  draw(ctx) {
    // Render expanding brutalist shockwaves
    for (const sw of this.shockwaves) {
      const alpha = sw.life / sw.maxLife;
      ctx.save();
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = 3 * alpha;
      ctx.stroke();
      ctx.restore();
    }

    if (this.isDead) return;

    // Dynamic Trail with Smash Flash
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const pt = this.trail[i];
      const alpha = (pt.isSmash ? 0.28 : 0.18) * (1 - i / this.trail.length);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, this.radius * (1 - i * 0.07), 0, Math.PI * 2);
      ctx.fillStyle = pt.isSmash ? `rgba(216, 71, 39, ${alpha})` : `rgba(17, 17, 17, ${alpha})`;
      ctx.fill();
    }

    // Ball Core
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.isSmash ? '#D84727' : '#111111';
    ctx.fill();

    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner highlight if smash
    if (this.isSmash) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
  }
}
