import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const gradient = { addColorStop: noop };
const context = new Proxy({
  measureText: () => ({ width: 20 }),
  createLinearGradient: () => gradient,
  createRadialGradient: () => gradient,
}, {
  get(target, property) {
    return property in target ? target[property] : noop;
  },
  set(target, property, value) {
    target[property] = value;
    return true;
  },
});

const canvas = {
  width: 1280,
  height: 720,
  style: {},
  getContext: () => context,
};

let server;
let RaceGame;

before(async () => {
  globalThis.window = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener: noop,
    removeEventListener: noop,
    AudioContext: null,
  };
  globalThis.document = {
    activeElement: null,
    addEventListener: noop,
    removeEventListener: noop,
  };

  server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  ({ RaceGame } = await server.ssrLoadModule('/src/games/race.js'));
});

after(async () => {
  await server?.close();
});

function createGame() {
  const game = new RaceGame(canvas);
  game.resize(1280, 720);
  game.startNewMatch();
  game.render();
  return game;
}

function placeAtCheckpoint(player, checkpointIndex, game, laps = player.laps) {
  player.nextCheckpoint = checkpointIndex;
  player.laps = laps;
  const checkpoint = game.checkpoints[checkpointIndex];
  player.x = checkpoint.x;
  player.y = checkpoint.y;
}

test('a single finisher receives one point and the next round rotates track', () => {
  const game = createGame();
  placeAtCheckpoint(game.players[0], 2, game, 3);
  game.update(performance.now() + 16);

  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.scores[0], 1);
  assert.equal(game.roundWinner, game.players[0]);

  game.roundTransitionTimer = 0;
  game.update(performance.now() + 32);
  assert.equal(game.state, 'PLAYING');
  assert.equal(game.currentPreset, 'ZIGZAG');
});

test('simultaneous finishers are treated as a draw instead of awarding array order', () => {
  const game = createGame();
  placeAtCheckpoint(game.players[0], 2, game, 3);
  placeAtCheckpoint(game.players[1], 2, game, 3);
  game.update(performance.now() + 16);

  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.roundWinner, null);
  assert.deepEqual(game.scores, [0, 0, 0, 0]);
});

test('endRound is idempotent', () => {
  const game = createGame();
  const winner = game.players[0];
  game.endRound(winner);
  game.endRound(winner);

  assert.equal(game.state, 'ROUND_OVER');
  assert.equal(game.scores[0], 1);
});

test('non-playing remote joystick packets are neutralized', () => {
  const game = createGame();
  game.state = 'LOBBY';
  game.handleRemoteInput(0, { action: 'JOYSTICK_MOVE', angle: 1.2, force: 1 });

  assert.equal(game.joysticks[0].active, false);
  assert.equal(game.joysticks[0].force, 0);
});

test('match-over rendering does not accumulate restart buttons', () => {
  const game = createGame();
  game.state = 'MATCH_OVER';
  game.matchWinner = game.players[0];
  game.render();
  const firstCount = game.uiButtons.length;
  game.render();
  game.render();

  assert.equal(firstCount, 1);
  assert.equal(game.uiButtons.length, 1);
  game.onTouchStart({ x: game.arena.cx, y: game.arena.cy, id: 99 });
  assert.equal(game.state, 'LOBBY');
});
