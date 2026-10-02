import test from 'node:test';
import assert from 'node:assert/strict';

const {
  PICKUP_CATALOG, PICKUP_META, EFFECTS,
  DEFAULT_PICKUP_VISUAL, pickupRequiresMet, availablePickupTypes,
} = await import('../src/core/pickupCatalog.js');
const { hasTabletopIcon } = await import('../src/core/tabletopIcons.js');

/** Katalog id kümesi — sessiz sürüklenmeye karşı kilitli (görsel ∪ davranış). */
const EXPECTED_IDS = [
  'APPLE', 'BLAST_WAVE', 'BOMB', 'FAST', 'FLASH', 'FREEZE', 'GHOST', 'GOLDEN_STAR',
  'HEAL', 'INVERT', 'MULTI', 'QUICKDRAW', 'REPAIR_TILES', 'SCISSORS', 'SEISMIC',
  'SHIELD', 'SHRINK', 'SLIP', 'SLOW', 'SPEED', 'SUPER_JUMP', 'TELEPORT', 'THICK',
  'TRIPLE', 'TURBO', 'TURBO_BERRY', 'WALL',
];

test('katalog id kümesi beklenen görsel ∪ davranış birleşimidir', () => {
  assert.deepEqual(Object.keys(PICKUP_CATALOG).sort(), EXPECTED_IDS.slice().sort());
});

test('PICKUP_META her katalog id’si için görsel taşır (yoksa varsayılan)', () => {
  for (const id of Object.keys(PICKUP_CATALOG)) {
    const meta = PICKUP_META[id];
    assert.ok(meta, `${id} görseli olmalı`);
    assert.equal(typeof meta.color, 'string');
  }
  // Görselsiz tipler varsayılana düşer (eski drawPickup fallback davranışı).
  assert.equal(PICKUP_META.HEAL, DEFAULT_PICKUP_VISUAL);
});

test('her rozet ikonu tabletopIcons’ta çözülür — ham emoji gerekmez (K5)', () => {
  for (const [id, meta] of Object.entries(PICKUP_META)) {
    assert.ok(hasTabletopIcon(meta.icon), `${id} ikonu (${meta.icon}) çözülmeli`);
  }
});

test('EFFECTS eski davranış API’sini korur (yalnız effect’i olanlar)', () => {
  for (const id of ['TURBO', 'TELEPORT', 'SLIP', 'SHIELD', 'REPAIR_TILES', 'HEAL', 'BLAST_WAVE', 'APPLE']) {
    assert.equal(typeof EFFECTS[id], 'function', `${id} davranışı olmalı`);
  }
  assert.equal(EFFECTS.SCISSORS, undefined, 'yalnız görsel tip davranış taşımaz');
  assert.equal(Object.keys(EFFECTS).length, 14);
});

test('requires: tip oyunun alanlarına göre elenir (sessiz no-op yerine)', () => {
  const bare = { players: [{ index: 0 }] };
  const rich = {
    arena: {},
    players: [{ index: 0, hp: 3, grow() {} }],
    repairGrid() {},
    triggerBlastWave() {},
  };

  assert.equal(pickupRequiresMet('TELEPORT', bare), false, 'arena yok');
  assert.equal(pickupRequiresMet('TELEPORT', rich), true);
  assert.equal(pickupRequiresMet('REPAIR_TILES', bare), false);
  assert.equal(pickupRequiresMet('REPAIR_TILES', rich), true);
  assert.equal(pickupRequiresMet('BLAST_WAVE', bare), false);
  assert.equal(pickupRequiresMet('HEAL', bare), false);
  assert.equal(pickupRequiresMet('HEAL', rich), true);
  // requires’ı olmayan tip her oyunda geçer.
  assert.equal(pickupRequiresMet('TURBO', bare), true);
  assert.equal(pickupRequiresMet('TURBO', null), true);

  assert.deepEqual(
    availablePickupTypes(['TURBO', 'TELEPORT', 'REPAIR_TILES'], bare),
    ['TURBO'],
    'desteklenmeyen tipler listeden düşer',
  );
});
