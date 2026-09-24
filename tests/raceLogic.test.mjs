import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getRaceProgress,
  getSegmentProgress,
  RACE_TUNING,
} from '../src/games/raceLogic.js';
import { normalizeAngle } from '../src/core/physics2d.js';

const checkpoints = [
  { x: 100, y: 0 },
  { x: 0, y: 100 },
  { x: 0, y: 0 },
];

test('race progress increases continuously inside a checkpoint segment', () => {
  const start = { x: 0, y: 0, laps: 0, nextCheckpoint: 0 };
  const middle = { x: 50, y: 0, laps: 0, nextCheckpoint: 0 };
  const target = { x: 100, y: 0, laps: 0, nextCheckpoint: 0 };

  assert.equal(getSegmentProgress(start, checkpoints), 0);
  assert.ok(getSegmentProgress(middle, checkpoints) > 0.49);
  assert.ok(getSegmentProgress(middle, checkpoints) < 0.51);
  assert.equal(getSegmentProgress(target, checkpoints), 1);
  assert.ok(getRaceProgress(middle, checkpoints) > getRaceProgress(start, checkpoints));
});

test('checkpoint and lap transitions preserve total progress', () => {
  const atCheckpointTwo = { x: 0, y: 0, laps: 1, nextCheckpoint: 2 };
  const nextLap = { x: 0, y: 0, laps: 2, nextCheckpoint: 0 };
  assert.equal(getRaceProgress(atCheckpointTwo, checkpoints), getRaceProgress(nextLap, checkpoints));

  const atCheckpointZero = { x: 100, y: 0, laps: 1, nextCheckpoint: 0 };
  const checkpointOne = { x: 100, y: 0, laps: 1, nextCheckpoint: 1 };
  assert.equal(getRaceProgress(atCheckpointZero, checkpoints), getRaceProgress(checkpointOne, checkpoints));
});

test('jump tuning reaches the advertised hazard clearance', () => {
  const maxJumpHeight = RACE_TUNING.jumpVelocity ** 2 / (2 * RACE_TUNING.jumpGravity);
  assert.ok(maxJumpHeight > RACE_TUNING.jumpClearance);
});

test('angle normalization is stable across multiple revolutions', () => {
  assert.ok(Math.abs(normalizeAngle(Math.PI * 3) - Math.PI) < 1e-9);
  assert.ok(Math.abs(normalizeAngle(-Math.PI * 3) + Math.PI) < 1e-9);
});
