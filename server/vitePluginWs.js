import os from 'os';
import { WebSocketServer } from 'ws';
import { RoomManager } from './roomManager.js';

function getLanIp() {
  const interfaces = os.networkInterfaces();
  let best = null;
  for (const name of Object.keys(interfaces)) {
    // Ignore virtual / WSL / Hyper-V adapters
    if (/vethernet|virtual|wsl|hyper-v|docker|vmware/i.test(name)) continue;

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        if (iface.address.startsWith('192.168.')) {
          return iface.address;
        }
        if (/wi-?fi|wlan/i.test(name)) {
          return iface.address;
        }
        best = iface.address;
      }
    }
  }
  return best || '192.168.1.4';
}

export function vitePluginWs() {
  const roomManager = new RoomManager();

  return {
    name: 'vite-plugin-party-ws',
    configureServer(server) {
      if (!server.httpServer) return;

      server.middlewares.use('/api/lan-ip', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ip: getLanIp(), port: server.config.server.port || 5173 }));
      });

      const wss = new WebSocketServer({
        noServer: true,
      });

      server.httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === '/party-ws') {
          wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
          });
        }
      });

      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString());
            handleMessage(ws, msg, roomManager);
          } catch (e) {
            console.error('WebSocket parse error:', e);
          }
        });

        ws.on('close', () => {
          roomManager.handleDisconnect(ws);
        });

        ws.on('error', (err) => {
          console.error('WebSocket client error:', err);
        });
      });
    },
  };
}

// Kumanda rolleri (JOIN_ROOM/INPUT/REACTION/PLAYER_READY/PING) bu kümede yok:
// onlar isHost=false ile serbestçe geçer.
const HOST_ONLY_MSG = new Set([
  'HOST_STATE_SYNC',
  'SET_GAME_MODE',
  'START_GAME',
  'START_STAGING',
  'COUNTDOWN',
  'RETURN_TO_LOBBY',
  'SWAP_SLOTS',
  'ROTATE_SEATS',
  'SET_SLOT_BOT',
  'CLEAR_SLOT_BOT',
  'SET_SLOT_NAME',
  'SET_SLOT_COLOR',
]);

export function handleMessage(ws, msg, roomManager) {
  // Rol kapısı: yalnızca TV host bu komutları basabilir. Kumandadan gelirse
  // sessizce düşer (maçı başlatma/bitirme, sahte skor, bot/koltuk gaspı kapanır).
  if (HOST_ONLY_MSG.has(msg.type) && !ws.isHost) return;
  switch (msg.type) {
    case 'HOST_CREATE_ROOM': {
      const room = roomManager.createRoom(ws, msg.gameMode || 'PONG');
      ws.send(
        JSON.stringify({
          type: 'ROOM_CREATED',
          roomCode: room.code,
          gameMode: room.gameMode,
        })
      );
      break;
    }

    case 'JOIN_ROOM': {
      const result = roomManager.joinRoom(msg.roomCode, ws, msg.playerName, msg.clientId || null, msg.avatar || null);
      if (result.success) {
        ws.send(
          JSON.stringify({
            type: 'JOIN_SUCCESS',
            roomCode: result.roomCode,
            gameMode: result.gameMode,
            slotIndex: result.slotIndex,
            name: result.name,
            color: result.color,
            avatar: result.avatar,
            slots: roomManager.getSlots(roomManager.getRoom(result.roomCode)),
          })
        );
      } else {
        ws.send(
          JSON.stringify({
            type: 'JOIN_ERROR',
            error: result.error,
          })
        );
      }
      break;
    }

    case 'INPUT': {
      roomManager.handlePlayerInput(ws, msg.data);
      break;
    }

    case 'HOST_STATE_SYNC': {
      roomManager.handleHostBroadcast(ws, msg);
      break;
    }

    case 'REACTION': {
      roomManager.handleReaction(ws, msg.emoji);
      break;
    }

    case 'PLAYER_READY': {
      roomManager.handlePlayerReady(ws, msg.isReady);
      break;
    }

    case 'SET_GAME_MODE': {
      roomManager.handleSetGameMode(ws, msg.gameMode);
      break;
    }

    case 'START_GAME': {
      roomManager.handleStartGame(ws, msg.gameMode);
      break;
    }

    case 'START_STAGING': {
      roomManager.handleStartStaging(ws, msg.gameMode);
      break;
    }

    case 'COUNTDOWN': {
      roomManager.handleCountdown(ws, msg.t);
      break;
    }

    case 'RETURN_TO_LOBBY': {
      roomManager.handleReturnToLobby(ws);
      break;
    }

    case 'SWAP_SLOTS': {
      roomManager.handleSwapSlots(ws, msg.slotA, msg.slotB);
      break;
    }

    case 'ROTATE_SEATS': {
      roomManager.handleRotateSeats(ws);
      break;
    }

    case 'SET_SLOT_BOT': {
      roomManager.handleSetSlotBot(ws, msg.slotIndex, msg.name, msg.kind);
      break;
    }

    case 'CLEAR_SLOT_BOT': {
      roomManager.handleClearSlotBot(ws, msg.slotIndex);
      break;
    }

    case 'SET_SLOT_NAME': {
      roomManager.handleSetSlotName(ws, msg.slotIndex, msg.name);
      break;
    }

    case 'SET_SLOT_COLOR': {
      roomManager.handleSetSlotColor(ws, msg.slotIndex, msg.color);
      break;
    }

    case 'PING': {
      ws.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
      break;
    }

    default:
      break;
  }
}
