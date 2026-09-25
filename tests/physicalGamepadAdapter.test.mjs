import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalGamepadAdapter } from '../src/controllers/physicalGamepadAdapter.js';
import { getControlDescriptor } from '../src/core/controlDescriptor.js';
import { GAMEPAD_SCHEMAS } from '../src/controllers/gamepadSchemas.js';

function pad(overrides = {}) {
  return {
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    ...overrides,
  };
}

test('physical gamepad adapter emits canonical transport actions without becoming authoritative', () => {
  let mode = 'RACE';
  let now = 100;
  const connectedPad = pad({ axes: [0.6, 0, 0, 0] });
  const sent = [];
  const adapter = new PhysicalGamepadAdapter({
    send: (data) => sent.push(data),
    getMode: () => mode,
    getDescriptor: () => getControlDescriptor(mode, GAMEPAD_SCHEMAS[mode]),
    getGamepads: () => [connectedPad],
    now: () => now,
    schedule: () => 1,
    cancel: () => {},
  });

  assert.equal(adapter.start(), true);
  adapter.poll();
  assert.equal(sent[0].action, 'JOYSTICK_MOVE');
  assert.equal(sent[0].intent, undefined);

  connectedPad.buttons[0] = { pressed: true, value: 1 };
  adapter.poll();
  assert.equal(sent.at(-1).action, 'DASH');

  now = 200;
  mode = 'ARCHER';
  connectedPad.buttons[0] = { pressed: false, value: 0 };
  connectedPad.axes = [0, 0, 0.5, 0];
  adapter.poll();
  assert.equal(sent.at(-1).action, 'AIM_MOVE');

  mode = 'HORDE';
  connectedPad.axes = [0, 0, 0, 0];
  connectedPad.buttons[0] = { pressed: true, value: 1 };
  adapter.poll();
  assert.equal(sent.at(-1).action, 'HORDE_FIRE');
  connectedPad.buttons[0] = { pressed: false, value: 0 };
  adapter.poll();
  assert.equal(sent.at(-1).action, 'HORDE_FIRE_RELEASE');
  adapter.stop();
});

test('physical gamepad adapter yields to local input and sends neutral only on transition', () => {
  let blocked = true;
  const sent = [];
  const adapter = new PhysicalGamepadAdapter({
    send: (data) => sent.push(data),
    getMode: () => 'RACE',
    getDescriptor: () => getControlDescriptor('RACE', GAMEPAD_SCHEMAS.RACE),
    isBlocked: () => blocked,
    getGamepads: () => [pad()],
    now: () => 100,
    schedule: () => 1,
    cancel: () => {},
  });
  adapter.start();
  adapter.poll();
  adapter.poll();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, 'JOYSTICK_MOVE');
  assert.equal(sent[0].force, 0);

  blocked = false;
  adapter.poll();
  adapter.poll();
  assert.equal(sent.length, 1);
});
