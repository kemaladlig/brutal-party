// tests/quickChrome.test.mjs
// Üst yüzen "quick chrome" çiplerinin tek tanımdan üretildiği sözleşmesi.
//
// Neden kilitlendi: tepki / ⋮ / tam ekran / düzen çipleri host `index.html` ve
// kumanda `gamepadShell.js` içinde AYRI AYRI yazılıydı; biri değişince diğeri
// sessizce sapıyordu. Artık TANIM tek (`src/ui/quickChrome.js`), sunum yüzey
// başına ayrı. Bu test iki yüzeyin de aynı kaynaktan doğduğunu ve host'a özel
// eylemlerin kumandaya sızmadığını doğrular.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { QUICK_CHIPS, renderHostQuickBar, renderPadHeader } from '../src/ui/quickChrome.js';

/** Bir HTML parçasındaki id sıralamasını çıkarır. */
function idsInOrder(html) {
  return [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
}

test('host üst kümesi beklenen çipleri doğru sırada üretir', () => {
  const ids = idsInOrder(renderHostQuickBar()).filter((id) => id.startsWith('btn-') || id.startsWith('quick-'));
  assert.deepEqual(ids, [
    'btn-quick-tv-lobby',
    'btn-layout-editor',
    'btn-quick-fullscreen',
    'quick-fullscreen-icon',
    'btn-quick-react',
    'btn-open-options',
  ]);
});

test('host yalnız host eylemlerini taşır, kumanda çiplerini taşımaz', () => {
  const host = renderHostQuickBar();
  assert.ok(host.includes('data-reaction-send="host"'), 'host tepkisi host göndericisine bağlı');
  assert.ok(!host.includes('btn-score-peek'), 'skor peek kumandaya özel');
  assert.ok(!host.includes('btn-gamepad-menu'), 'kumanda menüsü host barına sızmaz');
});

test('kumanda üst kümesi tepkiyi ⋮ menüsünün soluna koyar', () => {
  const { left, right } = renderPadHeader();
  assert.equal(left, '', 'sol grup artık çip taşımıyor — küme tek sırada');
  assert.ok(right.includes('data-reaction-send="pad"'), 'kumanda tepkisi pad göndericisi');
  assert.ok(right.includes('gamepad-react-btn'));
  // Sıra: taç peek önce, tepki, en son ⋮ menüsü (panel içi satırlar ayrı testte).
  const rightIds = idsInOrder(right).filter((id) => id.startsWith('btn-'));
  assert.deepEqual(rightIds.slice(0, 2), ['btn-score-peek', 'btn-gamepad-menu']);
  assert.ok(
    right.indexOf('gamepad-react-btn') < right.indexOf('id="gamepad-menu"'),
    'tepki düğmesi ⋮ düğmesinden önce basılır (başparmak yolu kısa)',
  );
  assert.ok(right.includes('id="gamepad-menu"'), '⋮ düğmesi ve paneli aynı sarmalayıcıda');
  assert.ok(right.includes('id="gamepad-menu-panel"'));
});

test('skor peek düğmesi gizli başlar (bant peek ile açılır)', () => {
  const { right } = renderPadHeader();
  const scoreTag = right.match(/<button[^>]*id="btn-score-peek"[^>]*>/)?.[0] || '';
  assert.match(scoreTag, /\shidden(\s|>)/, 'taç düğmesi `hidden` özniteliğiyle başlar');
});

test('kumanda ⋮ paneli düzen/tam ekran/ayrıl satırlarını taşır', () => {
  const { right } = renderPadHeader({ showLayoutEditor: true });
  assert.ok(right.includes('data-controller-layout-open'));
  assert.ok(right.includes('id="btn-fullscreen-toggle"'));
  assert.ok(right.includes('id="btn-leave-gamepad"'));
});

test('düzen satırı kapalıyken panel onu çizmez', () => {
  const { right } = renderPadHeader({ showLayoutEditor: false });
  assert.ok(!right.includes('data-controller-layout-open'));
  assert.ok(right.includes('id="btn-fullscreen-toggle"'), 'diğer satırlar kalır');
});

test('kayıt noktası içinde (yüzey, grup) başına domId tekildir', () => {
  const seen = new Set();
  for (const chip of QUICK_CHIPS) {
    if (!chip.domId) continue;
    const key = `${chip.surface}:${chip.group}:${chip.domId}`;
    assert.ok(!seen.has(key), `çift domId: ${key}`);
    seen.add(key);
  }
});

test('quickChrome modülü ham renk literali taşımaz (ikon rengi currentColor)', () => {
  const src = readFileSync(new URL('../src/ui/quickChrome.js', import.meta.url), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(stripped), 'ham hex renk yok');
});
