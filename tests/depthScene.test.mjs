import test from 'node:test';
import assert from 'node:assert/strict';
import { strictRecorder } from './helpers/recorder.mjs';

const {
  sceneBegin, scenePush, sceneEnd, sceneObstacle, sceneDraw,
  drawObstacle, drawObstacleGround, drawObstacleMass,
  obstacleBaseY, entitySceneY,
} = await import('../src/core/arenaKit.js');

/** Sahne öğesi kalemi: yalnız etiket basar (statik fn, tahsis yok). */
function drawTag(ctx, name) {
  ctx.tag(name);
}

/** Logdaki `tag(...)` kalemlerini sırayla döndürür. */
function tags(log) {
  return log.filter((e) => e.startsWith('tag(')).map((e) => e.slice(4, -1));
}

/** Prizma çiziminin logdaki ilk anı (kontur stroke). */
function massIndex(log) {
  return log.findIndex((e) => e.startsWith('stroke('));
}

// ---------------------------------------------------------------------------
// 2.5D derinlik sıralaması (Tactile arena — pilot BOMB)
// ---------------------------------------------------------------------------

test('sahne kuyruğu taban Y’ye göre çizer: kuzeydeki varlık prizmanın ARKASINDA kalır', () => {
  const ctx = strictRecorder('sahne');
  const block = { x: 100, y: 100, w: 80, h: 60 }; // taban çizgisi 160
  sceneBegin();
  scenePush(entitySceneY(220, 30), drawTag, 'GUNEY');
  sceneObstacle(ctx, block, { variant: 'crate' });
  scenePush(entitySceneY(70, 30), drawTag, 'KUZEY');
  sceneEnd(ctx);

  assert.deepEqual(tags(ctx.log), ['KUZEY', 'GUNEY'], 'varlıklar kendi aralarında da sıralanır');
  const cut = massIndex(ctx.log);
  const northAt = ctx.log.findIndex((e) => e === 'tag(KUZEY)');
  const southAt = ctx.log.findIndex((e) => e === 'tag(GUNEY)');
  assert.ok(northAt < cut && cut < southAt,
    'prizma kuzeydeki varlıktan sonra, güneydekinden önce çizilmeli');
});

test('eşit Y’de ekleme sırası korunur (kararlı sıralama)', () => {
  const ctx = strictRecorder('sahne');
  sceneBegin();
  for (const name of ['A', 'B', 'C', 'D']) scenePush(50, drawTag, name);
  sceneEnd(ctx);
  assert.deepEqual(tags(ctx.log), ['A', 'B', 'C', 'D']);
});

test('kuyruk kapalıyken öğeler tekrar kullanılabilir; üst üste sahne sızıntısı yok', () => {
  const ctx = strictRecorder('sahne');
  for (let round = 0; round < 3; round += 1) {
    sceneBegin();
    scenePush(10 + round, drawTag, `R${round}`);
    sceneEnd(ctx);
    assert.deepEqual(tags(ctx.log).slice(-1), [`R${round}`]);
  }
  // sceneEnd kuyruğu kapatır: açık sahnede öğe kalmaz.
  sceneBegin();
  sceneEnd(ctx);
  assert.equal(tags(ctx.log).length, 3, 'kapanmış sahneden sonra çizim yok');
});

test('karışık durum: bloğun hem kuzeyinde hem güneyinde oyuncu varken sıra doğru', () => {
  const ctx = strictRecorder('sahne');
  const block = { x: 60, y: 60, w: 64, h: 96 }; // taban 156
  sceneBegin();
  scenePush(entitySceneY(200, 28), drawTag, 'ONDE');    // 214 → prizmadan sonra
  sceneObstacle(ctx, block, { variant: 'dark' });
  scenePush(entitySceneY(100, 28), drawTag, 'ARKADA');  // 114 → prizmadan önce
  sceneEnd(ctx);

  const cut = massIndex(ctx.log);
  const behindAt = ctx.log.findIndex((e) => e === 'tag(ARKADA)');
  const frontAt = ctx.log.findIndex((e) => e === 'tag(ONDE)');
  assert.ok(behindAt < cut, 'kuzeydeki oyuncu prizmanın arkasında kalır');
  assert.ok(cut < frontAt, 'güneydeki oyuncu prizmanın önüne çizilir');
});

test('kapalı sahnede sceneDraw/sceneObstacle hemen çizer (kuyruk sızıntısı yok)', () => {
  const ctx = strictRecorder('kapalı');
  sceneDraw(ctx, 10, drawTag, 'ANINDA');
  sceneObstacle(ctx, { x: 0, y: 0, w: 40, h: 40 }, { variant: 'stone' });
  assert.deepEqual(tags(ctx.log), ['ANINDA'], 'öğe kuyruğa değil ekrana gider');
  assert.ok(massIndex(ctx.log) > 0, 'prizma anında çizilmiştir');
  // Kapalıyken çağrılan sceneEnd boştur: yeni çizim üretmez.
  const before = ctx.log.length;
  sceneEnd(ctx);
  assert.equal(ctx.log.length, before);
});

test('derinlik anahtarları bloğun taban çizgisine göre okunur', () => {
  const block = { x: 0, y: 100, w: 40, h: 40 };
  assert.equal(obstacleBaseY(block), 140);
  assert.ok(entitySceneY(120, 30) < obstacleBaseY(block), 'kuzeydeki oyuncu bloğun gerisindedir');
  assert.ok(entitySceneY(150, 30) > obstacleBaseY(block), 'güneydeki oyuncu bloğun önündedir');
});

// ---------------------------------------------------------------------------
// Prizma: deterministik yükseklik, kompozit eşdeğerliği, bozuk girdi
// ---------------------------------------------------------------------------

/**
 * Relief imzası: mutlak konum HARİÇ op adı + ölçü argümanları. Konum girişin
 * kendisinden türer (yuvarlanmış paket koordinatı 0.03 px kayabilir); yükseklik,
 * yarıçap ve şerit kalınlıkları ise aynı kalmak ZORUNDADIR — prizma her cihazda
 * aynı okunur.
 */
function reliefSignature(log) {
  return log.map((entry) => {
    const open = entry.indexOf('(');
    const name = entry.slice(0, open);
    const args = entry.slice(open + 1, -1).split(',');
    return `${name}|${args.slice(2).join(',')}`;
  });
}

test('aynı dikdörtgen her cihazda aynı prizmayı basar (duvar yüksekliği deterministik)', () => {
  const obs = { x: 412.37, y: 260.91, w: 96, h: 64 };
  const a = strictRecorder('prizma');
  const b = strictRecorder('prizma');
  drawObstacleMass(a, obs, { variant: 'stone' });
  drawObstacleMass(b, { ...obs }, { variant: 'stone' });
  assert.deepEqual(a.log, b.log);
  // Paket 0.1 px yuvarlaması prizma ölçülerini değiştiremez (konum değil relief).
  const c = strictRecorder('prizma');
  drawObstacleMass(c, { x: 412.4, y: 260.9, w: 96, h: 64 }, { variant: 'stone' });
  assert.deepEqual(reliefSignature(a.log), reliefSignature(c.log));
});

test('drawObstacle = gölge katmanı + prizma katmanı (kompozit eşdeğer)', () => {
  const obs = { x: 20, y: 30, w: 72, h: 48 };
  const both = strictRecorder('kompozit');
  drawObstacle(both, obs, { variant: 'metal' });
  const ground = strictRecorder('gölge');
  drawObstacleGround(ground, obs, { variant: 'metal' });
  const mass = strictRecorder('prizma');
  drawObstacleMass(mass, obs, { variant: 'metal' });
  assert.deepEqual(both.log, [...ground.log, ...mass.log],
    'gölge HER ZAMAN prizmadan önce ve tüm varlıkların altındadır');
});

test('bozuk dikdörtgende ne gölge ne prizma çizilir', () => {
  for (const fn of [drawObstacleGround, drawObstacleMass, drawObstacle]) {
    const ctx = strictRecorder('bozuk');
    fn(ctx, { x: 0, y: 0, w: 0, h: 0 }, {});
    assert.equal(ctx.log.length, 0);
  }
});