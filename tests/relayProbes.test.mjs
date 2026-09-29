// AGENTS.md §11 "3 prova" — relay kontrakt seviyesinde otomatik karşılıkları.
// Sunucu snapshot'ı tek gerçektir (§5): TV(host) ve kumanda(phone) iki WS
// istemcisidir; UI seçicisi yok — protokole bağlı kalır, akış refactor'undan
// etkilenmez. Üç prova: hazır→lobi bayrakları, koltuk takasında isim senkronu,
// bot ekle/çıkar görünürlüğü.
// Yayın gerçekleri: SLOTS_UPDATE yalnız kumandalara basılır; TV kendi
// hostPlayerSlots kopyasını PLAYER_READY_STATUS / SLOTS_SWAPPED / PLAYER_JOINED
// girdilerinden türetir. PLAYER_READY tek başına slot yayını üretmez.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { WebSocket } from 'ws';
import { RoomManager } from '../server/roomManager.js';
import { handleMessage } from '../server/vitePluginWs.js';
import { normalizeStateSync } from '../src/core/networkProtocol.js';

function startTestServer() {
  const roomManager = new RoomManager();
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer, path: '/party-ws' });
  wss.on('connection', (ws) => {
    ws.isHost = false;
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      handleMessage(ws, msg, roomManager);
    });
  });
  return new Promise((resolve) => {
    httpServer.listen(0, () => {
      const url = `ws://127.0.0.1:${httpServer.address().port}/party-ws`;
      resolve({
        url,
        sockets: [],
        // Sunucu tarafı iddiaları (oda.gameMode güncellemesi) için.
        roomManager,
        close: () => new Promise((r) => {
          for (const s of wss.clients) { try { s.terminate(); } catch {} }
          httpServer.close(() => r());
        }),
      });
    });
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const inbox = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const idx = waiters.findIndex((w) => w.type === msg.type);
      if (idx >= 0) {
        const [w] = waiters.splice(idx, 1);
        w.resolve(msg);
      } else {
        inbox.push(msg);
      }
    });
    ws.on('error', reject);
    ws.waitFor = (type, timeout = 2000) => {
      const existing = inbox.findIndex((m) => m.type === type);
      if (existing >= 0) return Promise.resolve(inbox.splice(existing, 1)[0]);
      return new Promise((res, rej) => {
        waiters.push({ type, resolve: res });
        setTimeout(() => rej(new Error(`${type} beklenirken zaman aşımı`)), timeout);
      });
    };
    // PONG bariyeri: bu sokete gelen önceki her mesaj artık inbox'tadır.
    ws.flush = async () => {
      ws.sendJson({ type: 'PING', timestamp: 0 });
      await ws.waitFor('PONG');
    };
    ws.take = (type) => {
      const i = inbox.findIndex((m) => m.type === type);
      return i >= 0 ? inbox.splice(i, 1)[0] : null;
    };
    ws.sendJson = (obj) => ws.send(JSON.stringify(obj));
    ws.on('open', () => resolve(ws));
  });
}

async function makeRoom() {
  const srv = await startTestServer();
  const host = await connect(srv.url);
  host.sendJson({ type: 'HOST_CREATE_ROOM', gameMode: 'PONG', hostIdentity: {} });
  const created = await host.waitFor('ROOM_CREATED');
  return { srv, host, code: created.roomCode };
}

async function joinPhone(srv, code, name) {
  const phone = await connect(srv.url);
  phone.sendJson({ type: 'JOIN_ROOM', roomCode: code, playerName: name, clientId: null });
  const ok = await phone.waitFor('JOIN_SUCCESS');
  return { phone, ok };
}

test('prova 1 — hazır bayrağı GAME_STARTED ve LOBİYE DÖN’de iki tarafta da sıfırlanır', async () => {
  const { srv, host, code } = await makeRoom();
  try {
    const { phone, ok } = await joinPhone(srv, code, 'AYŞE');
    assert.equal(typeof ok.slotIndex, 'number');

    phone.sendJson({ type: 'PLAYER_READY', isReady: true });
    const hostSeen = await host.waitFor('PLAYER_READY_STATUS');
    assert.equal(hostSeen.slotIndex, ok.slotIndex, 'TV hazır bayrağını görür');
    assert.equal(hostSeen.isReady, true);

    host.sendJson({ type: 'START_GAME', gameMode: 'PONG' });
    await phone.waitFor('GAME_STARTED');
    const afterStart = await phone.waitFor('SLOTS_UPDATE');
    assert.equal(afterStart.slots[ok.slotIndex].isReady, false, 'GAME_STARTED hazır sıfırlar (kumanda)');

    // SLOT swap rate kapısı 300 ms: ikinci READY öncekinden ayrışmalı.
    await new Promise((r) => setTimeout(r, 320));
    phone.sendJson({ type: 'PLAYER_READY', isReady: true });
    await host.waitFor('PLAYER_READY_STATUS');
    host.sendJson({ type: 'RETURN_TO_LOBBY' });
    await phone.waitFor('RETURNED_TO_LOBBY');
    const afterBack = await phone.waitFor('SLOTS_UPDATE');
    assert.equal(afterBack.slots[ok.slotIndex].isReady, false, 'LOBİYE DÖN hazır sıfırlar');
  } finally {
    await srv.close();
  }
});

test('prova 2 — koltuk takasında isimler TV ve kumanda snapshot’larında taşınır', async () => {
  const { srv, host, code } = await makeRoom();
  try {
    const a = await joinPhone(srv, code, 'AYŞE');
    const b = await joinPhone(srv, code, 'FATMA');
    const slotA = a.ok.slotIndex;
    const slotB = b.ok.slotIndex;

    // Join yayınları (PLAYER_JOINED/SLOTS_UPDATE) takas öncesi durumu taşır —
    // bariyerle tahliye et ki sonraki waitFor yalnız takas sonrasını görsün.
    await a.phone.flush(); await b.phone.flush(); await host.flush();
    while (a.phone.take('SLOTS_UPDATE')) {}
    while (b.phone.take('SLOTS_UPDATE')) {}
    while (host.take('PLAYER_JOINED')) {}

    host.sendJson({ type: 'SWAP_SLOTS', slotA, slotB });

    const aChanged = await a.phone.waitFor('SLOT_CHANGED');
    assert.equal(aChanged.slotIndex, slotB, 'AYŞE yeni koltuğunu alır');
    const bChanged = await b.phone.waitFor('SLOT_CHANGED');
    assert.equal(bChanged.slotIndex, slotA, 'FATMA yeni koltuğunu alır');
    const hostSeen = await host.waitFor('SLOTS_SWAPPED');
    assert.equal(hostSeen.slotA, slotA, 'TV takas olayını alır');
    assert.equal(hostSeen.slotB, slotB);

    const snapA = await a.phone.waitFor('SLOTS_UPDATE');
    assert.equal(snapA.slots[slotA].name, b.ok.name, 'kumanda A: eski slotA artık FATMA');
    assert.equal(snapA.slots[slotB].name, a.ok.name, 'kumanda A: eski slotB artık AYŞE');
    const snapB = await b.phone.waitFor('SLOTS_UPDATE');
    assert.equal(snapB.slots[slotA].name, b.ok.name, 'kumanda B: aynı gerçek');
    assert.equal(snapB.slots[slotB].name, a.ok.name, 'kumanda B: aynı gerçek');
  } finally {
    await srv.close();
  }
});

test('prova 3 — bot ekle/çıkar kumanda snapshot’ında görünür; bot takasa giremez', async () => {
  const { srv, host, code } = await makeRoom();
  try {
    const { phone, ok } = await joinPhone(srv, code, 'AYŞE');
    const humanSlot = ok.slotIndex;
    const joinSnap = await phone.waitFor('SLOTS_UPDATE');
    const botSlot = joinSnap.slots.findIndex((s, i) => s === null && i !== humanSlot);
    assert.ok(botSlot >= 0, 'boş koltuk bulunmalı');

    host.sendJson({ type: 'SET_SLOT_BOT', slotIndex: botSlot, name: 'BOT · 1', kind: 'bot' });
    const botSnap = await phone.waitFor('SLOTS_UPDATE');
    assert.equal(botSnap.slots[botSlot].kind, 'bot', 'kumanda bot koltuğunu görür (tek gerçek: relay)');
    assert.equal(botSnap.slots[botSlot].name, 'BOT · 1');
    assert.equal(botSnap.slots[humanSlot].name, 'AYŞE');

    // Bot kaynak/hedef olamaz (§5): SWAP_SLOTS ve ROTATE_SEATS erken döner —
    // hiçbir yayın üretmemelidir.
    host.sendJson({ type: 'SWAP_SLOTS', slotA: botSlot, slotB: humanSlot });
    host.sendJson({ type: 'ROTATE_SEATS' });
    await phone.flush();
    assert.equal(phone.take('SLOTS_UPDATE'), null, 'redledilen takas kumandaya snapshot yayını üretmedi');
    assert.equal(phone.take('SLOT_CHANGED'), null, 'redledilen takas kumandaya SLOT_CHANGED üretmedi');
    await host.flush();
    assert.equal(host.take('SLOTS_SWAPPED'), null, 'redledilen takas TV’ye olay göndermez');

    host.sendJson({ type: 'CLEAR_SLOT_BOT', slotIndex: botSlot });
    const cleared = await phone.waitFor('SLOTS_UPDATE');
    assert.equal(cleared.slots[botSlot], null, 'bot kaldırıldı — kumanda snapshot’ı');
  } finally {
    await srv.close();
  }
});

// AGENTS §6: host → kumanda 8 Hz periyodik durum paketi. TV_CONSOLE bu paketi
// bir zamanlar `{type, state:{…}}` iç içe kovasıyla yolluyordu; kumanda
// (`gamepad.handleStateSync`) yalnız en-üst-seviye alanları okuduğu için
// TV_CONSOLE'da faz uzlaşması, skor şeridi, geri sayım ve cooldown senkronu
// sessizce ölüydü. ONLINE aynı paketi zaten düz yolluyordu. Kilit: sunucu
// yansıttığı zarfı DÜZ göndermeli — discriminator en üstte, `state` kovası yok.
test('prova 4 — 8 Hz durum paketi kumandaya düz ulaşır (faz + skor + sayaç)', async () => {
  const { srv, host, code } = await makeRoom();
  try {
    const { phone } = await joinPhone(srv, code, 'AYŞE');
    await phone.flush();
    while (phone.take('HOST_STATE_SYNC')) {}

    const packet = {
      gameMode: 'PONG',
      phase: 'GAME',
      scores: [3, 1, 0, 2],
      names: ['AYŞE', 'FATMA', null, null],
      roundGap: 0,
    };
    host.sendJson({ type: 'HOST_STATE_SYNC', ...packet });

    const got = await phone.waitFor('HOST_STATE_SYNC');
    // Sunucu yansıtması iç içe kova taşımamalı.
    assert.equal(got.state, undefined, 'paket düzleştirilmiş olmalı (state kovası yok)');
    // Kumandanın fiilen okuduğu alanlar (gamepad.handleStateSync) en üstte olmalı.
    assert.equal(got.phase, 'GAME', 'faz en üstte — faz uzlaşması çalışır');
    assert.equal(got.gameMode, 'PONG', 'gameMode en üstte');
    assert.deepEqual(got.scores, [3, 1, 0, 2], 'skorlar en üstte — skor şeridi çalışır');
    assert.deepEqual(got.names, packet.names, 'isimler en üstte');
    assert.equal(got.roundGap, 0, 'roundGap en üstte');

    // Geri sayım paketi: `data.t` sayacı da en üstte olmalı.
    host.sendJson({ type: 'HOST_STATE_SYNC', gameMode: 'PONG', phase: 'COUNTDOWN', t: 2 });
    const cd = await phone.waitFor('HOST_STATE_SYNC');
    assert.equal(cd.phase, 'COUNTDOWN');
    assert.equal(cd.t, 2, 'sayaç en üstte — geri sayım perdesi çalışır');

    // Sunucu ayrıca oda.gameMode'u günceller (JOIN_SUCCESS akışı buna bakar).
    assert.equal(
      srv.roomManager.rooms.get(code).gameMode, 'PONG',
      'host gameMode değişikliği sunucu oda durumuna yazılır',
    );
  } finally {
    await srv.close();
  }
});

// Sürüm kayması toleransı: yayın cache-first PWA (public/sw.js) yüzünden eski
// bir host build'i yeni sunucuya, yeni bir kumanda eski host'a bağlanabilir.
// Sunucu her iki zarf şeklini de düzleştirip kumandaya düz paket iletmeli.
test('prova 5 — sunucu eski (kova şekilli) host paketini de düzleştirir', async () => {
  const { srv, host, code } = await makeRoom();
  try {
    const { phone } = await joinPhone(srv, code, 'AYŞE');
    await phone.flush();
    while (phone.take('HOST_STATE_SYNC')) {}

    // Eski şekil: yük `state` kovası içinde.
    host.sendJson({
      type: 'HOST_STATE_SYNC',
      state: { gameMode: 'BOMB', phase: 'GAME', scores: [0, 5, 0, 0], t: 3 },
    });

    const got = await phone.waitFor('HOST_STATE_SYNC');
    assert.equal(got.state, undefined, 'kovalı zarf da düzleştirilmeli');
    assert.equal(got.phase, 'GAME', 'faz en üstte taşınmalı');
    assert.equal(got.gameMode, 'BOMB');
    assert.deepEqual(got.scores, [0, 5, 0, 0]);
    assert.equal(got.t, 3);
    assert.equal(
      srv.roomManager.rooms.get(code).gameMode, 'BOMB',
      'kova içindeki gameMode da sunucu oda durumuna yazılmalı',
    );
  } finally {
    await srv.close();
  }
});

// Normalleştirici sunucu dışında da aynı sözleşmeyi paylaşır: kumanda tarafı
// iki transport'tan da düz paket görmek zorunda (bu satır regresyonu kilitler).
test('prova 6 — kumanda tarafı iki transport şeklini aynı okur', () => {
  const payload = { phase: 'GAME', gameMode: 'PONG', scores: [1, 0, 0, 0], t: 2, roundGap: 0 };
  // Ayırıcılar transport'a özgü kalır (sunucu/kumanda `msg.type` / `msg.action`
  // ile eşler); kumandanın okuduğu YÜK alanları birebir aynı olmalı.
  const viaWs = normalizeStateSync({ type: 'HOST_STATE_SYNC', ...payload });
  const viaRelay = normalizeStateSync({ action: 'STATE_SYNC', ...payload });

  const load = (msg) => {
    const { type, action, ...rest } = msg;
    return rest;
  };
  assert.deepEqual(load(viaWs), load(viaRelay), 'her iki transport aynı tüketiciliği besler');
  assert.equal(viaWs.type, 'HOST_STATE_SYNC', 'TV_CONSOLE ayırıcısı korunur');
  assert.equal(viaRelay.action, 'STATE_SYNC', 'ONLINE ayırıcısı korunur');
  for (const field of ['phase', 'gameMode', 't', 'roundGap']) {
    assert.equal(viaWs[field], viaRelay[field], `${field} iki transportta aynı`);
  }
  assert.deepEqual(viaWs.scores, viaRelay.scores);
});
