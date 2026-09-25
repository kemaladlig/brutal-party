// Normalized control contract for phone, tabletop and network adapters.
// CONTROL_DEFS remains the structural source; schemas only add presentation
// metadata and transport bindings.

import { STANDARD_KEY_SLOTS } from './inputMaps.js';
import {
  MAX_TABLETOP_ACTIONS,
  getControlDef,
  getTabletopLayout,
} from '../controllers/controlDefs.js';

const SPECIAL_NETWORK_ACTIONS = {
  PONG: [
    { id: 'slider', transportActions: ['PADDLE_MOVE'] },
    { id: 'spin', transportActions: ['SPIN'] },
  ],
  TANKS: [
    { id: 'drive', transportActions: ['TANK_DRIVE'] },
    { id: 'fire', transportActions: ['TANK_FIRE'] },
  ],
  CURVE: [
    { id: 'steer', transportActions: ['CURVE_STEER'] },
  ],
  SNAKE: [
    { id: 'steer', transportActions: ['SNAKE_STEER'] },
    { id: 'boost', transportActions: ['SNAKE_BOOST', 'SNAKE_BOOST_RELEASE'] },
  ],
};

function actionConfig(schema, id) {
  if (schema?.type === 'ARCADE_DRIVE') {
    if (id === 'fire') return { id, transportActions: ['TANK_FIRE'] };
    return null;
  }
  if (schema?.type === 'SLIDER_1D' && id === 'spin') {
    return { id, transportActions: ['SPIN'] };
  }
  if (schema?.type === 'STEER_BOOST' && id === 'boost') {
    return {
      id,
      transportActions: ['SNAKE_BOOST', 'SNAKE_BOOST_RELEASE'],
    };
  }
  return (Array.isArray(schema?.actions) ? schema.actions : [])
    .find((action) => action.id === id)
    ? {
      id,
      transportActions: [
        (schema.actions.find((action) => action.id === id) || {}).action,
        (schema.actions.find((action) => action.id === id) || {}).releaseAction,
      ].filter(Boolean),
    }
    : { id, transportActions: [] };
}

function phoneActions(def, schema) {
  return def.right.map((id) => actionConfig(schema, id));
}

function networkActions(mode, def, schema) {
  const actions = [];
  const seen = new Set();
  const add = (id, transportActions = []) => {
    const key = `${id}:${transportActions.join('|')}`;
    if (seen.has(key)) return;
    seen.add(key);
    actions.push({ id, transportActions: [...transportActions] });
  };

  for (const action of SPECIAL_NETWORK_ACTIONS[mode] || []) {
    add(action.id, action.transportActions);
  }
  for (const action of Array.isArray(schema?.actions) ? schema.actions : []) {
    if (action.id) add(action.id, [action.action, action.releaseAction].filter(Boolean));
  }
  if (schema?.type === 'ARCADE_DRIVE') {
    add('drive', ['TANK_DRIVE']);
    add('fire', ['TANK_FIRE']);
  }
  if (schema?.type === 'SLIDER_1D') add('spin', ['SPIN']);
  if (schema?.type === 'STEER_BOOST') add('boost', ['SNAKE_BOOST', 'SNAKE_BOOST_RELEASE']);
  if (mode === 'CURVE') add('steer', ['CURVE_STEER']);
  if (mode === 'SNAKE') add('steer', ['SNAKE_STEER']);
  if (mode === 'PONG') add('slider', ['PADDLE_MOVE']);
  if (def.left === 'joystick') add('move', ['JOYSTICK_MOVE']);
  return actions;
}

const NETWORK_LEFT_INTENTS = {
  slider: 'slider',
  joystick: 'move',
  steer: 'steer',
  pedal: 'drive',
};

function equivalentLeftTypes(phone, tabletop) {
  if (phone === tabletop) return true;
  if (phone === 'slider' && tabletop === 'steer') return true;
  if (phone === 'pedal' && tabletop === 'joystick') return true;
  return false;
}

export function getControlDescriptor(mode, schema) {
  const def = getControlDef(mode);
  if (!def || !schema) return null;

  const phone = {
    left: def.left,
    actions: phoneActions(def, schema),
  };
  const tabletop = getTabletopLayout(mode);
  const tabletopLeft = tabletop?.steer ? 'steer' : 'joystick';
  const network = {
    left: def.left,
    leftIntent: NETWORK_LEFT_INTENTS[def.left] || 'move',
    actions: networkActions(mode, def, schema),
  };

  return {
    mode,
    phone,
    tabletop: { ...tabletop, left: tabletopLeft },
    keyboard: STANDARD_KEY_SLOTS.map((mapping) => ({ ...mapping })),
    network,
  };
}

export function assertControlDescriptorParity(mode, schema) {
  const descriptor = getControlDescriptor(mode, schema);
  if (!descriptor) return { ok: false, reason: 'missing-control-definition' };

  const phoneIds = descriptor.phone.actions.map((action) => action.id);
  const tabletopIds = descriptor.tabletop.actions.map((action) => action.id);
  if (!equivalentLeftTypes(descriptor.phone.left, descriptor.tabletop.left)) {
    return { ok: false, reason: 'phone-tabletop-left-mismatch' };
  }
  if (phoneIds.length > MAX_TABLETOP_ACTIONS) {
    return { ok: false, reason: 'too-many-actions' };
  }
  if (phoneIds.join('|') !== tabletopIds.join('|')) {
    return { ok: false, reason: 'phone-tabletop-action-mismatch' };
  }
  const networkIds = new Set(descriptor.network.actions.map((action) => action.id));
  const missing = phoneIds.filter((id) => !networkIds.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: `network-actions-missing:${missing.join(',')}` };
  }
  if (!descriptor.network.leftIntent) {
    return { ok: false, reason: 'network-left-intent-missing' };
  }
  if (descriptor.keyboard.length !== 4
    || descriptor.keyboard.some((mapping) => !mapping.u || !mapping.d || !mapping.l || !mapping.r || !mapping.action)) {
    return { ok: false, reason: 'keyboard-slot-contract-invalid' };
  }
  return { ok: true, descriptor };
}
