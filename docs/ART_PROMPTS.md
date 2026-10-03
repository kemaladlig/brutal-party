# Görsel Üretim Promptları — "Arcade Oyuncak Kutusu"

AI görsel üreticisiyle `public/` altındaki illüstrasyon asset'lerini bu dile
göre üret. Simgeler (`icon.svg`, `icon-192.png`, `icon-512.png`) kod tarafında
üretildi; burada yalnız **hero arka planı, 2 mod illüstrasyonu ve 13 oyun
kapağı** var.

## Ortak stil bloğu (her promptun başına ekle)

> **STYLE:** 3D toy-tabletop arcade art, vibrant pastel palette, chunky rounded
> shapes, thick beveled edges lit from the top-left (−45°), glossy candy
> plastic material, soft directional contact shadows, playful Brawl Stars /
> Mario Party energy, clean and readable silhouette, centered composition,
> subtle film grain, high detail, single light source.
> **NEGATIVE:** text, letters, numbers, logo, watermark, signature, UI
> elements, harsh black outlines copies, photorealism, gritty/dark horror,
> cluttered background, multiple scenes, frame border.

Palet çapası (token'larla aynı): mor zemin `#241a55→#14101f`, turuncu vurgu
`#ff8c1a`, altın `#ffcc00`, koltuk renkleri `#f0483c` `#2b7fc4` `#ffcc00`
`#35b36a`.

**Genel kurallar**
- Kapak ve illüstrasyonlarda **yazı olmasın** — oyun adı DOM'da (`game-card-name`) yazılır.
- Konu kare ortada, kenarlarda ~%15 nefes payı; maskelenince/kırpılınca bozulmasın.
- Her asset'in pastel arka planı o oyunun `category` rengine yaslansın:
  `speed`→mavi/camgöbeği, `aim`→yeşil, `strategy`→mor, `fight`→kırmızı/turuncu.
- Çıktı: `webp`, kalite ~82, sRGB.

---

## 1) Ana sahne arka planı

**Dosya:** `public/background.webp` · **Ölçü:** 2752×1536 (16:9) · alt-orta `cover` kırpılır.

> A cozy arcade corner seen from the player's side: a low **toy tabletop**
> stretching across the lower third with a thick beveled wooden-plastic edge,
> above it a deep indigo-to-plum wall with soft bokeh light orbs and a warm
> orange spotlight glow from the upper-left, faint confetti and floating
> sparkles in candy colors, subtle vignette, the horizon kept low so the center
> stays empty for UI.

---

## 2) Mod illüstrasyonları

**Ölçü:** 920×514 (16:9), aynı stil.

- `public/assets/illustrations/tv.webp` — **TV_CONSOLE**
  > A living-room TV console setup: one big friendly TV screen glowing on a
  > toy table, surrounded by four chunky mobile phones used as game controllers,
  > colorful seat-color accents, warm inviting mood.
- `public/assets/illustrations/online.webp` — **ONLINE**
  > Four chunky smartphones connected by glowing curved network trails meeting
  > at a bright hub, a globe made of toy plastic in the center, travel/adventure
  > energy, cool blue with orange accents.

---

## 3) Oyun kapakları

**Dosya:** `public/assets/games/<oyun>.webp` · **Ölçü:** 1024×1024 (1:1).

| # | Dosya | Kategori | Prompt konusu |
|---|-------|----------|----------------|
| 1 | `horde.webp` | fight | A cute toy hero braced in the center while a **swarm of tiny round monsters** surges in from all sides; red/orange pastel |
| 2 | `colossus.webp` | fight | A **giant towering toy boss** filling the background, one tiny brave hero in front raising a fist; dramatic scale, red pastel |
| 3 | `pong.webp` | speed | Two chunky neon **paddles** and a glowing ball with a motion streak, retro arcade, cyan pastel |
| 4 | `archer.webp` | aim | A toy **archer** drawing a bow, an arced glowing arrow and a bullseye target, green pastel |
| 5 | `tanks.webp` | fight | **Two stubby toy tanks** facing off on a tiled arena floor, top-down-ish, orange pastel |
| 6 | `curve.webp` | strategy | Glowing **light-cycle trails** curving across a grid floor, vivid neon ribbons, purple/teal pastel |
| 7 | `bomb.webp` | fight | A round cartoon **bomb** with a lit fuse on cracked arena tiles, sparks, red pastel |
| 8 | `heist.webp` | fight | A sneaky toy **thief** with a loot bag and a shiny gem, spotlight cones, purple pastel |
| 9 | `zone.webp` | strategy | **Colored territory tiles** splitting a board, small flag markers, purple/blue pastel |
| 10 | `snake.webp` | strategy | A chunky segmented **snake** coiling toward glowing pellets on a grid, green pastel |
| 11 | `collapse.webp` | strategy | **Crumbling platform blocks** falling away, a hero jumping to safety, purple/orange pastel |
| 12 | `ninja.webp` | fight | A cute **ninja** in a smoke puff with a flying shuriken, red/indigo pastel |
| 13 | `crown.webp` | fight | A gleaming **golden crown** on a pedestal with toy contenders reaching for it, gold/red pastel |

---

## Teslim akışı
1. Kaynağı sohbete yapıştırma (istek şişer): dosyayı `art-source/` altına at, adını söyle.
2. `node scripts/gen-art.mjs` webp'yi `public/` altına aynı ad ve ölçüyle üretir.
3. `npm run build`, ardından `npm run dev` ile gözle doğrula.
4. Asset değiştiyse `public/sw.js` içindeki `CACHE_NAME` sürümünü yükselt (kurulu PWA eskiyi göstermesin).
