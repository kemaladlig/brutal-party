import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidNetworkInput } from '../src/core/networkProtocol.js';

test('accepts controller actions used by every online game schema', () => {
  const packets = [
    { action: 'JOYSTICK_MOVE', dx: 0, dy: 0, angle: 0, force: 0 },
    { action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: false, seq: 1 },
    { action: 'AIM_PRESS', dx: 1, dy: 0, angle: 0, force: 1 },
    { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1 },
    { action: 'AIM_RELEASE', dx: 1, dy: 0, angle: 0, force: 1, cancelled: false },
    { action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, cancelled: true },
    { action: 'PADDLE_MOVE', position: 0.5 },
    { action: 'CURVE_STEER', dir: -1 },
    { action: 'SNAKE_STEER', dir: 1 },
    { action: 'TANK_DRIVE', driving: true },
    { action: 'TANK_FIRE' },
    { action: 'DASH' },
    { action: 'TACKLE' },
    { action: 'SPIN' },
    { action: 'SNAKE_BOOST' },
    { action: 'SNAKE_BOOST_RELEASE' },
    { action: 'ARCHER_CHARGE' },
    { action: 'ARCHER_CHARGE_END' },
    { action: 'LASER_AIM' },
    { action: 'LASER_FIRE' },
    { action: 'HORDE_FIRE' },
    { action: 'HORDE_FIRE_RELEASE' },
    { action: 'NINJA_SMOKE' },
    { action: 'SWITCH_SLOT', targetSlot: 2 },
    { action: 'SET_NAME', name: 'PLAYER' },
    { action: 'AVATAR_UPDATE', avatar: {} },
  ];

  for (const packet of packets) {
    assert.equal(isValidNetworkInput(packet), true, packet.action);
  }
});

test('rejects malformed or out-of-range network input', () => {
  assert.equal(isValidNetworkInput({ action: 'JOYSTICK_MOVE', dx: NaN, dy: 0, angle: 0, force: 0 }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_RELEASE', dx: 0, dy: 0, angle: 0, force: 0, cancelled: 'yes' }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, seq: -1 }), false);
  assert.equal(isValidNetworkInput({ action: 'AIM_MOVE', dx: 0, dy: 0, angle: 0, force: 0, aimHeld: 'yes' }), false);
  assert.equal(isValidNetworkInput({ action: 'PADDLE_MOVE', position: 1.2 }), false);
  assert.equal(isValidNetworkInput({ action: 'SNAKE_STEER', dir: 2 }), false);
  assert.equal(isValidNetworkInput({ action: 'SWITCH_SLOT', targetSlot: 4 }), false);
  assert.equal(isValidNetworkInput({ action: 'UNKNOWN' }), false);
});
