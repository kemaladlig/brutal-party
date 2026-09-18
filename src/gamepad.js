// Specialized Gamepad Controller for Mobile Phones in TV/Console & Online Mode
// Adapts dynamically to Lobby, Pong, Tanks, Curve, Bomb, Heist, and Duel with ultra-low latency inputs.

import { storePlayerName } from './net.js';

// Kumanda kayıt tablosu: yeni oyun = 1 satır (etiketler + mount fonksiyonu).
// mount: GamepadManager prototype metot adı (string) olarak tutulur.
const CONTROLLER_META = {
  LOBBY: { hudTag: '📺 PARTİ LOBİSİ' },
  PONG: { hudTag: '🏓 PONG', lobbyTitle: '🏓 BRUTAL PONG', mount: 'mountPongController' },
  TANKS: { hudTag: '🛡️ TANKS', lobbyTitle: '🛡️ MICRO-TANKS', mount: 'mountTanksController' },
  CURVE: { hudTag: '🐍 CURVE', lobbyTitle: '🐍 BRUTAL CURVE', mount: 'mountCurveController' },
  BOMB: { hudTag: '💣 BOMB', lobbyTitle: '💣 BRUTAL BOMB', mount: 'mountBombController' },
  HEIST: { hudTag: '💰 HEIST', lobbyTitle: '💰 BRUTAL HEIST', mount: 'mountHeistController' },
  DUEL: { hudTag: '🤠 DUEL', lobbyTitle: '🤠 QUICK DRAW', mount: 'mountDuelController' },
  CROWN: { hudTag: '👑 CROWN', lobbyTitle: '👑 BRUTAL CROWN', mount: 'mountCrownController' },
};

export class GamepadManager {
  constructor(overlayEl, network) {
    this.overlay = overlayEl;
    this.network = network;
    this.gameMode = 'LOBBY';
    this.selectedHostGame = 'PONG';
    this.playerIndex = 0;
    this.playerName = 'OYUNCU 1';
    this.playerColor = '#D84727';
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

    // Duel state
    this.duelState = 'WAIT';
    this.duelReactionMs = null;

    // Emoji reaction state
    this.isEmojiOpen = false;

    // Slots occupancy state from host
    this.slots = [null, null, null, null];
    // İki kademeli başlatma: staging açılmadan koltuk seçimi gösterilmez
    this.stagingOpen = false;
    this.countdownActive = false;
  }

  init(playerInfo, gameMode = 'LOBBY') {
    this.playerIndex = playerInfo.slotIndex ?? 0;
    this.playerName = (playerInfo.name || `OYUNCU ${this.playerIndex + 1}`).toUpperCase();
    this.playerColor = playerInfo.color || '#D84727';
    this.slots = playerInfo.slots || [null, null, null, null];
    this.selectedHostGame = gameMode === 'LOBBY' ? 'PONG' : gameMode;
    this.gameMode = gameMode || 'LOBBY';
    this.isReady = false;
    this.stagingOpen = false;
    this.countdownActive = false;
    // Reset manual invert flag on fresh join so auto-detection kicks in
    this._pongInvertManualSet = false;

    this.renderShell();
    this.renderGameController(this.gameMode);
    this.overlay.classList.remove('hidden');
  }

  hide() {
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML = '';
    this.overlay.className = 'hidden';
  }

  renderShell() {
    const seatPositions = ['P1 (ALT)', 'P2 (ÜST)', 'P3 (SOL)', 'P4 (SAĞ)'];
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
          <button class="emoji-reaction-btn" id="btn-toggle-emoji" type="button" title="Tepki Gönder">🔥</button>
          <button class="btn-leave-gamepad" id="btn-leave-gamepad" type="button">AYRIL</button>
        </div>
      </div>

      <div class="gamepad-sub-hud" id="gamepad-sub-hud">
        <span class="hud-game-tag" id="hud-game-tag">📺 PARTİ LOBİSİ</span>
        <span class="hud-live-status" id="hud-live-status">BEKLENİYOR...</span>
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

  updateSlot(newSlot, newColor) {
    this.playerIndex = newSlot;
    if (newColor) this.playerColor = newColor;
    // Reset manual invert so new seat's auto-direction is applied
    this._pongInvertManualSet = false;

    const dot = document.getElementById('header-player-dot');
    const label = document.getElementById('header-player-name');
    const seatTag = document.getElementById('header-seat-tag');
    const seatPositions = ['P1 (ALT)', 'P2 (ÜST)', 'P3 (SOL)', 'P4 (SAĞ)'];

    if (dot) dot.style.backgroundColor = this.playerColor;
    if (label) label.textContent = this.playerName;
    if (seatTag) seatTag.textContent = seatPositions[this.playerIndex] || `P${this.playerIndex + 1}`;

    // Sayaç sırasında workspace'i bozma (sayaç ekranı korunur)
    if (this.countdownActive) return;
    // Re-render current controller to update player colors/axis
    this.renderGameController(this.gameMode);
  }

  updateSlots(slots) {
    this.slots = slots || [null, null, null, null];
    if (this.gameMode === 'LOBBY') {
      this.refreshLobbySeats();
    }
  }

  // İsimli skor şeridi (sub-HUD): koltuk rengi + isim + skor. PONG hariç tüm
  // oyun modlarında görünür (PONG'un kendi canlı skorbord'u isim alır).
  renderScoreStrip(names, scores) {
    const strip = document.getElementById('score-strip');
    if (!strip) return;
    if (this.gameMode === 'LOBBY' || !Array.isArray(names) || !Array.isArray(scores)) {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      return;
    }
    if (this.gameMode === 'PONG') {
      strip.classList.add('hidden');
      strip.innerHTML = '';
      return;
    }
    const seatColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const seatTags = ['P1', 'P2', 'P3', 'P4'];
    strip.innerHTML = [0, 1, 2, 3].map((idx) => {
      const name = names[idx];
      const isEmpty = !name;
      const isMine = idx === this.playerIndex;
      return `
        <div class="score-chip${isMine ? ' is-mine' : ''}${isEmpty ? ' is-empty' : ''}">
          <span class="score-dot" style="background-color: ${seatColors[idx]}"></span>
          <span class="score-name">${isEmpty ? 'BOŞ' : name}</span>
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
    if (gameMode) this.selectedHostGame = gameMode;
    this.renderGameController('LOBBY');
  }

  // Geri sayım tik'i: koltuklar kilitlenir, sayaç ekranı basılır
  showCountdown(t) {
    this.countdownActive = true;
    const workspace = document.getElementById('gamepad-workspace');
    if (!workspace) return;
    workspace.innerHTML = `
      <div class="countdown-view">
        <div class="countdown-badge">⏳ MAÇ BAŞLIYOR</div>
        <div class="countdown-number">${t > 0 ? t : 'BAŞLA!'}</div>
        <div class="countdown-sub">TELEFONU TUT • EKRANA BAK</div>
      </div>
    `;
    if (navigator.vibrate) navigator.vibrate(t > 0 ? 40 : [40, 60, 80]);
  }

  // Staging/sayaç durumunu sıfırla (oyun başladı veya lobiye dönüldü)
  exitStaging() {
    this.stagingOpen = false;
    this.countdownActive = false;
  }

  renderGameController(mode) {
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
      const mountFn = CONTROLLER_META[mode]?.mount;
      if (mountFn && typeof this[mountFn] === 'function') this[mountFn](workspace);
    }
  }

  renderSeatButtonHtml(idx) {
    const seatNames = ['P1 (ALT)', 'P2 (ÜST)', 'P3 (SOL)', 'P4 (SAĞ)'];
    const seatColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const isMine = idx === this.playerIndex;
    const slotData = this.slots ? this.slots[idx] : null;
    const isBot = !isMine && slotData?.kind === 'bot';
    const isOccupied = !isMine && !isBot && slotData !== null && !!slotData.name;
    const occupantName = isMine ? this.playerName : (isOccupied || isBot ? slotData.name : '');

    let statusText = '';
    let btnClass = 'lobby-seat-btn';

    if (isMine) {
      btnClass += ' active is-mine';
      statusText = '✓ SİZİN YERİNİZ';
    } else if (isBot) {
      btnClass += ' is-bot';
      statusText = '🤖 BOT KOLTUĞU';
    } else if (isOccupied) {
      btnClass += ' is-occupied';
      statusText = `${occupantName} • YERİ DEĞİŞ ⇄`;
    } else {
      btnClass += ' is-empty';
      statusText = 'BOŞ • BURAYA GEÇ →';
    }

    return `
      <button class="${btnClass}" data-seat="${idx}" type="button"${isBot ? ' disabled' : ''}>
        <span class="seat-dot" style="background-color: ${seatColors[idx]}"></span>
        <div class="seat-details">
          <div class="seat-header-line">
            <span class="seat-name">${seatNames[idx]}</span>
            ${isOccupied || isBot ? `<span class="seat-occupant-badge">${occupantName}</span>` : ''}
            ${!isMine && !isOccupied && !isBot ? `<span class="seat-empty-badge">BOŞ</span>` : ''}
          </div>
          <span class="seat-status">${statusText}</span>
        </div>
      </button>
    `;
  }

  refreshLobbySeats() {
    const grid = this.overlay.querySelector('.lobby-seats-grid');
    if (!grid) return;
    grid.innerHTML = [0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('');
    grid.querySelectorAll('.lobby-seat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.countdownActive) return;
        const targetSlot = parseInt(btn.dataset.seat, 10);
        if (targetSlot === this.playerIndex) return;
        // Bot koltukları kilitlidir — ne hedef ne kaynak olur
        if (this.slots?.[targetSlot]?.kind === 'bot') return;
        if (this.slots?.[this.playerIndex]?.kind === 'bot') return;
        this.network.sendInput({ action: 'SWITCH_SLOT', targetSlot });
        if (navigator.vibrate) navigator.vibrate(30);
      });
    });
  }

  // Hazır bayrağını sıfırla (lobiye dönüşte / yeni oyunda takılı kalmasın).
  // Host tarafı zaten sıfırlar; ekstra trafik yok.
  resetReady() {
    this.isReady = false;
    const readyBtn = document.getElementById('btn-lobby-ready');
    if (readyBtn) {
      readyBtn.classList.remove('ready');
      readyBtn.textContent = 'HAZIRIM';
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
          <div class="lobby-seat-badge">💺 KOLTUĞUNUZU SEÇİN</div>
          <div class="lobby-seats-grid">
            ${[0, 1, 2, 3].map((idx) => this.renderSeatButtonHtml(idx)).join('')}
          </div>
        </div>
        ` : `
        <!-- Bekleme (staging öncesi saha kapalı: koltuk seçimi yok) -->
        <div class="lobby-wait-card">
          <div class="lobby-wait-badge">🏟 SAHA HAZIRLANIYOR</div>
          <div class="lobby-wait-text">Host sahayı açınca koltuğunu seçeceksin.<br>İsmini kontrol et, hazır bekle!</div>
        </div>
        `}

        <!-- Name Edit Section -->
        <div class="lobby-name-section">
          <div class="lobby-name-label">👤 İSMİNİZ</div>
          <div class="lobby-name-row">
            <div class="lobby-name-display" id="lobby-name-display">${this.playerName}</div>
            <button class="lobby-name-edit-btn" id="btn-edit-name" type="button">✏️ DEĞİŞTİR</button>
          </div>
          <div class="lobby-name-input-row hidden" id="lobby-name-input-row">
            <input type="text" class="lobby-name-input" id="input-lobby-name" maxlength="12"
              placeholder="İSMİNİZ" value="${this.playerName}" autocapitalize="characters" />
            <button class="lobby-name-save-btn" id="btn-save-name" type="button">✓ KAYDET</button>
          </div>
        </div>

        <div class="lobby-game-preview-card">
          <img src="/assets/games/${(this.selectedHostGame || 'PONG').toLowerCase()}.jpg" class="lobby-game-thumb-preview" alt="Game" onerror="this.style.display='none'" />
          <div class="lobby-game-text">OYUN: <b id="lobby-selected-game-text">${selectedTitle}</b></div>
        </div>

        ${this.stagingOpen ? `
        <button class="btn-ready-toggle ${this.isReady ? 'ready' : ''}" id="btn-lobby-ready" type="button">
          ${this.isReady ? '✓ HAZIR' : 'HAZIRIM'}
        </button>
        ` : ''}

        <button class="btn-leave-lobby-direct" id="btn-leave-lobby-direct" type="button">
          🚪 ODADAN AYRIL
        </button>
      </div>
    `;

    // Seat switch click handlers
    container.querySelectorAll('.lobby-seat-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.countdownActive) return;
        const targetSlot = parseInt(btn.dataset.seat, 10);
        if (targetSlot === this.playerIndex) return;
        if (this.slots?.[targetSlot]?.kind === 'bot') return;
        if (this.slots?.[this.playerIndex]?.kind === 'bot') return;
        this.network.sendInput({ action: 'SWITCH_SLOT', targetSlot });
        if (navigator.vibrate) navigator.vibrate(30);
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
      storePlayerName(newName);
      if (navigator.vibrate) navigator.vibrate(15);
    };

    saveBtn?.addEventListener('click', saveName);
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveName();
    });

    const readyBtn = document.getElementById('btn-lobby-ready');
    readyBtn?.addEventListener('click', () => {
      this.isReady = !this.isReady;
      readyBtn.classList.toggle('ready', this.isReady);
      readyBtn.textContent = this.isReady ? '✓ HAZIRSINIZ!' : '⏳ HAZIRIM — DOKUN';
      this.network.setReady(this.isReady);
      if (navigator.vibrate) navigator.vibrate(this.isReady ? [20, 30] : 15);
    });

    // Leave room
    document.getElementById('btn-leave-lobby-direct')?.addEventListener('click', () => {
      if (confirm('Odadan ayrılmak istediğinize emin misiniz?')) {
        this.network.disconnect();
        this.hide();
        window.location.href = window.location.pathname;
      }
    });
  }

  // --- 01: PONG CONTROLLER (Orientation Aware Horizontal/Vertical Slider) ---
  //
  // AXIS SYNC LOGIC:
  //   TV sahası: sol = minCoord (0.0), sağ = maxCoord (1.0)  [horizontal paddles]
  //              üst = minCoord (0.0), alt = maxCoord (1.0)  [vertical paddles]
  //
  //   P1 (ALT): TV'ye bakarak oturulur → telefon sola = TV sol  → baseInvert = false
  //   P2 (ÜST): TV'ye arkası dönük   → telefon sola = TV sağ  → baseInvert = true
  //   P3 (SOL): Sağ yanında TV var   → parmak yukarı = paddle yukarı → baseInvert = false
  //   P4 (SAĞ): Sol yanında TV var   → parmak yukarı = TV'de aşağı  → baseInvert = true
  mountPongController(container) {
    const isHorizontal = this.playerIndex === 0 || this.playerIndex === 1;
    const seatNames = [
      'P1 // ALT KALE (KIRMIZI)',
      'P2 // ÜST KALE (MAVİ)',
      'P3 // SOL KALE (SARI)',
      'P4 // SAĞ KALE (YEŞİL)',
    ];
    const posLabel = seatNames[this.playerIndex] || `P${this.playerIndex + 1}`;

    // Auto-detect base inversion based on seating perspective:
    // P2 sits opposite side of TV (inverted X), P4 sits on right side (inverted Y)
    const baseInvert = this.playerIndex === 1 || this.playerIndex === 3;

    // isPongInverted starts at baseInvert (auto), user can flip it manually
    if (!this._pongInvertManualSet) {
      this.isPongInverted = baseInvert;
    }

    const directionHint = isHorizontal
      ? (this.isPongInverted ? '▶ SAĞA → TV Sol  |  Sola → TV Sağ ◀' : '◀ SOLA → TV Sol  |  Sağa → TV Sağ ▶')
      : (this.isPongInverted ? '▲ YUKARI → TV Alt  |  Aşağı → TV Üst ▼' : '▲ YUKARI → TV Üst  |  Aşağı → TV Alt ▼');

    if (isHorizontal) {
      // P1 & P2: Horizontal Slider with Live Scoreboard & Ergonomic Thumb Curve
      container.innerHTML = `
        <div class="pong-controller-view horizontal">
          <div class="pong-live-scoreboard" id="pong-live-scoreboard">
            <div class="pong-score-pips" id="pong-score-display">SKOR: 0 - 0</div>
            <div class="pong-rally-badge" id="pong-rally-display">⚡ RALLİ: 0</div>
          </div>
          <div class="pong-position-badge" style="border-color: ${this.playerColor}">📺 TV YERİ: ${posLabel}</div>
          <div class="pong-instruction" id="pong-direction-hint">${directionHint}</div>
          <div class="pong-horizontal-track" id="pong-track">
            <div class="pong-track-thumb horizontal" id="pong-thumb" style="left: ${this.pongPosition * 100}%; background-color: ${this.playerColor}">
              PADDLE
            </div>
          </div>
          <button class="pong-invert-btn ${this.isPongInverted !== baseInvert ? 'inverted' : ''}" id="btn-invert-axis" type="button">
            ${this.isPongInverted !== baseInvert ? '↺ OTOMATİK YÖN (DOKUN)' : '↺ YÖNÜ TERS ÇEVİR'}
          </button>
        </div>
      `;

      const track = document.getElementById('pong-track');
      const thumb = document.getElementById('pong-thumb');
      const invertBtn = document.getElementById('btn-invert-axis');
      const hintEl = document.getElementById('pong-direction-hint');
      let isTrackingMouse = false;

      invertBtn?.addEventListener('click', () => {
        this.isPongInverted = !this.isPongInverted;
        this._pongInvertManualSet = true;
        const isManuallyFlipped = this.isPongInverted !== baseInvert;
        invertBtn.classList.toggle('inverted', isManuallyFlipped);
        invertBtn.textContent = isManuallyFlipped ? '↺ OTOMATİK YÖN (DOKUN)' : '↺ YÖNÜ TERS ÇEVİR';
        if (hintEl) {
          hintEl.textContent = this.isPongInverted
            ? '▶ SAĞA → TV Sol  |  Sola → TV Sağ ◀'
            : '◀ SOLA → TV Sol  |  Sağa → TV Sağ ▶';
        }
      });

      // Ergonomik başparmak aralığı: Ekranın en dışına uzanmaya gerek kalmadan %10-%90 merkez aralığını 0.0-1.0 TV koordinatına eşler
      const updateSliderX = (clientX) => {
        const rect = track.getBoundingClientRect();
        const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left));
        const rawNorm = relativeX / rect.width;
        const clampedNorm = Math.max(0, Math.min(1, (rawNorm - 0.10) / 0.80));
        const position = this.isPongInverted ? 1.0 - clampedNorm : clampedNorm;
        this.pongPosition = position;

        if (thumb) thumb.style.left = `${rawNorm * 100}%`;
        this.network.sendInput({ action: 'PADDLE_MOVE', position });
      };

      track?.addEventListener('touchstart', (e) => {
        if (e.touches[0]) updateSliderX(e.touches[0].clientX);
      }, { passive: true });

      track?.addEventListener('touchmove', (e) => {
        if (e.touches[0]) updateSliderX(e.touches[0].clientX);
      }, { passive: true });

      track?.addEventListener('mousedown', (e) => { isTrackingMouse = true; updateSliderX(e.clientX); });
      window.addEventListener('mousemove', (e) => { if (isTrackingMouse) updateSliderX(e.clientX); });
      window.addEventListener('mouseup', () => { isTrackingMouse = false; });

    } else {
      // P3 & P4: Vertical Slider with Live Scoreboard
      container.innerHTML = `
        <div class="pong-controller-view">
          <div class="pong-live-scoreboard" id="pong-live-scoreboard">
            <div class="pong-score-pips" id="pong-score-display">SKOR: 0 - 0</div>
            <div class="pong-rally-badge" id="pong-rally-display">⚡ RALLİ: 0</div>
          </div>
          <div class="pong-position-badge" style="border-color: ${this.playerColor}">📺 TV YERİ: ${posLabel}</div>
          <div class="pong-instruction" id="pong-direction-hint">${directionHint}</div>
          <div class="pong-touch-track" id="pong-track">
            <div class="pong-track-thumb" id="pong-thumb" style="top: ${this.pongPosition * 100}%; background-color: ${this.playerColor}">
              PADDLE
            </div>
          </div>
          <button class="pong-invert-btn ${this.isPongInverted !== baseInvert ? 'inverted' : ''}" id="btn-invert-axis" type="button">
            ${this.isPongInverted !== baseInvert ? '↺ OTOMATİK YÖN (DOKUN)' : '↺ YÖNÜ TERS ÇEVİR'}
          </button>
        </div>
      `;

      const track = document.getElementById('pong-track');
      const thumb = document.getElementById('pong-thumb');
      const invertBtn = document.getElementById('btn-invert-axis');
      const hintEl = document.getElementById('pong-direction-hint');
      let isTrackingMouse = false;

      invertBtn?.addEventListener('click', () => {
        this.isPongInverted = !this.isPongInverted;
        this._pongInvertManualSet = true;
        const isManuallyFlipped = this.isPongInverted !== baseInvert;
        invertBtn.classList.toggle('inverted', isManuallyFlipped);
        invertBtn.textContent = isManuallyFlipped ? '↺ OTOMATİK YÖN (DOKUN)' : '↺ YÖNÜ TERS ÇEVİR';
        if (hintEl) {
          hintEl.textContent = this.isPongInverted
            ? '▲ YUKARI → TV Alt  |  Aşağı → TV Üst ▼'
            : '▲ YUKARI → TV Üst  |  Aşağı → TV Alt ▼';
        }
      });

      const updateSliderY = (clientY) => {
        const rect = track.getBoundingClientRect();
        const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
        const rawNorm = relativeY / rect.height;
        const clampedNorm = Math.max(0, Math.min(1, (rawNorm - 0.10) / 0.80));
        const position = this.isPongInverted ? 1.0 - clampedNorm : clampedNorm;
        this.pongPosition = position;

        if (thumb) {
          thumb.style.top = `${rawNorm * 100}%`;
          thumb.style.transform = 'translateY(-50%)';
        }

        this.network.sendInput({ action: 'PADDLE_MOVE', position });
      };

      track?.addEventListener('touchstart', (e) => {
        if (e.touches[0]) updateSliderY(e.touches[0].clientY);
      }, { passive: true });

      track?.addEventListener('touchmove', (e) => {
        if (e.touches[0]) updateSliderY(e.touches[0].clientY);
      }, { passive: true });

      track?.addEventListener('mousedown', (e) => { isTrackingMouse = true; updateSliderY(e.clientY); });
      window.addEventListener('mousemove', (e) => { if (isTrackingMouse) updateSliderY(e.clientY); });
      window.addEventListener('mouseup', () => { isTrackingMouse = false; });
    }
  }

  // --- 02: TANKS CONTROLLER (Zamanlamalı Arcade Sürüş Pedalı + Ateş Butonu + Ammo Pips) ---
  mountTanksController(container) {
    container.innerHTML = `
      <div class="tanks-arcade-view">
        <div class="tank-drive-zone">
          <button class="tank-drive-pedal" id="btn-tank-drive" type="button" style="border-color: ${this.playerColor}">
            <span class="pedal-icon">🚀</span>
            <span class="pedal-title">İLERLE</span>
            <span class="pedal-sub">BASILI TUTUNCA GİDER • BIRAKINCA DÖNER</span>
          </button>
        </div>
        <div class="tanks-fire-zone">
          <button class="tank-fire-btn" id="btn-tank-fire" type="button">
            <span class="fire-icon">💥</span>
            <span class="fire-title">ATEŞ</span>
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
      if (navigator.vibrate) navigator.vibrate(20);
    };

    const stopDrive = (e) => {
      e?.preventDefault();
      if (!isDriving) return;
      isDriving = false;
      driveBtn?.classList.remove('active');
      this.network.sendInput({ action: 'TANK_DRIVE', driving: false });
    };

    driveBtn?.addEventListener('touchstart', startDrive, { passive: false });
    driveBtn?.addEventListener('touchend', stopDrive, { passive: false });
    driveBtn?.addEventListener('touchcancel', stopDrive, { passive: false });
    driveBtn?.addEventListener('mousedown', startDrive);
    driveBtn?.addEventListener('mouseup', stopDrive);
    driveBtn?.addEventListener('mouseleave', stopDrive);

    const fireBtn = document.getElementById('btn-tank-fire');
    let lastFireTime = 0;
    const fireAction = (e) => {
      e?.preventDefault();
      const now = performance.now();
      if (now - lastFireTime < 450) return;
      lastFireTime = now;
      this.network.sendInput({ action: 'TANK_FIRE' });
      if (navigator.vibrate) navigator.vibrate(30);
    };

    fireBtn?.addEventListener('touchstart', fireAction, { passive: false });
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
          <button class="action-dash-btn" id="btn-bomb-dash" type="button">
            <span class="dash-btn-label">⚡ DEPAR</span>
            <span class="dash-btn-sub">DOKUN</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('bomb-joy-zone', 'bomb-joy-knob', (input) => {
      this.network.sendInput({ action: 'JOYSTICK_MOVE', ...input });
    });

    const dashBtn = document.getElementById('btn-bomb-dash');
    let isCooling = false;
    let cdTimer = null;

    const dashAction = (e) => {
      e?.preventDefault();
      if (isCooling) return;
      isCooling = true;
      this.network.sendInput({ action: 'DASH' });
      if (navigator.vibrate) navigator.vibrate([25, 35]);

      if (dashBtn) {
        dashBtn.classList.add('cooling');
        let remaining = 2.2;
        const updateText = () => {
          if (!dashBtn) return;
          dashBtn.innerHTML = `
            <span class="dash-btn-label">⏳ ${remaining.toFixed(1)}s</span>
            <span class="dash-btn-sub">DOLUYOR</span>
          `;
        };
        updateText();

        if (cdTimer) clearInterval(cdTimer);
        cdTimer = setInterval(() => {
          remaining -= 0.1;
          if (remaining <= 0.05) {
            clearInterval(cdTimer);
            cdTimer = null;
            isCooling = false;
            if (dashBtn) {
              dashBtn.classList.remove('cooling');
              dashBtn.innerHTML = `
                <span class="dash-btn-label">⚡ DEPAR</span>
                <span class="dash-btn-sub">HAZIR!</span>
              `;
              if (navigator.vibrate) navigator.vibrate(15);
            }
          } else {
            updateText();
          }
        }, 100);
      }
    };

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
            <span class="dash-btn-sub">DOKUN</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('heist-joy-zone', 'heist-joy-knob', (input) => {
      this.network.sendInput({ action: 'JOYSTICK_MOVE', ...input });
    });

    const tackleBtn = document.getElementById('btn-heist-tackle');
    let isCooling = false;
    let cdTimer = null;

    const tackleAction = (e) => {
      e?.preventDefault();
      if (isCooling) return;
      isCooling = true;
      this.network.sendInput({ action: 'TACKLE' });
      if (navigator.vibrate) navigator.vibrate([25, 40]);

      if (tackleBtn) {
        tackleBtn.classList.add('cooling');
        let remaining = 3.5;
        const updateText = () => {
          if (!tackleBtn) return;
          tackleBtn.innerHTML = `
            <span class="dash-btn-label">⏳ ${remaining.toFixed(1)}s</span>
            <span class="dash-btn-sub">DOLUYOR</span>
          `;
        };
        updateText();

        if (cdTimer) clearInterval(cdTimer);
        cdTimer = setInterval(() => {
          remaining -= 0.1;
          if (remaining <= 0.05) {
            clearInterval(cdTimer);
            cdTimer = null;
            isCooling = false;
            if (tackleBtn) {
              tackleBtn.classList.remove('cooling');
              tackleBtn.innerHTML = `
                <span class="dash-btn-label">💥 OMUZ AT</span>
                <span class="dash-btn-sub">HAZIR!</span>
              `;
              if (navigator.vibrate) navigator.vibrate(15);
            }
          } else {
            updateText();
          }
        }, 100);
      }
    };

    tackleBtn?.addEventListener('touchstart', tackleAction, { passive: false });
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

  // --- 07: CROWN CONTROLLER (Joystick + Shoulder Tackle) ---
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
            <span class="dash-btn-sub">DOKUN</span>
          </button>
        </div>
      </div>
    `;

    this.bindJoystick('crown-joy-zone', 'crown-joy-knob', (input) => {
      this.network.sendInput({ action: 'JOYSTICK_MOVE', ...input });
    });

    const tackleBtn = document.getElementById('btn-crown-tackle');
    let isCooling = false;
    let cdTimer = null;

    const tackleAction = (e) => {
      e?.preventDefault();
      if (isCooling) return;
      isCooling = true;
      this.network.sendInput({ action: 'TACKLE' });
      if (navigator.vibrate) navigator.vibrate([25, 40]);

      if (tackleBtn) {
        tackleBtn.classList.add('cooling');
        let remaining = 2.0;
        const updateText = () => {
          if (!tackleBtn) return;
          tackleBtn.innerHTML = `
            <span class="dash-btn-label">⏳ ${remaining.toFixed(1)}s</span>
            <span class="dash-btn-sub">DOLUYOR</span>
          `;
        };
        updateText();

        if (cdTimer) clearInterval(cdTimer);
        cdTimer = setInterval(() => {
          remaining -= 0.1;
          if (remaining <= 0.05) {
            clearInterval(cdTimer);
            cdTimer = null;
            isCooling = false;
            if (tackleBtn) {
              tackleBtn.classList.remove('cooling');
              tackleBtn.innerHTML = `
                <span class="dash-btn-label">💥 OMUZ AT</span>
                <span class="dash-btn-sub">HAZIR!</span>
              `;
              if (navigator.vibrate) navigator.vibrate(15);
            }
          } else {
            updateText();
          }
        }, 100);
      }
    };

    tackleBtn?.addEventListener('touchstart', tackleAction, { passive: false });
    tackleBtn?.addEventListener('mousedown', tackleAction);
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
    const maxRadius = 38;

    const startAt = (clientX, clientY) => {
      const baseEl = knob.parentElement;
      const rect = baseEl ? baseEl.getBoundingClientRect() : zone.getBoundingClientRect();
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
    if (data.gameMode && data.gameMode !== this.gameMode && this.gameMode !== 'LOBBY') {
      this.renderGameController(data.gameMode);
    }

    const modeTag = document.getElementById('hud-game-tag');
    const liveStatus = document.getElementById('hud-live-status');

    if (modeTag && data.gameMode) {
      modeTag.textContent = CONTROLLER_META[data.gameMode]?.hudTag || data.gameMode;
    }

    // İsimli skor şeridi (PONG kendi skorbord'unu kullanır, diğer modlar şeridi)
    if (data.scores) {
      this.renderScoreStrip(data.names, data.scores);
    }

    // Update live status text
    if (liveStatus && data.scores) {
      let statusStr = '';
      if (data.gameMode === 'PONG') {
        statusStr = `RALLİ: ${data.rally || 0} • SKOR: ${data.scores.slice(0, 4).join('-')}`;
        const scoreDisp = document.getElementById('pong-score-display');
        const rallyDisp = document.getElementById('pong-rally-display');
        if (scoreDisp && data.scores) {
          // İsimler varsa kimin skoru olduğu görünür: "AHMET 2 • MEHMET 1"
          scoreDisp.textContent = Array.isArray(data.names)
            ? data.scores.slice(0, 4).map((s, i) => `${data.names[i] || `P${i + 1}`} ${s}`).join(' • ')
            : `SKOR: ${data.scores.slice(0, 4).join(' - ')}`;
        }
        if (rallyDisp && data.rally !== undefined) rallyDisp.textContent = `⚡ RALLİ: ${data.rally}`;
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
      } else if (data.gameMode === 'CROWN') {
        const isKing = data.king === this.playerIndex;
        const myTime = data.crownTimes ? (data.crownTimes[this.playerIndex] || 0).toFixed(1) : '0.0';
        statusStr = isKing
          ? `👑 TAÇ SENDE! (${myTime}s)`
          : (data.king !== null && data.king !== undefined ? `KRAL: P${data.king + 1} (${myTime}s)` : `TAÇ BOŞTA! (${myTime}s)`);
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

    // 2.5. Crown King Alert
    if (this.gameMode === 'CROWN') {
      const isKing = data.king === this.playerIndex;
      this.overlay.classList.toggle('crown-king-alert', isKing);
    } else {
      this.overlay.classList.remove('crown-king-alert');
    }

    // 3. Duel Signal — kumandacı sinyali TV'ye bakmadan görsün
    // (host duelState'i paketle yayınlar; daha önce bu dal yoktu, tetik hep "BEKLE..." kalıyordu)
    if (this.gameMode === 'DUEL') {
      const duelStateEl = document.getElementById('duel-trigger-state');
      if (duelStateEl) {
        const duelSub = document.getElementById('duel-trigger-sub');
        const duelBtn = document.getElementById('btn-duel-trigger');
        const phase = data.duelState;
        if (phase === 'DRAW_SIGNAL') {
          duelStateEl.textContent = '🔥 ÇEK!';
          if (duelSub) duelSub.textContent = 'ŞİMDİ DOKUN!';
          duelBtn?.classList.add('signal');
          // 8Hz sync her tikte titreşmesin — sinyal başına bir kez
          if (duelBtn && !duelBtn.dataset.signaled) {
            duelBtn.dataset.signaled = '1';
            if (navigator.vibrate) navigator.vibrate([60, 40, 60]);
          }
        } else if (phase === 'ROUND_OVER' || phase === 'MATCH_OVER') {
          const w = data.winner;
          duelStateEl.textContent =
            w === null || w === undefined ? '🤝 BERABERE' : (w === this.playerIndex ? '🏆 KAZANDIN!' : `P${w + 1} ALDI`);
          if (duelSub) duelSub.textContent = phase === 'MATCH_OVER' ? 'MAÇ BİTTİ' : 'SONRAKİ RAUNT...';
          duelBtn?.classList.remove('signal');
          if (duelBtn) delete duelBtn.dataset.signaled;
        } else {
          duelStateEl.textContent = '✋ BEKLE...';
          if (duelSub) duelSub.textContent = 'SİNYALİ GÖRÜNCE DOKUN!';
          duelBtn?.classList.remove('signal');
          if (duelBtn) delete duelBtn.dataset.signaled;
        }
      }
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
        const winnerName = data.winner !== null && data.winner !== undefined
          ? (Array.isArray(data.names) && data.names[data.winner] ? data.names[data.winner] : `P${data.winner + 1}`)
          : null;
        if (subEl) subEl.textContent = winnerName ? `KAZANAN: ${winnerName}` : 'BERABERE';
      }
    }
  }
}
