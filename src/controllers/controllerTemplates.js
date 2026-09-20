// Declarative Gamepad Controller Templates
// Provides standardized archetypes (JOYSTICK_ACTION, ARCADE_DRIVE, TWO_BUTTON_STEER, SLIDER_1D, REACTION_TAP, DPAD_BOOST)
// allowing games and agents to declare controls via high-level schemas rather than writing imperative DOM code.

import { escapeHtml } from '../net.js';

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
    case 'ARCADE_DRIVE':
      return mountArcadeDrive(gamepad, container, schema);
    case 'TWO_BUTTON_STEER':
      return mountTwoButtonSteer(gamepad, container, schema);
    case 'SLIDER_1D':
      return mountSlider1D(gamepad, container, schema);
    case 'REACTION_TAP':
      return mountReactionTap(gamepad, container, schema);
    case 'DPAD_BOOST':
      return mountDpadBoost(gamepad, container, schema);
    default:
      console.warn(`[declarativeGamepad] Unknown controller schema type: ${schema.type}`);
      return null;
  }
}

// ---------------------------------------------------------------------------
// 1. JOYSTICK_ACTION Archetype (BOMB, HEIST, CROWN, ZONE, CLONE, COLLAPSE, LASER, NINJA)
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
    const clusterClass = isStacked ? '' : 'laser-actions-cluster';
    const clusterStyle = isStacked ? 'display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%;' : '';

    actionHtml = `
      <div class="${clusterClass}" style="${clusterStyle}">
        ${actions.map((act, i) => {
          const bg = act.color ? `background-color: ${act.color};` : '';
          const border = act.border ? `border-color: ${act.border};` : '';
          const flex = act.flex ? `flex: ${act.flex};` : '';
          const minHeight = act.minHeight ? `min-height: ${act.minHeight};` : '';
          const customClass = act.className || '';
          return `
            <button class="action-dash-btn ${customClass}" data-action-index="${i}" type="button" style="${bg} ${border} ${flex} ${minHeight}">
              <span class="dash-btn-label">${escapeHtml(act.label || 'EYLEM')}</span>
              <span class="dash-btn-sub">${escapeHtml(act.sub || 'DOKUN')}</span>
            </button>
          `;
        }).join('')}
      </div>
    `;
  } else if (actions.length === 1) {
    const act = actions[0];
    const bg = act.color ? `background-color: ${act.color};` : '';
    actionHtml = `
      <button class="action-dash-btn ${act.className || ''}" data-action-index="0" type="button" style="${bg}">
        <span class="dash-btn-label">${escapeHtml(act.label || 'EYLEM')}</span>
        <span class="dash-btn-sub">${escapeHtml(act.sub || 'DOKUN')}</span>
      </button>
    `;
  }

  container.innerHTML = `
    <div class="joystick-action-view">
      <div class="joystick-half" id="${joyZoneId}">
        <div class="phone-joy-base">
          <div class="phone-joy-knob" id="${joyKnobId}" style="background-color: ${gamepad.playerColor}"></div>
        </div>
      </div>
      <div class="action-half">
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
  actions.forEach((act, i) => {
    const btn = container.querySelector(`[data-action-index="${i}"]`);
    if (!btn) return;
    buttonEls.push({ config: act, el: btn });

    const secs = act.cooldown ?? 2.0;
    const vibratePattern = act.vibrate ?? [25, 35];
    const readyLabel = act.label || 'EYLEM';

    const handler = gamepad.cooledAction(
      btn,
      secs,
      readyLabel,
      () => gamepad.network.sendInput({ action: act.action, ...(act.payload || {}) }),
      vibratePattern
    );

    btn.addEventListener('touchstart', handler, { passive: false });
    btn.addEventListener('mousedown', handler);
  });

  return {
    handleSync(data) {
      // Sync Host Cooldown percentage to dim buttons if configured
      if (Array.isArray(data.cd)) {
        const cdPct = data.cd[gamepad.playerIndex] || 0;
        buttonEls.forEach(({ config, el }) => {
          if (config.syncHostCooldown && el.isConnected) {
            el.style.opacity = cdPct > 0 ? 0.55 : 1;
          }
        });
      }

      // Custom onSync callback from schema (e.g. carrier alert, king alert, role text)
      if (typeof schema.onSync === 'function') {
        schema.onSync(gamepad, data, { buttonEls });
      }
    },
    teardown() {
      if (typeof schema.onTeardown === 'function') {
        schema.onTeardown(gamepad);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 2. ARCADE_DRIVE Archetype (TANKS)
// ---------------------------------------------------------------------------
function mountArcadeDrive(gamepad, container, schema) {
  container.innerHTML = `
    <div class="tanks-arcade-view">
      <div class="tank-drive-zone">
        <button class="tank-drive-pedal" id="btn-tank-drive" type="button" style="border-color: ${gamepad.playerColor}">
          <span class="pedal-icon">${escapeHtml(schema.pedalIcon || '🚀')}</span>
          <span class="pedal-title">${escapeHtml(schema.pedalTitle || 'İLERLE')}</span>
          <span class="pedal-sub">${escapeHtml(schema.pedalSub || 'BASILI TUTUNCA GİDER • BIRAKINCA DÖNER')}</span>
        </button>
      </div>
      <div class="tanks-fire-zone">
        <button class="tank-fire-btn" id="btn-tank-fire" type="button">
          <span class="fire-icon">${escapeHtml(schema.fireIcon || '💥')}</span>
          <span class="fire-title">${escapeHtml(schema.fireTitle || 'ATEŞ')}</span>
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
    gamepad.network.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: true });
    gamepad.vibrate(20);
  };

  const stopDrive = (e) => {
    e?.preventDefault();
    if (!isDriving) return;
    isDriving = false;
    driveBtn?.classList.remove('active');
    gamepad.network.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: false });
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
    gamepad.network.sendInput({ action: schema.fireAction || 'TANK_FIRE' });
    gamepad.vibrate(30);
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
          gamepad.network.sendInput({ action: schema.driveAction || 'TANK_DRIVE', driving: false });
        } catch {}
      }
    }
  };
}

// ---------------------------------------------------------------------------
// 3. TWO_BUTTON_STEER Archetype (CURVE)
// ---------------------------------------------------------------------------
function mountTwoButtonSteer(gamepad, container, schema) {
  container.innerHTML = `
    <div class="curve-controller-view" id="curve-controller-view">
      <button class="curve-steer-btn" id="btn-curve-left" type="button">${escapeHtml(schema.leftLabel || '◀ SOL')}</button>
      <button class="curve-steer-btn right-btn" id="btn-curve-right" type="button">${escapeHtml(schema.rightLabel || 'SAĞ ▶')}</button>
    </div>
  `;

  const view = document.getElementById('curve-controller-view');
  const btnLeft = document.getElementById('btn-curve-left');
  const btnRight = document.getElementById('btn-curve-right');

  const activeTouches = new Map();
  let mouseDir = 0;
  let currentActiveDir = 0;

  const syncSteer = () => {
    let desiredDir = 0;
    if (activeTouches.size > 0) {
      for (const dir of activeTouches.values()) {
        desiredDir = dir;
      }
    } else if (mouseDir !== 0) {
      desiredDir = mouseDir;
    }

    btnLeft?.classList.toggle('active', desiredDir === -1);
    btnRight?.classList.toggle('active', desiredDir === 1);

    if (desiredDir !== currentActiveDir) {
      currentActiveDir = desiredDir;
      gamepad.network.sendInput({ action: schema.steerAction || 'CURVE_STEER', dir: currentActiveDir });
    }
  };

  const getDirForPoint = (clientX) => {
    const rect = view ? view.getBoundingClientRect() : null;
    if (!rect) return 0;
    return clientX < rect.left + rect.width / 2 ? -1 : 1;
  };

  const onTouchStart = (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      activeTouches.set(t.identifier, getDirForPoint(t.clientX));
    }
    syncSteer();
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (activeTouches.has(t.identifier)) {
        activeTouches.set(t.identifier, getDirForPoint(t.clientX));
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
  btnRight?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = 1; syncSteer(); });
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
          gamepad.network.sendInput({ action: schema.steerAction || 'CURVE_STEER', dir: 0 });
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

  if (!gamepad._pongInvertManualSet) {
    gamepad.isPongInverted = baseInvert;
  }

  const tvTargets = ['SAĞA', 'SOLA', 'AŞAĞI', 'YUKARI'];
  const tvDir = () => {
    const base = tvTargets[gamepad.playerIndex] || 'SAĞA';
    if (!gamepad.isPongInverted) return base;
    return { SAĞA: 'SOLA', SOLA: 'SAĞA', 'AŞAĞI': 'YUKARI', YUKARI: 'AŞAĞI' }[base] || base;
  };
  const directionHint = () => `SAĞA SÜRÜKLE → TV'DE ${tvDir()}`;

  container.innerHTML = `
    <div class="pong-controller-view horizontal">
      <div class="pong-live-scoreboard" id="pong-live-scoreboard">
        <div class="pong-score-pips" id="pong-score-display">SKOR: 0 - 0</div>
        <div class="pong-rally-badge" id="pong-rally-display">⚡ RALLİ: 0</div>
      </div>
      <div class="pong-position-badge" style="border-color: ${gamepad.playerColor}">📺 TV YERİ: ${posLabel}</div>
      <div class="pong-bottom-zone">
        <div class="pong-track-wrap">
          <div class="pong-instruction" id="pong-direction-hint">${directionHint()}</div>
          <div class="pong-horizontal-track" id="pong-track">
            <div class="pong-track-thumb horizontal" id="pong-thumb" style="left: ${gamepad.pongPosition * 100}%; background-color: ${gamepad.playerColor}">
              PADDLE
            </div>
          </div>
          <button class="pong-invert-btn ${gamepad.isPongInverted !== baseInvert ? 'inverted' : ''}" id="btn-invert-axis" type="button">
            ${gamepad.isPongInverted !== baseInvert ? '↺ OTOMATİK YÖN (DOKUN)' : '↺ YÖNÜ TERS ÇEVİR'}
          </button>
        </div>
        <button class="action-spin-btn" id="btn-pong-spin" type="button">
          <span class="dash-btn-label">🌀 FALSO</span>
          <span class="dash-btn-sub">DOKUN</span>
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
    '🌀 FALSO',
    () => gamepad.network.sendInput({ action: 'SPIN' }),
    [30, 40, 30]
  );
  spinBtn?.addEventListener('click', spinAction);

  invertBtn?.addEventListener('click', () => {
    gamepad.isPongInverted = !gamepad.isPongInverted;
    gamepad._pongInvertManualSet = true;
    const isManuallyFlipped = gamepad.isPongInverted !== baseInvert;
    invertBtn.classList.toggle('inverted', isManuallyFlipped);
    invertBtn.textContent = isManuallyFlipped ? '↺ OTOMATİK YÖN (DOKUN)' : '↺ YÖNÜ TERS ÇEVİR';
    if (hintEl) hintEl.textContent = directionHint();
  });

  const mountSignal = gamepad._mountAbort?.signal;
  const updateSliderX = (clientX) => {
    const rect = track.getBoundingClientRect();
    const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const rawNorm = relativeX / rect.width;
    const clampedNorm = Math.max(0, Math.min(1, (rawNorm - 0.10) / 0.80));
    const position = gamepad.isPongInverted ? 1.0 - clampedNorm : clampedNorm;
    gamepad.pongPosition = position;

    if (thumb) thumb.style.left = `${clampedNorm * 100}%`;
    gamepad._sendAnalog({ action: 'PADDLE_MOVE', position });
  };

  track?.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (e.touches[0]) updateSliderX(e.touches[0].clientX);
  }, { passive: false });

  track?.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (e.touches[0]) updateSliderX(e.touches[0].clientX);
  }, { passive: false });
  track?.addEventListener('touchend', (e) => { e.preventDefault(); }, { passive: false });
  track?.addEventListener('touchcancel', (e) => { e.preventDefault(); }, { passive: false });

  track?.addEventListener('mousedown', (e) => { isTrackingMouse = true; updateSliderX(e.clientX); });
  window.addEventListener('mousemove', (e) => { if (isTrackingMouse) updateSliderX(e.clientX); }, { signal: mountSignal });
  window.addEventListener('mouseup', () => { isTrackingMouse = false; }, { signal: mountSignal });

  return {
    handleSync(data) {
      if (data.scores) {
        const scoreDisp = document.getElementById('pong-score-display');
        const rallyDisp = document.getElementById('pong-rally-display');
        if (scoreDisp && data.scores) {
          const scoreTxt = Array.isArray(data.names)
            ? data.scores.slice(0, 4).map((s, i) => `${data.names[i] || `P${i + 1}`} ${s}`).join(' • ')
            : `SKOR: ${data.scores.slice(0, 4).join(' - ')}`;
          if (scoreDisp.textContent !== scoreTxt) scoreDisp.textContent = scoreTxt;
        }
        if (rallyDisp && data.rally !== undefined) {
          const rallyTxt = `⚡ RALLİ: ${data.rally}`;
          if (rallyDisp.textContent !== rallyTxt) rallyDisp.textContent = rallyTxt;
        }
        const sBtn = document.getElementById('btn-pong-spin');
        if (sBtn) {
          const label = sBtn.querySelector('.dash-btn-label');
          const sub = sBtn.querySelector('.dash-btn-sub');
          const cd = Array.isArray(data.cd) ? (data.cd[gamepad.playerIndex] || 0) : 0;
          const isCharged = data.chgIdx === gamepad.playerIndex;
          const txt = cd > 0 && !isCharged ? `⏳ ${cd}sn` : (isCharged ? `🌀 ${(data.chgT || 0).toFixed(1)}sn` : '🌀 FALSO');
          if (label && label.textContent !== txt) label.textContent = txt;
          if (sub) {
            const subTxt = isCharged ? 'KURULU!' : (cd > 0 ? 'DOLUYOR' : 'DOKUN');
            if (sub.textContent !== subTxt) sub.textContent = subTxt;
          }
        }
        if (rallyDisp && data.spn) {
          const spn = '🌀 TOP DÖNÜYOR!';
          if (rallyDisp.textContent !== spn) rallyDisp.textContent = spn;
        }
      }
    },
    teardown() {}
  };
}

// ---------------------------------------------------------------------------
// 5. REACTION_TAP Archetype (DUEL)
// ---------------------------------------------------------------------------
function mountReactionTap(gamepad, container, schema) {
  container.innerHTML = `
    <div class="duel-controller-view">
      <button class="duel-full-trigger-btn" id="btn-duel-trigger" type="button" style="background-color: ${gamepad.playerColor}">
        <div class="duel-trigger-state" id="duel-trigger-state">✋ BEKLE...</div>
        <div class="duel-trigger-sub" id="duel-trigger-sub">SİNYALİ GÖRÜNCE DOKUN!</div>
      </button>
    </div>
  `;

  const triggerBtn = document.getElementById('btn-duel-trigger');
  const triggerAction = (e) => {
    e?.preventDefault();
    gamepad._lastDuelTouchAt = performance.now();
    gamepad.network.sendInput({ action: schema.tapAction || 'DUEL_TAP' });
    gamepad.vibrate(50);
  };

  const triggerMouse = (e) => {
    if (performance.now() - (gamepad._lastDuelTouchAt || 0) < 600) return;
    e?.preventDefault();
    gamepad.network.sendInput({ action: schema.tapAction || 'DUEL_TAP' });
    gamepad.vibrate(50);
  };

  triggerBtn?.addEventListener('touchstart', triggerAction, { passive: false });
  triggerBtn?.addEventListener('mousedown', triggerMouse);

  return {
    handleSync(data) {
      const duelStateEl = document.getElementById('duel-trigger-state');
      const duelSub = document.getElementById('duel-trigger-sub');
      const duelBtn = document.getElementById('btn-duel-trigger');
      const tacticalRoleEl = document.getElementById('tactical-role-text');
      const phase = data.duelState;

      if (phase === 'DRAW_SIGNAL') {
        gamepad.overlay.classList.add('duel-flash-alert');
        window.setTimeout(() => gamepad.overlay.classList.remove('duel-flash-alert'), 300);
        if (duelStateEl) duelStateEl.textContent = '🔥 ÇEK!';
        if (duelSub) duelSub.textContent = 'ŞİMDİ DOKUN!';
        if (tacticalRoleEl) {
          tacticalRoleEl.textContent = '🔥 ÇEK! ŞİMDİ DOKUN!';
          tacticalRoleEl.style.color = '#25d366';
        }
        duelBtn?.classList.add('signal');
        if (duelBtn && !duelBtn.dataset.signaled) {
          duelBtn.dataset.signaled = '1';
          gamepad.vibrate([60, 40, 60]);
        }
      } else if (phase === 'ROUND_OVER' || phase === 'MATCH_OVER') {
        const w = data.winner;
        if (duelStateEl) {
          duelStateEl.textContent =
            w === null || w === undefined ? '🤝 BERABERE' : (w === gamepad.playerIndex ? '🏆 KAZANDIN!' : `P${w + 1} ALDI`);
        }
        if (duelSub) duelSub.textContent = phase === 'MATCH_OVER' ? 'MAÇ BİTTİ' : 'SONRAKİ RAUNT...';
        if (tacticalRoleEl) {
          tacticalRoleEl.textContent = w === gamepad.playerIndex ? '🏆 RAUNDU KAZANDIN!' : '⚔️ HAZIRLAN...';
          tacticalRoleEl.style.color = '#ffd700';
        }
        duelBtn?.classList.remove('signal');
        if (duelBtn) delete duelBtn.dataset.signaled;
      } else {
        if (duelStateEl) duelStateEl.textContent = '✋ BEKLE...';
        if (duelSub) duelSub.textContent = 'SİNYALİ GÖRÜNCE DOKUN!';
        if (tacticalRoleEl) {
          tacticalRoleEl.textContent = '✋ BEKLE... SİNYALİ GÖRÜNCE DOKUN!';
          tacticalRoleEl.style.color = '#ffd700';
        }
        duelBtn?.classList.remove('signal');
        if (duelBtn) delete duelBtn.dataset.signaled;
      }
    },
    teardown() {}
  };
}

// ---------------------------------------------------------------------------
// 6. DPAD_BOOST Archetype (SNAKE)
// ---------------------------------------------------------------------------
function mountDpadBoost(gamepad, container, schema) {
  container.innerHTML = `
    <div class="snake-controller-view">
      <div class="snake-dpad-half">
        <div class="brutal-dpad" id="snake-dpad">
          <button class="dpad-btn dpad-up" id="btn-snake-up" type="button">▲</button>
          <div class="dpad-row-mid">
            <button class="dpad-btn dpad-left" id="btn-snake-left" type="button">◀</button>
            <div class="dpad-core"></div>
            <button class="dpad-btn dpad-right" id="btn-snake-right" type="button">▶</button>
          </div>
          <button class="dpad-btn dpad-down" id="btn-snake-down" type="button">▼</button>
        </div>
      </div>
      <div class="action-half">
        <button class="action-dash-btn snake-boost-btn" id="btn-snake-boost" type="button" style="background-color: ${schema.boostColor || '#2F6A4F'}">
          <span class="dash-btn-label">${escapeHtml(schema.boostLabel || '⚡ HIZLAN')}</span>
          <span class="dash-btn-sub">${escapeHtml(schema.boostSub || 'BASILI TUT')}</span>
        </button>
      </div>
    </div>
  `;

  const btnUp = document.getElementById('btn-snake-up');
  const btnDown = document.getElementById('btn-snake-down');
  const btnLeft = document.getElementById('btn-snake-left');
  const btnRight = document.getElementById('btn-snake-right');
  const btnBoost = document.getElementById('btn-snake-boost');

  const sendDir = (angle, dx, dy, btn) => {
    gamepad.network.sendInput({ action: schema.dirAction || 'SNAKE_DIR', angle, dx, dy });
    gamepad.vibrate(15);
    [btnUp, btnDown, btnLeft, btnRight].forEach((b) => b?.classList.remove('active'));
    btn?.classList.add('active');
  };

  const bindDir = (btn, angle, dx, dy) => {
    if (!btn) return;
    const act = (e) => {
      e?.preventDefault();
      sendDir(angle, dx, dy, btn);
    };
    btn.addEventListener('touchstart', act, { passive: false });
    btn.addEventListener('mousedown', act);
  };

  bindDir(btnUp, -Math.PI / 2, 0, -1);
  bindDir(btnDown, Math.PI / 2, 0, 1);
  bindDir(btnLeft, Math.PI, -1, 0);
  bindDir(btnRight, 0, 1, 0);

  let boosting = false;
  const startBoost = (e) => {
    e?.preventDefault();
    if (boosting) return;
    boosting = true;
    btnBoost?.classList.add('active');
    gamepad.network.sendInput({ action: schema.boostStartAction || 'SNAKE_BOOST' });
    gamepad.vibrate(20);
  };
  const stopBoost = (e) => {
    e?.preventDefault();
    if (!boosting) return;
    boosting = false;
    btnBoost?.classList.remove('active');
    gamepad.network.sendInput({ action: schema.boostEndAction || 'SNAKE_BOOST_RELEASE' });
  };

  const snakeSignal = gamepad._mountAbort?.signal;
  btnBoost?.addEventListener('touchstart', startBoost, { passive: false });
  btnBoost?.addEventListener('touchend', stopBoost, { passive: false });
  btnBoost?.addEventListener('touchcancel', stopBoost, { passive: false });
  window.addEventListener('touchend', stopBoost, { passive: true, signal: snakeSignal });
  window.addEventListener('touchcancel', stopBoost, { passive: true, signal: snakeSignal });
  btnBoost?.addEventListener('mousedown', startBoost);
  btnBoost?.addEventListener('mouseup', stopBoost);
  btnBoost?.addEventListener('mouseleave', stopBoost);

  return {
    handleSync() {},
    teardown() {
      if (boosting) {
        try {
          gamepad.network.sendInput({ action: schema.boostEndAction || 'SNAKE_BOOST_RELEASE' });
        } catch {}
      }
    }
  };
}
