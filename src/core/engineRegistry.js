// Brutal Party Games — Central Cartridge & Engine Registry
// Single authoritative source for game definitions, metadata, engines, and controller bindings.
//
// Code-splitting: game modules are NOT imported eagerly. Each cartridge holds a
// `load()` returning its game class via dynamic import; `ensureEngine(mode)`
// imports on demand (first select / card hover) and caches the instance.
// AI modules ride along automatically (each game imports only its own AI).

import { GAMEPAD_SCHEMAS } from '../controllers/gamepadSchemas.js';
import { t } from '../i18n.js';

export const GAME_ORDER = [
  'PONG',
  'ARCHER',
  'TANKS',
  'CURVE',
  'BOMB',
  'HEIST',
  'CROWN',
  'ZONE',
  'SNAKE',
  'LASER',
  'CLONE',
  'COLLAPSE',
  'NINJA',
  'RACE',
];

export const CARTRIDGES = {
  PONG: {
    id: 'PONG',
    title: 'BRUTAL PONG',
    hudTag: '🏓 PONG',
    tacticalHintKey: 'hint.pong',
    color: '#D84727',
    schema: GAMEPAD_SCHEMAS.PONG,
    load: () => import('../games/game.js').then((m) => m.Game),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; game.accumulator = 0; },
        onResume: (now) => { game.lastTime = now; game.accumulator = 0; },
        start: () => game.startNewMatch(),
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
      };
    },
  },

  TANKS: {
    id: 'TANKS',
    title: 'MICRO-TANKS',
    hudTag: '🛡️ TANKS',
    tacticalHintKey: 'hint.tanks',
    color: '#3B82F6',
    schema: GAMEPAD_SCHEMAS.TANKS,
    worldView: {
      load: () => import('../ui/tanksWorldView.js'),
    },
    load: () => import('../games/tanks.js').then((m) => m.TanksGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
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
      };
    },
  },

  CURVE: {
    id: 'CURVE',
    title: 'BRUTAL CURVE',
    hudTag: '🐍 CURVE',
    tacticalHintKey: 'hint.curve',
    color: '#10B981',
    schema: GAMEPAD_SCHEMAS.CURVE,
    worldView: {
      load: () => import('../ui/curveWorldView.js'),
    },
    load: () => import('../games/curve.js').then((m) => m.CurveGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive ?? p.alive),
          timeLeft: Math.max(0, Math.ceil((game.roundLimit || 120) - (game.roundTimer || 0))),
          matchDraw: game.matchDraw === true,
        }),
      };
    },
  },

  BOMB: {
    id: 'BOMB',
    title: 'BRUTAL BOMB',
    hudTag: '💣 BOMB',
    tacticalHintKey: 'hint.bomb',
    color: '#EF4444',
    schema: GAMEPAD_SCHEMAS.BOMB,
    worldView: {
      load: () => import('../ui/bombWorldView.js'),
    },
    load: () => import('../games/bomb.js').then((m) => m.BombGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          carrier: game.bombCarrierIndex,
          bombTime: Math.ceil(game.bombTimer || 0),
          timeLeft: Math.max(0, Math.ceil((game.roundLimit || 90) - (game.roundTimer || 0))),
          matchDraw: game.matchDraw === true,
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown || 0) / 2.2) * 100)),
        }),
      };
    },
  },

  HEIST: {
    id: 'HEIST',
    title: 'BRUTAL HEIST',
    hudTag: '💰 HEIST',
    tacticalHintKey: 'hint.heist',
    color: '#F59E0B',
    schema: GAMEPAD_SCHEMAS.HEIST,
    worldView: {
      load: () => import('../ui/heistWorldView.js'),
    },
    load: () => import('../games/heist.js').then((m) => m.HeistGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          timeLeft: Math.ceil(game.roundTimer || 0),
          carried: game.players.map((p) => p.carriedGold || 0),
          vault: game.players.map((p) => p.vaultGold || 0),
          matchDraw: game.matchDraw === true,
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.tackleCooldown || 0) / 3.5) * 100)),
        }),
      };
    },
  },

  ARCHER: {
    id: 'ARCHER',
    title: 'BRUTAL ARCHERY',
    hudTag: '🏹 ARCHER',
    tacticalHintKey: 'hint.archer',
    color: '#8B5CF6',
    schema: GAMEPAD_SCHEMAS.ARCHER,
    worldView: {
      load: () => import('../ui/archerWorldView.js'),
    },
    load: () => import('../games/archer.js').then((m) => m.ArcherGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          timeLeft: Math.ceil(game.roundTimer || 0),
          chg: game.players.map((p) => Math.round((p.charge || 0) * 100)),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.shotCooldown || 0) / 0.8) * 100)),
        }),
      };
    },
  },

  CROWN: {
    id: 'CROWN',
    title: 'BRUTAL CROWN',
    hudTag: '👑 CROWN',
    tacticalHintKey: 'hint.crown',
    color: '#EAB308',
    schema: GAMEPAD_SCHEMAS.CROWN,
    load: () => import('../games/crown.js').then((m) => m.CrownGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        packet: () => ({
          scores: game.scores,
          king: game.crown.carrierIndex,
          matchDraw: game.matchDraw === true,
          timeLeft: Math.max(0, Math.ceil(game.roundTimer || 0)),
          crownTimes: game.players.map((p) => Math.round(p.crownHoldTime * 10) / 10),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.tackleCooldown || 0) / 2.0) * 100)),
        }),
      };
    },
  },

  ZONE: {
    id: 'ZONE',
    title: 'BRUTAL ZONE',
    hudTag: '🗺️ ZONE',
    tacticalHintKey: 'hint.zone',
    color: '#06B6D4',
    schema: GAMEPAD_SCHEMAS.ZONE,
    worldView: {
      load: () => import('../ui/zoneWorldView.js'),
    },
    load: () => import('../games/zone.js').then((m) => m.ZoneGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          pct: game.pct.map((p) => Math.round(p)),
          kills: game.kills,
          timeLeft: Math.ceil(game.roundTimer || 0),
          leader: game.leaderIndex,
          matchDraw: game.matchDraw === true,
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown || 0) / 4.0) * 100)),
        }),
      };
    },
  },

  SNAKE: {
    id: 'SNAKE',
    title: 'BRUTAL SNAKE',
    hudTag: '🐍 SNAKE',
    tacticalHintKey: 'hint.snake',
    color: '#22C55E',
    schema: GAMEPAD_SCHEMAS.SNAKE,
    worldView: {
      load: () => import('../ui/snakeWorldView.js'),
    },
    load: () => import('../games/snake.js').then((m) => m.SnakeGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          nrg: game.players.map((p) => Math.round(p.boostEnergy ?? 100)),
          lock: game.players.map((p) => (p.boostLocked ? 1 : 0)),
          timeLeft: Math.max(0, Math.ceil((game.roundLimit || 120) - (game.roundTimer || 0))),
          matchDraw: game.matchDraw === true,
        }),
      };
    },
  },

  LASER: {
    id: 'LASER',
    title: 'BRUTAL LASER',
    hudTag: '🔫 LASER',
    tacticalHintKey: 'hint.laser',
    color: '#EC4899',
    schema: GAMEPAD_SCHEMAS.LASER,
    worldView: {
      load: () => import('../ui/laserWorldView.js'),
    },
    load: () => import('../games/laser.js').then((m) => m.LaserGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          hp: game.players.map((p) => p.hp || 0),
          matchDraw: game.matchDraw === true,
          timeLeft: Math.ceil(game.matchTimer || 0),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown) / 4.0) * 100)),
          cdFire: game.players.map((p) => {
            if ((p.ammo ?? 2) > 0) return 0;
            const reloadMax = p.fastTimer > 0 ? 0.45 : 0.9;
            return Math.ceil((Math.max(0, p.reloadTimer || 0) / reloadMax) * 100);
          }),
          ammo: game.players.map((p) => (p.ammo !== undefined ? p.ammo : 2)),
        }),
      };
    },
  },

  CLONE: {
    id: 'CLONE',
    title: 'BRUTAL CLONE',
    hudTag: '👥 CLONE',
    tacticalHintKey: 'hint.clone',
    color: '#6366F1',
    schema: GAMEPAD_SCHEMAS.CLONE,
    worldView: {
      load: () => import('../ui/cloneWorldView.js'),
    },
    load: () => import('../games/clone.js').then((m) => m.CloneGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          timeLeft: Math.max(0, Math.ceil(game.roundTime || 0)),
          matchDraw: game.matchDraw === true,
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown) / 1.6) * 100)),
        }),
      };
    },
  },

  COLLAPSE: {
    id: 'COLLAPSE',
    title: 'BRUTAL COLLAPSE',
    hudTag: '🕳️ COLLAPSE',
    tacticalHintKey: 'hint.collapse',
    color: '#64748B',
    schema: GAMEPAD_SCHEMAS.COLLAPSE,
    worldView: {
      load: () => import('../ui/collapseWorldView.js'),
    },
    load: () => import('../games/collapse.js').then((m) => m.CollapseGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          timeLeft: Math.max(0, Math.ceil(game.roundTime || 0)),
          matchDraw: game.matchDraw === true,
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.jumpCooldown) / 1.6) * 100)),
        }),
      };
    },
  },

  NINJA: {
    id: 'NINJA',
    title: 'BRUTAL NINJA',
    hudTag: '🥷 NINJA',
    tacticalHintKey: 'hint.ninja',
    color: '#1E293B',
    schema: GAMEPAD_SCHEMAS.NINJA,
    worldView: {
      load: () => import('../ui/ninjaWorldView.js'),
    },
    load: () => import('../games/ninja.js').then((m) => m.NinjaGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        worldPacket: () => game.createWorldPacket(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          timeLeft: Math.max(0, Math.ceil(game.roundTime || 0)),
          matchDraw: game.matchDraw === true,
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.strikeCooldown) / 1.3) * 100)),
          cd2: game.players.map((p) => Math.ceil((Math.max(0, p.smokeCooldown || 0) / 5.0) * 100)),
        }),
      };
    },
  },

  RACE: {
    id: 'RACE',
    title: 'BRUTAL RACE',
    lobbyTitle: 'BRUTAL RACE',
    hudTag: 'RACE',
    tacticalHintKey: 'hint.race',
    color: '#D99B26',
    schema: GAMEPAD_SCHEMAS.RACE,
    load: () => import('../games/race.js').then((m) => m.RaceGame),
    createEngine: (game) => {
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
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
        }),
      };
    },
  },
};

const registry = {};
const loadingPromises = {};
let engineCanvas = null;

export function registerCartridge(cartridge) {
  CARTRIDGES[cartridge.id] = cartridge;
  if (!GAME_ORDER.includes(cartridge.id)) {
    GAME_ORDER.push(cartridge.id);
  }
}

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

// Fire-and-forget ön-yükleme (kart hover/touchstart): hatalar sessizce yutulur,
// gerçek seçim anındaki ensureEngine yine de sonucu/hatayı yönetir.
export function preloadEngine(mode) {
  if (registry[mode] || loadingPromises[mode]) return;
  ensureEngine(mode).catch(() => {});
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

// NOTE: initAllCartridges removed (code-splitting) — engines load on demand
// via ensureEngine(). forEachEngine/getEngine only see loaded engines.

export function getControllerMeta(mode) {
  if (mode === 'LOBBY') {
    return { hudTag: t('pad.lobbyTag') };
  }
  const cart = CARTRIDGES[mode];
  if (!cart) return null;
  return {
    hudTag: cart.hudTag,
    lobbyTitle: cart.lobbyTitle || `${cart.hudTag.split(' ')[0]} ${cart.title}`,
    tacticalHint: t(cart.tacticalHintKey || ''),
    tacticalHintKey: cart.tacticalHintKey,
    schema: cart.schema,
    worldView: cart.worldView || null,
  };
}
