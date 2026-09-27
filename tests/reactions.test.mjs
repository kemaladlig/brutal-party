import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REACTIONS,
  REACTION_KEYS,
  REACTION_KEY_MAX,
  DEFAULT_REACTION,
  isReactionKey,
  reactionGlyph,
  reactionColorOf,
  normalizeReactionKey,
} from '../src/core/reactions.js';

test('every reaction carries a real emoji glyph and a sticker color', () => {
  assert.ok(REACTIONS.length >= 8, 'reaction set should not be a single-option menu');
  for (const { key, glyph, color, labelKey } of REACTIONS) {
    assert.ok(isReactionKey(key), `${key} is not registered`);
    // Görsel yüzey istisnası: tepki bir emoji (AGENTS §7 istisnası).
    assert.ok(/\p{Extended_Pictographic}/u.test(glyph), `${key} has no emoji glyph`);
    assert.equal(reactionGlyph(key), glyph);
    assert.match(color, /^#[0-9A-Fa-f]{6}$/, `${key} has no sticker color`);
    assert.ok(reactionColorOf(key), `${key} color is not reachable`);
    assert.ok(labelKey, `${key} has no i18n label`);
  }
  assert.equal(reactionGlyph('nope'), '');
  assert.equal(reactionColorOf('nope'), null);
  assert.equal(reactionColorOf(42), null);
});

test('reaction keys stay inside the wire field budget (ASCII on purpose)', () => {
  for (const key of REACTION_KEYS) {
    assert.ok(key.length <= REACTION_KEY_MAX, `${key} exceeds the wire budget`);
    assert.match(key, /^[a-z]+$/, `${key} must be ASCII: the wire never carries an emoji`);
  }
  assert.ok(isReactionKey(DEFAULT_REACTION));
});

test('normalize accepts keys, legacy emoji and casing; rejects junk', () => {
  assert.equal(normalizeReactionKey('flame'), 'flame');
  assert.equal(normalizeReactionKey('  CROWN '), 'crown');
  assert.equal(normalizeReactionKey('🔥'), 'flame');
  assert.equal(normalizeReactionKey('😂'), 'laugh');
  assert.equal(normalizeReactionKey('👻🏽'), 'ghost');
  assert.equal(normalizeReactionKey('👍🏿'), 'thumbsup');
  assert.equal(normalizeReactionKey('f'), null);
  assert.equal(normalizeReactionKey('<script>'), null);
  assert.equal(normalizeReactionKey(''), null);
  assert.equal(normalizeReactionKey(undefined), null);
  assert.equal(normalizeReactionKey(42), null);
});
