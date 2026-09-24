import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createZoneWorldPacket,
  isValidZoneWorldFrame,
  packZoneGridRle,
  unpackZoneGridRle,
  ZONE_GRID,
} from '../src/games/zoneView.js';

function makeGame() {
  const grid = new Uint8Array(ZONE_GRID * ZONE_GRID);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) grid[r * ZONE_GRID + c] = 1;
  }
  for (let r = 40; r < 48; r++) {
    for (let c = 40; c < 48; c++) grid[r * ZONE_GRID + c] = 3;
  }

  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624, cx: 416, cy: 324 },
    field: { x: 100, y: 100, s: 632 },
    cell: 9.875,
    grid,
    gridVersion: 7,
    leaderIndex: 0,
    pct: [40, 10, 25, 5],
    players: [{
      index: 0,
      isJoined: true,
      isAlive: true,
      x: 400,
      y: 300,
      heading: 0.5,
      radius: 10,
      onHomeTurf: true,
      stunTimer: 0,
      blinkTimer: 0,
      dashCooldown: 2,
      relicTimer: 1,
      trail: [0, 1, 2, ZONE_GRID + 1],
      trailStartX: 395,
      trailStartY: 295,
    }],
    relics: [{ x: 500, y: 500, scale: 1, bobPhase: 0.3, type: 'FLASH' }],
    captureWaves: [{ x: 400, y: 300, radius: 50, alpha: 0.5, color: '#2F6A4F' }],
    particles: [{ x: 100, y: 100, size: 4, life: 0.5, maxLife: 1, color: '#D84727' }],
    floatingTexts: [{ x: 400, y: 280, text: '+5%', life: 0.5, maxLife: 1, color: '#2D6A4F' }],
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('zone grid RLE round-trips exactly', () => {
  const grid = new Uint8Array(ZONE_GRID * ZONE_GRID);
  for (let i = 0; i < grid.length; i += 7) grid[i] = (i % 5) + 1;

  const rle = packZoneGridRle(grid);
  const back = unpackZoneGridRle(rle);

  assert.equal(rle.length % 2, 0);
  assert.ok(rle.length < grid.length * 2, 'RLE should compress');
  assert.equal(back.length, grid.length);
  assert.deepEqual(Array.from(back), Array.from(grid));
});

test('zone world packet is declarative, complete and monotonic', () => {
  const game = makeGame();
  const first = createZoneWorldPacket(game);
  const second = createZoneWorldPacket(game);

  assert.equal(first.mode, 'ZONE');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.deepEqual(first.field, [100, 100, 632]);
  assert.ok(first.cell > 0);
  assert.equal(first.gridV, 7);
  assert.equal(first.leader, 0);
  assert.equal(first.relics[0].type, 'FLASH');
  assert.equal(first.waves[0].radius, 50);
  const p = first.players[0];
  assert.equal(p.home, true);
  assert.equal(p.pct, 40);
  assert.deepEqual(p.trail, [0, 1, 2, ZONE_GRID + 1]);
  assert.deepEqual(p.trailStart, [395, 295]);
  assert.ok(p.dashProg > 0 && p.dashProg < 1);

  // RLE gerçekten 4096 hücreyi temsil ediyor
  const unpacked = unpackZoneGridRle(first.rle);
  assert.equal(unpacked[0], 1);
  assert.equal(unpacked[40 * ZONE_GRID + 40], 3);
  assert.equal(unpacked[ZONE_GRID * 10 + 10], 0);

  assert.ok(isValidZoneWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidZoneWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('zone world frame validation rejects malformed input', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createZoneWorldPacket(game) };

  assert.equal(isValidZoneWorldFrame(frame), true);
  assert.equal(isValidZoneWorldFrame({ ...frame, rle: [1, 9] }), false);
  assert.equal(isValidZoneWorldFrame({ ...frame, rle: [0, 1] }), false);
  assert.equal(isValidZoneWorldFrame({ ...frame, rle: [1] }), false);
  assert.equal(isValidZoneWorldFrame({ ...frame, gridV: -1 }), false);
  assert.equal(isValidZoneWorldFrame({ ...frame, players: [{ ...frame.players[0], trail: [999999] }] }), false);
  assert.equal(isValidZoneWorldFrame({ ...frame, mode: 'COLLAPSE' }), false);
});
