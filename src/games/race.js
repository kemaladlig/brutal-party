// Brutal Race: Parkour Race Mini-Game Engine
// Top-down arcade racing with 3-point checkpoint system, Neo-brutalist styling,
// smooth physics, AI bots, multi-touch virtual joysticks, parkour jump/wall bounce skills,
// drafting slipstream, EMP shockwaves, and 3 rotating track presets.

import { BaseMiniGame } from '../core/BaseGame.js';
import { UI_COLORS, UI_FONTS, uiFont, getUiScale } from '../ui/tokens.js';
import { renderUniversalScoreboard, renderRoundBanner, renderMatchOver, renderTopPill, renderFloatingTexts } from '../ui/hud.js';
import { renderControlGuide } from '../controlGuide.js';
import { t } from '../i18n.js';
import { RaceAI } from '../ai/raceAI.js';

export const TRACK_PRESETS = ['CIRCUIT', 'ZIGZAG', 'SPIRAL'];

export class RaceGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);

    this.ai = new RaceAI(this);
    this.targetLaps = 3;
    this.targetScore = 2; // 2 round wins for championship
    this.roundTimer = 90;
    this.roundWinner = null;
    this.matchWinner = null;
    this.floatingTexts = [];
    this.currentPreset = 'CIRCUIT';

    this.arena = {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      cx: 0,
      cy: 0,
    };

    // Track Hazards, Boost Surfaces & Effects
    this.checkpoints = [];
    this.oilSlicks = [];
    this.nitroPads = [];
    this.obstacleSpinners = [];
    this.empPulses = [];

    // Player Racers (P1..P4)
    this.players = [];
    this.initPlayers();

    this.bindStandardKeyboard((slotIndex) => {
      this.triggerDash(slotIndex);
    });

    this.resetMatch();
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((i) => ({
      index: i,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      speed: 0,
      isJoined: i === 0,
      slotType: i === 0 ? 'human' : (i === 1 ? 'bot_normal' : 'empty'),
      name: `P${i + 1}`,
      color: UI_COLORS.players[i],
      isAlive: true,

      // Racing Progress
      laps: 0,
      nextCheckpoint: 0, // 0 -> CP0, 1 -> CP1, 2 -> CP2
      lastCheckpointTime: 0,

      // Skills & Cooldowns
      dashCooldown: 0,
      isDashing: false,
      dashTimer: 0,

      // Parkour Altitude & Jump
      jumpZ: 0,
      vz: 0,
      isJumping: false,

      // Hazard, Boost & Catch-up Status
      skidTimer: 0,
      nitroBoostTimer: 0,
      draftingTimer: 0,
      isDrafting: false,
      empDisruptedTimer: 0,

      // Status
      stalledTime: 0,
    }));
  }

  buildArena() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const margin = Math.min(w, h) * 0.08;

    const left = margin;
    const top = margin + 30;
    const right = w - margin;
    const bottom = h - margin - 20;
    const arenaW = right - left;
    const arenaH = bottom - top;

    this.arena = {
      left,
      top,
      right,
      bottom,
      width: arenaW,
      height: arenaH,
      cx: left + arenaW / 2,
      cy: top + arenaH / 2,
    };

    this.applyTrackPreset(this.currentPreset);
  }

  applyTrackPreset(presetName) {
    this.currentPreset = presetName;
    const a = this.arena;
    const cpRadius = Math.min(a.width, a.height) * 0.12;

    if (presetName === 'ZIGZAG') {
      // ZigZag Deathrun
      this.checkpoints = [
        { id: 0, name: 'CP 1', x: a.left + a.width * 0.85, y: a.top + a.height * 0.25, radius: cpRadius, color: '#FFDE59' },
        { id: 1, name: 'CP 2', x: a.left + a.width * 0.15, y: a.top + a.height * 0.5, radius: cpRadius, color: '#3B82F6' },
        { id: 2, name: 'CP 3', x: a.left + a.width * 0.85, y: a.top + a.height * 0.85, radius: cpRadius, color: '#22C55E' },
      ];

      this.oilSlicks = [
        { x: a.left + a.width * 0.5, y: a.top + a.height * 0.35, radius: 30 },
        { x: a.left + a.width * 0.5, y: a.top + a.height * 0.65, radius: 30 },
      ];

      this.nitroPads = [
        { x: a.left + a.width * 0.2, y: a.top + a.height * 0.2, w: 42, h: 28, angle: 0 },
        { x: a.left + a.width * 0.8, y: a.top + a.height * 0.6, w: 42, h: 28, angle: Math.PI / 2 },
      ];

      this.obstacleSpinners = [
        { x: a.left + a.width * 0.35, y: a.top + a.height * 0.35, length: 110, angle: 0, rotSpeed: 1.5 },
        { x: a.left + a.width * 0.65, y: a.top + a.height * 0.65, length: 110, angle: Math.PI / 4, rotSpeed: -1.5 },
      ];
    } else if (presetName === 'SPIRAL') {
      // Spiral Parkour
      this.checkpoints = [
        { id: 0, name: 'CP 1', x: a.left + a.width * 0.5, y: a.top + a.height * 0.2, radius: cpRadius, color: '#FFDE59' },
        { id: 1, name: 'CP 2', x: a.left + a.width * 0.85, y: a.top + a.height * 0.75, radius: cpRadius, color: '#3B82F6' },
        { id: 2, name: 'CP 3', x: a.left + a.width * 0.15, y: a.top + a.height * 0.75, radius: cpRadius, color: '#22C55E' },
      ];

      this.oilSlicks = [
        { x: a.left + a.width * 0.3, y: a.top + a.height * 0.45, radius: 28 },
        { x: a.left + a.width * 0.7, y: a.top + a.height * 0.45, radius: 28 },
      ];

      this.nitroPads = [
        { x: a.left + a.width * 0.5, y: a.top + a.height * 0.85, w: 45, h: 28, angle: Math.PI },
      ];

      this.obstacleSpinners = [
        { x: a.left + a.width * 0.5, y: a.top + a.height * 0.5, length: 140, angle: 0, rotSpeed: 2.0 },
      ];
    } else {
      // Circuit Classic
      this.checkpoints = [
        { id: 0, name: 'CP 1', x: a.left + a.width * 0.8, y: a.top + a.height * 0.5, radius: cpRadius, color: '#FFDE59' },
        { id: 1, name: 'CP 2', x: a.left + a.width * 0.25, y: a.top + a.height * 0.25, radius: cpRadius, color: '#3B82F6' },
        { id: 2, name: 'CP 3', x: a.left + a.width * 0.25, y: a.top + a.height * 0.75, radius: cpRadius, color: '#22C55E' },
      ];

      this.oilSlicks = [
        { x: a.left + a.width * 0.55, y: a.top + a.height * 0.3, radius: 26 },
        { x: a.left + a.width * 0.55, y: a.top + a.height * 0.7, radius: 26 },
      ];

      this.nitroPads = [
        { x: a.left + a.width * 0.8, y: a.top + a.height * 0.2, w: 40, h: 28, angle: -Math.PI / 4 },
        { x: a.left + a.width * 0.45, y: a.top + a.height * 0.85, w: 40, h: 28, angle: Math.PI },
      ];

      this.obstacleSpinners = [
        { x: a.left + a.width * 0.5, y: a.top + a.height * 0.5, length: 110, angle: 0, rotSpeed: 1.2 },
      ];
    }
  }

  resetMatch() {
    this.scores = [0, 0, 0, 0];
    this.state = 'LOBBY';
    this.roundWinner = null;
    this.matchWinner = null;
    this.floatingTexts = [];
    this.empPulses = [];
    this.buildArena();
    this.resetRacers();
  }

  resetRacers() {
    const a = this.arena;
    const startX = a.left + a.width * 0.2;
    const startYBase = a.top + a.height * 0.75;

    this.players.forEach((p, i) => {
      p.x = startX - (i % 2) * 32;
      p.y = startYBase + (i - 1.5) * 28;
      p.vx = 0;
      p.vy = 0;
      p.speed = 0;
      p.angle = -Math.PI / 2; // Facing upward
      p.laps = 0;
      p.nextCheckpoint = 0;
      p.lastCheckpointTime = performance.now();
      p.dashCooldown = 0;
      p.isDashing = false;
      p.dashTimer = 0;
      p.jumpZ = 0;
      p.vz = 0;
      p.isJumping = false;
      p.skidTimer = 0;
      p.nitroBoostTimer = 0;
      p.draftingTimer = 0;
      p.isDrafting = false;
      p.empDisruptedTimer = 0;
      p.isAlive = p.isJoined;
    });
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.startRound();
  }

  startRound() {
    this.state = 'PLAYING';
    this.roundTimer = 90;
    this.roundWinner = null;
    // Rotate track preset per round
    const nextPreset = TRACK_PRESETS[(TRACK_PRESETS.indexOf(this.currentPreset) + 1) % TRACK_PRESETS.length];
    this.applyTrackPreset(nextPreset);
    this.resetRacers();
    this.floatingTexts = [];
    this.empPulses = [];
  }

  getLeaderIndex() {
    let leader = -1;
    let maxProgress = -1;
    this.players.forEach((p) => {
      if (!p.isJoined) return;
      const progress = p.laps * 10 + p.nextCheckpoint;
      if (progress > maxProgress) {
        maxProgress = progress;
        leader = p.index;
      }
    });
    return leader;
  }

  triggerDash(slotIndex) {
    if (this.state !== 'PLAYING') return;
    const p = this.players[slotIndex];
    if (!p || !p.isJoined || !p.isAlive) return;

    if (p.dashCooldown <= 0) {
      p.dashCooldown = 2.8; // 2.8s cooldown
      p.isDashing = true;
      p.dashTimer = 0.38;

      // Launch Parkour Jump
      p.isJumping = true;
      p.vz = 14; // Jump launch velocity

      this.addTrauma(0.2);

      // Trailing racer EMP Shockwave Pulse skill trigger
      const leaderIdx = this.getLeaderIndex();
      if (leaderIdx >= 0 && leaderIdx !== p.index) {
        this.empPulses.push({
          x: p.x,
          y: p.y,
          radius: 10,
          maxRadius: 130,
          owner: p.index,
        });

        this.floatingTexts.push({
          x: p.x,
          y: p.y - 22,
          text: 'PARKOUR EMP ŞOKU! ⚡',
          color: '#0EA5E9',
          bg: UI_COLORS.ink,
          pop: true,
        });
      } else {
        this.floatingTexts.push({
          x: p.x,
          y: p.y - 18,
          text: 'PARKOUR DASH! ⤴️',
          color: '#FFDE59',
          bg: UI_COLORS.ink,
          pop: true,
        });
      }
    }
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY') {
      this.handleUiTap(touch);
    } else if (this.state === 'PLAYING') {
      this.handleStandardJoystickTouchStart(touch, (slotIndex) => this.triggerDash(slotIndex));
    }
  }

  onTouchMove(touch) {
    if (this.state === 'PLAYING') {
      this.handleStandardJoystickTouchMove(touch);
    }
  }

  onTouchEnd(touch) {
    if (this.state === 'PLAYING') {
      this.handleStandardJoystickTouchEnd(touch);
    }
  }

  handleRemoteInput(slotIndex, data) {
    if (slotIndex < 0 || slotIndex > 3) return;
    if (data.action === 'DASH' || data.action === 'TANK_FIRE') {
      this.triggerDash(slotIndex);
      return;
    }
    this.handleStandardRemoteJoystick(slotIndex, data);
  }

  update(now) {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.updateTrauma(dt);

    if (this.state === 'LOBBY') {
      this.uiButtons = [];
      return;
    }

    if (this.state === 'ROUND_OVER' || this.state === 'MATCH_OVER') {
      return;
    }

    if (this.state === 'PLAYING') {
      this.roundTimer = Math.max(0, this.roundTimer - dt);

      // Update Obstacle Spinners
      this.obstacleSpinners.forEach((sp) => {
        sp.angle += sp.rotSpeed * dt;
      });

      // Update EMP Pulses
      for (let k = this.empPulses.length - 1; k >= 0; k--) {
        const pulse = this.empPulses[k];
        pulse.radius += 240 * dt;

        this.players.forEach((target) => {
          if (!target.isJoined || target.index === pulse.owner) return;
          const dist = Math.hypot(target.x - pulse.x, target.y - pulse.y);
          if (dist <= pulse.radius && dist >= pulse.radius - 30) {
            if (target.empDisruptedTimer <= 0 && target.jumpZ < 10) {
              target.empDisruptedTimer = 1.2;
              this.addTrauma(0.2);
              this.floatingTexts.push({
                x: target.x,
                y: target.y - 18,
                text: 'EMP ŞOKU! ⚡',
                color: '#0EA5E9',
                bg: UI_COLORS.card,
                urgent: true,
              });
            }
          }
        });

        if (pulse.radius >= pulse.maxRadius) {
          this.empPulses.splice(k, 1);
        }
      }

      // AI Bot Updates
      this.ai.update(dt);

      // Racers Physics, Parkour Jump, Hazards, Drafting, and Wall Bounce
      this.players.forEach((p, i) => {
        if (!p.isJoined || !p.isAlive) return;

        // Timers
        if (p.dashCooldown > 0) p.dashCooldown = Math.max(0, p.dashCooldown - dt);
        if (p.dashTimer > 0) p.dashTimer = Math.max(0, p.dashTimer - dt);
        if (p.dashTimer <= 0) p.isDashing = false;

        if (p.skidTimer > 0) p.skidTimer = Math.max(0, p.skidTimer - dt);
        if (p.nitroBoostTimer > 0) p.nitroBoostTimer = Math.max(0, p.nitroBoostTimer - dt);
        if (p.empDisruptedTimer > 0) p.empDisruptedTimer = Math.max(0, p.empDisruptedTimer - dt);

        // Vertical Jump Altitude & Gravity
        if (p.isJumping || p.jumpZ > 0) {
          p.jumpZ += p.vz;
          p.vz -= 45 * dt; // Gravity
          if (p.jumpZ <= 0) {
            p.jumpZ = 0;
            p.vz = 0;
            p.isJumping = false;
          }
        }

        // Drafting / Slipstream Detection
        p.isDrafting = false;
        this.players.forEach((other) => {
          if (other.index === p.index || !other.isJoined) return;
          const dx = other.x - p.x;
          const dy = other.y - p.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 20 && dist < 90) {
            const angleToOther = Math.atan2(dy, dx);
            let angleDiff = Math.abs(angleToOther - p.angle);
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            angleDiff = Math.abs(angleDiff);

            if (angleDiff < 0.4 && other.speed > 50) {
              p.isDrafting = true;
              p.draftingTimer += dt;
            }
          }
        });

        if (!p.isDrafting) {
          p.draftingTimer = Math.max(0, p.draftingTimer - dt * 2);
        }

        // Movement Input
        let moveVec = { x: 0, y: 0, active: false };

        if (p.slotType === 'human') {
          moveVec = this.getPlayerMovementVector(i);
        } else if (p.slotType === 'bot_normal' || p.slotType === 'bot_god') {
          moveVec = this.ai.getBotMovement(i);
        }

        // Speed & Acceleration Caps
        let maxSpeed = 190;
        let accel = 420;
        let friction = 0.94;

        if (p.isDashing || p.nitroBoostTimer > 0) {
          maxSpeed = 330;
          accel = 850;
        }

        if (p.isDrafting && p.draftingTimer > 0.4) {
          maxSpeed *= 1.25;
          accel *= 1.3;
        }

        if (p.skidTimer > 0 && p.jumpZ < 5) {
          maxSpeed *= 0.6;
          accel *= 0.4;
          friction = 0.98;
          p.angle += (i % 2 === 0 ? 4 : -4) * dt;
        }

        if (p.empDisruptedTimer > 0) {
          maxSpeed *= 0.45;
          accel *= 0.3;
        }

        if (moveVec.active && p.skidTimer <= 0 && p.empDisruptedTimer <= 0) {
          const targetAngle = Math.atan2(moveVec.y, moveVec.x);
          let diff = targetAngle - p.angle;
          while (diff < -Math.PI) diff += Math.PI * 2;
          while (diff > Math.PI) diff -= Math.PI * 2;
          p.angle += diff * Math.min(1.0, dt * 10);

          p.vx += Math.cos(p.angle) * accel * dt;
          p.vy += Math.sin(p.angle) * accel * dt;
        }

        p.vx *= friction;
        p.vy *= friction;

        const currentSpeed = Math.hypot(p.vx, p.vy);
        if (currentSpeed > maxSpeed) {
          p.vx = (p.vx / currentSpeed) * maxSpeed;
          p.vy = (p.vy / currentSpeed) * maxSpeed;
        }
        p.speed = currentSpeed;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Arena Wall Collisions with Parkour Wall Bounce Effect
        const radius = 16;
        const a = this.arena;
        let hitWall = false;

        if (p.x - radius < a.left) {
          p.x = a.left + radius;
          p.vx = Math.abs(p.vx) * (p.isJumping ? 1.4 : 0.5);
          hitWall = true;
        }
        if (p.x + radius > a.right) {
          p.x = a.right - radius;
          p.vx = -Math.abs(p.vx) * (p.isJumping ? 1.4 : 0.5);
          hitWall = true;
        }
        if (p.y - radius < a.top) {
          p.y = a.top + radius;
          p.vy = Math.abs(p.vy) * (p.isJumping ? 1.4 : 0.5);
          hitWall = true;
        }
        if (p.y + radius > a.bottom) {
          p.y = a.bottom - radius;
          p.vy = -Math.abs(p.vy) * (p.isJumping ? 1.4 : 0.5);
          hitWall = true;
        }

        if (hitWall && p.isJumping) {
          this.addTrauma(0.25);
          p.angle = Math.atan2(p.vy, p.vx);
          this.floatingTexts.push({
            x: p.x,
            y: p.y - 18,
            text: 'DUVARDAN ZIPLAMA! 🧱',
            color: '#FFDE59',
            bg: UI_COLORS.ink,
            pop: true,
          });
        }

        // Hazard Collision: Oil Slicks (Jumping airborne racers bypass oil slicks!)
        if (p.jumpZ < 8) {
          this.oilSlicks.forEach((slick) => {
            const dist = Math.hypot(p.x - slick.x, p.y - slick.y);
            if (dist < slick.radius + radius) {
              if (p.skidTimer <= 0) {
                p.skidTimer = 0.8;
                this.addTrauma(0.15);
                this.floatingTexts.push({
                  x: p.x,
                  y: p.y - 15,
                  text: 'KAYMA! ⚠️',
                  color: '#1A1A1A',
                  bg: '#FFDE59',
                });
              }
            }
          });
        }

        // Hazard Collision: Nitro Pads
        this.nitroPads.forEach((pad) => {
          const dist = Math.hypot(p.x - pad.x, p.y - pad.y);
          if (dist < 28) {
            if (p.nitroBoostTimer <= 0) {
              p.nitroBoostTimer = 0.75;
              p.vx = Math.cos(pad.angle) * 330;
              p.vy = Math.sin(pad.angle) * 330;
              this.addTrauma(0.2);
              this.floatingTexts.push({
                x: p.x,
                y: p.y - 15,
                text: 'TURBO BOOST! ⚡',
                color: '#25D366',
                bg: UI_COLORS.ink,
                pop: true,
              });
            }
          }
        });

        // Hazard Collision: Obstacle Spinners (Airborne jumpers bypass low spinners!)
        if (p.jumpZ < 10) {
          this.obstacleSpinners.forEach((sp) => {
            const halfLen = sp.length / 2;
            const p1x = sp.x - Math.cos(sp.angle) * halfLen;
            const p1y = sp.y - Math.sin(sp.angle) * halfLen;
            const p2x = sp.x + Math.cos(sp.angle) * halfLen;
            const p2y = sp.y + Math.sin(sp.angle) * halfLen;

            const l2 = (p2x - p1x) ** 2 + (p2y - p1y) ** 2;
            let tParam = 0;
            if (l2 > 0) {
              tParam = Math.max(0, Math.min(1, ((p.x - p1x) * (p2x - p1x) + (p.y - p1y) * (p2y - p1y)) / l2));
            }
            const projX = p1x + tParam * (p2x - p1x);
            const projY = p1y + tParam * (p2y - p1y);
            const distToSpinner = Math.hypot(p.x - projX, p.y - projY);

            if (distToSpinner < radius + 8) {
              const pushAngle = Math.atan2(p.y - projY, p.x - projX);
              p.vx = Math.cos(pushAngle) * 220;
              p.vy = Math.sin(pushAngle) * 220;
              this.addTrauma(0.25);
              this.floatingTexts.push({
                x: p.x,
                y: p.y - 15,
                text: 'ÇARPIŞMA! 💥',
                color: '#D84727',
                bg: UI_COLORS.card,
                urgent: true,
              });
            }
          });
        }

        // Checkpoint Collision Logic
        const targetCP = this.checkpoints[p.nextCheckpoint];
        if (targetCP) {
          const distToCP = Math.hypot(p.x - targetCP.x, p.y - targetCP.y);
          if (distToCP < targetCP.radius + radius) {
            const cpName = targetCP.name;
            p.nextCheckpoint = (p.nextCheckpoint + 1) % 3;

            if (p.nextCheckpoint === 0) {
              p.laps += 1;
              this.floatingTexts.push({
                x: p.x,
                y: p.y - 20,
                text: `TUR ${p.laps}/${this.targetLaps}!`,
                color: p.color,
                bg: UI_COLORS.card,
                pop: true,
              });

              if (p.laps >= this.targetLaps) {
                this.endRound(p);
              }
            } else {
              this.floatingTexts.push({
                x: p.x,
                y: p.y - 18,
                text: `${cpName} ✓`,
                color: targetCP.color,
                bg: UI_COLORS.ink,
              });
            }
          }
        }
      });

      // Player-to-Player Collisions (Bumper Cars)
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          const p1 = this.players[i];
          const p2 = this.players[j];
          if (!p1.isJoined || !p2.isJoined) continue;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const dist = Math.hypot(dx, dy);
          const minDist = 32;

          if (dist < minDist && dist > 0.001) {
            const overlap = (minDist - dist) / 2;
            const nx = dx / dist;
            const ny = dy / dist;

            p1.x -= nx * overlap;
            p1.y -= ny * overlap;
            p2.x += nx * overlap;
            p2.y += ny * overlap;

            const tempVx = p1.vx;
            const tempVy = p1.vy;
            p1.vx = p2.vx * 0.8 - nx * 40;
            p1.vy = p2.vy * 0.8 - ny * 40;
            p2.vx = tempVx * 0.8 + nx * 40;
            p2.vy = tempVy * 0.8 + ny * 40;
            this.addTrauma(0.1);
          }
        }
      }

      // Time Over Check
      if (this.roundTimer <= 0) {
        let bestRacer = null;
        let bestScore = -1;

        this.players.forEach((p) => {
          if (!p.isJoined) return;
          const score = p.laps * 10 + p.nextCheckpoint;
          if (score > bestScore) {
            bestScore = score;
            bestRacer = p;
          }
        });

        if (bestRacer) {
          this.endRound(bestRacer);
        } else {
          this.endRound(null);
        }
      }
    }
  }

  endRound(winner) {
    this.roundWinner = winner;
    if (winner) {
      this.scores[winner.index] += 1;
      this.addTrauma(0.5);

      if (this.scores[winner.index] >= this.targetScore) {
        this.matchWinner = winner;
        this.state = 'MATCH_OVER';
      } else {
        this.state = 'ROUND_OVER';
        setTimeout(() => {
          if (this.state === 'ROUND_OVER') {
            this.startRound();
          }
        }, 2500);
      }
    } else {
      this.state = 'ROUND_OVER';
      setTimeout(() => {
        if (this.state === 'ROUND_OVER') {
          this.startRound();
        }
      }, 2500);
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Layer 0: Background
    ctx.fillStyle = UI_COLORS.paperOutside;
    ctx.fillRect(0, 0, w, h);

    this.applyScreenShake(ctx);

    if (this.state === 'LOBBY') {
      this.renderStandardLobby(ctx, {
        arena: this.arena,
        accent: '#FFDE59',
        customControls: (c) => {
          c.save();
          c.fillStyle = UI_COLORS.ink;
          c.font = `900 16px ${UI_FONTS.mono}`;
          c.textAlign = 'center';
          c.fillText(`🏁 BRUTAL RACE // ${this.currentPreset} 🏁`, this.arena.cx, this.arena.top + 28);
          c.restore();
        },
      });
      ctx.restore();
      return;
    }

    // Layer 1: Arena Floor & Grid
    const a = this.arena;
    ctx.fillStyle = UI_COLORS.paperWarm;
    ctx.fillRect(a.left, a.top, a.width, a.height);
    ctx.strokeStyle = UI_COLORS.ink;
    ctx.lineWidth = 4;
    ctx.strokeRect(a.left, a.top, a.width, a.height);

    // Grid lines
    ctx.strokeStyle = 'rgba(26, 26, 26, 0.06)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = a.left; x < a.right; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
    }
    for (let y = a.top; y < a.bottom; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(a.left, y); ctx.lineTo(a.right, y); ctx.stroke();
    }

    // Layer 2: Surfaces, Hazards, EMP Rings
    // EMP Shockwave Rings
    this.empPulses.forEach((pulse) => {
      ctx.save();
      ctx.strokeStyle = '#0EA5E9';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(pulse.x, pulse.y, pulse.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });

    // Oil Slicks
    this.oilSlicks.forEach((slick) => {
      ctx.save();
      ctx.fillStyle = 'rgba(26, 26, 26, 0.75)';
      ctx.beginPath();
      ctx.arc(slick.x, slick.y, slick.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#FFDE59';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });

    // Nitro Boost Pads
    this.nitroPads.forEach((pad) => {
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.rotate(pad.angle);
      ctx.fillStyle = '#FFDE59';
      ctx.fillRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(-pad.w / 2, -pad.h / 2, pad.w, pad.h);

      ctx.fillStyle = UI_COLORS.ink;
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.lineTo(-6, -6);
      ctx.lineTo(-6, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });

    // Obstacle Spinners
    this.obstacleSpinners.forEach((sp) => {
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(sp.angle);

      ctx.fillStyle = '#D84727';
      ctx.fillRect(-sp.length / 2, -8, sp.length, 16);
      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = 3;
      ctx.strokeRect(-sp.length / 2, -8, sp.length, 16);

      ctx.fillStyle = UI_COLORS.ink;
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // Layer 3: Checkpoints (CP 1, CP 2, CP 3)
    this.checkpoints.forEach((cp) => {
      ctx.save();
      ctx.fillStyle = cp.color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, cp.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = cp.color;
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = UI_COLORS.ink;
      ctx.font = `900 16px ${UI_FONTS.mono}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cp.name, cp.x, cp.y);
      ctx.restore();
    });

    // Layer 4: Watermark Timer
    if (this.state === 'PLAYING') {
      renderTopPill(this.ctx, {
        arena: a,
        text: `🏁 ${this.currentPreset} • ⏱️ ${Math.ceil(this.roundTimer)}s`,
        urgent: this.roundTimer <= 15,
        customW: 180,
      });
    }

    // Layer 5: Active Entities (Racers & Slipstream Visuals)
    this.players.forEach((p) => {
      if (!p.isJoined || !p.isAlive) return;

      // Render Slipstream wind lines if drafting
      if (p.isDrafting) {
        ctx.save();
        ctx.strokeStyle = '#38BDF8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - Math.cos(p.angle) * 35, p.y - Math.sin(p.angle) * 35);
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      // Render vehicle with vertical jump elevation scale and offset
      const jumpScale = 1.0 + Math.min(0.5, p.jumpZ * 0.025);
      const jumpOffsetY = -p.jumpZ * 0.8;

      ctx.translate(p.x, p.y + jumpOffsetY);
      ctx.scale(jumpScale, jumpScale);
      ctx.rotate(p.angle);

      // Vehicle Drop Shadow if airborne
      if (p.jumpZ > 2) {
        ctx.save();
        ctx.fillStyle = 'rgba(26, 26, 26, 0.25)';
        ctx.beginPath();
        ctx.ellipse(0, p.jumpZ * 0.8, 14, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Dash & Turbo Trail
      if (p.isDashing || p.nitroBoostTimer > 0) {
        ctx.fillStyle = '#FFDE59';
        ctx.fillRect(-28, -8, 14, 16);
      }

      // EMP Spark Visual
      if (p.empDisruptedTimer > 0) {
        ctx.strokeStyle = '#0EA5E9';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 20, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Racer Vehicle Body (Brutalist Polygon)
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(16, 0);
      ctx.lineTo(-12, -10);
      ctx.lineTo(-8, 0);
      ctx.lineTo(-12, 10);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = UI_COLORS.ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Cockpit / Pip
      ctx.fillStyle = UI_COLORS.ink;
      ctx.beginPath();
      ctx.arc(2, 0, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // Checkpoint Indicator Arrow
      const targetCP = this.checkpoints[p.nextCheckpoint];
      if (targetCP && this.state === 'PLAYING') {
        const arrowAngle = Math.atan2(targetCP.y - p.y, targetCP.x - p.x);
        ctx.save();
        ctx.translate(p.x + Math.cos(arrowAngle) * 26, p.y + Math.sin(arrowAngle) * 26);
        ctx.rotate(arrowAngle);
        ctx.fillStyle = targetCP.color;
        ctx.beginPath();
        ctx.moveTo(6, 0);
        ctx.lineTo(-4, -4);
        ctx.lineTo(-4, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    });

    // Layer 6: Overhead Floating Texts & Indicators
    renderFloatingTexts(ctx, this.floatingTexts);

    // Layer 7: Translucent On-Screen HUD & Touch Controls
    this.renderStandardJoysticks(ctx);

    const hudPlayers = this.players.map((p) => ({
      index: p.index,
      name: p.name,
      color: p.color,
      isJoined: p.isJoined,
      slotType: p.slotType,
    }));

    renderUniversalScoreboard(ctx, {
      arena: a,
      players: hudPlayers,
      scores: this.scores,
      targetScore: this.targetScore,
      entities: this.players,
      layout: 'corners',
    });

    renderControlGuide(ctx, a, t('guide.race'), [
      'P1: WASD + SPACE',
      'P2: OKLAR + ENTER',
      'P3: IJKL + O',
      'P4: TFGH + B',
    ]);

    // Round / Match Banners
    if (this.state === 'ROUND_OVER') {
      const winnerName = this.roundWinner ? this.roundWinner.name : t('game.draw');
      renderRoundBanner(ctx, {
        arena: a,
        title: `${winnerName} ${t('game.won') || 'TURU KAZANDI!'}`,
        titleColor: this.roundWinner ? this.roundWinner.color : UI_COLORS.ink,
        sub: `HEDEF: ${this.targetScore} TUR ZAFERİ`,
      });
    } else if (this.state === 'MATCH_OVER') {
      const rows = this.players.filter((p) => p.isJoined).map((p) => ({
        text: `${p.name}: ${this.scores[p.index]} TUR`,
        color: p.color,
      }));

      renderMatchOver(ctx, {
        arena: a,
        uiButtons: this.uiButtons,
        headline: t('game.champWon') || 'ŞAMPİYONLUĞU KAZANDI!',
        winnerName: this.matchWinner ? this.matchWinner.name : '',
        winnerColor: this.matchWinner ? this.matchWinner.color : UI_COLORS.ink,
        rows,
        onRestart: () => this.startNewMatch(),
      });
    }

    ctx.restore();
  }

  resize(w, h) {
    const oldArena = { ...this.arena };
    this.canvas.width = w;
    this.canvas.height = h;
    this.buildArena();

    if (this.state === 'LOBBY') {
      this.resetRacers();
    } else {
      this.players.forEach((p) => {
        this.remapPoint(p, oldArena, this.arena);
      });
    }
  }
}
