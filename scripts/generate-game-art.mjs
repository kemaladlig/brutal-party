import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

// Generates extremely clean, high-contrast Neo-Brutalist placeholder art
// for the new games, matching the exact color palette and typography of the UI.
function getPlaceholderSvg(name, color = '#D84727') {
  return `<?xml version="1.0" encoding="utf-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
    <!-- Neo-Brutalist Outer Canvas -->
    <rect width="1024" height="1024" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="40"/>
    
    <!-- Decorative Framing lines -->
    <line x1="100" y1="100" x2="924" y2="100" stroke="#1C1C1A" stroke-width="12"/>
    <line x1="100" y1="100" x2="100" y2="924" stroke="#1C1C1A" stroke-width="12"/>
    <line x1="924" y1="100" x2="924" y2="924" stroke="#1C1C1A" stroke-width="12"/>
    <line x1="100" y1="924" x2="924" y2="924" stroke="#1C1C1A" stroke-width="12"/>
    
    <!-- Concentric graphic elements -->
    <circle cx="512" cy="512" r="320" fill="none" stroke="#1C1C1A" stroke-width="6" stroke-dasharray="24 16" opacity="0.3"/>
    
    <!-- Offset Shadow for the central card -->
    <rect x="172" y="372" width="680" height="280" rx="24" fill="#1C1C1A" />
    
    <!-- Central Text Badge Card -->
    <rect x="160" y="360" width="680" height="280" rx="24" fill="#FAF7F2" stroke="#1C1C1A" stroke-width="16" />
    
    <!-- Text Elements in Space Grotesk / JetBrains Mono styling -->
    <text x="500" y="465" font-family="'Space Grotesk', 'Arial Black', sans-serif" font-size="76" font-weight="900" fill="#1C1C1A" text-anchor="middle" letter-spacing="6">BRUTAL</text>
    <text x="500" y="565" font-family="'JetBrains Mono', monospace" font-size="64" font-weight="900" fill="${color}" text-anchor="middle" letter-spacing="4">${name.toUpperCase()}</text>
  </svg>
  `;
}

async function renderImages() {
  const games = [
    { name: 'zone', color: '#D84727' },       // Red
    { name: 'snake', color: '#2F6A4F' },      // Green
    { name: 'laser', color: '#FF3B30' },      // Bright Red/Orange
    { name: 'clone', color: '#1D5D8A' },      // Blue
    { name: 'collapse', color: '#D99B26' },   // Gold
    { name: 'ninja', color: '#1E1E1C' },      // Obsidian/Black
  ];

  const outDir = path.resolve('public/assets/games');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  for (const g of games) {
    const outPath = path.join(outDir, `${g.name}.jpg`);
    const svg = getPlaceholderSvg(g.name, g.color);
    
    console.log(`Generating clean neo-brutalist placeholder for Brutal ${g.name}...`);
    await sharp(Buffer.from(svg))
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
