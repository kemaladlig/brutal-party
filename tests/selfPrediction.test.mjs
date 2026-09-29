import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applySelfPrediction,
  createSelfPredictor,
  observeSelfFrame,
} from '../src/core/selfPrediction.js';

function frame(x, y, extra = {}) {
  return {
    selfPredict: true,
    sentAt: 0,
    arena: [0, 0, 1000, 1000],
    players: [{ slot: 0, x, y, radius: 10 }],
    ...extra,
  };
}

function observePair(state, from, to, dtMs = 33) {
  observeSelfFrame(state, frame(from[0], from[1], { sentAt: 1000 }), 0, 1000);
  observeSelfFrame(state, frame(to[0], to[1], { sentAt: 1000 + dtMs }), 0, 1000 + dtMs);
}

test('self prediction is a no-op without the packet opt-in flag', () => {
  const state = createSelfPredictor();
  const noFlag = frame(500, 500);
  delete noFlag.selfPredict;
  observePair(state, [400, 300], [430, 300]);
  assert.equal(applySelfPrediction(state, noFlag, 0, { dx: 1, dy: 0, force: 1 }, 0.05), noFlag);
});

test('self prediction observes speed and advances along live input', () => {
  const state = createSelfPredictor();
  observePair(state, [400, 300], [425, 300]); // 25 px / 33 ms ≈ 757 px/s
  assert.ok(state.speed > 600 && state.speed < 900, `speed=${state.speed}`);

  const base = frame(425, 300);
  const out = applySelfPrediction(state, base, 0, { dx: 1, dy: 0, force: 1 }, 0.05);
  assert.notEqual(out, base);
  assert.ok(out.players[0].x > 425, `x=${out.players[0].x}`);
  assert.equal(out.players[0].y, 300);
  // Kaynak frame mutasyona uğramaz (sunum kopyası).
  assert.equal(base.players[0].x, 425);
});

test('self prediction direction follows live input, not past velocity', () => {
  const state = createSelfPredictor();
  observePair(state, [400, 300], [430, 300]); // gözlenen hız +x
  const out = applySelfPrediction(state, frame(430, 300), 0, { dx: 0, dy: 1, force: 1 }, 0.04);
  assert.ok(out.players[0].y > 300, `y=${out.players[0].y}`);
  assert.equal(out.players[0].x, 430);
});

test('self prediction releases to the authoritative position when input is idle', () => {
  const state = createSelfPredictor();
  observePair(state, [400, 300], [430, 300]);
  const base = frame(430, 300);
  assert.equal(applySelfPrediction(state, base, 0, { dx: 0, dy: 0, force: 0 }, 0.05), base);
  assert.equal(applySelfPrediction(state, base, 0, null, 0.05), base);
});

test('self prediction never draws outside the arena', () => {
  const state = createSelfPredictor();
  observePair(state, [980, 300], [999, 300]);
  const out = applySelfPrediction(state, frame(999, 300), 0, { dx: 1, dy: 0, force: 1 }, 0.1);
  assert.ok(out.players[0].x <= 990, `x=${out.players[0].x}`);
});

test('self prediction ignores a missing local player', () => {
  const state = createSelfPredictor();
  observePair(state, [400, 300], [430, 300]);
  const other = frame(430, 300);
  other.players = [{ slot: 1, x: 430, y: 300, radius: 10 }];
  assert.equal(applySelfPrediction(state, other, 0, { dx: 1, dy: 0, force: 1 }, 0.05), other);
});
