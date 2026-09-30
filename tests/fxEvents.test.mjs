// FX olay tasiyici kilidi (MOTION_PLAN Faz 2, Parca 1): dogrulama, damga,
// suzgec, kayit sekli, kuyruk kapagi, playback esdegerligi ve kademe.
// Duz node testi (fxKit.test.mjs kalibi); tarayici/DOM gerekmez.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FX_EVENT_BATCH_CAP,
  isValidFxEvent,
  toFxWireEvent,
  createFxStamp,
  createFxEventFilter,
  normalizeFxEvents,
} from '../src/core/networkProtocol.js';
import { createFxRuntime, FX_EVENT_QUEUE_CAP } from '../src/core/fxRuntime.js';
import { FX_PROFILES } from '../src/core/fxKit.js';
import {
  noteFxDeviceMetrics,
  noteFxFrameTime,
  fxTierName,
  fxParticleScale,
  fxGlowEnabled,
} from '../src/core/perfMonitor.js';

function goodEvent(over = {}) {
  return {
    fx: 'hit', token: 1, x: 10, y: 20, u: 1, power: 0.2, ...over,
  };
}

test('isValidFxEvent kapali kumeyi ve sayi butcelerini uygular', () => {
  assert.equal(isValidFxEvent(goodEvent()), true);
  assert.equal(isValidFxEvent(goodEvent({ fx: 'nuke' })), false);
  assert.equal(isValidFxEvent(goodEvent({ token: 0 })), false);
  assert.equal(isValidFxEvent(goodEvent({ token: 1.5 })), false);
  assert.equal(isValidFxEvent(goodEvent({ token: undefined })), false);
  assert.equal(isValidFxEvent(goodEvent({ x: Number.NaN })), false);
  assert.equal(isValidFxEvent(goodEvent({ u: 0 })), false);
  assert.equal(isValidFxEvent(goodEvent({ u: 21 })), false);
  assert.equal(isValidFxEvent(goodEvent({ power: -0.1 })), false);
  assert.equal(isValidFxEvent(goodEvent({ power: 1.1 })), false);
  assert.equal(isValidFxEvent(goodEvent({ slot: 4 })), false);
  assert.equal(isValidFxEvent(goodEvent({ slot: 2 })), true);
  assert.equal(isValidFxEvent(goodEvent({ color: '' })), false);
  assert.equal(isValidFxEvent(goodEvent({ color: '#ABCDEF' })), true);
  assert.equal(isValidFxEvent(goodEvent({ dirX: 1, dirY: Number.NaN })), false);
  assert.equal(isValidFxEvent(null), false);
  assert.equal(isValidFxEvent([]), false);
});

test('normalizeFxEvents zarf bicimlerini tek sekle indirir', () => {
  const a = goodEvent({ token: 1 });
  const b = goodEvent({ fx: 'kill', token: 2, power: 0.4 });
  const bozuk = goodEvent({ fx: 'nuke', token: 3 });
  const out = normalizeFxEvents({ events: [a, bozuk, b] });
  assert.ok(Array.isArray(out));
  assert.equal(out.length, 2);
  assert.equal(out[0].fx, 'hit');
  assert.equal(out[1].fx, 'kill');

  assert.equal(normalizeFxEvents({ events: [] }), null);
  assert.equal(normalizeFxEvents(null), null);
  assert.equal(normalizeFxEvents({ events: 'hit' }), null);

  const many = [];
  for (let i = 0; i < FX_EVENT_BATCH_CAP + 1; i += 1) many.push(goodEvent({ token: i + 1 }));
  assert.equal(normalizeFxEvents({ events: many }), null);

  const single = normalizeFxEvents(goodEvent({ token: 9 }));
  assert.ok(Array.isArray(single));
  assert.equal(single.length, 1);
  assert.equal(single[0].token, 9);
});

test('createFxStamp monoton token basar, bozuk kaydi dusurur', () => {
  const stamp = createFxStamp();
  const recs = [
    { fx: 'hit', x: 1, y: 2, u: 1, power: 0.2 },
    { fx: 'nuke', x: 0, y: 0, u: 1, power: 0 },
    { fx: 'kill', x: 3, y: 4, u: 1.5, power: 0.4, slot: 1, color: '#ABCDEF' },
  ];
  const first = stamp(recs);
  assert.equal(first.length, 2);
  assert.ok(first[1].token > first[0].token);
  const second = stamp([{ fx: 'shot', x: 0, y: 0, u: 1, power: 0.08 }]);
  assert.ok(second[0].token > first[1].token);
  assert.equal(toFxWireEvent({ fx: 'hit', x: 0, y: 0, u: 1, power: 0.2 }, 0), null);
});

test('createFxEventFilter esit/eski tokeni atar, reset ile yeni oyuna acar', () => {
  const filter = createFxEventFilter();
  const batch = [goodEvent({ token: 1 }), goodEvent({ token: 2 }), goodEvent({ token: 2 }), goodEvent({ token: 1 })];
  const fresh = filter(batch);
  assert.deepEqual(fresh.map((e) => e.token), [1, 2]);
  assert.deepEqual(filter([goodEvent({ token: 3 })]).map((e) => e.token), [3]);
  filter.reset();
  assert.deepEqual(filter([goodEvent({ token: 1 })]).map((e) => e.token), [1]);
});

test('FxRuntime kayit sekli: duz alanlar, unit override, kuyruk kapagi', () => {
  assert.equal(FX_EVENT_QUEUE_CAP, 24);
  const fx = createFxRuntime({ arenaProvider: () => ({ unit: 1 }) });
  fx.emit('hit', { x: 10.44, y: 20.44, color: '#ABCDEF', slot: 2, dirX: 1, dirY: 0, angle: 0.55, size: 12.34 });
  const [rec] = fx.drainEvents();
  assert.equal(rec.fx, 'hit');
  assert.equal(rec.x, 10.4);
  assert.equal(rec.u, 1);
  assert.equal(rec.power, FX_PROFILES.hit.trauma);
  assert.equal(rec.slot, 2);
  assert.equal(rec.color, '#ABCDEF');
  assert.equal(rec.dirX, 1);
  assert.equal(rec.angle, 0.6);

  const fx2 = createFxRuntime({ arenaProvider: () => ({ unit: 1 }) });
  fx2.emit('shot', { x: 0, y: 0, unit: 2.5 });
  const [rec2] = fx2.drainEvents();
  assert.equal(rec2.u, 2.5);

  const fx3 = createFxRuntime({ arenaProvider: () => ({ unit: 1 }) });
  for (let i = 0; i < 30; i += 1) fx3.emit('spark', { x: i, y: 0 });
  const drained = fx3.drainEvents();
  assert.equal(drained.length, 24);
  assert.equal(drained[0].x, 6);
  assert.equal(fx3.drainEvents().length, 0);
});

test('playback esdegerligi: ikinci runtime ayni olgudan ayni sunumu uretir', () => {
  noteFxDeviceMetrics({ tier: 'high' });
  const host = createFxRuntime({ arenaProvider: () => ({ unit: 2 }) });
  host.emit('kill', { x: 100, y: 50, color: '#ABCDEF', size: 34, angle: 0.5, slot: 1 });
  const hostParticles = host.particles.length;
  const hostRings = host.rings.length;
  const hostPops = host.pops.length;
  assert.ok(hostParticles > 0 && hostRings > 0 && hostPops > 0);

  const stamp = createFxStamp();
  const wire = stamp(host.drainEvents());
  assert.equal(wire.length, 1);
  const normalized = normalizeFxEvents({ events: wire });
  assert.ok(normalized);

  const client = createFxRuntime({ arenaProvider: () => ({ unit: 1 }) });
  for (const ev of normalized) {
    client.emit(ev.fx, {
      x: ev.x, y: ev.y, unit: ev.u, color: ev.color,
      dirX: ev.dirX, dirY: ev.dirY, angle: ev.angle, size: ev.size,
      ringRadius: ev.ringRadius ?? null, slot: ev.slot, haptic: false,
    });
  }
  assert.equal(client.particles.length, hostParticles);
  assert.equal(client.rings.length, hostRings);
  assert.equal(client.pops.length, hostPops);
  noteFxDeviceMetrics({ tier: 'high' });
});

test('kademe: 30 yavas kare bir basamak indirir, low kill burst 7 olur', () => {
  noteFxDeviceMetrics({ tier: 'high' });
  assert.equal(fxTierName(), 'high');
  for (let i = 0; i < 29; i += 1) noteFxFrameTime(25);
  assert.equal(fxTierName(), 'high');
  noteFxFrameTime(25);
  assert.equal(fxTierName(), 'mid');
  for (let i = 0; i < 30; i += 1) noteFxFrameTime(25);
  assert.equal(fxTierName(), 'low');
  assert.equal(fxParticleScale(), 0.4);
  assert.equal(fxGlowEnabled(), false);

  const fx = createFxRuntime({ arenaProvider: () => ({ unit: 1 }) });
  fx.emit('kill', { x: 0, y: 0 });
  assert.equal(fx.particles.length, Math.round(FX_PROFILES.kill.burst.count * 0.4));
  assert.equal(fx.particles.length, 7);

  noteFxDeviceMetrics({ tier: 'high' });
});
