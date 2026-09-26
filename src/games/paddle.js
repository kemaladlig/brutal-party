// Paddle entity: movement, physics bounds & brutalist rendering.
// Bot kararı src/ai/pongAI.js'tedir (diğer motorlarla aynı desen).

import { getSlotCustomization, getBotPersona } from '../core/customizationManager.js';
import { t } from '../i18n.js';
import { updatePongBotAI as runPongBotAI } from '../ai/pongAI.js';

export const PLAYER_CONFIGS = [
  { index: 0, name: 'P1', side: 'bottom', axis: 'horizontal', color: '#D84727' },
  { index: 1, name: 'P2', side: 'top', axis: 'horizontal', color: '#1D5D8A' },
  { index: 2, name: 'P3', side: 'left', axis: 'vertical', color: '#D99B26' },
  { index: 3, name: 'P4', side: 'right', axis: 'vertical', color: '#2F6A4F' },
];

export class Paddle {
  constructor(config, game) {
    this.index = config.index;
    this.name = config.name;
    this.side = config.side;
    this.axis = config.axis;
    this.color = getSlotCustomization(config.index).color || config.color;
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

    // 🌀 Falso şarjı (>0 iken topa değerse kavis verir, sonra söner)
    this.spinCharge = 0;
  }

  get spinCooldown() {
    return this.game?.spinCooldowns?.[this.index] || 0;
  }

  cycleSlotType() {
    if (this.slotType === 'empty') {
      this.slotType = 'human';
      this.isJoined = true;
      const custom = getSlotCustomization(this.index);
      this.name = custom.name || `P${this.index + 1}`;
      this.color = custom.color || PLAYER_CONFIGS[this.index].color;
    } else if (this.slotType === 'human') {
      this.slotType = 'bot_normal';
      this.isJoined = true;
      const persona = getBotPersona(this.index, false);
      this.name = persona.name;
      this.color = persona.color;
    } else if (this.slotType === 'bot_normal') {
      this.slotType = 'bot_god';
      this.isJoined = true;
      const persona = getBotPersona(this.index, true);
      this.name = persona.name;
      this.color = persona.color;
    } else {
      this.slotType = 'empty';
      this.isJoined = false;
      this.name = `P${this.index + 1}`;
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
    this.spinCharge = 0;
    this.centerInBounds();
  }

  updateLayout(arena) {
    const horizDim = arena.width  || arena.size;
    const vertDim  = arena.height || arena.size;
    const minDim = Math.min(horizDim, vertDim);

    const goalBounds = arena.getGoalBounds ? arena.getGoalBounds(this.side) : null;
    const goalSpan = goalBounds ? (goalBounds.goalMax - goalBounds.goalMin) : Math.round(minDim * 0.70);

    // Paddle spans ~32% of the goal opening – fair and balanced on all walls.
    // Üst sınır: dar kenarda hareket payı kalsın (range = span - length > 0).
    this.length    = Math.min(goalSpan * 0.8, Math.max(68, Math.floor(goalSpan * 0.32)));
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
    if (Number.isFinite(this.minCoord) && Number.isFinite(this.maxCoord)) {
      this.coord = (this.minCoord + this.maxCoord) / 2;
      this.targetCoord = this.coord;
      this.prevCoord = this.coord;
    }
    this.velocity = 0;
  }

  setTarget(value) {
    if (!this.isJoined || this.isEliminated) return;
    this.targetCoord = Math.max(this.minCoord, Math.min(this.maxCoord, value));
  }

  update(dt) {
    if (!this.isJoined || this.isEliminated) return;

    // Falso şarj penceresi erir (kullanılmasa da söner)
    if (this.spinCharge > 0) {
      this.spinCharge = Math.max(0, this.spinCharge - dt);
    }

    // Run AI Controller if bot (karar motoru: src/ai/pongAI.js)
    if (this.isBot && this.game.state === 'PLAYING') {
      runPongBotAI(this.game, this, dt);
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

  takeDamage() {
    if (this.isEliminated) return;
    this.lives = Math.max(0, this.lives - 1);
    if (this.lives === 0) {
      this.isEliminated = true;
      this.spinCharge = 0;
    }
  }

  getBounds() {
    let curLen = this.length;
    // Progresif daralma: ralli 6'dan sonra her vuruşta %2.5 kısalır (%62 taban).
    // Ani kademe yerine yumuşak baskı; hareket payı etkilenmez (sadece boy).
    const rally = (this.game && this.game.ball && this.game.ball.rallyCount) || 0;
    if (rally >= 6) {
      curLen = Math.max(60, this.length * Math.max(0.62, 1 - (rally - 6) * 0.025));
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

    const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = Math.max(1.5, 3 * u);
    ctx.strokeRect(bounds.left, bounds.top, w, h);

    // If bot, draw bot indicator badge inside paddle
    if (this.isBot) {
      ctx.save();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '900 12px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const persona = getBotPersona(this.index, this.isGodBot);
      ctx.fillText(persona.name, this.coord, this.fixedPerpendicular);
      ctx.restore();
    }

    // Skor köşelerde (renderCornerScores); raket yanında yalnız canlar durur
    {
      ctx.save();
      const count = Math.max(0, Math.floor(this.lives || 0));
      const livesStr = count > 0 ? '● '.repeat(count).trim() : t('pad.out');

      if (this.axis === 'horizontal') {
        ctx.fillStyle = this.color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '900 20px "JetBrains Mono", monospace';
        ctx.fillText(livesStr, bounds.right + 20, this.fixedPerpendicular);
      } else {
        ctx.fillStyle = this.color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.font = '900 20px "JetBrains Mono", monospace';
        ctx.fillText(livesStr, this.fixedPerpendicular, bounds.bottom + 16);
      }
      ctx.restore();
    }

    // Falso şarj göstergesi: altın çerçeve + kalan süre çipi
    if (this.spinCharge > 0) {
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#D99B26';
      ctx.lineWidth = Math.max(2, 4 * u);
      ctx.strokeRect(bounds.left - 4, bounds.top - 4, w + 8, h + 8);
      ctx.globalAlpha = 1;

      const chipW = 104;
      const chipH = 42;
      const chipX = (bounds.left + bounds.right) / 2 - chipW / 2;
      const chipY = (bounds.top + bounds.bottom) / 2 - chipH / 2;
      ctx.fillStyle = '#1A1A1A';
      ctx.fillRect(chipX, chipY, chipW, chipH);
      ctx.fillStyle = '#FFDE59';
      ctx.font = '900 20px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`SPIN ${this.spinCharge.toFixed(1)}`, chipX + chipW / 2, chipY + chipH / 2 + 1);
      ctx.restore();
    }
  }

  drawFullClosedWall(ctx, arena) {
    const u = arena?.unit ?? (arena?.size ? arena.size / 952 : 1);
    const wallThick = Math.max(12, 20 * u);
    ctx.fillStyle = '#938F86';
    ctx.strokeStyle = '#1C1C1A';
    ctx.lineWidth = Math.max(1.5, 3 * u);

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
    ctx.lineWidth = Math.max(1, 2 * u);
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
