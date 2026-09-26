// src/core/qualityAuditors.js
// Pure and testable scanner functions for quality gates:
// I4 (View radius fallback fidelity),
// I5 (Unscaled geometry literals),
// I6 (Unscaled motion cues / lineWidth).

import { existsSync, readFileSync } from 'node:fs';

export const MODE_VIEW_MAP = Object.freeze({
  BOMB: 'src/games/bombView.js',
  HEIST: 'src/games/heistView.js',
  ARCHER: 'src/games/archerView.js',
  CROWN: 'src/games-retired/crownView.js',
  PONG: 'src/games/pongView.js',
  NINJA: 'src/games/ninjaView.js',
  HORDE: 'src/games/hordeView.js',
  RACE: 'src/games/raceView.js',
  LASER: 'src/games/laserView.js',
  ZONE: 'src/games/zoneView.js',
  TANKS: 'src/games/tanksView.js',
  SNAKE: 'src/games/snakeView.js',
  COLLAPSE: 'src/games/collapseView.js',
  CLONE: 'src/games-retired/cloneView.js',
  CURVE: 'src/games/curveView.js',
});

/**
 * I4 View Fallback Sadakati Denetimi (fail-closed).
 * @param {string} content
 * @param {number|null} playerDesignRadius
 * @param {string} [mode]
 * @returns {{ ok: boolean, drift: number, detail: string }}
 */
export function auditViewFidelityInContent(content, playerDesignRadius, mode = '') {
  if (!content) return { ok: true, drift: 0, detail: 'view yok' };

  // Fail-closed: motor yarıçapı okunamadıysa veya tanımsızsa kapı asla yeşil olamaz
  if (playerDesignRadius == null || !Number.isFinite(playerDesignRadius)) {
    return { ok: false, drift: Infinity, detail: 'motor yarıçapı okunamadı (fail-closed)' };
  }

  const fallbackRegex = /\b(?:player|p|ball)\.radius\s*(?:\|\||\?\?)\s*([A-Za-z0-9_]+|\d+(?:\.\d+)?)/g;
  const matches = [...content.matchAll(fallbackRegex)];

  if (matches.length === 0) {
    return { ok: true, drift: 0, detail: 'fallback yok (tek kaynak)' };
  }

  let maxDrift = 0;
  let worstDetail = '';

  for (const match of matches) {
    const rawVal = match[1];
    let fallbackVal = Number(rawVal);
    if (!Number.isFinite(fallbackVal)) {
      // Sabit adı (örn ARCHER_RADIUS, CLONE_RADIUS) ise sabit tanımını ara
      const constMatch = content.match(new RegExp(`(?:const|let|var)\\s+${rawVal}\\s*=\\s*(\\d+(?:\\.\\d+)?)`));
      if (constMatch) {
        fallbackVal = Number(constMatch[1]);
      } else {
        // Fail-closed: sabit çözülemediyse hata
        return { ok: false, drift: Infinity, detail: `sabit çözülemedi: ${rawVal} (fail-closed)` };
      }
    }

    const drift = Math.abs(Math.round(playerDesignRadius) - fallbackVal);
    if (drift > maxDrift) {
      maxDrift = drift;
      worstDetail = `motor ${playerDesignRadius}px vs view ${fallbackVal}px (fark ${drift}px)`;
    }
  }

  const ok = maxDrift === 0;
  return {
    ok,
    drift: +maxDrift.toFixed(1),
    detail: ok ? 'tam eşleşme' : worstDetail,
  };
}

export function auditViewFidelity(mode, playerDesignRadius) {
  const path = MODE_VIEW_MAP[mode];
  if (!path || !existsSync(path)) return { ok: true, drift: 0, detail: 'view yok' };
  const content = readFileSync(path, 'utf8');
  return auditViewFidelityInContent(content, playerDesignRadius, mode);
}

/**
 * I6 Hareket ipuçları ve trail lineWidth denetimi.
 * @param {string} content
 * @returns {number} Bulunan unscaled lineWidth sayısı
 */
export function auditMotionCuesInContent(content) {
  if (!content) return 0;
  const lines = content.split(/\r?\n/);
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // lineWidth = 8.5 veya seg.thick ? 8.5 : ... gibi çarpan barındırmayan ham atamalar
    if (/\b(?:ctx|c)\.lineWidth\s*=\s*seg\./.test(trimmed)) {
      if (!/(?:unit|u|hu|fieldPx|scale|\*)/.test(trimmed)) {
        count += 1;
      }
    } else if (/\b(?:ctx|c)\.lineWidth\s*=\s*\d+(?:\.\d+)?\s*;/.test(trimmed)) {
      if (!/(?:unit|u|hu|fieldPx|scale|\*)/.test(trimmed)) {
        count += 1;
      }
    }
  }

  return count;
}

export function getModeRelatedFiles(mode) {
  const m = mode.toLowerCase();
  const list = [
    `src/games/${m}.js`,
    `src/games-retired/${m}.js`,
    `src/games/${m}View.js`,
    `src/games-retired/${m}View.js`,
    `src/ui/${m}WorldView.js`,
  ];
  if (mode === 'PONG') {
    list.push('src/games/game.js', 'src/games/paddle.js', 'src/games/ball.js');
  } else if (mode === 'RACE') {
    list.push('src/games/raceLogic.js');
  }
  return list.filter(existsSync);
}

export function auditMotionCues(mode) {
  const files = getModeRelatedFiles(mode);
  let total = 0;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    total += auditMotionCuesInContent(content);
  }
  return total;
}

/**
 * I5 Geometrik çizimlerde ölçeklenmemiş literal px denetimi.
 * @param {string} content
 * @returns {number} Bulunan unscaled geometry literal sayısı
 */
export function auditUnscaledGeometryInContent(content) {
  if (!content) return 0;
  const lines = content.split(/\r?\n/);
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Avatar çizimlerinde sabit borderWidth (çarpan barındırmayan)
    if (/\bborderWidth\s*:\s*\d+(?:\.\d+)?(?!\s*\*)/.test(trimmed)) {
      if (!/(?:unit|u|hu|fieldPx|scale|\*)/.test(trimmed)) {
        count += 1;
      }
    }
  }

  return count;
}

export function auditUnscaledGeometry(mode) {
  const files = getModeRelatedFiles(mode);
  let total = 0;
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    total += auditUnscaledGeometryInContent(content);
  }
  return total;
}
