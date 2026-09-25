import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPAD_SCHEMAS } from '../src/controllers/gamepadSchemas.js';
import { CONTROL_DEFS } from '../src/controllers/controlDefs.js';
import { getControllerGuide, getGuideActionLabel } from '../src/controllers/controllerGuide.js';

test('control guide projects every registered schema without per-game HTML', () => {
  const modes = Object.keys(CONTROL_DEFS);
  assert.equal(modes.length, 15);
  for (const mode of modes) {
    const guide = getControllerGuide(mode, GAMEPAD_SCHEMAS[mode]);
    assert.ok(guide, `${mode} has a guide`);
    assert.equal(guide.left.type, CONTROL_DEFS[mode].left);
    assert.ok(guide.left.label.length > 0);
    assert.equal(guide.aim, ['ARCHER', 'HORDE', 'LASER'].includes(mode));
    assert.ok(guide.hint.length > 0);
    assert.ok(Array.isArray(guide.actions));
    for (const action of guide.actions) assert.ok(action.label.length > 0);
  }
});

test('guide action labels are resolved from intent ids, not icon text', () => {
  assert.ok(getGuideActionLabel({ id: 'dash' }).length > 0);
  assert.ok(getGuideActionLabel({ id: 'smoke' }).length > 0);
  assert.equal(getGuideActionLabel({ id: 'unknown', label: 'CUSTOM' }), 'CUSTOM');
});
