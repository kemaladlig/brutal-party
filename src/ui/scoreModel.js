// Skor görünümünün TEK modeli.
//
// Host canvas skorbord (`ui/hud.js`) ve kumanda taç-peek şeridi
// (`gamepad.js`) aynı KOLTUK SEÇİMİNİ ve lider kuralını buradan alır: hangi
// koltuklar "dolu", etiket/isim ne, renk ne, kim lider. Yüzeyler bunu yalnız
// SUNAR (host kalıcı kart, kumanda peek çipleri); seçim mantığı iki yerde
// tutulmaz, yoksa biri değişince diğeri sessizce sapar.
//
// İki girdi şeklini de kabul eder:
//   - host motoru:  { players, scores }  (koltuk nesneleri `isJoined` taşır)
//   - uzak kumanda: { names, slots, scores } (STATE_SYNC düz alanları)
import { UI_COLORS } from './tokens.js';

/**
 * @typedef {object} ScoreEntry
 * @property {number} index
 * @property {string} name
 * @property {string} color
 * @property {number} score
 * @property {boolean} leader
 */

/**
 * @param {{ players?: any[], names?: any[], slots?: any[], scores?: number[] }} [source]
 * @returns {ScoreEntry[]}
 */
export function scoreEntries({ players, names, slots, scores = [] } = {}) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const p = players ? players[i] : null;
    let index = i;
    let name = null;
    let color = null;
    let filled = false;
    if (p) {
      filled = p.isJoined ?? (p.slotType !== 'empty');
      index = Number.isInteger(p.index) ? p.index : i;
      name = (p.name || `P${i + 1}`).toString();
      color = p.color || UI_COLORS.players[i];
    } else if (names) {
      filled = !!names[i];
      name = names[i];
      color = slots?.[i]?.color || UI_COLORS.players[i];
    }
    if (!filled || !name) continue;
    out.push({
      index,
      name: String(name),
      color,
      score: Number(scores[index]) || 0,
      leader: false,
    });
  }
  const max = out.reduce((m, e) => Math.max(m, e.score), 0);
  for (const e of out) e.leader = max > 0 && e.score === max;
  return out;
}
