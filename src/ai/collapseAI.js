// Brutal Collapse bot zekâsı: en çok sağlam komşulu hücreye yürü + tehlike
// sezince zıpla. Yalnızca game.grid / offset / cellSize / arena kullanır.

export function updateCollapseBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;

  if (bot.botCheckTimer <= 0) {
    bot.botCheckTimer = 0.2;

    const cx = Math.floor((bot.x - game.offsetX) / game.cellSize);
    const cy = Math.floor((bot.y - game.offsetY) / game.cellSize);

    let bestX = game.arena.cx;
    let bestY = game.arena.cy;
    let maxSafeNeighbors = -1;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;

        const tx = cx + dx;
        const ty = cy + dy;

        if (tx >= 0 && tx < game.gridCOLS && ty >= 0 && ty < game.gridROWS) {
          const tile = game.grid[ty][tx];
          if (tile.state === 0) {
            let safeNeighbors = 0;
            for (let ny = -1; ny <= 1; ny++) {
              for (let nx = -1; nx <= 1; nx++) {
                const nnx = tx + nx, nny = ty + ny;
                if (nnx >= 0 && nnx < game.gridCOLS && nny >= 0 && nny < game.gridROWS && game.grid[nny][nnx].state === 0) {
                  safeNeighbors++;
                }
              }
            }

            if (safeNeighbors > maxSafeNeighbors) {
              maxSafeNeighbors = safeNeighbors;
              bestX = game.offsetX + tx * game.cellSize + game.cellSize / 2;
              bestY = game.offsetY + ty * game.cellSize + game.cellSize / 2;
            }
          }
        }
      }
    }

    const dirX = bestX - bot.x;
    const dirY = bestY - bot.y;
    const dist = Math.hypot(dirX, dirY);

    if (dist > 5) {
      bot.steerX = dirX / dist;
      bot.steerY = dirY / dist;
    }

    // Tehlike algılama: önündeki kare boşsa/çöküyorsa zıpla
    const lookAheadX = Math.floor((bot.x + bot.steerX * game.cellSize * 1.2 - game.offsetX) / game.cellSize);
    const lookAheadY = Math.floor((bot.y + bot.steerY * game.cellSize * 1.2 - game.offsetY) / game.cellSize);

    if (lookAheadX >= 0 && lookAheadX < game.gridCOLS && lookAheadY >= 0 && lookAheadY < game.gridROWS) {
      const aheadTile = game.grid[lookAheadY][lookAheadX];
      if (aheadTile.state === 2 || (aheadTile.state === 1 && aheadTile.timer < 0.3)) {
        game.attemptJump(bot);
      }
    }
  }
}
