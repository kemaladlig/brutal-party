// public/sw.js precache kapısı — "yeni oyun = kapak precache + cache sürümü"
// kuralını PROSE'den MAKİNE GATE'e çevirir (AGENTS §3). COLOSSUS bu adımı
// atlayınca kapak PWA'da hiç görünmedi: `/assets/*` cache-first ve yeni kapak
// precache'te olmadığı için çevrimdışı istek düşüyordu.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GAME_ORDER, gameArtPath } from '../src/core/engineRegistry.js';

const SW_PATH = fileURLToPath(new URL('../public/sw.js', import.meta.url));

test('every registered game cover is precached by the service worker', () => {
  const sw = readFileSync(SW_PATH, 'utf8');
  const missing = GAME_ORDER.filter((mode) => {
    const url = gameArtPath(mode);
    // Dosya gerçekten var olmalı (kapak adı = mod adı formülü, AGENTS §10).
    assert.ok(existsSync(new URL(`../public${url}`, import.meta.url)), `kapak dosyası yok: ${url}`);
    return !sw.includes(`'${url}'`);
  });
  assert.deepEqual(missing, [], `sw.js precache'te eksik kapak: ${missing.join(', ')}`);
});

test('service worker cache version is a single bumpable constant', () => {
  const sw = readFileSync(SW_PATH, 'utf8');
  const versions = [...sw.matchAll(/const CACHE_NAME\s*=\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(versions.length, 1, 'sw.js tam olarak bir CACHE_NAME tanımlamalı');
  assert.match(versions[0], /^brutal-party-v\d+$/, `sürüm adı formülü bozuk: ${versions[0]}`);
});