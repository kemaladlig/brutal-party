// Faz 4.1 — oyun-özel travma/FX BÜTÇELERİ yalnız `fxKit`'te olur; motor gövdesi
// yalnız OLAY yayar. Bu sözleşme makineyle mühürlenir (AGENTS §3: denetlenebilir
// kural, makine kapısına bağlanır).
//
// 1) Motorlar kapalı `FX_KIND` kümesi dışında olay yayamaz (fxKit throw ederdi;
//    bu test onu build zamanına taşır).
// 2) Motor gövdesinde travma/partikül/flaş bütçe ALANI tanımlanamaz — sayılar
//    `fxKit FX_PROFILES`'ta TEK kaynaktır.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isFxKind } from '../src/core/fxKit.js';

const GAMES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'games');
const GAME_FILES = readdirSync(GAMES_DIR).filter((f) => f.endsWith('.js'));

test('4.1: motorlar yalnız kapalı FX_KIND kümesinden olay yayar', () => {
  const offenders = [];
  let emitted = 0;
  for (const file of GAME_FILES) {
    const src = readFileSync(join(GAMES_DIR, file), 'utf8');
    const re = /\.fx\.emit\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = re.exec(src)) !== null) {
      emitted += 1;
      if (!isFxKind(match[1])) offenders.push(`${file}: '${match[1]}'`);
    }
  }
  // Tarayıcı gerçekten motorları okudu mu? (boş liste yanlış yeşil vermesin)
  assert.ok(emitted > 0, 'en az bir motor FX olayı yaymalı');
  assert.deepEqual(offenders, [], `kapalı küme dışı FX olayı: ${offenders.join(', ')}`);
});

test('4.1: FX/travma bütçesi motor gövdesinde tanımlanmaz (yalnız fxKit)', () => {
  // `traumaSink:` eşleşmez (ardından `Sink` gelir); yalnız bütçe ALANI aranır.
  const budgetKey = /(?:^|[\s,{])(trauma|hitStopMs|flashSec|burst|particleCount)\s*:/;
  const offenders = GAME_FILES.filter((file) => budgetKey.test(readFileSync(join(GAMES_DIR, file), 'utf8')));
  assert.deepEqual(offenders, [], `motor gövdesinde FX bütçe alanı: ${offenders.join(', ')}`);
});
