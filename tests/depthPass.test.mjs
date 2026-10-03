// Sahne derinlik geçişi — görsel katman sırasının sözleşmesi.
//
// Bu dosya metin taraması DEĞİL, modülü ÇALIŞTIRIR: "sıralama var mı" değil
// "varlıklar gerçekten y-sırasında mı çiziliyor" sorusunu sayısal cevaplar.
//
// Kilitler:
//   1) Karışık giriş sırası → y-sırası (2.5D okunabilirliğin kendisi).
//   2) Eşit derinlikte GİRİŞ SIRA korunur (stable) — belirsiz karşılaştırma yok.
//   3) Kare başına tahsis yok: sabit havuz, geri dönüşüm, kare sayacı.
//   4) Havuz tavanı taşınca en eski geri döner, sahne boş kalmaz.
//   5) Derinlik anahtarları ölçekle değişir (ham px yazılmaz).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEPTH_CAP,
  DEPTH_KIND,
  beginDepthPass,
  clearDepthPass,
  depthPassStats,
  entityDepth,
  flushDepthPass,
  obstacleDepth,
  pushDepthItem,
} from '../src/core/depthPass.js';

/** Sahne çizim günlüğü: flush sırasına göre "y:etiket" yazar. */
function makeCtx(log) {
  return {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    arc: () => {},
    ellipse: () => {},
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    strokeRect: () => {},
    save_: null,
    tag(label) { log.push(label); },
  };
}

/** Modül sabiti taklidi: her varlık için ayrı fonksiyon YOK, tek çizici. */
function tagger(log) {
  return (ctx, ref) => { log.push(ref); };
}

test('obstacles, pickups and players draw in y order, not in push order', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();

  // Kasıtlı olarak TERS sırada: en derin varlık ilk yazılıyor.
  pushDepthItem(900, DEPTH_KIND.PLAYER, 'player-alt', tagger(log), null);
  pushDepthItem(100, DEPTH_KIND.OBSTACLE, 'block-ust', tagger(log), null);
  pushDepthItem(500, DEPTH_KIND.PICKUP, 'pickup-orta', tagger(log), null);
  pushDepthItem(300, DEPTH_KIND.PLAYER, 'player-orta', tagger(log), null);
  pushDepthItem(700, DEPTH_KIND.OBSTACLE, 'block-alt', tagger(log), null);

  flushDepthPass(ctx);

  assert.deepEqual(
    log,
    ['block-ust', 'player-orta', 'pickup-orta', 'block-alt', 'player-alt'],
    'sahne y-sırasında çizilmeli: yukarıdaki varlık önce',
  );
});

test('equal depth keeps insertion order (no unstable comparison)', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  // Aynı y: sıralama karşılaştırması eşitlikte kaydırmamalı.
  pushDepthItem(500, DEPTH_KIND.OBSTACLE, 'birinci', tagger(log), null);
  pushDepthItem(500, DEPTH_KIND.PLAYER, 'ikinci', tagger(log), null);
  pushDepthItem(500, DEPTH_KIND.OBSTACLE, 'ucuncu', tagger(log), null);
  flushDepthPass(ctx);
  assert.deepEqual(log, ['birinci', 'ikinci', 'ucuncu']);
});

test('the pass is a fixed pool: flush empties it and reuses the same slots', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  pushDepthItem(10, DEPTH_KIND.OBSTACLE, 'a', tagger(log), null);
  assert.equal(depthPassStats.count, 1);
  flushDepthPass(ctx);
  assert.equal(depthPassStats.flushed, 1);
  assert.equal(depthPassStats.count, 0, 'flush sonrası havuz boşalmalı');

  // İkinci kare: aynı havuz yeniden kullanılır, YENİSİ oluşmaz.
  beginDepthPass();
  pushDepthItem(10, DEPTH_KIND.OBSTACLE, 'b', tagger(log), null);
  flushDepthPass(ctx);
  assert.deepEqual(log, ['a', 'b']);
});

test('the pool ceiling recycles the oldest entry instead of dropping the scene', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  for (let i = 0; i < DEPTH_CAP + 5; i += 1) {
    pushDepthItem(i, DEPTH_KIND.PLAYER, `p${i}`, tagger(log), null);
  }
  assert.equal(depthPassStats.overflow, 5, 'taşma sayacı görünür kalmalı');
  flushDepthPass(ctx);
  // Sahne BOŞ kalmaz ve y-sırası korunur; en eski beş giriş geri döner.
  assert.equal(log.length, DEPTH_CAP);
  assert.equal(log[0], 'p5');
  assert.equal(log.at(-1), `p${DEPTH_CAP + 4}`);
});

test('a begin without a flush cannot leak into the next frame', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  pushDepthItem(10, DEPTH_KIND.OBSTACLE, 'kayip', tagger(log), null);
  // Kare değişimi: yeni sahne başlar, yarım kalan liste düşer.
  beginDepthPass();
  pushDepthItem(20, DEPTH_KIND.PLAYER, 'yeni', tagger(log), null);
  flushDepthPass(ctx);
  assert.deepEqual(log, ['yeni'], 'yarım kalan sahne sonraki kareye sızmamalı');
});

test('depth keys derive from the body, not from absolute px', () => {
  // Engel tabanı = alt kenar; küre tabanı = merkez + yarıçapın oranı.
  assert.equal(obstacleDepth({ y: 100, h: 40 }), 140);
  assert.equal(obstacleDepth({ y: 100 }), 100);

  const small = entityDepth({ y: 100, radius: 10 });
  const large = entityDepth({ y: 100, radius: 40 });
  assert.ok(small > 100 && large > 100, 'gövde tabanı merkezden aşağıdadır');
  assert.ok(
    Math.abs((small - 100) / 10 - (large - 100) / 40) < 1e-9,
    'derinlik farkı gövde yarıçapının ORANIDIR, sabit px değil',
  );
});

test('a non-finite depth is treated as the back row instead of NaN-poisoning the sort', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  pushDepthItem(Number.NaN, DEPTH_KIND.PLAYER, 'bozuk', tagger(log), null);
  pushDepthItem(500, DEPTH_KIND.PLAYER, 'normal', tagger(log), null);
  flushDepthPass(ctx);
  // NaN "sıfır" sayılır: karşılaştırma tanımsızlaşmaz, liste dağılmaz.
  assert.deepEqual(log, ['bozuk', 'normal']);
});

test('flush with an empty pass touches nothing', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  flushDepthPass(ctx);
  assert.equal(log.length, 0);
});

test('clearDepthPass drops references so a stale scene cannot be drawn later', () => {
  const log = [];
  const ctx = makeCtx(log);
  beginDepthPass();
  pushDepthItem(10, DEPTH_KIND.PLAYER, 'eski', tagger(log), null);
  clearDepthPass();
  pushDepthItem(20, DEPTH_KIND.PLAYER, 'yeni', tagger(log), null);
  flushDepthPass(ctx);
  assert.deepEqual(log, ['yeni']);
});