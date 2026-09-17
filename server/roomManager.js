// Room & Networking Manager for Brutal Party // 4P
// Manages rooms, host connections, controller slots (P1..P4), and low-latency input streaming.

export class RoomManager {
  constructor() {
    // Map<roomCode, RoomData>
    this.rooms = new Map();
  }

  generateRoomCode() {
    const chars = 'BCDFGHJKLMNPQRSTVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    // Guarantee uniqueness
    if (this.rooms.has(code)) return this.generateRoomCode();
    return code;
  }

  createRoom(hostWs, gameMode = 'PONG') {
    const code = this.generateRoomCode();
    const room = {
      code,
      hostWs,
      gameMode,
      state: 'LOBBY',
      createdAt: Date.now(),
      players: [null, null, null, null], // Slots 0..3
      ready: [false, false, false, false],
    };

    this.rooms.set(code, room);

    // Attach room info to host socket for fast cleanup on disconnect
    hostWs.roomCode = code;
    hostWs.isHost = true;

    return room;
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase().trim()) || null;
  }

  joinRoom(code, clientWs, playerName = 'OYUNCU') {
    const room = this.getRoom(code);
    if (!room) {
      return { success: false, error: 'ODA BULUNAMADI' };
    }

    // Find first free slot (0..3)
    let slotIndex = -1;
    for (let i = 0; i < 4; i++) {
      if (!room.players[i]) {
        slotIndex = i;
        break;
      }
    }

    if (slotIndex === -1) {
      return { success: false, error: 'ODA DOLU (MAKSİMUM 4 OYUNCU)' };
    }

    const playerColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const player = {
      slotIndex,
      name: playerName.slice(0, 12).trim() || `OYUNCU ${slotIndex + 1}`,
      color: playerColors[slotIndex],
      ws: clientWs,
      joinedAt: Date.now(),
      ping: 0,
    };

    room.players[slotIndex] = player;

    // Attach metadata to client socket
    clientWs.roomCode = room.code;
    clientWs.isHost = false;
    clientWs.slotIndex = slotIndex;

    // Notify Host that a player joined
    this.sendToHost(room, {
      type: 'PLAYER_JOINED',
      slotIndex: player.slotIndex,
      name: player.name,
      color: player.color,
    });

    return {
      success: true,
      roomCode: room.code,
      gameMode: room.gameMode,
      slotIndex: player.slotIndex,
      name: player.name,
      color: player.color,
    };
  }

  handlePlayerInput(clientWs, inputData) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room || !room.hostWs) return;

    // Forward raw input directly to Host with zero allocation overhead
    this.sendToHost(room, {
      type: 'PLAYER_INPUT',
      slotIndex: clientWs.slotIndex,
      data: inputData,
    });
  }

  handleHostBroadcast(hostWs, payload) {
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;

    // If host changes game mode
    if (payload.gameMode) {
      room.gameMode = payload.gameMode;
    }

    // Broadcast state to all connected controller phones
    for (const p of room.players) {
      if (p && p.ws && p.ws.readyState === 1) {
        p.ws.send(JSON.stringify(payload));
      }
    }
  }

  handleReaction(clientWs, emoji) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room || !room.hostWs) return;

    this.sendToHost(room, {
      type: 'PLAYER_REACTION',
      slotIndex: clientWs.slotIndex,
      emoji: emoji || '🔥',
    });
  }

  handlePlayerReady(clientWs, isReady) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room) return;
    const slot = clientWs.slotIndex;
    if (slot !== undefined) {
      room.ready[slot] = !!isReady;
      this.sendToHost(room, {
        type: 'PLAYER_READY_STATUS',
        slotIndex: slot,
        isReady: !!isReady,
      });
    }
  }

  handleSetGameMode(hostWs, gameMode) {
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.gameMode = gameMode;
    this.broadcastToPlayers(room, {
      type: 'GAME_MODE_CHANGED',
      gameMode,
    });
  }

  handleStartGame(hostWs, gameMode) {
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.state = 'PLAYING';
    if (gameMode) room.gameMode = gameMode;
    this.broadcastToPlayers(room, {
      type: 'GAME_STARTED',
      gameMode: room.gameMode,
    });
  }

  handleReturnToLobby(hostWs) {
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.state = 'LOBBY';
    room.ready = [false, false, false, false];
    this.broadcastToPlayers(room, {
      type: 'RETURNED_TO_LOBBY',
      gameMode: room.gameMode,
    });
  }

  handleSwapSlots(hostWs, slotA, slotB) {
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    if (slotA < 0 || slotA > 3 || slotB < 0 || slotB > 3 || slotA === slotB) return;

    const playerColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const pA = room.players[slotA];
    const pB = room.players[slotB];

    room.players[slotA] = pB;
    room.players[slotB] = pA;

    if (pA) {
      pA.slotIndex = slotB;
      pA.color = playerColors[slotB];
      pA.ws.slotIndex = slotB;
      pA.ws.send(JSON.stringify({ type: 'SLOT_CHANGED', slotIndex: slotB, color: playerColors[slotB] }));
    }
    if (pB) {
      pB.slotIndex = slotA;
      pB.color = playerColors[slotA];
      pB.ws.slotIndex = slotA;
      pB.ws.send(JSON.stringify({ type: 'SLOT_CHANGED', slotIndex: slotA, color: playerColors[slotA] }));
    }

    this.sendToHost(room, {
      type: 'SLOTS_SWAPPED',
      slotA,
      slotB,
    });
  }

  broadcastToPlayers(room, payload) {
    for (const p of room.players) {
      if (p && p.ws && p.ws.readyState === 1) {
        p.ws.send(JSON.stringify(payload));
      }
    }
  }

  handleDisconnect(ws) {
    const roomCode = ws.roomCode;
    if (!roomCode) return;

    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (ws.isHost) {
      // Host closed/left -> notify all players and tear down room
      for (const p of room.players) {
        if (p && p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'HOST_DISCONNECTED', message: 'TV Host odadan ayrıldı.' }));
        }
      }
      this.rooms.delete(roomCode);
    } else {
      // A controller player disconnected
      const slot = ws.slotIndex;
      if (slot !== undefined && room.players[slot]) {
        const leftPlayer = room.players[slot];
        room.players[slot] = null;

        this.sendToHost(room, {
          type: 'PLAYER_LEFT',
          slotIndex: slot,
          name: leftPlayer.name,
        });
      }
    }
  }

  sendToHost(room, message) {
    if (room && room.hostWs && room.hostWs.readyState === 1) {
      room.hostWs.send(JSON.stringify(message));
    }
  }
}
