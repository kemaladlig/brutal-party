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

  _hostHandleMessage(msg) {
    switch (msg.action) {
      case 'JOIN': {
        const cleanName = (msg.name || 'OYUNCU').slice(0, 12);
        let slotIndex = -1;

        // 1. Reconnect: Daha önce bu isimle bağlanmış bir slot varsa geri ver
        for (let i = 0; i < 4; i++) {
          if (this.players[i] && this.players[i].name === cleanName) {
            slotIndex = i;
            break;
          }
        }

        // 2. Boş slot bul
        if (slotIndex === -1) {
          for (let i = 0; i < 4; i++) {
            if (!this.players[i]) { slotIndex = i; break; }
          }
        }

        // 3. Tüm slotlar doluysa >20sn'dir yanıt vermeyen (hayalet) slotu geri kazan
        if (slotIndex === -1) {
          const now = performance.now();
          for (let i = 0; i < 4; i++) {
            if (this.players[i] && now - (this.players[i].lastSeen || 0) > 20000) {
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

        const player = {
          id: msg.senderId,
          name: cleanName,
          color: PLAYER_COLORS[slotIndex],
          slotIndex,
          lastSeen: performance.now(),
        };
        this.players[slotIndex] = player;
        this.ready[slotIndex] = false;

        // Send slot assignment to the joining player
        this._broadcast('host_msg', {
          action: 'JOIN_SUCCESS',
          targetId: msg.senderId,
          roomCode: this.roomCode,
          gameMode: this.gameMode,
          slotIndex,
          name: player.name,
          color: player.color,
        });

        // Notify host UI
        if (this.callbacks.onPlayerJoined) {
          this.callbacks.onPlayerJoined({
            slotIndex, name: player.name, color: player.color,
          });
        }
        break;
      }

      case 'INPUT': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
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
    this._broadcast('host_msg', {
      action: 'GAME_STARTED',
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
  }

  swapSlots(slotA, slotB) {
    if (this.role !== 'HOST') return;
    if (slotA < 0 || slotA > 3 || slotB < 0 || slotB > 3 || slotA === slotB) return;

    const pA = this.players[slotA];
    const pB = this.players[slotB];
    this.players[slotA] = pB;
    this.players[slotB] = pA;

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
  }

  // ━━━━━━━━━━━━━━━━━━━ CONTROLLER API ━━━━━━━━━━━━━━━━━━━

  async joinRoom(roomCode, playerName, callbacks = {}) {
    assertSupabaseConfig();
    this.role = 'CONTROLLER';
    this.roomCode = roomCode.toUpperCase().trim();
    this.playerName = (playerName || 'OYUNCU').toUpperCase().slice(0, 12);
    this.callbacks = { ...this.callbacks, ...callbacks };

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
            // Send join request
            this._broadcast('player_msg', {
              action: 'JOIN',
              name: this.playerName,
            });

            // Set a timeout — if no response in 5s, the room doesn't exist
            this._joinTimeout = setTimeout(() => {
              if (!this.playerIndex && this.playerIndex !== 0) {
                if (this.callbacks.onError) {
                  this.callbacks.onError('ODA BULUNAMADI veya HOST AKTİF DEĞİL');
                }
              }
            }, 5000);
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

  _controllerHandleMessage(msg) {
    // Host'tan gelen HER mesaj canlılık kanıtıdır (watchdog için)
    this._lastHostMsgAt = performance.now();

    // Filter messages targeted to other players
    if (msg.targetId && msg.targetId !== this.myId) return;

    switch (msg.action) {
      case 'JOIN_SUCCESS': {
        clearTimeout(this._joinTimeout);
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
    // Input flood koruması: Sürekli analog hareketler ~30ms throttle edilir.
    // Ancak bırakma (force 0, dir 0), sürüş (TANK_DRIVE), koltuk değişimi ve aksiyon tuşları ASLA atlanmaz!
    const isDiscrete =
      data.action === 'SET_NAME' ||
      data.action === 'SWITCH_SLOT' ||
      data.action === 'TANK_DRIVE' ||
      data.action === 'TANK_FIRE' ||
      data.action === 'BOMB_DASH' ||
      data.force === 0 ||
      data.dir === 0;

    const now = performance.now();
    if (!isDiscrete && now - (this._lastInputSent || 0) < 30) return;
    this._lastInputSent = now;
    this._broadcast('player_msg', {
      action: 'INPUT',
      data,
    });
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

  _generateRoomCode() {
    const chars = 'BCDFGHJKLMNPQRSTVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  _startPingHeartbeat() {
    this._stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.role === 'HOST') {
        this._broadcast('host_msg', {
          action: 'PING_REQ',
          timestamp: performance.now(),
        });
      }
    }, 5000);
  }

  _stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Controller tarafı: host'tan 15sn'dir hiç mesaj gelmediyse
  // (PING_REQ 5sn'de bir gelir) host ölmüş demektir — lobiye düşür.
  _startHostWatchdog() {
    this._stopHostWatchdog();
    this._hostWatchdog = setInterval(() => {
      if (this.role !== 'CONTROLLER') return;
      if (this.playerIndex === null || this.playerIndex === undefined) return;
      if (performance.now() - this._lastHostMsgAt < 15000) return;
      this._stopHostWatchdog();
      if (this.callbacks.onHostDisconnected) {
        this.callbacks.onHostDisconnected('📡 HOST BAĞLANTISI KOPTU — lobiye dönüp tekrar katılın.');
      }
      this.disconnect();
    }, 5000);
  }

  _stopHostWatchdog() {
    if (this._hostWatchdog) {
      clearInterval(this._hostWatchdog);
      this._hostWatchdog = null;
    }
  }

  disconnect() {
    this._stopPingHeartbeat();
    this._stopHostWatchdog();
    if (this._joinTimeout) {
      clearTimeout(this._joinTimeout);
      this._joinTimeout = null;
    }

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
