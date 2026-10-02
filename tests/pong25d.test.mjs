import test from 'node:test';
import assert from 'node:assert/strict';
import { strictRecorder } from './helpers/recorder.mjs';

const { pongPaddleBounds } = await import('../src/games/pongView.js');
const { sceneBegin, sceneEnd, sceneDraw } = await import('../src/core/arenaKit.js');

/**
 * PONG 2.5D sözleşmesi.
 *
 * Kort raketleri saha DUVARININ üstünde durur: alt raketin taban-Y'si güney
 * rayının taban-Y'siyle AYNIdır. Ray `drawPongArena` içinde, raket `render`
 * içinde kuyruğa girer; eşit taban-Y'de sıra korunur, yani raket rayın önünde
 * (üstünde) çizilir. Bu bozulursa alt raket görünmez olur (piksel kanıtı:
 * taban merkezi raket rengi yerine ray tonunu örnekliyordu).
 */
test('PONG raket taban-Y: alt raket alt rayla eşit yükseklikte ve SONRA çizilir', () => {
  const ctx = strictRecorder('pong25d');
  const proj = { view: { scale: 1 }, proj: (x, y, z = 0) => ({ x, y, d: 1 }) };
  const arena = { left: 0, top: 0, right: 1280, bottom: 620, cx: 640, cy: 310, width: 1280, height: 620, unit: 1 };

  // Alt raket: yatay, sahanın alt duvarına yapışık (merkez = kenar - kalınlık/2).
  const paddle = { axis: 'horizontal', x: 640, y: arena.bottom - 10.5, length: 233, thickness: 21 };
  const b = pongPaddleBounds(paddle);
  assert.deepEqual([b.x, b.y, b.w, b.h], [523.5, 599, 233, 21], 'yatay raket kutusu');
  assert.equal(b.y + b.h, arena.bottom, 'alt raket tabanı saha alt kenarıyla aynı');

  // Sol raket: dikey, dönüşümlü eksen kutusu.
  const v = pongPaddleBounds({ axis: 'vertical', x: 10, y: 310, length: 125, thickness: 21 });
  assert.deepEqual([v.x, v.y, v.w, v.h], [-0.5, 247.5, 21, 125], 'dikey raket kutusu');

  sceneBegin(ctx, proj);
  sceneDraw(ctx, b.y + b.h, (c) => c.tag('rail'), proj);       // ray (drawPongArena)
  sceneDraw(ctx, b.y + b.h, (c) => c.tag('paddle'), proj);     // raket (render)
  sceneEnd(ctx);

  const tags = ctx.log.filter((e) => e.startsWith('tag(')).map((e) => e.slice(4, -1));
  assert.deepEqual(tags, ['rail', 'paddle'], 'eşit taban-Y’de ray önce, raket sonra');
});
