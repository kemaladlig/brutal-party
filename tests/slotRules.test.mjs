import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canSwapSlots,
  getSlotSwapError,
  isBotSlot,
} from '../src/core/slotRules.js';

const human = (name) => ({ name, kind: 'human' });
const bot = (name) => ({ name, kind: 'bot' });

test('seat rules allow an empty target but never a bot source or target', () => {
  const slots = [human('HOST'), human('FRIEND'), null, bot('BOT')];
  assert.equal(getSlotSwapError({ from: 1, to: 2, slots }), null);
  assert.equal(canSwapSlots({ from: 1, to: 3, slots }), false);
  assert.equal(getSlotSwapError({ from: 1, to: 3, slots }), 'bot');
  assert.equal(getSlotSwapError({ from: 3, to: 0, slots }), 'bot');
});

test('remote players cannot target the reserved host seat', () => {
  const slots = [human('HOST'), human('FRIEND'), null, null];
  assert.equal(getSlotSwapError({
    from: 1,
    to: 0,
    slots,
    reservedHostSlot: 0,
    remote: true,
  }), 'host');
  assert.equal(canSwapSlots({
    from: 1,
    to: 2,
    slots,
    reservedHostSlot: 0,
    remote: true,
  }), true);
});

test('locked and empty-source moves return stable reasons', () => {
  const slots = [human('HOST'), human('FRIEND'), null, null];
  assert.equal(getSlotSwapError({ from: 1, to: 2, slots, locked: true }), 'locked');
  assert.equal(getSlotSwapError({ from: 2, to: 1, slots }), 'source');
  assert.equal(getSlotSwapError({ from: 1, to: 1, slots }), 'same');
  assert.equal(isBotSlot({ isBot: true }), true);
});
