// Specialized Gamepad Controller for Mobile Phones in TV/Console & Online Mode
// Adapts dynamically to Lobby, Pong, Tanks, Curve, Bomb, Heist, and Archery with ultra-low latency inputs.

import { storePlayerName, escapeHtml } from './net.js';
import { showInstallToast } from './ui/toast.js';
import { initErrorReporter, reportError } from './core/errorReporter.js';
import { toggleFullscreen, canToggleFullscreen } from './ui/fullscreen.js';
import { UI_COLORS } from './ui/tokens.js';
import { scoreEntries } from './ui/scoreModel.js';
import { motionScale } from './ui/motion.js';
import { playMenuTick, playMenuPop } from './audio.js';
import { mountDeclarativeController } from './controllers/controllerTemplates.js';
import { GamepadInputAdapter, ANALOG_THROTTLE_MS } from './controllers/gamepadInputAdapter.js';
import { getNeutralInputs, CONTROL_KEEPALIVE_MS } from './controllers/controlDefs.js';
import { getControllerStatus } from './controllers/controllerStatus.js';
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
import { fxHaptic, fxPadFeedback } from './core/fxKit.js';
import { fieldTheme } from './core/fieldKit.js';
import { createFxEventFilter } from './core/networkProtocol.js';
import { renderLocalGamepadShell, renderRemoteGamepadShell } from './ui/gamepadShell.js';
import { openControllerLayoutEditor } from './ui/controllerLayoutEditor.js';
import { ensureReactionTriggers, setReactionSender } from './ui/reactionPicker.js';
import { showReaction, clearReactions } from './ui/reactionLayer.js';
import { acquireWakeLock, releaseWakeLock as dropWakeLock } from './core/wakeLock.js';
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
import { isCompactLandscape } from './core/playfield.js';
import { getSlotSwapError } from './core/slotRules.js';

// Skor bandının açık kalacağı süre. Canvas tarafındaki peek ile aynı değer
// (`hud.js` PEEK_MS): iki yüzey farklı süre gösteremez.
const SCORE_PEEK_MS = 2800;

// Joystick hissiyat sabitleri (tek kaynak — updateJoy + bindJoystick birlikte okur).
// Ölü bant küçük: parmağın doğal titremesi host'a "dur" göndermesin.
const JOY_DEADZONE = 0.06;
// Basılı tutarken kuvvet tabanı: parmak origin etrafında gezinip ölü banda
// girince motor mikro-dur-kalk titremesi yaşıyordu ("yürürken duruyor").
// Gerçek bırakma sıfırı yalnız endJoy/cancel gönderir.
const JOY_MIN_DRAG_FORCE = 0.18;
// touchcancel (bildirim, kenar jesti, avuç) gerçek parmak kaldırma DEĞİLDİR:
// host'u anında durdurmak yerine son yönü kısa bir grace boyunca koru.
const JOY_CANCEL_GRACE_MS = 150;

// Maç sonu modalının nefes payı: sonuç üstüne çullanmasın, son kare biraz
// ekranda kalsın. Azaltılmış harekette bekleme yok — modal yine erişilebilir.
const RESULT_BREATH_MS = 520;

// Host-yetkili aksiyon butonunun köprü payı: basıldıktan sonra host `cd`
// yayını gelene kadar butonu bu kadar kilitli tutar. Host kabul ettiyse ilk
// `cd > 0` paketiyle kilit host'un bitişine bağlanır; host reddettiyse
// (kayma/çarpma/cooldown) süre sonunda buton açılır.
const HOST_CD_BRIDGE_MS = 450;

// Kumanda kayıt tablosu: tek kaynaktan (engineRegistry) beslenir
const CONTROLLER_META = new Proxy({}, {
  get(target, prop) {
    return getControllerMeta(prop);
  },
});

initErrorReporter();

export class GamepadManager {
  constructor(overlayEl, network, { localMode = false } = {}) {
    /** @type {((action: string) => void) | null} Dışarıdan (main.js) bağlanır; _onResultAction köprüsü. */
    this.onLocalResultAction = null;
    this.overlay = overlayEl;
    this.network = network;
    // LOCAL tek cihazda ağ yoktur: uzak kumanda için konan 40 ms analog
    // throttle'ı anlamsız gecikme yaratır (curve gibi sürekli-direksiyon
    // oyunlarında "girdi geç geliyor" hissi). Yerel adaptör 0 ms ile kurulur;
    // uzak kumanda 40 ms bütçesini korur (AGENTS §6).
    this.inputAdapter = new GamepadInputAdapter((data) => this.sendInput(data), {
      throttleMs: localMode ? 0 : ANALOG_THROTTLE_MS,
    });
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
    this._scorePeekUntil = 0;
    this._scorePeekTimer = 0;
    this._visibilityBound = false;
    this._browserLocksBound = false;
    this._activeController = null;
    this._worldView = null;
    this._worldViewToken = 0;
    this._worldViewEnabled = false;
    this._pendingWorldFrame = null;
    /** FX olay süzgeci (token tektip: yinelenen/eski olay düşer; mount'ta sıfırlanır). */
    this._fxFilter = createFxEventFilter();
    this._activeLayoutRoot = null;
    this._layoutSafeProbe = null;
    this._layoutPreview = null;
    this._layoutEditor = null;
    this._layoutFrame = 0;
    this._layoutResizeObserver = null;
    this._lastScores = null;
    this._resultActive = false;
    this._resultTimer = 0;
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
    const obstacles = [...this.overlay.querySelectorAll(
      '.gamepad-header, .gamepad-status.is-on, .score-strip:not(.hidden)',
    )];
    // LOCAL'de tek çip kümesi `#in-game-hud`'dadır (overlay dışı, z-100): ona
    // göre çerçeve kesmezsek kontroller düğmelerin altına süzülebilir.
    if (this.localMode) {
      const hud = document.getElementById('in-game-hud');
      if (hud && !hud.classList.contains('hidden')) {
        obstacles.push(...hud.querySelectorAll('button'));
      }
    }
    for (const obstacle of obstacles) {
      const rect = obstacle.getBoundingClientRect();
      const relativeTop = rect.top - rootRect.top;
      const relativeBottom = rect.bottom - rootRect.top;
      if (relativeBottom <= 0 || relativeTop >= rootRect.height) continue;
      if (relativeTop < Math.min(180, rootRect.height * 0.4)) {
        frame.top = Math.max(frame.top, relativeBottom);
      }
    }

    // Kuşak tavanı yalnız kompakt telefon yatayında geçerli; tablet-yatay ve
    // masaüstü penceresi tam yükseklik çerçevesini kullanır (AGENTS.md:121).
    if (isCompactLandscape(rootRect.width, rootRect.height)) {
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
    const toolbar = this.overlay.querySelector('.gamepad-header')
      || (this.localMode ? document.querySelector('#in-game-hud:not(.hidden)') : null);
    const toolbarRect = toolbar?.getBoundingClientRect();
    const top = Math.min(
      height * 0.8,
      Math.max(insets.top, toolbarRect ? Math.max(0, toolbarRect.bottom - overlayRect.top) : 0),
    );
    const bottomInset = Math.max(
      insets.bottom,
      isCompactLandscape(width, height) ? height * 0.12 : 0,
    );
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

  // Screen wake lock, `src/core/wakeLock.js` tek sahibi (main.js host ile aynı bütçe).
  neutralizeInput() {
    this._lastLocalInputAt = performance.now();
    this._sendNeutralForMode();
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
    // Self-avatar prediction'ı throttle'dan bağımsız besle: host'a gitmese de
    // yerel dokunuş sunuma anında yansımalı (sunum-only, simülasyon değil).
    if (data.action === 'JOYSTICK_MOVE') this._worldView?.setSelfInput(data);
    const packet = data.action === 'AIM_MOVE' && !Number.isInteger(data.seq)
      ? { ...data, seq: this._nextAimSequence() }
      : data;
    return this.inputAdapter.sendAnalog(packet, opts);
  }

  // Ortak aksiyon-buton soğutması (BOMB/HEIST/CROWN aynı desen):
  // bas → onFire() + buton kilitlenir, süre dolunca eski haline döner.
  // Sayaç mount sökümünde temizlenir (CdTimer sızıntısı kapandı).
  // Faz 2.1: metin yerine radyal cooldown (--cd conic) + merkez saniye rozeti.
  //
  // `hostSynced` (şemada `syncHostCooldown`): kilit SÜRESİ host'un yayınladığı
  // `cd` alanından gelir — tek yetkili host'tur. Ölçülen kusur: yerel sayaç
  // host reddinde de (BOMB'ta kayma, HEIST'te çarpma) basıyordu, yani "bazen
  // dash/tackle çalışmıyor" ve buton gereksiz yere 2-3 sn ölü kalıyordu.
  // Artık: kabul → kilit host bitişine bağlı (hit-stop'u da doğru sayar);
  // ret → köprü payı sonunda buton açılır. Yerel sayaç `syncHostCooldown`
  // işaretlemeyen aksiyonlarda eski davranışını korur.
  cooledAction(btn, secs, readyLabel, onFire, vibratePattern, { hostSynced = false } = {}) {
    const state = { cooling: false, confirmed: false, bridgeTimer: 0, maxTimer: 0, localTimer: 0 };
    const signal = this._mountAbort?.signal;

    const clearTimers = () => {
      if (state.bridgeTimer) { window.clearTimeout(state.bridgeTimer); state.bridgeTimer = 0; }
      if (state.maxTimer) { window.clearTimeout(state.maxTimer); state.maxTimer = 0; }
      if (state.localTimer) { window.clearInterval(state.localTimer); state.localTimer = 0; }
    };

    const unlock = () => {
      clearTimers();
      state.cooling = false;
      state.confirmed = false;
      if (!btn || !btn.isConnected) return;
      this.resetButtonCooldown(btn, { flash: true });
      this.vibrate(15);
      playMenuPop();
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        clearTimers();
        state.cooling = false;
        state.confirmed = false;
      }, { once: true });
    }

    const handler = (e) => {
      e?.preventDefault();
      if (state.cooling) return;
      state.cooling = true;
      state.confirmed = false;
      try { onFire(); } catch (err) { reportError(err, 'gamepad.onFire'); }
      this.vibrate(vibratePattern);
      playMenuTick();
      if (!btn || !btn.isConnected) return;

      if (!hostSynced) {
        let remaining = secs;
        this.setButtonCooldown(btn, remaining, secs);
        if (state.localTimer) window.clearInterval(state.localTimer);
        state.localTimer = window.setInterval(() => {
          remaining -= 0.1;
          if (remaining <= 0.05) {
            window.clearInterval(state.localTimer);
            state.localTimer = 0;
            state.cooling = false;
            if (!btn.isConnected) return;
            this.resetButtonCooldown(btn, { flash: true });
            this.vibrate(15);
            playMenuPop();
          } else {
            this.setButtonCooldown(btn, remaining, secs);
          }
        }, 100);
        return;
      }

      // Anlık geri bildirim + köprü: host `cd > 0` yayını gelirse kilit host'a
      // bağlanır (aşağıda), gelmezse reddedildi sayılıp açılır.
      this.setButtonCooldown(btn, secs, secs);
      if (state.bridgeTimer) window.clearTimeout(state.bridgeTimer);
      state.bridgeTimer = window.setTimeout(() => {
        state.bridgeTimer = 0;
        if (!state.confirmed) unlock();
      }, HOST_CD_BRIDGE_MS);
    };

    // Host `cd` yayını (0..1 kesir) — yalnız hostSynced aksiyonlarda.
    handler.syncHost = (pct) => {
      if (!hostSynced) return;
      const clamped = Math.max(0, Math.min(1, Number(pct) || 0));
      if (clamped > 0) {
        state.cooling = true;
        state.confirmed = true;
        if (state.bridgeTimer) { window.clearTimeout(state.bridgeTimer); state.bridgeTimer = 0; }
        if (btn && btn.isConnected) this.setButtonCooldown(btn, clamped * secs, secs);
        // Yayın kesilirse buton kilitli kalmasın: her pakette tavan tazelenir.
        if (state.maxTimer) window.clearTimeout(state.maxTimer);
        state.maxTimer = window.setTimeout(() => { state.maxTimer = 0; unlock(); }, (secs + 2) * 1000);
        return;
      }
      if (!state.cooling) return;
      // Basıştan önce üretilmiş (henüz cd=0) paket olabilir: köprüyü bekle.
      if (state.bridgeTimer) return;
      unlock();
    };

    return handler;
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
    // Yeni mount = yeni oyun: FX token sayacı ve oynatma mandalı sıfırlanır.
    this._fxFilter = createFxEventFilter();
    this._setActiveLayoutRoot(null);
    if (this._activeController?.teardown) {
      try { this._activeController.teardown(); } catch (err) { reportError(err, 'gamepad.teardown'); }
      this._activeController = null;
    }
    if (this._mountAbort) {
      try { this._mountAbort.abort(); } catch (err) { reportError(err, 'gamepad.mountAbort'); }
      this._mountAbort = null;
    }
  }

  // Sekme arka plana alınınca / sayfa kapanırken host'ta latch kalmasın.
  // Nötr paket sol kontrole göre merkezden gelir (controlDefs.getNeutralInput).
  _sendNeutralForMode() {
    try {
      this._worldView?.setSelfInput(null);
      for (const neutral of getNeutralInputs(this.gameMode)) {
        if (neutral.action === 'AIM_MOVE' || neutral.action === 'AIM_RELEASE') {
          this._sendAimInput(neutral, { force: true });
        } else {
          this.sendInput(neutral, { force: true });
        }
      }
    } catch (err) { reportError(err, 'gamepad.sendNeutralForMode'); }
  }

  _bindVisibilityNeutral() {
    if (this._visibilityBound) return;
    this._visibilityBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !this.overlay.classList.contains('hidden')) {
        acquireWakeLock();
      } else if (document.hidden) {
        this._sendNeutralForMode();
      }
    });
    window.addEventListener('pagehide', () => {
      this._sendNeutralForMode();
      dropWakeLock();
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

  // Kumanda YÜZEY sınıfları: CSS yerleşimi `is-playing/is-lobby/is-portrait/
  // is-landscape` üçgenine bağlıdır. Döndürme GEÇİDİ burada değildir — tek geçit
  // kabuğundur (`appShell.updateRotateGate`, `#app-rotate-gate`, z-index 400 kumanda
  // katmanının üstünde). İkinci bir geçit aynı ekranda iki tam ekran scrim üretirdi.
  _bindOrientationState() {
    if (this._orientBound) return;
    this._orientBound = true;
    window.addEventListener('resize', () => this._syncOrientationState());
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this._syncOrientationState(), 150);
    });
  }

  _syncOrientationState() {
    if (!this.overlay || this.overlay.classList.contains('hidden')) return;
    const portrait = window.innerHeight > window.innerWidth;
    const playing = this.gameMode !== 'LOBBY';
    this.overlay.classList.toggle('is-playing', playing);
    this.overlay.classList.toggle('is-lobby', !playing);
    this.overlay.classList.toggle('is-portrait', portrait);
    this.overlay.classList.toggle('is-landscape', !portrait);
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
    this.pongInvertManualSet = false;
    this._worldViewEnabled = false;
    this.overlay.innerHTML = renderLocalGamepadShell();
    this._workspaceOverride = document.getElementById('local-mobile-workspace');
    this.overlay.classList.remove('hidden');
    this._bindBrowserLocks();
    this._bindVisibilityNeutral();
    this._bindOrientationState();
    this._bindLayoutEditorButton();
    this.renderGameController(gameMode);
    acquireWakeLock();
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
    this.pongInvertManualSet = false;

    this._bindBrowserLocks();
    this.renderShell();
    // Tepki gönderimi: kumanda yalnız `pad` yolunu bilir. Gönderici
    // reactionPicker'ın tek kayıt noktasına yazılır; markup yalnız
    // `data-reaction-open data-reaction-send="pad"` işaretler. Kendi tepkimiz
    // sunucudan dönmez (host yalnız kumandaya yayınlar) → yerel geri besleme.
    if (!this.localMode) {
      setReactionSender('pad', (key) => {
        const sent = this.network?.sendReaction?.(key) === true;
        if (sent) {
          showReaction({ key, slotIndex: this.playerIndex, color: this.playerColor });
        }
        return sent;
      });
      ensureReactionTriggers();
    }
    this._bindVisibilityNeutral();
    this._bindOrientationState();
    this.renderGameController(this.gameMode);
    this.overlay.classList.remove('hidden');
    acquireWakeLock();
    // Dil değişimi: lobide tam re-render (güvenli), oyunda sadece taktik ipucu
    // tazelenir (dokunmatik mount'a dokunulmaz — girdi kesilmez).
    if (!this._langBound) {
      this._langBound = true;
      onLangChange(() => {
        if (this.overlay.classList.contains('hidden')) return;
        if (this.gameMode === 'LOBBY') {
          this.renderShell();
          this.renderGameController('LOBBY');
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
    dropWakeLock();
    this._teardownMount();
    clearReactions();
    this._resultActive = false;
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = 0; }
    this._lastScores = null;
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this._workspaceOverride = null;
  }

  renderShell() {
    this.overlay.innerHTML = renderRemoteGamepadShell({
      showLayoutEditor: true,
    });

    this._syncOrientationState();

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

    // Skor göz atma (taç): bant 2.8 sn görünür, sonra kendiliğinden kapanır.
    // Süre canvas tarafındaki peek ile aynı (`hud.js` PEEK_MS).
    const scoreBtn = document.getElementById('btn-score-peek');
    scoreBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleScorePeek();
    });

    document.getElementById('btn-leave-gamepad')?.addEventListener('click', () => {
      closeMenu();
      this.network.disconnect();
      this.hide();
      window.location.href = window.location.pathname;
    });

    const fsToggle = document.getElementById('btn-fullscreen-toggle');
    // Sıradan web ve API'siz yüzeyde krom teklifi yok — menü satırı çizilmez.
    fsToggle?.classList.toggle('hidden', !canToggleFullscreen());
    fsToggle?.addEventListener('click', () => {
      closeMenu();
      // Tek otorite `src/ui/fullscreen.js` — kumanda kendi FS durumunu tutmaz.
      toggleFullscreen();
    });

    this._bindLayoutEditorButton();
  }

  // PONG ters-yön override'ı sıfırla: yeni koltuğun otomatik yönü yeniden
  // uygulansın. main.js iki kumandayı da bu kapıdan nötrler; alanı doğrudan
  // yazmaz (ters butonu `pongInvertManualSet`'i kendi koyar).
  resetPongInvert() {
    this.pongInvertManualSet = false;
  }

  updateSlot(newSlot, newColor) {
    this.playerIndex = newSlot;
    if (newColor) this.playerColor = newColor;
    // Reset manual invert so new seat's auto-direction is applied
    this.resetPongInvert();

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

  // Skor şeridi: koltuk rengi + isim + skor, YALNIZCA peek anında görünür.
  // Oyun sırasında saha boş kalır; düğme `toggleScorePeek` açar.
  //
  // Görünürlüğün tek sahibi `_syncScoreChrome` — bant ve düğmeyi o, içeriği
  // bu metot yazar. İkisi ayrı yollardan açılıp kapanırsa bant açıkken düğme
  // kaybolur ya da tersi.
  renderScoreStrip(names, scores) {
    const strip = this._el('score-strip');
    if (!strip) return;
    const eligible = this.gameMode !== 'LOBBY'
      && Array.isArray(names)
      && Array.isArray(scores);

    if (!eligible) {
      strip.innerHTML = '';
      this._lastStripJson = '';
      this._syncScoreChrome();
      return;
    }
    // Skor/isim/renk değişmediyse innerHTML'i yeniden kurma (8Hz layout/GC titremesi)
    const slotColorsSig = (this.slots || []).map((s) => s?.color || '').join('|');
    const sig = JSON.stringify([names, scores, this.playerIndex, slotColorsSig]);
    if (sig !== this._lastStripJson) {
      this._lastStripJson = sig;
      // Koltuk seçimi/isim/renk tek modelden (`scoreModel.js`) — host canvas
      // skorbord uyla aynı kaynak, aynı dolu-koltuk kuralı.
      strip.innerHTML = scoreEntries({ names, slots: this.slots, scores })
        .map((entry) => {
          const isMine = entry.index === this.playerIndex;
          return `
            <div class="score-chip${isMine ? ' is-mine' : ''}" data-reaction-anchor="${entry.index}">
              <span class="score-dot" style="background-color: ${entry.color}"></span>
              <span class="score-name">${escapeHtml(entry.name)}</span>
              <span class="score-val">${entry.score}</span>
            </div>
          `;
        })
        .join('');
    }
    this._syncScoreChrome();
  }

  /** Bant + düğme görünürlüğünün tek karar noktası (peek penceresi + mod). */
  _syncScoreChrome() {
    const peeking = this._scorePeekUntil > performance.now();
    const strip = this._el('score-strip');
    const canPeek = this.gameMode !== 'LOBBY'
      && !!strip
      && strip.childElementCount > 0;
    const show = peeking && canPeek;
    strip?.classList.toggle('hidden', !show);
    strip?.setAttribute('aria-hidden', show ? 'false' : 'true');
    const btn = this._el('btn-score-peek');
    if (btn) btn.hidden = !canPeek;
    if (!peeking && this._scorePeekTimer) {
      clearTimeout(this._scorePeekTimer);
      this._scorePeekTimer = 0;
    }
  }

  /** Tek dokunuş: açık değilse `SCORE_PEEK_MS` göster, açıksa hemen kapat. */
  toggleScorePeek() {
    this.vibrate(10);
    playMenuTick();
    if (this._scorePeekUntil > performance.now()) {
      this._scorePeekUntil = 0;
      this._syncScoreChrome();
      return;
    }
    this._scorePeekUntil = performance.now() + SCORE_PEEK_MS;
    this._syncScoreChrome();
    clearTimeout(this._scorePeekTimer);
    this._scorePeekTimer = window.setTimeout(() => {
      this._scorePeekTimer = 0;
      this._scorePeekUntil = 0;
      this._syncScoreChrome();
    }, SCORE_PEEK_MS);
  }

  // İki kademeli başlatma: koltuk seçimi lobi açılışında hazırdır;
  // STAGING aynı lobi görünümünü yeniler ve ready aşamasını açar. RETURNED_TO_LOBBY
  // kaçırılsa bile kumanda eski oyun ekranında ölü takılmaz.
  enterStaging(gameMode) {
    this.stagingOpen = true;
    this.countdownActive = false;
    this._countdownT = null;
    if (gameMode) this.selectedHostGame = gameMode;
    const th = gameMode ? fieldTheme(gameMode) : null;
    if (this.overlay && th) {
      this.overlay.style.setProperty('--game-accent', th.accent);
      this.overlay.style.setProperty('--game-floor', th.floor);
      this.overlay.style.setProperty('--game-edge', th.floorEdge);
    }
    this.renderGameController('LOBBY');
  }

  /**
   * Geri sayım PERDESİ — `#gamepad-overlay` çocuğudur, workspace'in DEĞİL.
   *
   * Dışarıda olması sözleşmedir: `renderGameController` workspace'in içini
   * temizler (`workspace.innerHTML = ''`); perde orada dursaydı her takasta
   * yok olur ve "geçiş" yeniden kesmeye dönerdi. Böylece yüzey takası perdenin
   * ALTINDA olur: lobi → perde (soluk), takas, perde → oyun (soluşma).
   *
   * Eski yol `workspace.innerHTML = ...` idi: lobi kartı yıkılıyor, hemen
   * ardından ikinci bir tam kurulum oluyordu; kullanıcı iki ayrı yok-var
   * sıçraması görüyordu.
   */
  _countdownVeil() {
    const key = t('pad.countBadge');
    if (this._veilEl?.isConnected && this._veilKey === key) return this._veilEl;
    const veil = document.createElement('div');
    veil.className = 'countdown-veil';
    veil.setAttribute('role', 'status');
    veil.setAttribute('aria-live', 'assertive');
    // tIcon() ikon SVG'sini metne gömer; statik iç sözlük, kullanıcı verisi değil.
    veil.innerHTML = `
      <div class="countdown-view">
        <div class="countdown-badge">${tIcon('pad.countBadge')}</div>
        <div class="countdown-number"></div>
      </div>
    `;
    this.overlay.appendChild(veil);
    this._veilEl = veil;
    this._veilNumber = /** @type {HTMLElement | null} */ (veil.querySelector(".countdown-number"));
    this._veilKey = key;
    return veil;
  }

  // Geri sayım tik'i: koltuklar kilitlenir, perdedeki sayı tazelenir.
  // Parametre `seconds`: i18n `t`'si gölgelenmesin — `seconds === 0` halinde
  // "t('pad.go')" bir sayıyı fonksiyon gibi çağırıp TypeError fırlatıyordu.
  showCountdown(seconds) {
    this.countdownActive = true;
    this._countdownT = seconds;
    const veil = this._countdownVeil();
    const num = this._veilNumber;
    const next = seconds > 0 ? String(seconds) : t('pad.go');
    if (num && num.textContent !== next) {
      num.textContent = next;
      // CSS animasyonunu tik başına yeniden başlatmak için sınıf sökülüp
      // basılır; okuma (`offsetWidth`) tik başına bir kez, kare başına değil.
      num.classList.remove('is-tick');
      void num.offsetWidth;
      num.classList.add('is-tick');
    }
    veil.classList.add('is-open');
    // GO! tik'i desenle, ara sayılar kısa vuruşla.
    this.vibrate(seconds > 0 ? 40 : [40, 60, 80]);
  }

  /** Perdeyi kapat. Sahibi `renderGameController`'dır — hangi yoldan gelirse
   *  gelsin (GAME_STARTED, STAGING, geç katılan için state sync) tek noktadan
   *  kapanır, yoksa bir yerde perde takılı kalır. */
  hideCountdown() {
    this._veilEl?.classList.remove('is-open');
  }

  // Staging/sayaç durumunu sıfırla (oyun başladı veya lobiye dönüldü)
  exitStaging() {
    this.stagingOpen = false;
    this.countdownActive = false;
    this._countdownT = null;
    const isLobby = String(this.gameMode).toLowerCase() === 'lobby';
    if (this.overlay && isLobby) {
      this.overlay.style.removeProperty('--game-accent');
      this.overlay.style.removeProperty('--game-floor');
      this.overlay.style.removeProperty('--game-edge');
    }
  }

  _startPhysicalGamepad() {
    if (this.gameMode === 'LOBBY') {
      this.physicalGamepad.stop();
      return;
    }
    this.physicalGamepad.start();
  }

  renderGameController(mode) {
    // Yeni yüzey kurulmadan ÖNCE perde kapanır: soluşma takasın üstüne biner,
    // böylece "lobi → sayaç → oyun" tek el değiştirme olarak okunur.
    this.hideCountdown();
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
    this._scorePeekUntil = 0;
    if (this._scorePeekTimer) {
      clearTimeout(this._scorePeekTimer);
      this._scorePeekTimer = 0;
    }
    this._lastScores = null;
    this._resultActive = false;
    if (this._resultTimer) { clearTimeout(this._resultTimer); this._resultTimer = 0; }
    this._cloneCdBtn = null;
    this.gameMode = mode;
    const isLobby = String(mode).toLowerCase() === 'lobby';
    const th = !isLobby ? fieldTheme(mode) : null;
    if (this.overlay) {
      if (th) {
        this.overlay.style.setProperty('--game-accent', th.accent);
        this.overlay.style.setProperty('--game-floor', th.floor);
        this.overlay.style.setProperty('--game-edge', th.floorEdge);
      } else if (!this.stagingOpen) {
        this.overlay.style.removeProperty('--game-accent');
        this.overlay.style.removeProperty('--game-floor');
        this.overlay.style.removeProperty('--game-edge');
      }
    }
    this._startPhysicalGamepad();
    const workspace = this._workspaceOverride || document.getElementById('gamepad-workspace');
    if (!workspace) return;

    workspace.innerHTML = '';

    if (mode === 'LOBBY') {
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
    this._syncScoreChrome();
    this._syncOrientationState();
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
      <button class="${btnClass}" data-seat="${idx}" data-reaction-anchor="${idx}" type="button" aria-label="${escapeHtml(ariaLabel)}"${canTarget ? '' : ' disabled'}>
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
    const canvas = /** @type {HTMLCanvasElement | null} */ (document.getElementById("lobby-character-preview"));
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
        rim: this.avatar.rim,
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
    const selectedTitle = CONTROLLER_META[this.selectedHostGame]?.lobbyTitle || 'PONG';

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
          <img src="/assets/games/${(this.selectedHostGame || 'PONG').toLowerCase()}.webp" class="lobby-game-thumb-preview" alt="${escapeHtml(selectedTitle)}" onerror="this.style.display='none'" />
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
  bindJoystick(zoneId, knobId, onInput, { onPress, onRelease } = /** @type {{onPress?: ((input: any) => void) | null, onRelease?: ((input: any, opts?: any) => void) | null}} */ ({})) {
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
    // touchcancel sonrası gecikmeli nötr zamanlayıcısı (JOY_CANCEL_GRACE_MS).
    let cancelGraceTimer = null;
    const clearCancelGrace = () => {
      if (cancelGraceTimer !== null) {
        clearTimeout(cancelGraceTimer);
        cancelGraceTimer = null;
      }
    };
    const emitZero = () => emitInput({ dx: 0, dy: 0, angle: 0, force: 0 });

    const startAt = (clientX, clientY) => {
      // Yeni basış grace'i iptal eder: parmak geri geldi, host yönü korusun.
      clearCancelGrace();
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
      } else if (cancelled && finalInput.force > 0) {
        // Gerçek kaldırma değil: son yönü grace boyunca koru, sonra nötrle.
        // Grace içinde yeni basış gelirse startAt zamanlayıcıyı iptal eder.
        clearCancelGrace();
        cancelGraceTimer = setTimeout(() => {
          cancelGraceTimer = null;
          emitZero();
        }, JOY_CANCEL_GRACE_MS);
      } else {
        // Move joystick: zero packet needed to stop movement.
        emitZero();
      }
    };

    const joySignal = this._mountAbort?.signal;
    // Teardown'da bekleyen grace zamanlayıcısı sökülmüş yüzeye sızmasın.
    joySignal?.addEventListener('abort', clearCancelGrace, { once: true });
    // Basılı analog keepalive'i: parmak sabit tutulurken `touchmove` üretmediği
    // için host'a hiç paket gitmiyor, host'un analog sessizlik süpürücüsü
    // (STALE_ANALOG_MS) yönü sıfırlıyordu — "yürürken ateş edince karakter
    // duruyor" bunun sonucuydu (aim keepalive'lı olduğu için ateş sürüyordu).
    // Basılıyken son vektör CONTROL_KEEPALIVE_MS ile tekrar gönderilir; steer ve
    // fiziksel gamepad zaten aynısını yapar (tek politika).
    const keepaliveTimer = setInterval(() => {
      const held = activeTouchId !== null || activePointerId !== null || isMouseDown;
      if (held && lastInput.force > 0.05) onInput({ ...lastInput }, { keepalive: true });
    }, CONTROL_KEEPALIVE_MS);
    joySignal?.addEventListener('abort', () => clearInterval(keepaliveTimer), { once: true });
    const hasTouch = typeof window !== 'undefined' && ('ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0));

    if (hasTouch) {
      // Touch-first: Mobil tarayıcılarda (iOS Safari, Android Chrome) dokunmatik takibini
      // Touch Events API ile doğrudan ve kesintisiz yürütür. Pointer capture düşmesi
      // veya sahte lostpointercapture kopmaları tamamen engellenir.
      zone.addEventListener('touchstart', (e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        e.preventDefault();
        // Sahibi hâlâ basılıysa ikinci parmak yönü KAPMASIN: eski davranış her
        // yeni basışta origin'i kaydırıp karakteri dur-kalk yapıyordu. Yalnız
        // sahip gerçekten kalkmışsa (identifier aktif dokunuşlar arasında yoksa)
        // güvenle devret.
        if (activeTouchId !== null) {
          const ownerStillDown = Array.from(e.touches || []).some((t) => t.identifier === activeTouchId);
          if (ownerStillDown) return;
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
    // Küçük ölü bant yalnız dinlenen parmak titremesini keser (JOY_DEADZONE).
    let force = rawForce < JOY_DEADZONE
      ? 0
      : Math.max(0, Math.min(1, (rawForce - JOY_DEADZONE) / (1 - JOY_DEADZONE)));
    // Kasıtlı itişte (ölü bandın üstü) taban kuvvet uygula: parmak origin
    // etrafında gezinirken host'a 0 gidip karakter dur-kalk yapmasın.
    if (force > 0 && force < JOY_MIN_DRAG_FORCE) force = JOY_MIN_DRAG_FORCE;
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

  /**
   * FX olayları (anlık güvenilir yol, MOTION_PLAN 2.2): önce kendi koltuğunun
   * olaylarında haptik (desen tablosu fxKit), sonra world sunum katmanına
   * playback için teslim. §2 gereği kumandada simülasyon YOKTUR — yalnız
   * oynatılan sunum durumu (selfPrediction precedenti). Dünya görünümü yoksa
   * (TV kumanda) geriye yalnız haptik kalır: sarsıntı/flash TV'de (2.4).
   * @param {any[] | null} events
   */
  handleFxEvents(events) {
    const fresh = this._fxFilter(Array.isArray(events) ? events : []);
    if (!fresh.length) return;
    const fb = fxPadFeedback(fresh, this.playerIndex, !!this._worldView);
    for (const kind of fb.ownKinds) fxHaptic(kind);
    if (this._worldView) {
      this._worldView.acceptFx(fresh);
    } else if (fb.pop) {
      // 2.4 TV_CONSOLE: dünya görünümü yok — sarsıntı/flash TV'de kalır,
      // kumandaya yalnız haptik + buton pop'u düşer (§2 simülasyonsuz).
      this._popActionFx();
    }
  }

  /**
   * 2.4 — kumanda aksiyon butonlarında kısa scale-pop (Faz 3.5 grameri:
   * 90-110 ms, ripple/glow yok, transform-only). Yalnız kendi olayında ve
   * dünya görünümü yokken çağrılır.
   */
  _popActionFx() {
    if (!this.overlay?.querySelectorAll) return;
    const btns = this.overlay.querySelectorAll(
      '.action-dash-btn, .action-spin-btn, .tank-fire-btn',
    );
    for (const btn of btns) {
      btn.classList.remove('fx-pop');
      void btn.offsetWidth;
      btn.classList.add('fx-pop');
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
      // Boş koltukta hayalet skor bildirimi yok.
      const hasSeat = !!(names[i] || this.slots[i]?.name);
      if (gained > 0 && hasSeat) {
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

  /**
   * Raunt boşluğu rozeti — "bam diye başlıyor" şikâyetinin kumanda ayağı.
   *
   * Host canvas'ı raunt sonucunu bir bantta gösteriyor, ama kumanda o boşluğun
   * FARKINDA değildi: paket yalnız skor taşıyordu, dolayısıyla telefonda ekran
   * bir sonraki raunta atladığı anda değişiyordu. `roundGap` boşluk boyunca
   * sıfırdan farklıdır; rozet kalan süreyi ve dolayısıyla tepki payını bildirir.
   *
   * Yerel (tek cihaz) yüzeyde bilinçli olarak YOK: orada bant zaten aynı
   * ekranın üstünde, rozet aynı bilgiyi iki yere basardı.
   */
  _syncRoundGap(data) {
    const left = Number(data.roundGap) || 0;
    // World-view raunt-sonu bandı host ile AYNI paneli ve geri sayımı çizer.
    // O yüzey açıkken durum satırındaki rozet sayıyı ikinci kez basardı; rozet
    // yalnız world-view'sız yüzeyde (TV_CONSOLE kumandası) tek kaynaktır.
    if (this._worldView) {
      this._worldView.setRoundGap(left);
      // World-view sonradan bağlanırsa erken açılmış rozet açık kalmasın.
      this._el('round-gap-chip')?.classList.remove('is-open');
      return;
    }
    // Raunt boşluğu rozeti durum satırının içinde bir öğedir, ayrı katman değil:
    // saha üstünde yalnız o satır var.
    const status = this._el('gamepad-status');
    if (!status) return;
    let chip = this._el('round-gap-chip');
    if (!chip) {
      if (left <= 0) return;
      chip = document.createElement('div');
      chip.id = 'round-gap-chip';
      chip.className = 'round-gap-chip';
      chip.setAttribute('aria-live', 'polite');
      status.appendChild(chip);
    }
    if (left > 0) {
      const text = t('pad.roundGap', String(Math.ceil(left)));
      if (chip.textContent !== text) chip.textContent = text;
      chip.classList.add('is-open');
      return;
    }
    chip.classList.remove('is-open');
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
    // Yalnız dolu koltuklar: 2 kişilik maçta boş P3/P4 satırı basılmaz.
    const occupiedIdx = scores.map((_, i) => i).filter((i) => !!(names[i] || this.slots[i]?.name));
    const pool = occupiedIdx.length > 0 ? occupiedIdx : scores.map((_, i) => i);
    const mvpIdx = winner ? winner.index : pool.reduce((best, i) => (scores[i] > (scores[best] ?? -1) ? i : best), pool[0]);
    const mvpName = winner ? (winner.name || names[mvpIdx] || `P${mvpIdx + 1}`) : (names[mvpIdx] || `P${mvpIdx + 1}`);
    const mvpColor = winner ? (winner.color || colors[mvpIdx] || UI_COLORS.players[mvpIdx] || '#ffb020') : (colors[mvpIdx] || UI_COLORS.players[mvpIdx] || '#ffb020');
    const rows = pool
      .map((i) => ({
        i,
        score: scores[i],
        name: names[i] || this.slots[i]?.name || `P${i + 1}`,
        color: colors[i] || this.slots[i]?.color || UI_COLORS.players[i] || '#6e6357',
      }))
      .sort((a, b) => b.score - a.score || a.i - b.i);

    el.innerHTML = `
      <div class="confetti-burst" aria-hidden="true"></div>
      <div class="result-card" role="document">
        <div class="result-lead">
          <div class="result-headline">${t('pad.resultTitle')}</div>
          <div class="result-sub">${t('pad.resultSub')}</div>
          <div class="result-mvp">
            <span class="result-mvp-dot" style="background-color: ${mvpColor}"></span>
            <span>${escapeHtml(mvpName)}</span>
          </div>
        </div>
        <div class="result-board">
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
        </div>
      </div>
    `;

    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
    el.querySelector('#btn-result-replay')?.addEventListener('click', () => this._onResultAction('replay'));
    el.querySelector('#btn-result-lobby')?.addEventListener('click', () => this._onResultAction('lobby'));

    // Nefes payı boyunca kutu görünmez ama dokunuşu TUTAR: aksi hâlde boşlukta
    // canvas'a düşen temas `matchOverRestartTap` ile maçı istemeden başlatırdı.
    el.classList.add('is-pending');
    // Nefes payı: sonuç modalı hemen üstüne çullanmasın. Azaltılmış harekette
    // bekleme yok; konfeti ve pop sesi modal göründüğü an başlar.
    const breath = motionScale() === 0 ? 0 : RESULT_BREATH_MS;
    clearTimeout(this._resultTimer);
    this._resultTimer = window.setTimeout(() => {
      this._resultTimer = 0;
      el.classList.add('reveal');
      el.setAttribute('aria-hidden', 'false');
      this._spawnConfetti(el.querySelector('.confetti-burst'));
      playMenuPop();
    }, breath);
  }

  _hideMatchResult() {
    this._resultActive = false;
    if (this._resultTimer) {
      clearTimeout(this._resultTimer);
      this._resultTimer = 0;
    }
    const el = this._el('gamepad-result');
    if (!el) return;
    el.classList.remove('reveal', 'is-pending');
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
      try { this._activeController.handleSync(data); } catch (err) { reportError(err, 'gamepad.handleSync'); }
    }

    const liveStatus = this._el('hud-live-status');

    // Skor şeridi içeriği. Görünürlüğü peek'e bağlı: `_syncScoreChrome` her
    // paket içinde yeniden karar verir.
    if (data.scores) {
      this.renderScoreStrip(data.names, data.scores);
    }

    // Sahadaki tek üst metin: SKOR / süre / can / cephane. Metin tek kaynaktan
    // (controllerStatus registry) gelir ve çıplaktır — kutu/etiket yok.
    // PONG ralli/falso, TANKS cephane, BOMB/CROWN/HEIST uyarıları buradan
    // gelir; şablonların handleSync/onSync'inde oyun-özel dal tutulmaz.
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

    // Durum satırı yalnız oyun oynanırken görünür (lobi/sayaç/sonuç kapalı).
    // Uzak pakette `state` yoksa GAME fazı oynama kabul edilir.
    const status = this._el('gamepad-status');
    if (status) {
      const quiet = ['LOBBY', 'STAGING', 'COUNTDOWN', 'MATCH_OVER'];
      const inPlay = phase === 'GAME' && (!data.state || !quiet.includes(data.state));
      status.classList.toggle('is-on', inPlay);
    }

    // Faz 2.4: LOCAL authoritative state sinyaliyle sonuç ekranı açılır/kapanır.
    this._syncMatchResult(data);
    // Raunt boşluğu rozeti (uzak kumanda): tepki payı görünür olsun.
    this._syncRoundGap(data);

    // Faz 2.2: skor artışlarını sağ üst kill-feed toast'larına çevir.
    this._pushKillFeedFromScores(data);
  }
}
