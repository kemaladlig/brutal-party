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
