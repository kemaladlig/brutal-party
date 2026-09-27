import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createReadOnlyView, isReadOnlyView, unwrapReadOnlyView } from '../src/core/botView.js';

describe('botView AI Firewall', () => {
  it('allows reading primitives, nested objects, and arrays', () => {
    const raw = {
      arena: { left: 0, top: 0, width: 800 },
      players: [
        { index: 0, name: 'P1', x: 100, y: 150 },
        { index: 1, name: 'P2', x: 200, y: 250 },
      ],
      state: 'PLAYING',
    };

    const view = createReadOnlyView(raw);
    assert.equal(isReadOnlyView(view), true);
    assert.equal(view.state, 'PLAYING');
    assert.equal(view.arena.width, 800);
    assert.equal(view.players.length, 2);
    assert.equal(view.players[0].name, 'P1');
    assert.equal(view.players[1].x, 200);

    // Array read methods work normally
    const names = view.players.map((p) => p.name);
    assert.deepEqual(names, ['P1', 'P2']);
    assert.equal(view.players.filter((p) => p.x > 150).length, 1);
  });

  it('prevents direct mutation of properties', () => {
    const raw = { state: 'PLAYING', count: 10 };
    const view = createReadOnlyView(raw);

    assert.throws(() => {
      view.state = 'MATCH_OVER';
    }, /Read-only violation/);

    assert.throws(() => {
      delete view.count;
    }, /Read-only violation/);

    assert.equal(raw.state, 'PLAYING');
    assert.equal(raw.count, 10);
  });

  it('prevents deep mutation on nested objects and array elements', () => {
    const raw = {
      arena: { left: 10 },
      players: [{ x: 50, alive: true }],
    };
    const view = createReadOnlyView(raw);

    assert.throws(() => {
      view.arena.left = 999;
    }, /Read-only violation/);

    assert.throws(() => {
      view.players[0].x = 1000;
    }, /Read-only violation/);

    assert.throws(() => {
      view.players[0] = { x: 0 };
    }, /Read-only violation/);

    assert.equal(raw.arena.left, 10);
    assert.equal(raw.players[0].x, 50);
  });

  it('blocks mutating array methods like push, pop, splice, sort', () => {
    const raw = { players: [1, 2, 3] };
    const view = createReadOnlyView(raw);

    assert.throws(() => {
      view.players.push(4);
    }, /mutating array method "push"/);

    assert.throws(() => {
      view.players.splice(0, 1);
    }, /mutating array method "splice"/);

    assert.throws(() => {
      view.players.sort();
    }, /mutating array method "sort"/);

    assert.equal(raw.players.length, 3);
  });

  it('executes host methods with original this context', () => {
    const raw = {
      dashToggled: false,
      slot: null,
      triggerDash(index) {
        this.dashToggled = true;
        this.slot = index;
        return 'dashed';
      },
    };

    const view = createReadOnlyView(raw);
    const result = view.triggerDash(2);

    assert.equal(result, 'dashed');
    assert.equal(raw.dashToggled, true);
    assert.equal(raw.slot, 2);
  });

  it('caches proxy instances and unwraps properly', () => {
    const raw = { arena: { width: 100 } };
    const view1 = createReadOnlyView(raw);
    const view2 = createReadOnlyView(raw);
    assert.equal(view1, view2);

    const arena1 = view1.arena;
    const arena2 = view1.arena;
    assert.equal(arena1, arena2);

    // Wrapping an already wrapped proxy returns same
    assert.equal(createReadOnlyView(view1), view1);

    // Unwrapping returns raw object
    assert.equal(unwrapReadOnlyView(view1), raw);
  });
});
