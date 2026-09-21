// Declarative Controller Schemas for Brutal Party Games
// Modifying a game's controls or adding a new game now only requires adding or editing a schema here.
// Labels resolve via t() at import (boot language); controller re-mounts pick up language changes.

import { t } from '../i18n.js';

export const GAMEPAD_SCHEMAS = {
  PONG: {
    type: 'SLIDER_1D',
    spinCooldown: 20.0,
  },

  TANKS: {
    type: 'ARCADE_DRIVE',
    pedalIcon: '🚀',
    pedalTitle: t('pad.drive'),
    pedalSub: t('pad.pedalSub'),
    fireIcon: '💥',
    fireTitle: t('pad.fire'),
    fireDebounceMs: 450,
  },

  CURVE: {
    type: 'TWO_BUTTON_STEER',
    leftLabel: t('pad.steerLeft'),
    rightLabel: t('pad.steerRight'),
  },

  BOMB: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        label: t('pad.dash'),
        sub: t('pad.tap'),
        cooldown: 2.2,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
    onSync(gamepad, data) {
      const isCarrier = data.carrier === gamepad.playerIndex;
      gamepad.overlay.classList.toggle('bomb-carrier-alert', isCarrier);
      const tacticalRoleEl = document.getElementById('tactical-role-text');
      if (tacticalRoleEl) {
        tacticalRoleEl.textContent = isCarrier
          ? t('pad.bombCarry')
          : t('pad.bombSafe');
        tacticalRoleEl.style.color = isCarrier ? '#ff6b6b' : '#25d366';
      }
    },
    onTeardown(gamepad) {
      gamepad.overlay.classList.remove('bomb-carrier-alert');
    },
  },

  HEIST: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'tackle',
        action: 'TACKLE',
        label: t('pad.shove'),
        sub: t('pad.tap'),
        color: '#d99b26',
        cooldown: 3.5,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
  },

  DUEL: {
    type: 'REACTION_TAP',
    tapAction: 'DUEL_TAP',
  },

  CROWN: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'tackle',
        action: 'TACKLE',
        label: t('pad.shove'),
        sub: t('pad.tap'),
        color: '#f59e0b',
        cooldown: 2.0,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
    onSync(gamepad, data) {
      const isKing = data.king === gamepad.playerIndex;
      gamepad.overlay.classList.toggle('crown-king-alert', isKing);
      const tacticalRoleEl = document.getElementById('tactical-role-text');
      if (tacticalRoleEl) {
        tacticalRoleEl.textContent = isKing
          ? t('pad.kingKeep')
          : t('pad.kingSteal');
        tacticalRoleEl.style.color = isKing ? '#ffd700' : '#ffffff';
      }
    },
    onTeardown(gamepad) {
      gamepad.overlay.classList.remove('crown-king-alert');
    },
  },

  ZONE: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        label: t('pad.dash'),
        sub: t('pad.tap'),
        color: '#2f6a4f',
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  SNAKE: {
    type: 'STEER_BOOST',
    leftLabel: t('pad.steerLeft'),
    rightLabel: t('pad.steerRight'),
    boostLabel: t('pad.boost'),
    boostSub: t('pad.hold'),
    boostColor: '#2F6A4F',
    steerAction: 'SNAKE_STEER',
    boostStartAction: 'SNAKE_BOOST',
    boostEndAction: 'SNAKE_BOOST_RELEASE',
  },

  LASER: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'fire',
        action: 'TANK_FIRE',
        label: t('pad.fireGun'),
        sub: t('pad.tap'),
        className: 'laser-btn-fire',
        cooldown: 0.9,
        vibrate: [25, 40],
        syncHostCooldown: true,
        hostCdField: 'cdFire',
      },
      {
        id: 'dash',
        action: 'DASH',
        label: '💨 DASH',
        sub: t('pad.tap'),
        className: 'laser-btn-dash',
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  CLONE: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'tackle',
        action: 'TACKLE',
        label: t('pad.shove'),
        sub: t('pad.tap'),
        color: '#6A4C93',
        cooldown: 1.6,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
  },

  COLLAPSE: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'jump',
        action: 'DASH',
        label: t('pad.jump'),
        sub: t('pad.tap'),
        color: '#B5831F',
        cooldown: 1.6,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
  },

  NINJA: {
    type: 'JOYSTICK_ACTION',
    layout: 'stack',
    actions: [
      {
        id: 'strike',
        action: 'DASH',
        label: t('pad.blade'),
        sub: t('pad.lunge'),
        color: '#1A1A1A',
        flex: 1.2,
        minHeight: '80px',
        cooldown: 1.3,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
      {
        id: 'smoke',
        action: 'NINJA_SMOKE',
        label: t('pad.smoke'),
        sub: t('pad.hide'),
        color: '#333333',
        border: '#555555',
        flex: 0.9,
        minHeight: '60px',
        cooldown: 5.0,
        vibrate: [20, 35],
        syncHostCooldown: true,
        hostCdField: 'cd2',
      },
    ],
  },
};
