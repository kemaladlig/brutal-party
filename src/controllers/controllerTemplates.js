// Declarative Gamepad Controller Templates
// Provides standardized archetypes (JOYSTICK_ACTION, ARCADE_DRIVE, TWO_BUTTON_STEER, SLIDER_1D, STEER_BOOST)
// allowing games and agents to declare controls via high-level schemas rather than writing imperative DOM code.

import { escapeHtml } from '../net.js';
import { t, tIcon } from '../i18n.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { getGuideActionLabel } from './controllerGuide.js';
import { getPreference, setPreference } from '../core/preferences.js';
import { TwinStickAimController } from './aimController.js';

/**
 * Mounts a declarative controller onto the given container.
 * Returns an instance object with { handleSync, teardown }.
 *
 * @param {GamepadManager} gamepad
 * @param {HTMLElement} container
 * @param {Object} schema
 */
export function mountDeclarativeController(gamepad, container, schema) {
  if (!schema || !schema.type) {
    console.warn('[declarativeGamepad] No schema type provided');
    return null;
  }

  switch (schema.type) {
    case 'JOYSTICK_ACTION':
      return mountJoystickAction(gamepad, container, schema);
    case 'TWIN_STICK_ACTION':
      return mountTwinStickAction(gamepad, container, schema);
    case 'ARCADE_DRIVE':
      return mountArcadeDrive(gamepad, container, schema);
    case 'TWO_BUTTON_STEER':
      return mountTwoButtonSteer(gamepad, container, schema);
    case 'SLIDER_1D':
      return mountSlider1D(gamepad, container, schema);
    case 'STEER_BOOST':
      return mountSteerBoost(gamepad, container, schema);
    default:
      console.warn(`[declarativeGamepad] Unknown controller schema type: ${schema.type}`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// 1. JOYSTICK_ACTION Archetype (BOMB, HEIST, CROWN, ZONE, CLONE, COLLAPSE, LASER, NINJA, HORDE)
// ---------------------------------------------------------------------------
function mountJoystickAction(gamepad, container, schema) {
  const joyZoneId = `joy-zone-${Date.now()}`;
  const joyKnobId = `joy-knob-${Date.now()}`;
  const actions = schema.actions || [];
  const isMultiAction = actions.length > 1;

  // Build Action Buttons HTML
  let actionHtml = '';
  if (isMultiAction) {
    const isStacked = schema.layout === 'stack';
    const clusterClass = isStacked ? 'action-cluster-stack' : 'action-cluster-grid';

    actionHtml = `
      <div class="${clusterClass}">
        ${actions.map((act, i) => {
          const bg = act.color ? `background-color: ${act.color};` : `background-color: ${gamepad.playerColor};`;
          const border = act.border ? `border-color: ${act.border};` : '';
          const flex = act.flex ? `flex: ${act.flex};` : '';
          const minHeight = act.minHeight ? `min-height: ${act.minHeight};` : '';
          const customClass = act.className || '';
          const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
          const actionLabel = getGuideActionLabel(act);
          return `
            <button class="action-dash-btn ${customClass}" data-action-index="${i}" type="button" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}" style="${bg} ${border} ${flex} ${minHeight}">
              <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: 38, color: '#ffffff', strokeWidth: 2.4 })}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  } else if (actions.length === 1) {
    const act = actions[0];
    const bg = act.color ? `background-color: ${act.color};` : `background-color: ${gamepad.playerColor};`;
    const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
    const actionLabel = getGuideActionLabel(act);
    actionHtml = `
      <button class="action-dash-btn ${act.className || ''}" data-action-index="0" type="button" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}" style="${bg}">
        <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: 38, color: '#ffffff', strokeWidth: 2.4 })}</span>
      </button>
    `;
  }

  container.innerHTML = `
    <div class="joystick-action-view">
      <div class="joystick-half" data-controller-layout-target="left" id="${joyZoneId}">
        <div class="phone-joy-base" style="border-color: ${gamepad.playerColor};">
          <div class="phone-joy-knob" id="${joyKnobId}" style="background-color: ${gamepad.playerColor};"></div>
        </div>
      </div>
      <div class="action-half" data-controller-layout-target="right">
        ${actionHtml}
      </div>
    </div>
  `;

  // Bind Dynamic Floating Joystick
  gamepad.bindJoystick(joyZoneId, joyKnobId, (input) => {
    gamepad._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
  });

  // Bind Action Buttons
  const buttonEls = [];
  const activeHolds = new Set();
  actions.forEach((act, i) => {
    const btn = container.querySelector(`[data-action-index="${i}"]`);
    if (!btn) return;
    buttonEls.push({ config: act, el: btn });

    const vibratePattern = act.vibrate ?? [25, 35];

    if (act.hold && act.releaseAction) {
      // Hold-to-charge: press sends act.action, release sends act.releaseAction.
      // No cooldown — charge state is host-authoritative (ARCHER bow).
      const sendDown = (e) => {
        e?.preventDefault?.();
        gamepad.sendInput({ action: act.action, ...(act.payload || {}) });
        gamepad.vibrate(vibratePattern);
        gamepad.playTick();
        activeHolds.add(act);
        btn.classList.add('holding');
      };
      const sendUp = (e) => {
        e?.preventDefault?.();
        gamepad.sendInput({ action: act.releaseAction, ...(act.releasePayload || {}) });
        activeHolds.delete(act);
        btn.classList.remove('holding');
      };
      btn.addEventListener('touchstart', sendDown, { passive: false });
      btn.addEventListener('touchend', sendUp, { passive: false });
      btn.addEventListener('touchcancel', sendUp, { passive: false });
      btn.addEventListener('mousedown', sendDown);
      btn.addEventListener('mouseup', sendUp);
      btn.addEventListener('mouseleave', () => {
        if (btn.classList.contains('holding')) sendUp();
      });
      return;
    }

    const secs = act.cooldown ?? 2.0;
    const readyLabel = getGuideActionLabel(act);

    const handler = gamepad.cooledAction(
      btn,
      secs,
      readyLabel,
      () => gamepad.sendInput({ action: act.action, ...(act.payload || {}) }),
      vibratePattern
    );

    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
  });

  return {
    handleSync(data) {
      // Sync Host Cooldown percentage to dim buttons if configured
      // (per-action field: varsayılan 'cd', örn. LASER ateş 'cdFire', NINJA sis 'cd2')
      buttonEls.forEach(({ config, el }) => {
        if (config.syncHostCooldown && el.isConnected) {
          const field = config.hostCdField || 'cd';
          const arr = Array.isArray(data[field]) ? data[field] : null;
          const cdPct = arr ? arr[gamepad.playerIndex] || 0 : 0;
          el.style.opacity = cdPct > 0 ? 0.55 : 1;
        }
      });

      // Custom onSync callback from schema (e.g. carrier alert, king alert, role text)
      if (typeof schema.onSync === 'function') {
        schema.onSync(gamepad, data, { buttonEls });
      }
    },
    teardown() {
      for (const act of activeHolds) {
        if (act.releaseAction) {
          try {
            gamepad.sendInput({ action: act.releaseAction, ...(act.releasePayload || {}) });
          } catch {}
        }
      }
      activeHolds.clear();
      if (typeof schema.onTeardown === 'function') {
        schema.onTeardown(gamepad);
      }
    }
  };
}

function mountTwinStickAction(gamepad, container, schema) {
  const stamp = Date.now();
  const moveZoneId = `twin-move-zone-${stamp}`;
  const moveKnobId = `twin-move-knob-${stamp}`;
  const aimZoneId = `twin-aim-zone-${stamp}`;
  const aimKnobId = `twin-aim-knob-${stamp}`;
  const actions = schema.actions || [];

  const actionHtml = actions.length > 0
    ? `<div class="action-cluster-stack twin-action-cluster">
        ${actions.map((act, i) => {
          const bg = act.color ? `background-color: ${act.color};` : `background-color: ${gamepad.playerColor};`;
          const border = act.border ? `border-color: ${act.border};` : '';
          const flex = act.flex ? `flex: ${act.flex};` : '';
          const minHeight = act.minHeight ? `min-height: ${act.minHeight};` : '';
          const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
          const label = getGuideActionLabel(act);
          return `<button class="action-dash-btn ${act.className || ''}" data-action-index="${i}" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="${bg} ${border} ${flex} ${minHeight}">
            <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: 34, color: '#ffffff', strokeWidth: 2.4 })}</span>
          </button>`;
        }).join('')}
      </div>`
    : '';

  const moveLabel = t('pad.guideJoystick');
  const aimLabel = t('pad.guideAim');
  const actionZoneHtml = actions.length > 0
    ? `<div class="twin-action-zone" data-controller-layout-target="right">${actionHtml}</div>`
    : '';
  container.innerHTML = `
    <div class="twin-stick-action-view">
      <div class="twin-stick-half twin-move-half" data-controller-layout-target="left" id="${moveZoneId}" aria-label="${escapeHtml(moveLabel)}">
        <div class="phone-joy-base" style="border-color: ${gamepad.playerColor};">
          <div class="phone-joy-knob" id="${moveKnobId}" style="background-color: ${gamepad.playerColor};"></div>
        </div>
        <span class="twin-stick-label">${escapeHtml(moveLabel)}</span>
      </div>
      <div class="twin-stick-half twin-aim-half" data-controller-layout-target="right" id="${aimZoneId}" aria-label="${escapeHtml(aimLabel)}">
        <div class="phone-joy-base" style="border-color: ${gamepad.playerColor};">
          <div class="phone-joy-knob" id="${aimKnobId}" style="background-color: ${gamepad.playerColor};"></div>
        </div>
        <span class="twin-stick-label">${escapeHtml(aimLabel)}</span>
      </div>
      ${actionZoneHtml}
    </div>
  `;

  gamepad.bindJoystick(moveZoneId, moveKnobId, (input) => {
    gamepad._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
  });
  const aimZoneEl = container.querySelector(`#${aimZoneId}`);
  const aimKnobEl = container.querySelector(`#${aimKnobId}`);
  const aimBaseEl = aimZoneEl?.querySelector('.phone-joy-base');

  const aimController = new TwinStickAimController({
    zoneEl: aimZoneEl,
    knobEl: aimKnobEl,
    baseEl: aimBaseEl,
    signal: gamepad._mountAbort?.signal,
    vibrate: (pattern) => gamepad.vibrate(pattern),
    onPress(input) {
      gamepad._sendAimInput({ action: 'AIM_PRESS', ...input });
      gamepad.playTick();
    },
    onMove(input, opts) {
      gamepad._sendAnalog({ action: 'AIM_MOVE', ...input }, opts);
    },
    onRelease(input, { cancelled = false } = {}) {
      gamepad._sendAimInput({
        action: 'AIM_RELEASE',
        ...input,
        ...(cancelled ? { cancelled: true } : {}),
      });
    },
  });

  const buttonEls = [];
  const activeHolds = new Set();
  actions.forEach((act, i) => {
    const btn = container.querySelector(`[data-action-index="${i}"]`);
    if (!btn) return;
    buttonEls.push({ config: act, el: btn });
    const vibratePattern = act.vibrate ?? [25, 35];
    if (act.hold && act.releaseAction) {
      const sendDown = (e) => {
        e?.preventDefault?.();
        gamepad.sendInput({ action: act.action, ...(act.payload || {}) });
        gamepad.vibrate(vibratePattern);
        gamepad.playTick();
        activeHolds.add(act);
        btn.classList.add('holding');
      };
      const sendUp = (e) => {
        e?.preventDefault?.();
        gamepad.sendInput({ action: act.releaseAction, ...(act.releasePayload || {}) });
        activeHolds.delete(act);
        btn.classList.remove('holding');
      };
      btn.addEventListener('touchstart', sendDown, { passive: false });
      btn.addEventListener('touchend', sendUp, { passive: false });
      btn.addEventListener('touchcancel', sendUp, { passive: false });
      btn.addEventListener('mousedown', sendDown);
      btn.addEventListener('mouseup', sendUp);
      btn.addEventListener('mouseleave', () => {
        if (btn.classList.contains('holding')) sendUp();
      });
      return;
    }
    const handler = gamepad.cooledAction(
      btn,
      act.cooldown ?? 2.0,
      getGuideActionLabel(act),
      () => gamepad.sendInput({ action: act.action, ...(act.payload || {}) }),
      vibratePattern,
    );
    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
  });

  return {
    handleSync(data) {
      buttonEls.forEach(({ config, el }) => {
        if (config.syncHostCooldown && el.isConnected) {
          const field = config.hostCdField || 'cd';
          const arr = Array.isArray(data[field]) ? data[field] : null;
          const cdPct = arr ? arr[gamepad.playerIndex] || 0 : 0;
          el.style.opacity = cdPct > 0 ? 0.55 : 1;
        }
      });
      if (typeof schema.onSync === 'function') schema.onSync(gamepad, data, { buttonEls });
    },
    teardown() {
      aimController?.destroy();
      for (const act of activeHolds) {
        if (act.releaseAction) {
          try { gamepad.sendInput({ action: act.releaseAction, ...(act.releasePayload || {}) }); } catch {}
        }
      }
      activeHolds.clear();
      if (typeof schema.onTeardown === 'function') schema.onTeardown(gamepad);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. ARCADE_DRIVE Archetype (TANKS)
// ---------------------------------------------------------------------------
function mountArcadeDrive(gamepad, container, schema) {
  const pedalLabel = t(schema.pedalLabelKey || 'pad.drive');
  const fireLabel = t(schema.fireLabelKey || 'pad.fireGun');
  container.innerHTML = `
    <div class="tanks-arcade-view">
      <div class="tank-drive-zone" data-controller-layout-target="left">
        <button class="tank-drive-pedal" id="btn-tank-drive" type="button" aria-label="${escapeHtml(pedalLabel)}" title="${escapeHtml(pedalLabel)}" style="border-color: ${gamepad.playerColor}">
          <span class="pedal-icon">${getTabletopIconSvg(schema.pedalIcon || 'rocket', { size: 44, color: '#141414', strokeWidth: 2.4 })}</span>
        </button>
      </div>
      <div class="tanks-fire-zone" data-controller-layout-target="right">
        <button class="tank-fire-btn" id="btn-tank-fire" type="button" aria-label="${escapeHtml(fireLabel)}" title="${escapeHtml(fireLabel)}" style="background: ${gamepad.playerColor};">
          <span class="fire-icon">${getTabletopIconSvg(schema.fireIcon || 'bomb', { size: 38, color: '#ffffff', strokeWidth: 2.4 })}</span>
        </button>
        <div class="tank-ammo-hud" id="tank-ammo-hud">
          <div class="cartridge-pip loaded"></div>
          <div class="cartridge-pip loaded"></div>
        </div>
      </div>
    </div>
  `;

  const driveBtn = document.getElementById('btn-tank-drive');
  let isDriving = false;

  const startDrive = (e) => {
    e?.preventDefault();
    if (isDriving) return;
    isDriving = true;
    driveBtn?.classList.add('active');
    gamepad.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: true });
    gamepad.vibrate(20);
    gamepad.playTick();
  };

  const stopDrive = (e) => {
    e?.preventDefault();
    if (!isDriving) return;
    isDriving = false;
    driveBtn?.classList.remove('active');
    gamepad.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: false });
  };

  const tanksSignal = gamepad._mountAbort?.signal;
  driveBtn?.addEventListener('touchstart', startDrive, { passive: false });
  driveBtn?.addEventListener('touchend', stopDrive, { passive: false });
  driveBtn?.addEventListener('touchcancel', stopDrive, { passive: false });
  window.addEventListener('touchend', stopDrive, { passive: true, signal: tanksSignal });
  window.addEventListener('touchcancel', stopDrive, { passive: true, signal: tanksSignal });
  driveBtn?.addEventListener('mousedown', startDrive);
  driveBtn?.addEventListener('mouseup', stopDrive);
  driveBtn?.addEventListener('mouseleave', stopDrive);
  window.addEventListener('mouseup', stopDrive, { signal: tanksSignal });

  const fireBtn = document.getElementById('btn-tank-fire');
  let lastFireTime = 0;
  const fireAction = (e) => {
    e?.preventDefault();
    const now = performance.now();
    const debounceMs = schema.fireDebounceMs ?? 450;
    if (now - lastFireTime < debounceMs) return;
    lastFireTime = now;
    gamepad.sendInput({ action: schema.fireAction || 'TANK_FIRE' });
    gamepad.vibrate(30);
    gamepad.playTick();
  };

  fireBtn?.addEventListener('touchstart', fireAction, { passive: false });
  fireBtn?.addEventListener('mousedown', fireAction);

  return {
    handleSync(data) {
      if (Array.isArray(data.ammo)) {
        const raw = data.ammo[gamepad.playerIndex];
        const n = typeof raw === 'number' ? raw : (raw?.n ?? 0);
        const load = typeof raw === 'object' ? (raw?.load ?? 0) : 0;
        const ammoPips = document.querySelectorAll('#tank-ammo-hud .cartridge-pip');
        ammoPips.forEach((pip, idx) => {
          pip.classList.toggle('loaded', idx < n);
          if (idx === n && load > 0) {
            pip.classList.remove('loaded');
            const pct = Math.round(load * 100);
            pip.style.background = `linear-gradient(90deg, ${gamepad.playerColor} ${pct}%, #3a3835 ${pct}%)`;
          } else {
            pip.style.background = '';
          }
        });
      }
    },
    teardown() {
      if (isDriving) {
        try {
          gamepad.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: false });
        } catch {}
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 3. TWO_BUTTON_STEER Archetype (CURVE)
// ---------------------------------------------------------------------------
function mountTwoButtonSteer(gamepad, container, schema) {
  const steerLeftLabel = t('pad.steerLeft');
  const steerRightLabel = t('pad.steerRight');
  container.innerHTML = `
    <div class="curve-controller-view" id="curve-controller-view">
      <div class="steer-rocker-cluster curve-cluster left" data-controller-layout-target="left" id="curve-steer-left">
        <button class="steer-rocker-btn left" id="btn-curve-left" data-steer="-1" type="button" aria-label="${escapeHtml(steerLeftLabel)}">
          <span class="steer-icon">${getTabletopIconSvg('arrow_left', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
        </button>
        <button class="steer-rocker-btn right" id="btn-curve-left-r" data-steer="1" type="button" aria-label="${escapeHtml(steerRightLabel)}">
          <span class="steer-icon">${getTabletopIconSvg('arrow_right', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
        </button>
      </div>

      <div class="steer-rocker-cluster curve-cluster right" data-controller-layout-target="right" id="curve-steer-right">
        <button class="steer-rocker-btn left" id="btn-curve-right-l" data-steer="-1" type="button" aria-label="${escapeHtml(steerLeftLabel)}">
          <span class="steer-icon">${getTabletopIconSvg('arrow_left', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
        </button>
        <button class="steer-rocker-btn right" id="btn-curve-right" data-steer="1" type="button" aria-label="${escapeHtml(steerRightLabel)}">
          <span class="steer-icon">${getTabletopIconSvg('arrow_right', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
        </button>
      </div>
    </div>
  `;

  const view = document.getElementById('curve-controller-view');
  const btnLeft = document.getElementById('btn-curve-left');
  const btnRight = document.getElementById('btn-curve-right');
  const btnLeftR = document.getElementById('btn-curve-left-r');
  const btnRightL = document.getElementById('btn-curve-right-l');

  const activeTouches = new Map();
  let mouseDir = 0;
  let currentActiveDir = 0;

  const syncSteer = () => {
    let desiredDir = 0;
    if (activeTouches.size > 0) {
      for (const dir of activeTouches.values()) {
        if (dir !== 0) desiredDir = dir;
      }
    } else if (mouseDir !== 0) {
      desiredDir = mouseDir;
    }

    btnLeft?.classList.toggle('active', desiredDir === -1);
    btnRightL?.classList.toggle('active', desiredDir === -1);
    btnRight?.classList.toggle('active', desiredDir === 1);
    btnLeftR?.classList.toggle('active', desiredDir === 1);

    if (desiredDir !== currentActiveDir) {
      currentActiveDir = desiredDir;
      gamepad.sendInput({ action: schema.steerAction || 'CURVE_STEER', dir: currentActiveDir });
      if (currentActiveDir !== 0) gamepad.vibrate(15);
    }
  };

  const getDirForPoint = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const steerBtn = el?.closest('[data-steer]');
    if (steerBtn) {
      return parseInt(steerBtn.dataset.steer, 10);
    }
    const leftCluster = document.getElementById('curve-steer-left');
    const rightCluster = document.getElementById('curve-steer-right');
    const lRect = leftCluster?.getBoundingClientRect();
    const rRect = rightCluster?.getBoundingClientRect();
    if (lRect && clientX >= lRect.left && clientX <= lRect.right) {
      return clientX < lRect.left + lRect.width / 2 ? -1 : 1;
    }
    if (rRect && clientX >= rRect.left && clientX <= rRect.right) {
      return clientX < rRect.left + rRect.width / 2 ? -1 : 1;
    }
    return clientX < window.innerWidth / 2 ? -1 : 1;
  };

  const onTouchStart = (e) => {
    e.preventDefault();
    gamepad.playTick();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.set(t.identifier, getDirForPoint(t.clientX, t.clientY));
    }
    syncSteer();
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, getDirForPoint(t.clientX, t.clientY));
      }
    }
    syncSteer();
  };

  const onTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.delete(t.identifier);
    }
    syncSteer();
  };

  const onTouchCancel = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.delete(t.identifier);
    }
    syncSteer();
  };

  view?.addEventListener('touchstart', onTouchStart, { passive: false });
  view?.addEventListener('touchmove', onTouchMove, { passive: false });
  view?.addEventListener('touchend', onTouchEnd, { passive: true });
  view?.addEventListener('touchcancel', onTouchCancel, { passive: true });

  const curveSignal = gamepad._mountAbort?.signal;
  window.addEventListener('touchend', onTouchEnd, { passive: true, signal: curveSignal });
  window.addEventListener('touchcancel', onTouchCancel, { passive: true, signal: curveSignal });

  btnLeft?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = -1; syncSteer(); });
  btnRightL?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = -1; syncSteer(); });
  btnRight?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = 1; syncSteer(); });
  btnLeftR?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = 1; syncSteer(); });
  const onMouseUp = () => {
    if (mouseDir !== 0) {
      mouseDir = 0;
      syncSteer();
    }
  };
  window.addEventListener('mouseup', onMouseUp, { signal: curveSignal });

  return {
    handleSync() {},
    teardown() {
      if (currentActiveDir !== 0) {
        try {
          gamepad.sendInput({ action: schema.steerAction || 'CURVE_STEER', dir: 0 });
        } catch {}
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 4. SLIDER_1D Archetype (PONG)
// ---------------------------------------------------------------------------
function mountSlider1D(gamepad, container, schema) {
  const seatNames = ['P1', 'P2', 'P3', 'P4'];
  const posLabel = seatNames[gamepad.playerIndex] || `P${gamepad.playerIndex + 1}`;
  const baseInvert = gamepad.playerIndex === 1 || gamepad.playerIndex === 3;
  const verticalAxis = gamepad.playerIndex === 2 || gamepad.playerIndex === 3;
  const sensitivity = getPreference('pongSensitivity');

  if (!gamepad._pongInvertManualSet) {
    const invertPreference = getPreference('pongInvert');
    gamepad.isPongInverted = invertPreference === 'on'
      ? true
      : invertPreference === 'off'
        ? false
        : baseInvert;
  }

  const tvTargets = [t('pad.dirRight'), t('pad.dirLeft'), t('pad.dirDown'), t('pad.dirUp')];
  const tvDir = () => {
    const base = tvTargets[gamepad.playerIndex] || t('pad.dirRight');
    if (!gamepad.isPongInverted) return base;
    const flip = {};
    flip[t('pad.dirRight')] = t('pad.dirLeft');
    flip[t('pad.dirLeft')] = t('pad.dirRight');
    flip[t('pad.dirDown')] = t('pad.dirUp');
    flip[t('pad.dirUp')] = t('pad.dirDown');
    return flip[base] || base;
  };
  const directionHint = () => verticalAxis
    ? tIcon(gamepad.playerIndex === 2 ? 'pad.dragDown' : 'pad.dragUp', tvDir())
    : tIcon('pad.dragRight', tvDir());

  container.innerHTML = `
    <div class="pong-controller-view ${verticalAxis ? 'vertical' : 'horizontal'}">
      <div class="pong-live-scoreboard" id="pong-live-scoreboard">
        <div class="pong-score-pips" id="pong-score-display">${t('pad.scoreJoin', '0 - 0')}</div>
        <div class="pong-rally-badge" id="pong-rally-display">${tIcon('pad.rally', 0)}</div>
      </div>
      <div class="pong-position-badge" style="border-color: ${gamepad.playerColor}">${t('pad.tvPlace', posLabel)}</div>
      <div class="pong-bottom-zone">
        <div class="pong-track-wrap" data-controller-layout-target="left">
          <div class="pong-instruction" id="pong-direction-hint">${directionHint()}</div>
          <div class="pong-horizontal-track" id="pong-track" role="slider" aria-label="${escapeHtml(directionHint())}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(gamepad.pongPosition * 100)}" tabindex="0">
            <div class="pong-track-thumb horizontal" id="pong-thumb" style="${verticalAxis ? 'top' : 'left'}: ${gamepad.pongPosition * 100}%; background-color: ${gamepad.playerColor}">
              PADDLE
            </div>
          </div>
          <button class="pong-invert-btn ${gamepad.isPongInverted !== baseInvert ? 'inverted' : ''}" id="btn-invert-axis" type="button" title="${gamepad.isPongInverted !== baseInvert ? t('pad.autoDir') : t('pad.flipDir')}">
            ${gamepad.isPongInverted !== baseInvert ? tIcon('pad.autoDir') : tIcon('pad.flipDir')}
          </button>
        </div>
        <button class="action-spin-btn" data-controller-layout-target="right" id="btn-pong-spin" type="button" aria-label="${escapeHtml(t('pad.spinShort'))}" title="${escapeHtml(t('pad.spinShort'))}" style="background-color: ${gamepad.playerColor};">
          <span class="btn-action-icon">${getTabletopIconSvg('rotate_cw', { size: 38, color: '#ffffff', strokeWidth: 2.4 })}</span>
        </button>
      </div>
    </div>
  `;

  const track = document.getElementById('pong-track');
  const thumb = document.getElementById('pong-thumb');
  const invertBtn = document.getElementById('btn-invert-axis');
  const spinBtn = document.getElementById('btn-pong-spin');
  const hintEl = document.getElementById('pong-direction-hint');
  let isTrackingMouse = false;

  const spinAction = gamepad.cooledAction(
    spinBtn,
    schema.spinCooldown ?? 20.0,
    t('pad.spinShort'),
    () => gamepad.sendInput({ action: 'SPIN' }),
    [30, 40, 30]
  );
  spinBtn?.addEventListener('click', spinAction);

  invertBtn?.addEventListener('click', () => {
    gamepad.isPongInverted = !gamepad.isPongInverted;
    gamepad._pongInvertManualSet = true;
    setPreference('pongInvert', gamepad.isPongInverted ? 'on' : 'off');
    const isManuallyFlipped = gamepad.isPongInverted !== baseInvert;
    invertBtn.classList.toggle('inverted', isManuallyFlipped);
    invertBtn.innerHTML = isManuallyFlipped ? tIcon('pad.autoDir') : tIcon('pad.flipDir');
    if (hintEl) hintEl.textContent = directionHint();
  });

  const mountSignal = gamepad._mountAbort?.signal;
  const updateSliderPosition = (clientX, clientY) => {
    const rect = track.getBoundingClientRect();
    const rawNorm = verticalAxis
      ? Math.max(0, Math.min(rect.height, clientY - rect.top)) / Math.max(1, rect.height)
      : Math.max(0, Math.min(rect.width, clientX - rect.left)) / Math.max(1, rect.width);
    const clampedNorm = Math.max(0, Math.min(1, (rawNorm - 0.10) / 0.80));
    const adjustedNorm = Math.max(0, Math.min(1, 0.5 + (clampedNorm - 0.5) * sensitivity));
    const position = gamepad.isPongInverted ? 1.0 - adjustedNorm : adjustedNorm;
    gamepad.pongPosition = position;

    if (thumb) {
      if (verticalAxis) thumb.style.top = `${adjustedNorm * 100}%`;
      else thumb.style.left = `${adjustedNorm * 100}%`;
    }
    track?.setAttribute('aria-valuenow', String(Math.round(adjustedNorm * 100)));
    gamepad._sendAnalog({ action: 'PADDLE_MOVE', position });
  };

  track?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches[0]) updateSliderPosition(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });

  track?.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches[0]) updateSliderPosition(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: false });
  track?.addEventListener('touchend', (e) => { e.preventDefault(); }, { passive: false });
  track?.addEventListener('touchcancel', (e) => { e.preventDefault(); }, { passive: false });

  track?.addEventListener('mousedown', (e) => { isTrackingMouse = true; updateSliderPosition(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (isTrackingMouse) updateSliderPosition(e.clientX, e.clientY); }, { signal: mountSignal });
  window.addEventListener('mouseup', () => { isTrackingMouse = false; }, { signal: mountSignal });

  return {
    handleSync(data) {
      if (data.scores) {
        const scoreDisp = document.getElementById('pong-score-display');
        const rallyDisp = document.getElementById('pong-rally-display');
        if (scoreDisp && data.scores) {
          // İsimler varsa kimin skoru olduğu görünür: "AHMET 2 [heart]3 • MEHMET 1[heart]2"
          // (set skoru + kalan can; boş koltukta can gösterilmez)
          const lives = Array.isArray(data.lives) ? data.lives : null;
          const scoreTxt = Array.isArray(data.names)
            ? data.scores.slice(0, 4).map((s, i) => {
              const nm = data.names[i] || `P${i + 1}`;
              const heart = lives && data.names[i] ? `${getTabletopIconSvg('heart', { size: 11 })}${lives[i] ?? 0}` : '';
              return `${nm} ${s}${heart}`;
            }).join(' • ')
            : t('pad.scoreJoin', data.scores.slice(0, 4).join(' - '));
          if (scoreDisp.innerHTML !== scoreTxt) scoreDisp.innerHTML = scoreTxt;
        }
        if (rallyDisp && data.rally !== undefined) {
          const rallyTxt = tIcon('pad.rally', data.rally);
          if (rallyDisp.innerHTML !== rallyTxt) rallyDisp.innerHTML = rallyTxt;
        }
        const sBtn = document.getElementById('btn-pong-spin');
        if (sBtn) {
          // Faz 2.1: host yetkili cooldown radyal dolguya (--cd + .cd-num) boyanır.
          const cd = Array.isArray(data.cd) ? (data.cd[gamepad.playerIndex] || 0) : 0;
          const isCharged = data.chgIdx === gamepad.playerIndex;
          const recharging = cd > 0 && !isCharged;
          if (recharging) {
            gamepad.setButtonCooldown(sBtn, cd, schema.spinCooldown ?? 20);
          } else if (sBtn.classList.contains('cooling')) {
            gamepad.resetButtonCooldown(sBtn, { flash: false });
          }
        }
        if (rallyDisp && data.spn) {
          const spn = tIcon('pad.spinning');
          if (rallyDisp.innerHTML !== spn) rallyDisp.innerHTML = spn;
        }
      }
    },
    teardown() {}
  };
}

// ---------------------------------------------------------------------------
// 5. STEER_BOOST Archetype (SNAKE — Left/Right Steering + Boost, CSS-driven)
// ---------------------------------------------------------------------------
function mountSteerBoost(gamepad, container, schema) {
  const steerLeftLabel = t('pad.steerLeft');
  const steerRightLabel = t('pad.steerRight');
  const steerZoneId = `steer-zone-${Date.now()}`;
  container.innerHTML = `
    <div class="snake-controller-view">
      <div class="snake-steer-zone" data-controller-layout-target="left">
        <div class="steer-rocker-cluster" id="${steerZoneId}">
          <button class="steer-rocker-btn left" id="btn-snake-left" data-steer="-1" type="button" aria-label="${escapeHtml(steerLeftLabel)}">
            <span class="steer-icon">${getTabletopIconSvg('arrow_left', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
          </button>
          <button class="steer-rocker-btn right" id="btn-snake-right" data-steer="1" type="button" aria-label="${escapeHtml(steerRightLabel)}">
            <span class="steer-icon">${getTabletopIconSvg('arrow_right', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
          </button>
        </div>
      </div>
      <div class="snake-boost-zone" data-controller-layout-target="right">
        <button class="action-dash-btn snake-boost-btn" id="btn-snake-boost" type="button" aria-label="${escapeHtml(t('pad.boost'))}" title="${escapeHtml(t('pad.boost'))}" style="background-color: ${schema.boostColor || gamepad.playerColor}">
          <span class="btn-action-icon">${getTabletopIconSvg(schema.boostIcon || 'zap', { size: 38, color: '#ffffff', strokeWidth: 2.4 })}</span>
        </button>
      </div>
    </div>
  `;

  const steerView = document.getElementById(steerZoneId);
  const btnLeft = document.getElementById('btn-snake-left');
  const btnRight = document.getElementById('btn-snake-right');
  const btnBoost = document.getElementById('btn-snake-boost');

  const activeTouches = new Map();
  let mouseDir = 0;
  let currentActiveDir = 0;

  const syncSteer = () => {
    let desiredDir = 0;
    if (activeTouches.size > 0) {
      for (const dir of activeTouches.values()) {
        if (dir !== 0) desiredDir = dir;
      }
    } else if (mouseDir !== 0) {
      desiredDir = mouseDir;
    }

    btnLeft?.classList.toggle('active', desiredDir === -1);
    btnRight?.classList.toggle('active', desiredDir === 1);

    if (desiredDir !== currentActiveDir) {
      currentActiveDir = desiredDir;
      gamepad.sendInput({ action: schema.steerAction || 'SNAKE_STEER', dir: currentActiveDir });
      if (currentActiveDir !== 0) gamepad.vibrate(15);
    }
  };

  const getDirForPoint = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const steerBtn = el?.closest('[data-steer]');
    if (steerBtn) return parseInt(steerBtn.dataset.steer, 10);
    const rect = steerView ? steerView.getBoundingClientRect() : null;
    if (!rect) return 0;
    return clientX < rect.left + rect.width / 2 ? -1 : 1;
  };

  const onTouchStart = (e) => {
    e.preventDefault();
    gamepad.playTick();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.set(t.identifier, getDirForPoint(t.clientX, t.clientY));
    }
    syncSteer();
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, getDirForPoint(t.clientX, t.clientY));
      }
    }
    syncSteer();
  };

  const onTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.delete(t.identifier);
    }
    syncSteer();
  };

  steerView?.addEventListener('touchstart', onTouchStart, { passive: false });
  steerView?.addEventListener('touchmove', onTouchMove, { passive: false });
  steerView?.addEventListener('touchend', onTouchEnd, { passive: true });
  steerView?.addEventListener('touchcancel', onTouchEnd, { passive: true });

  const mountSignal = gamepad._mountAbort?.signal;
  window.addEventListener('touchend', onTouchEnd, { passive: true, signal: mountSignal });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true, signal: mountSignal });

  btnLeft?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = -1; syncSteer(); });
  btnRight?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = 1; syncSteer(); });
  const onMouseUp = () => {
    if (mouseDir !== 0) {
      mouseDir = 0;
      syncSteer();
    }
  };
  window.addEventListener('mouseup', onMouseUp, { signal: mountSignal });

  // Boost Button
  let boosting = false;
  const startBoost = (e) => {
    e?.preventDefault();
    if (boosting) return;
    boosting = true;
    btnBoost?.classList.add('active');
    if (btnBoost) btnBoost.style.filter = 'brightness(1.3)';
    gamepad.sendInput({ action: schema.boostStartAction || 'SNAKE_BOOST' });
    gamepad.vibrate(20);
    gamepad.playTick();
  };

  const stopBoost = (e) => {
    e?.preventDefault();
    if (!boosting) return;
    boosting = false;
    btnBoost?.classList.remove('active');
    if (btnBoost) btnBoost.style.filter = '';
    gamepad.sendInput({ action: schema.boostEndAction || 'SNAKE_BOOST_RELEASE' });
  };

  btnBoost?.addEventListener('touchstart', startBoost, { passive: false });
  btnBoost?.addEventListener('touchend', stopBoost, { passive: false });
  btnBoost?.addEventListener('touchcancel', stopBoost, { passive: false });
  window.addEventListener('touchend', stopBoost, { passive: true, signal: mountSignal });
  window.addEventListener('touchcancel', stopBoost, { passive: true, signal: mountSignal });
  btnBoost?.addEventListener('mousedown', startBoost);
  btnBoost?.addEventListener('mouseup', stopBoost);
  btnBoost?.addEventListener('mouseleave', stopBoost);

  return {
    handleSync(data) {
      if (!btnBoost || !btnBoost.isConnected) return;
      const nrg = Array.isArray(data?.nrg) ? (data.nrg[gamepad.playerIndex] ?? 100) : 100;
      const locked = Array.isArray(data?.lock) ? !!data.lock[gamepad.playerIndex] : false;
      const dead = Array.isArray(data?.alive) ? data.alive[gamepad.playerIndex] === false : false;
      btnBoost.style.opacity = locked || dead ? 0.55 : 1;
      const nrgText = document.getElementById('snake-nrg-text');
      if (nrgText) {
        const txt = dead ? t('pad.deadShort') : locked ? t('pad.lockedFire') : `${Math.round(nrg)}% NRG`;
        if (nrgText.textContent !== txt) nrgText.textContent = txt;
      }
    },
    teardown() {
      if (currentActiveDir !== 0) {
        try {
          gamepad.sendInput({ action: schema.steerAction || 'SNAKE_STEER', dir: 0 });
        } catch {}
      }
      if (boosting) {
        try {
          gamepad.sendInput({ action: schema.boostEndAction || 'SNAKE_BOOST_RELEASE' });
        } catch {}
      }
    }
  };
}
