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

- `src/core/engineRegistry.js` → `GAME_ORDER` (15 oyun: PONG…RACE — güncel liste dosyadadır, buraya kopyalanmaz).
- Retired ama oynanabilir cartridge motorları `src/games-retired/` altında yaşar; registry kaydı, ID, controller, world-view ve ağ protokolü korunur. `GAME_ORDER` aktif oyunları önce, retired oyunları sonra sıralar.
- Yeni oyun = `engineRegistry.js` içinde `GAME_ORDER` kaydı + tek `CARTRIDGES.MOD` bloğu (`load/createEngine/reset/onEnter/onResume/start/packet`; görüntüleme destekleyen oyunlarda ayrıca `worldPacket/worldView`). `main.js` veya `gamepad.js` içine `else if (mode === ...)` zinciri **eklemek yasaktır**.
- Entry sözleşmesi: `game` (BaseMiniGame türevi) · `reset()` · `onEnter/onResume(now)` (fizik sıçramasını önler) · `start()` (sayaç sonrası) · `packet()` (8 Hz host HUD/state) · opsiyonel `worldPacket()` + `CARTRIDGES[MOD].worldView` (30 Hz P2P görüntüleme; PONG, ARCHER, TANKS, CURVE, BOMB, HEIST, ZONE, SNAKE, LASER, COLLAPSE, NINJA, HORDE, RACE, CROWN — 15 oyun). Yeni world-view oyunu eklemek için: `src/games/[oyun]View.js` + `src/ui/[oyun]WorldView.js` + registry'de `worldView.load`/`worldPacket`; çekirdek `src/games/worldCore.js`'ten gelir.
- Motor sözleşmesi: `resetMatch/reset()`, `startNewMatch()`, `startNewRound()`, `update(now)`, `render()`, `resize(w,h)`, `handleRemoteInput(slotIndex, data)`. `resize(w,h)` **CSS px** alır (`canvas.width` değil) ve saha kutusunu `computePlayfield` ile üretir.
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
  - `physics2d.js` — fizik/çarpışma: `clampToArena`, `resolveAABB`, `pointBlocked`, `updateMovers`, `distToSegmentSquared`, `segmentCircleIntersection`, `segmentAabbIntersection`, `getProjectileSubsteps`, `normalizeAngle`.
  - `playfield.js` — **saha geometrisinin tek kaynağı**: `computePlayfield(w, h, preset)` + `FIELD_PRESETS` (`standard`/`roomy`/`crown`/`flat`/`dense`/`racing`) ve ölçek yardımcıları `fieldPx`/`fieldRadius`/`fieldSpeed`. Motor `resize()` içinde kenarlık/arena hesabı **yazmaz**; `this.arena = computePlayfield(width, height, '<preset>')` der ve mevcut `left/top/right/bottom/width/height/size` alanları aynen gelir (`aspect` + `unit` ek alanlardır). `unit`, saha kısa kenarının 952px (1920×1080) referansına oranıdır ve **saha içi ölçeğin tek otoritesidir** — `tokens.js` `entityScale` kaldırıldı. Mutlak px tabanı yazmak yasaktır; taban `fieldRadius(pf, px, minFraction)` gibi **göreli** olmalıdır. Motor `canvas.width/height` **okumaz/yazmaz** (DPR backing store `main.js`'in sahipliğindedir; okumak device-px verir, yazmak `ctx.scale(dpr,dpr)`'ı siler). **Kompakt yatay kuralı:** telefon yatayda (`width > height` ve kısa kenar < 540px) dikey pay `max(10, h*0.03)`'e iner ve saha tam taşar (full-bleed); masaüstü/TV/tablet ve **portrait** değişmez.
  - `roundLifecycle.js` — ortak raunt/maç terminal kuralı: timeout, all-survivor draw ve MATCH_OVER geçişleri.
  - `pickupSystem.js` — power-up akışı: `spawnPickup`, `collectPickups`, `tickPickupTimers` + `EFFECTS` kayıt defteri.
  - `arenaKit.js` — ortak görsel + `buildLayout(name, arena)` düzen presets (`pillars`, `columns4`, `cross`, `crossfire`, `scatter`, `bunker`, `courtyard`, `split`) + `drawObstacle`/`drawPickup`. Motor kendi `buildMap()`'inde yalnız oyuna özgü ek katmanları/meta'yı tutar; ortak geometri preset adıyla çağrılır.
  - `playerEntity.js` — oyuncu varlığı: `createPlayer`, `tickEffectTimers`, `advancePlayer` (kademeli çıkarım — bomb/heist/race entegre; PONG/tanks/curve/snake/zone/collapse kendi gövdesinde kalır).
  - `avatarInGame.js` — oyun içi avatar: `drawGameAvatar`, `normalizeExpression`, `blinkState`. Saha içi avatar **her zaman** `faceMode: 'play'` ile çizilir: renk + büyük göz + disk içi hacim + göz kırpma/bakış. **Karakterde erişuar ve gövde deseni YOKTUR** (sahada da, özelleştirme menüsünde de, botlarda da) — siluet daima tam yuvarlak, kimlik rengin + yüz ifadesinden gelir. Menü/lobi/kumanda önizlemesi aynı gövdeyi `full` kipte çizer (hacim yok).
  - `tabletopIcons.js` — Lucide vektör ikon kütüphanesi: OS emojileri yerine Canvas 2D için `drawTabletopIcon`, DOM/kumanda butonları için `getTabletopIconSvg`. İkonlarda ham OS emojisi yazılmaz, buradan çağrılır.
  - `preferences.js` — versioned cihaz tercihleri ve legacy control-surface migration; ses/haptik/PONG ayarlarının tek kaynağı.
  - `haptics.js` — tüm engine/controller vibration çağrılarının ortak preference gate'i.
  - `inputSource.js` — keyboard/touch/pointer input source arbitration; aktif cihaz başına tek kaynak kilidi.
  - `controlDescriptor.js` — phone/tabletop/network için normalize kontrol sözleşmesi ve parity doğrulaması.
  - `inputIntent.js` — transport input packet'lerini canonical engine intent alanına projekte eder; mevcut `action` alanı geriye uyumlu kalır.
  - `aimInput.js` — ARCHER/HORDE/LASER için oyuncu başına canonical held/active/vector/sequence state'i; stale/out-of-order guard ve explicit release/cancel semantiğini tek yerde tutar.
  - `fireFeedback.js` / `fireFeedbackEffects.js` — ARCHER/HORDE/LASER için cooldown progress, blocked/ready/shot feedback state'i; blocked sesi/haptic'i yalnız cooldown episode başına bir kez çalar.
  - `AIM_MOVE` / `AIM_PRESS` / `AIM_RELEASE` — yalnız ARCHER/HORDE/LASER için sağ analog eksen ve attack lifecycle'ı; analog 50 ms throttle, bas/bırak discrete ve host-authoritative uygulanır. Sağ joystick basılıyken attack durumundadır; ARCHER/LASER bırakışta ateşler, HORDE bırakışta ateşi bırakır. Nötr dokunuş ateş üretmez.
  - `inputRouter.js` — normalize edilmiş local/network input'u aktif authoritative engine'e taşır; transport adapter'ları engine/mode lookup bilmez.
  - `gamepadInputAdapter.js` — transport'tan bağımsız 50ms analog throttle, dead-zone ve nötr analog state; fiziksel gamepad ikincil kaynak için temel sınır.
  - `physicalGamepadAdapter.js` — Browser Gamepad API polling adapter'ı; touch/keyboard/pointer öncelikli, host engine'e yalnızca aynı transport packet'lerini gönderir.
  - `gamepadShell.js` — GamepadManager'dan ayrılmış stabil kumanda shell/presenter markup'ı.

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
- ONLINE world-view oyunları için ayrı unreliable WebRTC `world` kanalından **30 Hz tam snapshot** gönderilir. Bu paketler Supabase'e düşmez; `control` kanalı reliable/ordered kalır.
- World-frame transport 30 Hz'de kalır; client `GamepadWorldView` snapshot'ları jitter buffer'da tutup native `requestAnimationFrame` ile 60 Hz+ sunum yapar. Interpolate edilen projectile/NPC/moving-wall entity'leri stable id taşır; `sentAt` yalnız source clock/diagnostic metadata'dır. Interpolasyon duvar içi extrapolation yapmaz, round/state/host sınırında snap olur.
- Kumanda input throttle **50 ms** + ölübant (`JOYSTICK/MOVE/AIM/PADDLE/CURVE`); `AIM_PRESS/AIM_RELEASE`, `DASH/TACKLE/ateş` throttle dışıdır. Aktif sağ aim joystick'u stale-input süpürücüsüne karşı 250 ms keepalive taşır.
- Ping **15 sn**, kopma watchdog **30 sn**.

## 6. Oda Akışı

`Bekleme lobisi (modal) → SAHAYA GEÇ (staging, koltuk seçimi serbest) → 3-2-1 sayaç (koltuklar kilitli) → oyun → LOBİYE DÖN (oda kapanmaz, oyuncular kalır)`.
Modal açıkken canvas tap'leri motora düşmez; staging'de düşer (bot ekleme/çıkarma bu yolla çalışır).

## 7. UI Kuralları

- Neo-brutalist dil: Space Grotesk + JetBrains Mono, kalın sınırlar, sert kutu gölgeleri, yüksek kontrast.
- **Tek renk sözlüğü:** `src/styles/tokens.css` (CSS) + `src/ui/tokens.js` (canvas/JS) aynı değerleri taşır ve birlikte güncellenir. `src/` altındaki hiçbir `.css`'te ham renk literal(i) — `hex`, `rgb()`, `rgba()`, `hsl()` **veya isimlendirilmiş renk anahtar kelimesi** (`black`, `white`, `red`…) — yazılmaz; `npm run check` içindeki `scripts/token-lint.mjs` bunu **ve** tanımsız `var()` referansını zorlar. Yeni renk gerekiyorsa önce sözlüğe ekle, sonra `var(--token)` kullan. (Yerel bileşen değişkeni `--x:` olarak tanımlanabilir, `setProperty` ile runtime atanabilir, `var(--x, yedek)` fallback'li olabilir — üçü de geçerlidir.)
- **Token rolleri (koyu uygulama kimliği):**
  - `--ink`/`--muted`/`--faint` **metindir**; `--surface`/`--surface-2`/`--elevated`/`--panel` **yüzeydir**. Nötr rampa koyu temada ters çevrilidir: `--n-900` en açık tondur. Tek tek nötr uydurmak yasaktır.
  - **Kenar ve gölge kenarı `--edge` / `--edge-strong`'tir, `--ink` değil.** Koyu zeminde `--ink` ile çizilen 2-3px kenar kartı tel kafes gibi gösterir.
  - **Doygun dolgu üstündeki yazı `--on-accent`'tir** (turuncu/altın/sarı dolgular). `--ink` koyu temada açık olduğu için bu yüzeylerde kullanılamaz; `--white` yalnız "doygun renk üstündeki yazı" içindir.
  - **Krem saha kapsamı:** oyun sırasında canvas üstüne oturan DOM kaplamaları (`#in-game-hud`, `#staging-bar`, `#countdown-overlay`, `#local-mobile-controls`) ve kumanda yüzeyi (`#gamepad-overlay`) `data-theme="field"` alır; `tokens.css` bu kapsamda yüzey/mürekkep token'larını geri eşler. Sahaya yeni bir DOM kaplaması eklenirse aynı kapsamı alır — açık zeminde açık yazı yazmak yasaktır.
  - Global sıfırlamalar `tokens.css`'tedir ve korunur: `button, input, select, textarea { font: inherit; color: inherit }` (UA `buttontext` siyahı koyu zeminde görünmez metin üretir) ve tek `.hidden { display: none !important }` (her öğenin kendi `#id.hidden` kuralı taşınmaz).
- **Overlay semantiği tek yerdedir:** `src/ui/overlayHost.js` açık diyalogların sahibidir (odak trap, Escape, backdrop, `<html data-overlay>`). Modal açan her modül `openOverlay(id, { el, onClose })` çağırır, kapanışta `closeOverlay(id)`; kendi overlay kilidi tutmaz. Overlay açıkken shell girdi sahipliğini bırakır (`setShellInputSuspender`) — ok tuşları arkaya kaçmaz.
- Görsel dil: **koyu uygulama yüzeyi** (derin lacivert-mor) + sıcak krem **saha** (oyun içi canvas ve krem kapsamdaki DOM kaplamaları) + doygun accent, **yuvarlak radius** (`--radius-card/btn/pill`) ve yumuşak katmanlı gölge (`--shadow-soft/float/edge/pop/press`). Sert kutu gölgesi (`--shadow-hard`) bilinçli olarak korunmuş bir DNA kalıntısıdır; sayfa ve kart yüzeylerinde `--grad-surface/--grad-card` tercih edilir. Nötr kararlar tek rampa üzerinden verilir (`--n-900`…`--n-000`), tek tek nötr uydurmak yasaktır.
- **Modaller `src/ui/` altındadır** (`hostLobby`, `joinModal`, `pauseModal`, `settingsModal`, `customizeModal`, `toast`); `main.js` orkestrasyonu yapar, modal DOM'u kurmaz. Görünümler (shell ekranları) ise `src/ui/views/` altında, `views/registry.js` üzerinden kayıt olur.
- **Ortak DOM bileşenleri tek uygulamadır:** oyuncu isim alanı `playerNameField.js`, ikon yuvaları `iconSlots.js` (`hydrateIconSlots(root, attr, defaults)`). Statik markup ikonu **yazmaz**, yalnız `data-icon` / `data-lobby-icon` ile yerini işaretler; ikinci bir ikon uygulaması açmak yasaktır.
- Kumanda tarafı: `CARTRIDGES[MOD].schema` deklaratif tanımı (`src/controllers/gamepadSchemas.js`); PONG hariç tüm oyunlarda isimli skor şeridi (`score-strip`). `worldView` tanımlı modlarda canvas altta, kontroller üstte overlay olur; client motor/fizik çalıştırmaz.
- Kumanda ergonomisi kararı: **dikeyde alt-orta kuşak** (`safe-area + 12vh`, 96px taban / 170px tavan), **yatayda köşeler** (sol-alt joystick, sağ-alt aksiyon). Yeni kumanda bu düzene uyar.
- **Uygulama kabuğu (`src/ui/appShell.js`) tek sahiptir:** `dvh`, safe-area, view stack (yatay push/pop), donanım geri tuşu, Escape, rotate gate, orientation lock, girdi sahipliği ve **üst şerit** (marka + kalıcı gezinme + sağdaki simgeler; geri düğmesi yok, bkz. bir sonraki madde). Dışarıdan açılan ekranlar `revealView(id)` / `closeView(id)` kullanır (zaten açık olan ekrana `revealView` dokunmaz). Başka modül bu listener'ları eklemez. Görünüm = `src/ui/views/` altında bir dosya + `registerView()` satırı; `main.js`/`gamepad.js` içine ekran adına özel dal **eklemek yasaktır**.
- **Sahne ekranları ortak dili kullanır:** `src/styles/scene.css` arka plan katmanlarını, karakter/rozeti ve `.scene-btn` buton ailesini tek yerde tanımlar; `home.css`/`room.css`/`games.css` yalnız **konum** yerelleştirir. Yeni bir sahne ekranı yaparken buton stili yazmak yasaktır — `is-gold` / `is-teal` / `is-ghost` ağırlıklarından birini seç. Aynı işi iki yol göstermek (aynı iki ekranda yerel oynama gibi) yasaktır. Sahne ekranı **katalog/sayfa gibi okunmaz**: ayrı bir "önizleme paneli", ikinci bir başlık satırı veya ağır kart çerçevesi eklemek yasaktır — seçili öğenin adı/özeti sahnenin kendi yüzeyinde DEV YAZI durur, tek eylem düğmesi vardır.
- **SAHNE ÇİZGİSİ (`--scene-stage-y`) tek kaynaktır:** arena diskinin üst kenarı bu yüzdeyle verilir; sahneye oturan karakter (`.scene-hero.is-staged`) ayağını bu çizgiye dayandırır (`bottom: calc(100% - var(--scene-stage-y) - var(--hero-ground-gap))`). Karakterin kendi zemin halkası canvas'ın alt kenarından ~%15 yukarıdadır (`drawAvatarStage`), bu yüzden `--hero-ground-gap` o farkı kapatır. Disk ve karakter ayrı ayrı konumlanmaz; `top: 50%` + `bottom: -14%` gibi bağımsız değerler **denk gelmeme** bug'ı üretir (kullanıcı raporu).
- **Lobi bir GÖRÜNÜMDÜR, modal değildir:** `views/lobbyView.js` `index.html`'deki `#tv-host-modal > .tv-host-card` düğümünü **devralır** (`keepAlive` + idempotent `build`); devralma sonrası boş kalan modal kabuğu `remove()` edilir (yerinde `position: fixed` scrim + `backdrop-filter` kalırsa tüm ekranı bulanıklaştırır). Durum sınıfları (`is-online-room`, `is-seat-editor`) ve onların CSS'i **kart üzerinde** yaşar (`hostLobby.js` `.lobby-card`'a yazar, `lobby.css` `.lobby-card.is-*` ile eşleştirir) — `#tv-host-modal.*` seçicisi yazmak yasaktır. Lobi yerleşim kuralları `room.css`'te `.lobby-scene .lobby-card` özgüllüğüyle yazılır (tek sınıf `lobby.css`'teki `.tv-host-card` kurallarının altında kalıyordu).
- **Lobide 15 oyunun hepsi görünmez — karusel:** tek kapak + ad + taktik ipucu + iki adım düğmesi (`setHostGameMode`, `GAME_ORDER` sırası). Oyun değişimi TEK fonksiyondan geçer (`setHostGameMode`: relay + `lobby:game` olayı); görünüm yalnız dinler. Lobide bölüm anahtarı, dikey sayfa akışı ve yatay track yoktur — iki sütun × iki satır tek düzen her boyutta kaydırmasız çalışır. Lobinin altındaki koyu ray (`--lobby-rail`) zorunludur: sahnenin en aydınlık yerinde saydam yüzey + açık metin okunmuyor.
- **Üst şeritte geri düğmesi YOKTUR; kalıcı gezinme vardır:** `ANASAYFA / OYUN / KARAKTER` üç girdisi markanın sağında, sola yaslı durur (kullanıcı kararı). "Nereye girdiysem ana menüye dön" işi bu gezinmenin ilk girdisinin işidir; `goHome()` yığını köke indirir ve `onLobbyExit` ile odayı kapatır. Kalıcı olmayan görünümler (`rail: null` — oda, lobi) rayda görünmez; ray sırası `rail.order` ile belirlenir. `#shell-back` markup'ı ve CSS'i silinmiştir — geri eklemek yasaktır. Escape / donanım geri tuşu / tarayıcı history'si yine `back()` çalıştırır.
- **Sayfa akışı yasaktır:** dikey `overflow-y: auto` yalnız `index.html`'de kalan tek lobi/ayar panelinde geçerlidir; shell ekranlarında sığmayan içerik ya `[data-h-track]` yatay track'inde sayfalanır ya da kendi içinde kapsüllenmiş bir scroller'a girer. Konsol düzeni odakla gezinilir (`focusRouter`), sayfa scrollbar'ıyla değil.
- Mobil: `portrait` + `landscape` desteklenir, `overflow-x` yasak, dokunmatiklerde `touch-action` zorunlu. App geneli **landscape kilitlidir**; telefonda dikeyde rotate gate (`#app-rotate-gate`) gösterilir.
- Motion: `src/ui/motion.js` (`prefersReducedMotion`, `motionScale`) + tokenlar (`src/ui/tokens.js`) tek kaynaktır; yeni UI bu iki dosyadan sızar, lokal stil tanımlamaz. Temel UI hissi global kurala uyar (kısa fade/press, kuru pop-in yok).
- İkonografi: Butonlarda ve UI'da ham OS emojileri yerine tek kaynak `src/core/tabletopIcons.js` (`getTabletopIconSvg` / `drawTabletopIcon`) kullanılır. Kumanda aksiyon tuşlarında metin başlığı olmaz; ortalanmış, büyük ve net Lucide SVG ikonu yer alır.

## 8. Yasaklar

- `main.js` / `gamepad.js` içine moda özel `if/else` zinciri veya imperatif mount fonksiyonu ekleme — `src/controllers/gamepadSchemas.js` + `CARTRIDGES[MOD].schema` kullan.
- Motora `src/core/` ortak yardımcı mantığını kopyalama / yeniden yazma (inputMaps, touchFlow, physics2d, pickupSystem, arenaKit/buildLayout, playerEntity, avatarInGame, tabletopIcons) — tek kaynak `src/core/`'dur.
- **Oynarken sürekli chrome çizme (mobil yatay):** kompakt yatayda (`isCompactLandscape(w,h)`) saha üst payı ~3px olduğu için `arena.top`'a konumlanan sabit panel/şerit sahanın içine düşer. `renderControlGuide(..., { duringPlay: true })` bu durumda çizmez; yardım/ayar tek butonun açtığı mola panelinde yaşar (`renderPauseControls`, ikon-only + klavye tuş yazısı). HUD yerleşim kararları `isCompactLandscape` üzerinden tek yerden verilir.
- Kumanda veya canvas UI'a ham OS emojisi yazma — `src/core/tabletopIcons.js` kullan.
- **DOM UI'a ham OS emojisi yazma** (ayarlar sheet'i, katılım sheet'i, profil, lobi dahil) — `tabletopIcons.js` + `src/ui/iconSlots.js` (`hydrateIconSlots`) kullan. Statik markup'ta ikonu `data-icon="<ad>"` ile işaretle, metin i18n sözlüğüne gömme.
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
