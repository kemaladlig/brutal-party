// Brutal Party Games — Central Cartridge & Engine Registry
// Single authoritative source for game definitions, metadata, engines, and controller bindings.

import { Game as PongGame } from '../games/game.js';
import { TanksGame } from '../games/tanks.js';
import { CurveGame } from '../games/curve.js';
import { BombGame } from '../games/bomb.js';
import { HeistGame } from '../games/heist.js';
import { DuelGame } from '../games/duel.js';
import { CrownGame } from '../games/crown.js';
import { ZoneGame } from '../games/zone.js';
import { SnakeGame } from '../games/snake.js';
import { LaserGame } from '../games/laser.js';
import { CloneGame } from '../games/clone.js';
import { CollapseGame } from '../games/collapse.js';
import { NinjaGame } from '../games/ninja.js';
import { GAMEPAD_SCHEMAS } from '../controllers/gamepadSchemas.js';

export const GAME_ORDER = [
  'PONG',
  'TANKS',
  'CURVE',
  'BOMB',
  'HEIST',
  'DUEL',
  'CROWN',
  'ZONE',
  'SNAKE',
  'LASER',
  'CLONE',
  'COLLAPSE',
  'NINJA',
];

export const CARTRIDGES = {
  PONG: {
    id: 'PONG',
    title: 'BRUTAL PONG',
    hudTag: '🏓 PONG',
    tacticalHint: 'PADDLE SÜRÜKLE • 🌀 FALSO İLE ŞAŞIRT',
    color: '#D84727',
    GameClass: PongGame,
    schema: GAMEPAD_SCHEMAS.PONG,
    createEngine: (canvas) => {
      const game = new PongGame(canvas);
      return {
        game,
        reset: () => game.resetCurrentGame(),
        onEnter: (now) => { game.lastTime = now; game.accumulator = 0; },
        onResume: (now) => { game.lastTime = now; game.accumulator = 0; },
        start: () => game.startNewMatch(),
        packet: () => {
          const chgIdx = game.paddles.findIndex((p) => p.spinCharge > 0);
          return {
            scores: game.setScores,
            rally: game.ball?.rallyCount || 0,
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
    tacticalHint: '🚀 GAZ VER (BASILI TUT) • 💥 NİŞAN ALIP ATEŞ ET',
    color: '#3B82F6',
    GameClass: TanksGame,
    schema: GAMEPAD_SCHEMAS.TANKS,
    createEngine: (canvas) => {
      const game = new TanksGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({
          scores: game.scores,
          ammo: game.tanks.map((t) => {
            const v = game.ammoVisual(t);
            return { n: v.readyCount, load: Math.round(v.progress * 20) / 20 };
          }),
          alive: game.tanks.map((t) => t.isAlive),
        }),
      };
    },
  },

  CURVE: {
    id: 'CURVE',
    title: 'BRUTAL CURVE',
    hudTag: '🐍 CURVE',
    tacticalHint: '◀ SOL / SAĞ ▶ DÖNÜŞ • DUVARLARDAN KAÇ',
    color: '#10B981',
    GameClass: CurveGame,
    schema: GAMEPAD_SCHEMAS.CURVE,
    createEngine: (canvas) => {
      const game = new CurveGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({ scores: game.scores, alive: game.players.map((p) => p.alive) }),
      };
    },
  },

  BOMB: {
    id: 'BOMB',
    title: 'BRUTAL BOMB',
    hudTag: '💣 BOMB',
    tacticalHint: '🕹️ HAREKET ET • ⚡ DEPAR İLE KAÇ VEYA DOKUN',
    color: '#EF4444',
    GameClass: BombGame,
    schema: GAMEPAD_SCHEMAS.BOMB,
    createEngine: (canvas) => {
      const game = new BombGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewRound(),
        packet: () => ({
          scores: game.scores,
          carrier: game.bombCarrierIndex,
          bombTime: Math.ceil(game.bombTimer || 0),
        }),
      };
    },
  },

  HEIST: {
    id: 'HEIST',
    title: 'BRUTAL HEIST',
    hudTag: '💰 HEIST',
    tacticalHint: '🕹️ HAREKET ET • 💥 OMUZ AT VE ELMASI ÇAL',
    color: '#F59E0B',
    GameClass: HeistGame,
    schema: GAMEPAD_SCHEMAS.HEIST,
    createEngine: (canvas) => {
      const game = new HeistGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewRound(),
        packet: () => ({
          scores: game.scores,
          timeLeft: Math.ceil(game.roundTimer || 0),
        }),
      };
    },
  },

  DUEL: {
    id: 'DUEL',
    title: 'QUICK DRAW',
    hudTag: '🤠 DUEL',
    tacticalHint: '✋ BEKLE • SİNYALİ GÖRÜNCE EN HIZLI DOKUN!',
    color: '#8B5CF6',
    GameClass: DuelGame,
    schema: GAMEPAD_SCHEMAS.DUEL,
    createEngine: (canvas) => {
      const game = new DuelGame(canvas);
      return {
        game,
        reset: () => game.reset(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewMatch(),
        packet: () => ({ scores: game.scores, duelState: game.state, winner: game.roundWinner }),
      };
    },
  },

  CROWN: {
    id: 'CROWN',
    title: 'BRUTAL CROWN',
    hudTag: '👑 CROWN',
    tacticalHint: '🕹️ HAREKET ET • 💥 OMUZ AT VE TACI KORU',
    color: '#EAB308',
    GameClass: CrownGame,
    schema: GAMEPAD_SCHEMAS.CROWN,
    createEngine: (canvas) => {
      const game = new CrownGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewRound(),
        packet: () => ({
          scores: game.scores,
          king: game.crown.carrierIndex,
          crownTimes: game.players.map((p) => Math.round(p.crownHoldTime * 10) / 10),
        }),
      };
    },
  },

  ZONE: {
    id: 'ZONE',
    title: 'BRUTAL ZONE',
    hudTag: '🗺️ ZONE',
    tacticalHint: '🕹️ HAREKET ET • ⚡ DEPAR İLE ALANA GİR',
    color: '#06B6D4',
    GameClass: ZoneGame,
    schema: GAMEPAD_SCHEMAS.ZONE,
    createEngine: (canvas) => {
      const game = new ZoneGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startNewRound(),
        packet: () => ({
          scores: game.scores,
          pct: game.pct.map((p) => Math.round(p)),
          kills: game.kills,
          timeLeft: Math.ceil(game.roundTimer || 0),
          leader: game.leaderIndex,
        }),
      };
    },
  },

  SNAKE: {
    id: 'SNAKE',
    title: 'BRUTAL SNAKE',
    hudTag: '🐍 SNAKE',
    tacticalHint: '🕹️ 4-YÖN D-PAD İLE YÖNLEN • ⚡ BASILI TUTUP HIZLAN',
    color: '#22C55E',
    GameClass: SnakeGame,
    schema: GAMEPAD_SCHEMAS.SNAKE,
    createEngine: (canvas) => {
      const game = new SnakeGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
        }),
      };
    },
  },

  LASER: {
    id: 'LASER',
    title: 'BRUTAL LASER',
    hudTag: '🔫 LASER',
    tacticalHint: '🕹️ NİŞAN AL • 🔫 ATEŞ ET & 💨 DEPAR AT',
    color: '#EC4899',
    GameClass: LaserGame,
    schema: GAMEPAD_SCHEMAS.LASER,
    createEngine: (canvas) => {
      const game = new LaserGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          hp: game.players.map((p) => p.hp || 0),
          timeLeft: Math.ceil(game.matchTimer || 0),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown) / 4.0) * 100)),
        }),
      };
    },
  },

  CLONE: {
    id: 'CLONE',
    title: 'BRUTAL CLONE',
    hudTag: '👥 CLONE',
    tacticalHint: '🕹️ ROL YAP & GÖREV YAP • 💥 RAKİBİ BUL VE OMUZ AT',
    color: '#6366F1',
    GameClass: CloneGame,
    schema: GAMEPAD_SCHEMAS.CLONE,
    createEngine: (canvas) => {
      const game = new CloneGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.dashCooldown) / 1.5) * 100)),
        }),
      };
    },
  },

  COLLAPSE: {
    id: 'COLLAPSE',
    title: 'BRUTAL COLLAPSE',
    hudTag: '🕳️ COLLAPSE',
    tacticalHint: '🕹️ HAREKET ET • ⤴️ BOŞLUKTAN ZIPLA',
    color: '#64748B',
    GameClass: CollapseGame,
    schema: GAMEPAD_SCHEMAS.COLLAPSE,
    createEngine: (canvas) => {
      const game = new CollapseGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.jumpCooldown) / 1.8) * 100)),
        }),
      };
    },
  },

  NINJA: {
    id: 'NINJA',
    title: 'BRUTAL NINJA',
    hudTag: '🥷 NINJA',
    tacticalHint: '🕹️ HAREKET ET • DURUP GİZLEN • 🗡️ KILIÇ • 💨 SİS',
    color: '#1E293B',
    GameClass: NinjaGame,
    schema: GAMEPAD_SCHEMAS.NINJA,
    createEngine: (canvas) => {
      const game = new NinjaGame(canvas);
      return {
        game,
        reset: () => game.resetMatch(),
        onEnter: (now) => { game.lastTime = now; },
        onResume: (now) => { game.lastTime = now; },
        start: () => game.startRound(),
        packet: () => ({
          scores: game.scores,
          alive: game.players.map((p) => p.isAlive),
          cd: game.players.map((p) => Math.ceil((Math.max(0, p.strikeCooldown) / 1.5) * 100)),
        }),
      };
    },
  },
};

const registry = {};

export function registerCartridge(cartridge) {
  CARTRIDGES[cartridge.id] = cartridge;
  if (!GAME_ORDER.includes(cartridge.id)) {
    GAME_ORDER.push(cartridge.id);
  }
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

export function initAllCartridges(canvas) {
  for (const mode of GAME_ORDER) {
    const cart = CARTRIDGES[mode];
    if (cart && typeof cart.createEngine === 'function') {
      registerEngine(mode, cart.createEngine(canvas));
    }
  }
}

export function getControllerMeta(mode) {
  if (mode === 'LOBBY') {
    return { hudTag: '📺 PARTİ LOBİSİ' };
  }
  const cart = CARTRIDGES[mode];
  if (!cart) return null;
  return {
    hudTag: cart.hudTag,
    lobbyTitle: `${cart.hudTag.split(' ')[0]} ${cart.title}`,
    tacticalHint: cart.tacticalHint,
    schema: cart.schema,
  };
}
