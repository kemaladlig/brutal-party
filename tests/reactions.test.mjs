import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REACTIONS,
  REACTION_KEYS,
  REACTION_KEY_MAX,
  DEFAULT_REACTION,
  isReactionKey,
  normalizeReactionKey,
} from '../src/core/reactions.js';
import { hasTabletopIcon } from '../src/core/tabletopIcons.js';

test('every reaction is a registered tabletop icon (no raw OS emoji on the wire)', () => {
  assert.ok(REACTIONS.length >= 6, 'reaction set should not be a single-option menu');
  for (const { key } of REACTIONS) {
    assert.ok(hasTabletopIcon(key), `${key} is not a vector icon`);
    assert.ok(isReactionKey(key));
  }
});

test('reaction keys stay inside the wire field budget', () => {
  for (const key of REACTION_KEYS) {
    assert.ok(key.length <= REACTION_KEY_MAX, `${key} exceeds the wire budget`);
  }
  assert.ok(isReactionKey(DEFAULT_REACTION));
});

test('normalize accepts keys, legacy emoji and casing; rejects junk', () => {
  assert.equal(normalizeReactionKey('flame'), 'flame');
  assert.equal(normalizeReactionKey('  CROWN '), 'crown');
  assert.equal(normalizeReactionKey('🔥'), 'flame');
  assert.equal(normalizeReactionKey('😂'), 'laugh');
  assert.equal(normalizeReactionKey('👻🏽'), 'ghost');
  assert.equal(normalizeReactionKey('f'), null);
  assert.equal(normalizeReactionKey('<script>'), null);
  assert.equal(normalizeReactionKey(''), null);
  assert.equal(normalizeReactionKey(undefined), null);
  assert.equal(normalizeReactionKey(42), null);
});
