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

// Generate Base Platform SVG Template
function getPlatformBase(scale = 1.0, oy = 530) {
  // 3D Platform slab: square of size 420x420, height 36
  const S = 210;
  const H = 36;
  const dropShadow = isoPolygon([
    [-S - 20, S + 20, -H - 12],
    [S + 20, S + 20, -H - 12],
    [S + 40, -S + 20, -H - 12],
    [-S - 40, -S + 20, -H - 12],
  ], 512, oy, scale);

  const topFace = isoPolygon([[-S, -S, 0], [S, -S, 0], [S, S, 0], [-S, S, 0]], 512, oy, scale);
  const leftFace = isoPolygon([[-S, S, 0], [S, S, 0], [S, S, -H], [-S, S, -H]], 512, oy, scale);
  const rightFace = isoPolygon([[S, -S, 0], [S, S, 0], [S, S, -H], [S, -S, -H]], 512, oy, scale);

  return `
    <!-- Platform Drop Shadow -->
    <ellipse cx="512" cy="${oy + 140}" rx="${280 * scale}" ry="${100 * scale}" fill="#1C1C1A" opacity="0.12" filter="blur(16px)" />
    <polygon points="${dropShadow}" fill="#1C1C1A" opacity="0.18" />

    <!-- Platform Slab -->
    <!-- Left edge (darker shadow side) -->
    <polygon points="${leftFace}" fill="#C8C4BC" stroke="#1C1C1A" stroke-width="4" stroke-linejoin="round" />
    <!-- Right edge (medium light side) -->
    <polygon points="${rightFace}" fill="#DDD9D0" stroke="#1C1C1A" stroke-width="4" stroke-linejoin="round" />
    <!-- Top slab surface (warm clean white/cream) -->
    <polygon points="${topFace}" fill="#FAF8F5" stroke="#1C1C1A" stroke-width="5" stroke-linejoin="round" />
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
    gridLines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#E6E0D6" stroke-width="2" />`;
    const [x3, y3] = iso(-S, i, 0.5, 512, oy, scale);
    const [x4, y4] = iso(S, i, 0.5, 512, oy, scale);
    gridLines += `<line x1="${x3}" y1="${y3}" x2="${x4}" y2="${y4}" stroke="#E6E0D6" stroke-width="2" />`;
  }

  // Claimed territories (polygons on the grid)
  // Red territory (P1 bottom-left)
  const redZone = isoPolygon([[-S, S - 120, 1], [-S + 110, S - 120, 1], [-S + 110, S, 1], [-S, S, 1]], 512, oy, scale);
  // Blue territory (P2 top-left)
  const blueZone = isoPolygon([[-S, -S, 1], [-S + 90, -S, 1], [-S + 90, -S + 90, 1], [-S, -S + 90, 1]], 512, oy, scale);
  // Green territory (P4 bottom-right)
  const greenZone = isoPolygon([[S - 100, S - 100, 1], [S, S - 100, 1], [S, S, 1], [S - 100, S, 1]], 512, oy, scale);
  // Yellow expanding territory (P3 top-right)
  const yellowZone = isoPolygon([[S - 130, -S, 1], [S, -S, 1], [S, -S + 120, 1], [S - 80, -S + 120, 1], [S - 130, -S + 50, 1]], 512, oy, scale);

  // Active glowing trail being drawn by Red player
  const trailPoints = [
    [-S + 110, S - 60, 2],
    [-20, S - 60, 2],
    [-20, 10, 2],
    [-80, 10, 2]
  ].map(p => iso(...p, 512, oy, scale).join(',')).join(' ');

  // Player heads (3D isometric cubes / cylinders)
  // Red player at trail head
  const redPlayerCenter = iso(-80, 10, 16, 512, oy, scale);
  const redShadow = iso(-80, 10, 1, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${gridLines}

    <!-- Claimed Zones -->
    <polygon points="${redZone}" fill="#D84727" opacity="0.88" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${blueZone}" fill="#1D5D8A" opacity="0.88" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${greenZone}" fill="#2F6A4F" opacity="0.88" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${yellowZone}" fill="#D99B26" opacity="0.88" stroke="#1C1C1A" stroke-width="3" />

    <!-- Pulsing Red Laser Trail -->
    <polyline points="${trailPoints}" fill="none" stroke="#FFAE9E" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/>
    <polyline points="${trailPoints}" fill="none" stroke="#D84727" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="${trailPoints}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

    <!-- Red Player Avatar (Isometric Hex Prism) -->
    <ellipse cx="${redShadow[0]}" cy="${redShadow[1]}" rx="24" ry="12" fill="#1C1C1A" opacity="0.3" />
    <!-- 3D Player Marker -->
    <g transform="translate(${redPlayerCenter[0]}, ${redPlayerCenter[1] - 8})">
      <!-- Pedestal / Body -->
      <polygon points="0,-28 24,-14 24,14 0,28 -24,14 -24,-14" fill="#D84727" stroke="#1C1C1A" stroke-width="4" />
      <polygon points="0,-28 24,-14 0,0 -24,-14" fill="#FF7051" stroke="#1C1C1A" stroke-width="3" />
      <polygon points="0,0 24,-14 24,14 0,28" fill="#B32C0E" stroke="#1C1C1A" stroke-width="3" />
      <circle cx="0" cy="-14" r="7" fill="#FFFFFF" stroke="#1C1C1A" stroke-width="2" />
      <!-- Pulsing Crown/Diamond Top -->
      <polygon points="0,-48 10,-34 0,-20 -10,-34" fill="#FFDE59" stroke="#1C1C1A" stroke-width="3" />
    </g>

    <!-- Enemy Player Marker (Blue) -->
    <g transform="translate(${iso(-S + 45, -S + 45, 16, 512, oy, scale).join(',')})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#1C1C1A" opacity="0.25" />
      <polygon points="0,-24 20,-12 20,12 0,24 -20,12 -20,-12" fill="#1D5D8A" stroke="#1C1C1A" stroke-width="4" />
      <polygon points="0,-24 20,-12 0,0 -20,-12" fill="#3882B8" stroke="#1C1C1A" stroke-width="3" />
    </g>

    <!-- Enemy Player Marker (Green) -->
    <g transform="translate(${iso(S - 50, S - 50, 16, 512, oy, scale).join(',')})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#1C1C1A" opacity="0.25" />
      <polygon points="0,-24 20,-12 20,12 0,24 -20,12 -20,-12" fill="#2F6A4F" stroke="#1C1C1A" stroke-width="4" />
      <polygon points="0,-24 20,-12 0,0 -20,-12" fill="#489772" stroke="#1C1C1A" stroke-width="3" />
    </g>
  </svg>`;
}

// 2. SNAKE (Segmented 3D Snakes on Arena)
function getSnakeSvg() {
  const oy = 530;
  const scale = 1.0;

  // Food pellets
  const foods = [
    [-60, -40, 6, '#D99B26'],
    [40, 80, 6, '#FFDE59'],
    [-110, 90, 6, '#D84727'],
    [100, -80, 6, '#2F6A4F'],
    [0, 10, 6, '#D99B26'],
  ];

  let foodSvg = '';
  for (const [fx, fy, fz, col] of foods) {
    const [sx, sy] = iso(fx, fy, fz, 512, oy, scale);
    const [shx, shy] = iso(fx, fy, 0.5, 512, oy, scale);
    foodSvg += `
      <ellipse cx="${shx}" cy="${shy}" rx="12" ry="6" fill="#1C1C1A" opacity="0.25" />
      <g transform="translate(${sx}, ${sy})">
        <polygon points="0,-16 14,-7 14,7 0,16 -14,7 -14,-7" fill="${col}" stroke="#1C1C1A" stroke-width="3" />
        <polygon points="0,-16 14,-7 0,0 -14,-7" fill="#FFF" opacity="0.4" />
      </g>
    `;
  }

  // Green Snake path (P4)
  const snakeSegments = [
    [-120, -100, 10], [-90, -90, 10], [-60, -70, 10], [-30, -40, 10],
    [-10, 0, 10], [10, 40, 10], [40, 60, 10], [70, 50, 10], [100, 20, 10]
  ];

  let greenSnakeSvg = '';
  for (let i = 0; i < snakeSegments.length; i++) {
    const [gx, gy, gz] = snakeSegments[i];
    const [sx, sy] = iso(gx, gy, gz, 512, oy, scale);
    const [shx, shy] = iso(gx, gy, 0.5, 512, oy, scale);
    const isHead = i === snakeSegments.length - 1;
    const r = isHead ? 20 : 16;

    greenSnakeSvg += `
      <ellipse cx="${shx}" cy="${shy}" rx="${r * 0.9}" ry="${r * 0.45}" fill="#1C1C1A" opacity="0.22" />
      <g transform="translate(${sx}, ${sy})">
        <!-- 3D sphere/gem segment -->
        <circle cx="0" cy="0" r="${r}" fill="${isHead ? '#489772' : '#2F6A4F'}" stroke="#1C1C1A" stroke-width="3.5" />
        <circle cx="${-r * 0.25}" cy="${-r * 0.25}" r="${r * 0.35}" fill="#89D4B0" opacity="0.7" />
        ${isHead ? `
          <!-- Snake Eyes -->
          <circle cx="6" cy="-6" r="4.5" fill="#FFF" stroke="#1C1C1A" stroke-width="2" />
          <circle cx="8" cy="-6" r="2" fill="#1C1C1A" />
          <circle cx="6" cy="6" r="4.5" fill="#FFF" stroke="#1C1C1A" stroke-width="2" />
          <circle cx="8" cy="6" r="2" fill="#1C1C1A" />
          <!-- Tongue -->
          <path d="M16 0 L24 -4 M16 0 L26 0 M16 0 L24 4" stroke="#D84727" stroke-width="2.5" stroke-linecap="round" />
        ` : ''}
      </g>
    `;
  }

  // Red Snake (enemy coiling)
  const redSegments = [
    [-60, 140, 10], [-70, 110, 10], [-80, 80, 10], [-80, 50, 10], [-60, 30, 10]
  ];
  let redSnakeSvg = '';
  for (let i = 0; i < redSegments.length; i++) {
    const [rx, ry, rz] = redSegments[i];
    const [sx, sy] = iso(rx, ry, rz, 512, oy, scale);
    const [shx, shy] = iso(rx, ry, 0.5, 512, oy, scale);
    const isHead = i === redSegments.length - 1;
    const r = isHead ? 19 : 15;
    redSnakeSvg += `
      <ellipse cx="${shx}" cy="${shy}" rx="${r * 0.9}" ry="${r * 0.45}" fill="#1C1C1A" opacity="0.22" />
      <circle cx="${sx}" cy="${sy}" r="${r}" fill="${isHead ? '#FF6745' : '#D84727'}" stroke="#1C1C1A" stroke-width="3" />
      ${isHead ? `
        <circle cx="-5" cy="-5" r="3.5" fill="#FFF" stroke="#1C1C1A" stroke-width="1.5" />
        <circle cx="-5" cy="-5" r="1.5" fill="#1C1C1A" />
      ` : ''}
    `;
  }

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
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

    obsSvg += `
      <polygon points="${left}" fill="#6C7A89" stroke="#1C1C1A" stroke-width="3" />
      <polygon points="${right}" fill="#95A5A6" stroke="#1C1C1A" stroke-width="3" />
      <polygon points="${top}" fill="#BDC3C7" stroke="#1C1C1A" stroke-width="3" />
    `;
  }

  // Laser beam reflections
  // Starts at P1 (red blaster at -120, 110), bounces off center block, bounces off wall, hits target
  const p1 = iso(-120, 100, 16, 512, oy, scale);
  const b1 = iso(-30, 0, 16, 512, oy, scale);
  const b2 = iso(100, -80, 16, 512, oy, scale);
  const b3 = iso(160, 40, 16, 512, oy, scale);

  const laserPath = `${p1.join(',')} ${b1.join(',')} ${b2.join(',')} ${b3.join(',')}`;

  // Spark at bounce points
  const spark1 = iso(-30, 0, 18, 512, oy, scale);
  const spark2 = iso(100, -80, 18, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${obsSvg}

    <!-- Bouncing Neon Laser Beam (Outer Glow + Core) -->
    <polyline points="${laserPath}" fill="none" stroke="#FF4D4D" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.4" />
    <polyline points="${laserPath}" fill="none" stroke="#FFDE59" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
    <polyline points="${laserPath}" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />

    <!-- Spark Burst at Reflection 1 -->
    <circle cx="${spark1[0]}" cy="${spark1[1]}" r="14" fill="#FFDE59" opacity="0.7" />
    <polygon points="${spark1[0]},${spark1[1]-18} ${spark1[0]+5},${spark1[1]-5} ${spark1[0]+18},${spark1[1]} ${spark1[0]+5},${spark1[1]+5} ${spark1[0]},${spark1[1]+18} ${spark1[0]-5},${spark1[1]+5} ${spark1[0]-18},${spark1[1]} ${spark1[0]-5},${spark1[1]-5}" fill="#FFF" />

    <!-- Spark Burst at Reflection 2 -->
    <circle cx="${spark2[0]}" cy="${spark2[1]}" r="12" fill="#FFDE59" opacity="0.6" />

    <!-- Red Blaster Player -->
    <g transform="translate(${p1[0]}, ${p1[1]})">
      <ellipse cx="0" cy="14" rx="22" ry="11" fill="#1C1C1A" opacity="0.3" />
      <!-- Chassis -->
      <polygon points="0,-22 22,-11 22,11 0,22 -22,11 -22,-11" fill="#D84727" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,-22 22,-11 0,0 -22,-11" fill="#FF7051" stroke="#1C1C1A" stroke-width="2" />
      <!-- Laser Cannon Barrel -->
      <line x1="8" y1="-8" x2="28" y2="-18" stroke="#1C1C1A" stroke-width="7" stroke-linecap="round" />
      <line x1="8" y1="-8" x2="26" y2="-17" stroke="#FFDE59" stroke-width="3" stroke-linecap="round" />
    </g>

    <!-- Target Blue Player -->
    <g transform="translate(${b3[0]}, ${b3[1]})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#1C1C1A" opacity="0.3" />
      <polygon points="0,-20 20,-10 20,10 0,20 -20,10 -20,-10" fill="#1D5D8A" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,-20 20,-10 0,0 -20,-10" fill="#3B8EC8" stroke="#1C1C1A" stroke-width="2" />
    </g>
  </svg>`;
}

// 4. CLONE (Real Player + Two Holographic Mirror Clones)
function getCloneSvg() {
  const oy = 530;
  const scale = 1.0;

  // Real player position
  const realPos = iso(-40, -20, 20, 512, oy, scale);
  const realShadow = iso(-40, -20, 1, 512, oy, scale);

  // Clone 1 (delay 0.6s)
  const c1Pos = iso(-90, 50, 16, 512, oy, scale);
  const c1Shadow = iso(-90, 50, 1, 512, oy, scale);

  // Clone 2 (delay 1.2s)
  const c2Pos = iso(-140, 120, 14, 512, oy, scale);
  const c2Shadow = iso(-140, 120, 1, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}

    <!-- Ghostly Dash Trail connecting clones -->
    <path d="M${c2Pos[0]} ${c2Pos[1]} Q${c1Pos[0]} ${c1Pos[1]} ${realPos[0]} ${realPos[1]}" fill="none" stroke="#D84727" stroke-width="12" stroke-dasharray="8 8" opacity="0.35" />

    <!-- CLONE 2 (Oldest hologram, faint) -->
    <ellipse cx="${c2Shadow[0]}" cy="${c2Shadow[1]}" rx="20" ry="10" fill="#1C1C1A" opacity="0.12" />
    <g transform="translate(${c2Pos[0]}, ${c2Pos[1]})" opacity="0.45">
      <circle cx="0" cy="0" r="22" fill="#FAF7F2" stroke="#D84727" stroke-width="3" stroke-dasharray="5 3"/>
      <polygon points="0,-18 18,-9 18,9 0,18 -18,9 -18,-9" fill="#D84727" opacity="0.3" stroke="#D84727" stroke-width="2"/>
      <line x1="-20" y1="-5" x2="20" y2="-5" stroke="#FFF" stroke-width="2" opacity="0.8"/>
      <line x1="-16" y1="5" x2="16" y2="5" stroke="#FFF" stroke-width="2" opacity="0.8"/>
    </g>

    <!-- CLONE 1 (Middle hologram) -->
    <ellipse cx="${c1Shadow[0]}" cy="${c1Shadow[1]}" rx="22" ry="11" fill="#1C1C1A" opacity="0.18" />
    <g transform="translate(${c1Pos[0]}, ${c1Pos[1]})" opacity="0.7">
      <ellipse cx="0" cy="18" rx="26" ry="8" fill="none" stroke="#D84727" stroke-width="2" stroke-dasharray="6 3"/>
      <polygon points="0,-22 22,-11 22,11 0,22 -22,11 -22,-11" fill="#D84727" opacity="0.55" stroke="#1C1C1A" stroke-width="3"/>
      <polygon points="0,-22 22,-11 0,0 -22,-11" fill="#FFA590" stroke="#1C1C1A" stroke-width="2"/>
      <line x1="-20" y1="-2" x2="20" y2="-2" stroke="#FFFFFF" stroke-width="2.5" opacity="0.9"/>
    </g>

    <!-- REAL PLAYER (Solid, intense, punchy) -->
    <ellipse cx="${realShadow[0]}" cy="${realShadow[1]}" rx="28" ry="14" fill="#1C1C1A" opacity="0.35" />
    <!-- Dynamic Aura -->
    <circle cx="${realPos[0]}" cy="${realPos[1]}" r="38" fill="#FFDE59" opacity="0.3" />
    <g transform="translate(${realPos[0]}, ${realPos[1]})">
      <polygon points="0,-30 30,-15 30,15 0,30 -30,15 -30,-15" fill="#D84727" stroke="#1C1C1A" stroke-width="4.5" />
      <polygon points="0,-30 30,-15 0,0 -30,-15" fill="#FF7051" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,0 30,-15 30,15 0,30" fill="#B32C0E" stroke="#1C1C1A" stroke-width="3" />
      <!-- Visor / Eyes -->
      <rect x="-14" y="-12" width="28" height="8" rx="4" fill="#1C1C1A" />
      <rect x="-11" y="-10" width="22" height="4" rx="2" fill="#FFDE59" />
    </g>

    <!-- Opponent Yellow Player fleeing/tackled -->
    <g transform="translate(${iso(80, -60, 16, 512, oy, scale).join(',')})">
      <ellipse cx="0" cy="14" rx="20" ry="10" fill="#1C1C1A" opacity="0.25" />
      <polygon points="0,-20 20,-10 20,10 0,20 -20,10 -20,-10" fill="#D99B26" stroke="#1C1C1A" stroke-width="3.5" />
      <polygon points="0,-20 20,-10 0,0 -20,-10" fill="#FFE082" stroke="#1C1C1A" stroke-width="2" />
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

  // 5x5 tile states: 0=solid, 1=warning (jitter/orange), 2=collapsed (hole into black void)
  const tileStates = [
    [2, 0, 0, 0, 2],
    [0, 1, 0, 1, 0],
    [0, 2, 2, 0, 0],
    [0, 1, 0, 1, 0],
    [2, 0, 0, 0, 2]
  ];

  let tilesSvg = '';
  // Draw dark abyss floor first underneath
  const abyssFloor = isoPolygon([
    [startX - 20, startY - 20, -70],
    [startX + N * tileSize + 20, startY - 20, -70],
    [startX + N * tileSize + 20, startY + N * tileSize + 20, -70],
    [startX - 20, startY + N * tileSize + 20, -70]
  ], 512, oy, scale);

  tilesSvg += `<polygon points="${abyssFloor}" fill="#111110" />`;

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
        // Void hole with depth shadow
        const hole = isoPolygon([[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], 512, oy, scale);
        const innerLeft = isoPolygon([[x0, y1, 0], [x1, y1, 0], [x1, y1, -30], [x0, y1, -30]], 512, oy, scale);
        tilesSvg += `
          <polygon points="${hole}" fill="#1A1A1A" stroke="#111" stroke-width="2" />
          <polygon points="${innerLeft}" fill="#0A0A0A" />
        `;
        continue;
      }

      const H = 14;
      const z = state === 1 ? -4 : 0; // sinking slightly
      const topPts = [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
      const leftPts = [[x0, y1, z], [x1, y1, z], [x1, y1, z - H], [x0, y1, z - H]];
      const rightPts = [[x1, y0, z], [x1, y1, z], [x1, y1, z - H], [x1, y0, z - H]];

      const fillCol = state === 1 ? '#E67E22' : ((r + c) % 2 === 0 ? '#FAF7F2' : '#ECE7DE');
      const sideCol = state === 1 ? '#B85E10' : '#C7C2B8';

      tilesSvg += `
        <polygon points="${isoPolygon(leftPts, 512, oy, scale)}" fill="${sideCol}" stroke="#1C1C1A" stroke-width="2" />
        <polygon points="${isoPolygon(rightPts, 512, oy, scale)}" fill="${sideCol}" stroke="#1C1C1A" stroke-width="2" />
        <polygon points="${isoPolygon(topPts, 512, oy, scale)}" fill="${fillCol}" stroke="#1C1C1A" stroke-width="3" />
      `;

      if (state === 1) {
        // Warning crack line
        const [cx1, cy1] = iso(x0 + 10, y0 + 15, z + 0.5, 512, oy, scale);
        const [cx2, cy2] = iso(x1 - 10, y1 - 15, z + 0.5, 512, oy, scale);
        tilesSvg += `<line x1="${cx1}" y1="${cy1}" x2="${cx2}" y2="${cy2}" stroke="#D84727" stroke-width="3" stroke-linecap="round" />`;
      }
    }
  }

  // Jumping Player in mid-air
  const jumpPos = iso(0, 0, 75, 512, oy, scale);
  const jumpShadow = iso(0, 0, -40, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}
    ${tilesSvg}

    <!-- Shadow of jumping player on abyss/ground -->
    <ellipse cx="${jumpShadow[0]}" cy="${jumpShadow[1]}" rx="26" ry="12" fill="#1C1C1A" opacity="0.3" filter="blur(4px)" />

    <!-- Jumping Blue Player in Mid-Air -->
    <g transform="translate(${jumpPos[0]}, ${jumpPos[1]})">
      <circle cx="0" cy="0" r="28" fill="#1D5D8A" stroke="#1C1C1A" stroke-width="4.5" />
      <circle cx="-7" cy="-7" r="8" fill="#5AA4DC" opacity="0.8" />
      <!-- Expression / Action goggles -->
      <rect x="-14" y="-6" width="28" height="9" rx="4.5" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="2.5" />
      <circle cx="-6" cy="-2" r="3" fill="#1C1C1A" />
      <circle cx="6" cy="-2" r="3" fill="#1C1C1A" />
      <!-- Jump motion lines -->
      <path d="M-20 28 L-10 18 M0 34 L0 22 M20 28 L10 18" stroke="#1C1C1A" stroke-width="3" stroke-linecap="round" />
    </g>
  </svg>`;
}

// 6. NINJA (Stealth Ninja Shuriken & Katana with Smoke Cloud)
function getNinjaSvg() {
  const oy = 530;
  const scale = 1.0;

  // Stone columns / barriers for cover
  const col1Top = isoPolygon([[-120, -70, 45], [-80, -70, 45], [-80, -30, 45], [-120, -30, 45]], 512, oy, scale);
  const col1Left = isoPolygon([[-120, -30, 45], [-80, -30, 45], [-80, -30, 0], [-120, -30, 0]], 512, oy, scale);
  const col1Right = isoPolygon([[-80, -70, 45], [-80, -30, 45], [-80, -30, 0], [-80, -70, 0]], 512, oy, scale);

  const col2Top = isoPolygon([[70, 40, 45], [110, 40, 45], [110, 80, 45], [70, 80, 45]], 512, oy, scale);
  const col2Left = isoPolygon([[70, 80, 45], [110, 80, 45], [110, 80, 0], [70, 80, 0]], 512, oy, scale);
  const col2Right = isoPolygon([[110, 40, 45], [110, 80, 45], [110, 80, 0], [110, 40, 0]], 512, oy, scale);

  // Ninja position
  const ninjaPos = iso(10, -20, 18, 512, oy, scale);
  const ninjaShadow = iso(10, -20, 1, 512, oy, scale);

  return `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <rect width="1024" height="1024" fill="#F4F4F0"/>
    ${getPlatformBase(scale, oy)}

    <!-- Stone Pillars / Cover Columns -->
    <polygon points="${col1Left}" fill="#7F8C8D" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${col1Right}" fill="#95A5A6" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${col1Top}" fill="#BDC3C7" stroke="#1C1C1A" stroke-width="3" />

    <polygon points="${col2Left}" fill="#7F8C8D" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${col2Right}" fill="#95A5A6" stroke="#1C1C1A" stroke-width="3" />
    <polygon points="${col2Top}" fill="#BDC3C7" stroke="#1C1C1A" stroke-width="3" />

    <!-- Stealth Smoke Cloud (Ninja Smoke Bomb) -->
    <ellipse cx="${ninjaPos[0] - 30}" cy="${ninjaPos[1] + 15}" rx="45" ry="24" fill="#D2CECE" opacity="0.6" />
    <ellipse cx="${ninjaPos[0] + 35}" cy="${ninjaPos[1] + 20}" rx="40" ry="20" fill="#E4E0DF" opacity="0.7" />
    <circle cx="${ninjaPos[0] - 20}" cy="${ninjaPos[1] - 10}" r="32" fill="#EAE6E5" opacity="0.75" />
    <circle cx="${ninjaPos[0] + 25}" cy="${ninjaPos[1] - 5}" r="28" fill="#F0ECEB" opacity="0.8" />

    <!-- Katana Slash Arc (Curved dynamic blade trail) -->
    <path d="M${ninjaPos[0] - 65} ${ninjaPos[1] + 35} Q${ninjaPos[0] + 50} ${ninjaPos[1] - 70} ${ninjaPos[0] + 90} ${ninjaPos[1] + 10}" fill="none" stroke="#FAF7F2" stroke-width="9" stroke-linecap="round" />
    <path d="M${ninjaPos[0] - 60} ${ninjaPos[1] + 30} Q${ninjaPos[0] + 50} ${ninjaPos[1] - 65} ${ninjaPos[0] + 85} ${ninjaPos[1] + 10}" fill="none" stroke="#D84727" stroke-width="4" stroke-linecap="round" />

    <!-- Ninja Shadow -->
    <ellipse cx="${ninjaShadow[0]}" cy="${ninjaShadow[1]}" rx="26" ry="13" fill="#1C1C1A" opacity="0.35" />

    <!-- Ninja Character Body (Dark Mask + Red Headband) -->
    <g transform="translate(${ninjaPos[0]}, ${ninjaPos[1]})">
      <circle cx="0" cy="0" r="26" fill="#1C1C1A" stroke="#1C1C1A" stroke-width="4" />
      <!-- Red Ninja Headband -->
      <path d="M-25 -6 Q0 -10 25 -6 L25 4 Q0 0 -25 4 Z" fill="#D84727" stroke="#1C1C1A" stroke-width="2.5" />
      <!-- Headband Tails fluttering behind -->
      <path d="M-24 -4 Q-45 -15 -50 -5 Q-40 5 -25 2 Z" fill="#D84727" stroke="#1C1C1A" stroke-width="2" />
      <!-- Fierce Ninja Eyes -->
      <rect x="-14" y="2" width="28" height="8" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="1.5" />
      <polygon points="-8,4 -4,7 -2,4" fill="#1C1C1A" />
      <polygon points="8,4 4,7 2,4" fill="#1C1C1A" />
      <!-- Katana Blade -->
      <line x1="14" y1="-8" x2="48" y2="-38" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" />
      <line x1="14" y1="-8" x2="48" y2="-38" stroke="#1C1C1A" stroke-width="1.5" />
      <circle cx="14" cy="-8" r="4.5" fill="#D99B26" stroke="#1C1C1A" stroke-width="2" />
      <line x1="8" y1="-2" x2="18" y2="-12" stroke="#D84727" stroke-width="4" stroke-linecap="round" />
    </g>

    <!-- Flying Shuriken Star in Air -->
    <g transform="translate(${iso(70, -110, 35, 512, oy, scale).join(',')}) rotate(35)">
      <polygon points="0,-16 5,-5 16,0 5,5 0,16 -5,5 -16,0 -5,-5" fill="#34495E" stroke="#1C1C1A" stroke-width="2.5" />
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
    console.log(`Rendering ${g.name} to 1024x1024 JPEG...`);
    await sharp(Buffer.from(g.svg))
      .resize(1024, 1024)
      .jpeg({ quality: 92 })
      .toFile(outPath);
    console.log(`Successfully generated ${outPath}`);
  }
}

renderImages().catch(err => {
  console.error(err);
  process.exit(1);
});
