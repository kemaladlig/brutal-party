import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCollapseWorldPacket,
  isValidCollapseWorldFrame,
  COLLAPSE_COLS,
  COLLAPSE_ROWS,
} from '../src/games/collapseView.js';

const CELLS = COLLAPSE_COLS * COLLAPSE_ROWS;

function makeGame() {
  const grid = [];
  for (let r = 0; r < COLLAPSE_ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLLAPSE_COLS; c++) row.push({ state: 0, timer: 0 });
    grid.push(row);
  }
  grid[3][4] = { state: 1, timer: 0.4 };
  grid[5][5] = { state: 2, timer: 0 };

  return {
    state: 'PLAYING',
    roundId: 1,
    arena: { left: 16, top: 24, right: 816, bottom: 624, cx: 416, cy: 324 },
    cellSize: 46.15,
    grid,
    fallingTiles: [{ x: 400, y: 700, rot: 1.2, scale: 1, alpha: 0.8, size: 30, colorVariant: '#D99B26' }],
    shockwaves: [{ x: 400, y: 300, radius: 60, alpha: 0.5, color: '#FFDE59' }],
    pickups: [{ x: 200, y: 220, type: 'REPAIR_TILES', pulse: 0.5 }],
    players: [{
      index: 0, isJoined: true, isAlive: true,
      x: 400, y: 300, jumpTimer: 0.2, superJumpTimer: 1,
    }],
    particles: [{ x: 100, y: 100, radius: 4, alpha: 0.7, color: '#D99B26' }],
    scores: [1, 0, 0, 0],
    roundWinner: null,
    matchWinner: null,
  };
}

test('collapse world packet carries the full 13x13 grid', () => {
  const game = makeGame();
  const first = createCollapseWorldPacket(game);
  const second = createCollapseWorldPacket(game);

  assert.equal(first.mode, 'COLLAPSE');
  assert.equal(first.version, 1);
  assert.ok(second.seq > first.seq);

  assert.equal(first.grid.length, CELLS);
  assert.equal(first.grid[3 * COLLAPSE_COLS + 4], 1);
  assert.equal(first.grid[5 * COLLAPSE_COLS + 5], 2);
  assert.deepEqual(first.warn[0], [3 * COLLAPSE_COLS + 4, 0.4]);
  assert.ok(first.cell > 0);
  assert.equal(first.falling[0].color, '#D99B26');
  assert.equal(first.waves[0].radius, 60);
  assert.equal(first.pickups[0].type, 'REPAIR_TILES');
  assert.ok(first.players[0].jump > 0);
  assert.equal(first.players[0].super, true);

  assert.ok(isValidCollapseWorldFrame({ action: 'WORLD_FRAME', ...first }));
  assert.equal(isValidCollapseWorldFrame({ action: 'WORLD_FRAME', ...first, version: 2 }), false);
});

test('collapse world frame validation rejects malformed grids', () => {
  const game = makeGame();
  const frame = { action: 'WORLD_FRAME', ...createCollapseWorldPacket(game) };

  assert.equal(isValidCollapseWorldFrame(frame), true);
  assert.equal(isValidCollapseWorldFrame({ ...frame, grid: frame.grid.slice(1) }), false);
  assert.equal(isValidCollapseWorldFrame({ ...frame, grid: frame.grid.map((s, i) => (i === 0 ? 3 : s)) }), false);
  assert.equal(isValidCollapseWorldFrame({ ...frame, warn: [[999, 0.2]] }), false);
  assert.equal(isValidCollapseWorldFrame({ ...frame, cell: 0 }), false);
  assert.equal(isValidCollapseWorldFrame({ ...frame, mode: 'ZONE' }), false);
});
