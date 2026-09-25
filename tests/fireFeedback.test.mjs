import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIRE_FEEDBACK_KIND,
  getFireCooldownProgress,
  getFireFeedbackForRender,
  getFireFeedbackSnapshot,
  isValidFireFeedbackSnapshot,
  markFireBlocked,
  markFireShot,
  resetFireFeedback,
  updateFireFeedback,
} from '../src/core/fireFeedback.js';

test('fire feedback blocks once per cooldown episode and reports progress', () => {
  const player = { shotCooldown: 0.8 };
  assert.equal(getFireCooldownProgress(player, 0.8), 0);
  assert.equal(markFireBlocked(player, 1000), true);
  assert.equal(markFireBlocked(player, 1050), false);
  assert.equal(player.fireFeedback.kind, FIRE_FEEDBACK_KIND.BLOCKED);
  assert.equal(player.fireFeedback.serial, 1);

  player.shotCooldown = 0.4;
  assert.equal(getFireCooldownProgress(player, 0.8), 0.5);
  player.shotCooldown = 0;
  updateFireFeedback(player, 2000);
  assert.equal(player.fireFeedback.kind, FIRE_FEEDBACK_KIND.READY);
  assert.equal(player.fireFeedback.serial, 2);
});

test('render feedback accepts both host state and client snapshots', () => {
  const player = { shotCooldown: 0.8 };
  markFireBlocked(player, 1000);
  const hostView = getFireFeedbackForRender(player, 1000);
  assert.equal(hostView.kind, FIRE_FEEDBACK_KIND.BLOCKED);
  assert.ok(hostView.ttl > 0 && hostView.ttl <= 0.18);

  const clientPlayer = { fireFeedback: hostView };
  assert.equal(getFireFeedbackForRender(clientPlayer, 1000), hostView);
});

test('fire feedback shot and reset states produce valid snapshots', () => {
  const player = { attackCooldown: 0.2 };
  markFireShot(player, 1000);
  const shot = getFireFeedbackSnapshot(player, 1000);
  assert.equal(shot.kind, FIRE_FEEDBACK_KIND.SHOT);
  assert.equal(isValidFireFeedbackSnapshot(shot), true);

  resetFireFeedback(player);
  const reset = getFireFeedbackSnapshot(player, 1000);
  assert.deepEqual(reset, { kind: null, serial: 0, ttl: 0 });
  assert.equal(isValidFireFeedbackSnapshot(reset), true);
  assert.equal(isValidFireFeedbackSnapshot({ kind: 'unknown', serial: 0, ttl: 0 }), false);
});
