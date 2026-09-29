// Standalone Production Server for Brutal Party // 4P
// Serves static bundle from dist/ and handles WebSocket connections on /party-ws

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './roomManager.js';
import { handleMessage } from './vitePluginWs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.resolve(__dirname, '../dist');
const PORT = process.env.PORT || 3000;

const roomManager = new RoomManager();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  let filePath = path.normalize(path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname));

  // Path traversal guard: DIST dışına çıkılamaz.
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    res.end('Forbidden');
    return;
  }

  // SPA fallback yalnız uzantısız yollara; kayıp asset temiz 404 dönmeli
  // (stale bundle index.html + MIME hatası yerine).
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    if (path.extname(pathname).length === 0) {
      filePath = path.join(DIST_DIR, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
      res.end('Not Found');
      return;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
      res.end('Server Error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    res.end(content);
  });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

function isAllowedOrigin(request) {
  const origin = request.headers?.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).hostname;
    const reqHost = String(request.headers.host || '').split(':')[0];
    if (originHost === reqHost) return true;
    if (['localhost', '127.0.0.1', '::1'].includes(originHost)) return true;
    return false;
  } catch {
    return false;
  }
}

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname === '/party-ws') {
    if (!isAllowedOrigin(request)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(ws, msg, roomManager);
    } catch (e) {
      console.error('WS parse error:', e);
    }
  });

  ws.on('close', () => {
    roomManager.handleDisconnect(ws);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ BRUTAL PARTY // 4P Server running at http://localhost:${PORT}`);
  console.log(`⚡ WebSocket endpoint active at ws://localhost:${PORT}/party-ws`);
});
