// fxKit kilidi (MOTION_PLAN Faz 1): kapalı olay kümesi, bütçe tablosu,
// havuz kapları, hit-stop dürüstlüğü ve reduced-motion sıfırlaması.
// Motorların kendi partikül sayısını uydurmasını değil, profili okumasını
// garanti eden sözleşme testidir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FX_KIND,
  FX_PROFILES,
  FX_PARTICLE_CAP,
  FX_RING_CAP,
  FX_POP_CAP,
  FX_HITSTOP_SCALE,
  FX_FLASH_ALPHA,
  isFxKind,
  fxProfile,
  fxFlashAlpha,
  fxSpawnBurst,
  fxUpdateParticles,
  fxSpawnRing,
  fxUpdateRings,
  fxSpawnPop,
  fxUpdatePops,
  advanceHitStop,
  fxNormalizedDir,
} from '../src/core/fxKit.js';
import { createFxRuntime } from '../src/core/fxRuntime.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('fx kinds form a closed set; unknown kinds throw', () => {
  for (const kind of Object.values(FX_KIND)) {
    assert.equal(isFxKind(kind), true);
    assert.doesNotThrow(() => fxProfile(kind));
  }
  assert.equal(isFxKind('nuke'), false);
  assert.throws(() => fxProfile('nuke'), /kapalı küme/);
});

test('kill is the only screen-level channel (single screen-effect budget)', () => {
  const flashOwners = Object.keys(FX_PROFILES).filter((k) => FX_PROFILES[k].flashSec);
  assert.deepEqual(flashOwners, ['kill']);
  assert.ok(fxFlashAlpha(0.06, 0.06) <= FX_FLASH_ALPHA);
  assert.equal(fxFlashAlpha(0, 0.06), 0);
  // Lineer sönme: yarı süre → yarı alfa.
  assert.ok(Math.abs(fxFlashAlpha(0.03, 0.06) - FX_FLASH_ALPHA / 2) < 1e-9);
});

test('burst spawns respect design-unit scaling and pool caps', () => {
  const list = [];
  const spawned = fxSpawnBurst(list, 'kill', { x: 10, y: 20, color: '#ABCDEF', unit: 2, rng: () => 0.5 });
  assert.equal(spawned, FX_PROFILES.kill.burst.count);
  assert.equal(list.length, spawned);
  // unit=2: hız ve boyut tasarım biriminden ölçeklenir (I5 — ham px yok).
  const p = list[0];
  assert.ok(p.size >= 1);
  assert.ok(Math.hypot(p.vx, p.vy) > 0);

  // Kap: kap kadar burst bas, hiçbiri kaybolmasın; bir fazla → en eski düşer.
  const capped = [];
  const perBurst = FX_PROFILES.hit.burst.count;
  const rounds = Math.floor(FX_PARTICLE_CAP / perBurst);
  for (let i = 0; i < rounds; i += 1) fxSpawnBurst(capped, 'hit', { x: 0, y: 0, rng: () => 0.5 });
  assert.ok(capped.length <= FX_PARTICLE_CAP);
  fxSpawnBurst(capped, 'hit', { x: 1, y: 1, rng: () => 0.5 });
  assert.ok(capped.length <= FX_PARTICLE_CAP);

  // Partiküller yaşamını yitirince temizlenir.
  fxUpdateParticles(capped, 5);
  assert.equal(capped.length, 0);
});

test('rings derive radius from life; pops decay — snapshot-safe shapes', () => {
  const rings = [];
  fxSpawnRing(rings, 'hit', { x: 5, y: 5, unit: 1 });
  assert.equal(rings.length, 1);
  const ring = rings[0];
  // Saf paketleme: r0/r1 saklanır, anlık yarıçap life'tan TÜRETİLİR.
  assert.ok('r0' in ring && 'r1' in ring && !('radius' in ring));

  let guard = 0;
  while (ring.life > 0 && guard < 1000) { fxUpdateRings(rings, 0.05); guard += 1; }
  assert.equal(rings.length, 0);

  // Ring kap: FX_RING_CAP + 1 spawn → kap kadar kalır.
  const crowded = [];
  for (let i = 0; i < FX_RING_CAP + 1; i += 1) fxSpawnRing(crowded, 'score', { x: i, y: 0 });
  assert.equal(crowded.length, FX_RING_CAP);

  const pops = [];
  fxSpawnPop(pops, { x: 0, y: 0, size: 34, unit: 1 });
  assert.equal(pops.length, 1);
  fxUpdatePops(pops, 1);
  assert.equal(pops.length, 0);

  for (let i = 0; i < FX_POP_CAP + 1; i += 1) fxSpawnPop(pops, { x: i, y: 0, size: 10 });
  assert.equal(pops.length, FX_POP_CAP);
});

test('hit-stop slows presentation time without lying about the clock', () => {
  // Donuk pencerede dt ölçeklenir, süre düşer.
  let state = advanceHitStop(0.05, 1 / 60);
  assert.ok(state.dt < (1 / 60) * 0.2, `dt scale edilmeliydi, got ${state.dt}`);
  assert.ok(state.timer < 0.05);

  // Dürüstlük: donuk bitince toplam ilerleme gerçek süreye yaklaşır
  // (kaybolan zaman yalnız FX_HITSTOP_SCALE penceresi kadardır).
  let timer = 0.1;
  let advanced = 0;
  const real = 0.2;
  for (let t = 0; t < real; t += 1 / 60) {
    state = advanceHitStop(timer, 1 / 60);
    timer = state.timer;
    advanced += state.dt;
  }
  const lost = real - advanced;
  assert.ok(lost >= 0 && lost <= 0.1 * (1 - FX_HITSTOP_SCALE) + 1 / 60, `kayıp ${lost} bütçe dışı`);

  // Donuk değilse dt aynen geçer.
  const pass = advanceHitStop(0, 1 / 60);
  assert.equal(pass.dt, 1 / 60);
});

test('fxNormalizedDir returns unit vectors only', () => {
  const dir = fxNormalizedDir(3, 4);
  assert.ok(Math.abs(Math.hypot(dir.x, dir.y) - 1) < 1e-9);
  assert.equal(fxNormalizedDir(0, 0), null);
});

test('runtime emits through profiles: hit spawns burst+ring, kill adds pop+flash', () => {
  const sink = [];
  const fx = createFxRuntime({
    arenaProvider: () => ({ unit: 1 }),
    traumaSink: (amount, x, y) => sink.push({ amount, x, y }),
  });
  fx.emit('hit', { x: 0, y: 0, color: '#ABCDEF', dirX: 1, dirY: 0 });
  assert.equal(fx.particles.length, FX_PROFILES.hit.burst.count);
  assert.equal(fx.rings.length, 1);
  assert.equal(sink.length, 1);
  assert.equal(sink[0].amount, FX_PROFILES.hit.trauma);
  assert.equal(sink[0].x, 1);

  fx.emit('kill', { x: 0, y: 0, color: '#ABCDEF', size: 34, dirX: 0, dirY: -2 });
  assert.equal(fx.pops.length, 1);
  assert.ok(fx.flash > 0);
  assert.ok(fx.hitStop > 0);

  // clear() alias'ları bozmaz: this.particles referansı canlı kalır.
  const alias = fx.particles;
  fx.clear();
  assert.equal(fx.particles, alias);
  assert.equal(alias.length, 0);
});

// ——— Mimari kilitler (Faz 2 dönüşüm dalgalarının jandarması) ———

function gameSources() {
  const dir = join(ROOT, 'src', 'games');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

test('converted engines own no particle state: tanks+horde+laser+archer locked (Faz 2a)', () => {
  // FX runtime'a geçen motorlar kendi havuzunu kuramaz, travmayı elle ekleyemez.
  for (const name of ['tanks.js', 'horde.js', 'laser.js', 'archer.js']) {
    const src = readFileSync(join(ROOT, 'src', 'games', name), 'utf8');
    assert.ok(/createFxRuntime\(/.test(src), `${name} fxRuntime kullanmalı`);
    assert.ok(!/this\.particles\s*=\s*\[\s*\]/.test(src), `${name} kendi partikül dizisini kuramaz (alias hariç kurucuda)`);
    assert.ok(!/this\.addTrauma\(/.test(src), `${name} travmayı fx profili üzerinden ekler`);
    assert.ok(!/particles\.push\(/.test(src), `${name} ham partikül üretemez`);
  }
});

test('every profile budget stays inside the motion plan ceiling', () => {
  for (const [kind, profile] of Object.entries(FX_PROFILES)) {
    if (profile.trauma !== undefined) {
      assert.ok(profile.trauma <= 0.4, `${kind} trauma 0.4 üstü olamaz (ekran bütçesi)`);
    }
    if (profile.hitStopMs !== undefined) {
      assert.ok(profile.hitStopMs <= 150, `${kind} hit-stop 150 ms üstü olamaz`);
    }
    if (profile.burst) {
      assert.ok(profile.burst.count <= 18, `${kind} burst 18 partikül üstü olamaz`);
    }
  }
});
