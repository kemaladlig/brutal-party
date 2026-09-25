import test from 'node:test';
import assert from 'node:assert/strict';
import { GAME_ORDER } from '../src/core/engineRegistry.js';
import { GAMEPAD_SCHEMAS } from '../src/controllers/gamepadSchemas.js';
import { getControlDescriptor } from '../src/core/controlDescriptor.js';
import { getInputIntent, normalizeInputIntent } from '../src/core/inputIntent.js';
import { InputIntentRouter } from '../src/core/inputRouter.js';
import { isValidNetworkInput } from '../src/core/networkProtocol.js';

test('every game projects its phone actions to stable engine intents', () => {
  for (const mode of GAME_ORDER) {
    const descriptor = getControlDescriptor(mode, GAMEPAD_SCHEMAS[mode]);
    for (const action of descriptor.phone.actions) {
      const transportAction = action.transportActions[0];
      if (!transportAction) continue;
      const packet = { action: transportAction };
      assert.equal(isValidNetworkInput(packet), true, `${mode}:${transportAction}`);
      const normalized = normalizeInputIntent(packet, descriptor);
      assert.equal(getInputIntent(normalized).type, 'action');
      assert.equal(getInputIntent(normalized).id, action.id);
    }
  }
});

test('continuous controls normalize without losing transport fields', () => {
  const cases = [
    ['PONG', { action: 'PADDLE_MOVE', position: 0.42 }, 'position'],
    ['TANKS', { action: 'TANK_DRIVE', driving: true }, 'drive'],
    ['CURVE', { action: 'CURVE_STEER', dir: -1 }, 'steer'],
    ['SNAKE', { action: 'SNAKE_STEER', dir: 1 }, 'steer'],
    ['RACE', { action: 'JOYSTICK_MOVE', dx: 0.2, dy: -0.4, angle: -1.1, force: 0.5 }, 'move'],
  ];
  for (const [mode, packet, type] of cases) {
    const descriptor = getControlDescriptor(mode, GAMEPAD_SCHEMAS[mode]);
    const normalized = normalizeInputIntent(packet, descriptor, 'local');
    assert.equal(getInputIntent(normalized).type, type);
    assert.equal(normalized.action, packet.action);
  }
});

test('input router keeps adapter and engine lookup outside the manager', () => {
  const received = [];
  const router = new InputIntentRouter({
    getDescriptor: () => getControlDescriptor('RACE', GAMEPAD_SCHEMAS.RACE),
    getEngine: () => ({
      handleRemoteInput(slotIndex, data) {
        received.push({ slotIndex, data });
      },
    }),
  });
  assert.equal(router.dispatch(2, { action: 'DASH' }, 'local'), true);
  assert.equal(received[0].slotIndex, 2);
  assert.equal(received[0].data.intent.id, 'dash');
  assert.equal(received[0].data.intent.source, 'local');
  assert.equal(router.dispatch(0, { action: 'DASH' }, 'network'), true);
  assert.equal(received[1].data.intent.source, 'network');
});

test('release actions preserve their canonical intent id', () => {
  const descriptor = getControlDescriptor('HORDE', GAMEPAD_SCHEMAS.HORDE);
  const normalized = normalizeInputIntent(
    { action: 'HORDE_FIRE_RELEASE' },
    descriptor,
  );
  assert.deepEqual(getInputIntent(normalized), {
    type: 'action',
    id: 'fire',
    phase: 'release',
    source: 'network',
  });
});
