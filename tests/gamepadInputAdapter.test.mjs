import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInputAdapter } from '../src/controllers/gamepadInputAdapter.js';

test('gamepad input adapter preserves 50ms throttle and dead-zone policy', () => {
  let now = 0;
  const sent = [];
  const adapter = new GamepadInputAdapter((data) => sent.push(data), { now: () => now });

  now = 100;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0.2, dy: 0, force: 0.2 }), true);
  now = 120;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0.9, dy: 0, force: 0.9 }), false);
  now = 151;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0.2, dy: 0, force: 0.2 }), false);
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0.3, dy: 0, force: 0.3 }), true);

  now = 180;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0, dy: 0, force: 0 }), true);
  assert.equal(adapter.sendAnalog({ action: 'AIM_MOVE', dx: 0, dy: 0, force: 0 }), true);
  assert.equal(sent.length, 4);
});

test('gamepad input adapter dead-zones paddle position without throttling zero release', () => {
  let now = 0;
  const sent = [];
  const adapter = new GamepadInputAdapter((data) => sent.push(data), { now: () => now });

  now = 100;
  assert.equal(adapter.sendAnalog({ action: 'PADDLE_MOVE', position: 0.4 }), true);
  now = 120;
  assert.equal(adapter.sendAnalog({ action: 'PADDLE_MOVE', position: 0.401 }), false);
  now = 151;
  assert.equal(adapter.sendAnalog({ action: 'PADDLE_MOVE', position: 0.5 }), true);
  now = 160;
  assert.equal(adapter.sendAnalog({ action: 'PADDLE_MOVE', position: 0.5 }), false);
  assert.equal(sent.length, 2);
});
