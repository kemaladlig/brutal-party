import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimInputSource,
  releaseInputSource,
} from '../src/core/inputSource.js';
import { noteKeyDown, noteKeyUp, resetKeyOrder } from '../src/core/keyboardDispatch.js';
import { keyboardVectorFrom, readSlotKeys, resolveAxis } from '../src/core/inputMaps.js';

test('local input source arbitrates keyboard and touch', () => {
  let source = null;
  let result = claimInputSource(source, 'keyboard');
  assert.equal(result.accepted, true);
  source = result.current;
  result = claimInputSource(source, 'touch');
  assert.equal(result.accepted, false);
  source = releaseInputSource(source, 'keyboard');
  result = claimInputSource(source, 'touch');
  assert.equal(result.accepted, true);
  source = result.current;
  result = claimInputSource(source, 'keyboard');
  assert.equal(result.accepted, false);
  source = releaseInputSource(source, 'touch');
  assert.equal(source, null);
});

test('tabletop aim can coexist with the keyboard movement source', () => {
  const result = claimInputSource('keyboard', 'touch', { allowAlongside: true });
  assert.deepEqual(result, { accepted: true, current: 'keyboard' });
});

test('release only clears the owning source', () => {
  assert.equal(releaseInputSource('keyboard', 'touch'), 'keyboard');
  assert.equal(releaseInputSource('keyboard', 'keyboard'), null);
  assert.equal(releaseInputSource('keyboard', null), null);
});

test('keyboard SOCD resolves opposing keys with last-input-wins and falls back on release', () => {
  resetKeyOrder();
  const keys = { KeyA: true, KeyD: true };
  // Without press order, opposing keys stay neutral (backwards-compatible)
  assert.equal(keyboardVectorFrom(keys, 0).x, 0);
  assert.equal(readSlotKeys(keys, 0).dx, 0);

  noteKeyDown('KeyA');
  noteKeyDown('KeyD');
  assert.equal(keyboardVectorFrom(keys, 0).x, 1);
  assert.equal(resolveAxis(true, true, 'KeyA', 'KeyD'), 1);

  // Pressing A after D makes A win
  noteKeyDown('KeyA');
  assert.equal(keyboardVectorFrom(keys, 0).x, -1);

  // Releasing A leaves D active
  noteKeyUp('KeyA');
  delete keys.KeyA;
  assert.equal(keyboardVectorFrom(keys, 0).x, 1);
  resetKeyOrder();
});
