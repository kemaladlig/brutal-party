// BRUTAL SUMO — 2v2 halka güreşi.
//
// Koleksiyondaki 13 modda da knockback VAR ama hiçbir yerde ÖLDÜRMÜYOR: omuz
// atması rakibi ancak yerinden oynatıyor. Burada kazanma koşulu tam olarak o:
// rakibi platformun kenarından MASAYA düşürmek. Can yok, mermi yok — sadece
// momentum, kütle ve üç fiil.
//
// ÜÇ FİİL BİRBİRİNİ YENER (uzun ömrün kaynağı sayıda değil burada):
//   ÇARP    → hareket halindeki rakibi savuşturur
//   TUT     → çarpmayı yutar (savantrma ×0.32, saldıran seker)
//   KAPKALA → köklenmiş/hızını kesmiş rakibi kaldırıp fırlatır (TUT'u yer)
//   kaçınma → kapkalamanın 46 px menzilini boşa düşürür
//
// Mimari: host tek otorite (§1). Kumanda yalnız joystick + iki buton gönderir;
// tüm impuls çözümlemesi burada. Kare başına tahsis yok: durum oyuncu
// nesnelerinin SABİT alanlarında yaşar, efektler `fxRuntime` havuzlarından geçer.

import { BaseMiniGame } from '../core/BaseGame.js';
import { bindKeyboard } from '../core/keyboardDispatch.js';
import { getSecondActionKey, getSlotKeys, isSlotActionEvent } from '../core/inputMaps.js';
import { computePlayfield, fieldRadius, fieldSpeed } from '../core/playfield.js';
import { createPlayer } from '../core/playerEntity.js';
import { createFxRuntime } from '../core/fxRuntime.js';
import { emitFloatingText, fxFlashAlpha } from '../core/fxKit.js';
import { renderFloatingTexts } from '../ui/hud.js';
import { beginRound, beginDrawRound, endMatch, tickRoundFlow } from '../core/roundLifecycle.js';
import { lobbyCenterStartTap, lobbyQuadrantTap, matchOverRestartTap } from '../core/touchFlow.js';
import { isInputIntent, matchesInputAction } from '../core/inputIntent.js';
import { updateSumoBotAI } from '../ai/sumoAI.js';
import {
  playStart, playJoin, playHeavyImpact, playDashWhoosh, playStumble, playPowerUp, playExplosion,
} from '../audio.js';
import { UI_COLORS } from '../ui/tokens.js';
import { t } from '../i18n.js';
import {
  createSumoWorldPacket,
  drawSumoArena,
  drawSumoPlayers,
  drawSumoFxLayer,
} from './sumoView.js';

export const SUMO_NAMES = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'];
// Motor paleti token'dan türer (§8: yeni dosyada ham renk literali yok).
export const SUMO_COLORS = UI_COLORS.players;
// P1+P3 bir takım, P2+P4 diğer. Köşegen eşleşme: masa-ortası yerleşimde takım
// arkadaşları birbirinin görüş hattını kapatmıyor.
export const SUMO_TEAMS = [0, 1, 0, 1];

const SUMO_TUNING = Object.freeze({
  ROUND_TIME: 60,
  TARGET_ROUNDS: 3,      // 3 raunt alan maçı alır (2 değil: istenen uzun soluk)
  TAKEDOWN_TARGET: 5,    // raundu erken bitiren düşürme sayısı
  RING_FRACTION: 0.44,   // platform yarıçapı = kısa kenar × bu
  RING_FLOOR: 0.55,      // küçülme alt sınırı (başlangıç yarıçapının oranı)
  SHRINK_PER_TAKEDOWN: 0.965,
  BODY_R: 34,
  BODY_MIN: 0.028,
  GRAB_MIN: 0.03,
  ACCEL: 1500,
  MOVE_SPEED: 200,
  DRIFT_RETENTION: 0.22, // girdisiz 1 sn'de hızın kalan oranı (mücadele hissi)
  CHARGE_SPEED: 520,
  CHARGE_TIME: 0.24,
  CHARGE_CD: 1.6,
  IMPACT_MIN: 170,       // bundan yavaş temas "vuruş" sayılmaz
  KNOCK: 1.45,
  ATTACKER_RECOIL: 0.35,
  BRACE_KNOCK: 0.32,
  BRACE_RECOIL: 1.5,     // kölenmiş rakibe çarpan kendini sert geri teper
  GRAB_RANGE_FACTOR: 1.35, // (yarıçaplar toplamı) × bu
  GRAB_SLOW_FACTOR: 0.3,   // rakip bu hızın altındaysa kaldırılabilir
  GRAB_ARM_CD: 1.0,
  GRAB_TIME: 1.4,
  GRAB_CD: 0.9,
  ESCAPE_IDLE: 0.5,      // sn başına sakin kaçış birikimi
  ESCAPE_MASH: 1.7,      // sn başına tam çalkalama birikimi
  THROW_SPEED: 700,
  SHOVE_SPEED: 260,
  FALL_TIME: 0.55,
  RESPAWN_TIME: 2.4,
  INVULN_TIME: 1.0,
  SOLO_MASS: 1.28,       // 3 kişide azınlık takımın adamı daha ağır
});

export class SumoGame extends BaseMiniGame {
  constructor(canvas) {
    super(canvas);
    this.controlMode = 'SUMO';
    this.arena = { cx: 0, cy: 0, size: 0, width: 0, height: 0, left: 0, right: 0, top: 0, bottom: 0, unit: 1 };
    this.slotTypes = ['human', 'human', 'empty', 'empty'];
    this.players = [];
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.teamTakedowns = [0, 0];
    this.targetScore = SUMO_TUNING.TARGET_ROUNDS;
    // JSDoc cast: donmuş sabitin literal tipi alanı kilitlemesin (§ tsc).
    this.roundLimit = /** @type {number} */ (SUMO_TUNING.ROUND_TIME);
    this.roundTime = /** @type {number} */ (SUMO_TUNING.ROUND_TIME);
    this.roundTimer = /** @type {number} */ (SUMO_TUNING.ROUND_TIME);
    this.roundId = 0;
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.roundDrew = false;
    this.roundResolutionReason = null;
    this.roundTransitionTimer = 0;
    this.tiedRounds = 0;
    this.keys = {};

    // Halka küçülmesi ORAN olarak tutulur: resize yarıçapı yeniden türetir,
    // maç ortasında küçülme kaybolsun istemiyoruz.
    this.ring = { cx: 0, cy: 0, r: 0, r0: 0, ratio: 1 };
    this.scale = {
      accel: 0, moveSpeed: 0, chargeSpeed: 0, impactMin: 0, throwSpeed: 0,
      shoveSpeed: 0, bodyR: 0, grabRange: 0,
    };

    this.fx = createFxRuntime({
      arenaProvider: () => this.arena,
      traumaSink: (amount, dirX, dirY) => this.addDirectionalTrauma(amount, dirX, dirY),
    });
    /** @type {any[]} */ this.particles = this.fx.particles;
    this.floatingTexts = [];

    this.initKeyboard();
  }

  // ── kurulum / ölçek ────────────────────────────────────────────────────────

  initKeyboard() {
    bindKeyboard(this, {
      keydown: (e) => {
        if (!this.isLocalInputActive) return;
        this.keys[e.code] = true;
        // ÇARP tek basışlık birincil aksiyon tuşudur (inputMaps alias kümesi —
        // motor kendi tuş kopyasını tutmaz, §2).
        if (e.repeat) return;
        for (let i = 0; i < 4; i += 1) {
          if (isSlotActionEvent(e, i)) this.attemptCharge(this.players[i]);
        }
      },
      keyup: (e) => {
        this.keys[e.code] = false;
      },
    });
  }

  resize(width, height) {
    this.updateViewport(width, height);
    const oldArena = { ...this.arena };
    this.arena = computePlayfield(width, height, 'standard');
    this.applyScale();
    if (this.players.length === 0) {
      this.initPlayers();
      return;
    }
    for (const p of this.players) {
      this.remapPoint(p, oldArena, this.arena);
      p.radius = this.scale.bodyR * p.massScale;
    }
    // Arena değişti: eski koordinatlı birikimler yeni ölçekle karışmasın.
    this.fx.clear();
  }

  applyScale() {
    const arena = this.arena;
    const s = this.scale;
    s.accel = fieldSpeed(arena, SUMO_TUNING.ACCEL);
    s.moveSpeed = fieldSpeed(arena, SUMO_TUNING.MOVE_SPEED);
    s.chargeSpeed = fieldSpeed(arena, SUMO_TUNING.CHARGE_SPEED);
    s.impactMin = fieldSpeed(arena, SUMO_TUNING.IMPACT_MIN);
    s.throwSpeed = fieldSpeed(arena, SUMO_TUNING.THROW_SPEED);
    s.shoveSpeed = fieldSpeed(arena, SUMO_TUNING.SHOVE_SPEED);
    s.bodyR = fieldRadius(arena, SUMO_TUNING.BODY_R, SUMO_TUNING.BODY_MIN);
    s.grabRange = fieldRadius(arena, SUMO_TUNING.BODY_R * SUMO_TUNING.GRAB_RANGE_FACTOR, SUMO_TUNING.GRAB_MIN);

    this.ring.cx = arena.cx;
    this.ring.cy = arena.cy;
    this.ring.r0 = Math.min(arena.width, arena.height) * SUMO_TUNING.RING_FRACTION;
    this.ring.r = this.ring.r0 * this.ring.ratio;
  }

  initPlayers() {
    const { cx, cy } = this.arena;
    const r = this.scale.bodyR;
    const spread = this.ring.r * 0.55;
    const spawns = [
      { x: cx - spread, y: cy + spread },
      { x: cx - spread, y: cy - spread },
      { x: cx + spread, y: cy - spread },
      { x: cx + spread, y: cy + spread },
    ];

    this.players = spawns.map((spawn, i) => {
      const existing = this.players[i];
      return createPlayer(i, spawn, {
        existingName: existing?.name,
        defaultNames: SUMO_NAMES,
        defaultColors: SUMO_COLORS,
        radius: r,
        speed: this.scale.moveSpeed,
        isJoined: this.isSlotJoined(i),
        isAlive: this.isSlotJoined(i),
        slotType: this.slotTypes[i],
        angle: Math.atan2(cy - spawn.y, cx - spawn.x),
        // SUMO'ya özel sabit alanlar (kare başına tahsis yerine burada doğarlar)
        team: SUMO_TEAMS[i],
        mass: 1,
        massScale: 1,
        moveX: 0,
        moveY: 0,
        chargeTimer: 0,
        chargeCooldown: 0,
        braceHeld: false,
        braced: false,
        grabbedBy: -1,
        grabbing: -1,
        grabMeter: 0,
        grabTimer: 0,
        fallTimer: 0,
        respawnTimer: 0,
        invuln: 0,
        takedowns: 0,
        lastHitBy: -1,
        remoteActive: false,
        remoteMove: { x: 0, y: 0 },
      });
    });
    this.applyTeamBalance();
  }

  /** Azınlık takımı daha ağır: 3 kişide 2v1 ezilmesin. */
  applyTeamBalance() {
    const counts = [0, 0];
    for (const p of this.players) if (p.isJoined) counts[p.team] += 1;
    const minority = counts[0] === counts[1] ? -1 : (counts[0] < counts[1] ? 0 : 1);
    for (const p of this.players) {
      const solo = minority >= 0 && p.isJoined && p.team === minority;
      p.mass = solo ? SUMO_TUNING.SOLO_MASS : 1;
      p.massScale = 1 + (p.mass - 1) * 0.35;
      p.radius = this.scale.bodyR * p.massScale;
    }
  }

  // ── maç / raunt akışı ──────────────────────────────────────────────────────

  resetMatch() {
    this.state = 'LOBBY';
    this.scores = [0, 0, 0, 0];
    this.roundWinner = null;
    this.matchWinner = null;
    this.matchDraw = false;
    this.tiedRounds = 0;
    this.roundId = 0;
    this.roundTransitionTimer = 0;
    this.ring.ratio = 1;
    this.fx.clear();
    this.floatingTexts = [];
    this.applyScale();
    this.initPlayers();
    this.onTouchesReset();
  }

  reset() {
    this.resetMatch();
  }

  startNewMatch() {
    this.scores = [0, 0, 0, 0];
    this.matchWinner = null;
    this.matchDraw = false;
    this.tiedRounds = 0;
    this.startNewRound();
  }

  startNewRound() {
    this.startRound();
  }

  startRound() {
    const joined = this.players.filter((p) => p.isJoined);
    if (joined.length < 2) {
      this.state = 'LOBBY';
      return;
    }
    this.applyScale();
    this.state = 'PLAYING';
    this.roundId += 1;
    this.roundWinner = null;
    this.roundTransitionTimer = 0;
    this.roundTime = SUMO_TUNING.ROUND_TIME;
    this.roundTimer = SUMO_TUNING.ROUND_TIME;
    this.teamTakedowns = [0, 0];
    this.ring.ratio = 1;
    this.ring.r = this.ring.r0;
    this.fx.clear();
    this.floatingTexts = [];
    this.applyTeamBalance();

    const { cx, cy } = this.arena;
    const spread = this.ring.r * 0.55;
    const spawns = [
      { x: cx - spread, y: cy + spread },
      { x: cx - spread, y: cy - spread },
      { x: cx + spread, y: cy - spread },
      { x: cx + spread, y: cy + spread },
    ];
    for (const p of this.players) {
      const s = spawns[p.index];
      p.x = s.x;
      p.y = s.y;
      p.vx = 0;
      p.vy = 0;
      p.angle = Math.atan2(cy - s.y, cx - s.x);
      p.isAlive = p.isJoined;
      p.moveX = 0;
      p.moveY = 0;
      p.takedowns = 0;
      p.lastHitBy = -1;
      p.chargeTimer = 0;
      p.chargeCooldown = 0;
      p.braceHeld = false;
      p.braced = false;
      p.grabbedBy = -1;
      p.grabbing = -1;
      p.grabMeter = 0;
      p.grabTimer = 0;
      p.fallTimer = 0;
      p.respawnTimer = 0;
      p.invuln = SUMO_TUNING.INVULN_TIME;
    }
    this.onTouchesReset();
    playStart();
  }

  handleRoundEnd() {
    // Raundu çok düşüren takım alır; eşitlik berabere raunt (puan yok).
    const [a, b] = this.teamTakedowns;
    if (a === b) {
      this.finishTiedRound();
      return;
    }
    const winningTeam = a > b ? 0 : 1;
    const members = this.players.filter((p) => p.isJoined && p.team === winningTeam);
    if (members.length === 0) {
      this.finishTiedRound();
      return;
    }
    this.tiedRounds = 0;
    // Bant tek varlık ister: en çok düşüren oyuncu takımın yüzü olur.
    let winner = members[0];
    for (const m of members) if (m.takedowns > winner.takedowns) winner = m;
    for (const m of members) this.scores[m.index] += 1;
    this.ring.ratio = 1;
    this.ring.r = this.ring.r0;
    if (members.some((m) => this.scores[m.index] >= this.targetScore)) {
      endMatch(this, winner, 'target-rounds');
      return;
    }
    beginRound(this, winner, 'takedowns');
  }

  finishTiedRound() {
    this.tiedRounds += 1;
    // Üst üste iki berabere raunt maçı bitirir: çıkmasız döngü olmasın.
    if (this.tiedRounds >= 2) {
      endMatch(this, null, 'tied-rounds');
      return;
    }
    beginDrawRound(this, 'tie');
  }

  // ── fiiller ───────────────────────────────────────────────────────────────

  getTabletopSchema() {
    return {
      ...this.getCentralTabletopLayout('SUMO'),
      actions: [
        { id: 'charge', icon: 'flame', cooldownField: 'chargeCooldown', maxCooldown: SUMO_TUNING.CHARGE_CD },
        { id: 'brace', icon: 'shield', cooldownField: 'braceCooldown', maxCooldown: SUMO_TUNING.GRAB_CD },
      ],
    };
  }

  handleSlotAction(slotIndex, actionId, isDown) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined) return;
    if (actionId === 'charge') {
      if (isDown) this.attemptCharge(player);
      return;
    }
    if (actionId === 'brace') player.braceHeld = !!isDown;
  }

  /** ÇARP: elindekini fırlatır, yoksa hamle yapar. Tek buton, iki anlam. */
  attemptCharge(player) {
    if (!player.isAlive || this.state !== 'PLAYING') return;
    if (player.grabbing >= 0) {
      this.throwGrabbed(player);
      return;
    }
    if (player.chargeCooldown > 0 || player.chargeTimer > 0 || player.braced) return;
    player.chargeTimer = SUMO_TUNING.CHARGE_TIME;
    player.chargeCooldown = SUMO_TUNING.CHARGE_CD;
    const ax = Math.cos(player.angle);
    const ay = Math.sin(player.angle);
    player.vx = ax * this.scale.chargeSpeed;
    player.vy = ay * this.scale.chargeSpeed;
    this.fx.emit('zone', {
      x: player.x, y: player.y, color: player.color,
      dirX: ax, dirY: ay, slot: player.index,
      haptic: player.slotType === 'human',
    });
    playDashWhoosh();
  }

  throwGrabbed(player) {
    const victim = this.players[player.grabbing];
    player.grabbing = -1;
    player.grabTimer = 0;
    player.chargeCooldown = Math.max(player.chargeCooldown, SUMO_TUNING.GRAB_CD);
    if (!victim) return;
    this.releaseGrab(player, victim);
    const ax = Math.cos(player.angle);
    const ay = Math.sin(player.angle);
    victim.vx += ax * this.scale.throwSpeed / victim.mass;
    victim.vy += ay * this.scale.throwSpeed / victim.mass;
    victim.lastHitBy = player.index;
    this.fx.emit('slay', {
      x: victim.x, y: victim.y, color: player.color,
      dirX: ax, dirY: ay, slot: victim.index,
      haptic: victim.slotType === 'human',
    });
    playHeavyImpact();
    this.addDirectionalTrauma(0.22, ax, ay);
  }

  releaseGrab(grabber, victim) {
    victim.grabbedBy = -1;
    victim.grabMeter = 0;
    victim.grabTimer = 0;
    if (grabber) grabber.grabbing = -1;
  }

  // ── ana döngü ─────────────────────────────────────────────────────────────

  update(now) {
    const rawDt = this.clampDt(now, this.lastTime);
    this.lastTime = now;
    const dt = this.fx.tick(rawDt);

    this.updateTrauma(dt);
    this.fx.update(dt);
    if (tickRoundFlow(this, dt)) return;
    if (this.state !== 'PLAYING') return;

    this.roundTime -= dt;
    this.roundTimer = Math.max(0, this.roundTime);

    for (const player of this.players) this.updatePlayer(player, dt);
    this.resolveContacts();
    this.checkRing();

    const [a, b] = this.teamTakedowns;
    if (a >= SUMO_TUNING.TAKEDOWN_TARGET || b >= SUMO_TUNING.TAKEDOWN_TARGET || this.roundTime <= 0) {
      this.handleRoundEnd();
    }
  }

  updatePlayer(player, dt) {
    if (!player.isJoined) return;

    if (player.chargeCooldown > 0) player.chargeCooldown = Math.max(0, player.chargeCooldown - dt);
    if (player.invuln > 0) player.invuln = Math.max(0, player.invuln - dt);
    if (player.chargeTimer > 0) player.chargeTimer = Math.max(0, player.chargeTimer - dt);
    this.tickKineticEntity(player, dt);

    // Düşme animasyonu: girdi işlenmez, gövde süzülür.
    if (player.fallTimer > 0) {
      player.fallTimer = Math.max(0, player.fallTimer - dt);
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.vx *= 0.94;
      player.vy *= 0.94;
      if (player.fallTimer === 0) player.respawnTimer = SUMO_TUNING.RESPAWN_TIME;
      return;
    }
    if (player.respawnTimer > 0) {
      player.respawnTimer = Math.max(0, player.respawnTimer - dt);
      if (player.respawnTimer === 0) this.respawn(player);
      return;
    }
    if (player.grabbedBy >= 0) {
      this.updateGrabbed(player, dt);
      return;
    }

    if (player.slotType !== 'human') {
      updateSumoBotAI(this, player, dt);
    } else {
      this.readLocalIntent(player);
    }

    player.braced = player.braceHeld && player.chargeTimer <= 0 && player.grabbing < 0;
    if (player.braced) {
      // Köklenme: yere çakılma — gelen savuşturma da azalır (applyImpact).
      const hold = Math.pow(0.015, dt);
      player.vx *= hold;
      player.vy *= hold;
    } else if (player.chargeTimer <= 0) {
      this.drive(player, dt);
    } else {
      // Çarpış sırasında sürüş yok: hamle kendi hızını taşır.
      player.moveX = 0;
      player.moveY = 0;
    }

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (player.grabbing >= 0) this.holdGrab(player, dt);
  }

  /**
   * İtiş + sürtünme + HIZ SINIRI. Sınır yalnız girdi yönündeki bileşene
   * uygulanır: yandan yenen darbenin momentumu korunur, yoksa köşeye sıkışmış
   * birini savuşturmak imkânsız olurdu.
   */
  drive(player, dt) {
    const mx = player.moveX;
    const my = player.moveY;
    const strength = Math.min(1, Math.hypot(mx, my));
    if (strength > 0.02) {
      const ux = mx / (Math.hypot(mx, my) || 1);
      const uy = my / (Math.hypot(mx, my) || 1);
      player.vx += ux * this.scale.accel * strength * dt / player.mass;
      player.vy += uy * this.scale.accel * strength * dt / player.mass;
      const cap = this.scale.moveSpeed * strength;
      const along = player.vx * ux + player.vy * uy;
      if (along > cap) {
        player.vx -= ux * (along - cap);
        player.vy -= uy * (along - cap);
      }
      player.angle = Math.atan2(my, mx);
    }
    const drift = Math.pow(SUMO_TUNING.DRIFT_RETENTION, dt);
    player.vx *= drift;
    player.vy *= drift;
  }

  /** Klavye + sanal joystick + masa-ortası çubuğu → tek niyet (tahissiz). */
  readLocalIntent(player) {
    const index = player.index;
    const joy = this.joysticks?.[index];
    if (joy && joy.active && joy.force > 0.08) {
      player.moveX = Math.cos(joy.angle) * joy.force;
      player.moveY = Math.sin(joy.angle) * joy.force;
      return;
    }
    if (player.remoteActive) return;
    // Klavye: tek kaynak inputMaps (motor harita kopyalamaz, §2).
    const m = getSlotKeys(index);
    player.moveX = (this.keys[m.r] ? 1 : 0) - (this.keys[m.l] ? 1 : 0);
    player.moveY = (this.keys[m.d] ? 1 : 0) - (this.keys[m.u] ? 1 : 0);
    player.braceHeld = !!this.keys[getSecondActionKey('brace', index)];
  }

  updateGrabbed(player, dt) {
    const grabber = this.players[player.grabbedBy];
    if (!grabber || grabber.grabbing !== player.index || grabber.fallTimer > 0 || grabber.respawnTimer > 0) {
      player.grabbedBy = -1;
      return;
    }
    // Çalkalama: girdi veren rakip hızlıca çıkar, hareketsiz olan geç çıkar.
    const mash = Math.min(1, Math.hypot(player.moveX, player.moveY));
    player.grabMeter += dt * (SUMO_TUNING.ESCAPE_IDLE + mash * SUMO_TUNING.ESCAPE_MASH);
    if (player.grabMeter >= 1) {
      this.releaseGrab(grabber, player);
      grabber.chargeCooldown = Math.max(grabber.chargeCooldown, SUMO_TUNING.GRAB_CD);
      const dx = player.x - grabber.x;
      const dy = player.y - grabber.y;
      const d = Math.hypot(dx, dy) || 1;
      player.vx = (dx / d) * this.scale.shoveSpeed;
      player.vy = (dy / d) * this.scale.shoveSpeed;
      this.fx.emit('blocked', {
        x: player.x, y: player.y, color: player.color, slot: player.index,
        haptic: player.slotType === 'human',
      });
      playStumble();
      emitFloatingText(this.floatingTexts, {
        x: player.x, y: player.y - player.radius * 1.7, text: t('sumo.escaped'), color: player.color,
      });
      return;
    }
    // Asılı gövde kavrayıcının önünde taşınır.
    const link = grabber.radius + player.radius;
    player.x = grabber.x + Math.cos(grabber.angle) * link;
    player.y = grabber.y + Math.sin(grabber.angle) * link;
    player.vx = grabber.vx;
    player.vy = grabber.vy;
  }

  holdGrab(grabber, dt) {
    const victim = this.players[grabber.grabbing];
    if (!victim || victim.grabbedBy !== grabber.index) {
      grabber.grabbing = -1;
      return;
    }
    grabber.grabTimer += dt;
    if (grabber.grabTimer < SUMO_TUNING.GRAB_TIME) return;
    // Süre doldu: savurmadan bırakır (asılı kalma durumu olmasın).
    grabber.grabTimer = 0;
    this.releaseGrab(grabber, victim);
    const dx = victim.x - grabber.x;
    const dy = victim.y - grabber.y;
    const d = Math.hypot(dx, dy) || 1;
    victim.vx = (dx / d) * this.scale.shoveSpeed;
    victim.vy = (dy / d) * this.scale.shoveSpeed;
  }

  // ── çarpışma / impuls ─────────────────────────────────────────────────────

  resolveContacts() {
    for (let i = 0; i < this.players.length; i += 1) {
      const a = this.players[i];
      if (!this.canTouch(a)) continue;
      for (let j = i + 1; j < this.players.length; j += 1) {
        const b = this.players[j];
        if (!this.canTouch(b)) continue;
        if (b.index === a.grabbing || a.index === b.grabbing) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const minDist = a.radius + b.radius;
        const distSq = dx * dx + dy * dy;
        if (distSq > minDist * minDist) continue;

        const dist = Math.sqrt(distSq) || 0.0001;
        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = (minDist - dist) * 0.5;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;

        const relSpeed = Math.abs((a.vx - b.vx) * nx + (a.vy - b.vy) * ny);
        const attacker = a.chargeTimer > 0 ? a : (b.chargeTimer > 0 ? b : null);
        if (attacker && relSpeed > this.scale.impactMin) {
          this.applyImpact(attacker, attacker === a ? b : a, nx, ny, relSpeed);
        } else {
          this.tryGrab(a, b);
        }
      }
    }
  }

  canTouch(p) {
    return p.isJoined && p.isAlive && p.fallTimer <= 0 && p.respawnTimer <= 0 && p.grabbedBy < 0;
  }

  applyImpact(attacker, target, nx, ny, relSpeed) {
    attacker.chargeTimer = 0;
    if (target.invuln > 0) return;

    const braced = target.braced;
    const pushX = braced ? -nx : nx;
    const pushY = braced ? -ny : ny;
    const knock = SUMO_TUNING.KNOCK * relSpeed * (braced ? SUMO_TUNING.BRACE_KNOCK : 1) / Math.max(0.5, target.mass);
    const recoil = (braced ? SUMO_TUNING.BRACE_RECOIL : SUMO_TUNING.ATTACKER_RECOIL) * knock * 0.5;
    target.vx += pushX * knock;
    target.vy += pushY * knock;
    attacker.vx -= pushX * recoil / Math.max(0.5, attacker.mass);
    attacker.vy -= pushY * recoil / Math.max(0.5, attacker.mass);
    target.braced = false;
    target.lastHitBy = attacker.index;

    if (braced) {
      this.fx.emit('blocked', {
        x: target.x, y: target.y, color: target.color, dirX: nx, dirY: ny,
        slot: target.index, haptic: target.slotType === 'human',
      });
      playStumble();
      this.addDirectionalTrauma(0.1, nx, ny);
      emitFloatingText(this.floatingTexts, {
        x: target.x, y: target.y - target.radius * 1.7, text: t('sumo.blocked'), color: UI_COLORS.hudShield,
      });
      return;
    }
    this.fx.emit('hit', {
      x: target.x, y: target.y, color: attacker.color, dirX: nx, dirY: ny,
      slot: target.index, haptic: target.slotType === 'human',
    });
    playHeavyImpact();
    this.addDirectionalTrauma(0.16, nx, ny);
  }

  /** Kavrama: ancak köklenmiş ya da hızını kesmiş rakip kaldırılır. */
  tryGrab(a, b) {
    const grabber = this.canGrab(a, b) ? a : (this.canGrab(b, a) ? b : null);
    if (!grabber) return;
    const victim = grabber === a ? b : a;
    if (victim.invuln > 0 || victim.chargeTimer > 0) return;
    grabber.grabbing = victim.index;
    grabber.grabTimer = 0;
    victim.grabbedBy = grabber.index;
    victim.grabMeter = 0;
    victim.chargeTimer = 0;
    victim.braced = false;
    this.fx.emit('pickup', {
      x: victim.x, y: victim.y, color: grabber.color, slot: victim.index,
      haptic: victim.slotType === 'human' || grabber.slotType === 'human',
    });
    playPowerUp();
  }

  canGrab(grabber, victim) {
    if (grabber.grabbing >= 0 || grabber.chargeTimer > 0) return false;
    if (grabber.chargeCooldown > SUMO_TUNING.GRAB_ARM_CD) return false;
    if (victim.braced) return true;
    return Math.hypot(victim.vx, victim.vy) < this.scale.moveSpeed * SUMO_TUNING.GRAB_SLOW_FACTOR;
  }

  // ── halka / düşme / geri doğma ────────────────────────────────────────────

  checkRing() {
    for (const player of this.players) {
      if (!player.isJoined || !player.isAlive || player.fallTimer > 0 || player.respawnTimer > 0) continue;
      const dx = player.x - this.ring.cx;
      const dy = player.y - this.ring.cy;
      if (Math.hypot(dx, dy) <= this.ring.r) continue;
      this.dropPlayer(player);
    }
  }

  dropPlayer(player) {
    player.fallTimer = SUMO_TUNING.FALL_TIME;
    player.isAlive = false;
    player.braced = false;
    player.braceHeld = false;
    player.chargeTimer = 0;
    if (player.grabbing >= 0) this.releaseGrab(player, this.players[player.grabbing]);
    if (player.grabbedBy >= 0) this.releaseGrab(this.players[player.grabbedBy], player);

    const otherTeam = player.team === 0 ? 1 : 0;
    this.teamTakedowns[otherTeam] += 1;
    const credited = player.lastHitBy >= 0 ? this.players[player.lastHitBy] : null;
    if (credited && credited.team === otherTeam) credited.takedowns += 1;
    player.lastHitBy = -1;

    this.ring.ratio = Math.max(SUMO_TUNING.RING_FLOOR, this.ring.ratio * SUMO_TUNING.SHRINK_PER_TAKEDOWN);
    this.ring.r = this.ring.r0 * this.ring.ratio;

    this.fx.emit('kill', {
      x: player.x, y: player.y, color: player.color, size: player.radius * 2,
      ringRadius: player.radius * 3.2, dirX: 0, dirY: 1,
      slot: player.index, haptic: player.slotType === 'human',
    });
    playExplosion();
    this.addTrauma(0.26);
    emitFloatingText(this.floatingTexts, {
      x: player.x, y: player.y - player.radius * 2,
      text: t('sumo.down', player.name), color: player.color,
    });
  }

  respawn(player) {
    // Takımının tarafına, merkeze yakın: düşen çok geçmeden geri basar.
    const side = player.team === 0 ? Math.PI * 0.75 : Math.PI * 0.25;
    player.x = this.ring.cx + Math.cos(side) * this.ring.r * 0.5;
    player.y = this.ring.cy + Math.sin(side) * this.ring.r * 0.5;
    player.vx = 0;
    player.vy = 0;
    player.fallTimer = 0;
    player.respawnTimer = 0;
    player.invuln = SUMO_TUNING.INVULN_TIME;
    player.isAlive = true;
    this.fx.emit('dust', { x: player.x, y: player.y, color: player.color, slot: player.index });
    playJoin();
  }

  // ── girdi geçidi (§1: uzak girdi yalnız buradan) ──────────────────────────

  handleRemoteInput(slotIndex, data) {
    const player = this.players[slotIndex];
    if (!player || !player.isJoined || !data) return;

    if (matchesInputAction(data, 'charge', 'SUMO_CHARGE')) {
      this.attemptCharge(player);
      return;
    }
    if (isInputIntent(data, 'action', 'brace', 'release') || data.action === 'SUMO_BRACE_RELEASE') {
      player.braceHeld = false;
      player.remoteActive = false;
      return;
    }
    if (isInputIntent(data, 'action', 'brace') || data.action === 'SUMO_BRACE') {
      player.braceHeld = true;
      return;
    }
    if (isInputIntent(data, 'move') || data.action === 'JOYSTICK_MOVE') {
      const force = Number.isFinite(data.force) ? Math.max(0, Math.min(1, data.force)) : 0;
      player.remoteActive = force > 0.05;
      player.remoteMove.x = Math.cos(data.angle || 0) * force;
      player.remoteMove.y = Math.sin(data.angle || 0) * force;
      player.moveX = player.remoteMove.x;
      player.moveY = player.remoteMove.y;
      if (force > 0.05) player.angle = data.angle || 0;
      return;
    }
    this.handleStandardRemoteJoystick(slotIndex, data);
  }

  onTouchesReset() {
    this.resetTabletopTouches();
    for (const p of this.players) {
      p.moveX = 0;
      p.moveY = 0;
      p.remoteActive = false;
      if (p.slotType === 'human') p.braceHeld = false;
    }
  }

  onTouchStart(touch) {
    if (this.state === 'LOBBY' || this.state === 'MATCH_OVER') {
      if (this.handleUiTap(touch)) return;
    }
    if (this.state === 'MATCH_OVER') {
      matchOverRestartTap(this, touch, { onRestart: () => { this.startNewMatch(); playJoin(); } });
      return;
    }
    if (this.handleRoundOverSkip()) return;
    if (this.state === 'LOBBY') {
      if (lobbyCenterStartTap(this, touch)) return;
      lobbyQuadrantTap(this, touch);
      return;
    }
    this.handleTabletopTouchStart(touch);
  }

  onTouchMove(touch) {
    this.handleTabletopTouchMove(touch);
  }

  onTouchEnd(touch) {
    this.handleTabletopTouchEnd(touch);
  }

  createWorldPacket() {
    return createSumoWorldPacket(this);
  }

  getEntitiesList() {
    return this.players.filter((p) => p.isJoined && p.isAlive);
  }

  // ── çizim ─────────────────────────────────────────────────────────────────

  render(ctx) {
    ctx.save();
    this.applyScreenShake(ctx, 16);
    drawSumoArena(ctx, this.arena, this.ring, { roundId: this.roundId });
    drawSumoPlayers(ctx, this.players, {
      ring: this.ring,
      withFx: this.state === 'PLAYING',
      now: this.lastTime,
      selfSlot: this.localControlSlot ?? -1,
    });
    drawSumoFxLayer(ctx, {
      pops: this.fx.pops, rings: this.fx.rings, particles: this.particles,
    });
    renderFloatingTexts(ctx, this.floatingTexts, 0.016);
    this.renderRoundPressure(ctx);
    ctx.restore();

    this.renderControls(ctx, { extraEntities: this.getEntitiesList() });
    this.renderHUD(ctx, {
      guideTitle: t('guide.sumo'),
      guideEntries: ['P1 [WASD · SPACE · C]', 'P2 [OKLAR · ENTER · .]', 'P3 [IJKL · O · M]', 'P4 [TFGH · B · N]'],
      colors: SUMO_COLORS,
      accent: UI_COLORS.danger,
      scoreboardEntities: this.getEntitiesList(),
      matchOverHeadline: this.matchDraw ? t('game.draw') : t('game.champWon'),
      matchOverRows: this.players.filter((p) => p.isJoined).map((p) => ({
        color: p.color,
        name: p.name,
        value: `${this.scores[p.index]}R · ${this.teamTakedowns[p.team]}↓`,
        score: this.scores[p.index],
      })),
      onSeatChange: (i) => {
        if (this.players[i]) {
          this.players[i].isJoined = this.isSlotJoined(i);
          this.players[i].slotType = this.slotTypes[i];
          this.players[i].isAlive = this.players[i].isJoined;
        }
        this.applyTeamBalance();
        playJoin();
      },
    });
  }

  /** Kenar baskısı: halka küçüldükçe platformun dış çeperi kırmızıya çalar. */
  renderRoundPressure(ctx) {
    const shrink = 1 - this.ring.ratio;
    if (shrink <= 0.02) return;
    const flash = fxFlashAlpha(this.fx.flash, this.fx.flashPeak);
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, shrink * 1.4) + flash * 0.3;
    ctx.strokeStyle = UI_COLORS.crimson || SUMO_COLORS[0];
    ctx.lineWidth = Math.max(2, this.arena.size * 0.008);
    ctx.beginPath();
    ctx.arc(this.ring.cx, this.ring.cy, this.ring.r + ctx.lineWidth, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}
