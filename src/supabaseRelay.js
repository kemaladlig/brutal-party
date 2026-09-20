// Supabase Realtime Broadcast Relay for Online Multiplayer
// Replaces the WebSocket relay server for ONLINE mode.
// The HOST acts as the room authority — assigns slots, processes inputs.
// Supabase Broadcast is the transport layer (ephemeral pub/sub).
//
// Kimlik bilgileri KODDA DURMAZ — .env / Vercel Environment Variables:
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
// (anon key herkese açık dağıtılır; güvenlik RLS + kanal tasarımıyla sağlanır,
//  service_role anahtarı ASLA frontend'e konmaz.)

import { createClient } from '@supabase/supabase-js';
import { cleanPlayerName, getClientId } from './net.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase yapılandırması eksik: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY tanımlı değil. ' +
      '.env dosyasını (.env.example şablon) veya Vercel Environment Variables ayarlarını kontrol edin.'
    );
  }
}

// Unique browser tab ID to distinguish self-messages
const MY_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const PLAYER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

// Relay girdisi şema + aralık denetimi (WS roomManager ile aynı kural)
function isValidRelayInput(data) {
  if (!data || typeof data.action !== 'string') return false;
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  switch (data.action) {
    case 'JOYSTICK_MOVE':
      return fin(data.dx) && fin(data.dy)
        && Math.abs(data.dx) <= 1 && Math.abs(data.dy) <= 1
        && fin(data.angle) && fin(data.force)
        && data.force >= 0 && data.force <= 1;
    case 'PADDLE_MOVE':
      return fin(data.position) && data.position >= 0 && data.position <= 1;
    case 'CURVE_STEER':
      return data.dir === -1 || data.dir === 0 || data.dir === 1;
    case 'TANK_DRIVE':
      return typeof data.driving === 'boolean';
    case 'TANK_FIRE':
    case 'DASH':
    case 'TACKLE':
    case 'FREEZE':
    case 'DUEL_TAP':
    case 'SET_NAME':
    case 'SWITCH_SLOT':
      return true;
    default:
      return false;
  }
}

export class SupabaseRelay {
  constructor() {
    this.supabase = null;
    this.channel = null;
    this.role = null; // 'HOST' | 'CONTROLLER'
    this.roomCode = null;
    this.myId = MY_ID;
    this.ping = 0;

    // --- HOST state ---
    this.players = [null, null, null, null]; // { id, name, color, slotIndex }
    this.ready = [false, false, false, false];
    this.gameMode = 'PONG';

    // --- CONTROLLER state ---
    this.playerIndex = null;
    this.playerName = null;
    this.color = null;
    this.hostId = null;

    // Callbacks (same interface as PartyNetwork)
    this.callbacks = {};

    // Ping tracking
    this.pingInterval = null;
    this.lastPingSent = 0;

    // Host canlılık takibi (controller tarafı watchdog için)
    this._lastHostMsgAt = 0;
    this._hostWatchdog = null;

    // Otomatik re-join durumu (WS PartyNetwork muadili)
    this._lastJoin = null;
    this._joinedOnce = false;
    this._manualClose = false;
    this._reconnectTries = 0;
    this._reconnectTimer = null;
  }

  get isHosting() {
    return this.role === 'HOST';
  }

  // ━━━━━━━━━━━━━━━━━━━ HOST API ━━━━━━━━━━━━━━━━━━━

  async hostRoom(gameMode = 'PONG', callbacks = {}) {
    assertSupabaseConfig();
    this.role = 'HOST';
    this.gameMode = gameMode;
    this.callbacks = { ...this.callbacks, ...callbacks };
    this.players = [null, null, null, null];
    this.ready = [false, false, false, false];

    // Generate room code
    this.roomCode = this._generateRoomCode();

    // Connect to Supabase
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 30 } },
    });

    const channelName = `brutal-party-${this.roomCode}`;
    this.channel = this.supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    // Listen for controller messages
    this.channel.on('broadcast', { event: 'player_msg' }, ({ payload }) => {
      if (!payload || payload.senderId === this.myId) return;
      this._hostHandleMessage(payload);
    });

    // Not: subscribe() promise döndürmez — durumlar callback ile gelir.
    // Başarıda SUBSCRIBED, hatada CHANNEL_ERROR/TIMED_OUT/CLOSED.
    // Hiçbir durum gelmezse 10sn zaman aşımı devreye girer (sonsuz kilitlenme yok).
    try {
      await new Promise((resolve, reject) => {
        const failTimer = setTimeout(() => {
          reject(new Error("Supabase relay'e bağlanılamadı (zaman aşımı). İnternet bağlantısını ve Supabase proje durumunu kontrol edin."));
        }, 10000);
        this.channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(failTimer);
            console.log(`[SupabaseRelay] HOST subscribed to ${channelName}`);
            // Oda kodu çakışma kalkanı: host kendini periyodik ilan eder,
            // kumanda JOIN'i ilan edilen hostId'ye kilitler
            this._startHostAnnounce();
            if (this.callbacks.onRoomCreated) {
              this.callbacks.onRoomCreated(this.roomCode, this.gameMode);
            }
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(failTimer);
            console.error('[SupabaseRelay] HOST subscribe failed:', status, err?.message || '');
            reject(new Error(`Supabase relay'e bağlanılamadı (${status}). İnternet bağlantısını ve Supabase proje durumunu kontrol edin.`));
          }
        });
      });
    } catch (err) {
      try { this.supabase?.removeChannel(this.channel); } catch { /* sessiz */ }
      this.channel = null;
      throw err;
    }

    this._startPingHeartbeat();
  }

  _startHostAnnounce() {
    this._stopHostAnnounce();
    const announce = () => {
      this._broadcast('host_msg', {
        action: 'HOST_ANNOUNCE',
        hostId: this.myId,
        gameMode: this.gameMode,
        roomCode: this.roomCode,
      });
    };
    announce();
    this._announceInterval = setInterval(announce, 5000);
  }

  _stopHostAnnounce() {
    if (this._announceInterval) {
      clearInterval(this._announceInterval);
      this._announceInterval = null;
    }
  }

  _hostHandleMessage(msg) {
    switch (msg.action) {
      case 'JOIN': {
        // Başka hosta kilitli JOIN bize değil — aynı kodda çakışan oda varsa yoksay
        if (msg.hostId && msg.hostId !== this.myId) return;
        const now = performance.now();
        let baseName = cleanPlayerName(msg.name);
        let slotIndex = -1;

        // 1. Reconnect: aynı kalıcı istemci kimliği (reload güvenli) VEYA bayat
        // (>20sn sessiz) aynı isimli slot geri verilir. Canlı başkasının slotu
        // gasp edilemez. Bot koltukları eşleşmeye dahil değildir.
        for (let i = 0; i < 4; i++) {
          const p = this.players[i];
          if (!p || p.isBot) continue;
          if (msg.clientId && p.clientId && p.clientId === msg.clientId) { slotIndex = i; break; }
          if (p.name === baseName && now - (p.lastSeen || 0) > 20000) { slotIndex = i; break; }
        }

        // 2. Boş slot bul
        if (slotIndex === -1) {
          for (let i = 0; i < 4; i++) {
            if (!this.players[i]) { slotIndex = i; break; }
          }
        }

        // 3. Tüm slotlar doluysa >20sn'dir yanıt vermeyen (hayalet, insan) slotu geri kazan.
        // Bot koltukları geri kazanıma dahil değildir.
        if (slotIndex === -1) {
          for (let i = 0; i < 4; i++) {
            if (this.players[i] && !this.players[i].isBot && now - (this.players[i].lastSeen || 0) > 20000) {
              slotIndex = i;
              break;
            }
          }
        }

        if (slotIndex === -1) {
          // Room full — send rejection
          this._broadcast('host_msg', {
            action: 'JOIN_ERROR',
            targetId: msg.senderId,
            error: 'ODA DOLU (MAKSİMUM 4 OYUNCU)',
          });
          return;
        }

        // 4. İsim tekilleştir: dolu insan slotundaki isim alınırsa suffix ver
        // (reclaim edilen kendi slotu hariç) — skor şeridinde kim kim belli olur
        const takenByOther = (name) => this.players.some(
          (p, i) => p && !p.isBot && i !== slotIndex && p.name === name
        );
        let finalName = baseName;
        if (takenByOther(finalName)) {
          for (let n = 2; n <= 9; n++) {
            const cand = `${baseName.slice(0, 10)}·${n}`;
            if (!takenByOther(cand)) { finalName = cand; break; }
          }
        }

        const player = {
          id: msg.senderId,
          clientId: msg.clientId || null,
          name: finalName,
          color: PLAYER_COLORS[slotIndex],
          slotIndex,
          lastSeen: now,
        };
        this.players[slotIndex] = player;
        this.ready[slotIndex] = false;

        // Send slot assignment to the joining player
        this._broadcast('host_msg', {
          action: 'JOIN_SUCCESS',
          targetId: msg.senderId,
          hostId: this.myId,
          roomCode: this.roomCode,
          gameMode: this.gameMode,
          slotIndex,
          name: player.name,
          color: player.color,
          slots: this.getSlots(),
        });

        // Notify host UI
        if (this.callbacks.onPlayerJoined) {
          this.callbacks.onPlayerJoined({
            slotIndex, name: player.name, color: player.color,
          });
        }
        this.broadcastSlots();
        break;
      }

      case 'INPUT': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        if (!isValidRelayInput(msg.data)) return;
        if (this.players[slot]) this.players[slot].lastSeen = performance.now();
        if (this.callbacks.onPlayerInput) {
          this.callbacks.onPlayerInput(slot, msg.data);
        }
        break;
      }

      case 'READY': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        if (this.players[slot]) this.players[slot].lastSeen = performance.now();
        this.ready[slot] = !!msg.isReady;
        if (this.callbacks.onPlayerReadyStatus) {
          this.callbacks.onPlayerReadyStatus(slot, !!msg.isReady);
        }
        this.broadcastSlots();
        break;
      }

      case 'REACTION': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        if (this.players[slot]) this.players[slot].lastSeen = performance.now();
        if (this.callbacks.onPlayerReaction) {
          this.callbacks.onPlayerReaction(slot, msg.emoji);
        }
        break;
      }

      case 'LEAVE': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        const leftPlayer = this.players[slot];
        this.players[slot] = null;
        this.ready[slot] = false;
        if (this.callbacks.onPlayerLeft) {
          this.callbacks.onPlayerLeft({ slotIndex: slot, name: leftPlayer?.name || 'OYUNCU' });
        }
        this.broadcastSlots();
        break;
      }

      case 'PONG_REPLY': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot !== -1 && this.players[slot]) {
          this.players[slot].lastSeen = performance.now();
        }
        if (msg.targetId === this.myId && msg.timestamp) {
          this.ping = Math.round((performance.now() - msg.timestamp) / 2);
        }
        break;
      }

      default:
        break;
    }
  }

  _findSlotByPlayerId(playerId) {
    for (let i = 0; i < 4; i++) {
      if (this.players[i]?.id === playerId) return i;
    }
    return -1;
  }

  getSlots() {
    return this.players.map((p, idx) =>
      p ? { slotIndex: idx, name: p.name, color: p.color, isReady: !!this.ready[idx], kind: p.isBot ? 'bot' : 'human' } : null
    );
  }

  broadcastSlots() {
    if (this.role !== 'HOST' || !this.channel) return;
    this._broadcast('host_msg', {
      action: 'SLOTS_UPDATE',
      slots: this.getSlots(),
    });
  }

  setPlayerName(slotIndex, name) {
    if (this.role !== 'HOST' || !this.players[slotIndex]) return;
    this.players[slotIndex].name = name;
    this.broadcastSlots();
  }

  // Host broadcasts game state to all controllers
  broadcastHostState(state) {
    if (this.role !== 'HOST' || !this.channel) return;
    this._broadcast('host_msg', {
      action: 'STATE_SYNC',
      ...state,
    });
  }

  setHostGameMode(gameMode) {
    if (this.role !== 'HOST') return;
    this.gameMode = gameMode;
    this._broadcast('host_msg', {
      action: 'GAME_MODE_CHANGED',
      gameMode,
    });
  }

  startGame(gameMode) {
    if (this.role !== 'HOST') return;
    if (gameMode) this.gameMode = gameMode;
    this.ready = [false, false, false, false];
    this._broadcast('host_msg', {
      action: 'GAME_STARTED',
      gameMode: this.gameMode,
    });
    this.broadcastSlots();
  }

  // Host TV ekranından boş koltuğa bot ekler/çıkarır. Botlar relay modelinde
  // isBot işaretli yer tutucu olarak durur: insan katılımını engeller,
  // SLOTS_UPDATE ile tüm kumandalara duyurulur.
  setSlotBot(slotIndex, name) {
    if (this.role !== 'HOST') return;
    if (slotIndex < 0 || slotIndex > 3 || this.players[slotIndex]) return;
    this.players[slotIndex] = {
      id: `bot-${slotIndex}`,
      name: (name || `BOT // P${slotIndex + 1}`).slice(0, 12),
      color: PLAYER_COLORS[slotIndex],
      slotIndex,
      isBot: true,
    };
    this.ready[slotIndex] = false;
    this.broadcastSlots();
  }

  clearSlotBot(slotIndex) {
    if (this.role !== 'HOST') return;
    const p = this.players[slotIndex];
    if (!p || !p.isBot) return;
    this.players[slotIndex] = null;
    this.ready[slotIndex] = false;
    this.broadcastSlots();
  }

  // İki kademeli başlatma 1/2: sahayı aç (staging). Motor LOBBY'de arena gösterir,
  // kumandalar koltuk seçimine geçer. Oyun henüz başlamaz.
  startStaging(gameMode) {
    if (this.role !== 'HOST') return;
    if (gameMode) this.gameMode = gameMode;
    this.ready = [false, false, false, false];
    this._broadcast('host_msg', {
      action: 'STAGING_STARTED',
      gameMode: this.gameMode,
    });
    this.broadcastSlots();
  }

  // İki kademeli başlatma 2/2: geri sayım tik'i (3-2-1). Son tik sonrası
  // host startGame() çağırır.
  broadcastCountdown(t) {
    if (this.role !== 'HOST') return;
    this._broadcast('host_msg', {
      action: 'COUNTDOWN',
      t,
      gameMode: this.gameMode,
    });
  }

  returnToLobby() {
    if (this.role !== 'HOST') return;
    this.ready = [false, false, false, false];
    this._broadcast('host_msg', {
      action: 'RETURNED_TO_LOBBY',
      gameMode: this.gameMode,
    });
    this.broadcastSlots();
  }

  swapSlots(slotA, slotB) {
    if (this.role !== 'HOST') return;
    if (slotA < 0 || slotA > 3 || slotB < 0 || slotB > 3 || slotA === slotB) return;
    // Bot koltuğu ne hedef ne kaynak olur (main.js ön kapı + burası son kapı)
    if (this.players[slotA]?.isBot || this.players[slotB]?.isBot) return;

    const pA = this.players[slotA];
    const pB = this.players[slotB];
    this.players[slotA] = pB;
    this.players[slotB] = pA;

    const readyA = this.ready[slotA];
    this.ready[slotA] = this.ready[slotB];
    this.ready[slotB] = readyA;

    if (pA) {
      pA.slotIndex = slotB;
      pA.color = PLAYER_COLORS[slotB];
      this._broadcast('host_msg', {
        action: 'SLOT_CHANGED',
        targetId: pA.id,
        slotIndex: slotB,
        color: PLAYER_COLORS[slotB],
      });
    }
    if (pB) {
      pB.slotIndex = slotA;
      pB.color = PLAYER_COLORS[slotA];
      this._broadcast('host_msg', {
        action: 'SLOT_CHANGED',
        targetId: pB.id,
        slotIndex: slotA,
        color: PLAYER_COLORS[slotA],
      });
    }

    if (this.callbacks.onSlotsSwapped) {
      this.callbacks.onSlotsSwapped(slotA, slotB);
    }
    this.broadcastSlots();
  }

  // Atomik rotate: tek permütasyon + kumanda başına tek SLOT_CHANGED +
  // tek SLOTS_UPDATE (ara flicker yok). Skor takasını host yerelde yapar.
  rotateSeats() {
    if (this.role !== 'HOST') return;
    const order = [2, 3, 1, 0];
    const old = [this.players[0], this.players[1], this.players[2], this.players[3]];
    if (old.some((p) => p?.isBot)) return;
    const oldReady = [...this.ready];
    for (let i = 0; i < 4; i++) {
      const p = old[order[i]];
      this.players[i] = p || null;
      this.ready[i] = oldReady[order[i]];
      if (p) {
        p.slotIndex = i;
        p.color = PLAYER_COLORS[i];
        this._broadcast('host_msg', {
          action: 'SLOT_CHANGED',
          targetId: p.id,
          slotIndex: i,
          color: PLAYER_COLORS[i],
        });
      }
    }
    this.broadcastSlots();
  }

  // ━━━━━━━━━━━━━━━━━━━ CONTROLLER API ━━━━━━━━━━━━━━━━━━━

  async joinRoom(roomCode, playerName, callbacks = {}, _isRetry = false) {
    assertSupabaseConfig();
    this.role = 'CONTROLLER';
    this.roomCode = roomCode.toUpperCase().trim();
    this.playerName = cleanPlayerName(playerName);
    this.callbacks = { ...this.callbacks, ...callbacks };
    if (!_isRetry) {
      this._manualClose = false;
      this._reconnectTries = 0;
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
      this._lastJoin = { roomCode: this.roomCode, playerName: this.playerName };
    }

    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 30 } },
    });

    const channelName = `brutal-party-${this.roomCode}`;
    this.channel = this.supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    // Listen for host messages
    this.channel.on('broadcast', { event: 'host_msg' }, ({ payload }) => {
      if (!payload) return;
      this._controllerHandleMessage(payload);
    });

    try {
      await new Promise((resolve, reject) => {
        const failTimer = setTimeout(() => {
          reject(new Error("Supabase relay'e bağlanılamadı (zaman aşımı). İnternet bağlantısını kontrol edin."));
        }, 10000);
        this.channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(failTimer);
            console.log(`[SupabaseRelay] CONTROLLER subscribed to ${channelName}`);
            // Çakışma kalkanı: JOIN'den önce ~1.5sn host ilanlarını topla.
            // 1 host → kilitli JOIN; 2+ → çakışma hatası; 0 → eski host uyumu (kilitsiz).
            this._seenHosts = new Map();
            this.hostId = null;
            this._announceWait = setTimeout(() => this._sendLockedJoin(), 1500);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(failTimer);
            console.error('[SupabaseRelay] CONTROLLER subscribe failed:', status, err?.message || '');
            reject(new Error(`Supabase relay'e bağlanılamadı (${status}). İnternet bağlantısını kontrol edin.`));
          }
        });
      });
    } catch (err) {
      try { this.supabase?.removeChannel(this.channel); } catch { /* sessiz */ }
      this.channel = null;
      throw err;
    }

    this._startPingHeartbeat();
  }

  _sendLockedJoin() {
    this._announceWait = null;
    const now = performance.now();
    const fresh = [...(this._seenHosts || [])].filter(([, at]) => now - at < 10000).map(([id]) => id);
    if (fresh.length >= 2) {
      if (this.callbacks.onError) {
        this.callbacks.onError('ODA KODU ÇAKIŞTI — host yeni oda açsın.');
      }
      this.disconnect();
      return;
    }
    if (fresh.length === 1) {
      this.hostId = fresh[0];
    }
    const joinPayload = { action: 'JOIN', name: this.playerName, clientId: getClientId() };
    if (this.hostId) joinPayload.hostId = this.hostId;
    this._broadcast('player_msg', joinPayload);

    // Set a timeout — if no response in 5s, the room doesn't exist
    if (this._joinTimeout) clearTimeout(this._joinTimeout);
    this._joinTimeout = setTimeout(() => {
      if (!this.playerIndex && this.playerIndex !== 0) {
        if (this.callbacks.onError) {
          this.callbacks.onError('ODA BULUNAMADI veya HOST AKTİF DEĞİL');
        }
      }
    }, 5000);
  }

  _controllerHandleMessage(msg) {
    // Host'tan gelen HER mesaj canlılık kanıtıdır (watchdog için)
    this._lastHostMsgAt = performance.now();

    // Filter messages targeted to other players
    if (msg.targetId && msg.targetId !== this.myId) return;

    switch (msg.action) {
      case 'HOST_ANNOUNCE': {
        // Aynı koddaki her hostu kaydet (çakışma tespiti + JOIN kilidi için)
        if (msg.hostId) {
          if (!this._seenHosts) this._seenHosts = new Map();
          this._seenHosts.set(msg.hostId, performance.now());
        }
        break;
      }

      case 'JOIN_SUCCESS': {
        // Kilitli odaya başka host cevap verdiyse yoksay
        if (msg.hostId && this.hostId && msg.hostId !== this.hostId) break;
        if (this._announceWait) { clearTimeout(this._announceWait); this._announceWait = null; }
        clearTimeout(this._joinTimeout);
        this._joinedOnce = true;
        this._reconnectTries = 0;
        this.playerIndex = msg.slotIndex;
        this.playerName = msg.name;
        this.color = msg.color;
        this._lastHostMsgAt = performance.now();
        this._startHostWatchdog();
        if (this.callbacks.onJoinedSuccess) {
          this.callbacks.onJoinedSuccess(msg);
        }
        break;
      }

      case 'JOIN_ERROR': {
        clearTimeout(this._joinTimeout);
        if (this.callbacks.onError) {
          this.callbacks.onError(msg.error);
        }
        break;
      }

      case 'STATE_SYNC': {
        if (this.callbacks.onGameState) {
          this.callbacks.onGameState(msg);
        }
        break;
      }

      case 'GAME_MODE_CHANGED': {
        if (this.callbacks.onGameModeChanged) {
          this.callbacks.onGameModeChanged(msg.gameMode);
        }
        break;
      }

      case 'GAME_STARTED': {
        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(msg.gameMode);
        }
        break;
      }

      case 'STAGING_STARTED': {
        if (this.callbacks.onStagingStarted) {
          this.callbacks.onStagingStarted(msg.gameMode);
        }
        break;
      }

      case 'COUNTDOWN': {
        if (this.callbacks.onCountdown) {
          this.callbacks.onCountdown(msg.t, msg.gameMode);
        }
        break;
      }

      case 'RETURNED_TO_LOBBY': {
        if (this.callbacks.onReturnedToLobby) {
          this.callbacks.onReturnedToLobby(msg.gameMode);
        }
        break;
      }

      case 'SLOT_CHANGED': {
        this.playerIndex = msg.slotIndex;
        this.color = msg.color;
        if (this.callbacks.onSlotChanged) {
          this.callbacks.onSlotChanged(msg.slotIndex, msg.color);
        }
        break;
      }

      case 'SLOTS_UPDATE': {
        if (this.callbacks.onSlotsUpdate) {
          this.callbacks.onSlotsUpdate(msg.slots);
        }
        break;
      }

      case 'HOST_DISCONNECTED': {
        if (this.callbacks.onHostDisconnected) {
          this.callbacks.onHostDisconnected(msg.message || 'Host odadan ayrıldı.');
        }
        break;
      }

      case 'PING_REQ': {
        // Reply to host's ping
        this._broadcast('player_msg', {
          action: 'PONG_REPLY',
          targetId: msg.senderId,
          timestamp: msg.timestamp,
        });
        break;
      }

      default:
        break;
    }
  }

  sendInput(data) {
    if (this.role !== 'CONTROLLER' || !this.channel) return;
    // Input flood koruması: Sadece sürekli analog hareketler (JOYSTICK_MOVE, PADDLE_MOVE) throttle edilir.
    // DASH, TACKLE, TANK_FIRE, TANK_DRIVE, CURVE_STEER (yön değişimi), koltuk/isim değişimi ve durma/bırakma sinyalleri ASLA throttle edilmez!
    const isCurveSteerChange = data.action === 'CURVE_STEER' && data.dir !== this._lastCurveDir;
    const isDiscrete =
      (data.action !== 'JOYSTICK_MOVE' &&
       data.action !== 'PADDLE_MOVE') ||
      isCurveSteerChange ||
      data.force === 0 ||
      data.dir === 0;

    const now = performance.now();
    if (!isDiscrete) {
      // 50ms throttle (20Hz paddle/joystick göz için akıcıdır) + ölübant:
      // parmak kımıldamadıysa tekrar gönderme (kota dostu, his kaybı yok).
      if (now - (this._lastInputSent || 0) < 50) return;
      if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
        if (Math.abs(data.position - (this._lastPaddlePos ?? -1)) < 0.003) return;
        this._lastPaddlePos = data.position;
      } else if (data.action === 'JOYSTICK_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        const ldx = this._lastJoy?.dx || 0;
        const ldy = this._lastJoy?.dy || 0;
        if (Math.hypot(dx - ldx, dy - ldy) < 0.02) return;
        this._lastJoy = { dx, dy };
      }
    }

    if (data.action === 'CURVE_STEER') {
      this._lastCurveDir = data.dir;
    }

    // Discrete paket 50ms penceresini sıfırlamasın — yoksa dash/tackle sonrası
    // ilk analog kare düşer (küçük direksiyon çentiği hissi)
    if (!isDiscrete) this._lastInputSent = now;
    this._broadcast('player_msg', {
      action: 'INPUT',
      data,
    });
  }

  // SET_NAME sonrası re-join eski isimle dönmesin (C10)
  notePlayerName(name) {
    if (name) this.playerName = cleanPlayerName(name);
  }

  sendReaction(emoji) {
    if (!this.channel) return;
    this._broadcast('player_msg', {
      action: 'REACTION',
      emoji,
    });
  }

  setReady(isReady) {
    if (!this.channel) return;
    this._broadcast('player_msg', {
      action: 'READY',
      isReady,
    });
  }

  // ━━━━━━━━━━━━━━━━━━━ SHARED ━━━━━━━━━━━━━━━━━━━

  _broadcast(event, payload) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event,
      payload: { ...payload, senderId: this.myId },
    });
  }

  // 3 haneli sayısal oda kodu (100-999). Baştaki sıfır bilerek yok.
  _generateRoomCode() {
    return String(Math.floor(100 + Math.random() * 900));
  }

  _startPingHeartbeat() {
    this._stopPingHeartbeat();
    // Kota dostu ping: lobideki ms göstergesinin 5sn'de tazelenmesine gerek yok.
    this.pingInterval = setInterval(() => {
      if (this.role === 'HOST') {
        this._broadcast('host_msg', {
          action: 'PING_REQ',
          timestamp: performance.now(),
        });
      }
    }, 15000);
  }

  _stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Controller tarafı: host'tan 30sn'dir hiç mesaj gelmediyse host ölmüş
  // demektir — bildir + sessizce yeniden bağlanmayı dene (WS muadili, maks 5).
  // Eşik, PING_REQ aralığının (15sn) 2 katıdır; oyunda STATE_SYNC çok daha sık gelir.
  _startHostWatchdog() {
    this._stopHostWatchdog();
    this._hostWatchdog = setInterval(() => {
      if (this.role !== 'CONTROLLER') return;
      if (this.playerIndex === null || this.playerIndex === undefined) return;
      if (performance.now() - this._lastHostMsgAt < 30000) return;
      this._stopHostWatchdog();
      if (this.callbacks.onHostDisconnected) {
        this.callbacks.onHostDisconnected('📡 HOST BAĞLANTISI KOPTU — yeniden bağlanılıyor…');
      }
      const lastJoin = this._lastJoin;
      const wasJoined = this._joinedOnce;
      this.disconnect();
      // disconnect kapatma sayar + retry bilgisini siler — retry için geri koy
      if (wasJoined && lastJoin) {
        this._manualClose = false;
        this._lastJoin = lastJoin;
        this._scheduleRelayReconnect();
      }
    }, 5000);
  }

  // Üstel geri çekilmeli re-join (1s/2s/4s/8s/8s). Kalıcı clientId sayesinde
  // dönen kumanda eski koltuğunu reclaim eder.
  _scheduleRelayReconnect() {
    if (this._manualClose || !this._lastJoin) return;
    if ((this._reconnectTries || 0) >= 5) {
      this._lastJoin = null;
      if (this.callbacks.onError) this.callbacks.onError('BAĞLANTI KOPTU — odaya tekrar katılın.');
      return;
    }
    const delay = Math.min(8000, 1000 * 2 ** (this._reconnectTries || 0));
    this._reconnectTries = (this._reconnectTries || 0) + 1;
    if (this.callbacks.onError) this.callbacks.onError(`🔄 Yeniden bağlanılıyor (${this._reconnectTries}/5)…`);
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._manualClose || !this._lastJoin) return;
      try {
        await this.joinRoom(this._lastJoin.roomCode, this._lastJoin.playerName, {}, true);
      } catch {
        this._scheduleRelayReconnect();
      }
    }, delay);
  }

  _stopHostWatchdog() {
    if (this._hostWatchdog) {
      clearInterval(this._hostWatchdog);
      this._hostWatchdog = null;
    }
  }

  disconnect() {
    this._manualClose = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._lastJoin = null;
    this._joinedOnce = false;
    this._reconnectTries = 0;
    this._stopPingHeartbeat();
    this._stopHostWatchdog();
    this._stopHostAnnounce();
    if (this._joinTimeout) {
      clearTimeout(this._joinTimeout);
      this._joinTimeout = null;
    }
    if (this._announceWait) {
      clearTimeout(this._announceWait);
      this._announceWait = null;
    }
    this._seenHosts = null;

    if (this.role === 'CONTROLLER') {
      this._broadcast('player_msg', { action: 'LEAVE' });
    } else if (this.role === 'HOST') {
      this._broadcast('host_msg', {
        action: 'HOST_DISCONNECTED',
        message: 'TV Host odadan ayrıldı.',
      });
    }

    if (this.channel) {
      this.supabase?.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.supabase) {
      this.supabase = null;
    }

    this.role = null;
    this.roomCode = null;
    this.playerIndex = null;
    this.players = [null, null, null, null];
  }
}

export const supabaseRelay = new SupabaseRelay();
