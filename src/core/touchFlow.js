// Tek kayıt: dokunmatik akış yardımcıları (kadran matematiği + lobi/mola tap gardları).
// Motorlar kendi getQuadrant/getCornerZone kopyasını tutmaz; BaseGame üzerinden
// veya doğrudan buradan çağırır. Ses/efekt Yan etki YOK — playJoin/resetMatch
// gibi eylemler motorun verdiği callback'lerle çalışır (davranış paritesi).

// Köşe → slot: 0 sol-alt, 1 sol-üst, 2 sağ-üst, 3 sağ-alt
export function getQuadrant(arena, x, y) {
  const cx = arena?.cx ?? 0;
  const cy = arena?.cy ?? 0;
  if (x < cx && y >= cy) return 0;
  if (x < cx && y < cy) return 1;
  if (x >= cx && y < cy) return 2;
  return 3;
}

// ROUND_OVER tap-to-skip gardı: sayaç sıfırlanırsa true döner (motor return eder).
// timerField: çoğu motorda 'roundTransitionTimer', PONG'da 'roundOverTimer'.
export function roundOverSkipGuard(game, timerField = 'roundTransitionTimer') {
  if (game.state === 'ROUND_OVER' && game[timerField] > 0) {
    game[timerField] = 0;
    return true;
  }
  return false;
}

// Lobi merkez tap: yarıçap içinde + yeterli katılımcı varsa maçı başlatır.
export function lobbyCenterStartTap(game, touch, { radius = 65, minJoined = 2 } = {}) {
  const d = Math.hypot(touch.x - game.arena.cx, touch.y - game.arena.cy);
  if (d >= radius) return false;
  if (game.slotTypes.filter((s) => s !== 'empty').length >= minJoined) {
    game.startNewMatch();
  }
  return true;
}

// Lobi kadran tap: cycleSlotType + motor-özel koltuk senkronu (onSeatChange).
// Dönüş: dokunulan kadran indeksi.
export function lobbyQuadrantTap(game, touch, { onSeatChange } = {}) {
  const q = getQuadrant(game.arena, touch.x, touch.y);
  game.cycleSlotType(q);
  if (typeof onSeatChange === 'function') onSeatChange(q);
  return q;
}

// MATCH_OVER yeniden başlatma tap'i: uiTap sonrası çağrılır.
// radius=Infinity her dokunuşta başlatır (zone deseni).
export function matchOverRestartTap(game, touch, { radius = 75, onRestart } = {}) {
  if (Number.isFinite(radius)) {
    const d = Math.hypot(touch.x - game.arena.cx, touch.y - game.arena.cy);
    if (d >= radius) return false;
  }
  if (typeof onRestart === 'function') {
    onRestart();
  } else {
    game.resetMatch();
  }
  return true;
}
