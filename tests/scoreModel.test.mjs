// tests/scoreModel.test.mjs
// Skor görünümünün tek modeli (`ui/scoreModel.js`): koltuk seçimi, isim/renk ve
// lider kuralı host canvas'ı ile kumanda peek'i arasında paylaşılır. Bu test iki
// girdi şeklinin de aynı sonucu verdiğini ve lider kuralının sessizce
// kaymadığını kilitler.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreEntries } from '../src/ui/scoreModel.js';
import { UI_COLORS } from '../src/ui/tokens.js';

test('host motor şekli: yalnız dolu koltuklar, isim/renk düşmeleriyle', () => {
  const players = [
    { index: 0, name: 'AYSE', color: '#111111', isJoined: true },
    { index: 1, name: 'CAN', color: '#222222', isJoined: false },
    { index: 2, name: '', color: null, isJoined: true },
    null,
  ];
  const entries = scoreEntries({ players, scores: [3, 9, 1, 0] });
  assert.deepEqual(entries.map((e) => [e.index, e.name, e.score]), [
    [0, 'AYSE', 3],
    [2, 'P3', 1],
  ]);
  assert.equal(entries[1].color, UI_COLORS.players[2], 'eksik renk token paletinden gelir');
});

test('uzak kumanda şekli: dolu kararı isim varlığından', () => {
  const names = ['AYSE', null, 'CAN', null];
  const slots = [{ color: '#111111' }, null, { color: '#333333' }, null];
  const entries = scoreEntries({ names, slots, scores: [2, 0, 5, 0] });
  assert.deepEqual(entries.map((e) => [e.index, e.name, e.color, e.score]), [
    [0, 'AYSE', '#111111', 2],
    [2, 'CAN', '#333333', 5],
  ]);
});

test('iki yüzey aynı maçta aynı koltukları ve lideri görür', () => {
  const host = scoreEntries({
    players: [
      { index: 0, name: 'AYSE', color: '#111', isJoined: true },
      { index: 1, name: 'CAN', color: '#222', isJoined: true },
      { index: 2, name: 'EDA', color: '#333', isJoined: true },
      { index: 3, name: 'FUR', color: '#444', isJoined: true },
    ],
    scores: [1, 4, 4, 0],
  });
  const pad = scoreEntries({
    names: ['AYSE', 'CAN', 'EDA', 'FUR'],
    slots: [{ color: '#111' }, { color: '#222' }, { color: '#333' }, { color: '#444' }],
    scores: [1, 4, 4, 0],
  });
  const shape = (list) => list.map((e) => [e.index, e.name, e.score, e.leader]);
  assert.deepEqual(shape(host), shape(pad));
  assert.deepEqual(shape(host), [
    [0, 'AYSE', 1, false],
    [1, 'CAN', 4, true],
    [2, 'EDA', 4, true],
    [3, 'FUR', 0, false],
  ]);
});

test('lider yalnız puan varken işaretlenir; sıfır puan lider değildir', () => {
  const entries = scoreEntries({ names: ['A', 'B', null, null], scores: [0, 0, 0, 0] });
  assert.ok(entries.every((e) => e.leader === false));
});

test('skor, koltuk indeksiyle (dizi sırasıyla değil) eşleşir', () => {
  const entries = scoreEntries({
    players: [{ index: 3, name: 'SON', isJoined: true }],
    scores: [0, 0, 0, 7],
  });
  assert.deepEqual(entries.map((e) => [e.index, e.score]), [[3, 7]]);
});
