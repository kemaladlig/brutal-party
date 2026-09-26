// Specialized Gamepad Controller for Mobile Phones in TV/Console & Online Mode
// Adapts dynamically to Lobby, Pong, Tanks, Curve, Bomb, Heist, and Archery with ultra-low latency inputs.

import { storePlayerName, escapeHtml } from './net.js';
import { showInstallToast } from './ui/toast.js';
import { UI_COLORS } from './ui/tokens.js';
import { motionScale } from './ui/motion.js';
import { playMenuTick, playMenuPop } from './audio.js';
import { mountDeclarativeController } from './controllers/controllerTemplates.js';
import { GamepadInputAdapter } from './controllers/gamepadInputAdapter.js';
import { getNeutralInputs } from './controllers/controlDefs.js';
import { getControllerStatus } from './controllers/controllerStatus.js';
import { getControllerGuide } from './controllers/controllerGuide.js';
import { getControllerMeta } from './core/engineRegistry.js';
import { getControlDescriptor } from './core/controlDescriptor.js';
import { PhysicalGamepadAdapter } from './controllers/physicalGamepadAdapter.js';
import { t, tIcon, onLangChange } from './i18n.js';
import { getAvatarProfile } from './core/customizationManager.js';
import { vibrate as triggerHaptic } from './core/haptics.js';
import { drawBrutalAvatar } from './ui/characterRenderer.js';
import { openCustomizeModal } from './ui/customizeModal.js';
import { getTabletopIconSvg } from './core/tabletopIcons.js';
import { GamepadWorldView } from './ui/gamepadWorldView.js';
import { renderLocalGamepadShell, renderRemoteGamepadShell } from './ui/gamepadShell.js';
import { openControllerLayoutEditor } from './ui/controllerLayoutEditor.js';
import {
  getControllerLayout,
  setControllerLayout,
  subscribePreferences,
} from './core/preferences.js';
import {
  normalizeControllerLayout,
  resolveControllerLayout,
  CONTROLLER_MIN_TOUCH_TARGET,
} from './core/controllerLayout.js';
import { getSlotSwapError } from './core/slotRules.js';

// Kumanda kayıt tablosu: tek kaynaktan (engineRegistry) beslenir
const CONTROLLER_META = new Proxy({}, {
  get(target, prop) {
    return getControllerMeta(prop);
  },
});

export class GamepadManager {
  constructor(overlayEl, network, { localMode = false } = {}) {
    this.overlay = overlayEl;
    this.network = network;
    this.inputAdapter = new GamepadInputAdapter((data) => this.sendInput(data));
    this._aimSequence = 0;
    this._lastLocalInputAt = 0;
    this._windowFocused = true;
    this._inputBlocked = false;
    this.physicalGamepad = new PhysicalGamepadAdapter({
      send: (data) => {
        if (data?.action === 'AIM_MOVE' || data?.action === 'AIM_PRESS' || data?.action === 'AIM_RELEASE') {
          this._sendAimInput(data);
        } else {
          this.sendInput(data);
        }
      },
      getMode: () => this.gameMode,
      getDescriptor: () => getControlDescriptor(this.gameMode, CONTROLLER_META[this.gameMode]?.schema),
      isBlocked: () => this._inputBlocked
        || !this._windowFocused
        || document.hidden
        || this.overlay.classList.contains('hidden')
        || performance.now() - this._lastLocalInputAt < 750,
    });
    this.localMode = localMode;
    this._workspaceOverride = null;
    this.gameMode = 'LOBBY';
    this.selectedHostGame = 'PONG';
    this.playerIndex = 0;
    this.playerName = 'OYUNCU 1';
    this.playerColor = UI_COLORS.players[0] || '#D84727';
    this.isReady = false;
    this.isPongInverted = false;
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

    // Emoji reaction state
    this.isEmojiOpen = false;

    // Slots occupancy state from host
    this.slots = [null, null, null, null];
    // Koltuk seçimi lobi açılır açılmaz görünür; staging yalnızca ready
    // aşamasını ve kilit durumunu değiştirir.
    this.stagingOpen = false;
    this.countdownActive = false;
    this._countdownT = null;

    // Mount başına window listener temizliği (re-mount sızıntısı → yinelenen gönderim)
    this._mountAbort = null;
    // 8Hz DOM churn kalkanı: eleman önbelleği + diff'li yazım
    this._elCache = new Map();
    this._lastStripJson = '';
    this._lastStatusStr = '';
    this._visibilityBound = false;
    this._wakeLock = null;
    this._browserLocksBound = false;
    this._activeController = null;
    this._worldView = null;
    this._worldViewToken = 0;
    this._worldViewEnabled = false;
    this._pendingWorldFrame = null;
    this._guideMode = null;
    this._activeLayoutRoot = null;
    this._layoutSafeProbe = null;
    this._layoutPreview = null;
    this._layoutEditor = null;
    this._layoutFrame = 0;
    this._layoutResizeObserver = null;
    this._lastScores = null;
    this._resultActive = false;
    this._unsubscribePreferences = subscribePreferences(() => {
      this._scheduleControllerLayout();
    });
  }

  // Güvenli ve merkezi Haptic Geri Bildirim
  vibrate(pattern) {
    triggerHaptic(pattern);
  }

  // Faz 2.3 — dokunma ses yansımaları (audio.js mute gate'inden geçer).
  playTick() {
    playMenuTick();
  }

  playPop() {
    playMenuPop();
  }

  sendInput(data, { force = false } = {}) {
    if (this._inputBlocked && !force) return false;
    this.network.sendInput(data);
    return true;
  }

  setInputBlocked(blocked) {
    const next = !!blocked;
    if (next === this._inputBlocked) return;
    // Release before arming the gate so the authoritative engine does not
    // retain a held stick/button while the editor is being manipulated.
    this._sendNeutralForMode();
    this._inputBlocked = next;
    if (!next) this._sendNeutralForMode();
  }

  getControllerLayout() {
    return getControllerLayout();
  }

  previewControllerLayout(value) {
    const layout = normalizeControllerLayout(value);
    this._layoutPreview = layout;
    return this._applyControllerLayout(layout) || this._getFallbackControllerLayoutMetrics(layout);
  }

  saveControllerLayout(value) {
    this._layoutPreview = null;
    const saved = setControllerLayout(value);
    this._scheduleControllerLayout();
    return saved;
  }

  clearControllerLayoutPreview() {
    if (!this._layoutPreview) return this.getControllerLayout();
    this._layoutPreview = null;
    this._scheduleControllerLayout();
    return this.getControllerLayout();
  }

  getControllerLayoutMetrics(value = this.getControllerLayout()) {
    return this._resolveControllerLayout(value) || this._getFallbackControllerLayoutMetrics(value);
  }

  _setActiveLayoutRoot(root) {
    this._activeLayoutRoot = root || null;
    if (this._layoutResizeObserver) {
      this._layoutResizeObserver.disconnect();
      this._layoutResizeObserver = null;
    }
    if (root && typeof ResizeObserver !== 'undefined') {
      this._layoutResizeObserver = new ResizeObserver(() => this._scheduleControllerLayout());
      this._layoutResizeObserver.observe(root);
    }
  }

  _readLayoutSafeInsets() {
    let probe = this._layoutSafeProbe;
    if (!probe?.isConnected) {
      probe = document.createElement('div');
      probe.className = 'controller-layout-safe-probe';
      probe.setAttribute('aria-hidden', 'true');
      this.overlay.appendChild(probe);
      this._layoutSafeProbe = probe;
    }
    try {
      const style = getComputedStyle(probe);
      return {
        top: Number.parseFloat(style.paddingTop) || 0,
        right: Number.parseFloat(style.paddingRight) || 0,
        bottom: Number.parseFloat(style.paddingBottom) || 0,
        left: Number.parseFloat(style.paddingLeft) || 0,
      };
    } catch {
      return { top: 0, right: 0, bottom: 0, left: 0 };
    }
  }

  _measureControllerLayout() {
    const root = this._activeLayoutRoot;
    if (!root?.isConnected) return null;
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width <= 0 || rootRect.height <= 0) return null;

    const targets = [...root.querySelectorAll('[data-controller-layout-target]')];
    if (targets.length === 0) return null;

    root.classList.add('controller-layout-measuring');

    // Measure the unflexed baseline. The current transform is represented by
    // CSS variables, so resetting those variables is enough to restore it.
    for (const target of targets) {
      target.style.setProperty('--controller-layout-dx', '0px');
      target.style.setProperty('--controller-layout-dy', '0px');
      target.style.setProperty('--controller-layout-scale', '1');
    }

    const bySide = { left: [], right: [] };
    for (const target of targets) {
      const side = target.dataset.controllerLayoutTarget;
      if (!bySide[side]) continue;
      const rect = target.getBoundingClientRect();
      bySide[side].push({
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        right: rect.right - rootRect.left,
        bottom: rect.bottom - rootRect.top,
        width: rect.width,
        height: rect.height,
      });
    }

    const union = (rects) => {
      if (rects.length === 0) return null;
      const left = Math.min(...rects.map((rect) => rect.left));
      const top = Math.min(...rects.map((rect) => rect.top));
      const right = Math.max(...rects.map((rect) => rect.right));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      return { left, top, right, bottom, width: right - left, height: bottom - top };
    };

    const insets = this._readLayoutSafeInsets();
    const frame = {
      left: Math.max(0, insets.left),
      top: Math.max(0, insets.top),
      right: Math.max(0, rootRect.width - insets.right),
      bottom: Math.max(0, rootRect.height - insets.bottom),
    };

    // LOCAL has a transparent canvas behind the DOM controls, so its HUD and
    // guide are real obstacles. Remote roots already start below these bands;
    // the intersection check keeps the same adapter valid in both surfaces.
    const obstacles = this.overlay.querySelectorAll(
      '.gamepad-header, .mobile-gamepad-toolbar, .gamepad-hud, .gamepad-control-guide:not([hidden]), .score-strip:not(.hidden)',
    );
    for (const obstacle of obstacles) {
      const rect = obstacle.getBoundingClientRect();
      const relativeTop = rect.top - rootRect.top;
      const relativeBottom = rect.bottom - rootRect.top;
      if (relativeBottom <= 0 || relativeTop >= rootRect.height) continue;
      if (relativeTop < Math.min(180, rootRect.height * 0.4)) {
        frame.top = Math.max(frame.top, relativeBottom);
      }
    }

    const landscape = window.innerWidth >= window.innerHeight;
    if (landscape) {
      // Keep the established lower control belt clear of the world view.
      frame.bottom = Math.min(frame.bottom, rootRect.height * 0.88);
    }
    frame.right = Math.max(frame.left, frame.right);
    frame.bottom = Math.max(frame.top, frame.bottom);
    root.classList.remove('controller-layout-measuring');

    return {
      root,
      rootRect: {
        left: rootRect.left,
        top: rootRect.top,
        width: rootRect.width,
        height: rootRect.height,
      },
      targets,
      groups: { left: union(bySide.left), right: union(bySide.right) },
      frame,
    };
  }

  _resolveControllerLayout(value) {
    const measured = this._measureControllerLayout();
    if (!measured) return null;
    const resolved = resolveControllerLayout(normalizeControllerLayout(value), {
      viewport: { width: measured.rootRect.width, height: measured.rootRect.height },
      safeFrame: measured.frame,
      groups: measured.groups,
      minTouchTarget: CONTROLLER_MIN_TOUCH_TARGET,
    });
    return {
      ...resolved,
      targets: measured.targets,
      rootRect: measured.rootRect,
      safeFrameAbsolute: {
        left: measured.rootRect.left + resolved.frame.left,
        top: measured.rootRect.top + resolved.frame.top,
        width: resolved.frame.width,
        height: resolved.frame.height,
        right: measured.rootRect.left + resolved.frame.right,
        bottom: measured.rootRect.top + resolved.frame.bottom,
      },
    };
  }

  _getFallbackControllerLayoutMetrics(value) {
    const overlayRect = this.overlay.getBoundingClientRect();
    const width = Math.max(1, overlayRect.width);
    const height = Math.max(1, overlayRect.height);
    const insets = this._readLayoutSafeInsets();
    const toolbar = this.overlay.querySelector('.gamepad-header, .mobile-gamepad-toolbar');
    const toolbarRect = toolbar?.getBoundingClientRect();
    const top = Math.min(
      height * 0.8,
      Math.max(insets.top, toolbarRect ? Math.max(0, toolbarRect.bottom - overlayRect.top) : 0),
    );
    const bottomInset = Math.max(insets.bottom, window.innerWidth >= window.innerHeight ? height * 0.12 : 0);
    const frame = {
      left: Math.min(insets.left, width * 0.25),
      top,
      right: Math.max(width - insets.right, width * 0.75),
      bottom: Math.max(top, height - bottomInset),
    };
    const profile = normalizeControllerLayout(value);
    const center = frame.left + frame.width / 2;
    const centerGap = Math.max(24, Math.min(120, frame.width * 0.16));
    const pointFor = (point) => ({
      centerX: frame.left + point.x * frame.width,
      centerY: frame.top + point.y * frame.height,
      dx: 0,
      dy: 0,
      scale: profile.size,
      width: 96,
      height: 96,
    });
    return {
      profile,
      scale: profile.size,
      frame,
      center,
      centerGap,
      sides: {
        left: pointFor(profile.left),
        right: pointFor(profile.right),
      },
      rootRect: {
        left: overlayRect.left,
        top: overlayRect.top,
        width,
        height,
      },
      safeFrameAbsolute: {
        left: overlayRect.left + frame.left,
        top: overlayRect.top + frame.top,
        right: overlayRect.left + frame.right,
        bottom: overlayRect.top + frame.bottom,
        width: frame.width,
        height: frame.height,
      },
      previewOnly: true,
    };
  }

  _applyControllerLayout(value) {
    const metrics = this._resolveControllerLayout(value);
    if (!metrics) return null;
    for (const target of metrics.targets) {
      const side = target.dataset.controllerLayoutTarget;
      const result = metrics.sides[side];
      if (!result) continue;
      target.style.setProperty('--controller-layout-dx', `${result.dx}px`);
      target.style.setProperty('--controller-layout-dy', `${result.dy}px`);
      target.style.setProperty('--controller-layout-scale', String(result.scale));
    }
    return metrics;
  }

  _scheduleControllerLayout() {
    if (this._layoutFrame || !this._activeLayoutRoot) return;
    const schedule = typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback) => setTimeout(callback, 0);
    this._layoutFrame = schedule(() => {
      this._layoutFrame = 0;
      this._applyControllerLayout(this._layoutPreview || this.getControllerLayout());
    });
  }

  _bindLayoutEditorButton() {
    this.overlay.querySelectorAll('[data-controller-layout-open]').forEach((button) => {
      button.addEventListener('click', () => {
        this.openControllerLayoutEditor();
      });
    });
  }

  openControllerLayoutEditor() {
    if (this.overlay.classList.contains('hidden')) return false;
    if (!this._layoutEditor) {
      this._layoutEditor = openControllerLayoutEditor(this);
    }
    this._layoutEditor.open();
    return true;
  }

  // Screen Wake Lock API — kumanda açıkken telefon ekranının kararmasını / kapanmasını önler
  async requestWakeLock() {
    if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && !this._wakeLock) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => {
          this._wakeLock = null;
        });
      } catch {
        this._wakeLock = null;
      }
    }
  }

  neutralizeInput() {
    this._lastLocalInputAt = performance.now();
    this._sendNeutralForMode();
  }

  releaseWakeLock() {
    if (this._wakeLock) {
      try {
        this._wakeLock.release();
      } catch {}
      this._wakeLock = null;
    }
  }

  // Sürekli analog akış için tek gönderim noktası: 50ms throttle + ölübant.
  // Sıfır paketleri (bırakma/durma) ve discrete aksiyonlar ASLA throttle edilmez.
  _nextAimSequence() {
    this._aimSequence = (this._aimSequence + 1) >>> 0;
    return this._aimSequence;
  }

  _sendAimInput(data, { force = false } = {}) {
    if (!data || typeof data.action !== 'string') return false;
    if (data.action === 'AIM_PRESS') this.inputAdapter.resetAction?.('AIM_MOVE');
    const packet = { ...data };
    if (!Number.isInteger(packet.seq)) packet.seq = this._nextAimSequence();
    return this.sendInput(packet, { force });
  }

  _sendAnalog(data, opts) {
    if (!data) return false;
    const packet = data.action === 'AIM_MOVE' && !Number.isInteger(data.seq)
      ? { ...data, seq: this._nextAimSequence() }
      : data;
    return this.inputAdapter.sendAnalog(packet, opts);
  }

  // Ortak aksiyon-buton soğutması (BOMB/HEIST/CROWN aynı desen):
  // bas → onFire() + buton kilitlenir, süre dolunca eski haline döner.
  // Sayaç mount sökümünde temizlenir (CdTimer sızıntısı kapandı).
  // Faz 2.1: metin yerine radyal cooldown (--cd conic) + merkez saniye rozeti.
  cooledAction(btn, secs, readyLabel, onFire, vibratePattern) {
    const state = { cooling: false, timer: null };
    const signal = this._mountAbort?.signal;
    if (signal) {
      signal.addEventListener('abort', () => {
        if (state.timer) clearInterval(state.timer);
        state.timer = null;
        state.cooling = false;
      }, { once: true });
    }
    return (e) => {
      e?.preventDefault();
      if (state.cooling) return;
      state.cooling = true;
      try { onFire(); } catch {}
      this.vibrate(vibratePattern);
      playMenuTick();
      if (!btn || !btn.isConnected) return;
      let remaining = secs;
      this.setButtonCooldown(btn, remaining, secs);
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(() => {
        remaining -= 0.1;
        if (remaining <= 0.05) {
          clearInterval(state.timer);
          state.timer = null;
          state.cooling = false;
          if (!btn.isConnected) return;
          this.resetButtonCooldown(btn, { flash: true });
          this.vibrate(15);
          playMenuPop();
        } else {
          this.setButtonCooldown(btn, remaining, secs);
        }
      }, 100);
    };
  }

  // Radyal cooldown dolgusu — `--cd` (kalan kesir 0..1) conic'e, `.cd-num`
  // merkeze kalan saniyeyi yazar. Yalnız sunum: kontrol geometrisi değişmez.
  setButtonCooldown(btn, remainingSecs, maxSecs) {
    if (!btn || !btn.isConnected) return;
    const frac = maxSecs > 0 ? Math.max(0, Math.min(1, remainingSecs / maxSecs)) : 0;
    btn.style.setProperty('--cd', String(frac));
    btn.classList.add('cooling');
    let num = btn.querySelector('.cd-num');
    if (!num) {
      num = document.createElement('span');
      num.className = 'cd-num';
      num.setAttribute('aria-hidden', 'true');
      btn.appendChild(num);
    }
    const whole = Math.ceil(remainingSecs);
    const next = String(whole > 0 ? whole : '');
    if (num.textContent !== next) num.textContent = next;
  }

  resetButtonCooldown(btn, { flash = true } = {}) {
    if (!btn || !btn.isConnected) return;
    btn.classList.remove('cooling');
    btn.style.removeProperty('--cd');
    const num = btn.querySelector('.cd-num');
    if (num) num.remove();
    if (flash) {
      btn.classList.remove('ready-flash');
      void btn.offsetWidth;
      btn.classList.add('ready-flash');
    }
  }

  // Koltuk değiştirme ön kapısı (lobi ızgarası + refresh tek kaynaktan;
  // sunucu/host son kapılar yerinde durur)
  canSwitchSlot(targetSlot) {
    return !getSlotSwapError({
      from: this.playerIndex,
      to: targetSlot,
      slots: this.slots,
      reservedHostSlot: this.network.reservedHostSlot,
      locked: this.countdownActive,
      remote: true,
    }) && this.gameMode === 'LOBBY';
  }

  // 8Hz'de getElementById yerine önbellek (mount değişince temizlenir)
  _el(id) {
    let el = this._elCache.get(id);
    if (el && el.isConnected) return el;
    el = document.getElementById(id);
    if (el) this._elCache.set(id, el);
    return el;
  }

  _destroyWorldView() {
    this._worldViewToken += 1;
    this._worldViewEnabled = false;
    this._pendingWorldFrame = null;
    this._worldView?.destroy();
    this._worldView = null;
  }

  _renderWorldPlaceholder(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.parentElement?.clientHeight || 1);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#F4F4F0';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#1A1A1A';
    ctx.font = '900 18px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t('pad.waiting'), width / 2, height / 2);
  }

  async _mountWorldView(canvas, descriptor) {
    const token = ++this._worldViewToken;
    try {
      const module = await descriptor.load();
      if (token !== this._worldViewToken || !canvas?.isConnected) return;
      const renderer = module.createWorldViewRenderer?.() ?? module.createSnakeWorldViewRenderer?.();
      if (!renderer) {
        this._renderWorldPlaceholder(canvas);
        return;
      }
      this._worldView = new GamepadWorldView(canvas, renderer, { slots: this.slots, selfSlot: this.playerIndex ?? -1 });
      if (this._pendingWorldFrame) {
        this._worldView.accept(this._pendingWorldFrame);
        this._pendingWorldFrame = null;
      }
    } catch (err) {
      console.warn('[GamepadManager] World view yüklenemedi:', err);
      this._renderWorldPlaceholder(canvas);
    }
  }

  // Mevcut mount'un window listener'larını sök, joystick takılı kalmasın diye
  // nötr paket gönder (zone innerHTML ile sökülmeden ÖNCE çağrılmalı)
  _teardownMount() {
    this._destroyWorldView();
    this._setActiveLayoutRoot(null);
    if (this._activeController?.teardown) {
      try { this._activeController.teardown(); } catch {}
      this._activeController = null;
    }
    if (this._mountAbort) {
      try { this._mountAbort.abort(); } catch {}
      this._mountAbort = null;
    }
  }

  // Sekme arka plana alınınca / sayfa kapanırken host'ta latch kalmasın.
  // Nötr paket sol kontrole göre merkezden gelir (controlDefs.getNeutralInput).
  _sendNeutralForMode() {
    try {
      for (const neutral of getNeutralInputs(this.gameMode)) {
        if (neutral.action === 'AIM_MOVE' || neutral.action === 'AIM_RELEASE') {
          this._sendAimInput(neutral, { force: true });
        } else {
          this.sendInput(neutral, { force: true });
        }
      }
    } catch {}
  }

  _bindVisibilityNeutral() {
    if (this._visibilityBound) return;
    this._visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.overlay.classList.contains('hidden')) {
        this.requestWakeLock();
      } else if (document.hidden) {
        this._sendNeutralForMode();
      }
    });
    window.addEventListener('pagehide', () => {
      this._sendNeutralForMode();
      this.releaseWakeLock();
    });
    const neutralizeTransientInput = () => {
      if (!this.overlay.classList.contains('hidden')) this._sendNeutralForMode();
    };
    window.addEventListener('blur', neutralizeTransientInput);
    window.addEventListener('orientationchange', () => {
      neutralizeTransientInput();
      setTimeout(() => this._scheduleControllerLayout(), 160);
    });
    window.addEventListener('resize', () => {
      if (this.gameMode !== 'LOBBY') neutralizeTransientInput();
      this._scheduleControllerLayout();
    });
  }

  _bindBrowserLocks() {
    if (this._browserLocksBound) return;
    this._browserLocksBound = true;
    const prevent = (e) => {
      if (!this.overlay.classList.contains('hidden')) {
        e.preventDefault();
      }
    };
    this.overlay.addEventListener('contextmenu', prevent);
    this.overlay.addEventListener('gesturestart', prevent);
    this.overlay.addEventListener('gesturechange', prevent);
    this.overlay.addEventListener('gestureend', prevent);
    const markLocalInput = () => {
      this._lastLocalInputAt = performance.now();
    };
    this.overlay.addEventListener('pointerdown', markLocalInput, { passive: true });
    this.overlay.addEventListener('touchstart', markLocalInput, { passive: true });
    window.addEventListener('keydown', markLocalInput, { passive: true });
    window.addEventListener('blur', () => { this._windowFocused = false; });
    window.addEventListener('focus', () => { this._windowFocused = true; });
  }

  _mountOrientationGate() {
    if (document.getElementById('rotate-gate')) return;
    const gate = document.createElement('div');
    gate.id = 'rotate-gate';
    gate.className = 'rotate-gate';
    gate.setAttribute('role', 'alert');
    gate.setAttribute('aria-live', 'assertive');
    gate.hidden = true;
    gate.innerHTML = `
      <div class="rotate-phone" aria-hidden="true">${getTabletopIconSvg('rotate_cw', { size: 34, color: '#ffd700', strokeWidth: 2.6 })}</div>
      <div class="rotate-copy">
        <div class="rotate-title">${escapeHtml(t('pad.rotateTitle'))}</div>
        <div class="rotate-sub">${escapeHtml(t('pad.rotateSub'))}</div>
      </div>
    `;
    this.overlay.appendChild(gate);
  }

  // Landscape-first geçidi: oyun portrait ise animasyonlu döndür uyarısı basılır.
  // Lobi portrait kalır; sayaç/oyun dışı dokunmaz. iOS lock API yok — telkin edilir.
  _bindOrientationGate() {
    if (this._orientBound) return;
    this._orientBound = true;
    window.addEventListener('resize', () => this._updateOrientationGate());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this._updateOrientationGate(), 150);
    });
  }

  _updateOrientationGate() {
    if (!this.overlay || this.overlay.classList.contains('hidden')) return;
    const portrait = window.innerHeight > window.innerWidth;
    const playing = this.gameMode !== 'LOBBY';
    this.overlay.classList.toggle('is-playing', playing);
    this.overlay.classList.toggle('is-lobby', !playing);
    this.overlay.classList.toggle('is-portrait', portrait);
    this.overlay.classList.toggle('is-landscape', !portrait);
    const gate = this._el('rotate-gate');
    if (gate) gate.hidden = !(playing && portrait);
  }

  initLocal(playerInfo = {}, gameMode = 'PONG') {
    this.localMode = true;
    this.playerIndex = Number.isInteger(playerInfo.slotIndex) ? playerInfo.slotIndex : 0;
    this.playerName = (playerInfo.name || `OYUNCU ${this.playerIndex + 1}`).toUpperCase();
    this.playerColor = playerInfo.color || UI_COLORS.players[this.playerIndex] || '#D84727';
    try {
      this.avatar = playerInfo.avatar || getAvatarProfile();
    } catch {
      this.avatar = playerInfo.avatar || null;
    }
    this.slots = [null, null, null, null];
    this.slots[this.playerIndex] = { ...playerInfo, slotIndex: this.playerIndex };
    this.selectedHostGame = gameMode;
    this.gameMode = gameMode;
    this.isReady = false;
    this.stagingOpen = false;
    this.countdownActive = false;
    this._pongInvertManualSet = false;
    this._worldViewEnabled = false;
    this.overlay.innerHTML = renderLocalGamepadShell(this.selectedHostGame);
    this._workspaceOverride = document.getElementById('local-mobile-workspace');
    this._mountOrientationGate();
    this.overlay.classList.remove('hidden');
    this._bindBrowserLocks();
    this._bindVisibilityNeutral();
    this._bindOrientationGate();
    this._bindLayoutEditorButton();
    this.renderGameController(gameMode);
    this.requestWakeLock();
  }

  init(playerInfo, gameMode = 'LOBBY') {
    this.playerIndex = playerInfo.slotIndex ?? 0;
    if (this._worldView) this._worldView.setSelfSlot(this.playerIndex);
    this.playerName = (playerInfo.name || `OYUNCU ${this.playerIndex + 1}`).toUpperCase();
    this.playerColor = playerInfo.color || UI_COLORS.players[this.playerIndex] || '#D84727';
    try {
      this.avatar = playerInfo.avatar || getAvatarProfile();
    } catch {
      this.avatar = playerInfo.avatar || null;
    }
    this.slots = playerInfo.slots || [null, null, null, null];
    this.selectedHostGame = gameMode === 'LOBBY' ? (playerInfo.gameMode || 'PONG') : gameMode;
    this.gameMode = gameMode || 'LOBBY';
    this.isReady = false;
    this.stagingOpen = false;
    this.countdownActive = false;
    // Reset manual invert flag on fresh join so auto-detection kicks in
    this._pongInvertManualSet = false;

    this._bindBrowserLocks();
    this.renderShell();
    this._bindVisibilityNeutral();
    this._bindOrientationGate();
    this.renderGameController(this.gameMode);
    this.overlay.classList.remove('hidden');
    this.requestWakeLock();
    // Dil değişimi: lobide tam re-render (güvenli), oyunda sadece taktik ipucu
    // tazelenir (dokunmatik mount'a dokunulmaz — girdi kesilmez).
    if (!this._langBound) {
      this._langBound = true;
      onLangChange(() => {
        if (this.overlay.classList.contains('hidden')) return;
        if (this.gameMode === 'LOBBY') {
          this.renderShell();
          this.renderGameController('LOBBY');
        } else {
          this._guideMode = null;
          this.renderControlGuide(this.gameMode);
        }
      });
    }
  }

  hide() {
    this._closeGamepadMenu?.();
    if (this._layoutEditor?.isOpen) this._layoutEditor.close({ save: false });
    else this.setInputBlocked(false);
    if (this.localMode) this._sendNeutralForMode();
    this.physicalGamepad.stop();
    this.releaseWakeLock();
    this._teardownMount();
    this._resultActive = false;
    this._lastScores = null;
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this._workspaceOverride = null;
  }

  renderShell() {
    const seatPositions = ['P1', 'P2', 'P3', 'P4'];
    const seatLabel = seatPositions[this.playerIndex] || `P${this.playerIndex + 1}`;
    const initialGameTag = CONTROLLER_META[this.gameMode]?.hudTag || (this.gameMode === 'LOBBY' ? t('pad.lobbyTag') : this.gameMode);

    this.overlay.innerHTML = renderRemoteGamepadShell({
      seatLabel,
      playerColor: this.playerColor,
      playerName: this.playerName,
      gameTag: initialGameTag,
      roomCode: this.network.roomCode,
      showLayoutEditor: true,
    });

    this._mountOrientationGate();
    this._updateOrientationGate();

    // ── Açılır menü (sağ üst ⋮) — oyun sırasında yanlışlıkla basılmasın ──
    const menuBtn = document.getElementById('btn-gamepad-menu');
    const menuPanel = document.getElementById('gamepad-menu-panel');
    const closeMenu = () => {
      menuPanel?.classList.add('hidden');
      document.removeEventListener('pointerdown', onOutsideMenu, true);
    };
    const onOutsideMenu = (e) => {
      if (!menuPanel?.classList.contains('hidden') && !e.target.closest('#gamepad-menu')) {
        closeMenu();
      }
    };
    menuBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = menuPanel?.classList.contains('hidden');
      menuPanel?.classList.toggle('hidden', !willOpen);
      if (willOpen) {
        document.addEventListener('pointerdown', onOutsideMenu, true);
        this.vibrate(10);
        playMenuTick();
      } else {
        document.removeEventListener('pointerdown', onOutsideMenu, true);
      }
    });
    this._closeGamepadMenu = closeMenu;

    document.getElementById('btn-leave-gamepad')?.addEventListener('click', () => {
      closeMenu();
      this.network.disconnect();
      this.hide();
      window.location.href = window.location.pathname;
    });

    document.getElementById('btn-fullscreen-toggle')?.addEventListener('click', () => {
      closeMenu();
      this.toggleFullscreen();
    });

    const emojiModal = document.getElementById('emoji-wheel-modal');
    document.getElementById('btn-toggle-emoji')?.addEventListener('click', () => {
      closeMenu();
      this.isEmojiOpen = !this.isEmojiOpen;
      emojiModal?.classList.toggle('hidden', !this.isEmojiOpen);
    });

    emojiModal?.querySelectorAll('.emoji-wheel-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const emoji = e.currentTarget.dataset.emoji;
        this.network.sendReaction(emoji);
        this.isEmojiOpen = false;
        emojiModal?.classList.add('hidden');
        this.vibrate(20);
        playMenuPop();
      });
    });

    this._bindLayoutEditorButton();
  }

  toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    } catch {}
  }

  updateSlot(newSlot, newColor) {
    this.playerIndex = newSlot;
    if (newColor) this.playerColor = newColor;
    // Reset manual invert so new seat's auto-direction is applied
    this._pongInvertManualSet = false;

    const label = document.getElementById('header-player-name');
    const seatTag = document.getElementById('header-seat-tag');
    const seatPositions = ['P1', 'P2', 'P3', 'P4'];

    if (label) label.textContent = this.playerName;
    if (seatTag) {
      seatTag.textContent = seatPositions[this.playerIndex] || `P${this.playerIndex + 1}`;
      seatTag.style.backgroundColor = this.playerColor;
    }

    // Sayaç sırasında workspace'i bozma (sayaç ekranı korunur)
    if (this.countdownActive) return;
    // Re-render current controller to update player colors/axis
    this.renderGameController(this.gameMode);
  }

  updateSlots(slots, reservedHostSlot = this.network.reservedHostSlot) {
    const prev = this.slots;
    this.slots = slots || [null, null, null, null];
    const hostIndex = this.slots.findIndex((slot) => slot?.isHost);
    this.network.reservedHostSlot = Number.isInteger(reservedHostSlot)
      ? reservedHostSlot
      : (hostIndex >= 0 ? hostIndex : null);
    this._worldView?.setSlots(this.slots);
    // Kim geldi/gitti telefonlarda da görünsün (ilk tablo sessiz; bot ve isim değişimi sessiz)
    if (prev) {
      for (let i = 0; i < 4; i++) {
        const oldName = prev[i]?.kind === 'bot' ? null : prev[i]?.name || null;
        const newName = this.slots[i]?.kind === 'bot' ? null : this.slots[i]?.name || null;
        if (!oldName && newName && newName !== this.playerName) {
          showInstallToast(t('pad.joined', newName), 'gamepad_2');
        } else if (oldName && !newName && oldName !== this.playerName) {
          showInstallToast(t('pad.left', oldName), 'door_closed');
        }
      }
    }
    if (this.gameMode === 'LOBBY') {
      this.refreshLobbySeats();
    }
  }

  // İsimli skor şeridi (sub-HUD): koltuk rengi + isim + skor. PONG hariç tüm
  // oyun modlarında görünür (PONG'un kendi canlı skorbord'u isim alır).
  renderScoreStrip(names, scores) {
    const strip = this._el('score-strip');
    if (!strip) return;
    if (this.gameMode === 'LOBBY' || !Array.isArray(names) || !Array.isArray(scores)) {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      this._lastStripJson = '';
      return;
    }
    if (this.gameMode === 'PONG') {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      this._lastStripJson = '';
      return;
    }
    // Skor/isim/renk değişmediyse innerHTML'i yeniden kurma (8Hz layout/GC titremesi)
    const slotColorsSig = (this.slots || []).map((s) => s?.color || '').join('|');
    const sig = JSON.stringify([names, scores, this.playerIndex, slotColorsSig]);
    if (sig === this._lastStripJson) {
      strip.classList.remove('hidden');
      return;
    }
    this._lastStripJson = sig;
    const fallbackColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    strip.innerHTML = [0, 1, 2, 3].map((idx) => {
      const name = names[idx];
      const isEmpty = !name;
      const isMine = idx === this.playerIndex;
      const dotColor = this.slots?.[idx]?.color || fallbackColors[idx];
      return `
        <div class="score-chip${isMine ? ' is-mine' : ''}${isEmpty ? ' is-empty' : ''}">
          <span class="score-dot" style="background-color: ${dotColor}"></span>
          <span class="score-name">${isEmpty ? t('pad.empty') : escapeHtml(name)}</span>
          <span class="score-val">${scores[idx] ?? 0}</span>
        </div>
      `;
    }).join('');
    strip.classList.remove('hidden');
  }

  // İki kademeli başlatma: koltuk seçimi lobi açılışında hazırdır;
  // STAGING aynı lobi görünümünü yeniler ve ready aşamasını açar. RETURNED_TO_LOBBY
  // kaçırılsa bile kumanda eski oyun ekranında ölü takılmaz.
  enterStaging(gameMode) {
    this.stagingOpen = true;
    this.countdownActive = false;
    this._countdownT = null;
    if (gameMode) this.selectedHostGame = gameMode;
    this.renderGameController('LOBBY');
  }

  // Geri sayım tik'i: koltuklar kilitlenir, sayaç ekranı basılır
  showCountdown(t) {
    this.countdownActive = true;
    this._countdownT = t;
    const workspace = document.getElementById('gamepad-workspace');
    if (!workspace) return;
    workspace.innerHTML = `
      <div class="countdown-view">
        <div class="countdown-badge">${tIcon('pad.countBadge')}</div>
        <div class="countdown-number">${t > 0 ? t : t('pad.go')}</div>
        <div class="countdown-sub">${t('pad.countSub')}</div>
      </div>
    `;
    this.vibrate(t > 0 ? 40 : [40, 60, 80]);
  }

  // Staging/sayaç durumunu sıfırla (oyun başladı veya lobiye dönüldü)
  exitStaging() {
    this.stagingOpen = false;
    this.countdownActive = false;
    this._countdownT = null;
  }

  renderControlGuide(mode) {
    const guideMode = mode === 'LOBBY' ? this.selectedHostGame : mode;
    const meta = CONTROLLER_META[guideMode] || null;
    const guideEl = this._el('gamepad-control-guide');
    const roleEl = this._el('tactical-role-text');
    const guide = getControllerGuide(guideMode, meta?.schema);
    const modeChanged = this._guideMode !== guideMode;
    this._guideMode = guideMode;

    if (roleEl) {
      const hint = meta?.tacticalHint || '';
      if (hint && (modeChanged || !roleEl.textContent)) {
        roleEl.textContent = hint;
        roleEl.style.color = '';
      }
    }

    if (!guide || !guideEl) {
      guideEl?.setAttribute('hidden', '');
      return;
    }

    const actionHtml = guide.actions.length
      ? guide.actions.map((action) => `<span class="guide-action">${escapeHtml(action.label)}</span>`).join('<span class="guide-separator">•</span>')
      : '';
    guideEl.innerHTML = `
      <span class="guide-title">${escapeHtml(t('pad.guideTitle'))}</span>
      <span class="guide-left">${escapeHtml(guide.left.label)}</span>
      ${guide.aim ? `<span class="guide-aim">${escapeHtml(t('pad.guideAim'))}</span>` : ''}
      <span class="guide-hint">${escapeHtml(guide.hint)}</span>
      ${actionHtml}
    `;
    guideEl.removeAttribute('hidden');
  }

  _startPhysicalGamepad() {
    if (this.gameMode === 'LOBBY') {
      this.physicalGamepad.stop();
      return;
    }
    this.physicalGamepad.start();
  }

  renderGameController(mode) {
    // Eski mount sökülmeden önce: takılı joystick/sürüş varsa host'a nötr paket
    // (zone innerHTML ile gidince endJoy hiç çalışmıyordu → hayalet girdi)
    this._sendNeutralForMode();
    this.physicalGamepad.stop();
    this.inputAdapter.reset();
    this._teardownMount();
    this._mountAbort = new AbortController();
    this._elCache.clear();
    this._lastStripJson = '';
    this._lastStatusStr = '';
    this._lastScores = null;
    this._resultActive = false;
    this._cloneCdBtn = null;
    this.gameMode = mode;
    this._startPhysicalGamepad();
    const workspace = this._workspaceOverride || document.getElementById('gamepad-workspace');
    if (!workspace) return;

    workspace.innerHTML = '';

    const modeTag = document.getElementById('hud-game-tag');
    if (modeTag) {
      modeTag.textContent = CONTROLLER_META[mode]?.hudTag || (mode === 'LOBBY' ? t('pad.lobbyTag') : mode);
    }

    if (mode === 'LOBBY') {
      document.getElementById('score-strip')?.classList.add('hidden');
      this.mountLobbyController(workspace);
      this._bindLayoutEditorButton();
    } else {
      const meta = CONTROLLER_META[mode] || {};
      const hasWorldView = !!meta.worldView && this.network.supportsWorldFrames === true;
      if (hasWorldView) {
        this._worldViewEnabled = true;
        workspace.innerHTML = `
          <div class="gamepad-game-stage has-world-view">
            <canvas class="gamepad-world-canvas" id="gamepad-world-canvas" role="img" aria-label="Oyun alanı"></canvas>
            <div class="gamepad-control-overlay" id="gamepad-game-mount"></div>
          </div>
        `;
        this._mountWorldView(document.getElementById('gamepad-world-canvas'), meta.worldView);
      } else {
        workspace.innerHTML = `
          <div class="gamepad-game-mount" id="gamepad-game-mount"></div>
        `;
      }
      const mountTarget = document.getElementById('gamepad-game-mount') || workspace;
      if (meta.schema) {
        this._activeController = mountDeclarativeController(this, mountTarget, meta.schema);
      } else {
        console.warn(`[GamepadManager] No controller schema defined for mode: ${mode}`);
      }
      this._setActiveLayoutRoot(mountTarget);
    }
    this.renderControlGuide(mode);
    this._updateOrientationGate();
    this._applyControllerLayout(this._layoutPreview || this.getControllerLayout());
    this._layoutEditor?.refresh?.();
  }

  // Koltuk kartı: kocaman numara + koltuk rengi + isim/BOŞ.
  // Numara + renk TV ile birebir eşleşir (P1 kırmızı, P2 mavi, P3 sarı, P4 yeşil);
  // yan etiketler bilerek yok (sadece PONG'da doğruydu, köşeli oyunlarda yanıltıcıydı).
  renderSeatButtonHtml(idx) {
    const fallbackColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const isMine = idx === this.playerIndex;
    const slotData = this.slots ? this.slots[idx] : null;
    const seatColors = [0, 1, 2, 3].map((i) => this.slots?.[i]?.color || fallbackColors[i]);
    const isReserved = !isMine && (
      this.network.reservedHostSlot === idx || slotData?.isHost === true
    );
    const isBot = !isMine && (slotData?.kind === 'bot' || slotData?.kind === 'bot_god' || slotData?.isBot === true);
    const isOccupied = !isMine && !isBot && !isReserved && slotData !== null && !!slotData.name;
    const occupantName = isMine ? this.playerName : (isOccupied || isBot ? slotData.name : '');

    let statusText = '';
    let actionText = '';
    let btnClass = 'lobby-seat-btn';

    if (isMine) {
      btnClass += ' active is-mine';
      statusText = t('pad.you');
      actionText = t('pad.yourSeat');
    } else if (isReserved) {
      btnClass += ' is-reserved';
      statusText = `P${idx + 1} · ${t('pad.hostSeat')}`;
      actionText = t('pad.hostSeat');
    } else if (isBot) {
      btnClass += ' is-bot';
      statusText = t('pad.botSeat');
      actionText = t('pad.botSeat');
    } else if (isOccupied) {
      btnClass += ' is-occupied';
      statusText = occupantName;
      actionText = t('pad.moveHere');
    } else {
      btnClass += ' is-empty';
      statusText = t('pad.empty');
      actionText = t('pad.moveHere');
    }

    const canTarget = !isMine && !isReserved && !isBot && !this.countdownActive;
    const ariaLabel = isMine
      ? t('pad.seatMine', idx + 1)
      : isReserved
        ? t('pad.seatReserved', idx + 1)
        : isBot
          ? t('pad.seatBot', idx + 1)
          : t('pad.seatTarget', idx + 1, statusText);

    return `
      <button class="${btnClass}" data-seat="${idx}" type="button" aria-label="${escapeHtml(ariaLabel)}"${canTarget ? '' : ' disabled'}>
        <span class="seat-num" style="color: ${seatColors[idx]}">${idx + 1}</span>
        <span class="seat-status">${escapeHtml(statusText)}</span>
        <span class="seat-action">${escapeHtml(actionText)}</span>
      </button>
    `;
  }

  refreshLobbySeats() {
    const grid = this.overlay.querySelector('.lobby-seats-grid');
    if (!grid) return;
    grid.innerHTML = [0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('');
    grid.querySelectorAll('.lobby-seat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const targetSlot = parseInt(btn.dataset.seat, 10);
        if (!this.canSwitchSlot(targetSlot)) return;
        this.sendInput({ action: 'SWITCH_SLOT', targetSlot });
        this.vibrate(30);
        playMenuTick();
      });
    });
  }

  // Lobi karakter önizlemesi (kendi cihaz profili, yazısız)
  drawLobbyCharacterPreview() {
    const canvas = document.getElementById('lobby-character-preview');
    if (!canvas) return;
    try {
      if (!this.avatar) this.avatar = getAvatarProfile();
    } catch { return; }
    try {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBrutalAvatar(ctx, canvas.width / 2, canvas.height / 2, 20, {
        color: this.avatar.color,
        expression: this.avatar.expression,
        showPips: false,
        showPointer: false,
        borderWidth: 2.5,
        shadowOffset: 2,
      });
    } catch {}
  }

  // Hazır bayrağını sıfırla (lobiye dönüşte / yeni oyunda takılı kalmasın).
  // Host tarafı zaten sıfırlar; ekstra trafik yok.
  resetReady() {
    this.isReady = false;
    const readyBtn = document.getElementById('btn-lobby-ready');
    if (readyBtn) {
      readyBtn.classList.remove('ready');
      readyBtn.textContent = t('pad.ready');
    }
  }

  // --- 00: LOBBY CONTROLLER (Seat Selector, Profile Card, Game Preview, Ready Toggle, Leave Room) ---
  mountLobbyController(container) {
    const selectedTitle = CONTROLLER_META[this.selectedHostGame]?.lobbyTitle || 'BRUTAL PONG';

    container.innerHTML = `
      <div class="lobby-controller-view">
        <!-- 1. Unified Player Profile Card -->
        <div class="lobby-profile-card">
          <canvas class="lobby-character-preview" id="lobby-character-preview" width="52" height="52"></canvas>
          <div class="lobby-profile-info">
            <div class="lobby-profile-row">
              <span class="player-slot-chip" id="lobby-slot-tag" style="background-color: ${this.playerColor}">P${this.playerIndex + 1}</span>
              <span class="lobby-profile-name" id="lobby-name-display">${this.playerName}</span>
            </div>
            <span class="lobby-profile-hint">${t('pad.charHint')}</span>
          </div>
          <button class="lobby-profile-edit-btn" id="btn-edit-character" type="button">${getTabletopIconSvg('pencil', { size: 15, color: '#141416', strokeWidth: 2.3 })}<span>${tIcon('pad.customize')}</span></button>
        <button class="lobby-layout-btn" data-controller-layout-open type="button" data-i18n-aria="controllerLayout.open" aria-label="${escapeHtml(t('controllerLayout.open'))}" title="${escapeHtml(t('controllerLayout.open'))}">${getTabletopIconSvg('settings', { size: 16, color: '#141414', strokeWidth: 2.3 })}<span>${escapeHtml(t('controllerLayout.lobbyShort'))}</span></button>
        </div>

        <!-- 2. Selected Game Preview Pill -->
        <div class="lobby-game-chip-bar">
          <img src="/assets/games/${(this.selectedHostGame || 'PONG').toLowerCase()}.jpg" class="lobby-game-thumb-preview" alt="${escapeHtml(selectedTitle)}" onerror="this.style.display='none'" />
          <div class="lobby-game-chip-info">
            <span class="lobby-game-label">${t('pad.game')}</span>
            <span class="lobby-game-title" id="lobby-selected-game-text">${selectedTitle}</span>
          </div>
        </div>

        <!-- 3. Seat Picker: lobi açılır açılmaz hedef koltuğa dokunulabilir. -->
        <div class="lobby-seats-card">
          <div class="lobby-seat-badge">${this.stagingOpen ? tIcon('pad.seatPick') : tIcon('pad.seatPickEarly')}</div>
          <div class="lobby-seat-hint" aria-live="polite">${this.stagingOpen ? t('pad.seatHint') : t('pad.seatHintEarly')}</div>
          <div class="lobby-seats-grid">
            ${[0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('')}
          </div>
        </div>

        ${!this.stagingOpen ? `
        <div class="lobby-wait-card">
          <div class="lobby-wait-badge">${t('pad.arenaPrep')}</div>
          <div class="lobby-wait-text">${t('pad.arenaPrepText')}</div>
        </div>
        ` : ''}

        <!-- 4. Hero Ready Button -->
        ${this.stagingOpen ? `
        <button class="btn-ready-toggle ${this.isReady ? 'ready' : ''}" id="btn-lobby-ready" type="button">
          ${this.isReady ? getTabletopIconSvg('check', { size: 17, color: 'currentColor', strokeWidth: 2.8 }) : getTabletopIconSvg('play', { size: 15, color: 'currentColor', strokeWidth: 2.6 })}<span>${t('pad.ready')}</span>
        </button>
        ` : ''}

        <!-- 5. Leave button -->
        <button class="btn-leave-lobby-direct" id="btn-leave-lobby-direct" type="button">
          ${tIcon('pad.leaveRoom')}
        </button>
      </div>
    `;

    // Seat switch click handlers
    container.querySelectorAll('.lobby-seat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const targetSlot = parseInt(btn.dataset.seat, 10);
        if (!this.canSwitchSlot(targetSlot)) return;
        this.sendInput({ action: 'SWITCH_SLOT', targetSlot });
        this.vibrate(30);
        playMenuTick();
      });
    });

    // Leave room direct button
    document.getElementById('btn-leave-lobby-direct')?.addEventListener('click', () => {
      this.network.disconnect();
      this.hide();
      window.location.href = window.location.pathname;
    });

    // Karakter önizleme + özelleştirme (isim dahil tek modal)
    this.drawLobbyCharacterPreview();
    document.getElementById('btn-edit-character')?.addEventListener('click', () => {
      let before = '';
      try {
        if (!this.avatar) this.avatar = getAvatarProfile();
        before = JSON.stringify(this.avatar);
      } catch {}
      openCustomizeModal((profile) => {
        if (!profile) return;
        if (JSON.stringify(profile) === before) return;
        this.avatar = { ...profile };
        this.playerColor = profile.color || this.playerColor;
        const dot = document.getElementById('header-player-dot');
        if (dot) dot.style.backgroundColor = this.playerColor;
        const seatTag = document.getElementById('header-seat-tag');
        if (seatTag) seatTag.style.backgroundColor = this.playerColor;
        const lobbySlotTag = document.getElementById('lobby-slot-tag');
        if (lobbySlotTag) lobbySlotTag.style.backgroundColor = this.playerColor;
        this.drawLobbyCharacterPreview();
        try {
          this.network.sendAvatarUpdate?.(this.avatar);
        } catch {}
        showInstallToast(t('pad.avatarShared'), 'check');
        this.vibrate(15);
        playMenuTick();
      });
    });

    const readyBtn = document.getElementById('btn-lobby-ready');
    readyBtn?.addEventListener('click', () => {
      this.isReady = !this.isReady;
      // Yazı sabit "HAZIRIM": durum renkle belli olur (sönük → yeşil)
      readyBtn.classList.toggle('ready', this.isReady);
      this.network.setReady(this.isReady);
      this.vibrate(this.isReady ? [20, 30] : 15);
      playMenuTick();
    });

    // Leave room (çift-bas onay)
    const leaveBtn = document.getElementById('btn-leave-lobby-direct');
    let leaveArmedTimer = null;
    leaveBtn?.addEventListener('click', () => {
      if (!leaveBtn.dataset.armed) {
        leaveBtn.dataset.armed = '1';
        leaveBtn.textContent = t('pad.leaveArmed');
        leaveArmedTimer = window.setTimeout(() => {
          delete leaveBtn.dataset.armed;
          leaveBtn.innerHTML = tIcon('pad.leaveRoom');
        }, 3000);
        return;
      }
      window.clearTimeout(leaveArmedTimer);
      this.network.disconnect();
      this.hide();
      window.location.href = window.location.pathname;
    });
  }

  // Floating Dynamic Joystick Helper (Center-on-touch, no fixed center)
  bindJoystick(zoneId, knobId, onInput, { onPress, onRelease } = {}) {
    const zone = document.getElementById(zoneId);
    const knob = document.getElementById(knobId);
    if (!zone || !knob) return;
    const baseEl = knob.parentElement;

    let lastInput = { dx: 0, dy: 0, angle: 0, force: 0 };
    const emitInput = (input) => {
      lastInput = { ...input };
      onInput(input);
    };
    let activeTouchId = null;
    let activePointerId = null;
    let isMouseDown = false;
    const pointerMode = typeof window !== 'undefined' && 'PointerEvent' in window;
    let originX = 0;
    let originY = 0;
    let maxRadius = 46;
    let hitEdge = false;

    const startAt = (clientX, clientY) => {
      const zoneRect = zone.getBoundingClientRect();
      originX = clientX;
      originY = clientY;
      maxRadius = Math.min(52, Math.max(38, zoneRect.width * 0.22));
      hitEdge = false;

      if (baseEl) {
        const relX = clientX - zoneRect.left;
        const relY = clientY - zoneRect.top;
        baseEl.classList.add('floating');
        baseEl.style.left = `${relX}px`;
        baseEl.style.top = `${relY}px`;
      }
      this.vibrate(10);
      playMenuTick();
      this.updateJoy(clientX, clientY, originX, originY, maxRadius, knob, emitInput);
      onPress?.({ ...lastInput });
    };

    const moveAt = (clientX, clientY) => {
      const reachedMax = this.updateJoy(clientX, clientY, originX, originY, maxRadius, knob, emitInput);
      if (reachedMax && !hitEdge) {
        hitEdge = true;
        this.vibrate(8);
      } else if (!reachedMax && hitEdge) {
        hitEdge = false;
      }
    };

    const endJoy = (cancelled = false) => {
      const finalInput = { ...lastInput };
      activeTouchId = null;
      activePointerId = null;
      isMouseDown = false;
      hitEdge = false;
      knob.style.transform = 'translate(0px, 0px)';
      if (baseEl) {
        baseEl.classList.remove('floating');
        baseEl.style.left = '';
        baseEl.style.top = '';
      }
      if (onRelease) {
        // Optional release callback is used by legacy hold controls; ordinary
        // movement joysticks send a zero vector below.
        onRelease(finalInput, { cancelled });
      } else {
        // Move joystick: zero packet needed to stop movement.
        emitInput({ dx: 0, dy: 0, angle: 0, force: 0 });
      }
    };

    const joySignal = this._mountAbort?.signal;
    const hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

    if (hasTouch) {
      // Touch-first: Mobil tarayıcılarda (iOS Safari, Android Chrome) dokunmatik takibini
      // Touch Events API ile doğrudan ve kesintisiz yürütür. Pointer capture düşmesi
      // veya sahte lostpointercapture kopmaları tamamen engellenir.
      zone.addEventListener('touchstart', (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        e.preventDefault();
        // Önceki dokunuş kapatılmadan yeni basış geldiyse güvenle devret
        if (activeTouchId !== null) {
          endJoy(false);
        }
        activeTouchId = touch.identifier;
        startAt(touch.clientX, touch.clientY);
      }, { passive: false });

      window.addEventListener('touchmove', (e) => {
        if (activeTouchId === null) return;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const touch = e.changedTouches[i];
          if (touch.identifier === activeTouchId) {
            e.preventDefault();
            moveAt(touch.clientX, touch.clientY);
            break;
          }
        }
      }, { passive: false, signal: joySignal });

      const onTouchEnd = (e, cancelled = false) => {
        if (activeTouchId === null) return;
        let matched = false;
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === activeTouchId) {
            matched = true;
            break;
          }
        }
        if (matched || (e.touches && e.touches.length === 0)) {
          endJoy(cancelled);
        }
      };
      window.addEventListener('touchend', (e) => onTouchEnd(e, false), { passive: true, signal: joySignal });
      window.addEventListener('touchcancel', (e) => onTouchEnd(e, true), { passive: true, signal: joySignal });
    } else {
      // Desktop / Mouse fallback (PC testleri için)
      zone.addEventListener('pointerdown', (e) => {
        if (activePointerId !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
        e.preventDefault();
        activePointerId = e.pointerId;
        startAt(e.clientX, e.clientY);
      }, { passive: false });

      window.addEventListener('pointermove', (e) => {
        if (e.pointerId !== activePointerId) return;
        e.preventDefault();
        moveAt(e.clientX, e.clientY);
      }, { passive: false, signal: joySignal });

      const onPointerEnd = (e, cancelled = false) => {
        if (e.pointerId !== activePointerId) return;
        activePointerId = null;
        endJoy(cancelled);
      };
      window.addEventListener('pointerup', (e) => onPointerEnd(e, false), { passive: true, signal: joySignal });
      window.addEventListener('pointercancel', (e) => onPointerEnd(e, true), { passive: true, signal: joySignal });
    }
  }

  updateJoy(clientX, clientY, cx, cy, maxR, knobEl, onInput) {
    const rawDx = clientX - cx;
    const rawDy = clientY - cy;
    const dist = Math.hypot(rawDx, rawDy);
    const clampedDist = Math.min(maxR, dist);
    const angle = Math.atan2(rawDy, rawDx);

    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    knobEl.style.transform = `translate(${knobX}px, ${knobY}px) rotate(${angle + Math.PI / 2}rad)`;

    const rawForce = clampedDist / maxR;
    // 8% deadband to eliminate resting thumb jitter
    const deadzone = 0.08;
    const force = rawForce < deadzone ? 0 : Math.max(0, Math.min(1, (rawForce - deadzone) / (1 - deadzone)));
    const dx = Math.max(-1, Math.min(1, Math.cos(angle) * force));
    const dy = Math.max(-1, Math.min(1, Math.sin(angle) * force));

    onInput({
      dx,
      dy,
      angle,
      force,
    });

    return rawForce >= 0.98;
  }

  handleWorldFrame(frame) {
    if (!this._worldViewEnabled) return;
    if (this._worldView) {
      this._worldView.accept(frame);
    } else {
      this._pendingWorldFrame = frame;
    }
  }

  // Faz 2.2 — kill-feed: skor artışını sağ üstte toast olarak bildirir.
  // Client tarafı türetme (protokol değiştirmez): 8Hz scores farkından çıkar.
  _pushKillFeedFromScores(data) {
    if (this.gameMode === 'LOBBY' || this._resultActive) return;
    const scores = Array.isArray(data.scores) ? data.scores : null;
    if (!scores) return;
    const prev = this._lastScores;
    this._lastScores = scores.slice();
    if (!prev) return;
    const names = Array.isArray(data.names) ? data.names : [];
    const colors = Array.isArray(data.colors) ? data.colors : [];
    for (let i = 0; i < 4; i++) {
      const gained = (Number(scores[i]) || 0) - (Number(prev[i]) || 0);
      if (gained > 0) {
        this._pushKillFeed({
          name: names[i] || this.slots[i]?.name || `P${i + 1}`,
          color: colors[i] || this.slots[i]?.color || UI_COLORS.players[i] || '#6e6357',
          gained,
        });
      }
    }
  }

  _pushKillFeed(entry) {
    const feed = this._el('gamepad-killfeed');
    if (!feed) return;
    if (feed.childElementCount >= 4) feed.firstElementChild?.remove();
    const toast = document.createElement('div');
    toast.className = 'killfeed-toast';
    toast.innerHTML = `<span class="kf-swatch" style="background-color: ${entry.color}"></span><span>${escapeHtml(entry.name)} +${entry.gained}</span>`;
    feed.appendChild(toast);
    playMenuTick();
    window.setTimeout(() => {
      if (toast.isConnected) toast.remove();
    }, 2400);
  }

  // Faz 2.4 — tam ekran sonuç. LOCAL'de authoritative state sinyaliyle açılır;
  // uzak kumanda world-view banner'ını korur (host yetkisi).
  _syncMatchResult(data) {
    const el = this._el('gamepad-result');
    if (!el) return;
    if (this.localMode && data.state === 'MATCH_OVER') {
      this._showMatchResult(data);
    } else if (this._resultActive) {
      this._hideMatchResult();
    }
  }

  _showMatchResult(data) {
    if (this._resultActive) return;
    this._resultActive = true;
    this._sendNeutralForMode();
    const el = this._el('gamepad-result');
    if (!el) return;
    const names = Array.isArray(data.names) ? data.names : [];
    const colors = Array.isArray(data.colors) ? data.colors : [];
    const scores = (Array.isArray(data.scores) ? data.scores : [0, 0, 0, 0]).map((s) => Number(s) || 0);
    const winner = data.winner && Number.isInteger(data.winner.index) ? data.winner : null;
    const mvpIdx = winner ? winner.index : scores.reduce((best, s, i) => (s > (scores[best] ?? -1) ? i : best), 0);
    const mvpName = winner ? (winner.name || names[mvpIdx] || `P${mvpIdx + 1}`) : (names[mvpIdx] || `P${mvpIdx + 1}`);
    const mvpColor = winner ? (winner.color || colors[mvpIdx] || UI_COLORS.players[mvpIdx] || '#ffb020') : (colors[mvpIdx] || UI_COLORS.players[mvpIdx] || '#ffb020');
    const rows = scores
      .map((score, i) => ({
        i,
        score,
        name: names[i] || this.slots[i]?.name || `P${i + 1}`,
        color: colors[i] || this.slots[i]?.color || UI_COLORS.players[i] || '#6e6357',
      }))
      .sort((a, b) => b.score - a.score || a.i - b.i);

    el.innerHTML = `
      <div class="confetti-burst" aria-hidden="true"></div>
      <div class="result-headline">${t('pad.resultTitle')}</div>
      <div class="result-sub">${t('pad.resultSub')}</div>
      <div class="result-mvp">
        <span class="result-mvp-dot" style="background-color: ${mvpColor}"></span>
        <span>${escapeHtml(mvpName)}</span>
      </div>
      <div class="result-table">
        ${rows.map((r, rank) => `
          <div class="result-row">
            <span class="result-row-dot" style="background-color: ${r.color}"></span>
            <span class="result-row-name">${rank + 1}. ${escapeHtml(r.name)}</span>
            <span class="result-row-score">${r.score}</span>
          </div>`).join('')}
      </div>
      <div class="result-actions">
        <button class="result-btn result-btn-replay" id="btn-result-replay" type="button">${getTabletopIconSvg('rotate_cw', { size: 20, color: '#241c15', strokeWidth: 2.6 })} ${t('pad.replay')}</button>
        <button class="result-btn result-btn-lobby" id="btn-result-lobby" type="button">${getTabletopIconSvg('log_out', { size: 20, color: '#241c15', strokeWidth: 2.6 })} ${t('pad.toLobby')}</button>
      </div>
    `;

    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
    el.querySelector('#btn-result-replay')?.addEventListener('click', () => this._onResultAction('replay'));
    el.querySelector('#btn-result-lobby')?.addEventListener('click', () => this._onResultAction('lobby'));
    this._spawnConfetti(el.querySelector('.confetti-burst'));

    requestAnimationFrame(() => {
      el.classList.add('reveal');
      el.setAttribute('aria-hidden', 'false');
    });
    playMenuPop();
  }

  _hideMatchResult() {
    this._resultActive = false;
    const el = this._el('gamepad-result');
    if (!el) return;
    el.classList.remove('reveal');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = '';
  }

  _onResultAction(action) {
    playMenuPop();
    if (typeof this.onLocalResultAction === 'function') {
      this.onLocalResultAction(action);
    }
  }

  _spawnConfetti(root) {
    if (!root || motionScale() === 0) return;
    const palette = ['c0', 'c1', 'c2', 'c3', 'c4'];
    const count = 44;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = `confetti-piece ${palette[i % palette.length]}`;
      p.style.setProperty('--confetti-x', `${Math.round(Math.random() * 220 - 110)}px`);
      p.style.setProperty('--confetti-t', `${(2.1 + Math.random() * 1.6).toFixed(2)}s`);
      p.style.setProperty('--confetti-d', `${(Math.random() * 1.1).toFixed(2)}s`);
      p.style.setProperty('--confetti-r', `${Math.round(360 + Math.random() * 540)}deg`);
      p.style.left = `${Math.max(2, Math.min(96, (i / count) * 100 + (Math.random() * 14 - 7)))}%`;
      root.appendChild(p);
    }
  }

  // Handle live state sync broadcasts from Host
  handleStateSync(data) {
    if (!data) return;

    // Faz uzlaşması: tek-atışlık mesajları (STAGING/COUNTDOWN/GAME_STARTED/LOBBY)
    // kaçıran kumanda periyodik paketten kendini toparlar. Normal akışta no-op'tur.
    const phase = data.phase;
    if (phase === 'GAME' && data.gameMode && data.gameMode !== 'MENU'
        && (this.gameMode === 'LOBBY' || this.countdownActive)) {
      this.exitStaging();
      this.resetReady();
      this.renderGameController(data.gameMode);
      showInstallToast(t('pad.joinedGame', data.gameMode), 'play');
    } else if (phase === 'STAGING' && data.gameMode
        && (!this.stagingOpen || this.gameMode !== 'LOBBY')) {
      this.enterStaging(data.gameMode);
    } else if (phase === 'COUNTDOWN' && typeof data.t === 'number') {
      if (!this.countdownActive || this._countdownT !== data.t) {
        this.showCountdown(data.t);
      }
    } else if (phase === 'LOBBY' && this.gameMode !== 'LOBBY') {
      this.exitStaging();
      this.resetReady();
      this.renderGameController('LOBBY');
    }

    // Switch controller view if host changed game
    if (data.gameMode && data.gameMode !== this.gameMode && this.gameMode !== 'LOBBY') {
      this.renderGameController(data.gameMode);
    }

    if (this._activeController?.handleSync) {
      try { this._activeController.handleSync(data); } catch {}
    }

    const modeTag = this._el('hud-game-tag');
    const liveStatus = this._el('hud-live-status');

    if (modeTag && data.gameMode) {
      const tag = data.gameMode === 'LOBBY'
        ? t('pad.lobbyTag')
        : (CONTROLLER_META[data.gameMode]?.hudTag || data.gameMode);
      if (modeTag.textContent !== tag) modeTag.textContent = tag;
    }

    // İsimli skor şeridi (PONG kendi skorbord'unu kullanır, diğer modlar şeridi)
    if (data.scores) {
      this.renderScoreStrip(data.names, data.scores);
    }

    // Üst durum şeridi: metin tek kaynaktan (controllerStatus registry).
    // PONG skorbord/falso, TANKS cephane, BOMB/CROWN/HEIST uyarıları şablonların
    // handleSync/onSync'inde yaşar — burada oyun-özel dal tutulmaz.
    if (liveStatus) {
      const statusStr = data.scores
        ? getControllerStatus(data.gameMode, this.playerIndex, data)
        : '';
      if (statusStr !== this._lastStatusStr) {
        this._lastStatusStr = statusStr;
        liveStatus.innerHTML = statusStr;
        liveStatus.title = statusStr.replace(/<[^>]*>/g, '');
      }
    }

    // Faz 2.2: üst HUD şeridi yalnız oyun oynanırken görünür (lobi/sayaç/sonuç
    // kapalı). Uzak pakette `state` yoksa GAME fazı oynama kabul edilir.
    const hud = this._el('gamepad-hud');
    if (hud) {
      const quiet = ['LOBBY', 'STAGING', 'COUNTDOWN', 'MATCH_OVER'];
      const inPlay = phase === 'GAME' && (!data.state || !quiet.includes(data.state));
      hud.classList.toggle('reveal', inPlay);
    }

    // Faz 2.4: LOCAL authoritative state sinyaliyle sonuç ekranı açılır/kapanır.
    this._syncMatchResult(data);

    // Faz 2.2: skor artışlarını sağ üst kill-feed toast'larına çevir.
    this._pushKillFeedFromScores(data);
  }
}
