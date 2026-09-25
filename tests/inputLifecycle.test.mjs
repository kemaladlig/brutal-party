import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimInputSource,
  releaseInputSource,
} from '../src/core/inputSource.js';

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

test('release only clears the owning source', () => {
  assert.equal(releaseInputSource('keyboard', 'touch'), 'keyboard');
  assert.equal(releaseInputSource('keyboard', 'keyboard'), null);
  assert.equal(releaseInputSource('keyboard', null), null);
});
