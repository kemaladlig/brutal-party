import test from 'node:test';
import assert from 'node:assert/strict';
import { CARTRIDGES, GAME_ORDER, getControllerMeta } from '../src/core/engineRegistry.js';
import { GAMEPAD_SCHEMAS } from '../src/controllers/gamepadSchemas.js';
import {
  assertControlDescriptorParity,
  getControlDescriptor,
} from '../src/core/controlDescriptor.js';
import { getNeutralInput } from '../src/controllers/controlDefs.js';
import { keyboardVectorFrom, readSlotKeys } from '../src/core/inputMaps.js';

test('all registered games have phone/tabletop/network descriptor parity', () => {
  assert.equal(GAME_ORDER.length, 15);
  for (const mode of GAME_ORDER) {
    const schema = GAMEPAD_SCHEMAS[mode];
    const result = assertControlDescriptorParity(mode, schema);
    assert.equal(result.ok, true, `${mode}: ${result.reason}`);
    const descriptor = getControlDescriptor(mode, schema);
    assert.equal(descriptor.phone.actions.length <= 2, true);
    assert.deepEqual(
      descriptor.phone.actions.map((action) => action.id),
      descriptor.tabletop.actions.map((action) => action.id),
    );
    assert.ok(['slider', 'steer', 'pedal', 'joystick'].includes(descriptor.phone.left));
    assert.ok(['steer', 'joystick'].includes(descriptor.tabletop.left));
    assert.ok(descriptor.network.leftIntent);
    const networkIds = new Set(descriptor.network.actions.map((action) => action.id));
    for (const action of descriptor.phone.actions) assert.ok(networkIds.has(action.id));
    assert.equal(descriptor.keyboard.length, 4);
    const p1Keys = Object.fromEntries(Object.entries(descriptor.keyboard[0]).map(([key, code]) => [code, true]));
    assert.deepEqual(keyboardVectorFrom(p1Keys, 0), { x: 0, y: 0 });
    assert.deepEqual(readSlotKeys(p1Keys, 0), { dx: 0, dy: 0, action: true });
  }
});

test('every cartridge exposes the same controller metadata used by the matrix', () => {
  for (const mode of GAME_ORDER) {
    const cartridge = CARTRIDGES[mode];
    const meta = getControllerMeta(mode);
    assert.ok(cartridge, `${mode}: cartridge missing`);
    assert.ok(cartridge.schema, `${mode}: schema missing`);
    assert.ok(meta?.schema, `${mode}: controller metadata missing`);
    assert.equal(meta.schema, cartridge.schema);
  }
});

test('descriptor exposes a neutral input for every control-bearing game', () => {
  for (const mode of GAME_ORDER) {
    const neutral = getNeutralInput(mode);
    if (mode === 'PONG') assert.equal(neutral, null);
    else assert.ok(neutral && typeof neutral.action === 'string');
  }
});
