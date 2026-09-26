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

// ---------------------------------------------------------------------------
// Patlama katmanı (BOMB) — tek olay, 4 sayı
// ---------------------------------------------------------------------------

/**
 * Patlama anını paketler: `{ x, y, t, max } | null`. Aynı anda yalnız bir
 * patlama olur (BOMB tek taşıyıcılı), bu yüzden dizi değil tek nesne — 30 Hz
 * world bütçesine 4 sayı ekler, HUD paketi (8 Hz) dokunulmadan kalır.
 */
export function packBlast(blast) {
  if (!blast) return null;
  return {
    x: round1(blast.x || 0),
    y: round1(blast.y || 0),
    t: round1(blast.t || 0),
    max: round1(blast.max || 1),
  };
}

export function isValidBlast(blast) {
  if (blast === null) return true;
  return !!blast
    && finite(blast.x) && finite(blast.y)
    && finite(blast.t) && finite(blast.max) && blast.max > 0
    && blast.t >= 0 && blast.t <= blast.max;
}

/**
 * Patlamanın tüm görsel katmanı: saha flaşı → beyaz çekirdek → iki şok halkası
 * → is yüzüğü. Saf draw (host ve world-view client aynı çizer), `t` geçen süre.
 */
export function drawBlast(ctx, blast, arena) {
  if (!blast || !finite(blast.t)) return;
  const u = Number(arena?.unit) > 0 ? arena.unit : 1;
  const max = Math.max(0.001, Number(blast.max) || 1);
  const p = Math.max(0, Math.min(1, (Number(blast.t) || 0) / max));
  const { x, y } = blast;

  ctx.save();

  // 1) Saha flaşı — ilk %20'de saha kremi kızarır (okunabilirlik korunur).
  const flash = Math.max(0, 1 - p / 0.2);
  if (flash > 0 && arena) {
    ctx.globalAlpha = flash * 0.55;
    ctx.fillStyle = '#FFD9C0';
    ctx.fillRect(arena.left, arena.top, arena.width, arena.height);
    ctx.globalAlpha = 1;
  }

  // 2) İçten çevreye: koyu is yüzüğü (patlama ömrü boyunca solar).
  const scorch = Math.max(0, 1 - p * 0.75);
  ctx.globalAlpha = 0.30 * scorch;
  ctx.fillStyle = '#1A1A1A';
  ctx.beginPath();
  ctx.ellipse(x, y, 30 * u, 24 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 3) Şok halkaları: biri koyu ve geniş, biri kırmızı ve gecikmeli.
  const rings = [
    { from: 0.0, to: 0.72, r0: 10, r1: 96, w: 7, color: '#1A1A1A' },
    { from: 0.12, to: 1.0, r0: 6, r1: 62, w: 5, color: '#D84727' },
  ];
  for (const ring of rings) {
    const local = (p - ring.from) / (ring.to - ring.from);
    if (local <= 0 || local >= 1) continue;
    const eased = 1 - Math.pow(1 - local, 2.2);
    const r = (ring.r0 + (ring.r1 - ring.r0) * eased) * u;
    ctx.globalAlpha = (1 - local) * 0.85;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = Math.max(1, ring.w * u * (1 - local * 0.5));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 4) Çekirdek parlama — ilk %25'te beyaz kıvılcım.
  const core = Math.max(0, 1 - p / 0.25);
  if (core > 0) {
    ctx.globalAlpha = core;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(x, y, (10 + 26 * core) * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = core * 0.5;
    ctx.fillStyle = '#FFD122';
    ctx.beginPath();
    ctx.arc(x, y, (20 + 40 * core) * u, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
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
      ctx.lineWidth = 3.5 * (size / 15);
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
