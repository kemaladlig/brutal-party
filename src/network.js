// Client Networking Module for Brutal Party // 4P
// Connects Host (TV) or Controller (Phone) to the WebSocket room server.

import { getClientId } from './net.js';
import { t } from './i18n.js';

export class PartyNetwork {
  constructor() {
    this.ws = null;
    this.role = null; // 'HOST' | 'CONTROLLER'
    this.roomCode = null;
    this.playerIndex = null;
    this.playerName = null;
    this.color = null;
    this.ping = 0;
    this.pingInterval = null;
    // AGENTS §5 bütçesiyle simetrik kopma gözetimi (Supabase 15s/30s ile aynı):
    // ping 4s'de atılır (lobi rozeti), watchdog 30s sessizlikte koparır.
    this._lastHostMsgAt = 0;
    this._hostWatchdog = null;
    // Otomatik re-join için son katılım bilgileri (kullanıcı kapatmadan koparsa)
    this._lastJoin = null;
    this._reconnectTimer = null;
    this._reconnectTries = 0;
    this._manualClose = false;

    // Event Callbacks
    this.callbacks = {
      onRoomCreated: null,
      onPlayerJoined: null,
      onPlayerLeft: null,
      onPlayerInput: null,
      onPlayerReaction: null,
      onJoinedSuccess: null,
      onGameState: null,
      onError: null,
      onHostDisconnected: null,
    };
  }

  get isHosting() {
    return this.role === 'HOST';
  }

  getWsUrl() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/party-ws`;
  }

  connect(onOpen) {
    return new Promise((resolve, reject) => {
      try {
        const url = this.getWsUrl();
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          this.startPingHeartbeat();
          if (onOpen) onOpen();
          resolve(this.ws);
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.handleMessage(msg);
          } catch (e) {
            console.error('[Network] JSON parse error:', e);
          }
        };

        this.ws.onerror = (err) => {
          console.error('[Network] WebSocket error:', err);
          if (this.callbacks.onError) this.callbacks.onError(t('net.connError'));
          reject(err);
        };

        this.ws.onclose = () => {
          this.stopPingHeartbeat();
          this._stopHostWatchdog();
          console.log('[Network] WebSocket closed');
          this._scheduleReconnect();
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  handleMessage(msg) {
    switch (msg.type) {
      case 'ROOM_CREATED':
        this.roomCode = msg.roomCode;
        if (this.callbacks.onRoomCreated) {
          this.callbacks.onRoomCreated(msg.roomCode, msg.gameMode);
        }
        break;

      case 'PLAYER_JOINED':
        if (this.callbacks.onPlayerJoined) {
          this.callbacks.onPlayerJoined(msg);
        }
        break;

      case 'PLAYER_LEFT':
        if (this.callbacks.onPlayerLeft) {
          this.callbacks.onPlayerLeft(msg);
        }
        break;

      case 'PLAYER_INPUT':
        if (this.callbacks.onPlayerInput) {
          this.callbacks.onPlayerInput(msg.slotIndex, msg.data);
        }
        break;

      case 'PLAYER_REACTION':
        if (this.callbacks.onPlayerReaction) {
          this.callbacks.onPlayerReaction(msg.slotIndex, msg.emoji);
        }
        break;

      case 'JOIN_SUCCESS':
        this.roomCode = msg.roomCode;
        this.playerIndex = msg.slotIndex;
        this.playerName = msg.name;
        this.color = msg.color;
        this._reconnectTries = 0;
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onJoinedSuccess) {
          this.callbacks.onJoinedSuccess(msg);
        }
        break;

      case 'JOIN_ERROR':
        if (this.callbacks.onError) {
          this.callbacks.onError(msg.error);
        }
        break;

      case 'HOST_STATE_SYNC':
      case 'GAME_STATE':
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onGameState) {
          this.callbacks.onGameState(msg);
        }
        break;
      case 'HOST_DISCONNECTED':
        if (this.callbacks.onHostDisconnected) {
          this.callbacks.onHostDisconnected(msg.message);
        }
        break;

      case 'PLAYER_READY_STATUS':
        if (this.callbacks.onPlayerReadyStatus) {
          this.callbacks.onPlayerReadyStatus(msg.slotIndex, msg.isReady);
        }
        break;

      case 'SLOTS_SWAPPED':
        if (this.callbacks.onSlotsSwapped) {
          this.callbacks.onSlotsSwapped(msg.slotA, msg.slotB);
        }
        break;

      case 'SLOT_CHANGED':
        this.playerIndex = msg.slotIndex;
        this.color = msg.color;
        if (this.callbacks.onSlotChanged) {
          this.callbacks.onSlotChanged(msg.slotIndex, msg.color);
        }
        break;

      case 'SLOTS_UPDATE':
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onSlotsUpdate) {
          this.callbacks.onSlotsUpdate(msg.slots);
        }
        break;

      case 'PLAYER_UPDATED':
        if (this.callbacks.onPlayerUpdated) {
          this.callbacks.onPlayerUpdated(msg);
        }
        break;

      case 'GAME_MODE_CHANGED':
        if (this.callbacks.onGameModeChanged) {
          this.callbacks.onGameModeChanged(msg.gameMode);
        }
        break;

      case 'GAME_STARTED':
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(msg.gameMode);
        }
        break;

      case 'STAGING_STARTED':
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onStagingStarted) {
          this.callbacks.onStagingStarted(msg.gameMode);
        }
        break;

      case 'COUNTDOWN':
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onCountdown) {
          this.callbacks.onCountdown(msg.t, msg.gameMode);
        }
        break;

      case 'RETURNED_TO_LOBBY':
        this._lastHostMsgAt = performance.now();
        if (this.callbacks.onReturnedToLobby) {
          this.callbacks.onReturnedToLobby(msg.gameMode);
        }
        break;

      case 'PONG':
        if (msg.timestamp) {
          this.ping = Math.round((performance.now() - msg.timestamp) / 2);
        }
        break;

      default:
        break;
    }
  }

  // --- Host API ---
  async hostRoom(gameMode = 'PONG', callbacks = {}) {
    this.role = 'HOST';
    this.callbacks = { ...this.callbacks, ...callbacks };

    await this.connect(() => {
      this.send({
        type: 'HOST_CREATE_ROOM',
        gameMode,
      });
    });
  }

  broadcastHostState(state) {
    if (this.role !== 'HOST' || !this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'HOST_STATE_SYNC',
      state,
    });
  }

  // --- Controller API ---
  async joinRoom(roomCode, playerName, callbacks = {}, avatar = null) {
    this.role = 'CONTROLLER';
    this.callbacks = { ...this.callbacks, ...callbacks };
    this._manualClose = false;
    this._reconnectTries = 0;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._lastJoin = {
      roomCode: roomCode.toUpperCase().trim(),
      playerName,
      avatar,
    };

    await this.connect(() => {
      this._lastHostMsgAt = performance.now();
      this._startHostWatchdog();
      this.send({
        type: 'JOIN_ROOM',
        roomCode: roomCode.toUpperCase().trim(),
        playerName,
        clientId: getClientId(),
        avatar,
      });
    });
  }

  // SET_NAME sonrası re-join eski isimle dönmesin (C10)
  notePlayerName(name) {
    if (this._lastJoin && name) this._lastJoin.playerName = name;
  }

  sendInput(data) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'INPUT',
      data,
    });
  }

  // Kumanda kendi karakterini host'a bildirir (INPUT tüneli; 1sn rate-limit sunucuda).
  sendAvatarUpdate(avatar) {
    if (this.role !== 'CONTROLLER') return;
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'INPUT',
      data: { action: 'AVATAR_UPDATE', avatar },
    });
  }

  sendReaction(emoji) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'REACTION',
      emoji,
    });
  }

  setReady(isReady) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'PLAYER_READY',
      isReady,
    });
  }

  setHostGameMode(gameMode) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'SET_GAME_MODE',
      gameMode,
    });
  }

  startGame(gameMode) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'START_GAME',
      gameMode,
    });
  }

  startStaging(gameMode) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'START_STAGING',
      gameMode,
    });
  }

  broadcastCountdown(t) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'COUNTDOWN',
      t,
    });
  }

  returnToLobby() {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'RETURN_TO_LOBBY',
    });
  }

  swapSlots(slotA, slotB) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'SWAP_SLOTS',
      slotA,
      slotB,
    });
  }

  // Atomik koltuk döndürme (tek yayın; ara flicker yok)
  rotateSeats() {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({ type: 'ROTATE_SEATS' });
  }

  setSlotBot(slotIndex, name, kind = 'bot') {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'SET_SLOT_BOT',
      slotIndex,
      name,
      kind,
    });
  }

  clearSlotBot(slotIndex) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'CLEAR_SLOT_BOT',
      slotIndex,
    });
  }

  setPlayerName(slotIndex, name) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'SET_SLOT_NAME',
      slotIndex,
      name,
    });
  }

  // Host kaynaklı display-renk override (lobi hızlı palet/🎲; host-only).
  setSlotColor(slotIndex, color) {
    if (this.role !== 'HOST' || !this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'SET_SLOT_COLOR',
      slotIndex,
      color,
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  startPingHeartbeat() {
    this.stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.send({ type: 'PING', timestamp: performance.now() });
      }
    }, 4000);
  }

  stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  // Kumanda tarafı: host'tan 30sn mesaj gelmezse host ölmüş say (Supabase
  // _startHostWatchdog ile aynı eşik; AGENTS §5: ping 15s / kopma 30s).
  _startHostWatchdog() {
    this._stopHostWatchdog();
    if (this.role !== 'CONTROLLER') return;
    if (this._lastHostMsgAt === 0) this._lastHostMsgAt = performance.now();
    this._hostWatchdog = setInterval(() => {
      if (this.role !== 'CONTROLLER') return;
      if (this.playerIndex === null || this.playerIndex === undefined) return;
      if (performance.now() - this._lastHostMsgAt < 30000) return;
      this._stopHostWatchdog();
      if (this.callbacks.onHostDisconnected) {
        this.callbacks.onHostDisconnected(t('net.hostGoneWs'));
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

  // Görünür hata + üstel geri çekilmeli otomatik re-join (maks ~5 deneme).
  // Sunucu isim-bazlı reclaim yapmaz; dönen kumanda ilk boşa düşebilir —
  // host koltuk ızgarası SLOTS_UPDATE ile kendini toparlar.
  _scheduleReconnect() {
    if (this._manualClose) return;
    if (!this._lastJoin || this.role === 'HOST') return;
    if (this._reconnectTries >= 5) {
      this._lastJoin = null;
      if (this.callbacks.onError) this.callbacks.onError(t('net.retryFail'));
      return;
    }
    const delay = Math.min(8000, 1000 * 2 ** this._reconnectTries);
    this._reconnectTries += 1;
    if (this.callbacks.onError) this.callbacks.onError(t('net.retrying', this._reconnectTries));
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      try {
        await this.connect(() => {
          this._lastHostMsgAt = performance.now();
          this._startHostWatchdog();
          this.send({
            type: 'JOIN_ROOM',
            roomCode: this._lastJoin.roomCode,
            playerName: this._lastJoin.playerName,
            clientId: getClientId(),
            avatar: this._lastJoin.avatar || null,
          });
        });
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  disconnect() {
    this._manualClose = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._lastJoin = null;
    this._reconnectTries = 0;
    this.stopPingHeartbeat();
    this._stopHostWatchdog();
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.role = null;
    this.roomCode = null;
    this.playerIndex = null;
  }
}

export const partyNetwork = new PartyNetwork();
