export const DEFAULT_DRAW_TRANSITION = 1.6;

export function beginDrawRound(game, reason = 'draw', transition = DEFAULT_DRAW_TRANSITION) {
  game.state = 'ROUND_OVER';
  game.roundWinner = null;
  game.matchWinner = null;
  game.matchDraw = true;
  game.roundResolutionReason = reason;
  game.roundTransitionTimer = Math.max(0, Number(transition) || 0);
  return game;
}

export function hasMatchResult(game) {
  return !!(game.matchWinner || game.matchDraw);
}

export function roundTimedOut(timer, limit) {
  return Number.isFinite(limit) && limit > 0 && Number(timer) >= limit;
}
