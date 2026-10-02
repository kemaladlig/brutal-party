// avatarRig.js — Avatar Lab tek kaynağı: klip + prop tanımları ve sunum pozu.
//
// Neden ayrı modül: `avatarInGame.js` oyun içi çizimin sahibidir, klip
// koreografisi bilmez. Lab (ve yarın oyun içi sevinme/tutma) pozu BURADAN
// okur, motor/simülasyon değişmez — yalnız sunum katmanı.
// Ham renk yok: prop paleti `ui/tokens.js`ten gelir.

import { UI_COLORS } from '../ui/tokens.js';

export const AVATAR_LAB_CLIPS = [
  { id: 'idle', label: 'BOŞTA' },
  { id: 'walk', label: 'YÜRÜME' },
  { id: 'cheer', label: 'SEVİNME' },
  { id: 'wave', label: 'SELAM' },
  { id: 'hold', label: 'TUTMA' },
];

export const AVATAR_LAB_PROPS = [
  { id: 'none', label: 'YOK' },
  { id: 'crown', label: 'TAÇ' },
  { id: 'bomb', label: 'BOMBA' },
  { id: 'flag', label: 'BAYRAK' },
  { id: 'coin', label: 'ALTIN' },
];

export const AVATAR_LAB_EXPRESSIONS = ['focus', 'wink', 'angry', 'derp', 'cyclops'];

/**
 * Klip pozu: mevcut penguen çizimini SÜRER (vx/vy + facing + dünya ofseti).
 * Dönen değerler `drawGameAvatar25d` girdisidir; yeni kemik state'i yok.
 * @param {string} clipId
 * @param {number} nowMs
 * @param {{ facingBase?: number, speed?: number }} [opts]
 */
export function rigPoseForClip(clipId, nowMs, opts = {}) {
  const t = nowMs / 1000;
  const facingBase = Number(opts.facingBase) || 0;
  const speed = Number(opts.speed) || 1;
  switch (clipId) {
    case 'walk': {
      // Arenada küçük tur: bakış teğete, hız `moving` eşiğini geçer.
      const r = 42;
      const a = t * 1.1 * speed + facingBase;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r * 0.7;
      const vx = -Math.sin(a) * 3.2 * speed;
      const vy = Math.cos(a) * 2.4 * speed;
      return { x, y, vx, vy, facingAngle: Math.atan2(vy, vx), hop: 0 };
    }
    case 'cheer': {
      // Zıplama + eksende sallanma: sevinme okuması konumdan gelir.
      const hop = Math.abs(Math.sin(t * 5.2)) * 22;
      return {
        x: 0, y: -hop * 0.4, vx: 0, vy: 0,
        facingAngle: facingBase + Math.sin(t * 5.2) * 0.35, hop,
      };
    }
    case 'wave': {
      // Yerinde, bakış hafif salınım: kol salınımı mevcut idle ile büyür.
      return {
        x: 0, y: 0, vx: 0, vy: 0,
        facingAngle: facingBase + Math.sin(t * 2.6) * 0.28, hop: 0,
      };
    }
    case 'hold':
    case 'idle':
    default: {
      if (clipId === 'hold') {
        const a = t * 0.55 * speed + facingBase;
        return {
          x: Math.cos(a) * 18, y: Math.sin(a) * 12,
          vx: -Math.sin(a) * 1.4, vy: Math.cos(a) * 1.0,
          facingAngle: facingBase, hop: 0,
        };
      }
      return { x: 0, y: 0, vx: 0, vy: 0, facingAngle: facingBase, hop: 0 };
    }
  }
}

/**
 * El soketi: gövdenin yan-altında, kol ucuna yakın. Prop buraya SAPLANIR
 * (üstüne konmaz): çizim sırası el → sap → başlık şeklindedir.
 */
export function labHandAnchor(fig, facingAngle) {
  if (!fig) return { x: 0, y: 0 };
  const side = facingAngle + Math.PI / 2;
  return {
    x: fig.torsoX + Math.cos(side) * fig.torsoR * 1.02,
    y: fig.torsoY + fig.torsoR * 0.52,
  };
}

/** Lab prop'u: elde okunur — sap ele girer, başlık dışarıda büyür. */
export function drawLabProp(ctx, propId, x, y, s, nowMs = 0) {
  if (!propId || propId === 'none') return;
  const t = nowMs / 1000;
  const bob = Math.sin(t * 3) * s * 0.05;
  // El kavrama noktası: prop'un altı ele GÖMÜLÜR, üstünde taşınmaz.
  const gripX = x;
  const gripY = y + bob + s * 0.35;
  ctx.save();
  ctx.lineWidth = Math.max(1.5, s * 0.09);
  ctx.strokeStyle = UI_COLORS.inkDark;
  ctx.lineCap = 'round';
  // Sap: elden başlığa giden kısa çubuk — "elde" okuması buradan gelir.
  ctx.beginPath();
  ctx.moveTo(gripX, gripY);
  ctx.lineTo(gripX, gripY - s * 0.55);
  ctx.stroke();
  ctx.translate(gripX, gripY - s * 0.55);
  if (propId === 'crown') {
    ctx.fillStyle = UI_COLORS.gold;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(-s * 0.7, -s * 0.9);
    ctx.lineTo(-s * 0.25, -s * 0.25);
    ctx.lineTo(0, -s * 1.05);
    ctx.lineTo(s * 0.25, -s * 0.25);
    ctx.lineTo(s * 0.7, -s * 0.9);
    ctx.lineTo(s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (propId === 'bomb') {
    ctx.fillStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = UI_COLORS.white;
    ctx.beginPath();
    ctx.arc(-s * 0.25, -s * 0.3, s * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.moveTo(s * 0.3, -s * 0.7);
    ctx.quadraticCurveTo(s * 0.7, -s * 1.2, s * 0.35, -s * 1.35);
    ctx.stroke();
    const spark = 0.6 + Math.abs(Math.sin(t * 9)) * 0.4;
    ctx.fillStyle = UI_COLORS.gold;
    ctx.beginPath();
    ctx.arc(s * 0.35, -s * 1.35, s * 0.22 * spark, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (propId === 'flag') {
    ctx.strokeStyle = UI_COLORS.inkDark;
    ctx.beginPath();
    ctx.moveTo(0, s);
    ctx.lineTo(0, -s * 1.2);
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.danger;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.2);
    ctx.lineTo(s * 1.3, -s * 0.85);
    ctx.lineTo(0, -s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (propId === 'coin') {
    ctx.fillStyle = UI_COLORS.gold;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.7, s * 0.85, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = UI_COLORS.hudAmber;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.38, s * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
