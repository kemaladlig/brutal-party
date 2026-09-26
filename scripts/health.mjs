/**
 * scripts/health.mjs — Brutal Party Kalite Kapısı (Quality Gate Runner).
 *
 * 15 oyunun cihaz bağımsızlık değişmezlerini (I1-I7) ve ayar raporlarını (I8-I11)
 * Vite-SSR ile motorları gerçekten çalıştırarak ölçer.
 *
 * Kullanım:
 *   node scripts/health.mjs              (tablo + kapı ihlalinde exit 1)
 *   node scripts/health.mjs --json       (makine-okunur JSON)
 *   node scripts/health.mjs --report     (yalnız rapor, her zaman exit 0)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'vite';
import { discReachability, narrowestPassage } from '../tests/helpers/passability.mjs';
import {
  evaluateGame,
  TUNING_ANCHOR,
  AUTHORITY_MODES,
  GATE_THRESHOLDS,
} from '../src/core/qualityGate.js';
import {
  auditViewFidelity,
  auditMotionCues,
  auditUnscaledGeometry,
} from '../src/core/qualityAuditors.js';

const DESIGN_SHORT = 952;
const VIEWPORTS = {
  desktop: [1920, 1080],
  phone: [852, 393],
};

const noop = () => {};
const gradient = { addColorStop: noop };

// SSR tarayıcı mock'ları
globalThis.window = {
  innerWidth: 1920,
  innerHeight: 1080,
  addEventListener: noop,
  removeEventListener: noop,
  AudioContext: null,
  webkitAudioContext: null,
  matchMedia: () => ({ matches: false }),
};

globalThis.document = {
  activeElement: null,
  body: {},
  addEventListener: noop,
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ width: 0, height: 0, getContext: () => stubContext }),
};

const stubContext = new Proxy({
  measureText: () => ({ width: 0 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get: (t, k) => (k in t ? t[k] : noop),
  set: (t, k, v) => { t[k] = v; return true; },
});

function readPlayer(game) {
  const p = game.players?.[0];
  if (p && Number.isFinite(p.radius)) return { radius: p.radius, source: 'players[0].radius' };
  const tank = game.tanks?.[0];
  if (tank && Number.isFinite(tank.size)) return { radius: tank.size, source: 'tanks[0].size' };
  if (game.ball && Number.isFinite(game.ball.radius)) {
    return { radius: game.ball.radius, source: 'ball.radius' };
  }
  return { radius: null, source: null };
}

function readLargestOther(game) {
  const enemies = game.enemies || [];
  if (enemies.length) {
    const r = Math.max(...enemies.map((e) => e.radius || 0));
    if (r > 0) return { radius: r, kind: 'enemy' };
  }
  const tanks = game.tanks || [];
  if (tanks.length > 1) {
    const r = Math.max(...tanks.slice(1).map((t) => t.size || 0));
    if (r > 0) return { radius: r, kind: 'tank' };
  }
  if (game.crown && Number.isFinite(game.crown.radius)) {
    return { radius: game.crown.radius, kind: 'crown' };
  }
  return { radius: null, kind: null };
}

function readSceneMax(game) {
  const pools = [
    game.obstacles, game.pillars, game.pickups, game.crates, game.bumpers,
    game.movingHazards, game.speedPads, game.bananaPeels, game.inkPuddles,
    game.conveyors, game.checkpoints, game.npcClones, game.rooms, game.obstacleSpinners,
  ];
  let max = 0;
  for (const pool of pools) {
    if (!Array.isArray(pool)) continue;
    for (const o of pool) {
      if (Number.isFinite(o.radius)) max = Math.max(max, o.radius);
      if (Number.isFinite(o.size)) max = Math.max(max, o.size);
      if (Number.isFinite(o.w) && Number.isFinite(o.h)) {
        max = Math.max(max, Math.max(o.w, o.h) / 2);
      }
      if (Number.isFinite(o.length)) max = Math.max(max, o.length / 2);
    }
  }
  return max;
}

function playerSpeed(game) {
  const p = game.players?.[0];
  if (p && Number.isFinite(p.speed) && p.speed > 0) return p.speed;
  if (game.tanks?.[0] && Number.isFinite(game.tanks[0].speed) && game.tanks[0].speed > 0) {
    return game.tanks[0].speed;
  }
  if (game.ball && Number.isFinite(game.ball.speed) && game.ball.speed > 0) {
    return game.ball.speed;
  }
  return null;
}

async function measureCorridor(cartridge, GameClass, stubCtx) {
  try {
    const [w, h] = VIEWPORTS.desktop;
    const canvas = { width: w, height: h, getContext: () => stubCtx };
    const g = new GameClass(canvas);
    g.resize(w, h);
    g.slotTypes = ['human', 'human', 'bot', 'empty'];
    const init = g.initPlayers || g.initTanks || g.initSnakes || g.initZones;
    if (init) init.call(g);
    g.startNewMatch();
    const nodes = g.obstacles || g.pillars;
    if (!Array.isArray(nodes) || !nodes.length) return null;
    const me = readPlayer(g);
    if (!me.radius) return null;
    const narrowest = narrowestPassage(g.arena, nodes);
    const reach = discReachability(g.arena, nodes, me.radius);
    return {
      narrowest: Number.isFinite(narrowest) ? +narrowest.toFixed(0) : null,
      playerDiameter: +(me.radius * 2).toFixed(0),
      passable: narrowest >= me.radius * 2 - 0.5,
      reachable: reach.reachable,
      count: nodes.length,
    };
  } catch {
    return null;
  }
}

async function runHealthCheck() {
  const server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });

  const { CARTRIDGES, GAME_ORDER } = await server.ssrLoadModule('/src/core/engineRegistry.js');
  const { computePlayfield } = await server.ssrLoadModule('/src/core/playfield.js');

  const evaluations = [];

  for (const mode of GAME_ORDER) {
    const cartridge = CARTRIDGES[mode];
    const GameClass = await cartridge.load();
    const metrics = { mode, desktop: null, phone: null, corridor: null };

    for (const [label, [w, h]] of Object.entries(VIEWPORTS)) {
      const canvas = { width: w, height: h, getContext: () => stubContext };
      let game;
      try {
        game = new GameClass(canvas);
        game.resize(w, h);
        game.slotTypes = ['human', 'human', 'bot', 'empty'];
        const init = game.initPlayers || game.initTanks || game.initSnakes || game.initZones;
        if (init) init.call(game);
        game.startNewMatch();
        game.lastTime = 1000;

        // 1.5 sn girdi sür
        const FRAMES = 94;
        for (let i = 0; i < FRAMES; i += 1) {
          game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', dx: 0.8, dy: 0.2, angle: 0, force: 1 });
          if (typeof game.update === 'function') game.update(1000 + (i + 1) * 16);
        }
      } catch {
        continue;
      }

      const arena = game.arena;
      const short = arena.size;
      const unit = short / DESIGN_SHORT;
      const me = readPlayer(game);
      const other = readLargestOther(game);
      const speed = playerSpeed(game);

      metrics[label] = {
        insets: arena.insets ? Object.values(arena.insets).map((v) => +v.toFixed(0)).join('/') : null,
        short: +short.toFixed(1),
        unit: +unit.toFixed(3),
        aspect: +(arena.width / arena.height).toFixed(2),
        playerPx: me.radius != null ? +me.radius.toFixed(2) : null,
        playerDesign: me.radius != null ? +(me.radius / unit).toFixed(1) : null,
        playerPct: me.radius != null ? +((me.radius * 2 / short) * 100).toFixed(2) : null,
        playerSource: me.source,
        speedDesign: speed != null ? +(speed / unit).toFixed(0) : null,
        crossTime: speed ? +((short / speed)).toFixed(2) : null,
      };
    }

    metrics.corridor = await measureCorridor(cartridge, GameClass, stubContext);

    // Statik denetimler
    const playerDesignRadius = metrics.desktop?.playerDesign ?? metrics.phone?.playerDesign ?? null;
    const viewFidelity = auditViewFidelity(mode, playerDesignRadius);
    const unscaledMotionCuesCount = auditMotionCues(mode);
    const unscaledGeometryCount = auditUnscaledGeometry(mode);

    const evaluated = evaluateGame({
      mode,
      desktop: metrics.desktop,
      phone: metrics.phone,
      corridor: metrics.corridor,
      viewFidelity,
      unscaledGeometryCount,
      unscaledMotionCuesCount,
    });

    evaluations.push(evaluated);
  }

  await server.close();
  return evaluations;
}

const evaluations = await runHealthCheck();
const asJson = process.argv.includes('--json');
const reportOnly = process.argv.includes('--report');

if (asJson) {
  console.log(JSON.stringify(evaluations, null, 2));
} else {
  console.log('='.repeat(94));
  console.log('BRUTAL PARTY — CİHAZ BAĞIMSIZLIK VE KALİTE KAPISI (npm run health)');
  console.log(`ayar çıpası: ${TUNING_ANCHOR.label}`);
  console.log('otorite:     ONLINE→tel 852×393 · TV_CONSOLE→TV 1920×1080 · LOCAL→o cihaz\n');

  const head = 'OYUN'.padEnd(9)
    + 'I1(ölçek)'.padEnd(10)
    + 'I2(hız)'.padEnd(9)
    + 'I3(geçiş)'.padEnd(10)
    + 'I4(view)'.padEnd(9)
    + 'I5(geo)'.padEnd(8)
    + 'I6(motion)'.padEnd(11)
    + 'I7(okuma)'.padEnd(10)
    + '│ ' + 'I8(sapma)'.padEnd(10)
    + 'I9(oran)'.padEnd(9)
    + 'I10(kenar%)';
  console.log(head);
  console.log('-'.repeat(head.length + 2));

  let passedCount = 0;
  const allFailures = [];

  for (const ev of evaluations) {
    if (ev.passed) passedCount += 1;
    for (const f of ev.failures) {
      allFailures.push({ mode: ev.mode, text: f });
    }

    const g = ev.gates;
    const rep = ev.reports;
    const col = (gate) => (gate.ok ? 'ok'.padEnd(8) : 'HAYIR'.padEnd(8));

    console.log(
      ev.mode.padEnd(9)
      + (g.I1.ok ? 'ok' : (g.I1.value == null ? '—' : 'HAYIR')).padEnd(10)
      + (g.I2.ok ? 'ok' : (g.I2.value == null ? '—' : 'HAYIR')).padEnd(9)
      + (g.I3.ok ? 'ok' : 'HAYIR').padEnd(10)
      + (g.I4.ok ? 'ok' : 'HAYIR').padEnd(9)
      + (g.I5.ok ? 'ok' : 'HAYIR').padEnd(8)
      + (g.I6.ok ? 'ok' : 'HAYIR').padEnd(11)
      + (g.I7.ok ? 'ok' : 'HAYIR').padEnd(10)
      + '│ '
      + (rep.I8.formatted).padEnd(10)
      + (rep.I9.formatted).padEnd(9)
      + (rep.I10.formatted),
    );
  }

  console.log('-'.repeat(head.length + 2));
  console.log(`Sonuç: ${passedCount}/${evaluations.length} oyun geçti · ${allFailures.length} ihlal/kusur tespit edildi.\n`);

  if (allFailures.length > 0) {
    console.log('ÖLÇÜLMÜŞ KUSUR LİSTESİ:');
    for (const f of allFailures) {
      console.log(`  ! [${f.mode.padEnd(8)}] ${f.text}`);
    }
  }

  console.log('\nKAPILAR (I1-I7): Cihazlar arası değişmezler. İhlal build/health çıkışını 1 yapar.');
  console.log('RAPORLAR (I8-I11): Bilgi amaçlıdır. Ayar çıpasına göre sapmayı izler, yapıyı kırmaz.');
}

const totalPassed = evaluations.every((e) => e.passed);
if (!reportOnly && !totalPassed) {
  process.exit(1);
} else {
  process.exit(0);
}
