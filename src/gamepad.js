// Specialized Gamepad Controller for Mobile Phones in TV/Console & Online Mode
// Adapts dynamically to Lobby, Pong, Tanks, Curve, Bomb, Heist, and Archery with ultra-low latency inputs.

import { storePlayerName, escapeHtml } from './net.js';
import { showInstallToast } from './ui/toast.js';
import { UI_COLORS } from './ui/tokens.js';
import { mountDeclarativeController } from './controllers/controllerTemplates.js';
import { getNeutralInput } from './controllers/controlDefs.js';
import { getControllerStatus } from './controllers/controllerStatus.js';
import { getControllerMeta } from './core/engineRegistry.js';
import { t, onLangChange } from './i18n.js';
import { getAvatarProfile } from './core/customizationManager.js';
import { drawBrutalAvatar } from './ui/characterRenderer.js';
import { openCustomizeModal } from './ui/customizeModal.js';
import { getTabletopIconSvg } from './core/tabletopIcons.js';
import { GamepadWorldView } from './ui/gamepadWorldView.js';

// Kumanda kayıt tablosu: tek kaynaktan (engineRegistry) beslenir
const CONTROLLER_META = new Proxy({}, {
  get(target, prop) {
    return getControllerMeta(prop);
  },
});

export class GamepadManager {
  constructor(overlayEl, network) {
    this.overlay = overlayEl;
    this.network = network;
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
    // İki kademeli başlatma: staging açılmadan koltuk seçimi gösterilmez
    this.stagingOpen = false;
    this.countdownActive = false;
    this._countdownT = null;

    // Taşıma-bağımsız analog throttle (AGENTS §5: 50ms + ölübant — WS ve
    // Supabase yollarını birlikte kapsar, çift throttle jitter'ı olmaz)
    this._lastAnalogSent = 0;
    this._lastPaddlePos = null;
    this._lastJoySent = { dx: 0, dy: 0 };
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
  }

  // Güvenli ve merkezi Haptic Geri Bildirim
  vibrate(pattern) {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(pattern);
      }
    } catch {}
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
  _sendAnalog(data) {
    const now = performance.now();
    const isZero = data.action === 'JOYSTICK_MOVE'
      ? (data.force === 0)
      : (data.action === 'PADDLE_MOVE' && false);
    if (!isZero) {
      if (now - this._lastAnalogSent < 50) return;
      if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
        if (this._lastPaddlePos !== null && Math.abs(data.position - this._lastPaddlePos) < 0.003) return;
        this._lastPaddlePos = data.position;
      } else if (data.action === 'JOYSTICK_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        if (Math.hypot(dx - this._lastJoySent.dx, dy - this._lastJoySent.dy) < 0.02) return;
        this._lastJoySent = { dx, dy };
      }
    } else {
      this._lastJoySent = { dx: 0, dy: 0 };
    }
    this._lastAnalogSent = now;
    this.network.sendInput(data);
  }

  // Ortak aksiyon-buton soğutması (BOMB/HEIST/CROWN aynı desen):
  // bas → onFire() + buton kilitlenir, süre dolunca eski haline döner.
  // Sayaç mount sökümünde temizlenir (CdTimer sızıntısı kapandı).
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
      if (!btn || !btn.isConnected) return;
      btn.classList.add('cooling');
      let remaining = secs;
      const paint = (label, sub) => {
        if (!btn.isConnected) return;
        btn.innerHTML = `<span class="dash-btn-label">${label}</span><span class="dash-btn-sub">${sub}</span>`;
      };
      paint(`⏳ ${remaining.toFixed(1)}s`, t('pad.filling'));
      if (state.timer) clearInterval(state.timer);
      state.timer = setInterval(() => {
        remaining -= 0.1;
        if (remaining <= 0.05) {
          clearInterval(state.timer);
          state.timer = null;
          state.cooling = false;
          if (!btn.isConnected) return;
          btn.classList.remove('cooling');
          paint(readyLabel, t('pad.readyEx'));
          this.vibrate(15);
        } else {
          paint(`⏳ ${remaining.toFixed(1)}s`, t('pad.filling'));
        }
      }, 100);
    };
  }

  // Koltuk değiştirme ön kapısı (lobi ızgarası + refresh tek kaynaktan;
  // sunucu/host son kapılar yerinde durur)
  canSwitchSlot(targetSlot) {
    if (this.network.reservedHostSlot === targetSlot) return false;
    if (this.countdownActive) return false;
    if (targetSlot === this.playerIndex) return false;
    if (this.slots?.[targetSlot]?.kind === 'bot') return false;
    if (this.slots?.[this.playerIndex]?.kind === 'bot') return false;
    return true;
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
      const renderer = module.createSnakeWorldViewRenderer?.();
      if (!renderer) {
        this._renderWorldPlaceholder(canvas);
        return;
      }
      this._worldView = new GamepadWorldView(canvas, renderer, { slots: this.slots });
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
      const neutral = getNeutralInput(this.gameMode);
      if (neutral) this.network.sendInput(neutral);
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
  }

  init(playerInfo, gameMode = 'LOBBY') {
    this.playerIndex = playerInfo.slotIndex ?? 0;
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
          const hintEl = document.getElementById('tactical-role-text');
          if (hintEl) hintEl.textContent = CONTROLLER_META[this.gameMode]?.tacticalHint || '';
        }
      });
    }
  }

  hide() {
    this.releaseWakeLock();
    this._teardownMount();
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.overlay.className = 'hidden';
  }

  renderShell() {
    const seatPositions = ['P1', 'P2', 'P3', 'P4'];
    const seatLabel = seatPositions[this.playerIndex] || `P${this.playerIndex + 1}`;
    const initialGameTag = CONTROLLER_META[this.gameMode]?.hudTag || (this.gameMode === 'LOBBY' ? t('pad.lobbyTag') : this.gameMode);

    this.overlay.innerHTML = `
      <div class="gamepad-header">
        <div class="header-left-group">
          <span class="player-slot-chip" id="header-seat-tag" style="background-color: ${this.playerColor}">${seatLabel}</span>
          <span class="player-name-label" id="header-player-name">${this.playerName}</span>
          <span class="header-game-chip" id="header-game-tag">${initialGameTag}</span>
        </div>
        <div class="header-right-group">
          <span class="gamepad-room-info">#${this.network.roomCode || '---'}</span>
          <button class="emoji-reaction-btn" id="btn-toggle-emoji" type="button" data-i18n-aria="pad.reactTitle" title="Tepki Gönder">${getTabletopIconSvg('message_square', { size: 18, color: '#141414', strokeWidth: 2.3 })}</button>
          <button class="btn-fullscreen-toggle" id="btn-fullscreen-toggle" type="button" title="Tam Ekran">${getTabletopIconSvg('maximize_2', { size: 16, color: '#141414', strokeWidth: 2.3 })}</button>
          <button class="btn-leave-gamepad" id="btn-leave-gamepad" type="button">${t('pad.leave')}</button>
        </div>
      </div>

      <div class="score-strip hidden" id="score-strip"></div>

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
      window.location.href = window.location.pathname;
    });

    document.getElementById('btn-fullscreen-toggle')?.addEventListener('click', () => {
      this.toggleFullscreen();
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
        this.vibrate(20);
      });
    });
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

  updateSlots(slots) {
    const prev = this.slots;
    this.slots = slots || [null, null, null, null];
    this._worldView?.setSlots(this.slots);
    // Kim geldi/gitti telefonlarda da görünsün (ilk tablo sessiz; bot ve isim değişimi sessiz)
    if (prev) {
      for (let i = 0; i < 4; i++) {
        const oldName = prev[i]?.kind === 'bot' ? null : prev[i]?.name || null;
        const newName = this.slots[i]?.kind === 'bot' ? null : this.slots[i]?.name || null;
        if (!oldName && newName && newName !== this.playerName) {
          showInstallToast(t('pad.joined', newName));
        } else if (oldName && !newName && oldName !== this.playerName) {
          showInstallToast(t('pad.left', oldName));
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

  // İki kademeli başlatma: host sahayı açtı → koltuk seçimi görünür.
  // STAGING her durumda lobi görünümünü basar: RETURNED_TO_LOBBY'yi kaçırmış
  // (uyku/zamanlama) kumanda eski oyun ekranında ölü takılmasın diye koşulsuz render.
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
        <div class="countdown-badge">${t('pad.countBadge')}</div>
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

  renderGameController(mode) {
    // Eski mount sökülmeden önce: takılı joystick/sürüş varsa host'a nötr paket
    // (zone innerHTML ile gidince endJoy hiç çalışmıyordu → hayalet girdi)
    this._sendNeutralForMode();
    this._teardownMount();
    this._mountAbort = new AbortController();
    this._elCache.clear();
    this._lastStripJson = '';
    this._lastStatusStr = '';
    this._cloneCdBtn = null;
    this.gameMode = mode;
    const workspace = document.getElementById('gamepad-workspace');
    if (!workspace) return;

    workspace.innerHTML = '';

    const modeTag = document.getElementById('header-game-tag');
    if (modeTag) {
      modeTag.textContent = CONTROLLER_META[mode]?.hudTag || (mode === 'LOBBY' ? t('pad.lobbyTag') : mode);
    }

    if (mode === 'LOBBY') {
      document.getElementById('score-strip')?.classList.add('hidden');
      this.mountLobbyController(workspace);
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
    }
    this._updateOrientationGate();
  }

  // Koltuk kartı: kocaman numara + koltuk rengi + isim/BOŞ.
  // Numara + renk TV ile birebir eşleşir (P1 kırmızı, P2 mavi, P3 sarı, P4 yeşil);
  // yan etiketler bilerek yok (sadece PONG'da doğruydu, köşeli oyunlarda yanıltıcıydı).
  renderSeatButtonHtml(idx) {
    const fallbackColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const isMine = idx === this.playerIndex;
    const slotData = this.slots ? this.slots[idx] : null;
    const seatColors = [0, 1, 2, 3].map((i) => this.slots?.[i]?.color || fallbackColors[i]);
    const isReserved = !isMine && this.network.reservedHostSlot === idx;
    const isBot = !isMine && slotData?.kind === 'bot';
    const isOccupied = !isMine && !isBot && !isReserved && slotData !== null && !!slotData.name;
    const occupantName = isMine ? this.playerName : (isOccupied || isBot ? slotData.name : '');

    let statusText = '';
    let btnClass = 'lobby-seat-btn';

    if (isMine) {
      btnClass += ' active is-mine';
      statusText = t('pad.you');
    } else if (isReserved) {
      btnClass += ' is-reserved';
      statusText = 'P1 HOST';
    } else if (isBot) {
      btnClass += ' is-bot';
      statusText = '🤖 BOT';
    } else if (isOccupied) {
      btnClass += ' is-occupied';
      statusText = occupantName;
    } else {
      btnClass += ' is-empty';
      statusText = t('pad.empty');
    }

    return `
      <button class="${btnClass}" data-seat="${idx}" type="button"${isBot || isReserved ? ' disabled' : ''}>
        <span class="seat-num" style="color: ${seatColors[idx]}">${idx + 1}</span>
        <span class="seat-status">${escapeHtml(statusText)}</span>
      </button>
    `;
  }

  refreshLobbySeats() {
    const grid = this.overlay.querySelector('.lobby-seats-grid');
    if (!grid) return;
    grid.innerHTML = [0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('');
    grid.querySelectorAll('.lobby-seat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetSlot = parseInt(btn.dataset.seat, 10);
        if (!this.canSwitchSlot(targetSlot)) return;
        this.network.sendInput({ action: 'SWITCH_SLOT', targetSlot });
        this.vibrate(30);
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
        accessory: this.avatar.accessory,
        pattern: this.avatar.pattern,
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
    const selectedTitle = CONTROLLER_META[this.selectedHostGame]?.lobbyTitle || '🏓 BRUTAL PONG';

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
          <button class="lobby-profile-edit-btn" id="btn-edit-character" type="button">✏️ ${t('pad.customize')}</button>
        </div>

        <!-- 2. Selected Game Preview Pill -->
        <div class="lobby-game-chip-bar">
          <img src="/assets/games/${(this.selectedHostGame || 'PONG').toLowerCase()}.jpg" class="lobby-game-thumb-preview" alt="${escapeHtml(selectedTitle)}" onerror="this.style.display='none'" />
          <div class="lobby-game-chip-info">
            <span class="lobby-game-label">${t('pad.game')}</span>
            <span class="lobby-game-title" id="lobby-selected-game-text">${selectedTitle}</span>
          </div>
        </div>

        <!-- 3. Seat Picker (sadece staging'de) -->
        ${this.stagingOpen ? `
        <div class="lobby-seats-card">
          <div class="lobby-seat-badge">${t('pad.seatPick')}</div>
          <div class="lobby-seats-grid">
            ${[0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('')}
          </div>
        </div>
        ` : `
        <div class="lobby-wait-card">
          <div class="lobby-wait-badge">${t('pad.arenaPrep')}</div>
          <div class="lobby-wait-text">${t('pad.arenaPrepText')}</div>
        </div>
        `}

        <!-- 4. Hero Ready Button -->
        ${this.stagingOpen ? `
        <button class="btn-ready-toggle ${this.isReady ? 'ready' : ''}" id="btn-lobby-ready" type="button">
          ${this.isReady ? '✓ ' + t('pad.ready') : '▶ ' + t('pad.ready')}
        </button>
        ` : ''}

        <!-- 5. Leave button -->
        <button class="btn-leave-lobby-direct" id="btn-leave-lobby-direct" type="button">
          ${t('pad.leaveRoom')}
        </button>
      </div>
    `;

    // Seat switch click handlers
    container.querySelectorAll('.lobby-seat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetSlot = parseInt(btn.dataset.seat, 10);
        if (!this.canSwitchSlot(targetSlot)) return;
        this.network.sendInput({ action: 'SWITCH_SLOT', targetSlot });
        this.vibrate(30);
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
        showInstallToast(t('pad.avatarShared'));
        this.vibrate(15);
      });
    });

    const readyBtn = document.getElementById('btn-lobby-ready');
    readyBtn?.addEventListener('click', () => {
      this.isReady = !this.isReady;
      // Yazı sabit "HAZIRIM": durum renkle belli olur (sönük → yeşil)
      readyBtn.classList.toggle('ready', this.isReady);
      this.network.setReady(this.isReady);
      this.vibrate(this.isReady ? [20, 30] : 15);
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
          leaveBtn.textContent = t('pad.leaveRoom');
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
  bindJoystick(zoneId, knobId, onInput) {
    const zone = document.getElementById(zoneId);
    const knob = document.getElementById(knobId);
    if (!zone || !knob) return;
    const baseEl = knob.parentElement;

    let activeTouchId = null;
    let isMouseDown = false;
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
      this.updateJoy(clientX, clientY, originX, originY, maxRadius, knob, onInput);
    };

    const moveAt = (clientX, clientY) => {
      const reachedMax = this.updateJoy(clientX, clientY, originX, originY, maxRadius, knob, onInput);
      if (reachedMax && !hitEdge) {
        hitEdge = true;
        this.vibrate(8);
      } else if (!reachedMax && hitEdge) {
        hitEdge = false;
      }
    };

    const endJoy = () => {
      activeTouchId = null;
      isMouseDown = false;
      hitEdge = false;
      knob.style.transform = 'translate(0px, 0px)';
      if (baseEl) {
        baseEl.classList.remove('floating');
        baseEl.style.left = '';
        baseEl.style.top = '';
      }
      onInput({ dx: 0, dy: 0, angle: 0, force: 0 });
    };

    zone.addEventListener('touchstart', (e) => {
      if (activeTouchId !== null) return;
      e.preventDefault();
      const touch = e.changedTouches[0];
      activeTouchId = touch.identifier;
      startAt(touch.clientX, touch.clientY);
    }, { passive: false });

    zone.addEventListener('touchmove', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === activeTouchId) {
          e.preventDefault();
          moveAt(touch.clientX, touch.clientY);
          break;
        }
      }
    }, { passive: false });

    zone.addEventListener('touchend', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) { endJoy(); break; }
      }
    }, { passive: true });
    zone.addEventListener('touchcancel', (e) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) { endJoy(); break; }
      }
    }, { passive: true });

    // Zone dışı bırakma / çağrı kesmesi güvenlik ağı (TANKS/CURVE deseni)
    const joySignal = this._mountAbort?.signal;
    const onWindowTouchEnd = (e) => {
      if (activeTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === activeTouchId) { endJoy(); break; }
      }
    };
    window.addEventListener('touchend', onWindowTouchEnd, { passive: true, signal: joySignal });
    window.addEventListener('touchcancel', onWindowTouchEnd, { passive: true, signal: joySignal });

    // Mouse fallback for desktop testing
    zone.addEventListener('mousedown', (e) => {
      isMouseDown = true;
      startAt(e.clientX, e.clientY);
    });
    window.addEventListener('mousemove', (e) => {
      if (isMouseDown) moveAt(e.clientX, e.clientY);
    }, { signal: joySignal });
    window.addEventListener('mouseup', () => {
      if (isMouseDown) endJoy();
    }, { signal: joySignal });
  }

  updateJoy(clientX, clientY, cx, cy, maxR, knobEl, onInput) {
    const rawDx = clientX - cx;
    const rawDy = clientY - cy;
    const dist = Math.hypot(rawDx, rawDy);
    const clampedDist = Math.min(maxR, dist);
    const angle = Math.atan2(rawDy, rawDx);

    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    knobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;

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
      showInstallToast(t('pad.joinedGame', data.gameMode));
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
      const tag = CONTROLLER_META[data.gameMode]?.hudTag || data.gameMode;
      if (modeTag.textContent !== tag) modeTag.textContent = tag;
    }

    // İsimli skor şeridi (PONG kendi skorbord'unu kullanır, diğer modlar şeridi)
    if (data.scores) {
      this.renderScoreStrip(data.names, data.scores);
    }

    // Üst durum şeridi: metin tek kaynaktan (controllerStatus registry).
    // PONG skorbord/falso, TANKS cephane, BOMB/CROWN/HEIST uyarıları şablonların
    // handleSync/onSync'inde yaşar — burada oyun-özel dal tutulmaz.
    if (liveStatus && data.scores) {
      const statusStr = getControllerStatus(data.gameMode, this.playerIndex, data);
      if (statusStr && statusStr !== this._lastStatusStr) {
        this._lastStatusStr = statusStr;
        liveStatus.textContent = statusStr;
      }
    }
  }
}
