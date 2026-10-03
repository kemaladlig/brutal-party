import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const noop = () => {};
const context = new Proxy({
  measureText: () => ({ width: 0 }),
}, {
  get(target, key) {
    return key in target ? target[key] : noop;
  },
  set(target, key, value) {
    target[key] = value;
    return true;
  },
});

const canvas = { width: 800, height: 600, getContext: () => context };
let server;
let GAME_ORDER;
let CARTRIDGES;

before(async () => {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
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
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  };
  server = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    appType: 'custom',
    logLevel: 'error',
    optimizeDeps: { noDiscovery: true },
  });
  ({ GAME_ORDER, CARTRIDGES } = await server.ssrLoadModule('/src/core/engineRegistry.js'));
});

after(async () => {
  await server?.close();
});

function slotZeroEntity(game) {
  return game.players?.[0] || game.tanks?.[0] || game.paddles?.[0] || null;
}

test('every cartridge engine honors the slot contract without core mode branches', async () => {
  assert.equal(GAME_ORDER.length, 14);
  for (const mode of GAME_ORDER) {
    const GameClass = await CARTRIDGES[mode].load();
    const game = new GameClass(canvas);
    assert.equal(typeof game.applySlotIdentity, 'function', `${mode}: applySlotIdentity missing`);
    assert.equal(typeof game.neutralizeSlotInput, 'function', `${mode}: neutralizeSlotInput missing`);
    assert.equal(typeof game.swapLocalSlots, 'function', `${mode}: swapLocalSlots missing`);

    game.resize(800, 600);
    game.slotTypes = ['human', 'human', 'empty', 'empty'];
    const init = game.initPlayers || game.initTanks || game.initSnakes || game.initZones;
    if (init) init.call(game);

    game.applySlotIdentity(0, {
      slotType: 'human',
      name: 'SYNC',
      color: '#FFFFFF',
      rimColor: '#000000',
      isJoined: true,
    });
    const ent = slotZeroEntity(game);
    assert.ok(ent, `${mode}: slot 0 entity missing`);
    assert.equal(ent.name, 'SYNC', `${mode}: name not applied`);
    assert.equal(ent.color, '#FFFFFF', `${mode}: color not applied`);
    assert.equal(ent.isJoined, true, `${mode}: isJoined not applied`);

    ent.steer = 1;
    ent.steerX = 1;
    ent.steerY = -1;
    ent.remoteActive = true;
    ent.remoteMoveActive = true;
    ent.isDriving = true;
    ent.isBoost = true;
    ent.charging = true;
    ent.charge = 0.5;
    ent.isAiming = true;
    const joy = game.joysticks?.[0];
    if (joy) {
      joy.active = true;
      joy.force = 1;
    }
    game.neutralizeSlotInput(0, 'all');
    assert.equal(ent.steer ?? 0, 0, `${mode}: steer latched`);
    assert.equal(ent.steerX ?? 0, 0, `${mode}: steerX latched`);
    assert.equal(ent.steerY ?? 0, 0, `${mode}: steerY latched`);
    assert.equal(ent.remoteActive ?? false, false, `${mode}: remoteActive latched`);
    assert.equal(ent.isDriving ?? false, false, `${mode}: isDriving latched`);
    assert.equal(ent.isBoost ?? false, false, `${mode}: isBoost latched`);
    assert.equal(ent.charging ?? false, false, `${mode}: charging latched`);
    assert.equal(ent.isAiming ?? false, false, `${mode}: isAiming latched`);
    if (joy) {
      assert.equal(joy.active, false, `${mode}: joystick latched`);
      assert.equal(joy.force, 0, `${mode}: joystick force latched`);
    }
    // Koltuk kimliği latch nötrlemede korunur.
    assert.equal(ent.name, 'SYNC', `${mode}: identity lost on neutralize`);
    assert.equal(ent.isJoined, true, `${mode}: seat lost on neutralize`);
  }
});

test('neutralize scopes keep move and aim independent', async () => {
  const GameClass = await CARTRIDGES.ARCHER.load();
  const game = new GameClass(canvas);
  game.resize(800, 600);
  game.slotTypes = ['human', 'human', 'empty', 'empty'];
  game.initPlayers();
  const ent = game.players[0];
  ent.steerX = 1;
  ent.steerY = 1;
  ent.charging = true;
  ent.charge = 0.5;

  game.neutralizeSlotInput(0, 'move');
  assert.equal(ent.steerX, 0);
  assert.equal(ent.charging, true, 'move scope must preserve aim latch');

  ent.steerX = 1;
  game.neutralizeSlotInput(0, 'aim');
  assert.equal(ent.charging, false);
  assert.equal(ent.steerX, 1, 'aim scope must preserve move latch');
});
