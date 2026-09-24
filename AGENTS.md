# AGENTS.md — AI Agent Çalışma Kuralları

Bu dosya **AI agent'lar ve geliştiriciler** içindir: mimari sözleşmeler, yasaklar, sayısal bütçeler, iş akışları.
Proje haritası (dosya sorumlulukları, protokol tablosu, motor listesi, karar defteri, açık işler) **`docs/PROJECT_MAP.md`**'dedir — mimari, protokol, motor veya sözleşme değişikliklerinde ilgili bölümüne mutlaka başvurulur; küçük ve izole düzeltmelerde haritanın tamamını yüklemek yerine hedefe odaklanılır.

---

## 1. Yığın & Platform Modları

- Vanilla HTML5 + CSS3 + ES Modules, HTML5 Canvas, Vite build, PWA (`public/manifest.webmanifest`, `sw.js`).
- Üç platform modu: `LOCAL` (tek cihaz, ağ yok) · `TV_CONSOLE` (TV host + telefon kumandalar; host isteğe bağlı local P1, lokal WebSocket) · `ONLINE` (bir oyuncunun telefonu P1 host; 1-3 uzak telefon Supabase keşfi + WebRTC oyun akışı).
- Ağ seçici: `src/net.js` — TV_CONSOLE → `src/network.js` (PartyNetwork/WS), ONLINE → `src/supabaseRelay.js`. LOCAL'de ağ kullanılmaz.
- Supabase kimlik bilgileri **build'e gömülür**: `.env` → `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (**publishable key** `sb_publishable_...` formatı), `VITE_PUBLIC_URL`. Anahtarları asla koda gömme, asla commit'le.

## 2. Yetki Modeli (değiştirilemez)

- **Host cihaz tek yetkilidir (authoritative).** TV_CONSOLE'da TV host, ONLINE'da P1 oyuncusunun telefonu. Simülasyon sadece bu cihazda çalışır.
- Kumandalar **sadece input** gönderir: joystick `(x, y)` veya buton eylemleri. Kumandada oyun mantığı yürütülmez.
- Motorlar uzak girdiyi yalnızca `handleRemoteInput(slotIndex, data)` üzerinden alır.
- Host, oyun durumunu kumandalara yayınlar (madde 5'teki bütçeyle).

## 3. Engine Registry — tek kayıt noktası

- `src/core/engineRegistry.js` → `GAME_ORDER` (14 oyun: PONG…RACE — güncel liste dosyadadır, buraya kopyalanmaz).
- Yeni oyun = `engineRegistry.js` içinde `GAME_ORDER` kaydı + tek `CARTRIDGES.MOD` bloğu (`load/createEngine/reset/onEnter/onResume/start/packet`; görüntüleme destekleyen oyunlarda ayrıca `worldPacket/worldView`). `main.js` veya `gamepad.js` içine `else if (mode === ...)` zinciri **eklemek yasaktır**.
- Entry sözleşmesi: `game` (BaseMiniGame türevi) · `reset()` · `onEnter/onResume(now)` (fizik sıçramasını önler) · `start()` (sayaç sonrası) · `packet()` (8 Hz host HUD/state) · opsiyonel `worldPacket()` + `CARTRIDGES[MOD].worldView` (30 Hz P2P görüntüleme; SNAKE, ARCHER, BOMB, HEIST, TANKS, CLONE, NINJA, LASER, ZONE, COLLAPSE, CURVE — 11 oyun). Yeni world-view oyunu eklemek için: `src/games/[oyun]View.js` + `src/ui/[oyun]WorldView.js` + registry'de `worldView.load`/`worldPacket`; çekirdek `src/games/worldCore.js`'ten gelir.
- Motor sözleşmesi: `resetMatch/reset()`, `startNewMatch()`, `startNewRound()`, `update(now)`, `render()`, `resize(w,h)`, `handleRemoteInput(slotIndex, data)`.
- **Lokal (Tek Cihaz / PC & Masa-ortası) Sözleşmesi:**
  - Her motor sadece TV+telefon modunda değil, tek cihazda (`LOCAL`) da tam oynanabilir olmalıdır.
  - **LOBBY UI & Başlatma:** Motor LOBBY durumundayken canvas üzerinde `uiButtons` ile 4 köşe koltuk kartlarını (`cycleSlotType(i)`) ve merkezde `▶ MAÇI BAŞLAT` butonunu (`startNewMatch()`) çizmelidir. `onTouchStart` içinde `uiButtons` tap dispatch zorunludur.
  - **Klavye Desteği:** PC testleri ve yerel klavye oyunu için 4 slot klavye eşlemesi: P1 (`WASD` + `Space`), P2 (`Ok Tuşları` + `Enter`), P3 (`IJKL` + `O`), P4 (`TFGH` + `B`).
  - **Masa-ortası Dokunmatik:** Tablet/telefon masa-ortası modu için 4 köşe dinamik yüzen sanal joystick ve aksiyon butonları.
  - **Kontrol Kılavuzu:** `renderControlGuide(ctx, arena, ...)` çağrısı.
- **LOBBY tap kuralı:** Motor sahasındaki koltuk dokunuşu önce `this.onLobbySeatTap(index)` hook'una sorar (host bot ekle/çıkar için kullanır). Hook yoksa ve `isHosting` ise `cycleSlotType` çalışır; host değilse hiçbir şey yapılmaz. Motor içine ağ/relay kodu yazılmaz.
- **Ortak `src/core/` yardımcıları (refactor Faz 1-7, tek kaynak):** Motorlar aşağıdakileri kopyalamaz/yeniden yazmaz, `import` eder:
  - `networkProtocol.js` — ONLINE/TV_CONSOLE ortak input doğrulama sözleşmesi
  - `inputMaps.js` — klavye slot haritaları: `getSlotKeys`, `keyboardVectorFrom`, `readSlotKeys`, `isSlotActionEvent`, `slotForActionCode`, `buildCodeToSlotMap` (standart 4x harita + `SECOND_ACTION_KEYS`).
  - `touchFlow.js` — dokunmatik akış: `getQuadrant`, `roundOverSkipGuard` (BaseGame `handleRoundOverSkip(timerField)`; PONG `roundOverTimer` geçirir), `lobbyCenterStartTap`, `lobbyQuadrantTap`, `matchOverRestartTap` (istisna: tanks `getCornerZone`, PONG `getPlayerZoneAt`).
  - `physics2d.js` — fizik/çarpışma: `clampToArena`, `resolveAABB`, `pointBlocked`, `updateMovers`, `distToSegmentSquared`, `normalizeAngle`.
  - `pickupSystem.js` — power-up akışı: `spawnPickup`, `collectPickups`, `tickPickupTimers` + `EFFECTS` kayıt defteri.
  - `arenaKit.js` — ortak görsel + `buildLayout(name, arena)` düzen presets (`pillars`, `columns4`, `cross`, `crossfire`, `scatter`, `bunker`, `courtyard`, `split`) + `drawObstacle`/`drawPickup`. Motor kendi `buildMap()`'inde yalnız oyuna özgü ek katmanları/meta'yı tutar; ortak geometri preset adıyla çağrılır.
  - `playerEntity.js` — oyuncu varlığı: `createPlayer`, `tickEffectTimers`, `advancePlayer` (kademeli çıkarım — bomb/heist/race entegre; PONG/tanks/curve/snake/zone/collapse kendi gövdesinde kalır).
  - `avatarInGame.js` — oyun içi avatar: `drawGameAvatar`, `normalizeExpression`.
  - `tabletopIcons.js` — Lucide vektör ikon kütüphanesi: OS emojileri yerine Canvas 2D için `drawTabletopIcon`, DOM/kumanda butonları için `getTabletopIconSvg`. İkonlarda ham OS emojisi yazılmaz, buradan çağrılır.

## 4. Slot Modeli — tek koltuk gerçeği

- TV tarafı: `hostPlayerSlots[i] = { name, isReady, kind }`, `kind ∈ 'human' | 'bot'`. TV_CONSOLE host varsayılan olarak koltuklarda yer almaz; lobi düğmesiyle aynı cihazı P1 local oyuncusuna dönüştürebilir.
- ONLINE host cihazı da oyuncudur ve P1'e rezerve edilir; kalan en fazla 3 uzak telefon P2-P4 olur. Relay tarafı (Supabase `players[]`, WS `room.players[]`) koltukların kaynağıdır; host listesi, motor slotları ve telefon ızgarası hep snapshot'tan beslenir.
- `SLOTS_UPDATE` parity kuralı: WS ve Supabase **aynı payload şeklini** yayınlar (`slotIndex, name, color, kind, isReady, isHost`; snapshot ayrıca `reservedHostSlot` taşır). Birine eklenen alan diğerine de eklenir.
- İsimler `toUpperCase()`, en fazla 12 karakter.
- Bot koltuğu ne hedef ne kaynak olur: `SWITCH_SLOT` hedefi olamaz, ghost-reconnect botu yiyemez, hayalet geri kazanım botları atlar, sayaçta koltuk işlemleri kilitlidir (`seatsLocked`).
- Bot ekleme **varsayılan kapalıdır** (`isBotEkleEnabled()` → localStorage); pause menüsündeki `🤖 BOT EKLEME` düğmesiyle açılır. Kapalıyken bot butonları/ipucu çizilmez, saha tap'i bot eklemez — normal akışta sadece oyuncu eklenir/çıkarılır.
- **Ready-reset kuralı:** `GAME_STARTED` ve `RETURNED_TO_LOBBY` olaylarında hazır bayrağı **iki tarafta da** sıfırlanır (host `hostPlayerSlots` + kumanda `resetReady()`). Tek taraflı sıfırlama "takılı HAZIR" bug'ı üretir.
- Oda kodu 3 haneli sayı (`100–999`).

## 5. Ağ Bütçesi (sayılar değişmeden korunur)

- Host HUD/state broadcast **8 Hz (125 ms)** + JSON dirty-check; skor/taşıyıcı/sinyal gibi kritik olaylar **anında** gönderilir (hızlı yol).
- ONLINE görüntüleme pilotu SNAKE için ayrı unreliable WebRTC `world` kanalından **30 Hz tam snapshot** gönderir. Bu paketler Supabase'e düşmez; `control` kanalı reliable/ordered kalır.
- Kumanda input throttle **50 ms** + ölübant (`JOYSTICK/MOVE/PADDLE/CURVE`); `DASH/TACKLE/ateş` throttle dışıdır.
- Ping **15 sn**, kopma watchdog **30 sn**.

## 6. Oda Akışı

`Bekleme lobisi (modal) → SAHAYA GEÇ (staging, koltuk seçimi serbest) → 3-2-1 sayaç (koltuklar kilitli) → oyun → LOBİYE DÖN (oda kapanmaz, oyuncular kalır)`.
Modal açıkken canvas tap'leri motora düşmez; staging'de düşer (bot ekleme/çıkarma bu yolla çalışır).

## 7. UI Kuralları

- Neo-brutalist dil: Space Grotesk + JetBrains Mono, kalın sınırlar, sert kutu gölgeleri, yüksek kontrast.
- Modaller `src/ui/` altındadır (`hostLobby`, `joinModal`, `pauseModal`, `toast`); `main.js` orkestrasyonu yapar, modal DOM'u kurmaz.
- Kumanda tarafı: `CARTRIDGES[MOD].schema` deklaratif tanımı (`src/controllers/gamepadSchemas.js`); PONG hariç tüm oyunlarda isimli skor şeridi (`score-strip`). `worldView` tanımlı modlarda canvas altta, kontroller üstte overlay olur; client motor/fizik çalıştırmaz.
- Kumanda ergonomisi kararı: **dikeyde alt-orta kuşak** (`safe-area + 12vh`, 96px taban / 170px tavan), **yatayda köşeler** (sol-alt joystick, sağ-alt aksiyon). Yeni kumanda bu düzene uyar.
- Mobil: `portrait` + `landscape` desteklenir, `overflow-x` yasak, dokunmatiklerde `touch-action` zorunlu.
- Motion: `src/ui/motion.js` (`prefersReducedMotion`, `motionScale`) + tokenlar (`src/ui/tokens.js`) tek kaynaktır; yeni UI bu iki dosyadan sızar, lokal stil tanımlamaz. Temel UI hissi global kurala uyar (kısa fade/press, kuru pop-in yok).
- İkonografi: Butonlarda ve UI'da ham OS emojileri yerine tek kaynak `src/core/tabletopIcons.js` (`getTabletopIconSvg` / `drawTabletopIcon`) kullanılır. Kumanda aksiyon tuşlarında metin başlığı olmaz; ortalanmış, büyük ve net Lucide SVG ikonu yer alır.

## 8. Yasaklar

- `main.js` / `gamepad.js` içine moda özel `if/else` zinciri veya imperatif mount fonksiyonu ekleme — `src/controllers/gamepadSchemas.js` + `CARTRIDGES[MOD].schema` kullan.
- Motora `src/core/` ortak yardımcı mantığını kopyalama / yeniden yazma (inputMaps, touchFlow, physics2d, pickupSystem, arenaKit/buildLayout, playerEntity, avatarInGame, tabletopIcons) — tek kaynak `src/core/`'dur.
- Kumanda veya canvas UI'a ham OS emojisi yazma — `src/core/tabletopIcons.js` kullan.
- State'i iki yerde tutma (TV listesi ↔ relay tablosu çakışırsa relay kazanır).
- Kumandaya oyun simülasyonu, motora ağ kodu koyma.
- Çok gerekmedikçe yeni `*.md` dosyası oluşturma. Mevcut `AGENTS.md` + `docs/PROJECT_MAP.md` yeterlidir; yapı/protokol değişince ikisi de güncellenir. Yeni döküman şartsa kullanıcıya sor.
- **Doğal ve hedefe yönelik okuma:** Belirli bir sembol veya fonksiyon aranırken önce `grep_search` ile hedefe odaklanılır; ancak mimari akışı, dosya yapısını veya stilleri doğru anlamak gerektiğinde tam dosya veya geniş blok okumaktan çekinilmez. Yapay satır sınırlaması veya okuma yasağı yoktur; gereksiz devasa dosyalar (bundle, lockfile, dev loglar) bağlama dökülmez.

## 9. Yeni Oyun Ekleme Checklist'i

Motor sözleşmesi (madde 3) +:

- [ ] `src/games/[oyun].js` (varlık alanları farklıysa `syncSlotsToEngine` içine dal ekle)
  - [ ] **Lokal Lobi:** Canvas üzerinde 4 köşe slot kartı (`uiButtons` -> `cycleSlotType`) ve merkez `▶ MAÇI BAŞLAT` (`startNewMatch`)
  - [ ] **Lokal Kontroller:** 4 slot klavye eşlemesi (WASD, Oklar, IJKL, TFGH) + dokunmatik 360° yüzen joystick
  - [ ] **Kontrol Rehberi:** `renderControlGuide` çağrısı
- [ ] `src/ai/[oyun]AI.js` (bot karar motoru)
- [ ] `GAME_ORDER` + 1 satır `registerEngine` (`src/core/engineRegistry.js` & `src/main.js`)
- [ ] `src/controllers/gamepadSchemas.js` → `GAMEPAD_SCHEMAS[MOD]` deklaratif şeması
- [ ] `index.html` → bento kartı (`id="btn-select-[mod]"`, küçük harf) + TV lobi çipi + kumanda önizlemesi
- [ ] Madde 10'daki formülle `public/assets/games/[oyun].jpg` (1:1, optimize)
- [ ] `docs/PROJECT_MAP.md` motor tablosu ve dosya listesi güncellemesi
- [ ] `npm run check` ve `npm run build` temiz + kalıntı taraması (`else if (mode ===` dönmemeli)

## 10. Oyun Görseli Üretim Formülü

```
Ultra-minimalist 3D isometric illustration of [OYUN NESNELERİ/KONSEPT], floating on a clean square platform
with subtle thickness, stylized low-poly matte smooth surfaces, soft studio key lighting from top-left,
gentle ambient occlusion, subtle crisp drop shadow on warm cream background (#f4f4f0),
modern neo-brutalist game icon aesthetic, clean geometry, no text, no watermark, 1:1 aspect ratio.
```

Kurallar: metin/logo/filigran/yüz yok; 1:1 (512/1024px, sıkıştırılmış JPEG/WebP); kullanıldığı 3 yer — menü bento kartı, TV lobi çipi, kumanda lobi önizlemesi. (Eski 6 oyunun birebir promptları git geçmişindedir, buraya kopyalanmaz.)

## 11. Doğrulama

- `npm run check` (`tsc --noEmit`) hatasız geçmeli.
- `npm run build` hatasız geçmeli.
- Davranış değişikliğinde 3 prova: (a) hazır→lobi dönüşü bayrakları, (b) koltuk takasında TV+kumanda isimleri, (c) bot ekle/çıkar görünürlüğü.
- Commit mesajı kısa ve Türkçe/İngilizce karışık mevcut stile uygun; push yalnızca kullanıcı isterse.
