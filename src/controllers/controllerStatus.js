// Merkezi kumanda durum metinleri — telefon üst şeridi için tek kaynak.
// gamepad.js içindeki oyun-başına if/else zincirinin yerini alır:
// çağrı `getControllerStatus(mode, playerIndex, data)` ile registry'den yapılır.
// Davranış birebir korunur (t() anahtarları ve formatlar aynı).

import { t, tIcon } from '../i18n.js';
import { getTabletopIconSvg } from '../core/tabletopIcons.js';

const ICON = {
  timer: getTabletopIconSvg('timer', { size: 12 }),
  heart: getTabletopIconSvg('heart', { size: 12 }),
};

function deadOrScore(playerIndex, data) {
  const dead = Array.isArray(data.alive) ? data.alive[playerIndex] === false : false;
  return dead ? t('pad.dead', data.scores.join('-')) : t('pad.scoreJoin', data.scores.join('-'));
}

const STATUS_BUILDERS = {
  PONG: (i, data) => {
    const time = Number.isFinite(data.timeLeft) ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    return `${t('pad.rallyLive', data.rally || 0, data.scores.slice(0, 4).join('-'))}${time}`;
  },
  ARCHER: (i, data) => {
    const time = Number.isFinite(data.timeLeft) ? data.timeLeft : 0;
    const charge = Math.round(Math.max(0, Math.min(100, Number(data.chg?.[i]) || 0)));
    const cooldown = Math.max(0, Math.ceil(Number(data.cd?.[i]) || 0));
    const cooldownText = cooldown > 0 ? ` • ${cooldown}s` : '';
    return `${t('pad.scoreJoin', data.scores.slice(0, 4).join('-'))} • ${ICON.timer} ${Math.ceil(time)}s • ${tIcon('pad.archerCharge')} ${charge}%${cooldownText}`;
  },
  TANKS: (i, data) => {
    const base = deadOrScore(i, data);
    const time = Number.isFinite(data.timeLeft) ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    const sudden = data.suddenDeath ? ` • ${tIcon('tanks.sudden')}` : '';
    const intro = Number(data.introTime) > 0 ? ` • START ${Math.ceil(data.introTime)}s` : '';
    return `${base}${time}${sudden}${intro}`;
  },
  CURVE: (i, data) => {
    const time = Number.isFinite(data.timeLeft) ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    return `${deadOrScore(i, data)}${time}`;
  },
  BOMB: (i, data) => {
    const timeStr = data.bombTime !== undefined ? `${data.bombTime}s` : '';
    const roundTime = data.timeLeft !== undefined ? ` • ROUND ${data.timeLeft}s` : '';
    if (data.carrier === i) return `${tIcon('pad.bombYou', timeStr)}${roundTime}`;
    if (data.carrier === -1 || data.carrier === null || data.carrier === undefined) return `${t('pad.bombFree', timeStr)}${roundTime}`;
    return `${t('pad.bombAt', data.carrier + 1, timeStr)}${roundTime}`;
  },
  HEIST: (i, data) => {
    const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const myCarried = Array.isArray(data.carried) ? (data.carried[i] ?? 0) : 0;
    const myVault = Array.isArray(data.vault) ? (data.vault[i] ?? 0) : 0;
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    return `${t('pad.heistStatus', timeStr, myCarried, myVault)}${draw}`;
  },
  CROWN: (i, data) => {
    const isKing = data.king === i;
    const myTime = data.crownTimes ? (data.crownTimes[i] || 0).toFixed(1) : '0.0';
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    const time = Number.isFinite(data.timeLeft) ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    if (isKing) return `${tIcon('pad.kingYou', myTime)}${draw}${time}`;
    if (data.king !== null && data.king !== undefined) return `${t('pad.kingAt', data.king + 1, myTime)}${draw}${time}`;
    return `${t('pad.crownFree', myTime)}${draw}${time}`;
  },
  ZONE: (i, data) => {
    const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const myPct = Array.isArray(data.pct) ? (data.pct[i] ?? 0) : 0;
    const leadPct = Array.isArray(data.pct) && data.leader >= 0 ? (data.pct[data.leader] ?? 0) : 0;
    const leadName = Array.isArray(data.names) && data.leader >= 0 ? (data.names[data.leader] || `P${data.leader + 1}`) : '';
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    if (data.leader === i) return `${tIcon('pad.zoneLead', myPct, timeStr)}${draw}`;
    return `${tIcon('pad.zoneChase', timeStr, myPct, leadName, leadPct)}${draw}`;
  },
  SNAKE: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    const nrg = Array.isArray(data.nrg) ? (data.nrg[i] ?? 100) : 100;
    const locked = Array.isArray(data.lock) ? !!data.lock[i] : false;
    const time = Number.isFinite(data.timeLeft) ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${tIcon('pad.nrg', nrg)}${locked ? ` ${t('pad.locked')}` : ''} • ${tIcon('pad.snakeAlive', aliveCount)}${time}`;
  },
  LASER: (i, data) => {
    const timeStr = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const myHp = Array.isArray(data.hp) ? (data.hp[i] ?? 0) : 0;
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    return `${tIcon('pad.scoreJoin', data.scores.join('-'))} • ${ICON.heart}${myHp} • ${ICON.timer} ${timeStr}${draw}`;
  },
  CLONE: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    const time = data.timeLeft !== undefined ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${tIcon('pad.cloneAlive', aliveCount)}${time}${draw}`;
  },
  COLLAPSE: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    const time = data.timeLeft !== undefined ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${tIcon('pad.collapseAlive', aliveCount)}${time}${draw}`;
  },
  NINJA: (i, data) => {
    const aliveCount = Array.isArray(data.alive) ? data.alive.filter(Boolean).length : 0;
    const dead = Array.isArray(data.alive) ? data.alive[i] === false : false;
    if (dead) return t('pad.dead', data.scores.join('-'));
    const time = data.timeLeft !== undefined ? ` • ${ICON.timer} ${Math.ceil(data.timeLeft)}s` : '';
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    return `${t('pad.scoreJoin', data.scores.join('-'))} • ${tIcon('pad.ninjaAlive', aliveCount)}${time}${draw}`;
  },
  HORDE: (i, data) => {
    if (Array.isArray(data.alive) && data.alive[i] === false) {
      return `${t('pad.dead', data.scores.join('-'))} • ${t('horde.roundWave', data.round || 1, data.wave || 1)}`;
    }
    const roundWave = t('horde.roundWave', data.round || 1, data.wave || 1);
    const hp = Array.isArray(data.hp) ? Math.max(0, data.hp[i] ?? 0) : 0;
    const weaponId = Array.isArray(data.weapons) ? (data.weapons[i] || 'SIDEARM') : 'SIDEARM';
    const weapon = t(`horde.weapon.${weaponId}`);
    const ammo = Array.isArray(data.ammo) ? data.ammo[i] : -1;
    const magazine = Array.isArray(data.magazines) ? data.magazines[i] : ammo;
    const reloading = Array.isArray(data.reloading) && data.reloading[i] === true;
    let ammoText = '∞';
    if (ammo >= 0) ammoText = reloading ? t('horde.reload') : `${ammo}/${magazine}`;
    if (data.phase === 'armory') {
      return t('pad.hordeArmory', data.scores.join('-'), data.nextRound || data.round || 1, weapon, Math.ceil(data.roundBreakTime || 0));
    }
    if (data.portal) return t('pad.hordePortal', data.scores.join('-'), roundWave, hp, `${weapon} ${ammoText}`);
    const enemies = Array.isArray(data.enemiesLeft) ? data.enemiesLeft[0] : (data.enemiesLeft || 0);
    return t('pad.hordeStatus', data.scores.join('-'), roundWave, enemies, hp, `${weapon} ${ammoText}`);
  },
  RACE: (i, data) => {
    const time = data.timeLeft !== undefined ? `${data.timeLeft}s` : '';
    const lap = Array.isArray(data.laps) ? (data.laps[i] || 0) : 0;
    const targetLap = data.targetLaps || 3;
    const draw = data.matchDraw ? ` • ${t('game.draw')}` : '';
    return `${t('pad.raceStatus', data.scores.join('-'), lap, targetLap, time)}${draw}`;
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
