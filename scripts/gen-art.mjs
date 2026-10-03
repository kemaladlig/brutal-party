// Üretilen AI görsellerini (`.jfif`/JPEG) oyunun beklediği webp asset'lerine
// dönüştürür. Tek seferlik/tekrarlanabilir asset işi — runtime'a kod girmez.
// Kaynaklar `art-source/` altında tutulur (public'e girmez, pakete binmez).
import { mkdirSync, renameSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ART_SRC = 'art-source';
// Kaynaklar art-source'ta durur (gitignore'lu, pakete girmez); public'e
// yalnız üretilmiş webp'ler çıkar. Eski akıştan kalma public'teki .jfif
// varsa onu da temizlemek için PUBLIC_DIR taranır.
const PUBLIC_DIR = 'public/assets';

const JOBS = [
  {
    file: 'Gemini_Generated_Image_p75csrp75csrp75c.jfif',
    out: 'public/background.webp',
    width: 2752,
    height: 1536,
    brightness: 0.95, // UI metni için hafif karartma
  },
  {
    file: 'Gemini_Generated_Image_mv2441mv2441mv24.jfif',
    out: 'public/assets/illustrations/tv.webp',
    width: 920,
    height: 514,
  },
  {
    file: 'Gemini_Generated_Image_73v5or73v5or73v5.jfif',
    out: 'public/assets/illustrations/online.webp',
    width: 920,
    height: 514,
  },
];

for (const job of JOBS) {
  const candidates = [join(ART_SRC, job.file), join(PUBLIC_DIR, job.file)];
  const src = candidates.find((p) => existsSync(p));
  if (!src) {
    console.warn('kaynak yok, atlandı:', job.file);
    continue;
  }
  let img = sharp(src).resize(job.width, job.height, { fit: 'cover', position: 'centre' });
  if (job.brightness && job.brightness !== 1) img = img.modulate({ brightness: job.brightness });
  await img.webp({ quality: 82 }).toFile(job.out);
  console.log(`→ ${job.out} (${job.width}x${job.height})`);
}

// Eski akıştan kalma .jfif public'te kaldıysa art-source'a taşı (pakete binmesin).
mkdirSync(ART_SRC, { recursive: true });
for (const f of readdirSync(PUBLIC_DIR)) {
  if (f.toLowerCase().endsWith('.jfif')) {
    renameSync(join(PUBLIC_DIR, f), join(ART_SRC, f));
    console.log(`kaynak taşındı → ${ART_SRC}/${f}`);
  }
}
