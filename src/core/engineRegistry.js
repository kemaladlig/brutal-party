// Brutal Party Games — Central Cartridge & Engine Registry
// Single authoritative source for game definitions, metadata, engines, and controller bindings.
//
// Code-splitting: game modules are NOT imported eagerly. Each cartridge holds a
// `load()` returning its game class via dynamic import; `ensureEngine(mode)`
// imports on demand (first select / card hover) and caches the instance.
// AI modules ride along automatically (each game imports only its own AI).

import { GAMEPAD_SCHEMAS } from '../controllers/gamepadSchemas.js';
import { reportError } from './errorReporter.js';

export const GAME_ORDER = [
  'HORDE',
  'PONG',
  'ARCHER',
  'TANKS',
  'CURVE',
  'BOMB',
  'HEIST',
  'ZONE',
  'SNAKE',
  'COLLAPSE',
  'NINJA',
  'RACE',
  'CROWN',
];

/**
 * Kapak görseli yolu — TEK formül (`public/assets/games/[oyun].webp`, 1:1).
 * OYUNLAR galerisi ile ana menünün "KALDIĞIN YER" çipi aynı yolu buradan alır;
 * oyun eklemek dosya adını değiştirmez (AGENTS §10 maddesi).
 * @param {string} mode
 * @returns {string}
 */
export function gameArtPath(mode) {
  return `/assets/games/${String(mode || '').toLowerCase()}.webp`;
}

export const CARTRIDGES = {
  PONG: {
    id: 'PONG',
    category: 'speed',
    title: 'PONG',
    tacticalHintKey: 'hint.pong',
    color: '#D84727',
    // Bölünmüş motor dosyaları denetime girer (tek dosya kuralının istisnası).
    auditFiles: ['src/games/game.js', 'src/games/paddle.js', 'src/games/ball.js'],
    schema: GAMEPAD_SCHEMAS.PONG,
    worldView: {
      load: () => import('../ui/pongWorldView.js'),
    },
    load: () => import('../games/game.js').then((m) => m.Game),
    createEngine: (game) => makeEngine(game, {
      packet: () => {
        const chgIdx = game.paddles.findIndex((p) => p.spinCharge > 0);
        return {
          scores: game.setScores,
          lives: game.paddles.map((p) => Math.max(0, p.lives || 0)),
          rally: game.ball?.rallyCount || 0,
          timeLeft: Math.max(0, Math.ceil((game.roundLimit || 120) - (game.roundPlayTimer || 0))),
          spn: Math.abs(game.ball?.spin || 0) > 8 ? 1 : 0,
          chgIdx,
          chgT: chgIdx >= 0 ? Math.round(game.paddles[chgIdx].spinCharge * 10) / 10 : 0,
          cd: game.spinCooldowns.map((c) => Math.ceil(c)),
        };
      },
      onFrame: (g) => { g.accumulator = 0; },
    }),
  },

  TANKS: {
    id: 'TANKS',
    category: 'fight',
    title: 'MICRO-TANKS',
    tacticalHintKey: 'hint.tanks',
    color: '#3B82F6',
    schema: GAMEPAD_SCHEMAS.TANKS,
    worldView: {
      load: () => import('../ui/tanksWorldView.js'),
    },
    load: () => import('../games/tanks.js').then((m) => m.TanksGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        ammo: game.tanks.map((t) => {
          const v = game.ammoVisual(t);
          return { n: v.readyCount, load: Math.round(v.progress * 20) / 20 };
        }),
        alive: game.tanks.map((t) => t.isAlive),
        timeLeft: Math.max(0, Math.ceil((game.roundLimit || 90) - (game.roundTimer || 0))),
        suddenDeath: game.suddenDeath ? 1 : 0,
        introTime: Math.max(0, Math.ceil(game.spawnIntroTimer || 0)),
      }),
    }),
  },

  CURVE: {
    id: 'CURVE',
    category: 'strategy',
    title: 'CURVE',
    tacticalHintKey: 'hint.curve',
    color: '#10B981',
    // Çizgi gövde: I7 okunabilirlik eşiği 4.5px (varsayılan 12px değil).
    minPlayerDiameter: 4.5,
    schema: GAMEPAD_SCHEMAS.CURVE,
    worldView: {
      load: () => import('../ui/curveWorldView.js'),
    },
    load: () => import('../games/curve.js').then((m) => m.CurveGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        alive: game.players.map((p) => p.isAlive ?? p.alive),
        timeLeft: Math.max(0, Math.ceil((game.roundLimit || 120) - (game.roundTimer || 0))),
        matchDraw: game.matchDraw === true,
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.boostCooldown || 0) / 4.0) * 100)),
      }),
    }),
  },

  BOMB: {
    id: 'BOMB',
    category: 'fight',
    title: 'BOMB',
    tacticalHintKey: 'hint.bomb',
    color: '#EF4444',
    schema: GAMEPAD_SCHEMAS.BOMB,
    worldView: {
      load: () => import('../ui/bombWorldView.js'),
    },
    load: () => import('../games/bomb.js').then((m) => m.BombGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        carrier: game.bombCarrierIndex,
        bombTime: Math.ceil(game.bombTimer || 0),
        timeLeft: Math.max(0, Math.ceil((game.roundLimit || 90) - (game.roundTimer || 0))),
        matchDraw: game.matchDraw === true,
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown || 0) / 2.2) * 100)),
      }),
    }),
  },

  HEIST: {
    id: 'HEIST',
    category: 'fight',
    title: 'HEIST',
    tacticalHintKey: 'hint.heist',
    color: '#F59E0B',
    schema: GAMEPAD_SCHEMAS.HEIST,
    worldView: {
      load: () => import('../ui/heistWorldView.js'),
    },
    load: () => import('../games/heist.js').then((m) => m.HeistGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        timeLeft: Math.ceil(game.roundTimer || 0),
        carried: game.players.map((p) => p.carriedGold || 0),
        vault: game.players.map((p) => p.vaultGold || 0),
        matchDraw: game.matchDraw === true,
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.tackleCooldown || 0) / 3.5) * 100)),
      }),
    }),
  },

  ARCHER: {
    id: 'ARCHER',
    category: 'aim',
    title: 'ARCHERY',
    tacticalHintKey: 'hint.archer',
    color: '#8B5CF6',
    schema: GAMEPAD_SCHEMAS.ARCHER,
    worldView: {
      load: () => import('../ui/archerWorldView.js'),
    },
    load: () => import('../games/archer.js').then((m) => m.ArcherGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        alive: game.players.map((p) => p.isAlive),
        timeLeft: Math.ceil(game.roundTimer || 0),
        chg: game.players.map((p) => Math.round((p.charge || 0) * 100)),
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.shotCooldown || 0) / 0.8) * 100)),
      }),
    }),
  },

  CROWN: {
    id: 'CROWN',
    category: 'fight',
    title: 'CROWN',
    tacticalHintKey: 'hint.crown',
    color: '#EAB308',
    schema: GAMEPAD_SCHEMAS.CROWN,
    worldView: {
      load: () => import('../ui/crownWorldView.js'),
    },
    load: () => import('../games/crown.js').then((m) => m.CrownGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        king: game.crown.carrierIndex,
        matchDraw: game.matchDraw === true,
        timeLeft: Math.max(0, Math.ceil(game.roundTimer || 0)),
        crownTimes: game.players.map((p) => Math.round(p.crownHoldTime * 10) / 10),
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.tackleCooldown || 0) / 2.0) * 100)),
      }),
    }),
  },

  ZONE: {
    id: 'ZONE',
    category: 'strategy',
    title: 'ZONE',
    tacticalHintKey: 'hint.zone',
    color: '#06B6D4',
    schema: GAMEPAD_SCHEMAS.ZONE,
    worldView: {
      load: () => import('../ui/zoneWorldView.js'),
    },
    load: () => import('../games/zone.js').then((m) => m.ZoneGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        pct: game.pct.map((p) => Math.round(p)),
        kills: game.kills,
        timeLeft: Math.ceil(game.roundTimer || 0),
        leader: game.leaderIndex,
        matchDraw: game.matchDraw === true,
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown || 0) / 4.0) * 100)),
      }),
    }),
  },

  SNAKE: {
    id: 'SNAKE',
    category: 'strategy',
    title: 'SNAKE',
    tacticalHintKey: 'hint.snake',
    color: '#22C55E',
    schema: GAMEPAD_SCHEMAS.SNAKE,
    worldView: {
      load: () => import('../ui/snakeWorldView.js'),
    },
    load: () => import('../games/snake.js').then((m) => m.SnakeGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        alive: game.players.map((p) => p.isAlive),
        nrg: game.players.map((p) => Math.round(p.boostEnergy ?? 100)),
        lock: game.players.map((p) => (p.boostLocked ? 1 : 0)),
        timeLeft: Math.max(0, Math.ceil((game.roundLimit || 120) - (game.roundTimer || 0))),
        matchDraw: game.matchDraw === true,
      }),
    }),
  },

  COLLAPSE: {
    id: 'COLLAPSE',
    category: 'strategy',
    title: 'COLLAPSE',
    tacticalHintKey: 'hint.collapse',
    color: '#64748B',
    schema: GAMEPAD_SCHEMAS.COLLAPSE,
    worldView: {
      load: () => import('../ui/collapseWorldView.js'),
    },
    load: () => import('../games/collapse.js').then((m) => m.CollapseGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        alive: game.players.map((p) => p.isAlive),
        timeLeft: Math.max(0, Math.ceil(game.roundTime || 0)),
        matchDraw: game.matchDraw === true,
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.jumpCooldown) / 1.6) * 100)),
      }),
    }),
  },

  NINJA: {
    id: 'NINJA',
    category: 'fight',
    title: 'NINJA',
    tacticalHintKey: 'hint.ninja',
    color: '#1E293B',
    schema: GAMEPAD_SCHEMAS.NINJA,
    worldView: {
      load: () => import('../ui/ninjaWorldView.js'),
    },
    load: () => import('../games/ninja.js').then((m) => m.NinjaGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        alive: game.players.map((p) => p.isAlive),
        timeLeft: Math.max(0, Math.ceil(game.roundTime || 0)),
        matchDraw: game.matchDraw === true,
        cd: game.players.map((p) => Math.ceil((Math.max(0, p.strikeCooldown) / 1.3) * 100)),
        cd2: game.players.map((p) => Math.ceil((Math.max(0, p.smokeCooldown || 0) / 5.0) * 100)),
      }),
    }),
  },

  HORDE: {
    id: 'HORDE',
    category: 'fight',
    title: 'HORDE',
    lobbyTitle: 'HORDE',
    tacticalHintKey: 'hint.horde',
    color: '#7C3AED',
    schema: GAMEPAD_SCHEMAS.HORDE,
    worldView: {
      load: () => import('../ui/hordeWorldView.js'),
    },
    load: () => import('../games/horde.js').then((m) => m.HordeGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        alive: game.players.map((player) => player.isAlive),
        hp: game.players.map((player) => Math.max(0, player.hp || 0)),
        phase: game.state === 'ROUND_PAUSE' ? 'armory' : game.state,
        round: game.round,
        nextRound: game.nextRound,
        wave: game.wave,
        enemiesLeft: game.enemies.length,
        portal: !!game.portal,
        waveTime: Math.max(0, Math.ceil(game.waveTimer || 0)),
        roundBreakTime: Math.max(0, Math.ceil(game.roundBreakTimer || 0)),
        weapons: game.players.map((player) => player.weaponId || 'SIDEARM'),
        ammo: game.players.map((player) => (Number.isFinite(player.ammo) ? player.ammo : -1)),
        magazines: game.players.map((player) => Number.isFinite(player.magazine) ? player.magazine : -1),
        reloading: game.players.map((player) => (Number(player.reloadTimer) || 0) > 0),
        cd: game.players.map((player) => {
          const maxCooldown = 4 * Math.pow(0.8, Number(player.upgrades?.SERVO) || 0);
          return Math.min(100, Math.ceil((Math.max(0, player.dashCooldown || 0) / maxCooldown) * 100));
        }),
        cdFire: game.players.map((player) => game.state === 'ROUND_PAUSE'
          ? 100
          : Math.min(100, Math.ceil((Math.max(0, player.attackCooldown || 0) + (Number(player.reloadTimer) || 0)) * 100))),
      }),
    }),
  },

  RACE: {
    id: 'RACE',
    category: 'speed',
    title: 'RACE',
    lobbyTitle: 'RACE',
    tacticalHintKey: 'hint.race',
    color: '#D99B26',
    // Paylaşılan tur mantığı denetime girer.
    auditFiles: ['src/games/raceLogic.js'],
    schema: GAMEPAD_SCHEMAS.RACE,
    worldView: {
      load: () => import('../ui/raceWorldView.js'),
    },
    load: () => import('../games/race.js').then((m) => m.RaceGame),
    createEngine: (game) => makeEngine(game, {
      packet: () => ({
        scores: game.scores,
        timeLeft: Math.ceil(game.roundTimer || 0),
        matchDraw: game.matchDraw === true,
        roundId: game.roundId || 0,
        laps: game.players.map((player) => player.laps || 0),
        progress: game.players.map((player) => Math.round(game.getProgressFraction(player) * 100)),
        targetLaps: game.targetLaps,
        leader: game.getLeaderIndex(),
        cd: game.players.map((player) => Math.ceil((Math.max(0, player.dashCooldown || 0) / 2.8) * 100)),
        nitro: game.players.map((player) => Math.round(player.nitroEnergy ?? 100)),
      }),
    }),
  },
};

/**
 * Ortam iskeleti: `game`, `reset`, `onEnter`, `onResume`, `start`,
 * `worldPacket`. 13 kartuşun altısı da birebir aynıydı; oyun-özeli tek
 * parça `packet`, PONG'un `accumulator` sıfırlamasıdır (`onFrame`).
 */
/**
 * @param {any} game
 * @param {{packet?: () => any, onFrame?: ((g: any) => void) | null}} [hooks]
 */
function makeEngine(game, { packet, onFrame = null } = {}) {
  const enter = (now) => {
    game.lastTime = now;
    if (onFrame) onFrame(game);
  };
  return {
    game,
    reset: () => game.resetMatch(),
    onEnter: enter,
    onResume: enter,
    start: () => game.startNewMatch(),
    worldPacket: () => game.createWorldPacket(),
    packet,
  };
}

const registry = {};
const loadingPromises = {};
// Modül bir kez indirildiğinde buraya yazılır (Faz 4.5: örnek yıkılsa bile
// import önbelleği kalıcıdır) — yükleme toast'i ancak soğuk modülde basılır.
const moduleWarm = new Set();
let engineCanvas = null;

// Boot'ta bir kez çağrılır (motor kurmaz — sadece canvas'ı saklar).
export function initEngineRegistry(canvas) {
  engineCanvas = canvas;
}

// Motoru istenirse yükler (dinamik import), kurar ve önbelleğe alır.
// Aynı motora eşzamanlı istekler tek promise'i paylaşır; hata hâli temizlenir
// (sonraki deneme yeniden yüklemeyi dener).
export async function ensureEngine(mode) {
  if (registry[mode]) return registry[mode];
  const cart = CARTRIDGES[mode];
  if (!cart || typeof cart.load !== 'function') return null;
  if (!loadingPromises[mode]) {
    loadingPromises[mode] = cart.load().then((GameClass) => {
      if (!engineCanvas) throw new Error('Engine canvas not set');
      const entry = cart.createEngine(new GameClass(engineCanvas));
      registerEngine(mode, entry);
      moduleWarm.add(mode);
      return entry;
    }).catch((err) => {
      delete loadingPromises[mode];
      throw err;
    });
  }
  return loadingPromises[mode];
}

export function isEngineLoaded(mode) {
  return !!registry[mode];
}

// Örnek yıkılmış olsa bile modül bir kez indirildiyse true — yükleme
// bildiriminin yalnız soğuk modülde basılması için.
export function isEngineWarm(mode) {
  return !!registry[mode] || moduleWarm.has(mode);
}

// Fire-and-forget ön-yükleme (kart hover/touchstart): yalnız MODÜLü ısıtır,
// örnek kurmaz — tek-koltuk tahliyesi (releaseAllExcept) önbelleği korur.
// Hatalar sessizce yutulur; gerçek seçim anındaki ensureEngine yine de
// sonucu/hatayı yönetir.
export function preloadEngine(mode) {
  const cart = CARTRIDGES[mode];
  if (!cart || typeof cart.load !== 'function') return;
  if (registry[mode] || loadingPromises[mode]) return;
  cart.load().then(() => moduleWarm.add(mode)).catch(() => {});
}

export function registerEngine(mode, entry) {
  registry[mode] = entry;
}

export function getEngine(mode) {
  return registry[mode] || null;
}

export function getEngineGame(mode) {
  return registry[mode]?.game || null;
}

export function forEachEngine(cb) {
  for (const mode of GAME_ORDER) {
    if (registry[mode]) cb(mode, registry[mode]);
  }
}

// ── Faz 4.5 — tek-koltuk tahliyesi ──────────────────────────────────────────
// ES modül önbelleği boşaltılamaz; ama motor ÖRNEĞİ yıkılabilir. Mod
// değişiminde aktif olmayan tüm örnekler destroy edilir (BaseGame.destroy()
// klavye aboneliğini bırakır); sonraki seçimde örnek ucuzca yeniden kurulur,
// modül zaten bellektedir. `destroy()` motor zamanlayıcısı olan bir oyuna
// genişletilirse buradan geçmek zorundadır.
export function releaseEngine(mode) {
  const entry = registry[mode];
  if (!entry) return false;
  try {
    entry.game?.destroy?.();
  } catch (err) {
    reportError(err, `engineRegistry.releaseEngine:${mode}`, { warnOnly: true });
  }
  delete registry[mode];
  delete loadingPromises[mode];
  return true;
}

export function releaseAllExcept(activeMode) {
  for (const mode of Object.keys(registry)) {
    if (mode !== activeMode) releaseEngine(mode);
  }
}

// Teşhis kancası: bellek baskısı ölçümü için hangi örnekler ayakta.
export function getLoadedModes() {
  return Object.keys(registry);
}

// NOTE: initAllCartridges removed (code-splitting) — engines load on demand
// via ensureEngine(). forEachEngine/getEngine only see loaded engines.

export function getControllerMeta(mode) {
  if (mode === 'LOBBY') {
    return {};
  }
  const cart = CARTRIDGES[mode];
  if (!cart) return null;
  return {
    lobbyTitle: cart.lobbyTitle || cart.title,
    tacticalHintKey: cart.tacticalHintKey,
    schema: cart.schema,
    worldView: cart.worldView || null,
  };
}
