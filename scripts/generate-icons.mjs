import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Brutalist 4P Party Games Icon
// Safe Area: 512x512 canvas, content strictly contained within radius 165px (diameter 330px)
// Guaranteed generous margins (>90px on all sides) for all PWA maskable shapes

const svgContent = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#DCD6C6"/>
  <g transform="translate(256, 256)">
    <rect x="-144" y="-144" width="288" height="288" rx="72" fill="#111111"/>
    <rect x="-128" y="-128" width="256" height="256" rx="58" fill="none" stroke="#F4F0EA" stroke-width="10"/>
    <text x="0" y="28" font-family="'Space Grotesk', 'Arial Black', sans-serif" font-size="148" font-weight="900" fill="#F4F0EA" text-anchor="middle" letter-spacing="-4">4P</text>
    <rect x="-104" y="72" width="40" height="32" fill="#C45A3C"/>
    <rect x="-48" y="72" width="40" height="32" fill="#6A8FB5"/>
    <rect x="8" y="72" width="40" height="32" fill="#5A8A64"/>
    <rect x="64" y="72" width="40" height="32" fill="#E3B93E"/>
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
