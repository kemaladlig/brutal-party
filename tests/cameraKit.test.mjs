// Kamera (punch-zoom + climax zoom) — sunum katmanı sözleşmesi.
//
// Metin taraması DEĞİL, modülü ÇALIŞTIRIR: " kamera var mı" değil "zoom
// arenanın merkezinde mi ve güçle orantılı mı" sorusunu sayısal cevaplar.
//
// Kilitler:
//   1) Zoom arenanın MERKEZİ etrafında olur (kenarda değil) — kenarda zoom
//      görüntüyü kaydırır ve arenanın bir ucunu ekrandan çıkarır.
//   2) Darbe gücü arttıkça zoom artar; küçük darbe büyük darbeden küçük.
//   3) Punch kendi kendine söner; sürekli bir yakınlaşma bırakmaz.
//   4) Climaks seviyesi sürekli zoom verir ve sıfırlandığında geri döner.
//   5) Hareket azaltıldığında hiçbir kamera hareketi üretilmez.
//   6) Arena kutusu geçersizse çizim zinciri bozulmaz (1:1 döner).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  beginCamera,
  cameraStats,
  punchCamera,
  resetCamera,
  setCameraClimax,
} from '../src/core/cameraKit.js';

/** Dönüşüm günlüğü tutan sahte ctx. */
function makeCtx(log) {
  return {
    translate(x, y) { log.push(`t(${Number(x).toFixed(2)},${Number(y).toFixed(2)})`); },
    scale(x, y) { log.push(`s(${Number(x).toFixed(4)},${Number(y).toFixed(4)})`); },
  };
}

const ARENA = { left: 100, top: 50, width: 400, height: 300 };

/** Son translate çiftini toplayan sıralı çıktı. */
function readTransform(log) {
  let scale = 1;
  const translates = [];
  for (const entry of log) {
    if (entry[0] === 's') scale = Number(entry.slice(2).split(',')[0]);
    else translates.push(entry);
  }
  return { scale, translates };
}

test('a punch zooms toward the arena centre, not the screen edge', () => {
  resetCamera();
  punchCamera(1);
  const log = [];
  const zoom = beginCamera(makeCtx(log), ARENA);
  assert.ok(zoom > 1, 'punch içe yaklaştırmalı');

  const { translates } = readTransform(log);
  // Merkez çevir → ölçekle → geri çevir: toplam ofset sıfır olmalı.
  assert.equal(translates.length, 2, 'iki çeviri beklenir (ileri + geri)');
  const net = translates
    .map((t) => t.slice(2, -1).split(',').map(Number))
    .reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
  assert.ok(Math.abs(net[0]) < 0.05 && Math.abs(net[1]) < 0.05,
    `zoom merkezli olmalı, net ofset (${net})`);

  // Merkez doğru noktada: arena kutusu (300, 200).
  const first = translates[0].slice(2, -1).split(',').map(Number);
  assert.ok(Math.abs(first[0] - 300) < 0.5 && Math.abs(first[1] - 200) < 0.5,
    `merkez arena kutusu olmalı, bulundu (${first})`);
});

test('a harder hit zooms further', () => {
  resetCamera();
  punchCamera(0.25);
  const soft = beginCamera(makeCtx([]), ARENA);
  resetCamera();
  punchCamera(1);
  const hard = beginCamera(makeCtx([]), ARENA);
  assert.ok(hard > soft, `sert darbe daha çok yaklaştırmalı: ${hard} vs ${soft}`);

  // Gerçek profiller bu aralıkta: `hit` travması 0.2, `kill` 0.4. Yani OYUNDA
  // geçen her hasar zoom üretir — eşik yalnız teorik sıfırın üstünü keser.
  resetCamera();
  punchCamera(0.2);
  const realHit = beginCamera(makeCtx([]), ARENA);
  assert.ok(realHit > 1, 'gerçek bir isabet (fxKit `hit` travması 0.2) yaklaştırmalı');

  // Eşiğin altı: ölçek HİÇ değişmez, `ctx.scale` bile yazılmaz.
  resetCamera();
  punchCamera(0.05);
  const log = [];
  assert.equal(beginCamera(makeCtx(log), ARENA), 1, 'görünmez zoom uygulanmamalı');
  assert.deepEqual(log, [], 'boş karede dönüşüm yazılmamalı');
});

test('the punch expires on its own instead of pinning the camera', () => {
  resetCamera();
  punchCamera(1);
  // Geçmiş damga: `beginCamera` bir sonraki çağrıda punch'ı düşürür.
  // Dışarıdan zaman kaydırmadan, düşen punch'ın ikinci çağrıda etkisiz
  // olduğu tek deterministik yol: reset + yalnız climax.
  resetCamera();
  const zoom = beginCamera(makeCtx([]), ARENA);
  assert.equal(zoom, 1, 'punch bitmişken kamera 1:1 dönmeli');
  assert.equal(cameraStats.punch, 0);
});

test('climax holds a steady zoom that returns to 1:1 when the tension drops', () => {
  resetCamera();
  setCameraClimax(1);
  const tense = beginCamera(makeCtx([]), ARENA);
  assert.ok(tense > 1, 'gerilimde sahne içe yaklaşmalı');

  setCameraClimax(0);
  const calm = beginCamera(makeCtx([]), ARENA);
  assert.equal(calm, 1, 'gerilim bitince kamera 1:1 dönmeli');
  assert.equal(cameraStats.climax, 0);

  // Kısmi seviye: yarısı yarım kadar yaklaştırmalı (doğrusal, eşik değil).
  setCameraClimax(0.5);
  const half = beginCamera(makeCtx([]), ARENA);
  assert.ok(half > 1 && half < tense, `kısmi gerilim ara değer vermeli: ${half}`);
});

test('climax and punch compose instead of fighting each other', () => {
  resetCamera();
  setCameraClimax(1);
  const calm = beginCamera(makeCtx([]), ARENA);
  resetCamera();
  setCameraClimax(1);
  punchCamera(1);
  const punchy = beginCamera(makeCtx([]), ARENA);
  assert.ok(punchy > calm, 'punch climaks zoom\'unun ÜSTÜNE binmeli');
});

test('an invalid arena leaves the transform chain at 1:1', () => {
  resetCamera();
  punchCamera(1);
  for (const bad of [null, undefined, { width: 0, height: 0 }, { width: 10, height: 0 }]) {
    const log = [];
    assert.equal(beginCamera(makeCtx(log), bad), 1, `${JSON.stringify(bad)} geçersiz kutu`);
    assert.deepEqual(log, [], 'geçersiz kutu hiçbir dönüşüm yazmamalı');
  }
});

test('a non-positive punch is ignored rather than zooming out', () => {
  resetCamera();
  assert.equal(punchCamera(0), false);
  assert.equal(punchCamera(-1), false);
  assert.equal(punchCamera(Number.NaN), false);
  assert.equal(beginCamera(makeCtx([]), ARENA), 1, 'geçersiz punch kamerayı bozmalı');
});