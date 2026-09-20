// Quick Draw: Bot AI — reaksiyon + nişan penceresi + siper bekleme + blöf hatası.
// Kademe: NORMAL insansı (blöfe kanar, siperi bazen görmez), GOD keskin
// (nişanı kovalar, siperi bekler, blöfe kanmaz).
// Motor planBotShot() ile ateş zamanını kurar; bu modül tetikler + TENSION hatası yapar.

export function updateDuelBotAI(game, index, dt) {
  const st = game.playerStatus?.[index];
  if (!st || !game.joinedPlayers?.[index]) return;
  const god = game.slotTypes?.[index] === 'bot_god';

  // 1. TENSION: blöf anında NORMAL bot %12 erken basar (false-start)
  if (game.state === 'TENSION') {
    if (!god && !st.hasFired && !st.falseStart && game.fakeoutDisplayTimer > 0) {
      st._bluffRoll = st._bluffRoll ?? Math.random();
      // fakeoutDisplayTimer 0.6s pencerenin başında tek zar
      if (st._bluffRoll < 0.12 && game.fakeoutDisplayTimer > 0.45) {
        game.handlePlayerTap(index);
        return;
      }
    }
    if (game.fakeoutDisplayTimer <= 0) st._bluffRoll = undefined;
    return;
  }

  // 2. DRAW_SIGNAL: planlanan zamanda ateşle
  if (game.state === 'DRAW_SIGNAL') {
    if (!st.botPlanned || st.hasFired || st.falseStart) return;
    // Plan yoksa (örn. geç katılan bot) acil plan kur
    if (!st.botFireAt) {
      game.planBotShot?.(index);
      return;
    }
    if (performance.now() >= st.botFireAt) {
      game.handlePlayerTap(index);
    }
  }
}
