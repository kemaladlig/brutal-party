import { BaseMiniGame } from '../core/BaseGame.js';
import { resolveAABB, clampToArena } from '../core/physics2d.js';
import { createPlayer } from '../core/playerEntity.js';
import { drawGameAvatar, normalizeExpression } from '../core/avatarInGame.js';
import { spawnPickup, collectPickups, tickPickupTimers } from '../core/pickupSystem.js';
import { updateHordeBotAI } from '../ai/hordeAI.js';
import { t } from '../i18n.js';
import { UI_COLORS, getDisplayProfile } from '../ui/tokens.js';

export const HORDE_TUNING = {
  MAX_HP: 5,
  DASH_TIME: 0.25,
  DASH_SPEED_MULT: 2.8,
  DASH_CD: 4.0,
  MOVE_SPEED: 180,
  RESPAWN: 3.0,
  SPAWN_PROTECT: 2.0,
  ARENA_PADDING: 20
};

export class HordeGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.players = [];
    this.scores = [0, 0, 0, 0];
    this.slotTypes = ['human', 'empty', 'empty', 'empty'];
    this.projectiles = [];
    this.pickups = [];
    this.enemies = [];
    this.tombs = [];
    this.portal = null;
    this.pickupTimer = 0;
    this.round = 1;
    this.wave = 1;
    this.state = 'LOBBY'; // LOBBY, STAGING, PLAYING, ROUND_OVER, GAMEOVER

    for (let i = 0; i < 4; i++) {
      this.players.push(createPlayer(i, { x: 0, y: 0, angle: 0 }, {
        isAlive: false,
        isJoined: false,
        slotType: 'empty'
      }));
    }
  }

  resetMatch() {
    this.scores = [0, 0, 0, 0];
    this.round = 1;
    this.wave = 1;
    this.projectiles = [];
    this.pickups = [];
    this.enemies = [];
    this.tombs = [];
    this.portal = null;
    this.pickupTimer = 5.0;
    this.state = 'STAGING';

    // Position players around center
    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      p.isJoined = this.isSlotJoined(i);
      p.isAlive = p.isJoined;
      const angle = (i * Math.PI) / 2;
      p.x = this.arena.cx + Math.cos(angle) * 40;
      p.y = this.arena.cy + Math.sin(angle) * 40;
      p.hp = HORDE_TUNING.MAX_HP;
      p.angle = angle;
      p.targetAngle = angle;
      p.steerX = 0; p.steerY = 0;
      p.dashTimer = 0;
      p.dashCooldown = 0;
      p.invulnTimer = 0;
      p.respawnTimer = 0;
      p.isAiming = false;
      p.attackCooldown = 0;
    }
  }

  startNewRound() {
    this.state = 'PLAYING';
    this.wave = 1;
    this.spawnWave();
  }

  spawnWave() {
    this.enemies = [];
    let numPlayers = this.players.filter(p => p.isJoined).length || 1;
    let numEnemies = (this.wave + this.round * 2) * numPlayers;

    const margin = 50;

    if (this.round === 3) {
      // Boss Round
      const bossTypes = ['chaser', 'shooter', 'tank', 'healer'];
      for (let i = 0; i < bossTypes.length; i++) {
        let type = bossTypes[i];
        const spawnSide = Math.floor(Math.random() * 4);
        let ex = 0; let ey = 0;

        if (spawnSide === 0) { ex = this.arena.left + margin + Math.random()*(this.arena.width-2*margin); ey = this.arena.top + margin; }
        else if (spawnSide === 1) { ex = this.arena.right - margin; ey = this.arena.top + margin + Math.random()*(this.arena.height-2*margin); }
        else if (spawnSide === 2) { ex = this.arena.left + margin + Math.random()*(this.arena.width-2*margin); ey = this.arena.bottom - margin; }
        else { ex = this.arena.left + margin; ey = this.arena.top + margin + Math.random()*(this.arena.height-2*margin); }

        let boss = {
          x: ex, y: ey,
          type: type,
          isBoss: true,
          radius: type === 'tank' ? 40 : (type === 'healer' ? 24 : 32),
          hp: (type === 'tank' ? 50 : (type === 'healer' ? 20 : 30)) * numPlayers,
          maxHp: (type === 'tank' ? 50 : (type === 'healer' ? 20 : 30)) * numPlayers,
          speed: type === 'chaser' ? 140 : (type === 'shooter' ? 90 : (type === 'healer' ? 110 : 50)),
          angle: 0,
          attackTimer: 0,
          vx: 0, vy: 0
        };
        this.enemies.push(boss);
      }
    } else {
      // Normal Round
      for (let i = 0; i < numEnemies; i++) {
        let type = 'chaser'; // default
        let rnd = Math.random();

        if (rnd < 0.3) type = 'shooter';
        else if (rnd < 0.5) type = 'tank';

        const spawnSide = Math.floor(Math.random() * 4);
        let ex = 0; let ey = 0;

        if (spawnSide === 0) { ex = this.arena.left + margin + Math.random()*(this.arena.width-2*margin); ey = this.arena.top + margin; }
        else if (spawnSide === 1) { ex = this.arena.right - margin; ey = this.arena.top + margin + Math.random()*(this.arena.height-2*margin); }
        else if (spawnSide === 2) { ex = this.arena.left + margin + Math.random()*(this.arena.width-2*margin); ey = this.arena.bottom - margin; }
        else { ex = this.arena.left + margin; ey = this.arena.top + margin + Math.random()*(this.arena.height-2*margin); }

        let enemy = {
          x: ex, y: ey,
          type: type,
          isBoss: false,
          radius: type === 'tank' ? 20 : (type === 'shooter' ? 14 : 16),
          hp: type === 'tank' ? 8 : (type === 'shooter' ? 2 : 3),
          maxHp: type === 'tank' ? 8 : (type === 'shooter' ? 2 : 3),
          speed: type === 'chaser' ? 120 : (type === 'shooter' ? 80 : 40),
          angle: 0,
          attackTimer: 0,
          vx: 0, vy: 0
        };

        this.enemies.push(enemy);
      }
    }
  }

  isSlotJoined(i) {
    return this.slotTypes[i] !== 'empty';
  }

  update(dt) {
    super.update(dt);
    if (this.state !== 'PLAYING') return;

    const alivePlayers = this.players.filter(p => p.isJoined && p.isAlive);

    // Pickups logic
    this.pickupTimer -= dt;
    if (this.pickupTimer <= 0) {
      spawnPickup(this, {
        types: ['HEAL', 'SHIELD', 'FAST', 'TRIPLE'],
        max: 3,
        pad: HORDE_TUNING.ARENA_PADDING + 10
      });
      this.pickupTimer = 8.0 + Math.random() * 4.0;
    }

    tickPickupTimers(this, dt);
    collectPickups(this, alivePlayers);

    // Update projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.life -= dt;

      let hit = false;
      if (proj.isEnemy) {
        for (const p of alivePlayers) {
          if (p.invulnTimer > 0 || p.dashTimer > 0) continue;
          if (Math.hypot(proj.x - p.x, proj.y - p.y) < p.radius + proj.radius) {
            p.hp -= proj.damage;
            if (p.hp <= 0) {
               p.isAlive = false;
               this.tombs.push({ x: p.x, y: p.y, ownerIndex: p.index, timer: 0 });
            }
            p.invulnTimer = 0.5;
            hit = true;
            break;
          }
        }
      } else {
        for (const e of this.enemies) {
          if (Math.hypot(proj.x - e.x, proj.y - e.y) < e.radius + proj.radius) {
            e.hp -= proj.damage;
            hit = true;
            break;
          }
        }
      }

      if (proj.x < this.arena.left || proj.x > this.arena.right || proj.y < this.arena.top || proj.y > this.arena.bottom) hit = true;
      if (hit || proj.life <= 0) this.projectiles.splice(i, 1);
    }

    // Check Wave End / Portal Logic
    if (this.enemies.length === 0 && !this.portal) {
      this.portal = { x: this.arena.cx, y: this.arena.cy, radius: 40, timer: 0 };
    }

    if (this.portal) {
      let playersInPortal = 0;
      let livingPlayers = 0;
      for (const p of alivePlayers) {
        livingPlayers++;
        if (Math.hypot(this.portal.x - p.x, this.portal.y - p.y) < this.portal.radius + p.radius) {
          playersInPortal++;
        }
      }

      if (livingPlayers > 0 && playersInPortal === livingPlayers) {
        this.portal.timer += dt;
        if (this.portal.timer >= 3.0) {
          this.portal = null;
          this.wave++;
          if (this.wave > 3) {
            this.wave = 1;
            this.round++;
            if (this.round > 3) {
              this.state = 'ROUND_OVER';
              return;
            }
          }
          this.spawnWave();
        }
      } else {
        this.portal.timer = Math.max(0, this.portal.timer - dt);
      }
    }

    // Revive Logic
    for (let i = this.tombs.length - 1; i >= 0; i--) {
      const tomb = this.tombs[i];
      let reviving = false;
      for (const p of alivePlayers) {
        if (Math.hypot(tomb.x - p.x, tomb.y - p.y) < 40) {
          reviving = true;
          break;
        }
      }
      if (reviving) {
        tomb.timer += dt;
        if (tomb.timer >= 3.0) {
          const deadPlayer = this.players[tomb.ownerIndex];
          if (deadPlayer) {
            deadPlayer.isAlive = true;
            deadPlayer.hp = HORDE_TUNING.MAX_HP;
            deadPlayer.x = tomb.x;
            deadPlayer.y = tomb.y;
            deadPlayer.invulnTimer = 2.0;
          }
          this.tombs.splice(i, 1);
        }
      } else {
        tomb.timer = Math.max(0, tomb.timer - dt);
      }
    }

    // Update enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.hp <= 0) {
        this.enemies.splice(i, 1);
        continue;
      }

      let target = null;
      let minDist = Infinity;
      for (const p of alivePlayers) {
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (d < minDist) { minDist = d; target = p; }
      }

      if (target) {
        const dx = target.x - e.x;
        const dy = target.y - e.y;
        e.angle = Math.atan2(dy, dx);

        let moveMult = 1;
        if (e.type === 'shooter' && minDist < 150) moveMult = -0.5; // Back away if too close
        if (e.type === 'shooter' && minDist > 150 && minDist < 250) moveMult = 0; // Stand still to shoot

        e.x += Math.cos(e.angle) * e.speed * moveMult * dt;
        e.y += Math.sin(e.angle) * e.speed * moveMult * dt;

        // Attack
        e.attackTimer -= dt;
        if (e.attackTimer <= 0) {
          if (e.type === 'shooter' && minDist < 300) {
            this.projectiles.push({
              x: e.x, y: e.y,
              vx: Math.cos(e.angle) * 300, vy: Math.sin(e.angle) * 300,
              radius: 6, damage: 1, life: 2, isEnemy: true, color: '#FF3366'
            });
            e.attackTimer = 1.5;
          } else if (e.type === 'chaser' && minDist < e.radius + target.radius + 5) {
             if (target.invulnTimer <= 0 && target.dashTimer <= 0) {
               target.hp -= 1;
               if (target.hp <= 0) {
                 target.isAlive = false;
                 this.tombs.push({ x: target.x, y: target.y, ownerIndex: target.index, timer: 0 });
               }
               target.invulnTimer = 0.5;
             }
             e.attackTimer = 1.0;
          } else if (e.type === 'tank' && minDist < e.radius + target.radius + 10) {
             if (target.invulnTimer <= 0 && target.dashTimer <= 0) {
               target.hp -= 2;
               if (target.hp <= 0) {
                 target.isAlive = false;
                 this.tombs.push({ x: target.x, y: target.y, ownerIndex: target.index, timer: 0 });
               }
               target.invulnTimer = 1.0;
             }
             e.attackTimer = 2.0;
          }
        }
      }
    }

    for (let i = 0; i < 4; i++) {
      const p = this.players[i];
      if (!p.isJoined) continue;

      if (p.isAlive && (p.slotType === 'bot_normal' || p.slotType === 'bot_god')) {
        updateHordeBotAI(this, p, dt);
      }

      if (p.dashCooldown > 0) p.dashCooldown -= dt;
      if (p.attackCooldown > 0) p.attackCooldown -= dt;
      if (p.invulnTimer > 0) p.invulnTimer -= dt;

      if (!p.isAlive) {
        // Player is dead, could add respawn mechanic here based on tombstone proximity
        continue;
      }

      // Movement
      if (p.dashTimer > 0) {
        p.dashTimer -= dt;
        p.x += p.steerX * HORDE_TUNING.MOVE_SPEED * HORDE_TUNING.DASH_SPEED_MULT * dt;
        p.y += p.steerY * HORDE_TUNING.MOVE_SPEED * HORDE_TUNING.DASH_SPEED_MULT * dt;
      } else {
        const speed = HORDE_TUNING.MOVE_SPEED;
        p.x += p.steerX * speed * dt;
        p.y += p.steerY * speed * dt;
      }

      clampToArena(p, this.arena, p.radius || 12);
    }
  }

  handleRemoteInput(slotIndex, data) {
    const p = this.players[slotIndex];
    if (!p || !p.isJoined || !p.isAlive) return;

    if (data.action === 'JOYSTICK_MOVE') {
      p.steerX = data.x;
      p.steerY = data.y;
      if (Math.abs(data.x) > 0.1 || Math.abs(data.y) > 0.1) {
        p.targetAngle = Math.atan2(data.y, data.x);
        p.angle = p.targetAngle;
      }
    } else if (data.action === 'HORDE_FIRE' || data.action === 'HORDE_FIRE_RELEASE') {
      p.isAiming = (data.action === 'HORDE_FIRE');
      if (p.isAiming && p.attackCooldown <= 0) {
        this.projectiles.push({
          x: p.x, y: p.y,
          vx: Math.cos(p.angle) * 400, vy: Math.sin(p.angle) * 400,
          radius: 8, damage: 1, life: 1.5, isEnemy: false, color: p.color
        });
        p.attackCooldown = 0.3;
      }
    } else if (data.action === 'DASH') {
      if (p.dashCooldown <= 0 && (Math.abs(p.steerX) > 0.1 || Math.abs(p.steerY) > 0.1)) {
        p.dashCooldown = HORDE_TUNING.DASH_CD;
        p.dashTimer = HORDE_TUNING.DASH_TIME;
      }
    }
  }

  render(ctx) {
    super.render(ctx);

    ctx.save();

    // Render projectiles
    for (const proj of this.projectiles) {
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, proj.radius, 0, Math.PI * 2);
      ctx.fillStyle = proj.color;
      ctx.fill();
    }

    for (const pk of this.pickups) {
      ctx.save();
      ctx.translate(pk.x, pk.y);
      ctx.beginPath();
      ctx.arc(0, 0, pk.radius || 12, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#333';
      ctx.stroke();
      ctx.fillStyle = '#333';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '12px sans-serif';
      let icon = '?';
      if (pk.type === 'HEAL') icon = '❤️';
      if (pk.type === 'SHIELD') icon = '🛡️';
      if (pk.type === 'FAST') icon = '⚡';
      if (pk.type === 'TRIPLE') icon = '🔥';
      ctx.fillText(icon, 0, 1);
      ctx.restore();
    }

    // Render Portals and Tombs
    if (this.portal) {
      ctx.beginPath();
      ctx.arc(this.portal.x, this.portal.y, this.portal.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(155, 89, 182, ${0.3 + Math.sin(performance.now()/200)*0.1})`;
      ctx.fill();

      if (this.portal.timer > 0) {
        ctx.beginPath();
        ctx.arc(this.portal.x, this.portal.y, this.portal.radius * (this.portal.timer / 3.0), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fill();
      }
    }

    for (const tomb of this.tombs) {
      ctx.beginPath();
      ctx.arc(tomb.x, tomb.y, 14, 0, Math.PI * 2);
      ctx.fillStyle = '#666';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '14px sans-serif';
      ctx.fillText('RIP', tomb.x, tomb.y);

      if (tomb.timer > 0) {
        ctx.beginPath();
        ctx.arc(tomb.x, tomb.y, 20, -Math.PI/2, -Math.PI/2 + (Math.PI * 2 * (tomb.timer / 3.0)));
        ctx.strokeStyle = '#2ECC71';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
    }

    // Render enemies
    for (const e of this.enemies) {
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.angle);

      ctx.beginPath();
      ctx.arc(0, 0, e.radius, 0, Math.PI * 2);
      ctx.fillStyle = e.type === 'tank' ? '#555' : (e.type === 'shooter' ? '#800' : '#444');
      ctx.fill();

      // Enemy direction indicator
      ctx.fillStyle = '#fff';
      ctx.fillRect(e.radius - 4, -2, 8, 4);

      // Enemy HP
      ctx.rotate(-e.angle);
      const hpRatio = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = '#333';
      ctx.fillRect(-10, -e.radius - 8, 20, 3);
      ctx.fillStyle = '#f33';
      ctx.fillRect(-10, -e.radius - 8, 20 * hpRatio, 3);
      ctx.restore();
    }

    // Render players
    const blink = Math.floor(performance.now() / 120) % 2 === 0;
    for (const p of this.players) {
      if (!p.isJoined) continue;

      if (!p.isAlive) {
         continue;
      }

      if (p.invulnTimer > 0 && p.respawnTimer <= 0 && blink) continue;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);

      if (p.dashTimer > 0) {
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(-10, 0, p.radius * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawGameAvatar(ctx, 0, 0, p.radius || 12, p, false);

      // HP bar
      ctx.rotate(-p.angle);
      const hpRatio = p.hp / HORDE_TUNING.MAX_HP;
      ctx.fillStyle = '#333';
      ctx.fillRect(-15, -25, 30, 4);
      ctx.fillStyle = hpRatio > 0.5 ? '#2ECC71' : (hpRatio > 0.2 ? '#F1C40F' : '#E74C3C');
      ctx.fillRect(-15, -25, 30 * hpRatio, 4);

      ctx.restore();
    }

    ctx.restore();
  }

  resize(w, h) {
    super.resize(w, h);
  }
}
