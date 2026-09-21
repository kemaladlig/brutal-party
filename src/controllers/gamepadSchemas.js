// Declarative Controller Schemas for Brutal Party Games
// Modifying a game's controls or adding a new game now only requires adding or editing a schema here.

export const GAMEPAD_SCHEMAS = {
  PONG: {
    type: 'SLIDER_1D',
    spinCooldown: 20.0,
  },

  TANKS: {
    type: 'ARCADE_DRIVE',
    pedalIcon: '🚀',
    pedalTitle: 'İLERLE',
    pedalSub: 'BASILI TUTUNCA GİDER • BIRAKINCA DÖNER',
    fireIcon: '💥',
    fireTitle: 'ATEŞ',
    fireDebounceMs: 450,
  },

  CURVE: {
    type: 'TWO_BUTTON_STEER',
    leftLabel: '◀ SOL',
    rightLabel: 'SAĞ ▶',
  },

  BOMB: {
    type: 'JOYSTICK_ACTION',
    actions: [
      {
        id: 'dash',
        action: 'DASH',
        label: '⚡ DEPAR',
        sub: 'DOKUN',
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
          ? '💣 BOMBA SENDE! RAKİPLERE DOKUN VE AKTAR!'
          : '🏃 GÜVENLİSİN! BOMBALI OYUNCUDAN UZAK DUR!';
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
        label: '💥 OMUZ AT',
        sub: 'DOKUN',
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
        label: '💥 OMUZ AT',
        sub: 'DOKUN',
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
          ? '👑 KRALSIN! TACI HERKESTEN KORU!'
          : '⚔️ KRALA OMUZ AT VE TACI ÇAL!';
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
        label: '⚡ DEPAR',
        sub: 'DOKUN',
        color: '#2f6a4f',
        cooldown: 4.0,
        vibrate: [25, 35],
        syncHostCooldown: true,
      },
    ],
  },

  SNAKE: {
    type: 'STEER_BOOST',
    leftLabel: '◀ SOL',
    rightLabel: 'SAĞ ▶',
    boostLabel: '⚡ HIZLAN',
    boostSub: 'BASILI TUT',
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
        label: '🔫 ATEŞ',
        sub: 'DOKUN',
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
        sub: 'DOKUN',
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
        label: '💥 OMUZ AT',
        sub: 'DOKUN',
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
        label: '⤴️ ZIPLA',
        sub: 'DOKUN',
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
        label: '🗡️ KILIÇ',
        sub: 'ATIL',
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
        label: '💨 SİS BOMBASI',
        sub: 'GİZLEN',
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
