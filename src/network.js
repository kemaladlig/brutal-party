// Client Networking Module for Brutal Party // 4P
// Connects Host (TV) or Controller (Phone) to the WebSocket room server.

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
          if (this.callbacks.onError) this.callbacks.onError('Bağlantı hatası oluştu.');
          reject(err);
        };

        this.ws.onclose = () => {
          this.stopPingHeartbeat();
          console.log('[Network] WebSocket closed');
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
        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(msg.gameMode);
        }
        break;

      case 'STAGING_STARTED':
        if (this.callbacks.onStagingStarted) {
          this.callbacks.onStagingStarted(msg.gameMode);
        }
        break;

      case 'COUNTDOWN':
        if (this.callbacks.onCountdown) {
          this.callbacks.onCountdown(msg.t, msg.gameMode);
        }
        break;

      case 'RETURNED_TO_LOBBY':
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
  async joinRoom(roomCode, playerName, callbacks = {}) {
    this.role = 'CONTROLLER';
    this.callbacks = { ...this.callbacks, ...callbacks };

    await this.connect(() => {
      this.send({
        type: 'JOIN_ROOM',
        roomCode: roomCode.toUpperCase().trim(),
        playerName,
      });
    });
  }

  sendInput(data) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'INPUT',
      data,
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

  setSlotBot(slotIndex, name) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.send({
      type: 'SET_SLOT_BOT',
      slotIndex,
      name,
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

  disconnect() {
    this.stopPingHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.role = null;
    this.roomCode = null;
    this.playerIndex = null;
  }
}

export const partyNetwork = new PartyNetwork();
