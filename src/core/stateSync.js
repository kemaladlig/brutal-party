// Host → kumanda durum yayını (8 Hz) ve ONLINE dünya kareleri (30 Hz).
// main.js'ten mekanik taşımadır (Faz 2.4): throttle sayaçları, kirlenme
// kontrolü ve paket kurumu burada; oda akışı (roomPhase/sayaç) main'de kalır ve
// getter üzerinden okunur.
//
// Ağ bütçesi AGENTS §6: host → kumanda 8 Hz (125 ms) + dirty-check; kritik
// olaylar ayrı hızlı yoldan anında gider. ONLINE world-view 30 Hz unreliable
// `world` kanalıdır (Supabase'e düşmez).

import { getEngine } from './engineRegistry.js';
import { createFxStamp } from './networkProtocol.js';
import { roundGapSeconds } from './roundLifecycle.js';
import { hostPlayerSlots } from './slotManager.js';

// ONLINE world-view kanalı 30 Hz.
const WORLD_FRAME_INTERVAL_MS = 1000 / 30;

// Host → kumanda taban aralığı (AGENTS §6).
const STATE_INTERVAL_MS = 125;

/** Sığ paket karşılaştırma: stringify maliyetine girmeden kirlenme tespiti. */
export function samePacket(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const va = a[k];
    const vb = b[k];
    if (Array.isArray(va) && Array.isArray(vb)) {
      if (va.length !== vb.length) return false;
      for (let i = 0; i < va.length; i++) {
        const ea = va[i];
        const eb = vb[i];
        if (ea && typeof ea === 'object') {
          if (JSON.stringify(ea) !== JSON.stringify(eb)) return false;
        } else if (ea !== eb) return false;
      }
    } else if (va !== vb) return false;
  }
  return true;
}

export function createStateSync({ getMode, getNet, getRoomPhase, getCountdown }) {
  let lastBroadcastTime = 0;
  let lastBroadcastPacket = null;
  let lastWorldBroadcastTime = 0;

  function broadcastGameStateIfNeeded(now) {
    const net = getNet();
    if (!net.isHosting) return;

    // Perf: paket kurulumu ve stringify pahalıdır (60 Hz × derin nesne);
    // 125 ms dolmadıysa hiçbir iş yapma — kritik olaylar (skor, taşıyıcı)
    // zaten ayrı hızlı yoldan anında gönderilir.
    if (now - lastBroadcastTime < STATE_INTERVAL_MS) return;

    const currentMode = getMode();
    let packet;
    if (currentMode === 'MENU') {
      packet = { gameMode: 'MENU', phase: 'LOBBY' };
    } else {
      packet = { gameMode: currentMode };
      const entry = getEngine(currentMode);
      if (entry) Object.assign(packet, entry.packet());
      packet.phase = getRoomPhase();
      const countdown = getCountdown();
      if (countdown) packet.t = countdown.t;
      // Raunt boşluğu: kumanda "bir sonraki raunta ne kadar var"ı görsün. Okuma
      // `roundLifecycle.roundGapSeconds`'tedir — motorlar sayacı farklı adta
      // tutuyor ve buraya oyun-özel dal yazılmaz (AGENTS §8).
      // `state` alanı gönderilmedi: HUD'ın `quiet` listesi MATCH_OVER'ı sayıyor,
      // `state` gitseydi uzak kumanda maç sonunda skor şeridini kaybederdi.
      packet.roundGap = roundGapSeconds(entry?.game);
    }
    packet.names = hostPlayerSlots.map((p) => (p ? p.name : null));

    if (samePacket(packet, lastBroadcastPacket)) return;

    lastBroadcastTime = now;
    lastBroadcastPacket = packet;
    net.broadcastHostState(packet);
  }

  function broadcastWorldStateIfNeeded(now) {
    const net = getNet();
    if (!net.isHosting || typeof net.broadcastWorldFrame !== 'function') return;
    const currentMode = getMode();
    if (currentMode === 'MENU' || now - lastWorldBroadcastTime < WORLD_FRAME_INTERVAL_MS) return;

    const entry = getEngine(currentMode);
    if (!entry || typeof entry.worldPacket !== 'function') return;
    if (entry.game.state === 'LOBBY') return;

    const frame = entry.worldPacket();
    if (!frame) return;
    lastWorldBroadcastTime = now;
    net.broadcastWorldFrame(frame);
  }

  // FX olayları: kritik olayların ANLIK güvenilir yolu (MOTION_PLAN 2.2).
  // Throttle YOKTUR (gönderim yalnız gerçekten olay varken olur); world
  // kanalının 30 Hz kayıplı teslimine FX bırakılmaz. Damga oturum sayaçlıdır
  // (networkProtocol.createFxStamp) — kumanda eski/yinelenen olayı atar.
  const stampFxEvents = createFxStamp();
  function flushFxEvents() {
    const net = getNet();
    if (!net.isHosting || typeof net.broadcastFxEvents !== 'function') return;
    const entry = getEngine(getMode());
    const drained = entry?.game?.fx?.drainEvents?.();
    if (!drained || !drained.length) return;
    const events = stampFxEvents(drained);
    if (events.length) net.broadcastFxEvents(events);
  }

  return { broadcastGameStateIfNeeded, broadcastWorldStateIfNeeded, flushFxEvents };
}
