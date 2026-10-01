// Faz 3.3 — okunurluk hiyerarşisi KABLOLAMA kilidi.
//
// Sözleşme: motorlar α'yı kendisi UYDURMAZ. Tek görür (selfSlot) taşıyan
// katman view'a aktarılır; view `fxReadAlpha({ isSelf, hasViewer })` ile T1
// (kendi) / T3 (diğer, −%25) α'sını fxKit'ten okur. Paylaşılan TV / selfSlot<0
// → `hasViewer=false` → dim YOK.
//
// Davranışın kendisi `tests/fxKit.test.mjs`'te kilitlidir; bu dosya yalnız
// "plumbing" var mı onu mühürler ki yeni bir oyun sessizce soluklaştırmasız
// kalmasın.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Kablolaması TAMAMLANMIŞ oyunlar. Yeni bir oyun 3.3'e bağlanınca buraya eklenir.
// (curve/pong `drawGameAvatar` kullanmadığı için 3.3-dışıdır.)
const WIRED_GAMES = [
  'tanks', 'archer', 'bomb', 'heist',
  'snake', 'collapse', 'horde', 'zone',
  'ninja', 'crown',
];

function read(...parts) {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

for (const game of WIRED_GAMES) {
  test(`3.3 kablolama: ${game} (view fxReadAlpha + engine slot + world selfSlot)`, () => {
    const view = read('src', 'games', `${game}View.js`);
    const engine = read('src', 'games', `${game}.js`);
    const world = read('src', 'ui', `${game}WorldView.js`);

    assert.match(
      view,
      /import\s*\{[^}]*fxReadAlpha[^}]*\}\s*from\s*'\.\.\/core\/fxKit\.js'/,
      `${game}View fxKit'ten fxReadAlpha import etmeli`,
    );
    assert.match(view, /fxReadAlpha\(\{\s*isSelf:/, `${game}View isSelf sınıflaması fxKit'ten olmalı`);
    assert.match(view, /hasViewer/, `${game}View tek-görür yok (hasViewer) kontrolü taşımalı`);

    assert.match(
      engine,
      /localControlSlot/,
      `${game} motoru görür koltuğunu (localControlSlot) view'a aktarmalı`,
    );

    assert.match(
      world,
      /context\.selfSlot/,
      `${game} world-view görür koltuğunu (context.selfSlot) view'a aktarmalı`,
    );
  });
}
