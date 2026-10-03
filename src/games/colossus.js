// BRUTAL COLOSSUS — 1-4 Oyunculu Co-op Titan Avı Motoru.
// Host authority: fizik, boss AI, faz geçişleri ve mermi simülasyonu bu motorda çalışır.

import { BaseMiniGame } from '../core/BaseGame.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { paintBackdrop } from '../core/fieldKit.js';
import { clampToArena, damp, normalizeAngle, segmentCircleIntersection } from '../core/physics2d.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import {
  playDashWhoosh,
  playExplosion,
  playHordeBoom,
  playHordeBombTick,
  playHordeHurt,
  playHordeKill,
  playShoot,
  playStart,
} from '../audio.js';
import {
  COLOSSUS_TUNING,
  COLOSSUS_WEAPONS,
  getColossusMap,
} from './colossusConfig.js';
import {
  createColossusWorldPacket,
  drawColossusWorld,
} from './colossusView.js';
import { updateBossAI, updateColossusBotAI } from '../ai/colossusAI.js';
import { getBotPersona, getSlotCustomization } from '../core/customizationManager.js';

function distSq(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

export class ColossusGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.controlMode = 'COLOSSUS';
    this.arena = { cx: 0, cy: 0, size: 0, width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0, unit: 1 };
    this.slotTypes = ['human', 'empty', 'empty', 'empty'];
    this.minPlayersToStart = 1;

    this.players = [];
    this.projectiles = [];
    this.pillars = [];
    this.pylons = [];
    this.shockwaves = [];
    this.mortars = [];

    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    this.particles = this.fx.particles;

    this.boss = null;
    this.state = 'LOBBY';
    this.roundWinner = null;
    this.matchWinner = null;
    this.scores = [0, 0, 0, 0];

    this.initPlayers();
  }

  initPlayers() {
    this.players = [0, 1, 2, 3].map((index) => {
      const existing = this.players?.[index];
      const custom = getSlotCustomization(index);
      const slotType = this.slotTypes?.[index] || 'empty';
      const isBot = slotType === 'bot_normal' || slotType === 'bot_god';
      const persona = isBot ? getBotPersona(index, slotType === 'bot_god') : null;
      const isJoined = slotType !== 'empty';
      const angle = Math.PI * 0.5 + (index - 1.5) * 0.35;
      const dist = Math.min(this.arena.width, this.arena.height) * 0.38;

      return {
        index,
        name: existing?.name || (isBot ? persona.name : `P${index + 1}`),
        color: isBot ? persona.color : (existing?.color || custom.color),
        slotType,
        isJoined,
        isAlive: isJoined,
        isDowned: false,
        reviveProgress: 0,
        x: this.arena.cx + Math.cos(angle) * dist,
        y: this.arena.cy + Math.sin(angle) * dist,
        vx: 0,
        vy: 0,
        steer: 0,
        steerX: 0,
        steerY: 0,
        isAiming: false,
        radius: fieldRadius(this.arena, COLOSSUS_TUNING.PLAYER_RADIUS),
        speed: fieldSpeed(this.arena, COLOSSUS_TUNING.PLAYER_SPEED),
        angle: -Math.PI / 2,
        hp: COLOSSUS_TUNING.MAX_HP,
        maxHp: COLOSSUS_TUNING.MAX_HP,
        weaponId: 'RIFLE',
        ammo: COLOSSUS_WEAPONS.RIFLE.magazine,
        attackCooldown: 0,
        reloadTimer: 0,
        dashCooldown: 0,
        dashTimer: 0,
        aimActive: false,
        aimAngle: 0,
      };
    });
  }

  resize(w, h) {
    this.updateViewport(w, h);
    const oldArena = { ...this.arena };
    this.arena = computePlayfield(w, h, 'roomy');
    if (this.boss) {
      this.boss.radius = fieldRadius(this.arena, COLOSSUS_TUNING.BOSS_RADIUS);
      if (this.state !== 'LOBBY') {
        this.remapPoint(this.boss, oldArena, this.arena);
        clampToArena(this.boss, this.boss.radius, this.arena);
      }
    }
    for (const player of this.players) {
      player.radius = fieldRadius(this.arena, COLOSSUS_TUNING.PLAYER_RADIUS);
      player.speed = fieldSpeed(this.arena, COLOSSUS_TUNING.PLAYER_SPEED);
      if (this.state !== 'LOBBY') {
        this.remapPoint(player, oldArena, this.arena);
        clampToArena(player, player.radius, this.arena);
      }
    }
    if (this.state === 'LOBBY' || !this.players.length) {
      this.initPlayers();
    }
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.startBattle();
  }

  resetMatch() {
    this.state = 'LOBBY';
    this.initPlayers();
    this.projectiles = [];
    this.pillars = [];
    this.pylons = [];
    this.shockwaves = [];
    this.mortars = [];
    this.boss = null;
  }

  startBattle() {
    this.state = 'PLAYING';
    const map = getColossusMap();

    // 1. Oyuncuları Oluştur (Güney yarım daire)
    this.initPlayers();
    for (const player of this.players) {
      player.isAlive = player.isJoined;
      player.hp = player.maxHp;
      player.isDowned = false;
      player.reviveProgress = 0;
      player.ammo = COLOSSUS_WEAPONS[player.weaponId]?.magazine || 16;
    }

    const activeCount = this.players.filter((p) => p.isJoined).length || 1;

    // 2. Boss'u Oluştur (Kuzey Merkez)
    const bossHp = COLOSSUS_TUNING.BASE_HP + (activeCount - 1) * COLOSSUS_TUNING.HP_PER_EXTRA_PLAYER;
    this.boss = {
      x: this.arena.cx,
      y: this.arena.cy - this.arena.height * 0.22,
      vx: 0,
      vy: 0,
      angle: Math.PI / 2,
      radius: fieldRadius(this.arena, COLOSSUS_TUNING.BOSS_RADIUS),
      hp: bossHp,
      maxHp: bossHp,
      phase: 1,
      state: 'IDLE',
      stagger: 0,
      staggerTimer: 0,
      targetSlot: -1,
      hitFlash: 0,
      critFlash: 0,
      shielded: false,
      laserActive: false,
      laserTimer: 0,
      stompCooldown: 3.0,
      laserCooldown: 5.0,
      mortarCooldown: 4.0,
      chargeCooldown: 6.0,
    };

    // 3. Taş Sütunları Konumlandır
    this.pillars = map.pillarOffsets.map((offset) => ({
      x: this.arena.cx + offset.x * this.arena.width,
      y: this.arena.cy + offset.y * this.arena.height,
      radius: fieldRadius(this.arena, COLOSSUS_TUNING.PILLAR_RADIUS),
      hp: COLOSSUS_TUNING.PILLAR_HP,
      maxHp: COLOSSUS_TUNING.PILLAR_HP,
    }));

    this.pylons = [];
    this.projectiles = [];
    this.shockwaves = [];
    this.mortars = [];

    try { playStart(); } catch {}
  }

  update(now) {
    if (this.state !== 'PLAYING') {
      this.lastTime = now;
      return;
    }

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;

    this.updatePlayers(dt);
    this.updateBoss(dt);
    this.updatePylons(dt);
    this.updateShockwaves(dt);
    this.updateMortars(dt);
    this.updateProjectiles(dt);
    this.checkVictoryDefeat();
  }

  updatePlayers(dt) {
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive) continue;

      // Bot Yapay Zekası
      if (player.slotType === 'bot_normal' || player.slotType === 'bot_god') {
        updateColossusBotAI(player, this, dt);
      }

      // Depar Süreçleri
      if (player.dashTimer > 0) {
        player.dashTimer -= dt;
      }
      if (player.dashCooldown > 0) {
        player.dashCooldown -= dt;
      }
      if (player.attackCooldown > 0) {
        player.attackCooldown -= dt;
      }
      if (player.reloadTimer > 0) {
        player.reloadTimer -= dt;
        if (player.reloadTimer <= 0) {
          const w = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;
          player.ammo = w.magazine;
        }
      }

      if (player.isDowned) {
        player.vx = 0;
        player.vy = 0;

        // Diriltme Kontrolü (Yakında ayakta takım arkadaşı var mı?)
        const rescuer = this.players.find(
          (other) => other.isJoined && other.isAlive && !other.isDowned && other.index !== player.index &&
            distSq(other.x, other.y, player.x, player.y) < COLOSSUS_TUNING.REVIVE_RADIUS * COLOSSUS_TUNING.REVIVE_RADIUS
        );

        if (rescuer) {
          player.reviveProgress = Math.min(1, player.reviveProgress + dt / COLOSSUS_TUNING.REVIVE_DURATION);
          if (player.reviveProgress >= 1) {
            // Dirildi!
            player.isDowned = false;
            player.hp = 2;
            player.reviveProgress = 0;
            try { playStart(); } catch {}
          }
        } else {
          player.reviveProgress = Math.max(0, player.reviveProgress - dt * 0.5);
        }
        continue;
      }

      // Hareket Entegrasyonu
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      const playerDecay = damp(0.9, dt);
      player.vx *= playerDecay;
      player.vy *= playerDecay;

      clampToArena(player, player.radius, this.arena);
    }
  }

  updateBoss(dt) {
    if (!this.boss || this.boss.hp <= 0) return;

    if (this.boss.hitFlash > 0) this.boss.hitFlash -= dt;
    if (this.boss.critFlash > 0) this.boss.critFlash -= dt;

    updateBossAI(this.boss, this, dt);

    // Boss Hareketi
    this.boss.x += this.boss.vx * dt;
    this.boss.y += this.boss.vy * dt;
    const bossDecay = damp(0.92, dt);
    this.boss.vx *= bossDecay;
    this.boss.vy *= bossDecay;

    // Sütunlara Çarpışma (Hücum sırasında sütuna çarparsa Sersemler!)
    for (const pillar of this.pillars) {
      if (pillar.hp <= 0) continue;
      const d = Math.sqrt(distSq(this.boss.x, this.boss.y, pillar.x, pillar.y));
      const minDist = this.boss.radius + pillar.radius;

      if (d < minDist) {
        if (this.boss.state === 'CHARGE') {
          // Hücum sütuna çarptı — Sütun hasar alır, Boss sersemler!
          pillar.hp -= 2;
          this.staggerBoss();
          try { playHordeBoom(); } catch {}
        }
        // İtme düzeltmesi
        const overlap = minDist - d;
        const pushAngle = Math.atan2(this.boss.y - pillar.y, this.boss.x - pillar.x);
        this.boss.x += Math.cos(pushAngle) * overlap;
        this.boss.y += Math.sin(pushAngle) * overlap;
      }
    }

    clampToArena(this.boss, this.boss.radius, this.arena);

    // Faz Geçiş Kontrolleri
    const hpRatio = this.boss.hp / this.boss.maxHp;
    if (this.boss.phase === 1 && hpRatio <= COLOSSUS_TUNING.PHASE_2_HP_RATIO) {
      this.enterPhase2();
    } else if (this.boss.phase === 2 && hpRatio <= COLOSSUS_TUNING.PHASE_3_HP_RATIO) {
      this.enterPhase3();
    }
  }

  enterPhase2() {
    this.boss.phase = 2;
    this.boss.shielded = true;
    const map = getColossusMap();

    // 2 Pilon Oluştur
    this.pylons = map.pylonOffsets.map((offset, idx) => ({
      id: idx,
      x: this.arena.cx + offset.x * this.arena.width,
      y: this.arena.cy + offset.y * this.arena.height,
      radius: fieldRadius(this.arena, COLOSSUS_TUNING.PYLON_RADIUS),
      hp: COLOSSUS_TUNING.PYLON_HP,
      maxHp: COLOSSUS_TUNING.PYLON_HP,
      active: true,
    }));

    try { playHordeBoom(); } catch {}
    this.addDirectionalTrauma(0.4, 0, -1);
  }

  enterPhase3() {
    this.boss.phase = 3;
    this.boss.shielded = false;
    this.pylons = [];
    try { playHordeBoom(); } catch {}
    this.addDirectionalTrauma(0.6, 0, 1);
  }

  updatePylons(dt) {
    if (this.boss?.phase !== 2) return;
    const anyActive = this.pylons.some((p) => p.active);
    if (!anyActive && this.boss.shielded) {
      // İki pilon da yok edildi — Boss Kalkanı düştü ve Sersemledi!
      this.boss.shielded = false;
      this.staggerBoss();
      try { playExplosion(); } catch {}
    }
  }

  updateShockwaves(dt) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const s = this.shockwaves[i];
      s.radius += COLOSSUS_TUNING.STOMP_RING_SPEED * dt;

      // Oyunculara Hasar Denetimi
      for (const player of this.players) {
        if (!player.isJoined || !player.isAlive || player.isDowned) continue;
        if (player.dashTimer > 0) continue; // Dash i-frame ile atladı!

        const d = Math.sqrt(distSq(player.x, player.y, s.x, s.y));
        if (Math.abs(d - s.radius) < player.radius * 0.7) {
          this.damagePlayer(player, COLOSSUS_TUNING.STOMP_DAMAGE);
        }
      }

      if (s.radius >= s.maxRadius) {
        this.shockwaves.splice(i, 1);
      }
    }
  }

  updateMortars(dt) {
    for (let i = this.mortars.length - 1; i >= 0; i--) {
      const m = this.mortars[i];
      m.fuse -= dt;

      if (m.fuse <= 0) {
        // Havan patlaması!
        try { playExplosion(); } catch {}
        this.addDirectionalTrauma(0.2, 0, 0);

        for (const player of this.players) {
          if (!player.isJoined || !player.isAlive || player.isDowned) continue;
          if (player.dashTimer > 0) continue;

          const d = Math.sqrt(distSq(player.x, player.y, m.x, m.y));
          if (d <= m.radius + player.radius) {
            this.damagePlayer(player, COLOSSUS_TUNING.MORTAR_DAMAGE);
          }
        }
        this.mortars.splice(i, 1);
      }
    }
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life = (p.life || 1) - dt;

      let hit = false;

      // 1. Sütunlara Çarpma
      for (const pillar of this.pillars) {
        if (pillar.hp <= 0) continue;
        if (distSq(p.x, p.y, pillar.x, pillar.y) < pillar.radius * pillar.radius) {
          hit = true;
          pillar.hp -= 0.2;
          break;
        }
      }

      // 2. Pilonlara Çarpma (Faz 2)
      if (!hit && this.boss?.phase === 2) {
        for (const pylon of this.pylons) {
          if (!pylon.active) continue;
          if (distSq(p.x, p.y, pylon.x, pylon.y) < pylon.radius * pylon.radius) {
            hit = true;
            pylon.hp -= p.damage || 2;
            if (pylon.hp <= 0) {
              pylon.active = false;
              try { playHordeKill(); } catch {}
            }
            break;
          }
        }
      }

      // 3. Boss'a Çarpma (Ön Zırh vs Arka Çekirdek)
      if (!hit && this.boss && this.boss.hp > 0) {
        const dBoss = Math.sqrt(distSq(p.x, p.y, this.boss.x, this.boss.y));
        if (dBoss <= this.boss.radius) {
          hit = true;
          if (this.boss.shielded) {
            // Kalkan mermiyi yutar
            this.boss.hitFlash = 0.08;
          } else {
            this.applyDamageToBoss(p.damage || 2, p.x, p.y, p.stagger || 4);
          }
        }
      }

      if (hit || p.life <= 0) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  applyDamageToBoss(rawDamage, hitX, hitY, staggerAmount) {
    // Vuruş açısını Boss'un baktığı yöne göre hesapla
    const hitAngle = Math.atan2(hitY - this.boss.y, hitX - this.boss.x);
    const relAngle = Math.abs(normalizeAngle(hitAngle - this.boss.angle));

    // Arka zayıf nokta açısı: Math.PI etrafındaki koni
    const isRearCore = relAngle > (Math.PI - COLOSSUS_TUNING.CORE_ARC / 2);

    if (isRearCore || this.boss.state === 'STAGGER') {
      // ÇEKİRDEK KRİTİK VURUŞU!
      const damage = rawDamage;
      this.boss.hp -= damage;
      this.boss.critFlash = 0.14;
      this.boss.stagger = Math.min(COLOSSUS_TUNING.STAGGER_MAX, this.boss.stagger + staggerAmount * 2);
      try { playHordeHurt(); } catch {}
    } else {
      // ÖN VEYA YAN ZIRHA ÇARPTI (%85 Hasar İndirimi)
      const damage = Math.max(0.5, rawDamage * COLOSSUS_TUNING.ARMOR_DAMAGE_SCALE);
      this.boss.hp -= damage;
      this.boss.hitFlash = 0.08;
      this.boss.stagger = Math.min(COLOSSUS_TUNING.STAGGER_MAX, this.boss.stagger + staggerAmount * 0.5);
      try { playHordeHurt(); } catch {}
    }

    if (this.boss.stagger >= COLOSSUS_TUNING.STAGGER_MAX && this.boss.state !== 'STAGGER') {
      this.staggerBoss();
    }
  }

  staggerBoss() {
    this.boss.state = 'STAGGER';
    this.boss.staggerTimer = COLOSSUS_TUNING.STAGGER_DURATION;
    this.boss.laserActive = false;
    this.addDirectionalTrauma(0.5, 0, 1);
    try { playHordeBoom(); } catch {}
  }

  damagePlayer(player, amount) {
    if (player.isDowned || player.dashTimer > 0) return;
    player.hp -= amount;
    try { playHordeHurt(); } catch {}

    if (player.hp <= 0) {
      player.hp = 0;
      player.isDowned = true;
      player.reviveProgress = 0;
      try { playHordeKill(); } catch {}
    }
  }

  triggerStomp() {
    this.shockwaves.push({
      x: this.boss.x,
      y: this.boss.y,
      radius: this.boss.radius * 0.5,
      maxRadius: COLOSSUS_TUNING.STOMP_MAX_RADIUS,
    });
    this.addDirectionalTrauma(0.3, 0, 1);
    try { playHordeBoom(); } catch {}
  }

  triggerLaser() {
    this.boss.laserActive = true;
    this.boss.laserTimer = COLOSSUS_TUNING.LASER_FIRE_TIME;
    try { playShoot(); } catch {}
  }

  triggerMortarBarrage(players) {
    for (const p of players) {
      this.mortars.push({
        x: p.x + (Math.random() - 0.5) * 40,
        y: p.y + (Math.random() - 0.5) * 40,
        radius: fieldRadius(this.arena, COLOSSUS_TUNING.MORTAR_RADIUS),
        fuse: COLOSSUS_TUNING.MORTAR_FUSE,
        maxFuse: COLOSSUS_TUNING.MORTAR_FUSE,
      });
    }
    try { playHordeBombTick(); } catch {}
  }

  firePlayerWeapon(player) {
    if (player.attackCooldown > 0 || player.reloadTimer > 0 || player.ammo <= 0) return;
    const w = COLOSSUS_WEAPONS[player.weaponId] || COLOSSUS_WEAPONS.RIFLE;

    player.attackCooldown = w.fireInterval;
    player.ammo -= 1;

    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const spread = (Math.random() - 0.5) * (w.spread || 0.05);
      const angle = player.angle + spread;
      this.projectiles.push({
        x: player.x + Math.cos(angle) * (player.radius + 6),
        y: player.y + Math.sin(angle) * (player.radius + 6),
        vx: Math.cos(angle) * w.projectileSpeed,
        vy: Math.sin(angle) * w.projectileSpeed,
        damage: w.damage,
        stagger: w.stagger,
        color: w.color,
        radius: 3.5,
        life: (w.range || 600) / w.projectileSpeed,
      });
    }

    try { playShoot(); } catch {}

    if (player.ammo <= 0) {
      player.reloadTimer = w.reloadTime;
    }
  }

  performPlayerDash(player) {
    if (player.dashCooldown > 0 || player.isDowned) return;
    player.dashTimer = COLOSSUS_TUNING.DASH_DURATION;
    player.dashCooldown = COLOSSUS_TUNING.DASH_COOLDOWN;

    // Dash yönü: hareket yönü ya da baktığı açı
    player.vx = Math.cos(player.angle) * COLOSSUS_TUNING.DASH_SPEED;
    player.vy = Math.sin(player.angle) * COLOSSUS_TUNING.DASH_SPEED;

    try { playDashWhoosh(); } catch {}
  }

  checkVictoryDefeat() {
    if (this.boss && this.boss.hp <= 0) {
      this.state = 'VICTORY';
      for (let i = 0; i < 4; i++) {
        if (this.players[i]?.isJoined) this.scores[i] += 1;
      }
      this.addDirectionalTrauma(0.8, 0, 0);
      try { playExplosion(); } catch {}
      return;
    }

    const aliveCount = this.players.filter((p) => p.isJoined && p.isAlive && !p.isDowned).length;
    if (aliveCount === 0) {
      this.state = 'DEFEAT';
      try { playHordeKill(); } catch {}
    }
  }

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || player.isDowned) return;

    if (data.action === 'JOYSTICK_MOVE') {
      const force = Math.min(1, Math.hypot(data.dx || 0, data.dy || 0));
      if (force > 0.1) {
        player.vx = data.dx * player.speed;
        player.vy = data.dy * player.speed;
        if (!player.aimActive) {
          player.angle = Math.atan2(data.dy, data.dx);
        }
      }
    } else if (data.action === 'AIM_MOVE') {
      const force = Math.min(1, Math.hypot(data.dx || 0, data.dy || 0));
      if (force > 0.15) {
        player.aimActive = true;
        player.angle = Math.atan2(data.dy, data.dx);
        this.firePlayerWeapon(player);
      }
    } else if (data.action === 'AIM_RELEASE') {
      player.aimActive = false;
    } else if (data.action === 'DASH') {
      this.performPlayerDash(player);
    }
  }

  createWorldPacket() {
    return createColossusWorldPacket(this);
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const packet = this.createWorldPacket();
    if (packet) {
      drawColossusWorld(ctx, this.arena, packet, { now: performance.now() });
    }
  }
}
