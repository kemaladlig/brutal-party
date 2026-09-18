# AGENTS.md — Party Games Architecture & AI Guidelines

Bu doküman, projede çalışan tüm AI agent'lar ve geliştiriciler için **temel mimari harita**, **kodlama standartları** ve **görsel üretim stratejisi** rehberidir.

---

## 1. Proje Özeti & Teknoloji Yığını

- **Platform:** Çok oyunculu (2-4 Kişilik) Web & Mobil Party Game (PWA).
- **Hedef Ekranlar:**
  - **Ekran / TV Host:** Masaüstü/TV/Tablet ekranında büyük canvas sahası, lobi yönetimi, QR kod ve oda pin kodu.
  - **Gamepad Kumanda:** Oyuncuların telefonlarından bağlandığı ultra düşük gecikmeli dokunmatik kontrolör (Joystick, dinamik aksiyon butonları, titreşim desteği).
- **Teknoloji:**
  - **Frontend:** Vanilla HTML5, CSS3, ES Modules (Modern JavaScript), HTML5 Canvas.
  - **Build Tool:** Vite.
  - **Realtime Ağ İletişimi:** Supabase Broadcast Channels (`supabaseRelay.js`) + WebSocket fallback.
  - **Tasarım Dili:** Neo-Brutalist UI (Space Grotesk + JetBrains Mono, kalın sınırlar `2.5px - 4px #1a1a1a`, sert kutu gölgeleri `4px 4px 0px #1a1a1a`, yüksek kontrast, mikro animasyonlar).

---

## 2. Mevcut Oyun Modları (6 Mini-Game)

1. **BRUTAL PONG (`PONG`):** 4 kaleli dinamik masa tenisi, falsolu vuruşlar ve ivmelenen ralli.
2. **MICRO-TANKS (`TANKS`):** Labirent arenası, seken 2 mermi, kendi kendine dönen tank ve zamanlamalı dokunarak ilerleme.
3. **BRUTAL CURVE (`CURVE`):** Achtung die Kurve stili, rakipleri sıkıştırma, deliklerden geçme ve hayatta kalma dümeni.
4. **BRUTAL BOMB (`BOMB`):** Sıcak bomba saklambaç arenası, depar tuşu ve patlama geri sayımı.
5. **BRUTAL HEIST (`HEIST`):** Ortadan altın ve elmas toplama, kendi kasana taşıma ve rakiplere omuz atma.
6. **QUICK DRAW (`DUEL`):** Vahşi batı refleksi; ses veya sinyali bekle, tetiğe ilk dokunan kazanır.

---

## 3. Oyun Görselleri & Prompt Üretim Stratejisi

Yeni bir oyun eklendiğinde menü, TV lobisi ve kumanda önizlemelerinde kullanılacak görsel asset'ler aşağıdaki standart formülle üretilmelidir:

### A. Görsel Tasarım Felsefesi
- **Ultra Minimalist & İzometrik (Isometric):** Ayrıntılı çizimler veya karmaşık 2D pop-art yerine, 45 derece açılı temiz 3D izometrik platform.
- **Sade Geometri (Low-Poly / Stylized):** Mat pürüzsüz plastik/seramik yüzeyler, abartısız ve sembolik figürler.
- **Temiz Zemin:** Kare şeklinde havada asılı duran izometrik bir platform (tile) ve nötr/sıcak açık gri arkaplan (`#f4f4f0`).
- **Sıfır Metin / Sıfır Karmaşa:** Asla metin, logo, filigran veya insan yüzü içermemeli.

### B. Prompt Şablonu (Formula)
```text
Ultra-minimalist 3D isometric illustration of [ANA OYUN NESNELERİ/KONSEPT], floating on a clean square platform with subtle thickness, stylized low-poly matte smooth surfaces, soft studio key lighting from top-left, gentle ambient occlusion, subtle crisp drop shadow on warm cream background (#f4f4f0), modern neo-brutalist game icon aesthetic, clean geometry, no text, no watermark, 1:1 aspect ratio.
```

### C. Referans Promptlar (Mevcut 6 Oyun İçin Kullanılanlar)

1. **Pong (`pong.jpg`):**
   > *"Ultra-minimalist 3D isometric illustration of an air hockey table with two vibrant minimalist paddles (one red, one blue) and a glowing white cube puck in motion, floating on a clean square arena platform with subtle border walls, stylized low-poly matte smooth finish, soft studio lighting, subtle shadow, warm off-white background, modern neo-brutalist game icon, no text, 1:1 aspect ratio."*

2. **Micro-Tanks (`tanks.jpg`):**
   > *"Ultra-minimalist 3D isometric illustration of a stylized toy battle tank inside a clean minimalist maze obstacle course, one blue toy tank and a glowing yellow ricochet projectile path, floating square platform with crisp geometric maze blocks, low-poly matte smooth surface, soft studio lighting, warm cream background, modern neo-brutalist game icon aesthetic, no text, 1:1 aspect ratio."*

3. **Brutal Curve (`curve.jpg`):**
   > *"Ultra-minimalist 3D isometric illustration of two sleek 3D tubular snake lines (one vibrant green, one crimson) curving and weaving across a clean square floor tile with deliberate line gaps, floating minimalist platform, smooth rounded geometry, soft studio key lighting, subtle crisp shadow, warm off-white background, neo-brutalist game icon style, no text, 1:1 aspect ratio."*

4. **Brutal Bomb (`bomb.jpg`):**
   > *"Ultra-minimalist 3D isometric illustration of a classic matte black spherical bomb with a lit glowing spark star fuse, sitting on a clean square floating platform tile with subtle warning stripes, stylized smooth low-poly finish, soft studio lighting, crisp drop shadow, warm neutral background, modern neo-brutalist party game aesthetic, no text, 1:1 aspect ratio."*

5. **Brutal Heist (`heist.jpg`):**
   > *"Ultra-minimalist 3D isometric illustration of an open miniature bank vault safe door with a sparkling golden diamond gem and stacked minimalist gold ingots inside, resting on a clean floating square platform, smooth matte materials, soft studio lighting, warm cream background, modern game icon, no text, 1:1 aspect ratio."*

6. **Quick Draw (`duel.jpg`):**
   > *"Ultra-minimalist 3D isometric illustration of a stylized vintage revolver pistol resting on a floating terracotta square tile with a miniature cowboy hat and a bold 3D lightning bolt exclamation symbol, smooth matte finish, soft studio lighting, warm neutral background, clean neo-brutalist game icon style, no text, 1:1 aspect ratio."*

### D. Asset Dosya ve Entegrasyon Kuralları
- **Konum:** `public/assets/games/[oyun_adi].jpg` (Örn: `pong.jpg`, `tanks.jpg`).
- **Format / Boyut:** 1:1 kare (512x512 veya 1024x1024 px, web için optimize sıkıştırılmış JPEG/WebP).
- **Kullanıldığı Yerler:**
  1. `index.html` → Ana Menü Bento Grid (`.bento-media-box > .bento-thumb-img`)
  2. `index.html` → TV Host Lobi Seçim Grid'i (`.lobby-game-chip > .chip-thumb-img`)
  3. `src/gamepad.js` → Mobil Kumanda Lobisi (`.lobby-game-preview-card > .lobby-game-thumb-preview`)

---

## 4. Mimari & Kodlama Kuralları

1. **State & Ağ Senkronizasyonu:**
   - TV Host tam yetkili (authoritative) simülatördür.
   - Kumandalar sadece input (joystick `(x, y)` veya buton basışları) gönderir.
   - Kumanda input frekansı `20-30Hz` (30-50ms) aralığında throttle edilir.
2. **Koltuk & Oyuncu Yönetimi:**
   - 4 sabit koltuk vardır: P1 (Kırmızı), P2 (Mavi), P3 (Sarı), P4 (Yeşil).
   - Oyuncular lobide hem mobilden hem de host ekranından boş koltuklara tıklayarak geçiş yapabilir (`SWITCH_SLOT`).
   - Oyuncu isimleri her zaman büyük harfe (`toUpperCase()`) normalize edilir.
3. **Mobil Uyumluluk:**
   - Yatay (`landscape`) ve dikey (`portrait`) modları desteklenmelidir.
   - Asla viewport taşması (`overflow-x`) olmamalıdır (`box-sizing: border-box`, `max-width: 100vw`).
   - Dokunmatik kontrollerde `touch-action: none` / `touch-action: manipulation` zorunludur.

---

## 5. Yeni Oyun Ekleme Kontrol Listesi (Checklist)

- [ ] `src/[oyun_adi].js` motor dosyasını oluştur (Canvas render döngüsü, update fonksiyonu, skor mantığı).
- [ ] `src/gamepad.js` içerisine ilgili oyunun kumanda layout'unu (`mount[Oyun]Controller`) ekle.
- [ ] Yukarıdaki prompt formülüyle minimalist izometrik görseli üret ve `public/assets/games/[oyun_adi].jpg` konumuna ekle.
- [ ] `index.html` Bento Grid ve TV Lobisi selector butonlarına ekle.
- [ ] `src/main.js` içerisinde oyun başlatma ve lobi geçiş bağlantılarını sağla.
- [ ] `npm run build` ile derleme hatası olmadığını doğrula.
