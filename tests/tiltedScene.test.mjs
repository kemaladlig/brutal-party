import test from 'node:test';
import assert from 'node:assert/strict';
import { strictRecorder } from './helpers/recorder.mjs';

const { createTiltedScene } = await import('../src/core/tiltedScene.js');

/** Sahne öğesi kalemi: yalnız etiket basar (statik fn, tahsis yok). */
function drawTag(ctx, name) { ctx.tag(name); }
function tags(log) { return log.filter((e) => e.startsWith('tag(')).map((e) => e.slice(4, -1)); }

const ARENA = {
  left: 100, top: 80, right: 1100, bottom: 680,
  width: 1000, height: 600, size: 600, unit: 20, cx: 600, cy: 380,
};
const VIEWPORT = { width: 1280, height: 720 };

test('open(): proj örneği KALICI (kimlik sabit), tilt/tema uygulanır, ölçek pozitif', () => {
  const scene = createTiltedScene({ camera: { tilt: 0.9, extraW: 40 } });
  const ctx = strictRecorder('sahne');
  const p1 = scene.open(ctx, { viewport: VIEWPORT, arena: ARENA, theme: 'wood' });
  assert.equal(p1.tilt, 0.9, 'kamera preset tilt uygulanmalı');
  assert.equal(p1.themeName, 'wood');
  assert.ok(p1.view.scale > 0, 'fit bir ölçek üretmeli');

  // Aynı sahne ikinci sahnöyü aynı örneği yeniden sığdırır (kare başına tahsis yok).
  const p2 = scene.open(ctx, { viewport: VIEWPORT, arena: ARENA, theme: 'garden' });
  assert.equal(p1, p2, 'proj kimliği sahneler arası sabit');
  assert.equal(scene.proj, p1, 'getter aynı örneği verir');
  assert.equal(p2.themeName, 'garden', 'tema yeniden çözülür');
  scene.close(ctx);
});

test('depth(): açık pencerede taban-Y’ye göre sıralanır, close ile çizilir', () => {
  const scene = createTiltedScene({ camera: { tilt: 0.92, extraW: 40 } });
  const ctx = strictRecorder('sahne');
  scene.open(ctx, { viewport: VIEWPORT, arena: ARENA, theme: 'wood' });
  scene.depth(ctx, 220, drawTag, 'GUNEY');
  scene.depth(ctx, 70, drawTag, 'KUZEY');
  scene.depth(ctx, 150, drawTag, 'ORTA');
  assert.equal(ctx.log.length, 0, 'close öncesi hiçbir şey çizilmez');
  scene.close(ctx);
  assert.deepEqual(tags(ctx.log), ['KUZEY', 'ORTA', 'GUNEY'], 'taban-Y artan sırayla');
});

test('close() idempotent ve açık pencere yokken boştur', () => {
  const scene = createTiltedScene();
  const ctx = strictRecorder('sahne');
  scene.close(ctx);
  assert.equal(ctx.log.length, 0, 'açılmamış sahne çizim üretmez');

  scene.open(ctx, { viewport: VIEWPORT, arena: ARENA, theme: 'wood' });
  scene.depth(ctx, 10, drawTag, 'A');
  scene.close(ctx);
  const after = ctx.log.length;
  scene.close(ctx);
  assert.equal(ctx.log.length, after, 'ikinci close no-op');
});

test('sahneler arası kuyruk sızıntısı yok', () => {
  const scene = createTiltedScene();
  const ctx = strictRecorder('sahne');
  for (let i = 0; i < 3; i += 1) {
    scene.open(ctx, { viewport: VIEWPORT, arena: ARENA, theme: 'wood' });
    scene.depth(ctx, 10 + i, drawTag, `R${i}`);
    scene.close(ctx);
  }
  assert.deepEqual(tags(ctx.log), ['R0', 'R1', 'R2']);
});
