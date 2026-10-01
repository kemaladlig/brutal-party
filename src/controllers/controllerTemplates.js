// Declarative Gamepad Controller Templates
// Provides standardized archetypes (JOYSTICK_ACTION, TWIN_STICK_ACTION, ARCADE_DRIVE, STEER_ACTION, SLIDER_1D)
// allowing games and agents to declare controls via high-level schemas rather than writing imperative DOM code.

import { escapeHtml } from '../net.js';
import { t, tIcon } from '../i18n.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';
import { getGuideActionLabel } from './controllerGuide.js';
import { getPreference, setPreference } from '../core/preferences.js';
import { TwinStickAimController } from './aimController.js';
import { CONTROL_KEEPALIVE_MS } from './controlDefs.js';

/**
 * Kontrol dolgu rengini `--deck-color` ÖZEL DEĞİŞKENİ olarak yazar, doğrudan
 * `background-color` olarak değil.
 *
 * Neden: satır içi `background-color` her CSS kuralını yener (specificity
 * değil, sıra değil — satır içi kazanır), dolgusunun yarı saydam olması
 * mümkün olmazdı. Renk VERİ olarak kalır (oyuncu/aksiyon rengi), sunum
 * `gamepad.css`'in güverte kurallarında tek yerde (`--deck-fill`) durur.
 * Yalnız bu modül yazar; taban kuralları `var(--deck-color, <yedek>)` okur.
 */
function deckColorStyle(color) {
  return `--deck-color: ${color};`;
}

/**
 * Mounts a declarative controller onto the given container.
 * Returns an instance object with { handleSync, teardown }.
 *
 * @param {object} gamepad  GamepadManager örneği
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
    case 'STEER_ACTION':
      return mountSteerAction(gamepad, container, schema);
    case 'SLIDER_1D':
      return mountSlider1D(gamepad, container, schema);
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
          const bg = deckColorStyle(act.color || gamepad.playerColor);
          const border = act.border ? `border-color: ${act.border};` : '';
          const flex = act.flex ? `flex: ${act.flex};` : '';
          const minHeight = act.minHeight ? `min-height: ${act.minHeight};` : '';
          const customClass = act.className || '';
          const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
          const actionLabel = getGuideActionLabel(act);
          return `
            <button class="action-dash-btn ${customClass}" data-action-index="${i}" type="button" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}" style="${bg} ${border} ${flex} ${minHeight}">
              <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: 38, color: 'currentColor', strokeWidth: 2.4 })}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  } else if (actions.length === 1) {
    const act = actions[0];
    const bg = deckColorStyle(act.color || gamepad.playerColor);
    const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
    const actionLabel = getGuideActionLabel(act);
    actionHtml = `
      <button class="action-dash-btn ${act.className || ''}" data-action-index="0" type="button" aria-label="${escapeHtml(actionLabel)}" title="${escapeHtml(actionLabel)}" style="${bg}">
        <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: 38, color: 'currentColor', strokeWidth: 2.4 })}</span>
      </button>
    `;
  }

  container.innerHTML = `
    <div class="joystick-action-view">
      <div class="joystick-half" data-controller-layout-target="left" id="${joyZoneId}">
        <div class="phone-joy-base" style="border-color: ${gamepad.playerColor};">
          <div class="phone-joy-knob" id="${joyKnobId}" style="${deckColorStyle(gamepad.playerColor)}"></div>
        </div>
      </div>
      <div class="action-half" data-controller-layout-target="right">
        ${actionHtml}
      </div>
    </div>
  `;

  // Bind Dynamic Floating Joystick
  gamepad.bindJoystick(joyZoneId, joyKnobId, (input, opts) => {
    gamepad._sendAnalog({ action: 'JOYSTICK_MOVE', ...input }, opts);
  });

  // Bind Action Buttons
  const buttonEls = [];
  const activeHolds = new Set();
  actions.forEach((act, i) => {
    const btn = container.querySelector(`[data-action-index="${i}"]`);
    if (!btn) return;
    const entry = { config: act, el: btn };
    buttonEls.push(entry);

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
      vibratePattern,
      { hostSynced: !!act.syncHostCooldown }
    );
    entry.handler = handler;

    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
  });

  return {
    handleSync(data) {
      // Sync Host Cooldown percentage to dim buttons if configured
      // (per-action field: varsayılan 'cd', örn. LASER ateş 'cdFire', NINJA sis 'cd2')
      // Host `cd` aynı zamanda butonun KİLİT süresidir (host yetkilidir):
      // reddedilen aksiyon butonu ölü bırakmaz, kabul edilen host bitişine bağlanır.
      buttonEls.forEach(({ config, el, handler }) => {
        if (!config.syncHostCooldown || !el.isConnected) return;
        const field = config.hostCdField || 'cd';
        const arr = Array.isArray(data[field]) ? data[field] : null;
        const pct = arr ? Math.max(0, Math.min(1, (Number(arr[gamepad.playerIndex]) || 0) / 100)) : 0;
        el.style.opacity = pct > 0 ? 0.55 : 1;
        handler?.syncHost?.(pct);
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
          const bg = deckColorStyle(act.color || gamepad.playerColor);
          const border = act.border ? `border-color: ${act.border};` : '';
          const flex = act.flex ? `flex: ${act.flex};` : '';
          const minHeight = act.minHeight ? `min-height: ${act.minHeight};` : '';
          const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
          const label = getGuideActionLabel(act);
          return `<button class="action-dash-btn ${act.className || ''}" data-action-index="${i}" type="button" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="${bg} ${border} ${flex} ${minHeight}">
            <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: 34, color: 'currentColor', strokeWidth: 2.4 })}</span>
          </button>`;
        }).join('')}
      </div>`
    : '';

  const moveLabel = t('pad.guideJoystick');
  const aimLabel = t('pad.guideAim');
  // Twin standart: iki sütun (sol move / sağ aim). Aksiyon üçüncü sütun
  // değildir; aim köşede kalır, dash aim yarısının iç yanına rıhtımlanır.
  // Böylece sağ grup tek rect olur ve layout resolver tek dx/dy üretir.
  container.innerHTML = `
    <div class="twin-stick-action-view${actions.length > 0 ? ' has-twin-action' : ''}">
      <div class="twin-stick-half twin-move-half" data-controller-layout-target="left" id="${moveZoneId}" aria-label="${escapeHtml(moveLabel)}">
        <div class="phone-joy-base" style="border-color: ${gamepad.playerColor};">
          <div class="phone-joy-knob" id="${moveKnobId}" style="${deckColorStyle(gamepad.playerColor)}"></div>
        </div>
        <span class="twin-stick-label">${escapeHtml(moveLabel)}</span>
      </div>
      <div class="twin-stick-half twin-aim-half" data-controller-layout-target="right" id="${aimZoneId}" aria-label="${escapeHtml(aimLabel)}">
        ${actionHtml}
        <div class="phone-joy-base" style="border-color: ${gamepad.playerColor};">
          <div class="phone-joy-knob" id="${aimKnobId}" style="${deckColorStyle(gamepad.playerColor)}"></div>
        </div>
        <span class="twin-stick-label">${escapeHtml(aimLabel)}</span>
      </div>
    </div>
  `;

  gamepad.bindJoystick(moveZoneId, moveKnobId, (input, opts) => {
    gamepad._sendAnalog({ action: 'JOYSTICK_MOVE', ...input }, opts);
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
    onRelease(input, { cancelled = false, tap = false } = {}) {
      gamepad._sendAimInput({
        action: 'AIM_RELEASE',
        ...input,
        ...(cancelled ? { cancelled: true } : {}),
        ...(tap ? { tap: true } : {}),
      });
    },
  });

  const buttonEls = [];
  const activeHolds = new Set();
  actions.forEach((act, i) => {
    const btn = container.querySelector(`[data-action-index="${i}"]`);
    if (!btn) return;
    const entry = { config: act, el: btn };
    buttonEls.push(entry);
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
      { hostSynced: !!act.syncHostCooldown }
    );
    entry.handler = handler;
    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
  });

  return {
    handleSync(data) {
      buttonEls.forEach(({ config, el, handler }) => {
        if (!config.syncHostCooldown || !el.isConnected) return;
        const field = config.hostCdField || 'cd';
        const arr = Array.isArray(data[field]) ? data[field] : null;
        const pct = arr ? Math.max(0, Math.min(1, (Number(arr[gamepad.playerIndex]) || 0) / 100)) : 0;
        el.style.opacity = pct > 0 ? 0.55 : 1;
        handler?.syncHost?.(pct);
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
        <button class="tank-fire-btn" id="btn-tank-fire" type="button" aria-label="${escapeHtml(fireLabel)}" title="${escapeHtml(fireLabel)}" style="${deckColorStyle(gamepad.playerColor)}">
          <span class="fire-icon">${getTabletopIconSvg(schema.fireIcon || 'bomb', { size: 38, color: 'currentColor', strokeWidth: 2.4 })}</span>
          <span class="tank-ammo-hud" id="tank-ammo-hud" aria-hidden="true">
            <span class="cartridge-pip loaded"></span>
            <span class="cartridge-pip loaded"></span>
          </span>
        </button>
      </div>
    </div>
  `;

  const driveBtn = document.getElementById('btn-tank-drive');
  let isDriving = false;
  /** @type {ReturnType<typeof setInterval> | 0} */
  let driveKeepaliveId = 0;

  const startDrive = (e) => {
    e?.preventDefault();
    if (isDriving) return;
    isDriving = true;
    driveBtn?.classList.add('active');
    gamepad.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: true });
    gamepad.vibrate(20);
    gamepad.playTick();
    // Basılı pedal keepalive'i: host'un analog sessizlik süpürücüsü
    // (STALE_ANALOG_MS = 1500) tek paketle `isDriving`'i sıfırlıyordu.
    driveKeepaliveId = setInterval(() => {
      if (isDriving) gamepad.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: true });
    }, CONTROL_KEEPALIVE_MS);
  };

  const stopDrive = (e) => {
    e?.preventDefault();
    if (!isDriving) return;
    isDriving = false;
    clearInterval(driveKeepaliveId);
    driveKeepaliveId = 0;
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
        const ammoPips = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('#tank-ammo-hud .cartridge-pip'));
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
      clearInterval(driveKeepaliveId);
      driveKeepaliveId = 0;
      if (isDriving) {
        try {
          gamepad.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: false });
        } catch {}
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 3. STEER_ACTION Archetype (CURVE, SNAKE)
// Tek yön rocker'ı (sol) + deklaratif aksiyon kümesi (sağ). Basılı tutulan yön
// CONTROL_KEEPALIVE_MS ile tekrarlanır: host'taki analog sessizlik süpürücüsü
// (main.js STALE_ANALOG_MS = 1500) basılı yönü 1.5 sn'de sıfırlıyor, kumanda
// "yön tutmuyor" gibi davranıyordu.
// ---------------------------------------------------------------------------
function steerActionButtonHtml(act, index, playerColor, iconSize) {
  const bg = deckColorStyle(act.color || playerColor);
  const icon = act.icon || (act.action === 'DASH' ? 'zap' : 'flame');
  const label = getGuideActionLabel(act);
  return `
    <button class="action-dash-btn steer-action-btn ${act.className || ''}" data-action-index="${index}" type="button"
      aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" style="${bg}">
      <span class="btn-action-icon">${getTabletopIconSvg(icon, { size: iconSize, color: 'currentColor', strokeWidth: 2.4 })}</span>
    </button>
  `;
}

function mountSteerAction(gamepad, container, schema) {
  const steerLeftLabel = t('pad.steerLeft');
  const steerRightLabel = t('pad.steerRight');
  const stamp = Date.now();
  const steerZoneId = `steer-zone-${stamp}`;
  const rockerId = `steer-rocker-${stamp}`;
  const actions = schema.actions || [];
  const actionHtml = actions.length > 0
    ? `<div class="steer-action-zone" data-controller-layout-target="right">${actions
      .map((act, i) => steerActionButtonHtml(act, i, gamepad.playerColor, 38))
      .join('')}</div>`
    : '';

  container.innerHTML = `
    <div class="steer-action-view">
      <div class="steer-zone" data-controller-layout-target="left" id="${steerZoneId}">
        <div class="steer-rocker-cluster" id="${rockerId}">
          <button class="steer-rocker-btn left" data-steer="-1" type="button" aria-label="${escapeHtml(steerLeftLabel)}">
            <span class="steer-icon">${getTabletopIconSvg('arrow_left', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
          </button>
          <button class="steer-rocker-btn right" data-steer="1" type="button" aria-label="${escapeHtml(steerRightLabel)}">
            <span class="steer-icon">${getTabletopIconSvg('arrow_right', { size: 28, color: 'currentColor', strokeWidth: 2.8 })}</span>
          </button>
        </div>
      </div>
      ${actionHtml}
    </div>
  `;

  const steerZone = container.querySelector(`#${steerZoneId}`);
  const rocker = container.querySelector(`#${rockerId}`);
  const btnLeft = rocker?.querySelector('[data-steer="-1"]');
  const btnRight = rocker?.querySelector('[data-steer="1"]');

  const activeTouches = new Map();
  let mouseDir = 0;
  let currentActiveDir = 0;
  let lastSteerVibrateAt = 0;

  const sendSteer = (dir) => gamepad.sendInput({
    action: schema.steerAction || 'CURVE_STEER',
    dir,
  });

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
      sendSteer(currentActiveDir);
      // Sınırda parmak gidip gelince yön flip'leri titreşim spam'i yapıyordu;
      // serinleme: aynı anda en fazla biri hissedilir.
      const now = performance.now();
      if (currentActiveDir !== 0 && now - lastSteerVibrateAt >= 200) {
        lastSteerVibrateAt = now;
        gamepad.vibrate(15);
      }
    }
  };

  const getDirForPoint = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    const steerBtn = /** @type {HTMLElement | null} */ (el?.closest('[data-steer]'));
    if (steerBtn) return parseInt(steerBtn.dataset.steer, 10);
    const rect = (steerZone || rocker)?.getBoundingClientRect();
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
      activeTouches.delete(e.changedTouches[i].identifier);
    }
    syncSteer();
  };

  // Dokunma yalnız rocker bölgesinde: aksiyon düğmesine basan parmak yön
  // üretmez (eskiden tüm ekran dinleniyordu, sağdaki iki rocker da yönü çakıştırıyordu).
  steerZone?.addEventListener('touchstart', onTouchStart, { passive: false });
  steerZone?.addEventListener('touchmove', onTouchMove, { passive: false });
  steerZone?.addEventListener('touchend', onTouchEnd, { passive: true });
  steerZone?.addEventListener('touchcancel', onTouchEnd, { passive: true });

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

  // Basılı yön keepalive'i (host'un stale sweeper'ı yönü sıfırlamasın).
  const keepalive = setInterval(() => {
    const held = activeTouches.size > 0 || mouseDir !== 0;
    if (held && currentActiveDir !== 0) sendSteer(currentActiveDir);
  }, CONTROL_KEEPALIVE_MS);

  // Aksiyon düğmeleri: hold varsa bas-bırak lifecycle, yoksa cooldown'lu tap.
  const buttonEls = [];
  const activeHolds = new Set();
  actions.forEach((act, i) => {
    const btn = container.querySelector(`[data-action-index="${i}"]`);
    if (!btn) return;
    const entry = { config: act, el: btn };
    buttonEls.push(entry);
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
      { hostSynced: !!act.syncHostCooldown }
    );
    entry.handler = handler;
    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
  });

  return {
    handleSync(data) {
      buttonEls.forEach(({ config, el, handler }) => {
        if (!config.syncHostCooldown || !el.isConnected) return;
        const arr = Array.isArray(data.cd) ? data.cd : null;
        const pct = arr ? Math.max(0, Math.min(1, (Number(arr[gamepad.playerIndex]) || 0) / 100)) : 0;
        el.style.opacity = pct > 0 ? 0.55 : 1;
        handler?.syncHost?.(pct);
      });
      if (typeof schema.onSync === 'function') schema.onSync(gamepad, data, { buttonEls });
    },
    teardown() {
      clearInterval(keepalive);
      if (currentActiveDir !== 0) {
        try { sendSteer(0); } catch {}
      }
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
// 4. SLIDER_1D Archetype (PONG)
// ---------------------------------------------------------------------------
function mountSlider1D(gamepad, container, schema) {
  const baseInvert = gamepad.playerIndex === 1 || gamepad.playerIndex === 3;
  const verticalAxis = gamepad.playerIndex === 2 || gamepad.playerIndex === 3;
  const sensitivity = getPreference('pongSensitivity');

  if (!gamepad.pongInvertManualSet) {
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
      <div class="pong-bottom-zone">
        <div class="pong-track-wrap" data-controller-layout-target="left">
          <div class="pong-instruction" id="pong-direction-hint">${directionHint()}</div>
          <div class="pong-horizontal-track" id="pong-track" role="slider" aria-label="${escapeHtml(directionHint())}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(gamepad.pongPosition * 100)}" tabindex="0">
            <div class="pong-track-thumb horizontal" id="pong-thumb" style="${verticalAxis ? 'top' : 'left'}: ${gamepad.pongPosition * 100}%; background-color: ${gamepad.playerColor}">
              PADDLE
            </div>
          </div>
        </div>
        <button class="action-spin-btn" data-controller-layout-target="right" id="btn-pong-spin" type="button" aria-label="${escapeHtml(t('pad.spinShort'))}" title="${escapeHtml(t('pad.spinShort'))}" style="${deckColorStyle(gamepad.playerColor)}">
          <span class="btn-action-icon">${getTabletopIconSvg('rotate_cw', { size: 38, color: 'currentColor', strokeWidth: 2.4 })}</span>
        </button>
      </div>
      <!-- Eksen çevir: sürgünün hemen ALTINDA değil, sahnenin sol üst köşesinde.
           Sürgü grubu data-controller-layout-target olduğu için
           will-change:transform ile bir containing block'tur; sürgünün
           İÇİNDE kalsaydı "daha uzağa" taşınamazdı. -->
      <button class="pong-invert-btn ${gamepad.isPongInverted !== baseInvert ? 'inverted' : ''}" id="btn-invert-axis" type="button" title="${gamepad.isPongInverted !== baseInvert ? t('pad.autoDir') : t('pad.flipDir')}">
        ${gamepad.isPongInverted !== baseInvert ? tIcon('pad.autoDir') : tIcon('pad.flipDir')}
      </button>
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
    gamepad.pongInvertManualSet = true;
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
      }
    },
    teardown() {}
  };
}