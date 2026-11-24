import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadInputAdapter } from '../src/controllers/gamepadInputAdapter.js';

test('gamepad input adapter preserves analog throttle and dead-zone policy', () => {
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

test('gamepad input adapter gives move and aim independent throttle budgets', () => {
  let now = 0;
  const sent = [];
  const adapter = new GamepadInputAdapter((data) => sent.push(data), { now: () => now });

  now = 100;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0.5, dy: 0, force: 0.5 }), true);
  now = 120;
  assert.equal(adapter.sendAnalog({ action: 'AIM_MOVE', dx: 0.5, dy: 0, force: 0.5, aimHeld: true }), true);
  now = 130;
  assert.equal(adapter.sendAnalog({ action: 'AIM_MOVE', dx: -0.5, dy: 0, force: 0.5, aimHeld: true }), false);
  now = 151;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: -0.5, dy: 0, force: 0.5 }), true);
  now = 201;
  assert.equal(adapter.sendAnalog({ action: 'AIM_MOVE', dx: 0.5, dy: 0, force: 0.5, aimHeld: true }), true);
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

test('gamepad input adapter flushes trailing analog update and cancels on zero or reset', () => {
  let now = 100;
  const sent = [];
  const scheduled = [];
  let nextId = 1;
  const cancelled = [];
  const adapter = new GamepadInputAdapter((data) => sent.push(data), {
    now: () => now,
    schedule: (fn, ms) => {
      const id = nextId++;
      scheduled.push({ id, fn, ms });
      return id;
    },
    cancel: (id) => cancelled.push(id),
  });

  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 1, dy: 0, force: 1 }), true);
  now = 115;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0, dy: 1, force: 1 }), false);
  assert.equal(scheduled.length, 1);

  now = 145;
  scheduled[0].fn();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].dy, 1);

  now = 155;
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: -1, dy: 0, force: 1 }), false);
  assert.equal(scheduled.length, 2);
  assert.equal(adapter.sendAnalog({ action: 'JOYSTICK_MOVE', dx: 0, dy: 0, force: 0 }), true);
  assert.ok(cancelled.includes(scheduled[1].id));
  adapter.reset();
});
