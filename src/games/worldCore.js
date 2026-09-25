// Generic world-view snapshot çekirdeği (SNAKE/ARCHER/BOMB deseninden 3. tekrarda extract).
// Yeni oyunlar (4. world-view oyunundan itibaren) yalnızca deklaratif `extras` kaydıyla eklenir:
// createWorldSnapshot(game, { mode, mapPlayer, extras }) + isValidWorldBase(frame, mode, {...}).
// Client asla simülasyon/AI import etmez; burası salt serializer/validator + saf canvas draw'dır.

export const round1 = (v) => Math.round(Number(v) * 10) / 10;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * Host ve world-view aynı çizim fonksiyonlarını paylaşır.
 * Host varlıkları isJoined/isAlive, world snapshot ise joined/alive kullanır.
 */
export function isWorldEntityVisible(entity) {
  if (!entity) return false;
  const joined = entity.joined ?? entity.isJoined ?? (entity.slotType ? entity.slotType !== 'empty' : true);
  const alive = entity.alive ?? entity.isAlive ?? true;
  return joined !== false && alive !== false;
}

export function nextWorldSeq(game) {
  game._worldSeq = (Number(game._worldSeq) || 0) + 1;
  return game._worldSeq;
}

export function packArenaRect(arena = {}) {
  return [
    round1(arena.left || 0),
    round1(arena.top || 0),
    round1(arena.right || 0),
    round1(arena.bottom || 0),
  ];
}

export function packRectList(list, cap = 32) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, cap).map((r) => [round1(r.x), round1(r.y), round1(r.w), round1(r.h)]);
}

export function packParticles(particles, cap = 64) {
  if (!Array.isArray(particles)) return [];
  return particles.slice(0, cap).map((pt) => ({
    x: round1(pt.x),
    y: round1(pt.y),
    size: round1(pt.size ?? pt.radius ?? 3),
    // life/maxLife yoksa alpha konvansiyonuna düş (NINJA/CLONE/LASER partikülleri)
    life: round1(pt.life ?? pt.alpha ?? 0),
    maxLife: round1(pt.maxLife ?? 1),
    color: typeof pt.color === 'string' ? pt.color : '#1A1A1A',
  }));
}

export function packScores(scores) {
  return (Array.isArray(scores) ? scores : [0, 0, 0, 0]).map((s) => Number(s) || 0);
}

export function winnerIndex(v) {
  return v && Number.isInteger(v.index) ? v.index : null;
}

/**
 * Deklaratif snapshot: oyun yalnız `mode` + oyuncu eşlemesi + oyuna özgü `extras` verir.
 * @param {object} game - yetkili host motoru
 * @param {object} def - { mode, mapPlayer(p)=>object, extras?:object, particleCap?:number, list?:array (varsayılan game.players) }
 */
export function createWorldSnapshot(game, { mode, mapPlayer, extras = {}, particleCap = 64, list = null } = {}) {
  if (!game || !mode || typeof mapPlayer !== 'function') return null;
  const roster = Array.isArray(list) ? list : (Array.isArray(game.players) ? game.players : []);
  return {
    version: 1,
    mode,
    seq: nextWorldSeq(game),
    roundId: Number(game.roundId) || 0,
    gameState: game.state || 'LOBBY',
    arena: packArenaRect(game.arena),
    players: roster.map(mapPlayer),
    particles: packParticles(game.particles, particleCap),
    scores: packScores(game.scores),
    roundWinner: winnerIndex(game.roundWinner),
    matchWinner: winnerIndex(game.matchWinner),
    ...extras,
  };
}

/** Ortak oyuncu alanı kontrolü (slot/x/y); oyuna özgü alanlar `checkPlayer` ile genişletilir. */
export function isValidWorldPlayer(p) {
  return !!p
    && Number.isInteger(p.slot) && p.slot >= 0 && p.slot <= 3
    && finite(p.x) && finite(p.y);
}

function isValidPackedParticle(pt) {
  return !!pt && finite(pt.x) && finite(pt.y) && finite(pt.size)
    && finite(pt.life) && finite(pt.maxLife) && typeof pt.color === 'string';
}

/**
 * Base frame doğrulama: sürüm/mod/seq + arena + oyuncular + partiküller.
 * @param {object} frame - WORLD_FRAME
 * @param {string} mode
 * @param {object} opt - { checkPlayer?, checkExtra?, maxPlayers?, maxParticles? }
 */
export function isValidWorldBase(frame, mode, { checkPlayer = null, checkExtra = null, maxPlayers = 4, maxParticles = 64 } = {}) {
  if (!frame || frame.action !== 'WORLD_FRAME' || frame.version !== 1 || frame.mode !== mode) return false;
  if (!Number.isInteger(frame.seq) || frame.seq < 0) return false;
  if (!Number.isInteger(frame.roundId) || frame.roundId < 0) return false;
  if (!['LOBBY', 'PLAYING', 'ROUND_PAUSE', 'ROUND_OVER', 'MATCH_OVER', 'OVERTIME'].includes(frame.gameState)) return false;
  if (!Array.isArray(frame.arena) || frame.arena.length !== 4 || !frame.arena.every(finite)) return false;
  if (frame.arena[2] <= frame.arena[0] || frame.arena[3] <= frame.arena[1]) return false;
  if (!Array.isArray(frame.scores) || frame.scores.length > 4 || !frame.scores.every((score) => finite(score) && score >= 0)) return false;
  if (frame.roundWinner !== null && (!Number.isInteger(frame.roundWinner) || frame.roundWinner < 0 || frame.roundWinner > 3)) return false;
  if (frame.matchWinner !== null && (!Number.isInteger(frame.matchWinner) || frame.matchWinner < 0 || frame.matchWinner > 3)) return false;
  if (!Array.isArray(frame.players) || frame.players.length > maxPlayers) return false;
  if (!frame.players.every(isValidWorldPlayer)) return false;
  if (checkPlayer && !frame.players.every(checkPlayer)) return false;
  if (!Array.isArray(frame.particles) || frame.particles.length > maxParticles) return false;
  if (!frame.particles.every(isValidPackedParticle)) return false;
  if (checkExtra && !checkExtra(frame)) return false;
  return true;
}

/** Alfa metin draw'u (CLONE/LASER konvansiyonu; host↔client aynı, mutate etmez). */
export function drawAlphaTexts(ctx, texts, { size = 15, outline = false } = {}) {
  for (const ft of texts || []) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, ft.alpha ?? 1));
    ctx.font = `bold ${size}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (outline) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(26, 26, 26, 0.9)';
      ctx.lineWidth = 3.5;
      ctx.strokeText(ft.text, ft.x, ft.y);
    }
    ctx.fillStyle = ft.color || '#1A1A1A';
    ctx.fillText(ft.text, ft.x, ft.y);
    ctx.restore();
  }
}
/** Daire partikül draw'u (CLONE/NINJA/LASER konvansiyonu; host↔client aynı). */
export function drawCircleParticles(ctx, particles) {
  for (const part of particles || []) {
    ctx.save();
    const denom = Number(part.maxLife) || 0;
    ctx.globalAlpha = Math.max(0, Math.min(1, denom > 0 ? part.life / denom : 0));
    ctx.fillStyle = part.color || '#1A1A1A';
    ctx.beginPath();
    ctx.arc(part.x, part.y, Number(part.size ?? part.radius) || 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
/** Kare partikül draw'u (BOMB/HEIST/TANKS ortak; host↔client aynı). */
export function drawSquareParticles(ctx, particles) {
  for (const part of particles || []) {
    ctx.save();
    const denom = Number(part.maxLife) || 0;
    ctx.globalAlpha = Math.max(0, Math.min(1, denom > 0 ? part.life / denom : 0));
    ctx.fillStyle = part.color || '#1A1A1A';
    const s = Number(part.size) || 3;
    ctx.fillRect(part.x - s / 2, part.y - s / 2, s, s);
    ctx.restore();
  }
}
