// Brutal Collapse bot zekâsı: en çok sağlam komşulu hücreye yürü + güçlendirmeleri topla + tehlike sezince zıpla.

export function updateCollapseBotAI(game, bot, dt) {
  bot.botCheckTimer -= dt;

  if (bot.botCheckTimer <= 0) {
    bot.botCheckTimer = 0.12;

    const cx = Math.floor((bot.x - game.offsetX) / game.cellSize);
    const cy = Math.floor((bot.y - game.offsetY) / game.cellSize);

    let bestX = game.arena.cx;
    let bestY = game.arena.cy;
    let maxScore = -999;

    // 1. Yakındaki güçlendirmeyi kontrol et
    let targetPickup = null;
    let minPickupDist = 180;
    for (const pu of game.pickups) {
      const d = Math.hypot(pu.x - bot.x, pu.y - bot.y);
      if (d < minPickupDist) {
        minPickupDist = d;
        targetPickup = pu;
      }
    }

    if (targetPickup) {
      bestX = targetPickup.x;
      bestY = targetPickup.y;
    } else {
      // 2. En güvenli komşu karoyu bul
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const tx = cx + dx;
          const ty = cy + dy;

          if (tx >= 0 && tx < game.gridCOLS && ty >= 0 && ty < game.gridROWS) {
            const tile = game.grid[ty][tx];
            if (tile.state === 0) {
              let score = 0;
              for (let ny = -1; ny <= 1; ny++) {
                for (let nx = -1; nx <= 1; nx++) {
                  const nnx = tx + nx, nny = ty + ny;
                  if (nnx >= 0 && nnx < game.gridCOLS && nny >= 0 && nny < game.gridROWS && game.grid[nny][nnx].state === 0) {
                    score += 10;
                  }
                }
              }
              // Merkeze yakınlık bonusu
              const distToCenter = Math.hypot(tx - 6, ty - 6);
              score -= distToCenter * 2;

              if (score > maxScore) {
                maxScore = score;
                bestX = game.offsetX + tx * game.cellSize + game.cellSize / 2;
                bestY = game.offsetY + ty * game.cellSize + game.cellSize / 2;
              }
            }
          }
        }
      }
    }

    const dirX = bestX - bot.x;
    const dirY = bestY - bot.y;
    const dist = Math.hypot(dirX, dirY);

    if (dist > 4) {
      bot.steerX = dirX / dist;
      bot.steerY = dirY / dist;
    }

    // Tehlike algılama: önündeki veya altındaki kare boşsa / çöküyorsa zıpla
    const currentTileX = Math.floor((bot.x - game.offsetX) / game.cellSize);
    const currentTileY = Math.floor((bot.y - game.offsetY) / game.cellSize);

    let mustJump = false;
    if (currentTileX >= 0 && currentTileX < game.gridCOLS && currentTileY >= 0 && currentTileY < game.gridROWS) {
      const curTile = game.grid[currentTileY][currentTileX];
      if (curTile.state === 1 && curTile.timer < 0.4) {
        mustJump = true;
      }
    }

    const lookAheadX = Math.floor((bot.x + bot.steerX * game.cellSize * 1.1 - game.offsetX) / game.cellSize);
    const lookAheadY = Math.floor((bot.y + bot.steerY * game.cellSize * 1.1 - game.offsetY) / game.cellSize);

    if (lookAheadX >= 0 && lookAheadX < game.gridCOLS && lookAheadY >= 0 && lookAheadY < game.gridROWS) {
      const aheadTile = game.grid[lookAheadY][lookAheadX];
      if (aheadTile.state === 2 || (aheadTile.state === 1 && aheadTile.timer < 0.35)) {
        mustJump = true;
      }
    }

    if (mustJump) {
      game.attemptJump(bot);
    }
  }
}
