// tests/matchOverEnter.test.mjs
// Final kartının giriş yumuşaması: MATCH_OVER'a girildiğinde kart ani
// belirmemeli; kısa bir solarak-aşağıdan-gelme ile açılmalı (AGENTS §8
// "nothing pops in abruptly"). `enter` sunum ilerlemesidir (0..1); host canvas
// ve kumanda world-view'ı aynı değeri `renderMatchOver`'a verir. Varsayılan 1 =
// animasyonsuz çizim; testler ve tek kare çağrıları etkilenmez.

import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMatchOver } from '../src/ui/hud.js';

function recorder() {
  const texts = [];
  const noop = () => {};
  const target = {
    measureText: (text) => ({ width: String(text).length * 8 }),
    fillText(text) {
      texts.push({ text: String(text), alpha: target.globalAlpha });
    },
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
  };
  const ctx = new Proxy(target, {
    get(obj, prop) { return prop in obj ? obj[prop] : noop; },
    set(obj, prop, value) { obj[prop] = value; return true; },
  });
  return { ctx, texts };
}

const ARENA = { cx: 450, cy: 250, width: 900, height: 500 };
const ROWS = [{ name: 'CAN', color: '#2BA6E8', value: '5', score: 5 }];

test('enter = 1: kart tam opak çizilir (animasyon yok)', () => {
  const { ctx, texts } = recorder();
  renderMatchOver(ctx, { arena: ARENA, winnerName: 'CAN', rows: ROWS });
  assert.ok(texts.length > 0, 'kart hiçbir şey çizmedi');
  assert.ok(
    texts.every((item) => !(typeof item.alpha === 'number' && item.alpha < 1)),
    'enter = 1 iken opaklık düşürüldü',
  );
});

test('enter = 0: kart opaklık 0 ile başlar (görünmez)', () => {
  const { ctx, texts } = recorder();
  renderMatchOver(ctx, { arena: ARENA, winnerName: 'CAN', rows: ROWS, enter: 0 });
  assert.ok(texts.length > 0, 'içerik yine çizilir');
  assert.ok(texts.every((item) => item.alpha === 0), 'giriş başında kart görünür kaldı');
});

test('yarım girişte opaklık 0 ile 1 arasında (yumuşama)', () => {
  const { ctx, texts } = recorder();
  renderMatchOver(ctx, { arena: ARENA, winnerName: 'CAN', rows: ROWS, enter: 0.5 });
  const alpha = texts[0]?.alpha;
  assert.ok(typeof alpha === 'number' && alpha > 0 && alpha < 1, `beklenmeyen alpha: ${alpha}`);
});
