// Merkezi kumanda durum metinleri — telefon üst şeridi için tek kaynak.
// gamepad.js içindeki oyun-başına if/else zincirinin yerini alır:
// çağrı `getControllerStatus(mode, playerIndex, data)` ile registry'den yapılır.
// Davranış birebir korunur (t() anahtarları ve formatlar aynı).

import { t } from '../i18n.js';

function deadOrScore(playerIndex, data) {
  const dead = Array.isArray(data.alive) ? data.alive[playerIndex] === false : false;
  return dead ? t('pad.dead', data.scores.join('-')) : t('pad.scoreJoin', data.scores.join('-'));
}

const STATUS_BUILDERS = {
  PONG: (i, data) => t('pad.rallyLive', data.rally || 0, data.scores.slice(0, 4).join('-')),
  TANKS: (i, data) => deadOrScore(i, data),
  CURVE: (i, data) => deadOrScore(i, data),
  BOMB: (i, data) => {
    const timeStr = data.bombTime !== undefined ? `${data.bombTime}s` : '';
    if (data.carrier === i) return t('pad.bombYou', timeStr);
    if (data.carrier === -1 || data.carrier === null || data.carrier === undefined) return t('pad.bombFree', timeStr);
    return t('pad.bombAt', data.carrier + 1, timeStr);
  },
  HEIST: (i, data) => {
    const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const myCarried = Array.isArray(data.carried) ? (data.carried[i] ?? 0) : 0;
    const myVault = Array.isArray(data.vault) ? (data.vault[i] ?? 0) : 0;
    return t('pad.heistStatus', timeStr, myCarried, myVault);
  },
  CROWN: (i, data) => {
    const isKing = data.king === i;
    const myTime = data.crownTimes ? (data.crownTimes[i] || 0).toFixed(1) : '0.0';
    if (isKing) return t('pad.kingYou', myTime);
    if (data.king !== null && data.king !== undefined) return t('pad.kingAt', data.king + 1, myTime);
    return t('pad.crownFree', myTime);
  },
  ZONE: (i, data) => {
    const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const myPct = Array.isArray(data.pct) ? (data.pct[i] ?? 0) : 0;
    const leadPct = Array.isArray(data.pct) && data.leader >= 0 ? (data.pct[data.leader] ?? 0) : 0;
    const leadName = Array.isArray(data.names) && data.leader >= 0 ? (data.names[data.leader] || `P${data.leader + 1}`) : '';
    if (data.leader === i) return t('pad.zoneLead', myPct, timeStr);
    return t('pad.zoneChase', timeStr, myPct, leadName, leadPct);
  },
  SNAKE: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    const nrg = Array.isArray(data.nrg) ? (data.nrg[i] ?? 100) : 100;
    const locked = Array.isArray(data.lock) ? !!data.lock[i] : false;
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.nrg', nrg)}${locked ? ` ${t('pad.locked')}` : ''} • ${t('pad.snakeAlive', aliveCount)}`;
  },
  LASER: (i, data) => {
    const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const myHp = Array.isArray(data.hp) ? (data.hp[i] ?? 0) : 0;
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ❤${myHp} • ⏱ ${timeStr}`;
  },
  CLONE: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.cloneAlive', aliveCount)}`;
  },
  COLLAPSE: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.collapseAlive', aliveCount)}`;
  },
  NINJA: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${t('pad.ninjaAlive', aliveCount)}`;
  },
};

export function getControllerStatus(mode, playerIndex, data) {
  const fn = STATUS_BUILDERS[mode];
  if (!fn || !data || !Array.isArray(data.scores)) return '';
  try {
    return fn(playerIndex, data) || '';
  } catch {
    return '';
  }
}
