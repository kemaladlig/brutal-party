import test from 'node:test';
import assert from 'node:assert/strict';
import { AimInputState } from '../src/core/aimInput.js';

const vector = (angle, force = 1) => ({
  dx: Math.cos(angle) * force,
  dy: Math.sin(angle) * force,
  angle,
  force,
});

test('aim state latches press without firing from a neutral touch', () => {
  const state = new AimInputState();
  const press = state.press('network', vector(0, 0), { seq: 1, aimHeld: true });
  assert.equal(press.type, 'press');
  assert.equal(state.held, true);
  assert.equal(state.active, false);

  const move = state.move('network', vector(Math.PI / 2), { seq: 2, aimHeld: true });
  assert.equal(move.type, 'move');
  assert.equal(state.active, true);

  const neutral = state.move('network', vector(0, 0), { seq: 3, aimHeld: true });
  assert.equal(state.held, true);
  assert.equal(state.active, false);
  assert.equal(neutral.hasDirection, true);

  const duplicatePress = state.press('network', vector(0, 0), { seq: 4, aimHeld: true });
  assert.equal(duplicatePress.type, 'move');
  const release = state.release('network', vector(0, 0), { seq: 5 });
  assert.equal(release.previousHeld, true);
  assert.equal(release.cancelled, false);
  assert.equal(release.hasDirection, true);
  assert.equal(state.held, false);
});

test('aim state rejects stale sequence and recovers a lost press from move', () => {
  const state = new AimInputState();
  assert.equal(state.move('network', vector(0.4), { seq: 4, aimHeld: true }).type, 'press');
  const stale = state.move('network', vector(-0.8), { seq: 3, aimHeld: true });
  assert.equal(stale.accepted, false);
  assert.equal(stale.type, 'stale');
  assert.equal(state.vector.angle, 0.4);

  const release = state.release('network', vector(0.4, 0), { seq: 5, cancelled: true });
  assert.equal(release.cancelled, true);
  assert.equal(state.held, false);
});

test('aim state separates sources and resets sequence on full reset', () => {
  const state = new AimInputState();
  state.press('touch', vector(0.2), { aimHeld: true });
  state.press('network', vector(0.8), { seq: 1, aimHeld: true });
  assert.equal(state.held, true);
  assert.equal(state.clear('touch', true).length, 1);
  assert.equal(state.held, true);

  state.reset();
  assert.equal(state.held, false);
  assert.equal(state.active, false);
  assert.equal(state.move('network', vector(0.8), { seq: 1, aimHeld: true }).type, 'press');
});

test('a lower-sequence reconnect press starts a fresh held session', () => {
  const state = new AimInputState();
  state.press('network', vector(0.8), { seq: 40, aimHeld: true });
  state.release('network', vector(0.8, 0), { seq: 41 });
  const press = state.press('network', vector(0.2), { action: 'AIM_PRESS', seq: 1, aimHeld: true });
  assert.equal(press.accepted, true);
  assert.equal(press.type, 'press');
  assert.equal(state.held, true);
});
