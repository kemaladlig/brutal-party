// Shared phone control-guide projection. It derives one small, localizable
// descriptor from CONTROL_DEFS + the declarative gamepad schema.

import { getControlDescriptor } from '../core/controlDescriptor.js';
import { t } from '../i18n.js';

const LEFT_LABEL_KEYS = {
  slider: 'pad.guideSlider',
  steer: 'pad.guideSteer',
  pedal: 'pad.guidePedal',
  joystick: 'pad.guideJoystick',
};

const ACTION_LABEL_KEYS = {
  spin: 'pad.spinShort',
  fire: 'pad.fireGun',
  dash: 'pad.dash',
  tackle: 'pad.shove',
  charge: 'pad.archerCharge',
  boost: 'pad.boost',
  strike: 'pad.blade',
  smoke: 'pad.smoke',
  jump: 'pad.jump',
};

function actionLabel(action) {
  const key = action?.labelKey || ACTION_LABEL_KEYS[action?.id];
  if (key) return t(key);
  return action?.label || t('pad.action');
}

function actionDescriptors(schema) {
  if (schema?.type === 'ARCADE_DRIVE') {
    return [
      { id: 'drive', label: t(schema.pedalLabelKey || 'pad.drive') },
      { id: 'fire', label: t(schema.fireLabelKey || 'pad.fireGun') },
    ];
  }

  if (schema?.type === 'SLIDER_1D') {
    return [{ id: 'spin', label: t('pad.spinShort') }];
  }

  if (schema?.type === 'STEER_BOOST') {
    return [{ id: 'boost', label: t('pad.boost') }];
  }

  return (Array.isArray(schema?.actions) ? schema.actions : []).map((action) => ({
    id: action.id || action.action || 'action',
    label: actionLabel(action),
  }));
}

function leftDescriptor(type) {
  return {
    type,
    label: t(LEFT_LABEL_KEYS[type] || 'pad.guideJoystick'),
  };
}

export function getGuideActionLabel(action) {
  return actionLabel(action);
}

export function getControllerGuide(mode, schema) {
  const descriptor = getControlDescriptor(mode, schema);
  if (!descriptor) return null;

  const left = leftDescriptor(descriptor.phone.left);
  const actions = actionDescriptors(schema);
  const hint = descriptor.phone.left === 'steer'
    ? `${t('pad.steerLeft')} / ${t('pad.steerRight')}`
    : descriptor.phone.left === 'pedal'
      ? t('pad.pedalSub')
      : t(LEFT_LABEL_KEYS[descriptor.phone.left] || 'pad.guideJoystick');

  return {
    mode,
    left,
    aim: descriptor.phone.aim,
    actions,
    hint,
  };
}
