// Declarative Controller Schemas for Brutal Party Games
// Modifying a game's controls or adding a new game now only requires adding or editing a schema here.
// Labels resolve via t() at import (boot language); controller re-mounts pick up language changes.

import { t } from '../i18n.js';
import { CONTROL_DEFS } from './controlDefs.js';

export const GAMEPAD_SCHEMAS = {
  PONG: {
    type: 'SLIDER_1D',
    def: CONTROL_DEFS.PONG,
    spinCooldown: 20.0,
  },

  TANKS: {
    type: 'ARCADE_DRIVE',
    def: CONTROL_DEFS.TANKS,
    pedalIcon: '🚀',
    pedalTitle: t('pad.drive'),
    pedalSub: t('pad.pedalSub'),
    fireIcon: '💥',
    fireTitle: t('pad.fire'),
    fireDebounceMs: 450,
  },

  CURVE: {
    type: 'STEER_ACTION',
    def: CONTROL_DEFS.CURVE,
    steerAction: 'CURVE_STEER',
    leftLabel: t('pad.steerLeft'),
    rightLabel: t('pad.steerRight'),
    actions: [
      {
        id: 'boost',
        action: 'CURVE_BOOST',
        icon: 'zap',
        label: t('pad.boost'),
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  BOMB: {
    type: 'JOYSTICK_ACTION',
    def: CONTROL_DEFS.BOMB,
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        icon: '⚡',
        label: t('pad.dash'),
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
    def: CONTROL_DEFS.HEIST,
    actions: [
      {
        id: 'tackle',
        action: 'TACKLE',
        icon: '🥊',
        label: t('pad.shove'),
        color: '#d99b26',
        cooldown: 3.5,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
    onSync(gamepad, data) {
      if (!Array.isArray(data.carried)) return;
      let lead = -1;
      let max = 0;
      data.carried.forEach((c, i) => {
        if ((c || 0) > max) { max = c || 0; lead = i; }
      });
      const isLead = lead === gamepad.playerIndex && max > 0;
      gamepad.overlay.classList.toggle('gem-carrier-alert', isLead);
      const tacticalRoleEl = document.getElementById('tactical-role-text');
      if (tacticalRoleEl) {
        tacticalRoleEl.textContent = isLead
          ? t('pad.heistLead')
          : lead >= 0 && max > 0
            ? t('pad.heistChase', lead + 1)
            : t('pad.heistGrab');
        tacticalRoleEl.style.color = isLead ? '#ffd700' : '#ffffff';
      }
    },
    onTeardown(gamepad) {
      gamepad.overlay.classList.remove('gem-carrier-alert');
    },
  },

  ARCHER: {
    type: 'TWIN_STICK_ACTION',
    def: CONTROL_DEFS.ARCHER,
    actions: [],
  },

  CROWN: {
    type: 'JOYSTICK_ACTION',
    def: CONTROL_DEFS.CROWN,
    actions: [
      {
        id: 'tackle',
        action: 'TACKLE',
        icon: '👑',
        label: t('pad.shove'),
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
    def: CONTROL_DEFS.ZONE,
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        icon: '⚡',
        label: t('pad.dash'),
        color: '#2f6a4f',
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  SNAKE: {
    type: 'STEER_ACTION',
    def: CONTROL_DEFS.SNAKE,
    steerAction: 'SNAKE_STEER',
    leftLabel: '◀',
    rightLabel: '▶',
    actions: [
      {
        id: 'boost',
        action: 'SNAKE_BOOST',
        releaseAction: 'SNAKE_BOOST_RELEASE',
        hold: true,
        icon: 'zap',
        label: t('pad.boost'),
        color: '#2F6A4F',
      },
    ],
    // Enerji/hazır durumu buton opaklığına ve kumanda üstü etikete yansır
    // (arketip oyun-özgü sunumu bilmez; buradan bildirilir).
    onSync(gamepad, data, { buttonEls }) {
      const btn = buttonEls[0]?.el;
      const nrg = Array.isArray(data?.nrg) ? (data.nrg[gamepad.playerIndex] ?? 100) : 100;
      const locked = Array.isArray(data?.lock) ? !!data.lock[gamepad.playerIndex] : false;
      const dead = Array.isArray(data?.alive) ? data.alive[gamepad.playerIndex] === false : false;
      if (btn) btn.style.opacity = locked || dead ? 0.55 : 1;
      const nrgText = document.getElementById('snake-nrg-text');
      if (nrgText) {
        const txt = dead ? t('pad.deadShort') : locked ? t('pad.lockedFire') : `${Math.round(nrg)}% NRG`;
        if (nrgText.textContent !== txt) nrgText.textContent = txt;
      }
    },
  },

  LASER: {
    type: 'TWIN_STICK_ACTION',
    def: CONTROL_DEFS.LASER,
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        icon: 'zap',
        label: t('pad.dash'),
        className: 'laser-btn-dash',
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  CLONE: {
    type: 'JOYSTICK_ACTION',
    def: CONTROL_DEFS.CLONE,
    actions: [
      {
        id: 'tackle',
        action: 'TACKLE',
        icon: '💥',
        label: t('pad.shove'),
        color: '#6A4C93',
        cooldown: 1.6,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
  },

  COLLAPSE: {
    type: 'JOYSTICK_ACTION',
    def: CONTROL_DEFS.COLLAPSE,
    actions: [
      {
        id: 'jump',
        action: 'DASH',
        icon: '⏫',
        label: t('pad.jump'),
        color: '#B5831F',
        cooldown: 1.6,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
    ],
  },

  NINJA: {
    type: 'JOYSTICK_ACTION',
    def: CONTROL_DEFS.NINJA,
    layout: 'stack',
    actions: [
      {
        id: 'strike',
        action: 'DASH',
        icon: '⚔️',
        label: t('pad.blade'),
        color: '#1A1A1A',
        flex: 1.2,
        minHeight: '76px',
        cooldown: 1.3,
        vibrate: [25, 40],
        syncHostCooldown: true,
      },
      {
        id: 'smoke',
        action: 'NINJA_SMOKE',
        icon: '💨',
        label: t('pad.smoke'),
        color: '#333333',
        border: '#555555',
        flex: 0.9,
        minHeight: '58px',
        cooldown: 5.0,
        vibrate: [20, 35],
        syncHostCooldown: true,
        hostCdField: 'cd2',
      },
    ],
  },

  HORDE: {
    type: 'TWIN_STICK_ACTION',
    def: CONTROL_DEFS.HORDE,
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        icon: 'zap',
        label: t('pad.dash'),
        color: '#D84727',
        minHeight: '64px',
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  RACE: {
    type: 'JOYSTICK_ACTION',
    def: CONTROL_DEFS.RACE,
    actions: [{
      id: 'dash',
      action: 'DASH',
      icon: 'zap',
      label: t('pad.dash'),
      color: '#0EA5E9',
      cooldown: 2.8,
      vibrate: [25, 35],
      syncHostCooldown: true,
    }],
  },
};
