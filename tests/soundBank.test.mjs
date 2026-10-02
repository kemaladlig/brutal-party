// Sound bank integrity — curated Kenney subset stays shippable.
//
// Locks: every referenced ogg exists on disk (spaces/apostrophes included),
// every SYNTH_TO_SAMPLE target is a real bank id, buses/volumes/throttles
// are sane, and the preload set stays small enough for a first-gesture warm
// (~12 files, not the pack's 400+ / ~10 MB).

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SOUND_BANK, SYNTH_TO_SAMPLE, PRELOAD_IDS } from '../src/core/soundBank.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VALID_BUS = new Set(['sfx', 'ui', 'voice', 'music']);

test('every bank file exists under public/sound', () => {
  const missing = [];
  let bytes = 0;
  for (const [id, entry] of Object.entries(SOUND_BANK)) {
    assert.ok(Array.isArray(entry.files) && entry.files.length > 0, `${id} needs files`);
    for (const f of entry.files) {
      const disk = join(ROOT, 'public', f.replace(/^\//, ''));
      if (!existsSync(disk)) missing.push(`${id} -> ${f}`);
      else bytes += statSync(disk).size;
    }
  }
  assert.deepEqual(missing, [], `missing samples:\n${missing.join('\n')}`);
  // Curated set stays under ~1.5 MB; full packs are ~10 MB.
  assert.ok(bytes < 1.5 * 1024 * 1024, `bank too heavy: ${Math.round(bytes / 1024)} KB`);
});

test('no referenced filename needs apostrophe escaping', () => {
  const bad = Object.values(SOUND_BANK).flatMap((e) => e.files).filter((f) => f.includes("'"));
  assert.deepEqual(bad, [], `apostrophe paths break some servers: ${bad.join(', ')}`);
});

test('synth map targets all resolve to bank ids', () => {
  for (const [fn, id] of Object.entries(SYNTH_TO_SAMPLE)) {
    assert.ok(SOUND_BANK[id], `${fn} maps to unknown bank id ${id}`);
  }
});

test('bank entries carry sane budgets', () => {
  for (const [id, e] of Object.entries(SOUND_BANK)) {
    assert.ok(VALID_BUS.has(e.bus), `${id} bad bus ${e.bus}`);
    assert.ok(e.volume > 0 && e.volume <= 1.2, `${id} bad volume ${e.volume}`);
    assert.ok(e.throttleMs >= 0 && e.throttleMs <= 500, `${id} bad throttle ${e.throttleMs}`);
    assert.ok(e.poly >= 1 && e.poly <= 4, `${id} bad poly ${e.poly}`);
  }
});

test('preload set stays small (first-gesture warm)', () => {
  assert.ok(PRELOAD_IDS.length > 0, 'nothing preloaded');
  assert.ok(PRELOAD_IDS.length <= 12, `preload too big: ${PRELOAD_IDS.length}`);
  for (const id of PRELOAD_IDS) assert.ok(SOUND_BANK[id], `preload ${id} unknown`);
});
