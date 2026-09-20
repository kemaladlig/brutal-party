import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// 3D Isometric Projection Helpers
// Platform center at (512, 540)
// Isometric transform: screenX = originX + (x - y) * cos(30°), screenY = originY + (x + y) * sin(30°) - z

function iso(x, y, z = 0, ox = 512, oy = 540, scale = 1.0) {
  const cos30 = Math.cos(Math.PI / 6); // ~0.866
  const sin30 = Math.sin(Math.PI / 6); // 0.5
  const sx = ox + (x - y) * cos30 * scale;
  const sy = oy + (x + y) * sin30 * scale - z * scale;
  return [Math.round(sx * 10) / 10, Math.round(sy * 10) / 10];
}

function isoPolygon(pts, ox = 512, oy = 540, scale = 1.0) {
  return pts.map(([x, y, z]) => iso(x, y, z, ox, oy, scale).join(',')).join(' ');
}

// Global Definitions for Beautiful Matte 3D Gradients & Realistic Lights/Glows
function getDefs() {
  return `
    <defs>
      <!-- Premium Multi-layer Soft Shadows -->
      <filter id="shadowBlur" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="18" result="blur" />
        <feColorMatrix type="matrix" values="0 0 0 0 0.08   0 0 0 0 0.08   0 0 0 0 0.08  0 0 0 0.22 0" />
      </filter>
      <filter id="softBlur" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="8" />
      </filter>
      <filter id="ultraSoftBlur" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="24" />
      </filter>
      
      <!-- Neon/Laser Glow Bloom Filters -->
      <filter id="neonGlowRed" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="8" result="blur1" />
        <feGaussianBlur stdDeviation="24" result="blur2" />
        <feMerge>
          <feMergeNode in="blur2" />
          <feMergeNode in="blur1" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="neonGlowYellow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="6" result="blur1" />
        <feGaussianBlur stdDeviation="16" result="blur2" />
        <feMerge>
          <feMergeNode in="blur2" />
          <feMergeNode in="blur1" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="neonGlowBlue" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="8" result="blur1" />
        <feGaussianBlur stdDeviation="20" result="blur2" />
        <feMerge>
          <feMergeNode in="blur2" />
          <feMergeNode in="blur1" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="hologramGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>

      <!-- Platform Gradients (Low-poly 3D Matte) -->
      <radialGradient id="platformSpotlight" cx="35%" cy="25%" r="75%">
        <stop offset="0%" stop-color="#FFFDF8" />
        <stop offset="45%" stop-color="#FDFBF4" />
        <stop offset="85%" stop-color="#EBE3D4" />
        <stop offset="100%" stop-color="#DCD4C3" />
      </radialGradient>
      
      <linearGradient id="platformLeftGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#CECABF" />
        <stop offset="40%" stop-color="#BCB8AD" />
        <stop offset="100%" stop-color="#9E9A8E" />
      </linearGradient>
      
      <linearGradient id="platformRightGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#E5E1D8" />
        <stop offset="60%" stop-color="#CDCDC4" />
        <stop offset="100%" stop-color="#B2AEA4" />
      </linearGradient>

      <!-- Character Gradients (Matte Low-Poly Color Schemes) -->
      <!-- Red (P1 / Primary Host) -->
      <linearGradient id="redGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FF5D3E" />
        <stop offset="50%" stop-color="#D84727" />
        <stop offset="100%" stop-color="#A5280E" />
      </linearGradient>
      <linearGradient id="redGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FF8A72" />
        <stop offset="100%" stop-color="#FF5D3E" />
      </linearGradient>

      <!-- Blue (P2) -->
      <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4AA8E8" />
        <stop offset="50%" stop-color="#1D5D8A" />
        <stop offset="100%" stop-color="#0E3858" />
      </linearGradient>
      <linearGradient id="blueGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#7BCAFC" />
        <stop offset="100%" stop-color="#4AA8E8" />
      </linearGradient>

      <!-- Green (P4) -->
      <linearGradient id="greenGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#4EB482" />
        <stop offset="50%" stop-color="#2F6A4F" />
        <stop offset="100%" stop-color="#16412D" />
      </linearGradient>
      <linearGradient id="greenGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#7CD3A4" />
        <stop offset="100%" stop-color="#4EB482" />
      </linearGradient>

      <!-- Yellow/Gold (P3) -->
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#FFD04C" />
        <stop offset="50%" stop-color="#D99B26" />
        <stop offset="100%" stop-color="#9C6B10" />
      </linearGradient>
      <linearGradient id="goldGradLight" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#FFE799" />
        <stop offset="100%" stop-color="#FFD04C" />
      </linearGradient>

      <!-- Steel / Metallic Details -->
      <linearGradient id="metalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#F1F5F9" />
        <stop offset="40%" stop-color="#94A3B8" />
        <stop offset="100%" stop-color="#475569" />
      </linearGradient>
      
      <!-- Obsidian Abyss / Void -->
      <linearGradient id="abyssGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#1E1E1C" />
        <stop offset="100%" stop-color="#030303" />
      </linearGradient>
      
      <!-- Slate Column / Ancient Rock -->
      <linearGradient id="slateGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#94A3B8" />
        <stop offset="50%" stop-color="#475569" />
        <stop offset="100%" stop-color="#334155" />
      </linearGradient>
    </defs>
  `;
}

// Generate Base Platform SVG Template with Premium 3D Bevel, Lighting and Soft Shadows
function getPlatformBase(scale = 1.0, oy = 530) {
  const S = 210;
  const H = 36;
  const dropShadow = isoPolygon([
    [-S - 25, S + 25, -H - 14],
    [S + 25, S + 25, -H - 14],
    [S + 45, -S + 25, -H - 14],
    [-S - 45, -S + 25, -H - 14],
  ], 512, oy, scale);

  const topFace = isoPolygon([[-S, -S, 0], [S, -S, 0], [S, S, 0], [-S, S, 0]], 512, oy, scale);
  const leftFace = isoPolygon([[-S, S, 0], [S, S, 0], [S, S, -H], [-S, S, -H]], 512, oy, scale);
  const rightFace = isoPolygon([[S, -S, 0], [S, S, 0], [S, S, -H], [S, -S, -H]], 512, oy, scale);

  return `
    <!-- Platform Deep Ambient Shadow (High Fidelity Blur) -->
    <ellipse cx="512" cy="${oy + 140}" rx="${295 * scale}" ry="${108 * scale}" fill="#0A0A09" opacity="0.14" filter="url(#shadowBlur)" />
    <polygon points="${dropShadow}" fill="#0A0A09" opacity="0.18" filter="url(#softBlur)" />

    <!-- Platform Slab -->
    <!-- Left edge (darker shadow side with linear lighting falloff) -->
    <polygon points="${leftFace}" fill="url(#platformLeftGrad)" stroke="#1C1C1A" stroke-width="4.5" stroke-linejoin="round" />
    <!-- Right edge (medium light side) -->
    <polygon points="${rightFace}" fill="url(#platformRightGrad)" stroke="#1C1C1A" stroke-width="4.5" stroke-linejoin="round" />
    <!-- Top slab surface (spotlighted elegant matte surface) -->
    <polygon points="${topFace}" fill="url(#platformSpotlight)" stroke="#1C1C1A" stroke-width="5.5" stroke-linejoin="round" />
  `;
}

// 1. ZONE (Territory Capture Board)
function getZoneSvg() {
  const S = 190;
  const oy = 530;
  const scale = 1.0;

  // Grid lines on top of platform
  let gridLines = '';
  for (let i = -S + 38; i < S; i += 38) {
    const [x1, y1] = iso(i, -S, 0.5, 512, oy, scale);
    const [x2, y2] = iso(i, S, 0.5, 512, oy, scale);
    gridLines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#DCD5C6" stroke-width="2" opacity="0.85" />`;
    const [x3, y3] = iso(-S, i, 0.5, 512, oy, scale);
    const [x4, y4] = iso(S, i, 0.5, 512, oy, scale);
    gridLines += `<line x1="${x3}" y1="${y3}" x2="${x4}" y2="${y4}" stroke="#DCD5C6" stroke-width="2" opacity="0.85" />`;
  }

  // Claimed territories (polygons on the grid)
  const redZone = isoPolygon([[-S, S - 120, 1], [-S + 110, S - 120, 1], [-S + 110, S, 1], [-S, S, 1]], 512, oy, scale);
  const blueZone = isoPolygon([[-S, -S, 1], [-S + 90, -S, 1], [-S + 90, -S + 90, 1], [-S, -S + 90, 1]], 512, oy, scale);
  const greenZone = isoPolygon([[S - 100, S - 100, 1], [S, S - 100, 1], [S, S, 1], [S - 100, S, 1]], 512, oy, scale);
  const yellowZone = isoPolygon([[S - 130, -S, 1], [S, -S, 1], [S, -S + 120, 1], [S - 80, -S + 120, 1], [S - 130, -S + 50, 1]], 512, oy, scale);

  // Active glowing trail being drawn by Red player
  const trailPoints = [
    [-S + 110, S - 60, 2],
    [-20, S - 60, 2],
    [-20, 10, 2],
    [-80, 10, 2]
  ].map(p => iso(...p, 512, oy, scale).join(',')).join(' ');

  // Player positions
  const redPlayerCenter = iso(-80, 10, 18, 512, oy, scale);
  const redShadow = iso(-80, 10, 1, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${getDefs()}
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${gridLines}

    <!-- Claimed Zones with soft opacity & rich gradient fills -->
    <polygon points="${redZone}" fill="url(#redGrad)" opacity="0.82" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${blueZone}" fill="url(#blueGrad)" opacity="0.82" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${greenZone}" fill="url(#greenGrad)" opacity="0.82" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${yellowZone}" fill="url(#goldGrad)" opacity="0.82" stroke="#1C1C1A" stroke-width="3" />

    <!-- Pulsing Red Laser Trail (Glow & High Power Neon Core) -->
    <polyline points="${trailPoints}" fill="none" stroke="url(#redGrad)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" filter="url(#neonGlowRed)"/>
    <polyline points="${trailPoints}" fill="none" stroke="url(#redGradLight)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${trailPoints}" fill="none" stroke="#FFFFFF" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Red Player Avatar (Isometric Hex Prism with 3D Matte Shading) -->
    <ellipse cx="${redShadow[0]}" cy="${redShadow[1]}" rx="24" ry="12" fill="#000" opacity="0.25" filter="url(#softBlur)" />
    <g transform="translate(${redPlayerCenter[0]}, ${redPlayerCenter[1] - 8})">
      <!-- Body Pillar -->
      <polygon points="0,-28 24,-14 24,14 0,28 -24,14 -24,-14" fill="url(#redGrad)" stroke="#1C1C1A" stroke-width="4" />
      <polygon points="0,-28 24,-14 0,0 -24,-14" fill="url(#redGradLight)" stroke="#1C1C1A" stroke-width="3" />
      <circle cx="0" cy="-14" r="7.5" fill="#FFFFFF" stroke="#1C1C1A" stroke-width="2" />
      <!-- Pulsing Golden Crown -->
      <polygon points="0,-48 11,-34 0,-20 -11,-34" fill="url(#goldGrad)" stroke="#1C1C1A" stroke-width="3" />
      <polygon points="0,-48 11,-34 0,-34" fill="url(#goldGradLight)" />
    </g>

    <!-- Enemy Player Marker (Blue) -->
    <g transform="translate(${iso(-S + 45, -S + 45, 18, 512, oy, scale).join(',')})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#000" opacity="0.22" filter="url(#softBlur)" />
      <polygon points="0,-24 20,-12 20,12 0,24 -20,12 -20,-12" fill="url(#blueGrad)" stroke="#1C1C1A" stroke-width="4" />
      <polygon points="0,-24 20,-12 0,0 -20,-12" fill="url(#blueGradLight)" stroke="#1C1C1A" stroke-width="3" />
    </g>

    <!-- Enemy Player Marker (Green) -->
    <g transform="translate(${iso(S - 50, S - 50, 18, 512, oy, scale).join(',')})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#000" opacity="0.22" filter="url(#softBlur)" />
      <polygon points="0,-24 20,-12 20,12 0,24 -20,12 -20,-12" fill="url(#greenGrad)" stroke="#1C1C1A" stroke-width="4" />
      <polygon points="0,-24 20,-12 0,0 -20,-12" fill="url(#greenGradLight)" stroke="#1C1C1A" stroke-width="3" />
    </g>
  </svg>`;
}

// 2. SNAKE (Segmented 3D Snakes on Arena)
function getSnakeSvg() {
  const oy = 530;
  const scale = 1.0;

  // Food pellets
  const foods = [
    [-60, -40, 7, 'url(#goldGrad)'],
    [40, 80, 7, 'url(#goldGrad)'],
    [-110, 90, 7, 'url(#redGrad)'],
    [100, -80, 7, 'url(#greenGrad)'],
    [0, 10, 7, 'url(#blueGrad)'],
  ];

  let foodSvg = '';
  for (const [fx, fy, fz, col] of foods) {
    const [sx, sy] = iso(fx, fy, fz, 512, oy, scale);
    const [shx, shy] = iso(fx, fy, 0.5, 512, oy, scale);
    foodSvg += `
      <ellipse cx="${shx}" cy="${shy}" rx="12" ry="6" fill="#000" opacity="0.22" filter="url(#softBlur)" />
      <g transform="translate(${sx}, ${sy})">
        <!-- 3D Poly Crystal Pellet -->
        <polygon points="0,-16 14,-7 14,7 0,16 -14,7 -14,-7" fill="${col}" stroke="#1C1C1A" stroke-width="3.2" />
        <polygon points="0,-16 14,-7 0,0 -14,-7" fill="#FFF" opacity="0.45" />
      </g>
    `;
  }

  // Green Snake path (P4)
  const snakeSegments = [
    [-120, -100, 12], [-90, -90, 12], [-60, -70, 12], [-30, -40, 12],
    [-10, 0, 12], [10, 40, 12], [40, 60, 12], [70, 50, 12], [100, 20, 12]
  ];

  let greenSnakeSvg = '';
  for (let i = 0; i < snakeSegments.length; i++) {
    const [gx, gy, gz] = snakeSegments[i];
    const [sx, sy] = iso(gx, gy, gz, 512, oy, scale);
    const [shx, shy] = iso(gx, gy, 0.5, 512, oy, scale);
    const isHead = i === snakeSegments.length - 1;
    const r = isHead ? 21 : 17;

    greenSnakeSvg += `
      <ellipse cx="${shx}" cy="${shy}" rx="${r * 0.9}" ry="${r * 0.45}" fill="#000" opacity="0.2" filter="url(#softBlur)" />
      <g transform="translate(${sx}, ${sy})">
        <!-- Matte 3D low poly styled sphere segment -->
        <circle cx="0" cy="0" r="${r}" fill="${isHead ? 'url(#greenGradLight)' : 'url(#greenGrad)'}" stroke="#1C1C1A" stroke-width="3.5" />
        <circle cx="${-r * 0.22}" cy="${-r * 0.22}" r="${r * 0.38}" fill="#A3F5C8" opacity="0.4" filter="url(#softBlur)" />
        <circle cx="${-r * 0.3}" cy="${-r * 0.3}" r="${r * 0.2}" fill="#FFF" opacity="0.55" />
        ${isHead ? `
          <!-- Snake Eyes -->
          <circle cx="6" cy="-6" r="4.8" fill="#FFF" stroke="#1C1C1A" stroke-width="2" />
          <circle cx="7" cy="-6" r="2.2" fill="#1C1C1A" />
          <circle cx="6" cy="6" r="4.8" fill="#FFF" stroke="#1C1C1A" stroke-width="2" />
          <circle cx="7" cy="6" r="2.2" fill="#1C1C1A" />
          <!-- Tongue -->
          <path d="M17 0 L25 -4 M17 0 L27 0 M17 0 L25 4" stroke="#D84727" stroke-width="2.8" stroke-linecap="round" />
        ` : ''}
      </g>
    `;
  }

  // Red Snake (enemy coiling)
  const redSegments = [
    [-60, 140, 11], [-70, 110, 11], [-80, 80, 11], [-80, 50, 11], [-60, 30, 11]
  ];
  let redSnakeSvg = '';
  for (let i = 0; i < redSegments.length; i++) {
    const [rx, ry, rz] = redSegments[i];
    const [sx, sy] = iso(rx, ry, rz, 512, oy, scale);
    const [shx, shy] = iso(rx, ry, 0.5, 512, oy, scale);
    const isHead = i === redSegments.length - 1;
    const r = isHead ? 20 : 16;
    redSnakeSvg += `
      <ellipse cx="${shx}" cy="${shy}" rx="${r * 0.9}" ry="${r * 0.45}" fill="#000" opacity="0.18" filter="url(#softBlur)" />
      <g transform="translate(${sx}, ${sy})">
        <circle cx="0" cy="0" r="${r}" fill="${isHead ? 'url(#redGradLight)' : 'url(#redGrad)'}" stroke="#1C1C1A" stroke-width="3.5" />
        <circle cx="${-r * 0.22}" cy="${-r * 0.22}" r="${r * 0.38}" fill="#FFAFA0" opacity="0.4" filter="url(#softBlur)" />
        <circle cx="${-r * 0.3}" cy="${-r * 0.3}" r="${r * 0.2}" fill="#FFF" opacity="0.5" />
        ${isHead ? `
          <circle cx="-5" cy="-5" r="3.8" fill="#FFF" stroke="#1C1C1A" stroke-width="1.8" />
          <circle cx="-5" cy="-5" r="1.8" fill="#1C1C1A" />
        ` : ''}
      </g>
    `;
  }

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${getDefs()}
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${foodSvg}
    ${redSnakeSvg}
    ${greenSnakeSvg}
  </svg>`;
}

// 3. LASER (Bouncing Laser Blasters & Reflective Barriers)
function getLaserSvg() {
  const oy = 530;
  const scale = 1.0;

  // Obstacle boxes on platform
  const obs = [
    // Center bunker
    { x: -30, y: -30, w: 60, h: 60, z: 35 },
    // Corner block 1
    { x: -140, y: -60, w: 40, h: 40, z: 25 },
    // Corner block 2
    { x: 100, y: 30, w: 40, h: 40, z: 25 },
  ];

  let obsSvg = '';
  for (const o of obs) {
    const top = isoPolygon([[o.x, o.y, o.z], [o.x + o.w, o.y, o.z], [o.x + o.w, o.y + o.h, o.z], [o.x, o.y + o.h, o.z]], 512, oy, scale);
    const left = isoPolygon([[o.x, o.y + o.h, o.z], [o.x + o.w, o.y + o.h, o.z], [o.x + o.w, o.y + o.h, 0], [o.x, o.y + o.h, 0]], 512, oy, scale);
    const right = isoPolygon([[o.x + o.w, o.y, o.z], [o.x + o.w, o.y + o.h, o.z], [o.x + o.w, o.y + o.h, 0], [o.x + o.w, o.y, 0]], 512, oy, scale);
    const shadow = isoPolygon([[o.x - 4, o.y - 4, 0], [o.x + o.w + 4, o.y - 4, 0], [o.x + o.w + 4, o.y + o.h + 4, 0], [o.x - 4, o.y + o.h + 4, 0]], 512, oy, scale);

    obsSvg += `
      <!-- Block shadow -->
      <polygon points="${shadow}" fill="#0A0A09" opacity="0.18" filter="url(#softBlur)" />
      <!-- Left side (shadow face with gradient) -->
      <polygon points="${left}" fill="url(#platformLeftGrad)" stroke="#1C1C1A" stroke-width="3" />
      <!-- Right side -->
      <polygon points="${right}" fill="url(#platformRightGrad)" stroke="#1C1C1A" stroke-width="3" />
      <!-- Top side -->
      <polygon points="${top}" fill="url(#stoneGrad)" stroke="#1C1C1A" stroke-width="3" />
    `;
  }

  // Laser beam reflections
  const p1 = iso(-120, 100, 18, 512, oy, scale);
  const b1 = iso(-30, 0, 18, 512, oy, scale);
  const b2 = iso(100, -80, 18, 512, oy, scale);
  const b3 = iso(160, 40, 18, 512, oy, scale);

  const laserPath = `${p1.join(',')} ${b1.join(',')} ${b2.join(',')} ${b3.join(',')}`;

  // Spark at bounce points
  const spark1 = iso(-30, 0, 20, 512, oy, scale);
  const spark2 = iso(100, -80, 20, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${getDefs()}
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${obsSvg}

    <!-- Bouncing Neon Laser Beam (Outer High Glow + Hot Amber Core) -->
    <polyline points="${laserPath}" fill="none" stroke="#FF3B30" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" filter="url(#neonGlowRed)" />
    <polyline points="${laserPath}" fill="none" stroke="#FF9500" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
    <polyline points="${laserPath}" fill="none" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Spark Burst at Reflection 1 (Glowing Flare) -->
    <circle cx="${spark1[0]}" cy="${spark1[1]}" r="20" fill="url(#goldGrad)" opacity="0.65" filter="url(#softBlur)" />
    <polygon points="${spark1[0]},${spark1[1]-20} ${spark1[0]+6},${spark1[1]-6} ${spark1[0]+20},${spark1[1]} ${spark1[0]+6},${spark1[1]+6} ${spark1[0]},${spark1[1]+20} ${spark1[0]-6},${spark1[1]+6} ${spark1[0]-20},${spark1[1]} ${spark1[0]-6},${spark1[1]-6}" fill="#FFF" />

    <!-- Spark Burst at Reflection 2 -->
    <circle cx="${spark2[0]}" cy="${spark2[1]}" r="16" fill="url(#goldGrad)" opacity="0.55" filter="url(#softBlur)" />

    <!-- Red Blaster Player (Isometric Sci-fi Combat Vehicle) -->
    <g transform="translate(${p1[0]}, ${p1[1]})">
      <ellipse cx="0" cy="14" rx="22" ry="11" fill="#000" opacity="0.25" filter="url(#softBlur)" />
      <!-- Body Chassis with Dual-Tone Gradients -->
      <polygon points="0,-22 22,-11 22,11 0,22 -22,11 -22,-11" fill="url(#redGrad)" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,-22 22,-11 0,0 -22,-11" fill="url(#redGradLight)" stroke="#1C1C1A" stroke-width="2" />
      <!-- Cannon Barrel -->
      <line x1="8" y1="-8" x2="28" y2="-18" stroke="#1C1C1A" stroke-width="7" stroke-linecap="round" />
      <line x1="8" y1="-8" x2="26" y2="-17" stroke="url(#goldGrad)" stroke-width="3" stroke-linecap="round" />
    </g>

    <!-- Target Blue Player (Tactical Mecha Chassis) -->
    <g transform="translate(${b3[0]}, ${b3[1]})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#000" opacity="0.25" filter="url(#softBlur)" />
      <polygon points="0,-20 20,-10 20,10 0,20 -20,10 -20,-10" fill="url(#blueGrad)" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,-20 20,-10 0,0 -20,-10" fill="url(#blueGradLight)" stroke="#1C1C1A" stroke-width="2" />
    </g>
  </svg>`;
}

// 4. CLONE (Real Player + Two Holographic Mirror Clones)
function getCloneSvg() {
  const oy = 530;
  const scale = 1.0;

  // Real player position
  const realPos = iso(-40, -20, 22, 512, oy, scale);
  const realShadow = iso(-40, -20, 1, 512, oy, scale);

  // Clone 1
  const c1Pos = iso(-90, 50, 18, 512, oy, scale);
  const c1Shadow = iso(-90, 50, 1, 512, oy, scale);

  // Clone 2
  const c2Pos = iso(-140, 120, 16, 512, oy, scale);
  const c2Shadow = iso(-140, 120, 1, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${getDefs()}
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}

    <!-- Ghostly Dash Trail connecting clones (Futuristic Streamer Grid) -->
    <path d="M${c2Pos[0]} ${c2Pos[1]} Q${c1Pos[0]} ${c1Pos[1]} ${realPos[0]} ${realPos[1]}" fill="none" stroke="url(#redGrad)" stroke-width="12" stroke-dasharray="8 8" opacity="0.45" filter="url(#hologramGlow)" />

    <!-- CLONE 2 (Oldest hologram, glowing neon blue) -->
    <ellipse cx="${c2Shadow[0]}" cy="${c2Shadow[1]}" rx="20" ry="10" fill="#000" opacity="0.14" filter="url(#softBlur)" />
    <g transform="translate(${c2Pos[0]}, ${c2Pos[1]})" opacity="0.45">
      <!-- Outer energy ring -->
      <circle cx="0" cy="0" r="24" fill="none" stroke="url(#blueGrad)" stroke-width="3" stroke-dasharray="5 3" filter="url(#hologramGlow)"/>
      <polygon points="0,-18 18,-9 18,9 0,18 -18,9 -18,-9" fill="url(#blueGrad)" opacity="0.3" stroke="url(#blueGrad)" stroke-width="2"/>
      <line x1="-20" y1="-5" x2="20" y2="-5" stroke="#FFF" stroke-width="2" opacity="0.8"/>
      <line x1="-16" y1="5" x2="16" y2="5" stroke="#FFF" stroke-width="2" opacity="0.8"/>
    </g>

    <!-- CLONE 1 (Middle hologram, transitioning red glow) -->
    <ellipse cx="${c1Shadow[0]}" cy="${c1Shadow[1]}" rx="22" ry="11" fill="#000" opacity="0.18" filter="url(#softBlur)" />
    <g transform="translate(${c1Pos[0]}, ${c1Pos[1]})" opacity="0.75">
      <ellipse cx="0" cy="18" rx="26" ry="8" fill="none" stroke="url(#redGrad)" stroke-width="2" stroke-dasharray="6 3" filter="url(#hologramGlow)"/>
      <polygon points="0,-22 22,-11 22,11 0,22 -22,11 -22,-11" fill="url(#redGrad)" opacity="0.55" stroke="#1C1C1A" stroke-width="3"/>
      <polygon points="0,-22 22,-11 0,0 -22,-11" fill="url(#redGradLight)" stroke="#1C1C1A" stroke-width="2"/>
      <line x1="-20" y1="-2" x2="20" y2="-2" stroke="#FFFFFF" stroke-width="2.5" opacity="0.9"/>
    </g>

    <!-- REAL PLAYER (Solid, super intense, high contrast neon styling) -->
    <ellipse cx="${realShadow[0]}" cy="${realShadow[1]}" rx="28" ry="14" fill="#000" opacity="0.3" filter="url(#softBlur)" />
    <!-- Golden Energy Shield Halo -->
    <circle cx="${realPos[0]}" cy="${realPos[1]}" r="38" fill="none" stroke="url(#goldGrad)" stroke-width="5" opacity="0.45" filter="url(#neonGlowYellow)" />
    <g transform="translate(${realPos[0]}, ${realPos[1]})">
      <polygon points="0,-30 30,-15 30,15 0,30 -30,15 -30,-15" fill="url(#redGrad)" stroke="#1C1C1A" stroke-width="4.5" />
      <polygon points="0,-30 30,-15 0,0 -30,-15" fill="url(#redGradLight)" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,0 30,-15 30,15 0,30" fill="#901F08" stroke="#1C1C1A" stroke-width="3" />
      <!-- Visor / Sci-fi cyber visor -->
      <rect x="-14" y="-12" width="28" height="8" rx="4" fill="#1C1C1A" />
      <rect x="-11" y="-10" width="22" height="4" rx="2" fill="url(#goldGrad)" />
    </g>

    <!-- Opponent Yellow Player fleeing -->
    <g transform="translate(${iso(80, -60, 18, 512, oy, scale).join(',')})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#000" opacity="0.25" filter="url(#softBlur)" />
      <polygon points="0,-20 20,-10 20,10 0,20 -20,10 -20,-10" fill="url(#goldGrad)" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,-20 20,-10 0,0 -20,-10" fill="url(#goldGradLight)" stroke="#1C1C1A" stroke-width="2" />
    </g>
  </svg>`;
}

// 5. COLLAPSE (Crumbling Checkerboard Grid into Abyss)
function getCollapseSvg() {
  const oy = 530;
  const scale = 1.0;
  const N = 5;
  const tileSize = 60;
  const startX = -((N * tileSize) / 2);
  const startY = -((N * tileSize) / 2);

  // 5x5 tile states: 0=solid, 1=warning (shaking/lava), 2=collapsed (hole to black deep)
  const tileStates = [
    [2, 0, 0, 0, 2],
    [0, 1, 0, 1, 0],
    [0, 2, 2, 0, 0],
    [0, 1, 0, 1, 0],
    [2, 0, 0, 0, 2]
  ];

  let tilesSvg = '';
  // Draw deep dark abyss floor first underneath
  const abyssFloor = isoPolygon([
    [startX - 25, startY - 25, -75],
    [startX + N * tileSize + 25, startY - 25, -75],
    [startX + N * tileSize + 25, startY + N * tileSize + 25, -75],
    [startX - 25, startY + N * tileSize + 25, -75]
  ], 512, oy, scale);

  tilesSvg += `<polygon points="${abyssFloor}" fill="url(#abyssGrad)" />`;

  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const state = tileStates[r][c];
      const tx = startX + c * tileSize;
      const ty = startY + r * tileSize;
      const gap = 3;
      const x0 = tx + gap;
      const y0 = ty + gap;
      const x1 = tx + tileSize - gap;
      const y1 = ty + tileSize - gap;

      if (state === 2) {
        // Void Hole with shadow lining inside walls
        const hole = isoPolygon([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], 512, oy, scale);
        const innerLeft = isoPolygon([[x0, y1, 0], [x1, y1, 0], [x1, y1, -35], [x0, y1, -35]], 512, oy, scale);
        tilesSvg += `
          <polygon points="${hole}" fill="#111" stroke="#000" stroke-width="2" />
          <polygon points="${innerLeft}" fill="url(#abyssGrad)" />
        `;
        continue;
      }

      const H = 14;
      const z = state === 1 ? -6 : 0; // Sinking slightly
      const topPts = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
      const leftPts = [[x0, y1, z], [x1, y1, z], [x1, y1, z - H], [x0, y1, z - H]];
      const rightPts = [[x1, y0, z], [x1, y1, z], [x1, y1, z - H], [x1, y0, z - H]];

      const fillCol = state === 1 ? 'url(#goldGrad)' : ((r + c) % 2 === 0 ? '#FAF7F2' : '#EAE3D4');
      const sideCol = state === 1 ? '#965E13' : '#BCB6AA';

      tilesSvg += `
        <polygon points="${isoPolygon(leftPts, 512, oy, scale)}" fill="${sideCol}" stroke="#1C1C1A" stroke-width="2" />
        <polygon points="${isoPolygon(rightPts, 512, oy, scale)}" fill="${sideCol}" stroke="#1C1C1A" stroke-width="2" />
        <polygon points="${isoPolygon(topPts, 512, oy, scale)}" fill="${fillCol}" stroke="#1C1C1A" stroke-width="3" />
      `;

      if (state === 1) {
        // Warning hot lava cracks glowing
        const [cx1, cy1] = iso(x0 + 10, y0 + 15, z + 0.5, 512, oy, scale);
        const [cx2, cy2] = iso(x1 - 10, y1 - 15, z + 0.5, 512, oy, scale);
        tilesSvg += `<line x1="${cx1}" y1="${cy1}" x2="${cx2}" y2="${cy2}" stroke="url(#redGrad)" stroke-width="3" stroke-linecap="round" filter="url(#neonGlowRed)" />`;
      }
    }
  }

  // Jumping Player in mid-air
  const jumpPos = iso(0, 0, 78, 512, oy, scale);
  const jumpShadow = iso(0, 0, -42, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${getDefs()}
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${tilesSvg}

    <!-- Deep blurred player shadow on abyss -->
    <ellipse cx="${jumpShadow[0]}" cy="${jumpShadow[1]}" rx="26" ry="12" fill="#000" opacity="0.45" filter="url(#ultraSoftBlur)" />

    <!-- Jumping Blue Player in Mid-Air (Action Stunt!) -->
    <g transform="translate(${jumpPos[0]}, ${jumpPos[1]})">
      <circle cx="0" cy="0" r="28" fill="url(#blueGrad)" stroke="#1C1C1A" stroke-width="4.5" />
      <circle cx="-6" cy="-6" r="8" fill="#FFF" opacity="0.25" filter="url(#softBlur)" />
      <!-- High Action goggles -->
      <rect x="-14" y="-6" width="28" height="10" rx="5" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="2.5" />
      <circle cx="-6" cy="-1" r="3.2" fill="#1C1C1A" />
      <circle cx="6" cy="-1" r="3.2" fill="#1C1C1A" />
      <!-- Dynamic Motion line specs -->
      <path d="M-18 28 L-10 18 M0 34 L0 22 M18 28 L10 18" stroke="#1C1C1A" stroke-width="3" stroke-linecap="round" />
    </g>
  </svg>`;
}

// 6. NINJA (Stealth Ninja Shuriken & Katana with Smoke Cloud)
function getNinjaSvg() {
  const oy = 530;
  const scale = 1.0;

  // Premium Dark Slate Cover columns / barriers
  const col1Top = isoPolygon([[-120, -70, 45], [-80, -70, 45], [-80, -30, 45], [-120, -30, 45]], 512, oy, scale);
  const col1Left = isoPolygon([[-120, -30, 45], [-80, -30, 45], [-80, -30, 0], [-120, -30, 0]], 512, oy, scale);
  const col1Right = isoPolygon([[-80, -70, 45], [-80, -30, 45], [-80, -30, 0], [-80, -70, 0]], 512, oy, scale);

  const col2Top = isoPolygon([[70, 40, 45], [110, 40, 45], [110, 80, 45], [70, 80, 45]], 512, oy, scale);
  const col2Left = isoPolygon([[70, 80, 45], [110, 80, 45], [110, 80, 0], [70, 80, 0]], 512, oy, scale);
  const col2Right = isoPolygon([[110, 40, 45], [110, 80, 45], [110, 80, 0], [110, 40, 0]], 512, oy, scale);

  // Ninja position
  const ninjaPos = iso(10, -20, 20, 512, oy, scale);
  const ninjaShadow = iso(10, -20, 1, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    ${getDefs()}
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}

    <!-- Stone Pillars / Cover Columns shaded perfectly with Specular spec -->
    <polygon points="${col1Left}" fill="url(#slateGrad)" stroke="#1C1C1A" stroke-width="3.2" />
    <polygon points="${col1Right}" fill="url(#slateGrad)" opacity="0.85" stroke="#1C1C1A" stroke-width="3.2" />
    <polygon points="${col1Top}" fill="url(#metalGrad)" stroke="#1C1C1A" stroke-width="3.2" />

    <polygon points="${col2Left}" fill="url(#slateGrad)" stroke="#1C1C1A" stroke-width="3.2" />
    <polygon points="${col2Right}" fill="url(#slateGrad)" opacity="0.85" stroke="#1C1C1A" stroke-width="3.2" />
    <polygon points="${col2Top}" fill="url(#metalGrad)" stroke="#1C1C1A" stroke-width="3.2" />

    <!-- Stealth Smoke Cloud (Soft White-Grey overlapping radial puff bubbles) -->
    <ellipse cx="${ninjaPos[0] - 30}" cy="${ninjaPos[1] + 15}" rx="46" ry="25" fill="#E2E2E0" opacity="0.5" filter="url(#softBlur)" />
    <ellipse cx="${ninjaPos[0] + 35}" cy="${ninjaPos[1] + 20}" rx="42" ry="21" fill="#EDEDEA" opacity="0.6" filter="url(#softBlur)" />
    <circle cx="${ninjaPos[0] - 20}" cy="${ninjaPos[1] - 10}" r="34" fill="#F4F4F2" opacity="0.65" filter="url(#softBlur)" />
    <circle cx="${ninjaPos[0] + 25}" cy="${ninjaPos[1] - 5}" r="30" fill="#FFFFFC" opacity="0.7" filter="url(#softBlur)" />

    <!-- Katana Slash Arc (Curved glowing hyper slash trail) -->
    <path d="M${ninjaPos[0] - 70} ${ninjaPos[1] + 38} Q${ninjaPos[0] + 55} ${ninjaPos[1] - 75} ${ninjaPos[0] + 95} ${ninjaPos[1] + 12}" fill="none" stroke="#FFFFF2" stroke-width="12" stroke-linecap="round" filter="url(#hologramGlow)" />
    <path d="M${ninjaPos[0] - 65} ${ninjaPos[1] + 32} Q${ninjaPos[0] + 55} ${ninjaPos[1] - 70} ${ninjaPos[0] + 90} ${ninjaPos[1] + 12}" fill="none" stroke="url(#redGrad)" stroke-width="5" stroke-linecap="round" />

    <!-- Ninja Shadow -->
    <ellipse cx="${ninjaShadow[0]}" cy="${ninjaShadow[1]}" rx="26" ry="13" fill="#000" opacity="0.32" filter="url(#softBlur)" />

    <!-- Ninja Character Body (Stealth Obsidian Mask + Fluttering Headband) -->
    <g transform="translate(${ninjaPos[0]}, ${ninjaPos[1]})">
      <circle cx="0" cy="0" r="26" fill="url(#abyssGrad)" stroke="#1C1C1A" stroke-width="4.2" />
      <circle cx="-5" cy="-5" r="8" fill="#FFF" opacity="0.12" filter="url(#softBlur)" />
      <!-- Red Headband -->
      <path d="M-25 -6 Q0 -10 25 -6 L25 4 Q0 0 -25 4 Z" fill="url(#redGrad)" stroke="#1C1C1A" stroke-width="2.5" />
      <!-- Fluttering headband ribbon tails -->
      <path d="M-24 -4 Q-46 -16 -52 -5 Q-42 6 -25 2 Z" fill="url(#redGrad)" stroke="#1C1C1A" stroke-width="2" />
      <!-- Fierce Ninja Eyes -->
      <rect x="-14" y="2" width="28" height="8.5" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="1.8" />
      <polygon points="-8,4 -4,7 -2,4" fill="#1C1C1A" />
      <polygon points="8,4 4,7 2,4" fill="#1C1C1A" />
      <!-- Katana Blade sword -->
      <line x1="14" y1="-8" x2="48" y2="-38" stroke="url(#metalGrad)" stroke-width="5.5" stroke-linecap="round" />
      <line x1="14" y1="-8" x2="48" y2="-38" stroke="#1C1C1A" stroke-width="1.5" />
      <circle cx="14" cy="-8" r="4.8" fill="url(#goldGrad)" stroke="#1C1C1A" stroke-width="2" />
      <line x1="8" y1="-2" x2="18" y2="-12" stroke="url(#redGrad)" stroke-width="4" stroke-linecap="round" />
    </g>

    <!-- Flying Metal Shuriken -->
    <g transform="translate(${iso(70, -110, 36, 512, oy, scale).join(',')}) rotate(35)">
      <polygon points="0,-16 5,-5 16,0 5,5 0,16 -5,5 -16,0 -5,-5" fill="url(#metalGrad)" stroke="#1C1C1A" stroke-width="2.5" />
      <circle cx="0" cy="0" r="3.5" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="1.5" />
    </g>
  </svg>`;
}

async function renderImages() {
  const games = [
    { name: 'zone', svg: getZoneSvg() },
    { name: 'snake', svg: getSnakeSvg() },
    { name: 'laser', svg: getLaserSvg() },
    { name: 'clone', svg: getCloneSvg() },
    { name: 'collapse', svg: getCollapseSvg() },
    { name: 'ninja', svg: getNinjaSvg() },
  ];

  const outDir = path.resolve('public/assets/games');
  for (const g of games) {
    const outPath = path.join(outDir, `${g.name}.jpg`);
    console.log(`Rendering ${g.name} to 1024x1024 JPEG with premium 3D isometric shading...`);
    await sharp(Buffer.from(g.svg))
      .resize(1024, 1024)
      .jpeg({ quality: 95 })
      .toFile(outPath);
    console.log(`Successfully generated ${outPath}`);
  }
}

renderImages().catch(err => {
  console.error(err);
  process.exit(1);
});
