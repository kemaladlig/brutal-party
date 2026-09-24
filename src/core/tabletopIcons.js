// Tabletop Vector Icons: Lucide Neo-Brutalist Arcade Iconography
// OS-bağımsız, jilet gibi keskin, endüstri standardı Lucide Icons SVG / Path2D vektörleri.
// Emojilerin işletim sistemine göre (iOS / Android / Windows) değişen görünümü yerine
// %100 deterministik, sıfır ağ yükü ve donanım hızlandırmalı Canvas 2D / HTML SVG çizimi.

/**
 * Lucide İkon Tanımları (24x24 Standart Grid)
 * @type {Record<string, { id: string, aliases: string[], path: string, mode?: 'stroke' | 'fill' | 'both', strokeWidth?: number }>}
 */
const LUCIDE_REGISTRY = {
  zap: {
    id: 'zap',
    aliases: ['⚡', 'dash', 'lightning'],
    path: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
    mode: 'both',
  },
  rocket: {
    id: 'rocket',
    aliases: ['🚀', 'boost', 'rocket'],
    path: 'M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0 M12 9V4s3.03.55 4 2c1.08 1.62 0 5 0 5',
    mode: 'stroke',
  },
  bomb: {
    id: 'bomb',
    aliases: ['💣', 'fire', 'bomb'],
    path: 'M20 13a9 9 0 1 1-18 0 9 9 0 0 1 18 0z M14.35 4.65l1.95-1.95a2.41 2.41 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-1.95 1.95 M22 2l-1.5 1.5',
    mode: 'stroke',
  },
  crosshair: {
    id: 'crosshair',
    aliases: ['🎯', 'target', 'aim'],
    path: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M22 12h-4 M6 12H2 M12 6V2 M12 22v-4',
    mode: 'stroke',
  },
  flame: {
    id: 'flame',
    aliases: ['💥', 'tackle', 'burst', 'impact'],
    path: 'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
    mode: 'both',
  },
  rotate_cw: {
    id: 'rotate-cw',
    aliases: ['🌀', 'spin', 'vortex', 'rotate_cw', 'rotate-cw'],
    path: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8 M21 3v5h-5',
    mode: 'stroke',
  },
  sword: {
    id: 'sword',
    aliases: ['🗡️', 'action', 'strike', 'sword'],
    path: 'M14.5 17.5L3 6V3h3l11.5 11.5z M13 19l6-6 M16 20l4-4 M19 21l2-2',
    mode: 'stroke',
  },
  wind: {
    id: 'wind',
    aliases: ['💨', 'smoke', 'wind'],
    path: 'M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2 M9.6 4.6A2 2 0 1 1 11 8H2 M12.6 19.4A2 2 0 1 0 14 16H2',
    mode: 'stroke',
  },
  chevrons_up: {
    id: 'chevrons-up',
    aliases: ['🦘', 'jump', 'spring', 'chevrons_up', 'chevrons-up'],
    path: 'M17 11l-5-5-5 5 M17 18l-5-5-5 5',
    mode: 'stroke',
  },
  arrow_left: {
    id: 'arrow-left',
    aliases: ['◀', 'steer_left', 'arrow_left', 'arrow-left', 'chevron_left', 'chevron-left'],
    path: 'M12 19l-7-7 7-7 M19 12H5',
    mode: 'stroke',
    strokeWidth: 2.6,
  },
  arrow_right: {
    id: 'arrow-right',
    aliases: ['▶', 'steer_right', 'arrow_right', 'arrow-right', 'chevron_right', 'chevron-right'],
    path: 'M12 5l7 7-7 7 M5 12h14',
    mode: 'stroke',
    strokeWidth: 2.6,
  },
  target: {
    id: 'target',
    aliases: ['🏹', 'bow', 'arrow', 'bullseye'],
    path: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    mode: 'stroke',
  },
  snowflake: {
    id: 'snowflake',
    aliases: ['❄️', 'freeze', 'ice', 'snowflake'],
    path: 'M2 12h20 M12 2v20 M20 16l-4-4 4-4 M4 8l4 4-4 4 M16 4l-4 4-4-4 M8 20l4-4 4 4',
    mode: 'stroke',
  },
  swords: {
    id: 'swords',
    aliases: ['⚔️', 'melee', 'swords'],
    path: 'M14.5 17.5L3 6V3h3l11.5 11.5 M13 19l6-6 M16 20l4-4 M19 21l2-2 M9.5 17.5L21 6V3h-3L6.5 14.5 M11 19l-6-6 M8 20l-4-4 M5 21l-2-2',
    mode: 'stroke',
  },
  shield: {
    id: 'shield',
    aliases: ['🛡️', 'shield', 'protect'],
    path: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    mode: 'stroke',
  },
  sparkles: {
    id: 'sparkles',
    aliases: ['✨', 'sparkles', 'star'],
    path: 'M12 3l-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z M5 3v4 M3 5h4 M19 17v4 M17 19h4',
    mode: 'stroke',
  },
  flask_conical: {
    id: 'flask-conical',
    aliases: ['🧪', 'alchemy', 'flask'],
    path: 'M10 2v7.31 M14 9.3V2 M8.5 2h7 M14 9.3a6.5 6.5 0 1 1-4 0 M5.5 16h13',
    mode: 'stroke',
  },
  scroll: {
    id: 'scroll',
    aliases: ['📜', 'library', 'scroll'],
    path: 'M19 17V5a2 2 0 0 0-2-2H4 M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1 M15 5H9 M15 9H9 M15 13h-4',
    mode: 'stroke',
  },
  gem: {
    id: 'gem',
    aliases: ['💎', 'treasury', 'gem'],
    path: 'M6 3h12l4 6-10 12L2 9l4-6z M11 3l-3 6 4 12 4-12-3-6 M2 9h20',
    mode: 'stroke',
  },
  hammer: {
    id: 'hammer',
    aliases: ['🔨', 'hammer', 'repair'],
    path: 'M15 12l-8.5 8.5a2.12 2.12 0 1 1-3-3L12 9 M18 15l4-4 M21.5 11.5l-1.91-1.91A2 2 0 0 1 19 8.17V7l-2.26-2.26a6 6 0 0 0-4.2-1.76L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.17a2 2 0 0 1 1.42.59L18.5 14.5',
    mode: 'stroke',
  },
  crown: {    id: 'crown',
    aliases: ['👑', 'crown', 'king'],
    path: 'M11.56 3.27a.5.5 0 0 1 .88 0l2.95 5.6a1 1 0 0 0 1.52.29l4.27-3.66a.5.5 0 0 1 .8.52l-2.83 10.25a1 1 0 0 1-.96.73H5.81a1 1 0 0 1-.96-.73L2.02 6.02a.5.5 0 0 1 .8-.52l4.27 3.66a1 1 0 0 0 1.52-.29z M5 21h14',
    mode: 'both',
  },
  landmark: {
    id: 'landmark',
    aliases: ['🏛️', 'statue', 'altar', 'fountain', '⛲', '🗿'],
    path: 'M3 22h18 M6 18v-7 M10 18v-7 M14 18v-7 M18 18v-7 M12 2l8 5H4z',
    mode: 'stroke',
  },
  // UI & Menu Icons
  close: {
    id: 'x',
    aliases: ['✕', 'x', 'close'],
    path: 'M18 6 6 18 M6 6l12 12',
    mode: 'stroke',
    strokeWidth: 2.5,
  },
  check: {
    id: 'check',
    aliases: ['✓', 'check', 'selected'],
    path: 'M20 6 9 17l-5-5',
    mode: 'stroke',
    strokeWidth: 2.8,
  },
  copy: {
    id: 'copy',
    aliases: ['⧉', 'copy', 'duplicate'],
    path: 'M8 8h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V8z M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3',
    mode: 'stroke',
  },
  play: {
    id: 'play',
    aliases: ['▶', 'play', 'resume'],
    path: 'M6 3l14 9-14 9V3z',
    mode: 'both',
  },
  rotate_ccw: {
    id: 'rotate-ccw',
    aliases: ['↺', 'rotate_ccw', 'rotate-ccw', 'reset'],
    path: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5',
    mode: 'stroke',
  },
  log_out: {
    id: 'log-out',
    aliases: ['🚪', 'log_out', 'log-out', 'exit'],
    path: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
    mode: 'stroke',
  },
  tv: {
    id: 'tv',
    aliases: ['📺', 'tv', 'screen'],
    path: 'M4 7h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z M17 2l-5 5-5-5',
    mode: 'stroke',
  },
  volume_2: {
    id: 'volume-2',
    aliases: ['🔊', 'volume', 'volume_2', 'volume-2', 'sound_on'],
    path: 'M11 5L6 9H2v6h4l5 4V5z M15.54 8.46a5 5 0 0 1 0 7.07 M19.07 4.93a10 10 0 0 1 0 14.14',
    mode: 'stroke',
  },
  volume_x: {
    id: 'volume-x',
    aliases: ['🔇', 'volume_x', 'volume-x', 'sound_off', 'mute'],
    path: 'M11 5L6 9H2v6h4l5 4V5z M22 9l-6 6 M16 9l6 6',
    mode: 'stroke',
  },
  bot: {
    id: 'bot',
    aliases: ['🤖', 'bot', 'robot', 'ai'],
    path: 'M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z M12 2v4 M8 2h8 M9 13h.01 M15 13h.01',
    mode: 'stroke',
  },
  maximize_2: {
    id: 'maximize-2',
    aliases: ['⛶', 'maximize', 'maximize_2', 'maximize-2', 'fullscreen'],
    path: 'M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7',
    mode: 'stroke',
  },
  minimize_2: {
    id: 'minimize-2',
    aliases: ['minimize', 'minimize_2', 'minimize-2'],
    path: 'M4 14h6v6 M20 10h-6V4 M14 10l7-7 M3 21l7-7',
    mode: 'stroke',
  },
  eye: {
    id: 'eye',
    aliases: ['👁', 'eye', 'colorblind', 'vision'],
    path: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    mode: 'stroke',
  },
  gamepad_2: {
    id: 'gamepad-2',
    aliases: ['🕹️', 'gamepad', 'gamepad_2', 'gamepad-2', 'controls'],
    path: 'M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z M6 12h4 M8 10v4 M15 13h.01 M18 11h.01',
    mode: 'stroke',
  },
  pencil: {
    id: 'pencil',
    aliases: ['✏️', 'pencil', 'edit', 'edit_3', 'edit-3'],
    path: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z',
    mode: 'stroke',
  },
  dice: {
    id: 'dice-5',
    aliases: ['🎲', 'dice', 'dice_5', 'dice-5', 'random'],
    path: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M8 8h.01 M16 8h.01 M12 12h.01 M8 16h.01 M16 16h.01',
    mode: 'stroke',
  },
  arrow_left_right: {
    id: 'arrow-left-right',
    aliases: ['⇄', 'arrow_left_right', 'arrow-left-right', 'swap'],
    path: 'M8 3 4 7l4 4 M4 7h16 M16 21l4-4-4-4 M20 17H4',
    mode: 'stroke',
  },
  globe: {
    id: 'globe',
    aliases: ['🌍', 'globe', 'lang', 'language'],
    path: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20 M2 12h20',
    mode: 'stroke',
  },
  settings: {
    id: 'settings',
    aliases: ['⚙', 'settings', 'gear', 'config'],
    path: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    mode: 'stroke',
  },
  download: {
    id: 'download',
    aliases: ['↓', 'download', 'install'],
    path: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
    mode: 'stroke',
  },
  message_square: {
    id: 'message-square',
    aliases: ['💬', 'chat', 'message', 'message_square', 'message-square', 'reaction'],
    path: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    mode: 'stroke',
  },
};

// Anahtar ve takma adlardan (alias) hızlı erişim haritası
const ICON_LOOKUP = new Map();
for (const def of Object.values(LUCIDE_REGISTRY)) {
  ICON_LOOKUP.set(def.id.toLowerCase(), def);
  for (const alias of def.aliases) {
    ICON_LOOKUP.set(alias.trim().toLowerCase(), def);
  }
}

// 60-120 FPS için donanım hızlandırmalı Path2D nesne önbelleği
const PATH2D_CACHE = new Map();

function getCachedPath2D(d) {
  if (typeof Path2D === 'undefined') return null;
  let p = PATH2D_CACHE.get(d);
  if (!p) {
    p = new Path2D(d);
    PATH2D_CACHE.set(d, p);
  }
  return p;
}

/**
 * Belirtilen ikonun Lucide koleksiyonunda bulunup bulunmadığını kontrol eder.
 * @param {string} iconKey
 * @returns {boolean}
 */
export function hasTabletopIcon(iconKey) {
  if (!iconKey) return false;
  return ICON_LOOKUP.has(String(iconKey).trim().toLowerCase());
}

/**
 * Belirtilen ikonu Canvas 2D üzerinde (cx, cy) merkezli Lucide standardıyla çizer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} iconKey - Emojisi ('⚡', '💣', '🚀', '🌀'...) veya ID'si ('dash', 'fire'...)
 * @param {number} cx - Merkez X
 * @param {number} cy - Merkez Y
 * @param {number} size - İkon kutu boyutu (varsayılan 24px)
 * @param {Object} [options] - Renk ve durum seçenekleri
 */
export function drawTabletopIcon(ctx, iconKey, cx, cy, size = 24, options = {}) {
  const {
    color = '#141416',
    isReady = true,
    accentColor = '#F59E0B',
    strokeWidth = null,
  } = options;

  const key = String(iconKey || '').trim().toLowerCase();
  const def = ICON_LOOKUP.get(key);

  // Tanımlı Lucide ikonu varsa yüksek kaliteli vektör çizimi
  if (def) {
    const path2d = getCachedPath2D(def.path);
    if (path2d) {
      const s = size / 24;
      const baseWidth = def.strokeWidth || 2.2;
      const computedStroke = strokeWidth != null ? strokeWidth : Math.max(1.8, Math.round(baseWidth * s));

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-12, -12); // 24x24 grid merkezleme

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = computedStroke / s;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      const mode = def.mode || 'stroke';
      if (mode === 'both') {
        ctx.fill(path2d);
        ctx.stroke(path2d);
      } else if (mode === 'fill') {
        ctx.fill(path2d);
      } else {
        ctx.stroke(path2d);
      }

      ctx.restore();
      return;
    }
  }

  // Fallback: Unicode karakteri olarak çiz
  const s = size / 24;
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(20 * s)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(iconKey || ''), cx, cy + 1);
  ctx.restore();
}

/**
 * DOM ve kumanda şablonları (HTML) için birebir aynı Lucide SVG markup'ını üretir.
 * @param {string} iconKey
 * @param {Object} [options]
 * @returns {string} SVG HTML string
 */
export function getTabletopIconSvg(iconKey, options = {}) {
  const {
    size = 24,
    color = 'currentColor',
    strokeWidth = null,
    className = 'lucide-icon',
  } = options;

  const key = String(iconKey || '').trim().toLowerCase();
  const def = ICON_LOOKUP.get(key);

  if (!def) {
    return `<span class="${className}">${iconKey || ''}</span>`;
  }

  const baseWidth = def.strokeWidth || 2.2;
  const sw = strokeWidth != null ? strokeWidth : baseWidth;
  const mode = def.mode || 'stroke';

  const fillAttr = (mode === 'fill' || mode === 'both') ? color : 'none';
  const strokeAttr = (mode === 'fill') ? 'none' : color;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fillAttr}" stroke="${strokeAttr}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" class="${className} lucide-${def.id}">
    <path d="${def.path}" />
  </svg>`.trim();
}
