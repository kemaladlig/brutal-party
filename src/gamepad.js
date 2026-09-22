// Specialized Gamepad Controller for Mobile Phones in TV/Console & Online Mode
// Adapts dynamically to Lobby, Pong, Tanks, Curve, Bomb, Heist, and Archery with ultra-low latency inputs.

import { storePlayerName, escapeHtml } from './net.js';
import { showInstallToast } from './ui/toast.js';
import { UI_COLORS } from './ui/tokens.js';
import { mountDeclarativeController } from './controllers/controllerTemplates.js';
import { getControllerMeta } from './core/engineRegistry.js';
import { t, onLangChange } from './i18n.js';
import { getAvatarProfile } from './core/customizationManager.js';
import { drawBrutalAvatar } from './ui/characterRenderer.js';
import { openCustomizeModal } from './ui/customizeModal.js';

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

  // Mevcut mount'un window listener'larını sök, joystick takılı kalmasın diye
  // nötr paket gönder (zone innerHTML ile sökülmeden ÖNCE çağrılmalı)
  _teardownMount() {
    if (this._activeController?.teardown) {
      try { this._activeController.teardown(); } catch {}
      this._activeController = null;
    }
    if (this._mountAbort) {
      try { this._mountAbort.abort(); } catch {}
      this._mountAbort = null;
    }
  }

  // Sekme arka plana alınınca / sayfa kapanırken host'ta latch kalmasın
  _sendNeutralForMode() {
    try {
      if (this.gameMode === 'TANKS') {
        this.network.sendInput({ action: 'TANK_DRIVE', driving: false });
      } else if (this.gameMode === 'CURVE') {
        this.network.sendInput({ action: 'CURVE_STEER', dir: 0 });
      } else if (this.gameMode === 'BOMB' || this.gameMode === 'HEIST' || this.gameMode === 'CROWN' || this.gameMode === 'ZONE') {
        this.network.sendInput({ action: 'JOYSTICK_MOVE', dx: 0, dy: 0, angle: 0, force: 0 });
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
    this.selectedHostGame = gameMode === 'LOBBY' ? 'PONG' : gameMode;
    this.gameMode = gameMode || 'LOBBY';
    this.isReady = false;
    this.stagingOpen = false;
    this.countdownActive = false;
    // Reset manual invert flag on fresh join so auto-detection kicks in
    this._pongInvertManualSet = false;

    this._bindBrowserLocks();
    this.renderShell();
    this._bindVisibilityNeutral();
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
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.overlay.className = 'hidden';
  }

  renderShell() {
    const seatPositions = ['P1', 'P2', 'P3', 'P4'];
    const seatLabel = seatPositions[this.playerIndex] || `P${this.playerIndex + 1}`;

    this.overlay.innerHTML = `
      <div class="gamepad-header">
        <div class="player-badge-pod">
          <div class="player-indicator-dot" id="header-player-dot" style="background-color: ${this.playerColor}"></div>
          <span class="player-name-label" id="header-player-name">${this.playerName}</span>
          <span class="player-seat-tag" id="header-seat-tag">${seatLabel}</span>
        </div>
        <div class="gamepad-room-info">#${this.network.roomCode || '---'}</div>
        <div class="gamepad-header-actions">
          <button class="btn-fullscreen-toggle" id="btn-toggle-fullscreen" type="button" data-i18n-aria="pad.fullscreenTitle" title="Tam Ekran Modu">⛶</button>
          <button class="emoji-reaction-btn" id="btn-toggle-emoji" type="button" data-i18n-aria="pad.reactTitle" title="Tepki Gönder">🔥</button>
          <button class="btn-leave-gamepad" id="btn-leave-gamepad" type="button">${t('pad.leave')}</button>
        </div>
      </div>

      <div class="gamepad-sub-hud" id="gamepad-sub-hud">
        <span class="hud-game-tag" id="hud-game-tag">${t('pad.lobbyTag')}</span>
        <span class="hud-live-status" id="hud-live-status">${t('pad.waiting')}</span>
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

    const fsBtn = document.getElementById('btn-toggle-fullscreen');
    fsBtn?.addEventListener('click', () => {
      this.toggleFullscreen();
    });

    const updateFsIcon = () => {
      if (fsBtn) {
        fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
      }
    };
    document.addEventListener('fullscreenchange', updateFsIcon);

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

    const dot = document.getElementById('header-player-dot');
    const label = document.getElementById('header-player-name');
    const seatTag = document.getElementById('header-seat-tag');
    const seatPositions = ['P1', 'P2', 'P3', 'P4'];

    if (dot) dot.style.backgroundColor = this.playerColor;
    if (label) label.textContent = this.playerName;
    if (seatTag) seatTag.textContent = seatPositions[this.playerIndex] || `P${this.playerIndex + 1}`;

    // Sayaç sırasında workspace'i bozma (sayaç ekranı korunur)
    if (this.countdownActive) return;
    // Re-render current controller to update player colors/axis
    this.renderGameController(this.gameMode);
  }

  updateSlots(slots) {
    const prev = this.slots;
    this.slots = slots || [null, null, null, null];
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
    if (this.gameMode === 'BOMB' || this.gameMode === 'HEIST' || this.gameMode === 'CROWN' || this.gameMode === 'ZONE') {
      this._sendNeutralForMode();
    } else if (this.gameMode === 'TANKS' || this.gameMode === 'CURVE') {
      this._sendNeutralForMode();
    }
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

    const modeTag = document.getElementById('hud-game-tag');
    if (modeTag) {
      modeTag.textContent = CONTROLLER_META[mode]?.hudTag || mode;
    }

    if (mode === 'LOBBY') {
      document.getElementById('score-strip')?.classList.add('hidden');
      this.mountLobbyController(workspace);
    } else {
      const meta = CONTROLLER_META[mode] || {};
      workspace.innerHTML = `
        <div class="gamepad-tactical-card" id="gamepad-tactical-card">
          <div class="tactical-header-row">
            <span class="tactical-game-pill">${meta.hudTag || mode}</span>
            <button class="btn-orientation-hint" id="btn-orientation-hint" type="button" data-i18n-aria="pad.orientTitle" title="Konsol hissi için yatay çevir / tam ekran">
              <span class="hint-icon">🎮</span>
              <span class="hint-label">${t('pad.orient')}</span>
            </button>
          </div>
          <div class="tactical-role-text" id="tactical-role-text">${meta.tacticalHint || ''}</div>
        </div>
        <div class="gamepad-game-mount" id="gamepad-game-mount"></div>
      `;
      document.getElementById('btn-orientation-hint')?.addEventListener('click', () => {
        this.toggleFullscreen();
      });
      const mountTarget = document.getElementById('gamepad-game-mount') || workspace;
      if (meta.schema) {
        this._activeController = mountDeclarativeController(this, mountTarget, meta.schema);
      } else {
        const mountFn = meta.mount;
        if (mountFn && typeof this[mountFn] === 'function') this[mountFn](mountTarget);
      }
    }
  }

  // Koltuk kartı: kocaman numara + koltuk rengi + isim/BOŞ.
  // Numara + renk TV ile birebir eşleşir (P1 kırmızı, P2 mavi, P3 sarı, P4 yeşil);
  // yan etiketler bilerek yok (sadece PONG'da doğruydu, köşeli oyunlarda yanıltıcıydı).
  renderSeatButtonHtml(idx) {
    const fallbackColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const isMine = idx === this.playerIndex;
    const slotData = this.slots ? this.slots[idx] : null;
    const seatColors = [0, 1, 2, 3].map((i) => this.slots?.[i]?.color || fallbackColors[i]);
    const isBot = !isMine && slotData?.kind === 'bot';
    const isOccupied = !isMine && !isBot && slotData !== null && !!slotData.name;
    const occupantName = isMine ? this.playerName : (isOccupied || isBot ? slotData.name : '');

    let statusText = '';
    let btnClass = 'lobby-seat-btn';

    if (isMine) {
      btnClass += ' active is-mine';
      statusText = t('pad.you');
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
      <button class="${btnClass}" data-seat="${idx}" type="button"${isBot ? ' disabled' : ''}>
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

  // --- 00: LOBBY CONTROLLER (Seat Selector, Name Edit, Game Preview, Ready Toggle, Leave Room) ---
  mountLobbyController(container) {
    const selectedTitle = CONTROLLER_META[this.selectedHostGame]?.lobbyTitle || '🏓 BRUTAL PONG';

    container.innerHTML = `
      <div class="lobby-controller-view">
        ${this.stagingOpen ? `
        <!-- Interactive Seat Selector (sadece staging'de: saha açıkken) -->
        <div class="lobby-seats-card">
          <div class="lobby-seat-badge">${t('pad.seatPick')}</div>
          <div class="lobby-seats-grid">
            ${[0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('')}
          </div>
        </div>
        ` : `
        <!-- Bekleme (staging öncesi saha kapalı: koltuk seçimi yok) -->
        <div class="lobby-wait-card">
          <div class="lobby-wait-badge">${t('pad.arenaPrep')}</div>
          <div class="lobby-wait-text">${t('pad.arenaPrepText')}</div>
        </div>
        `}

        <!-- Name Edit Section -->
        <div class="lobby-name-section">
          <div class="lobby-name-label">${t('pad.yourName')}</div>
          <div class="lobby-name-row">
            <div class="lobby-name-display" id="lobby-name-display">${this.playerName}</div>
            <button class="lobby-name-edit-btn" id="btn-edit-name" type="button">${t('pad.change')}</button>
          </div>
          <div class="lobby-name-input-row hidden" id="lobby-name-input-row">
            <input type="text" class="lobby-name-input" id="input-lobby-name" maxlength="12"
              placeholder="${t('pad.namePh')}" value="${this.playerName}" autocapitalize="characters" />
            <button class="lobby-name-save-btn" id="btn-save-name" type="button">${t('pad.save')}</button>
          </div>
        </div>

        <!-- Character Section: cihaz-başı tek profil -->
        <div class="lobby-character-section">
          <div class="lobby-name-label">${t('pad.yourChar')}</div>
          <div class="lobby-character-row">
            <canvas class="lobby-character-preview" id="lobby-character-preview" width="80" height="80"></canvas>
            <button class="lobby-character-edit-btn" id="btn-edit-character" type="button">${t('pad.customize')}</button>
          </div>
          <div class="lobby-character-hint">${t('pad.charHint')}</div>
        </div>

        <div class="lobby-game-preview-card">
          <img src="/assets/games/${(this.selectedHostGame || 'PONG').toLowerCase()}.jpg" class="lobby-game-thumb-preview" alt="${escapeHtml(CONTROLLER_META[this.selectedHostGame]?.lobbyTitle || 'Oyun')}" onerror="this.style.display='none'" />
          <div class="lobby-game-text">${t('pad.game')} <b id="lobby-selected-game-text">${selectedTitle}</b></div>
        </div>

        ${this.stagingOpen ? `
        <button class="btn-ready-toggle ${this.isReady ? 'ready' : ''}" id="btn-lobby-ready" type="button">
          ${t('pad.ready')}
        </button>
        ` : ''}

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

    // Name edit toggle
    const editBtn = document.getElementById('btn-edit-name');
    const nameDisplay = document.getElementById('lobby-name-display');
    const nameInputRow = document.getElementById('lobby-name-input-row');
    const nameInput = document.getElementById('input-lobby-name');
    const saveBtn = document.getElementById('btn-save-name');

    editBtn?.addEventListener('click', () => {
      nameInputRow?.classList.remove('hidden');
      editBtn.classList.add('hidden');
      nameInput?.focus();
      nameInput?.select();
    });

    const saveName = () => {
      const newName = (nameInput?.value || '').trim().toUpperCase().slice(0, 12) || this.playerName;
      this.playerName = newName;
      if (nameDisplay) nameDisplay.textContent = newName;
      nameInputRow?.classList.add('hidden');
      editBtn?.classList.remove('hidden');
      const headerLabel = document.getElementById('header-player-name');
      if (headerLabel) {
        headerLabel.textContent = newName;
      }
      this.network.sendInput({ action: 'SET_NAME', name: newName });
      this.network.notePlayerName?.(newName);
      storePlayerName(newName);
      this.vibrate(15);
    };

    saveBtn?.addEventListener('click', saveName);
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveName();
    });

    // Karakter önizleme + özelleştirme (gerçek değişiklik host'a AVATAR_UPDATE ile gider)
    this.drawLobbyCharacterPreview();
    document.getElementById('btn-edit-character')?.addEventListener('click', () => {
      let before = '';
      try {
        if (!this.avatar) this.avatar = getAvatarProfile();
        before = JSON.stringify(this.avatar);
      } catch {}
      openCustomizeModal((profile) => {
        if (!profile) return;
        if (JSON.stringify(profile) === before) return; // bakıp kapattı, trafik yok
        this.avatar = { ...profile };
        this.playerColor = profile.color || this.playerColor;
        const dot = document.getElementById('header-player-dot');
        if (dot) dot.style.backgroundColor = this.playerColor;
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

  // --- 01: PONG CONTROLLER (tek tip alt kuşak slider) ---
  //
  // 4 koltukta da aynı yatay sürgü (alt-orta başparmak kuşağı): parmağın
  // sağa gitmesi TV'de nereye gittiğini ipucu yazar. Koltuk bazlı oto-ters
  // korunur; PADDLE_MOVE position semantiği değişmez.
  //   P1: sağ → TV sağ      P2: sağ → TV sol
  //   P3: sağ → TV alt      P4: sağ → TV üst
  mountPongController(container) {
    const seatNames = ['P1', 'P2', 'P3', 'P4'];
    const posLabel = seatNames[this.playerIndex] || `P${this.playerIndex + 1}`;

    // Koltuğa göre otomatik yön: karşıda/yan tarafta oturan ters görür
    const baseInvert = this.playerIndex === 1 || this.playerIndex === 3;

    // isPongInverted starts at baseInvert (auto), user can flip it manually
    if (!this._pongInvertManualSet) {
      this.isPongInverted = baseInvert;
    }

    // Sağa sürükleyince TV'de ne olur? (koltuk + ters modu açıklar)
    const tvTargets = [t('pad.dirRight'), t('pad.dirLeft'), t('pad.dirDown'), t('pad.dirUp')];
    const tvDir = () => {
      const base = tvTargets[this.playerIndex] || t('pad.dirRight');
      if (!this.isPongInverted) return base;
      const flip = {};
      flip[t('pad.dirRight')] = t('pad.dirLeft');
      flip[t('pad.dirLeft')] = t('pad.dirRight');
      flip[t('pad.dirDown')] = t('pad.dirUp');
      flip[t('pad.dirUp')] = t('pad.dirDown');
      return flip[base] || base;
    };
    const directionHint = () => t('pad.dragRight', tvDir());

    {
      // Üstte skor, altta sürgü+falso (başparmak kuşağı)
      container.innerHTML = `
        <div class="pong-controller-view horizontal">
            <div class="pong-live-scoreboard" id="pong-live-scoreboard">
            <div class="pong-score-pips" id="pong-score-display">${t('pad.scoreJoin', '0 - 0')}</div>
            <div class="pong-rally-badge" id="pong-rally-display">${t('pad.rally', 0)}</div>
          </div>
          <div class="pong-position-badge" style="border-color: ${this.playerColor}">${t('pad.tvPlace', posLabel)}</div>
          <div class="pong-bottom-zone">
            <div class="pong-track-wrap">
              <div class="pong-instruction" id="pong-direction-hint">${directionHint()}</div>
              <div class="pong-horizontal-track" id="pong-track">
                <div class="pong-track-thumb horizontal" id="pong-thumb" style="left: ${this.pongPosition * 100}%; background-color: ${this.playerColor}">
                  PADDLE
                </div>
              </div>
              <button class="pong-invert-btn ${this.isPongInverted !== baseInvert ? 'inverted' : ''}" id="btn-invert-axis" type="button">
                ${this.isPongInverted !== baseInvert ? t('pad.autoDir') : t('pad.flipDir')}
              </button>
            </div>
            <button class="action-spin-btn" id="btn-pong-spin" type="button">
              <span class="dash-btn-label">🌀 FALSO</span>
              <span class="dash-btn-sub">${t('pad.tap')}</span>
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

      // Falso butonu ortak soğutma deseninde (20sn host cooldown ile eşleşir)
      const spinAction = this.cooledAction(spinBtn, 20.0, '🌀 FALSO',
        () => this.network.sendInput({ action: 'SPIN' }), [30, 40, 30]);
      spinBtn?.addEventListener('click', spinAction);

      invertBtn?.addEventListener('click', () => {
        this.isPongInverted = !this.isPongInverted;
        this._pongInvertManualSet = true;
        const isManuallyFlipped = this.isPongInverted !== baseInvert;
        invertBtn.classList.toggle('inverted', isManuallyFlipped);
        invertBtn.textContent = isManuallyFlipped ? t('pad.autoDir') : t('pad.flipDir');
        if (hintEl) hintEl.textContent = directionHint();
      });

      // Ergonomik başparmak aralığı: pistin %10-90'ı TV'nin tamamına eşlenir;
      // topuz mantıksal konumda durur (göz-el uyumu)
      const mountSignal = this._mountAbort?.signal;
      const updateSliderX = (clientX) => {
        const rect = track.getBoundingClientRect();
        const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const rawNorm = relativeX / rect.width;
        const clampedNorm = Math.max(0, Math.min(1, (rawNorm - 0.10) / 0.80));
        const position = this.isPongInverted ? 1.0 - clampedNorm : clampedNorm;
        this.pongPosition = position;

        if (thumb) thumb.style.left = `${clampedNorm * 100}%`;
        this._sendAnalog({ action: 'PADDLE_MOVE', position });
      };

      track?.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches[0]) updateSliderX(e.touches[0].clientX);
      }, { passive: false });

      track?.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches[0]) updateSliderX(e.touches[0].clientX);
      }, { passive: false });
      // Parmak kesilirse (çağrı/pencere) son konum latch'te kalır — tasarım gereği
      // güvenlidir (mutlak pozisyon, sürüklenme yok); sadece kaydırma engellenir
      track?.addEventListener('touchend', (e) => { e.preventDefault(); }, { passive: false });
      track?.addEventListener('touchcancel', (e) => { e.preventDefault(); }, { passive: false });

      track?.addEventListener('mousedown', (e) => { isTrackingMouse = true; updateSliderX(e.clientX); });
      window.addEventListener('mousemove', (e) => { if (isTrackingMouse) updateSliderX(e.clientX); }, { signal: mountSignal });
      window.addEventListener('mouseup', () => { isTrackingMouse = false; }, { signal: mountSignal });
    }
  }

  // --- 02: TANKS CONTROLLER (Zamanlamalı Arcade Sürüş Pedalı + Ateş Butonu + Ammo Pips) ---
  mountTanksController(container) {
    container.innerHTML = `
      <div class="tanks-arcade-view">
        <div class="tank-drive-zone">
          <button class="tank-drive-pedal" id="btn-tank-drive" type="button" style="border-color: ${this.playerColor}">
            <span class="pedal-icon">🚀</span>
            <span class="pedal-title">${t('pad.drive')}</span>
            <span class="pedal-sub">${t('pad.pedalSub')}</span>
          </button>
        </div>
        <div class="tanks-fire-zone">
          <button class="tank-fire-btn" id="btn-tank-fire" type="button">
            <span class="fire-icon">💥</span>
            <span class="fire-title">${t('pad.fire')}</span>
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
      this.network.sendInput({ action: 'TANK_DRIVE', driving: true });
      this.vibrate(20);
    };

    const stopDrive = (e) => {
      e?.preventDefault();
      if (!isDriving) return;
      isDriving = false;
      driveBtn?.classList.remove('active');
      this.network.sendInput({ action: 'TANK_DRIVE', driving: false });
    };

    const tanksSignal = this._mountAbort?.signal;
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
      if (now - lastFireTime < 450) return;
      lastFireTime = now;
      this.network.sendInput({ action: 'TANK_FIRE' });
      this.vibrate(30);
    };

    fireBtn?.addEventListener('touchstart', fireAction, { passive: false });
    fireBtn?.addEventListener('mousedown', fireAction);
  }

  // --- 03: CURVE CONTROLLER (Left 50% Sol / Right 50% Sağ) ---
  mountCurveController(container) {
    container.innerHTML = `
      <div class="curve-controller-view" id="curve-controller-view">
        <button class="curve-steer-btn" id="btn-curve-left" type="button">${t('pad.steerLeft')}</button>
        <button class="curve-steer-btn right-btn" id="btn-curve-right" type="button">${t('pad.steerRight')}</button>
      </div>
    `;

    const view = document.getElementById('curve-controller-view');
    const btnLeft = document.getElementById('btn-curve-left');
    const btnRight = document.getElementById('btn-curve-right');

    // Aktif dokunuşların haritası: touchId -> dir (-1 veya 1)
    const activeTouches = new Map();
    let mouseDir = 0;
    let currentActiveDir = 0;

    const syncSteer = () => {
      let desiredDir = 0;
      if (activeTouches.size > 0) {
        // En son eklenen / aktif dokunuşun yönünü al
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
        this.network.sendInput({ action: 'CURVE_STEER', dir: currentActiveDir });
      }
    };

    const getDirForPoint = (clientX) => {
      const rect = view ? view.getBoundingClientRect() : null;
      if (!rect) return 0;
      return clientX < rect.left + rect.width / 2 ? -1 : 1;
    };

    // Touch event'leri container üzerinde dinlenir (buton sınırlarından çıksa bile kaybolmaz)
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

    // Ekran dışına kayıp kalkan veya takılan parmaklar için global güvenlik ağı
    const curveSignal = this._mountAbort?.signal;
    window.addEventListener('touchend', onTouchEnd, { passive: true, signal: curveSignal });
    window.addEventListener('touchcancel', onTouchCancel, { passive: true, signal: curveSignal });

    // Masaüstü / Fare desteği
    btnLeft?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = -1; syncSteer(); });
    btnRight?.addEventListener('mousedown', (e) => { e.preventDefault(); mouseDir = 1; syncSteer(); });
    const onMouseUp = () => {
      if (mouseDir !== 0) {
        mouseDir = 0;
        syncSteer();
      }
    };
    window.addEventListener('mouseup', onMouseUp, { signal: curveSignal });
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
          <button class="action-dash-btn" id="btn-bomb-dash" type="button">
            <span class="dash-btn-label">⚡ DEPAR</span>
            <span class="dash-btn-sub">${t('pad.tap')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('bomb-joy-zone', 'bomb-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const dashBtn = document.getElementById('btn-bomb-dash');
    const dashAction = this.cooledAction(dashBtn, 2.2, '⚡ DEPAR',
      () => this.network.sendInput({ action: 'DASH' }), [25, 35]);

    dashBtn?.addEventListener('touchstart', dashAction, { passive: false });
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
          <button class="action-dash-btn" id="btn-heist-tackle" type="button" style="background-color: #d99b26">
            <span class="dash-btn-label">💥 OMUZ AT</span>
            <span class="dash-btn-sub">${t('pad.tap')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('heist-joy-zone', 'heist-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const tackleBtn = document.getElementById('btn-heist-tackle');
    const tackleAction = this.cooledAction(tackleBtn, 3.5, '💥 OMUZ AT',
      () => this.network.sendInput({ action: 'TACKLE' }), [25, 40]);

    tackleBtn?.addEventListener('touchstart', tackleAction, { passive: false });
    tackleBtn?.addEventListener('mousedown', tackleAction);
  }

  // --- 06: CROWN CONTROLLER (Joystick + Shoulder Tackle) ---
  mountCrownController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="crown-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="crown-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <button class="action-dash-btn" id="btn-crown-tackle" type="button" style="background-color: #f59e0b">
            <span class="dash-btn-label">💥 OMUZ AT</span>
            <span class="dash-btn-sub">${t('pad.tap')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('crown-joy-zone', 'crown-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const tackleBtn = document.getElementById('btn-crown-tackle');
    const tackleAction = this.cooledAction(tackleBtn, 2.0, '💥 OMUZ AT',
      () => this.network.sendInput({ action: 'TACKLE' }), [25, 40]);

    tackleBtn?.addEventListener('touchstart', tackleAction, { passive: false });
    tackleBtn?.addEventListener('mousedown', tackleAction);
  }

  // --- 08: ZONE CONTROLLER (Joystick + Dash) ---
  mountZoneController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="zone-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="zone-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <button class="action-dash-btn" id="btn-zone-dash" type="button" style="background-color: #2f6a4f">
            <span class="dash-btn-label">⚡ DEPAR</span>
            <span class="dash-btn-sub">${t('pad.tap')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('zone-joy-zone', 'zone-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const dashBtn = document.getElementById('btn-zone-dash');
    const dashAction = this.cooledAction(dashBtn, 4.0, '⚡ DEPAR',
      () => this.network.sendInput({ action: 'DASH' }), [25, 35]);

    dashBtn?.addEventListener('touchstart', dashAction, { passive: false });
    dashBtn?.addEventListener('mousedown', dashAction);
  }

  // --- 09: SNAKE CONTROLLER (Arcade 4-Way D-PAD + Boost) ---
  mountSnakeController(container) {
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
          <button class="action-dash-btn snake-boost-btn" id="btn-snake-boost" type="button" style="background-color: #2F6A4F">
            <span class="dash-btn-label">⚡ HIZLAN</span>
            <span class="dash-btn-sub">${t('pad.hold')}</span>
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
      this.network.sendInput({ action: 'SNAKE_DIR', angle, dx, dy });
      this.vibrate(15);
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

    // Boost butonu
    let boosting = false;
    const startBoost = (e) => {
      e?.preventDefault();
      if (boosting) return;
      boosting = true;
      btnBoost?.classList.add('active');
      this.network.sendInput({ action: 'SNAKE_BOOST' });
      this.vibrate(20);
    };
    const stopBoost = (e) => {
      e?.preventDefault();
      if (!boosting) return;
      boosting = false;
      btnBoost?.classList.remove('active');
      this.network.sendInput({ action: 'SNAKE_BOOST_RELEASE' });
    };

    const snakeSignal = this._mountAbort?.signal;
    btnBoost?.addEventListener('touchstart', startBoost, { passive: false });
    btnBoost?.addEventListener('touchend', stopBoost, { passive: false });
    btnBoost?.addEventListener('touchcancel', stopBoost, { passive: false });
    window.addEventListener('touchend', stopBoost, { passive: true, signal: snakeSignal });
    window.addEventListener('touchcancel', stopBoost, { passive: true, signal: snakeSignal });
    btnBoost?.addEventListener('mousedown', startBoost);
    btnBoost?.addEventListener('mouseup', stopBoost);
    btnBoost?.addEventListener('mouseleave', stopBoost);
  }

  // --- 10: LASER CONTROLLER (Joystick move+aim + FIRE + DASH) ---
  mountLaserController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="laser-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="laser-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <div class="laser-actions-cluster">
            <button class="action-dash-btn laser-btn-fire" id="btn-laser-fire" type="button">
              <span class="dash-btn-label">${t('pad.fireGun')}</span>
              <span class="dash-btn-sub">${t('pad.tap')}</span>
            </button>
            <button class="action-dash-btn laser-btn-dash" id="btn-laser-dash" type="button">
              <span class="dash-btn-label">💨 DASH</span>
              <span class="dash-btn-sub">${t('pad.tap')}</span>
            </button>
          </div>
        </div>
      </div>
    `;

    this.bindJoystick('laser-joy-zone', 'laser-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const fireBtn = document.getElementById('btn-laser-fire');
    const fireAction = this.cooledAction(fireBtn, 0.9, t('pad.fireGun'),
      () => this.network.sendInput({ action: 'TANK_FIRE' }), [25, 40]);
    fireBtn?.addEventListener('touchstart', fireAction, { passive: false });
    fireBtn?.addEventListener('mousedown', fireAction);

    const dashBtn = document.getElementById('btn-laser-dash');
    const dashAction = this.cooledAction(dashBtn, 4.0, '💨 DASH',
      () => this.network.sendInput({ action: 'DASH' }), [25, 35]);
    dashBtn?.addEventListener('touchstart', dashAction, { passive: false });
    dashBtn?.addEventListener('mousedown', dashAction);

    // Host bekleme yüzdesi butona yansır (paketteki cd dizisi)
    this._laserDashBtn = dashBtn;
  }

  // --- 11: CLONE CONTROLLER (Joystick + TACKLE, 1.5s host cooldown) ---
  mountCloneController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="clone-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="clone-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <button class="action-dash-btn" id="btn-clone-tackle" type="button" style="background-color: #6A4C93">
            <span class="dash-btn-label">💥 OMUZ AT</span>
            <span class="dash-btn-sub">${t('pad.tap')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('clone-joy-zone', 'clone-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const tackleBtn = document.getElementById('btn-clone-tackle');
    const tackleAction = this.cooledAction(tackleBtn, 1.6, '💥 OMUZ AT',
      () => this.network.sendInput({ action: 'TACKLE' }), [25, 40]);
    tackleBtn?.addEventListener('touchstart', tackleAction, { passive: false });
    tackleBtn?.addEventListener('mousedown', tackleAction);

    // Host bekleme yüzdesi butona yansır (paketteki cd dizisi)
    this._cloneCdBtn = tackleBtn;
  }

  // --- 12: COLLAPSE CONTROLLER (Joystick + JUMP, 1.8s host cooldown) ---
  mountCollapseController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="collapse-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="collapse-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half">
          <button class="action-dash-btn" id="btn-collapse-jump" type="button" style="background-color: #B5831F">
            <span class="dash-btn-label">⤴️ ZIPLA</span>
            <span class="dash-btn-sub">${t('pad.tap')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('collapse-joy-zone', 'collapse-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const jumpBtn = document.getElementById('btn-collapse-jump');
    const jumpAction = this.cooledAction(jumpBtn, 1.6, '⤴️ ZIPLA',
      () => this.network.sendInput({ action: 'DASH' }), [25, 40]);
    jumpBtn?.addEventListener('touchstart', jumpAction, { passive: false });
    jumpBtn?.addEventListener('mousedown', jumpAction);
  }

  // --- 13: NINJA CONTROLLER (Joystick + STRIKE 1.3s + SMOKE BOMB 5s) ---
  mountNinjaController(container) {
    container.innerHTML = `
      <div class="joystick-action-view">
        <div class="joystick-half" id="ninja-joy-zone">
          <div class="phone-joy-base">
            <div class="phone-joy-knob" id="ninja-joy-knob" style="background-color: ${this.playerColor}"></div>
          </div>
        </div>
        <div class="action-half" style="display: flex; flex-direction: column; gap: 10px; justify-content: center; height: 100%;">
          <button class="action-dash-btn" id="btn-ninja-strike" type="button" style="background-color: #1A1A1A; flex: 1.2; min-height: 80px;">
            <span class="dash-btn-label">${t('pad.blade')}</span>
            <span class="dash-btn-sub">${t('pad.lunge')}</span>
          </button>
          <button class="action-dash-btn" id="btn-ninja-smoke" type="button" style="background-color: #333333; border-color: #555555; flex: 0.9; min-height: 60px;">
            <span class="dash-btn-label">${t('pad.smoke')}</span>
            <span class="dash-btn-sub">${t('pad.hide')}</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('ninja-joy-zone', 'ninja-joy-knob', (input) => {
      this._sendAnalog({ action: 'JOYSTICK_MOVE', ...input });
    });

    const strikeBtn = document.getElementById('btn-ninja-strike');
    const strikeAction = this.cooledAction(strikeBtn, 1.3, t('pad.blade'),
      () => this.network.sendInput({ action: 'DASH' }), [25, 40]);
    strikeBtn?.addEventListener('touchstart', strikeAction, { passive: false });
    strikeBtn?.addEventListener('mousedown', strikeAction);

    const smokeBtn = document.getElementById('btn-ninja-smoke');
    const smokeAction = this.cooledAction(smokeBtn, 5.0, t('pad.smokeShort'),
      () => this.network.sendInput({ action: 'NINJA_SMOKE' }), [20, 35]);
    smokeBtn?.addEventListener('touchstart', smokeAction, { passive: false });
    smokeBtn?.addEventListener('mousedown', smokeAction);
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
    const dx = clientX - cx;
    const dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    const clampedDist = Math.min(maxR, dist);
    const angle = Math.atan2(dy, dx);

    const knobX = Math.cos(angle) * clampedDist;
    const knobY = Math.sin(angle) * clampedDist;
    knobEl.style.transform = `translate(${knobX}px, ${knobY}px)`;

    const rawForce = clampedDist / maxR;
    // 8% deadband to eliminate resting thumb jitter
    const deadzone = 0.08;
    const force = rawForce < deadzone ? 0 : (rawForce - deadzone) / (1 - deadzone);

    onInput({
      dx: Math.cos(angle) * force,
      dy: Math.sin(angle) * force,
      angle,
      force,
    });

    return rawForce >= 0.98;
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

    // Update live status text
    if (liveStatus && data.scores) {
      let statusStr = '';
      if (data.gameMode === 'PONG') {
        statusStr = t('pad.rallyLive', data.rally || 0, data.scores.slice(0, 4).join('-'));
        const scoreDisp = this._el('pong-score-display');
        const rallyDisp = this._el('pong-rally-display');
        if (scoreDisp && data.scores) {
          // İsimler varsa kimin skoru olduğu görünür: "AHMET 2 • MEHMET 1"
          const scoreTxt = Array.isArray(data.names)
            ? data.scores.slice(0, 4).map((s, i) => `${data.names[i] || `P${i + 1}`} ${s}`).join(' • ')
            : t('pad.scoreJoin', data.scores.slice(0, 4).join(' - '));
          if (scoreDisp.textContent !== scoreTxt) scoreDisp.textContent = scoreTxt;
        }
        if (rallyDisp && data.rally !== undefined) {
          const rallyTxt = t('pad.rally', data.rally);
          if (rallyDisp.textContent !== rallyTxt) rallyDisp.textContent = rallyTxt;
        }
        const spinBtn = this._el('btn-pong-spin');
        if (spinBtn) {
          const label = spinBtn.querySelector('.dash-btn-label');
          const sub = spinBtn.querySelector('.dash-btn-sub');
          const cd = Array.isArray(data.cd) ? (data.cd[this.playerIndex] || 0) : 0;
          const isCharged = data.chgIdx === this.playerIndex;
          // Host cooldown gerçek kaynaktır; lokal 20sn sayacı yalnızca görseldir
          const txt = cd > 0 && !isCharged ? `⏳ ${cd}sn` : (isCharged ? `🌀 ${(data.chgT || 0).toFixed(1)}sn` : '🌀 FALSO');
          if (label && label.textContent !== txt) label.textContent = txt;
          if (sub) {
            const subTxt = isCharged ? t('pad.charged') : (cd > 0 ? t('pad.filling') : t('pad.tap'));
            if (sub.textContent !== subTxt) sub.textContent = subTxt;
          }
        }
        if (rallyDisp && data.spn) {
          const spn = t('pad.spinning');
          if (rallyDisp.textContent !== spn) rallyDisp.textContent = spn;
        }
      } else if (data.gameMode === 'TANKS') {
        const dead = Array.isArray(data.alive) ? data.alive[this.playerIndex] === false : false;
        statusStr = dead ? t('pad.dead', data.scores.join('-')) : t('pad.scoreJoin', data.scores.join('-'));
      } else if (data.gameMode === 'CURVE') {
        const dead = Array.isArray(data.alive) ? data.alive[this.playerIndex] === false : false;
        statusStr = dead ? t('pad.dead', data.scores.join('-')) : t('pad.scoreJoin', data.scores.join('-'));
      } else if (data.gameMode === 'BOMB') {
        const timeStr = data.bombTime !== undefined ? `${data.bombTime}s` : '';
        statusStr = data.carrier === this.playerIndex
          ? t('pad.bombYou', timeStr)
          : (data.carrier === -1 || data.carrier === null || data.carrier === undefined
            ? t('pad.bombFree', timeStr)
            : t('pad.bombAt', data.carrier + 1, timeStr));
      } else if (data.gameMode === 'HEIST') {
        const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
        const myCarried = Array.isArray(data.carried) ? (data.carried[this.playerIndex] ?? 0) : 0;
        const myVault = Array.isArray(data.vault) ? (data.vault[this.playerIndex] ?? 0) : 0;
        statusStr = t('pad.heistStatus', timeStr, myCarried, myVault);
      } else if (data.gameMode === 'CROWN') {
        const isKing = data.king === this.playerIndex;
        const myTime = data.crownTimes ? (data.crownTimes[this.playerIndex] || 0).toFixed(1) : '0.0';
        statusStr = isKing
          ? t('pad.kingYou', myTime)
          : (data.king !== null && data.king !== undefined ? t('pad.kingAt', data.king + 1, myTime) : t('pad.crownFree', myTime));
      } else if (data.gameMode === 'ZONE') {
        const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
        const myPct = Array.isArray(data.pct) ? (data.pct[this.playerIndex] ?? 0) : 0;
        const leadPct = Array.isArray(data.pct) && data.leader >= 0 ? (data.pct[data.leader] ?? 0) : 0;
        const leadName = Array.isArray(data.names) && data.leader >= 0 ? (data.names[data.leader] || `P${data.leader + 1}`) : '';
        statusStr = data.leader === this.playerIndex
          ? t('pad.zoneLead', myPct, timeStr)
          : t('pad.zoneChase', timeStr, myPct, leadName, leadPct);
      } else if (data.gameMode === 'SNAKE') {
        const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
        const dead = Array.isArray(data.alive) ? data.alive[this.playerIndex] === false : false;
        const nrg = Array.isArray(data.nrg) ? (data.nrg[this.playerIndex] ?? 100) : 100;
        const locked = Array.isArray(data.lock) ? !!data.lock[this.playerIndex] : false;
        statusStr = dead
          ? t('pad.dead', data.scores.join('-'))
          : `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.nrg', nrg)}${locked ? ` ${t('pad.locked')}` : ''} • ${t('pad.snakeAlive', aliveCount)}`;
      } else if (data.gameMode === 'LASER') {
        const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
        const myHp = Array.isArray(data.hp) ? (data.hp[this.playerIndex] ?? 0) : 0;
        statusStr = `${t('pad.scoreJoin', data.scores.join('-'))} • ❤${myHp} • ⏱ ${timeStr}`;
        // Host bekleme yüzdesi: dolmadan buton sönük görünür
        const dashBtn = this._laserDashBtn;
        const cdPct = Array.isArray(data.cd) ? (data.cd[this.playerIndex] || 0) : 0;
        if (dashBtn && dashBtn.isConnected) {
          dashBtn.style.opacity = cdPct > 0 ? 0.55 : 1;
        }
      } else if (data.gameMode === 'CLONE') {
        const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
        const dead = Array.isArray(data.alive) ? data.alive[this.playerIndex] === false : false;
        statusStr = dead
          ? t('pad.dead', data.scores.join('-'))
          : `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.cloneAlive', aliveCount)}`;
        // Host bekleme yüzdesi: dolmadan buton sönük görünür
        const cdBtn = this._cloneCdBtn;
        const cdPct = Array.isArray(data.cd) ? (data.cd[this.playerIndex] || 0) : 0;
        if (cdBtn && cdBtn.isConnected) {
          cdBtn.style.opacity = cdPct > 0 ? 0.55 : 1;
        }
      } else if (data.gameMode === 'COLLAPSE') {
        const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
        const dead = Array.isArray(data.alive) ? data.alive[this.playerIndex] === false : false;
        statusStr = dead
          ? t('pad.dead', data.scores.join('-'))
          : `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.collapseAlive', aliveCount)}`;
        const jumpBtn = this._el('btn-collapse-jump');
        const cdPct = Array.isArray(data.cd) ? (data.cd[this.playerIndex] || 0) : 0;
        if (jumpBtn) {
          jumpBtn.style.opacity = cdPct > 0 ? 0.55 : 1;
        }
      } else if (data.gameMode === 'NINJA') {
        const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
        const dead = Array.isArray(data.alive) ? data.alive[this.playerIndex] === false : false;
        statusStr = dead
          ? t('pad.dead', data.scores.join('-'))
          : `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.ninjaAlive', aliveCount)}`;
        const strikeBtn = this._el('btn-ninja-strike');
        const cdPct = Array.isArray(data.cd) ? (data.cd[this.playerIndex] || 0) : 0;
        if (strikeBtn) {
          strikeBtn.style.opacity = cdPct > 0 ? 0.55 : 1;
        }
      }
      if (statusStr !== this._lastStatusStr) {
        this._lastStatusStr = statusStr;
        liveStatus.textContent = statusStr;
      }
    }

    const tacticalRoleEl = document.getElementById('tactical-role-text');

    // 1. Bomb Alert
    if (this.gameMode === 'BOMB') {
      const isCarrier = data.carrier === this.playerIndex;
      this.overlay.classList.toggle('bomb-carrier-alert', isCarrier);
      if (tacticalRoleEl) {
        tacticalRoleEl.textContent = isCarrier
          ? t('pad.bombCarry')
          : t('pad.bombSafe');
        tacticalRoleEl.style.color = isCarrier ? '#ff6b6b' : '#25d366';
      }
    } else {
      this.overlay.classList.remove('bomb-carrier-alert');
    }

    // 2. Heist Alert (pakette carried/vault var — en çok taşıyan vurgulanır)
    if (this.gameMode === 'HEIST' && Array.isArray(data.carried)) {
      let lead = -1;
      let max = 0;
      data.carried.forEach((c, i) => {
        if ((c || 0) > max) { max = c || 0; lead = i; }
      });
      const isLead = lead === this.playerIndex && max > 0;
      this.overlay.classList.toggle('gem-carrier-alert', isLead);
      if (tacticalRoleEl) {
        tacticalRoleEl.textContent = isLead
          ? t('pad.heistLead')
          : lead >= 0 && max > 0
            ? t('pad.heistChase', lead + 1)
            : t('pad.heistGrab');
        tacticalRoleEl.style.color = isLead ? '#ffd700' : '#ffffff';
      }
    } else {
      this.overlay.classList.remove('gem-carrier-alert');
    }

    // 2.5. Crown King Alert
    if (this.gameMode === 'CROWN') {
      const isKing = data.king === this.playerIndex;
      this.overlay.classList.toggle('crown-king-alert', isKing);
      if (tacticalRoleEl) {
        tacticalRoleEl.textContent = isKing
          ? t('pad.kingKeep')
          : t('pad.kingSteal');
        tacticalRoleEl.style.color = isKing ? '#ffd700' : '#ffffff';
      }
    } else {
      this.overlay.classList.remove('crown-king-alert');
    }

    // 3. Tanks Ammo Pips Sync (dolan pip gri + ilerleme çubuğu)
    if (this.gameMode === 'TANKS' && Array.isArray(data.ammo)) {
      const raw = data.ammo[this.playerIndex];
      const n = typeof raw === 'number' ? raw : (raw?.n ?? 0);
      const load = typeof raw === 'object' ? (raw?.load ?? 0) : 0;
      const ammoPips = document.querySelectorAll('#tank-ammo-hud .cartridge-pip');
      ammoPips.forEach((pip, idx) => {
        pip.classList.toggle('loaded', idx < n);
        if (idx === n && load > 0) {
          pip.classList.remove('loaded');
          const pct = Math.round(load * 100);
          pip.style.background = `linear-gradient(90deg, ${this.playerColor} ${pct}%, #3a3835 ${pct}%)`;
        } else {
          pip.style.background = '';
        }
      });
    }
  }
}
