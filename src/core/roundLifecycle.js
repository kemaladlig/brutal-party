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

/**
 * Raunt boşluğunun kalan saniyesi — 8 Hz paketin `roundGap` alanının TEK
 * kaynağı. Boşluk, raunt sonucunun ekranda durduğu süredir; kumanda bunu
 * bilmediğinde ekran bir sonraki raunta atladığı anda değişir ve oyuncuya
 * "bam diye başladı" gibi görünür.
 *
 * Motorlar sayacı farklı adta tutuyor (PONG kendi `roundOverTimer`'ını taşıyor,
 * ortak sözleşme `roundTransitionTimer`), bu yüzden alan adları burada tek
 * kapıdan okunur — her motora ayrı bir paket dalı yazmamak için.
 *
 * 0.5 sn'lik kova: paket JSON dirty-check'i ile taşır. Daha ince kova boşluk
 * boyunca her karede fark üretirdi (§5: 8 Hz sabit).
 */
export function roundGapSeconds(game) {
  if (!game || game.state !== 'ROUND_OVER') return 0;
  const left = Number(game.roundTransitionTimer ?? game.roundOverTimer ?? 0);
  if (!Number.isFinite(left) || left <= 0) return 0;
  return Math.ceil(left * 2) / 2;
}
