// Vite WebSocket Plugin for development
// Attaches WebSocketServer directly to Vite's dev server on `/party-ws`

import { WebSocketServer } from 'ws';
import { RoomManager } from './roomManager.js';

export function vitePluginWs() {
  const roomManager = new RoomManager();

  return {
    name: 'vite-plugin-party-ws',
    configureServer(server) {
      if (!server.httpServer) return;

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

export function handleMessage(ws, msg, roomManager) {
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
      const result = roomManager.joinRoom(msg.roomCode, ws, msg.playerName);
      if (result.success) {
        ws.send(
          JSON.stringify({
            type: 'JOIN_SUCCESS',
            roomCode: result.roomCode,
            gameMode: result.gameMode,
            slotIndex: result.slotIndex,
            name: result.name,
            color: result.color,
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

    case 'PING': {
      ws.send(JSON.stringify({ type: 'PONG', timestamp: msg.timestamp }));
      break;
    }

    default:
      break;
  }
}
