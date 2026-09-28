# PROJECT_MAP — Brutal Party Proje Haritası

Yaşayan referans: kod/mimari değişince güncellenir. Sözleşmeler/yasaklar/bütçeler **AGENTS.md**'dedir; bu dosya dosya haritası + motor tablosu + protokol + kararların özetidir. Teknik yol haritası **docs/TECHNICAL_ROADMAP.md**'dedir.
Tamamını dump etme — bölüm bulmak için `grep` kullan. Son doğrulama: Refactoring sonrası (Eylül 2026).

---

## 1. Dizin & Dosya Sorumlulukları

```
index.html                  Ana menü, TV lobi modali, kumanda overlay iskeleti
src/main.js                 Ana orkestratör: mod/oda akışı, P1 host slotu, staging+sayaç,
                            8 Hz HUD/state + 30 Hz world broadcast, render döngüsü, wake lock, fullscreen
src/net.js                  Ağ seçici (LOCAL / TV_CONSOLE→WS / ONLINE→Supabase) + env bayrakları
src/network.js              PartyNetwork: lokal WebSocket istemcisi (host + kumanda)
src/supabaseRelay.js        ONLINE host/player tabloları, keşif/signaling, control/world DataChannel
src/webrtcManager.js        Star P2C manager: peer Map, SDP/ICE kuyruğu, control/world kanalları
src/gamepad.js              Telefon kumandası: world canvas + overlay kontroller, koltuk, skor,
                            ready, dokunmatik girdi, cooldown radyali, kill-feed, tam ekran sonuç
src/controllers/
  controllerTemplates.js    Deklaratif kumanda şablonları (JOYSTICK_ACTION, TWIN_STICK_ACTION,
                            ARCADE_DRIVE, STEER_ACTION, SLIDER_1D + semantic layout hedefleri)
  gamepadInputAdapter.js    50ms analog throttle + dead-zone sınırı (transport bağımsız)
  physicalGamepadAdapter.js Browser Gamepad API polling; touch/keyboard öncelikli ikincil kaynak
  gamepadShell.js           Stabil kumanda shell/presenter markup'ı; HUD şeridi + sonuç kabı
  gamepadSchemas.js         15 oyun için deklaratif kumanda şemaları + canlı sync hook'ları
  controlDefs.js            Merkezi kontrol sözleşmesi: sol + sağ-max-2 + landscape-first + nötr paket
  controllerStatus.js       Üst durum şeridi metinleri (15 oyun tek kayıt)
  controllerGuide.js        CONTROL_DEFS + schema'dan türetilen kontrol rehberi (pause paneli kullanır)
src/gamepad.css             Kumanda stilleri (mobil ergonomi + control-deck saydamlık token'ları)
src/ui/gamepadWorldView.js  Client world canvas: DPR, 3-8 jitter buffer, 60 Hz+ rAF, seq/stale
src/ui/worldViewKit.js      World-view kromu (banner/placeholder/stale + fitWorld)
src/ui/resultPanel.js       Sonuç paneli primitifleri: drawResultPanel / dimBehindPanel /
                            resultPanelRadius / uiTextScale (tur bandı, final kartı, kumanda ortak)
src/ui/{snake,pong,race,crown,archer,bomb,heist,tanks,clone,ninja,laser,zone,collapse,curve,horde}WorldView.js
                            Client-only renderer'lar; simülasyon/fizik çalıştırmaz
src/style.css               Modüler stil orkestratörü (@import). SIRA: tokens → scene →
                            home/room/games → sheets (son, override katmanı)
src/styles/                 tokens.css (TEK renk sözlüğü + field kapsamı + global sıfırlamalar),
                            base, hud (oyun içi kaplamalar), modals, lobby, shell, scene (SAHNE ORTAK
                            DİLİ + .scene-btn), home (konum), room (konum + lobi yerleşimi), games,
                            profile, sheets, reactions, notices, animations
                            (menu.css/menuManager.js silindi — bento sayfa yok)
src/controlGuide.js         Oyun-içi kontrol helper overlay'i
src/touchManager.js         Dokunmatik giriş yöneticisi (TV / masa-ortası lokal)
src/i18n.js                 UI metin motoru (t(), dil, olaylar); src/locales/ tr.js, en.js
src/types/game.d.ts         Ortak tipler (PlayerSlot, Cartridge, EngineContract)
src/types/minigame.d.ts     Motor sözleşmesinin TİP hâli: MiniGameEngine/MiniGameArena/
                            MiniGameEntity/MiniGameControlCorner + KeyboardEvent/Window augment.
                            Global bildirim (runtime değer yok); yeni motor alanı önce buraya.
src/types/geometry.d.ts     Paylaşılan geometri/ölçüm tipleri: FieldGeometry/FieldPalette/
                            QualityMeasurement/WorldFrame + HTMLCanvasElement __fieldRole.
src/audio.js                Synthesizer / Web Audio ses efektleri

src/core/
  BaseGame.js               BaseMiniGame ortak ata: state, skor, trauma, slotTypes, klavye,
                            dokunmatik, remote joystick, viewport; Evrensel Masa-ortası Katmanı
                            (getTabletopSchema, getTabletopControlCorners, handleTabletopTouch*,
                            onSlotSteer/handleSlotAction, resetTabletopTouches — 15 oyun merkezi
                            katmana bağlı). Çizim gövdesi burada değil: renderControls/renderHUD/
                            renderStandard* ince delegasyondur (bkz. tabletopRenderer.js)
  tabletopRenderer.js       Masa-ortası çizimin tek sahibi: createTabletopRenderer(game) →
                            renderControls, renderStandardJoysticks/Scoreboard/RoundBanner/
                            MatchOver/Lobby, renderHUD. Motor alanlarını (arena, uiButtons,
                            matchOverCard) ve metotlarını game üzerinden okur; ready-pulse gibi
                            sunum durumu burada yaşar
  tabletopIcons.js          Lucide vektör ikon kütüphanesi (drawTabletopIcon + getTabletopIconSvg)
  engineRegistry.js         GAME_ORDER (aktif önce, retired sonra), CARTRIDGES (15 kartuş),
                            ensureEngine/preloadEngine (modül ısıtır, örnek kurmaz),
                            registerEngine/getEngine/forEachEngine,
                            releaseEngine/releaseAllExcept (Faz 4.5 tek-koltuk: mod değişiminde
                            aktif olmayan örnekler BaseGame.destroy() ile yıkılır),
                            isEngineWarm (soğuk-modül toast kapısı), getLoadedModes (teşhis)
  botView.js                AI ateşduvarı: createReadOnlyView — derin salt-okunur Proxy
                            (set/delete/mutate-yasak, metotlar raw this ile çalışır);
                            15/15 AI girişinde game sarmalanır, yazım yalnız bot varlığına
  slotManager.js            Koltuk yönetimi: hostPlayerSlots, syncSlotsToEngine, swapEngineSlots,
                            getColorClashIndices (sert renk engeli), clearRemoteSlot (kopan nötral)
  slotRules.js              Saf koltuk taşıma kuralları (hedef/kaynak, bot, host, kilit)
  safeStorage.js            localStorage sarmalayıcısı
  preferences.js            Versiyonlu cihaz tercihleri (+ controllerLayout v2 profili, v1→v2 migration)
  controllerLayout.js       Saf cihaz-geneli kontrol yerleşimi (normalize, safe-frame, 44px)
  haptics.js                Tek haptik preference gate
  reactions.js              Tepki seti TEK kaynağı: REACTIONS + normalizeReactionKey (wire = ikon anahtarı)
  inputSource.js            keyboard/touch/pointer arbitration; kanal bazlı bypass
  controlDescriptor.js      phone/tabletop/network normalize kontrol sözleşmesi + parity
  inputIntent.js            Transport action → canonical engine intent projeksiyonu
  aimInput.js               Canonical aim state: held/active/vector/sequence + stale guard
  autoAim.js                Tap auto-aim hedef seçimi (menzil motordan göreli gelir)
  fireFeedback.js          ARCHER/HORDE/LASER cooldown + blocked/ready/shot state
  fireFeedbackEffects.js    blocked efektleri episode başına bir kez
  inputRouter.js            Local/network input → aktif engine; adapter'lar lookup bilmez
  networkProtocol.js        Ortak ONLINE/TV_CONSOLE input doğrulama
  worldInterpolation.js     Snapshot sunum interpolasyonu (stable-id blend, no-extrapolation)
  inputMaps.js              Tek klavye slot haritası: getSlotKeys, keyboardVectorFrom, readSlotKeys,
                            isSlotActionEvent, slotForActionCode, buildCodeToSlotMap, getKeyLabel
  customizationManager.js   Cihaz-başı TEK profil; sanitizeAvatar/pickFreeColor; avatar kayıt defteri
  touchFlow.js              Tek dokunmatik akış: getQuadrant, roundOverSkipGuard, lobbyCenterStartTap,
                            lobbyQuadrantTap, matchOverRestartTap (istisna: tanks getCornerZone, PONG zonal)
  physics2d.js              clampToArena, resolveAABB, pointBlocked, firstFreeDirection (engel taraması),
                            updateMovers, distToSegmentSquared,
                            segmentCircle/segmentAabbIntersection, getProjectileSubsteps, damp, normalizeAngle
  playfield.js              SAHA GEOMETRİSİNİN TEK KAYNAĞI: computePlayfield(w,h,preset) + FIELD_PRESETS
                            (standard/roomy/crown/flat/dense/racing) + FIELD_TIERS (normal 28-36 /
                            open 18-24 / far 9-16 tasarım yarıçapı) + fieldPx/fieldRadius/fieldSpeed +
                            isCompactLandscape. arena.unit saha içi ölçeğin otoritesidir; motor resize'ın
                            içinde kenarlık hesabı yazmaz, canvas.width/height okumaz/yazmaz
  roundLifecycle.js         Ortak raunt/maç terminal kuralı (timeout, all-survivor, MATCH_OVER)
  pickupSystem.js           power-up akışı: spawnPickup/collectPickups/tickPickupTimers + EFFECTS kaydı
  arenaKit.js               Ortak arena görsel kiti: buildLayout(name, arena, {minPassage}) düzen
                            presets (pillars/columns4/cross/crossfire/scatter/bunker/courtyard/split) +
                            drawObstacle + obstacleStyle (variant→theme.block→stone) + OBSTACLE_STYLES
                            (9 deri) + obstacleMass + PICKUP_META/drawPickup. Passage minPassage'ten
                            türer (kollardan değil); render yolunda tahsis yok (clip + tek dolgu)
  fieldKit.js               SAHA ZEMİNİ/ÇEVRESİ TEK KAYNAĞI: FIELD_THEMES + THEME_FIELDS + FIELD_MOTIFS,
                            hashFieldSeed, paintFieldLayer, drawField (offscreen bake + cache + blit,
                            arena kutusu 2px kuantlama), paintBackdrop (saha dışının tek sahibi),
                            releaseFieldLayers. Ağa alan eklemez; deterministiktir (seed = hash(mode,roundId))
  playerEntity.js           createPlayer, tickEffectTimers, advancePlayer
  avatarInGame.js           drawGameAvatar, normalizeExpression, blinkState — saha içi daima
                            faceMode:'play' (ERIŞUAR/DESEN YOK, tam yuvarlak siluet)
  qualityGate.js            Kalite kapısı sözleşmesi: 7 kapı (I1-I7) + 4 rapor (I8-I11) + TUNING_ANCHOR
                            + evaluateGame; tests `npm run health` ile 15 oyunu doğrular
  qualityAuditors.js        I4/I5/I6 kapıları için saf denetleyiciler + fail-closed

src/ui/
  appShell.js               Kabuğun TEK sahibi: view yığını, geri/Escape, rotate gate, girdi sahipliği,
                            chrome (cinema/none), rail (üç yüzen buton), revealView/closeView/goHome
  overlayHost.js            Açık diyalogların TEK sahibi (openOverlay/closeOverlay, odak tuzağı)
  focusRouter.js            Konsol odak gezgini (roving tabindex, 2B en-yakın, [data-h-track])
  views/registry.js         Görünüm kayıt defteri: registerView(id, {title, rail, chrome, build, onExit})
  views/{home,room,games,lobby,profile}View.js
                            Sahne görünümleri (lobby .tv-host-card'ı devralır; görünüm = dosya + registerView)
  heroAvatar.js             Ana menü canlı karakteri (rAF görünürlük kapısı)
  playerNameField.js        Ortak isim alanı bileşeni
  iconSlots.js              [data-icon] yuvalarını Lucide SVG ile doldurma
  reactionLayer.js          Tepki BALONU (lobi + oyun içi + kumanda tek uygulama, data-reaction-anchor)
  reactionPicker.js         Tepki SEÇİCİ (data-reaction-open + data-reaction-send="host|pad")
  tabStrip.js               MERKEZİ sekme şeridi (OYUNLAR kategorileri + KARAKTER editörü)
  canvasUI.js               Ortak canvas UI: renderLobbySeatCard, renderLobbyStartButton,
                            renderStandardLobbySeats, renderMatchOver, renderRoundBanner,
                            renderControlGuide, renderCornerScores, renderArenaWatermarkTimer
  customizeModal.js         İKİ YOLLU avatar atölyesi (RENK/YÜZ/HALKA; TV lobisi + kumanda yolu)
  characterRenderer.js      Birleşik avatar çizimi (yazısız pip kimliği; text-label yasak)
  avatarStage.js            Avatar sahne çizimi (yarıçapa orantılı)
  hostLobby.js              TV/ONLINE bekleme lobisi (QR, oda kodu, oyun çipleri, koltuk editörü)
  joinModal.js              Kumanda katılım modalı & kod kutusu
  pauseModal.js             Duraklatma menüsü (koltuk takası, döndürme, kontrol referansı, gömülü `quick` ayar satırları)
  toast.js                  PWA kurulum istemi + bağlantı bandı (data-install-app)
  settings/                 AYARLARIN TEK YÜZEYİ — ana menü, lobi ve pause bunu açar
    settingsActions.js        Her ayarın oku/yaz/uygula kaydı (ses, haptik, bot, renk körü, tam ekran, dil, kontrol düzeni, PONG, kumanda editörü, güncelleme, sürüm, kayıt) + `bindSettingsHooks` (main.js bağlar)
    settingsSchema.js         Sekmeler (GENEL/KONTROL/SİSTEM) + satır tanımları (`type`, `quick`, `dynamicLabel`) — yeni ayar yalnız buraya yazılır
    settingsRow.js            Satır DOM'u: switch / choice / slider / static / action; görünürlük `available()`dan
    settingsPanel.js          Sekme şeridi + gövde (`createSettingsPanel`) ve pause'a gömülü `createQuickSettingsPanel`
    settingsSheet.js          Overlay kabuğu: `initSettingsSheet` / `openSettingsSheet({tab})` / `closeSettingsSheet`
  controllerLayoutEditor.js Cihaz-geneli kumanda düzen editörü (canlı önizleme, save/reset)
  fullscreen.js             Tam ekran istek/yönetim

src/ai/                     Otomatik bot zekâları (dosya adı = oyun): bombAI, curveAI, heistAI,
                            tankAI, crownAI, pongAI, zoneAI, archerAI, snakeAI, laserAI, hordeAI,
                            cloneAI, collapseAI, ninjaAI, raceAI

src/games/ (Oyun Motorları — BaseMiniGame türevleri):
  game.js / paddle.js / ball.js        PONG motoru
  tanks.js / tanksView.js              Micro-Tanks
  curve.js / curveView.js              Brutal Curve
  bomb.js / bombView.js                Brutal Bomb
  heist.js / heistView.js              Brutal Heist
  archer.js / archerView.js            Brutal Archery
  zone.js / zoneView.js                Brutal Zone (64x64 RLE)
  snake.js / snakeView.js              Brutal Snake
  laser.js / laserView.js              Brutal Laser
  horde.js / hordeConfig.js / hordeView.js  Brutal Horde
  collapse.js / collapseView.js        Brutal Collapse (13x13)
  crown.js / crownView.js              Brutal Crown (arşivden çıkarıldı)
  ninja.js / ninjaView.js              Brutal Ninja
  race.js / raceView.js / raceLogic.js Brutal Race
  worldCore.js             Generic world-view snapshot çekirdeği (createWorldSnapshot + isValidWorldBase
                           + packers + drawSquareParticles) — yeni world-view oyunu deklaratif `extras`
                           kaydına iner
  Her oyun: [oyun]View.js = ortak snapshot serializer + host/client çizim; [oyun]WorldView.js = client
                           renderer. *View çift yönlü ölçeklemez — uzamsal ölçek host'ta bir kez yapılır

src/games-retired/          Oynanabilir legacy motorlar (UI'de aktiflerden sonra)

server/
  index.js                  Lokal WS bağımsız sunucu başlatıcı
  roomManager.js            Lokal WS oda yöneticisi (slot, bot, isim, takas, tepki whitellist)
  vitePluginWs.js           Vite dev sunucusuna entegre WS + rol kapısı (HOST_ONLY_MSG)

public/                     PWA (manifest.webmanifest, sw.js, ikonlar) + public/assets/games/*.webp
tests/                      Node test runner: protokol, WebRTC, world snapshot, renderer, kontrol
                            rehberi, kısıt taramaları (pxConstants/fieldKit/movementBudget), health
tests-e2e/                  Playwright (npm run test:e2e): engine-smoke.spec.js — tüm GAME_ORDER
                            motorlarını registry'den yükleyip LOBBY→PLAYING 240 kare sürer;
                            visual-baseline.spec.js — seeded PRNG + donmuş saatle motor başına
                            kare-60 canvas ekran tabanı (*.js-snapshots/, --update-snapshots)
tests/relayProbes.test.mjs  §11'in 3 provasının protokol karşılığı: hazır→lobi sıfırlama,
                            takas isim senkronu, bot görünürlüğü — gerçek WS sunucusu üzerinde
playwright.config.mjs       e2e yapılandırması (vite:3100 webServer, chromium headless)
scripts/typecheck.mjs       tsc --checkJs ratchet'i: --stats dosya tablosu, --max (taban:
                            scripts/typecheck-baseline.txt, şu an 0) — `npm run typecheck`
scripts/rules-lint.mjs      AGENTS.md K1–K6 makine bekçisi (mode=== dalı, ham renk, canvas
                            DPR, cartridge bütünlüğü, emoji, PROJECT_MAP tazeliği); borç
                            tabanı scripts/rules-lint-baseline.json — `npm run check:rules`
```

---

## 2. Motor Tablosu

| Kod | Mod adı | Motor dosyası | Bot | Kumanda | Not |
|-----|---------|---------------|-----|---------|-----|
| PONG | Brutal Pong | `src/games/game.js` | Paddle içinde | `mountPongController` | Kendi skorbord; kale %62 + 45° pah; ❄️ dondurma; 120sn limit; 30 Hz world-view |
| TANKS | Micro-Tanks | `src/games/tanks.js` | `tankAI` | `mountTanksController` | Gaz+ateş; 2 chamber + triple pickup; 35sn sudden-death; 30 Hz world-view |
| CURVE | Brutal Curve | `src/games/curve.js` | `curveAI` | `mountCurveController` | NITRO akışı; 24×24 owner+gap maskesi; 30 Hz world-view |
| BOMB | Brutal Bomb | `src/games/bomb.js` | `bombAI` | `mountBombController` | Patlama `blast` katmanı; 90sn draw; 30 Hz world-view |
| HEIST | Brutal Heist | `src/games/heist.js` | `heistAI` | `mountHeistController` | 45sn raunt; bounded draw; 30 Hz world-view |
| ARCHER | Brutal Archery | `src/games/archer.js` | `archerAI` | `TWIN_STICK_ACTION` | Basılı yay + bırakışta ok; 3 harita; power-up'lar; mesafe ölçekli stun; 30 Hz world-view |
| CROWN | Brutal Crown | `src/games/crown.js` | `crownAI` | `mountCrownController` | **Arşivden çıkarıldı**; taç tutma; pinball bumper; 30 Hz world-view |
| ZONE | Brutal Zone | `src/games/zone.js` | `zoneAI` | `mountZoneController` | 64×64 grid kapma; %40 early win; RLE; 30 Hz world-view |
| SNAKE | Brutal Snake | `src/games/snake.js` | `snakeAI` | `mountSnakeController` | Yemle büyü; hold-boost; 30 Hz world-view |
| LASER | Brutal Laser | `src/games/laser.js` | `laserAI` | `mountLaserController` | Twin-stick aim; 3 can + dash i-frame; 90sn/10 kill; 30 Hz world-view |
| CLONE | Brutal Clone | `src/games/clone.js` | `cloneAI` | `mountCloneController` | 2 gecikmeli kopya; 30 Hz world-view |
| COLLAPSE | Brutal Collapse | `src/games/collapse.js` | `collapseAI` | `mountCollapseController` | 13×13 çöken ızgara; 60sn; 30 Hz world-view |
| NINJA | Brutal Ninja | `src/games/ninja.js` | `ninjaAI` | `mountNinjaController` | Görünmezlik; selfSlot hayalet; 30 Hz world-view |
| HORDE | Brutal Horde | `src/games/horde.js` | `hordeAI` | `TWIN_STICK_ACTION` | 1-4P takım savunması; 3 tur × 3 dalga; armory; 3 harita; elite+boss; 30 Hz world-view |
| RACE | Brutal Race | `src/games/race.js` | `raceAI` | `JOYSTICK_ACTION` | 3 checkpoint/3 tur; dark/jump/nitro/draft/EMP; 30 Hz world-view |

---

## 3. Ağ & İletişim Protokolü

İki transport: **Lokal/dev** `src/network.js` (WS) · **Canlı/online** `src/supabaseRelay.js` (Supabase keşif + WebRTC). ONLINE host = P1 oyuncusu; uzak oyuncular P2-P4. TV host varsayılan koltukta değildir, istenirse P1 olur. Relay `players[]` tek koltuk kaynağıdır.

Her WebRTC peer'ında iki DataChannel:
- `control` (`ordered:true`): girdi, hazır, koltuk, 8 Hz HUD/state. WebRTC yoksa Supabase fallback.
- `world` (`ordered:false, maxRetransmits:0`): yalnız ONLINE world-view oyunlarında 30 Hz tam snapshot; client `seq` ile eski/geç kareyi atar. TV_CONSOLE'da kapalı.

Ortak doğrulama `networkProtocol.js`. **Uçtan uca:** oda kur (3 haneli kod) → keşif (kod + role) → `JOIN_SUCCESS` (worldView + reservedHostSlot) → signaling (offer/answer + kuyruklu ICE) → oyun trafiği P2P `control`+`world` → Supabase devre dışı. Kayıp paket: `world` kareleri bağımsız, düzeltme gerekmez; kritik olaylar `control`'dan anında.

### player_msg (uzak telefon → host):
- `INPUT`: joystick `(x,y)` / buton (`FIRE`, `DASH`, `TACKLE`, `HORDE_FIRE/RELEASE`). 50ms throttle; aksiyon throttlesız.
- `AVATAR_UPDATE` (INPUT tüneli): kendi karakteri `{color, expression}`; host sanitize eder.
- `JOIN_ROOM`/`JOIN`, `SWITCH_SLOT`, `PLAYER_READY`, `SET_NAME`, `REACTION`, `PING`.

### host_msg (host → uzak telefon):
- `HOST_STATE_SYNC`/`GAME_STATE` (8 Hz, dirty-check), `WORLD_FRAME` (30 Hz P2P).
- `SLOTS_UPDATE` (WS+Supabase aynı şema), `JOIN_SUCCESS`, `SLOT_CHANGED`, `SLOTS_SWAPPED`.
- `SET_SLOT_COLOR`, `SET_HOST_PLAYER` (host-only), `STAGING_STARTED`/`COUNTDOWN`/`GAME_STARTED`,
  `RETURNED_TO_LOBBY`, `PLAYER_REACTION` (çift yönlü, `slotIndex:-1` = host koltukta değil).

---

## 4. Slot Modeli Kuralları

- Host: `hostPlayerSlots[i] = { name, isReady, kind, avatar, displayColor }`. Relay snapshot tek gerçektir; çakışırsa relay kazanır.
- **Sert renk engeli:** iki insan koltuğu aynı display rengindeyse staging+sayaç kilitlenir. LOCAL muaf.
- **Bot:** hedef/kaynak olamaz; sayaçta koltuklar kilitli (`seatsLocked`); ekleme varsayılan kapalı.
- **Ready-reset:** `GAME_STARTED` + `RETURNED_TO_LOBBY`'de `isReady` iki tarafta da sıfırlanır.

---

## 5. Mimari Kararlar (özet)

1. **Host tek yetkili** — TV host / ONLINE P1; uzak telefon yalnız girdi.
2. **Engine registry** — `else if (mode===...)` zinciri yasak; tüm oyunlar registry + polimorfik çağrı.
3. **BaseMiniGame ortak taban** — trauma/skor/tap ortak işletilir.
4. **Kumanda ergonomisi** — yatay: alt-orta kuşak + köşeler; sözleşme `controlDefs.js` (sol + sağ-max-2).
5. **Oda kodu** 3 haneli sayı (100–999).
6. **Lokal=kumanda eşitliği** — her motor tek cihazda tam oynanır (lobi / 4 klavye / 4 joystick).
7. **Tek tip lobi koltuğu** — `canvasUI.renderLobbySeatCard` + start butonu; PONG kenar-orta istisna.
8. **Arayüz sistemi** — token → helper → a11y; `getDisplayProfile` yalnız UI ölçeği, saha ölçeği `arena.unit`.
9. **Girdi sertleştirme** — analoglar tek noktada 50ms kısılır; kopan kumanda nötral + koltuk tutar;
   WS kopma simetriği (30s watchdog + auto-rejoin); oyun kodunda dispatch `if/else` zincirsiz.
10. **Kontrol eşleşmesi** — telefon↔motor, klavye her motorda; basılı yön 250ms keepalive; `bp_control_surface`.
11-15. **Faz A-E (tarama raporları)** — çökme + kritik mantık, güvenlik/validasyon, oda yarışları,
    performans (CURVE ızgarası, bake, chunk, SW), UX/a11y. Gerekçeler kod yorumlarında + testlerdedir.
16. **Cihaz-başı karakter + yazısız kimlik** — avatar = renk + yüz (+ rim); saha içi yazı/text-label yok;
    renk oyuncuya aittir (takas taşır); LOCAL koltuk-başı renk.
17. **Ortak arena/fizik/power-up kiti** — `src/core/` (Faz 3-7). Detay §1 (playfield/arenaKit/physics2d/…).
18. **Saha ölçeği tek kaynağı** — `playfield.js`; kompakt yatay dikey pay daralır; `unit` otorite;
    `minFraction` şişme yerine mutlak px taban + tek çarpan; gözle taban seçimi yok.
    Harita-ölçeği hissi gövde/saha oranıdır: `FIELD_TIERS` üç katman — `normal` (BOMB/HEIST/CROWN/
    ARCHER/TANKS/ZONE/NINJA/COLLAPSE/LASER/HORDE), `open` (RACE/SNAKE/CURVE), `far` (CLONE);
    ölçülen tasarım yarıçapı bant kilidine tabi (`movementBudget.test.mjs §B`), PONG hariç.
19. **İkonografi** — Lucide neo-brutalist; tek kaynak `tabletopIcons.js`; butonlarda metin başlığı yok.
20. **Online world-view** — generic çekirdek `worldCore.js` + `[oyun]View` + client renderer; 30 Hz;
    oyun başına deklaratif `extras`. Client simülasyon/AI import etmez.
21. **Kontrol rehberi** — `controllerGuide.js` tek projeksiyon; oyun-başına HTML kopyası yok.
22. **Cihaz bağlamı+tercih** — `preferences.js` versioned; otomatik yüzey seçimi.
23. **Ergonomi/dayanıklılık** — Pointer Events + capture; 44px; `inputSource` kaynak kilidi.
24. **Bakım/kontrol sözleşmesi** — `controlDescriptor` parity; `inputIntent` canonical; twin-stick aim lifecycle
    (aim zone, `.action-cluster-stack`/buton kökenli olayı yok sayar → dash'a basmak ateş üretmez).
25. **Cihaz-geneli kontrol yerleşimi** — `controllerLayout.js` saf geometri; editör; mod `if/else` yok.
26. **Cihaz bağımsızlığı kalite kapısı** — `qualityGate.js` + `npm run health`; 16. oyun 0 ihlalle geçmeden eklenmez.
27. **Mobil kabuk** — sabit yatay çerçeve, sayfa akışı yok; `appShell` + `overlayHost` + `focusRouter` + `views/registry`.
28. **Koyu kimlik + krem saha** — token rolleri (`--edge`/`--on-accent`); `data-theme="field"`; token-lint.
29. **Ortak DOM bileşenleri** — `playerNameField`, `iconSlots` (hydrateIconSlots), `getKeyCapLabel`.
30. **Sahne dili** — `scene.css` + `.scene-btn` (is-gold/teal/ghost); aynı işi iki yol yok; `OYNA`→OYUNLAR.
31. **Ölü kod temizliği** — token/selector avı, kalıcı araç eklenmez.
32. **Sahne revizyonu** — geri düğmesi yok; kalıcı gezinme üç yüzen buton; PROFIL düzenleyici; sahne çizgisi `--scene-stage-y`.
33. **Kabuk revizyonu** — üst şerit/bant yok; `tabStrip` ortak; `chrome` semantiği (cinema/none); lobi karusel.
34. **Saha zemini `fieldKit.js`** — offscreen bake + cache + blit; deterministik; paket alanı eklemez.
35. **Ana menü arka planı** — transform ile ortalanan öğe `data-focus` taşıyamaz; sahne çizgisi tek kaynak.
36. **Tepki (emoji) yüzeyi** — viye değer ASCII anahtar, görsel yüzey gerçek emoji (tek istisna); `data-reaction-*`.
37. **Saha görselliği faz 1/2** — L\* bütçesi, `OBSTACLE_STYLES` (9 deri), `minPassage`, tek seferlik gölge sprite.

Doğrulama metotları, piksel ölçümleri ve kullanıcı-geri-bildirim gerekçeleri burada tekrarlanmaz — ilgili test dosyaları, kod yorumları ve git geçmişindedir. Sözleşme etkisi olan kısmı AGENTS.md §4 ve §8'de zaten kurallıdır.

---

## 6. Yeni Oyun Ekleme Adımları (Hızlı Rehber)

1. `src/games/[oyun].js`: `BaseMiniGame` motoru; sözleşme (`resetMatch/startNewMatch/startNewRound/update/render/resize/handleRemoteInput`) + lokal lobi + 4 klavye + `getTabletopSchema` + `handleSlotAction` + `renderControlGuide`.
2. `src/ai/[oyun]AI.js` (+ gerekiyorsa DOM-free `[oyun]Logic.js`).
3. `src/core/engineRegistry.js`: `GAME_ORDER` + tek `CARTRIDGES[MOD]` kaydı. Çekirdeğe zincir eklenmez.
4. `src/core/slotManager.js`: `applySlotDataToEntity`, `clearRemoteSlot`, `swapEngineSlots` desteği.
5. `src/controllers/controlDefs.js` + `gamepadSchemas.js` + `controllerStatus.js`: telefon + tabletop parite.
6. `index.html`: TV lobi çipi (`data-game="[MOD]"`).
7. `src/styles/games.css`: OYUNLAR galeri görünümü (`CARTRIDGES.category`).
8. `public/sw.js`: yeni görsel precache + cache sürümü.
9. `public/assets/games/[oyun].webp`: 1:1 kapak (AGENTS.md §10 formülü).
10. `docs/PROJECT_MAP.md` + `AGENTS.md`: motor/AI/dosya/kontrol kayıtları.
11. `npm test`, `npm run check`, `npm run build`, `npm run health` yeşil olmadan bitmez.

---

## 7. Global Kurallar Katmanı

- `~/.config/opencode/AGENTS.md` — tüm projelerde geçerli temel; çakışırsa **proje dosyası kazanır**.
- Bu depo: `AGENTS.md` (sözleşmeler) + `docs/PROJECT_MAP.md` (harita).
- Antigravity/Claude/Copilot global dosyaları master'dan senkronlanır.
