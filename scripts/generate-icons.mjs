import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Brutalist 4P Party Games Icon
// Safe Area: 512x512 canvas, content strictly contained within radius 165px (diameter 330px)
// Guaranteed generous margins (>90px on all sides) for all PWA maskable shapes

const svgContent = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Filter for crisp brutalist offset shadow -->
    <filter id="hard-shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="12" dy="12" stdDeviation="0" flood-color="#1C1C1A" flood-opacity="1" />
    </filter>
  </defs>

  <!-- Full canvas background for maskable edge-to-edge support -->
  <rect width="512" height="512" fill="#F4F0EA"/>

  <!-- Centered Brutalist Badge Group (Total dimension: 288x288, centered at 256,256) -->
  <!-- Bounds: x from 112 to 400, y from 112 to 400 (Padding: 112px on all sides!) -->
  <g transform="translate(256, 256)">
    <!-- 3D Brutalist Hard Shadow Base -->
    <rect x="-132" y="-132" width="288" height="288" rx="44" fill="#1C1C1A" transform="translate(10, 12)" />

    <!-- Outer Main Card Container -->
    <rect x="-144" y="-144" width="288" height="288" rx="44" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="12" />

    <!-- 4 Colored Player Quadrants with clip mask -->
    <g clip-path="url(#badge-clip)">
      <!-- Top-Left: Blue (P2) -->
      <path d="M-144 -144 H0 V0 H-144 Z" fill="#1D5D8A"/>
      <!-- Top-Right: Green (P4) -->
      <path d="M0 -144 H144 V0 H0 Z" fill="#2F6A4F"/>
      <!-- Bottom-Left: Yellow (P3) -->
      <path d="M-144 0 H0 V144 H-144 Z" fill="#D99B26"/>
      <!-- Bottom-Right: Red (P1) -->
      <path d="M0 0 H144 V144 H0 Z" fill="#D84727"/>

      <!-- Corner Graphic Accents for Games -->
      <!-- Top-Left Accent: Blue Paddle (Pong) -->
      <rect x="-106" y="-108" width="48" height="12" rx="3" fill="#FFFFFF" opacity="0.92" stroke="#1C1C1A" stroke-width="3"/>

      <!-- Top-Right Accent: Green Tank Cannon (Tanks) -->
      <circle cx="82" cy="-82" r="15" fill="#FFFFFF" opacity="0.92" stroke="#1C1C1A" stroke-width="3"/>
      <rect x="78" y="-110" width="8" height="18" fill="#1C1C1A"/>

      <!-- Bottom-Left Accent: Yellow Bomb Spark (Bomb) -->
      <circle cx="-82" cy="82" r="14" fill="#1C1C1A"/>
      <path d="M-82 68 L-76 56 L-66 60" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>
      <circle cx="-64" cy="58" r="4" fill="#FFDE59"/>

      <!-- Bottom-Right Accent: Red Crossed Quick Draw / Spark (Duel) -->
      <path d="M68 68 L96 96 M96 68 L68 96" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round"/>
      <circle cx="82" cy="82" r="4" fill="#1C1C1A"/>
    </g>

    <!-- Clip path to keep quadrants neatly inside rounded badge -->
    <clipPath id="badge-clip">
      <rect x="-144" y="-144" width="288" height="288" rx="44" />
    </clipPath>

    <!-- Heavy Cross Grid Partition -->
    <line x1="-144" y1="0" x2="144" y2="0" stroke="#1C1C1A" stroke-width="12" stroke-linecap="square"/>
    <line x1="0" y1="-144" x2="0" y2="144" stroke="#1C1C1A" stroke-width="12" stroke-linecap="square"/>

    <!-- Central Centerpiece: Bold Brutalist Black Emblem Circle with "4P" -->
    <circle cx="0" cy="0" r="54" fill="#1C1C1A" stroke="#FAF7F2" stroke-width="7"/>

    <!-- Inner Golden/White Accent Ring -->
    <circle cx="0" cy="0" r="44" fill="#1C1C1A" stroke="#FFDE59" stroke-width="3.5" stroke-dasharray="8 5"/>

    <!-- Bold 4P Typography in Center -->
    <text x="-2" y="8" font-family="'Space Grotesk', 'Arial Black', sans-serif" font-size="34" font-weight="900" fill="#FAF7F2" text-anchor="middle" letter-spacing="-1">4P</text>

    <!-- 4 Diagonal Targeting Pip Dots -->
    <circle cx="-13" cy="-13" r="2.5" fill="#FFDE59"/>
    <circle cx="13" cy="-13" r="2.5" fill="#FFDE59"/>
    <circle cx="-13" cy="17" r="2.5" fill="#FFDE59"/>
    <circle cx="13" cy="17" r="2.5" fill="#FFDE59"/>
  </g>
</svg>
`;

async function generate() {
  const publicDir = path.resolve('public');
  const svgPath = path.join(publicDir, 'icon.svg');
  const png512Path = path.join(publicDir, 'icon-512.png');
  const png192Path = path.join(publicDir, 'icon-192.png');

  // Save SVG
  fs.writeFileSync(svgPath, svgContent, 'utf-8');
  console.log('Saved', svgPath);

  // Render 512x512 PNG
  await sharp(Buffer.from(svgContent))
    .resize(512, 512)
    .png()
    .toFile(png512Path);
  console.log('Saved', png512Path);

  // Render 192x192 PNG
  await sharp(Buffer.from(svgContent))
    .resize(192, 192)
    .png()
    .toFile(png192Path);
  console.log('Saved', png192Path);

  // Also update Android adaptive icon foregrounds if present
  const androidResDir = path.resolve('android/app/src/main/res');
  if (fs.existsSync(androidResDir)) {
    const mipmaps = [
      { dir: 'mipmap-mdpi', size: 108 },
      { dir: 'mipmap-hdpi', size: 162 },
      { dir: 'mipmap-xhdpi', size: 216 },
      { dir: 'mipmap-xxhdpi', size: 324 },
      { dir: 'mipmap-xxxhdpi', size: 432 },
    ];

    for (const m of mipmaps) {
      const targetDir = path.join(androidResDir, m.dir);
      if (fs.existsSync(targetDir)) {
        const fgPath = path.join(targetDir, 'ic_launcher_foreground.png');
        await sharp(Buffer.from(svgContent))
          .resize(m.size, m.size)
          .png()
          .toFile(fgPath);
        console.log('Updated Android icon:', fgPath);
      }
    }
  }

  console.log('All icons successfully generated!');
}

generate().catch(err => {
  console.error(err);
  process.exit(1);
});
