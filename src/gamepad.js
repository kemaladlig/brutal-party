// Specialized Gamepad Controller for Mobile Phones in TV/Console & Online Mode
// Adapts dynamically to Pong, Tanks, Curve, Bomb, Heist, and Duel with ultra-low latency inputs.

export class GamepadManager {
  constructor(overlayEl, network) {
    this.overlay = overlayEl;
    this.network = network;
    this.gameMode = 'PONG';
    this.playerIndex = 0;
    this.playerName = 'OYUNCU 1';
    this.playerColor = '#D84727';
    this.activeTouchId = null;

    // Joystick state
    this.joy = {
      active: false,
      originX: 0,
      originY: 0,
      currX: 0,
      currY: 0,
      angle: 0,
      force: 0,
    };

    // Pong touch track
    this.pongPosition = 0.5;

    // Duel state
    this.duelState = 'WAIT';
    this.duelReactionMs = null;

    // Emoji reaction state
    this.isEmojiOpen = false;
  }

  init(playerInfo, gameMode = 'PONG') {
    this.playerIndex = playerInfo.slotIndex;
    this.playerName = playerInfo.name;
    this.playerColor = playerInfo.color;
    this.gameMode = gameMode;

    this.renderShell();
    this.renderGameController(this.gameMode);
    this.overlay.classList.remove('hidden');
  }

  hide() {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.overlay.className = 'hidden'; // clear any alert classes
  }

  renderShell() {
    this.overlay.innerHTML = `
      <div class="gamepad-header">
        <div class="player-badge-pod">
          <div class="player-indicator-dot" style="background-color: ${this.playerColor}"></div>
          <span class="player-name-label">P${this.playerIndex + 1} // ${this.playerName}</span>
        </div>
        <div class="gamepad-room-info">ODA: #${this.network.roomCode || '----'}</div>
        <div class="gamepad-header-actions">
          <button class="emoji-reaction-btn" id="btn-toggle-emoji" type="button" title="Tepki Gönder">🔥</button>
          <button class="btn-leave-gamepad" id="btn-leave-gamepad" type="button">AYRIL</button>
        </div>
      </div>

      <div class="gamepad-sub-hud" id="gamepad-sub-hud">
        <span class="hud-game-tag" id="hud-game-tag">🏓 PONG</span>
        <span class="hud-live-status" id="hud-live-status">BEKLENİYOR...</span>
      </div>

      <div class="gamepad-workspace" id="gamepad-workspace"></div>

      <!-- Quick Emoji Reaction Bar -->
      <div class="emoji-wheel-modal hidden" id="emoji-wheel-modal">
        <button class="emoji-wheel-item" data-emoji="🔥">🔥</button>
        <button class="emoji-wheel-item" data-emoji="💀">💀</button>
        <button class="emoji-wheel-item" data-emoji="😂">😂</button>
        <button class="emoji-wheel-item" data-emoji="🏆">🏆</button>
        <button class="emoji-wheel-item" data-emoji="😱">😱</button>
      </div>
    `;

    document.getElementById('btn-leave-gamepad')?.addEventListener('click', () => {
      this.network.disconnect();
      this.hide();
      window.location.href = window.location.pathname; // Clean refresh to main menu
    });

    const emojiModal = document.getElementById('emoji-wheel-modal');
    document.getElementById('btn-toggle-emoji')?.addEventListener('click', () => {
      this.isEmojiOpen = !this.isEmojiOpen;
      emojiModal?.classList.toggle('hidden', !this.isEmojiOpen);
    });

    emojiModal?.querySelectorAll('.emoji-wheel-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const emoji = e.currentTarget.dataset.emoji;
        this.network.sendReaction(emoji);
        this.isEmojiOpen = false;
        emojiModal?.classList.add('hidden');
        if (navigator.vibrate) navigator.vibrate(20);
      });
    });
  }

  renderGameController(mode) {
    this.gameMode = mode;
    const workspace = document.getElementById('gamepad-workspace');
    if (!workspace) return;

    workspace.innerHTML = '';

    const modeTag = document.getElementById('hud-game-tag');
    if (modeTag) {
      const modeNames = {
        PONG: '🏓 PONG',
        TANKS: '🛡️ TANKS',
        CURVE: '🐍 CURVE',
        BOMB: '💣 BOMB',
        HEIST: '💰 HEIST',
        DUEL: '🤠 DUEL',
      };
      modeTag.textContent = modeNames[mode] || mode;
    }

    if (mode === 'PONG') {
      this.mountPongController(workspace);
    } else if (mode === 'TANKS') {
      this.mountTanksController(workspace);
    } else if (mode === 'CURVE') {
      this.mountCurveController(workspace);
    } else if (mode === 'BOMB') {
      this.mountBombController(workspace);
    } else if (mode === 'HEIST') {
      this.mountHeistController(workspace);
    } else if (mode === 'DUEL') {
      this.mountDuelController(workspace);
    }
  }

  // --- 01: PONG CONTROLLER (1D Vertical/Horizontal Touch Slider) ---
  mountPongController(container) {
    container.innerHTML = `
      <div class="pong-controller-view">
        <div class="pong-instruction">PARMAĞINI SÜRÜKLE • PADDLE'I YÖNET</div>
        <div class="pong-touch-track" id="pong-track">
          <div class="pong-track-thumb" id="pong-thumb" style="top: 50%; background-color: ${this.playerColor}">
            PADDLE // P${this.playerIndex + 1}
          </div>
        </div>
      </div>
    `;

    const track = document.getElementById('pong-track');
    const thumb = document.getElementById('pong-thumb');
    let isTrackingMouse = false;

    const updateSlider = (clientY) => {
      const rect = track.getBoundingClientRect();
      const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const normalized = relativeY / rect.height; // 0.0 (top) to 1.0 (bottom)
      this.pongPosition = normalized;

      if (thumb) {
        thumb.style.top = `${normalized * 100}%`;
        thumb.style.transform = 'translateY(-50%)';
      }

      this.network.sendInput({
        action: 'PADDLE_MOVE',
        position: normalized,
      });
    };

    track?.addEventListener('touchstart', (e) => {
      if (e.touches[0]) updateSlider(e.touches[0].clientY);
    }, { passive: true });

    track?.addEventListener('touchmove', (e) => {
      if (e.touches[0]) updateSlider(e.touches[0].clientY);
    }, { passive: true });

    // Mouse support
    track?.addEventListener('mousedown', (e) => {
      isTrackingMouse = true;
      updateSlider(e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (isTrackingMouse) updateSlider(e.clientY);
    });
    window.addEventListener('mouseup', () => {
      isTrackingMouse = false;
    });
  }

  // --- 02: TANKS CONTROLLER (Joystick + Fire Button + Ammo Pips) ---
  mountTanksController(container) {
    container.innerHTML = `
      <div class="tanks-controller-view">
        <div class="tanks-steer-zone" id="tank-steer-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="tank-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="tanks-fire-zone">
          <button class="tank-fire-btn" id="btn-tank-fire" type="button">💥 ATEŞ</button>
          <div class="tank-ammo-hud" id="tank-ammo-hud">
            <div class="cartridge-pip loaded"></div>
            <div class="cartridge-pip loaded"></div>
            <div class="cartridge-pip loaded"></div>
          </div>
        </div>
      </div>
    `;

    this.bindJoystick('tank-steer-zone', 'tank-joy-knob', (input) => {
      this.network.sendInput({ action: 'TANK_MOVE', ...input });
    });

    const fireBtn = document.getElementById('btn-tank-fire');
    const fireAction = (e) => {
      e?.preventDefault();
      this.network.sendInput({ action: 'TANK_FIRE' });
      if (navigator.vibrate) navigator.vibrate(30);
    };

    fireBtn?.addEventListener('touchstart', fireAction);
    fireBtn?.addEventListener('mousedown', fireAction);
  }

  // --- 03: CURVE CONTROLLER (Left 50% Sol / Right 50% Sağ) ---
  mountCurveController(container) {
    container.innerHTML = `
      <div class="curve-controller-view">
        <button class="curve-steer-btn" id="btn-curve-left" type="button">◀ SOL</button>
        <button class="curve-steer-btn right-btn" id="btn-curve-right" type="button">SAĞ ▶</button>
      </div>
    `;

    const btnLeft = document.getElementById('btn-curve-left');
    const btnRight = document.getElementById('btn-curve-right');

    const bindHold = (btn, dir) => {
      if (!btn) return;
      const start = (e) => {
        e.preventDefault();
        this.network.sendInput({ action: 'CURVE_STEER', dir });
      };
      const end = (e) => {
        e.preventDefault();
        this.network.sendInput({ action: 'CURVE_STEER', dir: 0 });
      };
      btn.addEventListener('touchstart', start);
      btn.addEventListener('touchend', end);
      btn.addEventListener('touchcancel', end);
      btn.addEventListener('mousedown', start);
      btn.addEventListener('mouseup', end);
      btn.addEventListener('mouseleave', end);
    };

    bindHold(btnLeft, -1);
    bindHold(btnRight, 1);
  }

  // --- 04: BOMB CONTROLLER (Joystick + Dash) ---
  mountBombController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="bomb-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="bomb-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <button class="action-dash-btn" id="btn-bomb-dash" type="button">⚡ DEPAR</button>
        </div>
      </div>
    `;

    this.bindJoystick('bomb-joy-zone', 'bomb-joy-knob', (input) => {
      this.network.sendInput({ action: 'JOYSTICK_MOVE', ...input });
    });

    const dashBtn = document.getElementById('btn-bomb-dash');
    const dashAction = (e) => {
      e?.preventDefault();
      this.network.sendInput({ action: 'DASH' });
      if (navigator.vibrate) navigator.vibrate([20, 30]);
    };
    dashBtn?.addEventListener('touchstart', dashAction);
    dashBtn?.addEventListener('mousedown', dashAction);
  }

  // --- 05: HEIST CONTROLLER (Joystick + Tackle) ---
  mountHeistController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="heist-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="heist-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <button class="action-dash-btn" id="btn-heist-tackle" type="button" style="background-color: #d99b26">💥 OMUZ AT</button>
        </div>
      </div>
    `;

    this.bindJoystick('heist-joy-zone', 'heist-joy-knob', (input) => {
      this.network.sendInput({ action: 'JOYSTICK_MOVE', ...input });
    });

    const tackleBtn = document.getElementById('btn-heist-tackle');
    const tackleAction = (e) => {
      e?.preventDefault();
      this.network.sendInput({ action: 'TACKLE' });
      if (navigator.vibrate) navigator.vibrate([20, 40]);
    };
    tackleBtn?.addEventListener('touchstart', tackleAction);
    tackleBtn?.addEventListener('mousedown', tackleAction);
  }

  // --- 06: DUEL CONTROLLER (Full Screen Tap-on-Signal Trigger) ---
  mountDuelController(container) {
    container.innerHTML = `
      <div class="duel-controller-view">
        <button class="duel-full-trigger-btn" id="btn-duel-trigger" type="button" style="background-color: ${this.playerColor}">
          <div class="duel-trigger-state" id="duel-trigger-state">✋ BEKLE...</div>
          <div class="duel-trigger-sub" id="duel-trigger-sub">SİNYALİ GÖRÜNCE DOKUN!</div>
        </button>
      </div>
    `;

    const triggerBtn = document.getElementById('btn-duel-trigger');
    const triggerAction = (e) => {
      e?.preventDefault();
      this.network.sendInput({ action: 'DUEL_TAP' });
      if (navigator.vibrate) navigator.vibrate(50);
    };
    triggerBtn?.addEventListener('touchstart', triggerAction);
    triggerBtn?.addEventListener('mousedown', triggerAction);
  }

  // Generic Touch & Mouse Joystick Helper
  bindJoystick(zoneId, knobId, onInput) {
    const zone = document.getElementById(zoneId);
    const knob = document.getElementById(knobId);
    if (!zone || !knob) return;

    let activeTouchId = null;
    let isMouseDown = false;
    let centerX = 0;
    let centerY = 0;
    const maxRadius = 48;

    const startAt = (clientX, clientY) => {
      const rect = zone.getBoundingClientRect();
      centerX = rect.left + rect.width / 2;
      centerY = rect.top + rect.height / 2;
      this.updateJoy(clientX, clientY, centerX, centerY, maxRadius, knob, onInput);
    };

    const moveAt = (clientX, clientY) => {
      this.updateJoy(clientX, clientY, centerX, centerY, maxRadius, knob, onInput);
    };

    const endJoy = () => {
      activeTouchId = null;
      isMouseDown = false;
      knob.style.transform = 'translate(0px, 0px)';
      onInput({ dx: 0, dy: 0, angle: 0, force: 0 });
    };

    zone.addEventListener('touchstart', (e) => {
      if (activeTouchId !== null) return;
      const touch = e.changedTouches[0];
      activeTouchId = touch.identifier;
      startAt(touch.clientX, touch.clientY);
    }, { passive: true });

    zone.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeTouchId) {
          moveAt(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: true });

    zone.addEventListener('touchend', endJoy, { passive: true });
    zone.addEventListener('touchcancel', endJoy, { passive: true });

    // Mouse fallback for desktop testing
    zone.addEventListener('mousedown', (e) => {
      isMouseDown = true;
      startAt(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (isMouseDown) moveAt(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', () => {
      if (isMouseDown) endJoy();
    });
  }

  updateJoy(clientX, clientY, cx, cy, maxR, knobEl, onInput) {
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(maxR, dist);
    const angle = Math.atan2(dy, dx);

    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    knobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;

    const force = clampedDist / maxR;
    onInput({
      dx: Math.cos(angle) * force,
      dy: Math.sin(angle) * force,
      angle,
      force,
    });
  }

  // Handle live state sync broadcasts from Host
  handleStateSync(data) {
    if (!data) return;

    // Switch controller view if host changed game
    if (data.gameMode && data.gameMode !== this.gameMode) {
      this.renderGameController(data.gameMode);
    }

    const modeTag = document.getElementById('hud-game-tag');
    const liveStatus = document.getElementById('hud-live-status');

    if (modeTag && data.gameMode) {
      const modeIcons = {
        PONG: '🏓 PONG',
        TANKS: '🛡️ TANKS',
        CURVE: '🐍 CURVE',
        BOMB: '💣 BOMB',
        HEIST: '💰 HEIST',
        DUEL: '🤠 DUEL',
      };
      modeTag.textContent = modeIcons[data.gameMode] || data.gameMode;
    }

    // Update live status text
    if (liveStatus && data.scores) {
      let statusStr = '';
      if (data.gameMode === 'PONG') {
        statusStr = `RALLİ: ${data.rally || 0} • SKOR: ${data.scores.slice(0, 4).join('-')}`;
      } else if (data.gameMode === 'TANKS') {
        statusStr = `SKOR: ${data.scores.join('-')}`;
      } else if (data.gameMode === 'CURVE') {
        statusStr = `SKOR: ${data.scores.join('-')}`;
      } else if (data.gameMode === 'BOMB') {
        const timeStr = data.bombTime !== undefined ? `${data.bombTime}s` : '';
        statusStr = data.carrier === this.playerIndex ? `🔥 BOMBA SENDE! (${timeStr})` : `BOMBA: P${(data.carrier ?? 0) + 1} (${timeStr})`;
      } else if (data.gameMode === 'HEIST') {
        const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
        statusStr = data.gemCarrier === this.playerIndex ? `💎 ELMAS SENDE!` : `SÜRE: ${timeStr} • ${data.scores.join('-')}`;
      } else if (data.gameMode === 'DUEL') {
        statusStr = `SKOR: ${data.scores.join('-')}`;
      }
      liveStatus.textContent = statusStr;
    }

    // 1. Bomb Alert
    if (this.gameMode === 'BOMB') {
      const isCarrier = data.carrier === this.playerIndex;
      this.overlay.classList.toggle('bomb-carrier-alert', isCarrier);
    } else {
      this.overlay.classList.remove('bomb-carrier-alert');
    }

    // 2. Heist Alert
    if (this.gameMode === 'HEIST') {
      const isGemCarrier = data.gemCarrier === this.playerIndex;
      this.overlay.classList.toggle('gem-carrier-alert', isGemCarrier);
    } else {
      this.overlay.classList.remove('gem-carrier-alert');
    }

    // 3. Tanks Ammo Pips Sync
    if (this.gameMode === 'TANKS' && Array.isArray(data.ammo)) {
      const myAmmo = data.ammo[this.playerIndex] ?? 0;
      const ammoPips = document.querySelectorAll('#tank-ammo-hud .cartridge-pip');
      ammoPips.forEach((pip, idx) => {
        pip.classList.toggle('loaded', idx < myAmmo);
      });
    }

    // 4. Duel State updates
    if (this.gameMode === 'DUEL') {
      const stateEl = document.getElementById('duel-trigger-state');
      const subEl = document.getElementById('duel-trigger-sub');
      if (data.duelState === 'DRAW_SIGNAL') {
        this.overlay.classList.add('duel-flash-alert');
        window.setTimeout(() => this.overlay.classList.remove('duel-flash-alert'), 300);
        if (stateEl) stateEl.textContent = '💥 ATEŞ! DOKUN!';
        if (subEl) subEl.textContent = 'HEMEN BAS!';
        if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
      } else if (data.duelState === 'STANDOFF_COUNTDOWN' || data.duelState === 'TENSION') {
        if (stateEl) stateEl.textContent = 'SİNYAL BEKLENİYOR...';
        if (subEl) subEl.textContent = 'ERKEN BASMA! (-1 CEZA)';
      } else if (data.duelState === 'ROUND_OVER') {
        if (stateEl) stateEl.textContent = '🏁 TUR BİTTİ';
        if (subEl) subEl.textContent = data.winner !== null ? `KAZANAN: P${data.winner + 1}` : 'BERABERE';
      }
    }
  }
}
