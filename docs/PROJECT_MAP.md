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
                            ready, dokunmatik girdi, cooldown radyali, kill-feed, LOCAL sonuç
                            modalı (nefes payı + `settings-in`; opak tam ekran değil)
src/controllers/
  controllerTemplates.js    Deklaratif kumanda şablonları (JOYSTICK_ACTION, TWIN_STICK_ACTION,
                            ARCADE_DRIVE, STEER_ACTION, SLIDER_1D + semantic layout hedefleri)
  gamepadInputAdapter.js    40ms analog throttle + dead-zone sınırı (transport bağımsız)
  physicalGamepadAdapter.js Browser Gamepad API polling; touch/keyboard öncelikli ikincil kaynak
  gamepadShell.js           Stabil kumanda shell YERLEŞİMİ (üst çipler `ui/quickChrome.js`ten
                            üretilir); HUD şeridi + sonuç kabı
  gamepadSchemas.js         12 oyun için deklaratif kumanda şemaları + canlı sync hook'ları
  controlDefs.js            Merkezi kontrol sözleşmesi: sol + sağ-max-2 + landscape-first + nötr paket
  controllerStatus.js       Üst durum şeridi metinleri (12 oyun tek kayıt; SKOR YOK — tek skor
                            yüzeyi taç peek + kill-feed; LOCAL'de şeri çizilmez, motor HUD'u yetkili)
  controllerGuide.js        CONTROL_DEFS + schema'dan türetilen kontrol rehberi (pause paneli kullanır)
src/gamepad.css             Kumanda stilleri (mobil ergonomi + control-deck saydamlık token'ları)
src/ui/gamepadWorldView.js  Client world canvas: DPR, 3-8 jitter buffer, 60 Hz+ rAF, seq/stale,
                             self-avatar prediction (`selfPredict` bayraklı world-view'de).
                            Oynatma saati YUMUŞATILMIŞ ofsetten hizalanır (`alignSourceClock`):
                            ham ofset her karede zaman çizelgesini kaydırıp dünyayı titretiyordu
src/ui/perfOverlay.js       Debug performans HUD'u (yalnız `?perf`/`bp.perf=1`); perfMonitor okur
src/ui/worldViewKit.js      World-view kromu (raunt bandı `drawWorldRoundBanner` = host
                            `renderRoundBanner`; `drawWorldMatchOver` = host final kartı;
                            placeholder/stale + fitWorld)
src/ui/resultPanel.js       Sonuç paneli primitifleri: drawResultPanel / dimBehindPanel /
                            resultPanelRadius / uiTextScale (tur bandı, final kartı, kumanda ortak)
src/ui/{snake,pong,crown,archer,bomb,heist,tanks,ninja,zone,collapse,curve,horde,colossus}WorldView.js
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
src/audio.js                Synthesizer + sample-first facade (Kenney ogg varsa onu çalar,
                            yoksa synth; API aynı — `core/soundEngine` + `core/soundBank`)

src/core/
  BaseGame.js               BaseMiniGame ortak ata: state, skor, trauma, slotTypes, klavye,
                            dokunmatik, remote joystick, viewport; Evrensel Masa-ortası Katmanı
                            (getTabletopSchema, getTabletopControlCorners, handleTabletopTouch*,
                            onSlotSteer/handleSlotAction, resetTabletopTouches — 12 oyun merkezi
                            katmana bağlı). Çizim gövdesi burada değil: renderControls/renderHUD/
                            renderStandard* ince delegasyondur (bkz. tabletopRenderer.js)
  tabletopRenderer.js       Masa-ortası çizimin tek sahibi: createTabletopRenderer(game) →
                            renderControls, renderStandardJoysticks/Scoreboard/RoundBanner/
                            MatchOver/Lobby, renderHUD. Motor alanlarını (arena, uiButtons,
                            matchOverCard) ve metotlarını game üzerinden okur; ready-pulse gibi
                            sunum durumu burada yaşar
  tabletopIcons.js          Lucide vektör ikon kütüphanesi (drawTabletopIcon + getTabletopIconSvg)
  engineRegistry.js         GAME_ORDER (aktif önce, retired sonra), CARTRIDGES (12 kartuş),
                            ensureEngine/preloadEngine (modül ısıtır, örnek kurmaz),
                            registerEngine/getEngine/forEachEngine,
                            releaseEngine/releaseAllExcept (Faz 4.5 tek-koltuk: mod değişiminde
                            aktif olmayan örnekler BaseGame.destroy() ile yıkılır),
                            isEngineWarm (soğuk-modül toast kapısı), getLoadedModes (teşhis)
  botView.js                AI ateşduvarı: createReadOnlyView — derin salt-okunur Proxy
                            (set/delete/mutate-yasak, metotlar raw this ile çalışır);
                            12/12 AI girişinde game sarmalanır, yazım yalnız bot varlığına
  slotManager.js            Koltuk yönetimi: hostPlayerSlots, syncSlotsToEngine, swapEngineSlots,
                            getColorClashIndices (sert renk engeli), clearRemoteSlot (kopan nötral)
  slotRules.js              Saf koltuk taşıma kuralları (hedef/kaynak, bot, host, kilit)
  safeStorage.js            localStorage sarmalayıcısı
  preferences.js            Versiyonlu cihaz tercihleri (+ controllerLayout v2 profili, v1→v2 migration)
  controllerLayout.js       Saf cihaz-geneli kontrol yerleşimi (normalize, safe-frame, 44px)
  haptics.js                Tek haptik preference gate
  soundBank.js              Küratörlü Kenney örnek bankası TEK KAYNAĞI (SOUND_BANK +
                            SYNTH_TO_SAMPLE + PRELOAD_IDS; ~40 dosya, apostrof yok)
  soundEngine.js            Örnek oynatıcı: tek AudioContext, 4 bus (sfx/ui/voice/music),
                            buffer cache + throttle + polifoni + autoplay unlock
  fxKit.js                  FX OLAY SÖZLEŞMESİ TEK KAYNAĞI (MOTION_PLAN): kapalı FX_KIND kümesi +
                            FX_PROFILES bütçe tablosu (burst/ring/trauma/hit-stop/flaş, tasarım px),
                            havuz kapları, hit-stop zaman ölçeği (advanceHitStop), haptik desen tablosu
  fxRuntime.js              Motor eşlikçisi: olayı partikül+halka+pop+flaş+hit-stop'a çevirir;
                            travmayı traumaSink ile BaseGame'e devreder (sarsıntı sahibi motor kalır);
                            `update(dt)` içinden tick — simülasyon saati DURMAZ (sunum zamanı)
  reactions.js              Tepki seti TEK kaynağı: REACTIONS + normalizeReactionKey (wire = ikon anahtarı)
  botBanter.js              Bot tepki KARARI (saf, DOM/ağ yok): BOT_BANTER_EVENTS + yüz→kişilik
                            tablosu + pickBotReaction (yalnız reactions.js beyaz liste anahtarı)
  botReactionDirector.js    Host durum-farkı yönetmeni: state/roundWinner/matchWinner/matchResult/
                            scores[] geçişini okur, bot koltuğu adına tepki üretir (cooldown +
                            sunucu 1 Hz bütçesi); motor/AI dosyalarına dokunmaz
  inputSource.js            keyboard/touch/pointer arbitration; kanal bazlı bypass
  controlDescriptor.js      phone/tabletop/network normalize kontrol sözleşmesi + parity
  inputIntent.js            Transport action → canonical engine intent projeksiyonu
  aimInput.js               Canonical aim state: held/active/vector/sequence + stale guard
  autoAim.js                Tap auto-aim hedef seçimi (menzil motordan göreli gelir);
                            yönsüz basılı tutma = basılı tap (BaseGame.getPlainAimHold):
                            HORDE tam otomatik; ARCHER'da tutma YALNIZ nişan/yay
                            germe — ateş tap veya sürükleyip bırakma ile (2026-09-30)
  fireFeedback.js          ARCHER/HORDE cooldown + blocked/ready/shot state
  fireFeedbackEffects.js    blocked efektleri episode başına bir kez
  inputRouter.js            Local/network input → aktif engine; adapter'lar lookup bilmez
  networkProtocol.js        Ortak ONLINE/TV_CONSOLE input doğrulama + oda kodu sözleşmesi
                            (generateRoomCode/normalizeRoomCode/isValidRoomCode) +
                            `normalizeStateSync` — 8 Hz STATE_SYNC zarfının TEK
                            düzleştirme kapısı (her iki istemci + sunucu çağırır)
  worldInterpolation.js     Snapshot sunum interpolasyonu (stable-id blend, no-extrapolation).
                            `walls` iki biçimde gider (hareketli duvar nesne · SNAKE paketlenmiş
                            dizi): blend eleman ŞEKLİNE bakar, diziyi nesneye yaymaz —
                            view'lar paketi dizi deseniyle açtığı için yayımak
                            `TypeError` demekti (client titreme/beyaz ekran)
  selfPrediction.js         Sunum-only self-avatar prediction: yön canlı yerel girdiden, hız
                            gözlenen snapshot'tan; yalnız `selfPredict` bayraklı pakette çalışır.
                            `selfPredictionHorizon` ufku playout boşluğuyla sınırlar — gecikme
                            ikinci kez eklenirse avatar host simülasyonunun ilerisine çizilir
  perfMonitor.js            Tek kaynak performans defteri (host kare döngüsü + client world
                            sunumu); yalnız `?perf` HUD'u okur, oyun durumu üretmez
  inputMaps.js              Tek klavye slot haritası: getSlotKeys, keyboardVectorFrom, readSlotKeys,
                            isSlotActionEvent, slotForActionCode, buildCodeToSlotMap, getKeyLabel
  customizationManager.js   Cihaz-başı TEK profil; sanitizeAvatar/pickFreeColor; avatar kayıt defteri
  touchFlow.js              Tek dokunmatik akış: getQuadrant, roundOverSkipGuard, lobbyCenterStartTap,
                            lobbyQuadrantTap, matchOverRestartTap (istisna: tanks getCornerZone, PONG zonal)
  physics2d.js              clampToArena, resolveAABB, pointBlocked, firstFreeDirection (engel taraması),
                            updateMovers, distToSegmentSquared,
                            segmentCircle/segmentAabbIntersection, getProjectileSubsteps, damp, normalizeAngle
  playfield.js              SAHA GEOMETRİSİNİN TEK KAYNAĞI: computePlayfield(w,h,preset) + FIELD_PRESETS
                            (standard/roomy/crown/flat/dense) + FIELD_TIERS (normal 28-36 /
                            open 18-24 / far 9-16 tasarım yarıçapı) + fieldPx/fieldRadius/fieldSpeed +
                            isCompactLandscape. arena.unit saha içi ölçeğin otoritesidir; motor resize'ın
                            içinde kenarlık hesabı yazmaz, canvas.width/height okumaz/yazmaz
  roundLifecycle.js         Raunt/maç akışının TEK sahibi: `ROUND_GAP` tempo tablosu
                            (WIN 2.6 / DRAW 1.6 / MATCH_END 2.6 — oyun başına değer
                            YOK), `beginRound`/`beginDrawRound`/`endMatch` üreticileri,
                            `tickRoundFlow` TEK geçiş bloğu, `setRoundTimer`/`roundTimerField`
                            alan çözümü (PONG `roundOverTimer`, geri kalanı
                            `roundTransitionTimer`), `roundGapSeconds` 8 Hz `roundGap` kaynağı.
                            Motor `update()` yalnız `if (tickRoundFlow(this, dt)) return;`
                            yazar; sayacı kendi indirmez. Kilit: tests/roundLifecycle.test.mjs
  pickupSystem.js           power-up akışı: spawnPickup/collectPickups/tickPickupTimers + EFFECTS kaydı
  arenaKit.js               Ortak arena görsel kiti: buildLayout(name, arena, {minPassage}) düzen
                            presets (pillars/columns4/cross/crossfire/scatter/bunker/courtyard/split) +
                            drawObstacle + obstacleStyle (variant→theme.block→stone) + OBSTACLE_STYLES
                            (9 deri) + obstacleMass + PICKUP_META/drawPickup. Passage minPassage'ten
                            türer (kollardan değil); render yolunda tahsis yok (clip + tek dolgu)
  fieldKit.js               SAHA ZEMİNİ/ÇEVRESİ TEK KAYNAĞI: FIELD_THEMES + THEME_FIELDS + FIELD_MOTIFS,
                            hashFieldSeed, paintFieldLayer, drawField (offscreen bake + cache + blit,
                            arena kutusu 2px kuantlama), paintBackdrop (saha dışının tek sahibi),
                            releaseFieldLayers. Ağa alan eklemez; deterministiktir (seed = hash(mode,roundId)).
                             Çizim SONRASI drawFieldDecals + drawFieldReactive +
                              drawFieldLights'i çağırır
                             (statik bake üstü, varlık altı katmanlar)
  fieldReactive.js          REAKTİF SAHA KENARI (ARENA_ELEVATION_PLAN Faz 1): emitWallImpact →
                             duvar esnemesi + enerji dalgası + toz/kıvılcım; drawFieldReactive
                             (fieldKit.drawField içinden, varlıkların altında); clearFieldReactive.
                             Sabit havuzlar + saat damgası (update çağrısı yok), paket alanı YOK.
                             Tek üretici physics2d.clampToArena; 12 motorun hiçbiri kendi
                             koduyla dokunmaz
  fieldDecals.js            ZEMİN ÇATIŞMA İZLERİ (ARENA_ELEVATION_PLAN Faz 2): emitFxScar →
                             is (kill) / sıçrama (hit,slay) / patinaj (dust); drawFieldDecals
                             (fieldKit.drawField içinden, bake üstü + varlık altı); clearFieldDecals.
                             32 yuvalı HALKA TAMPO + saat damgası (update çağrısı yok), paket alanı
                             YOK. Tek üretici fxRuntime.emit — kumanda olayı anlık yoldan aldığı
                             için izler telefonda da doğar. Raunt temizliği: seed değişimi
                             (hash(mode,roundId)) yumuşak süpürme tetikler, ayrı yaşam döngüsü yok
  fieldLights.js           DİNAMİK IŞIK HAVUZLARI (ARENA_ELEVATION_PLAN Faz 3): setDangerSpot /
                              setRoyaltySpot / tracerAt / flashAt slot setter'ları + emitFxLight
                              (kill→infilak, hit/slay→vuruş parıltısı); drawFieldLights
                              (fieldKit.drawField içinden, varlıkların altında); clearFieldLights.
                              Sabit havuzlar + sprite damgaları (renk başına tek pişirme) +
                              saat damgası, paket alanı YOK. Slot'lar view'lardan tazelenir;
                              world-view aynı setter'ları kendi frame'iyle besler, unit TEK
                              kaynaktan (box.unit) türer → host/client sapması yok
  fieldAmbience.js         SAHA DIŞI AMBİYANS (ARENA_ELEVATION_PLAN Faz 4): setClimax +
                              drawClimaxVignette (son 5 sn / ani ölüm / son 2 hayatta kalan →
                              karanlık masaya kalp atışı temposunda kızıl/altın vinyet; paintBackdrop
                              bliti üstüne, saha katmanı altına — zemin L* bütçesine dokunmaz) +
                              celebrate/drawCelebration (MATCH_OVER'da 2.5D konfeti + deterministik
                              kamera flaşları; TEK patlama/maç sonu, çağrı zinciri kopunca yeniden
                              kurulur). Sabit havuzlar + hash01 determinizmi, paket alanı YOK. Climaks
                              üreticisi TEK geçit tabletopRenderer.renderStandardScoreboard; kutlama
                              üreticisi TEK geçit hud.renderMatchOver (host + kumanda ortak)
  playerEntity.js           createPlayer, tickEffectTimers, advancePlayer
  avatarInGame.js           drawGameAvatar, normalizeExpression, blinkState — saha içi daima
                            faceMode:'play' (ERIŞUAR/DESEN YOK, tam yuvarlak siluet)
  qualityGate.js            Kalite kapısı sözleşmesi: 7 kapı (I1-I7) + 4 rapor (I8-I11) + TUNING_ANCHOR
                            + evaluateGame; tests `npm run health` ile 12 oyunu doğrular
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
  quickChrome.js            Üst yüzen çiplerin TEK tanımı (QUICK_CHIPS): host `#in-game-hud`
                            + kumanda başlığı buradan üretilir; sıra/görünürlük veri.
                            Tepki çipi BİRİNCİ giriş noktası ve iki yüzeyde de ⋮
                            menüsünün solunda (taç · tepki · ⋮)
  scoreModel.js             Skor görünümünün TEK modeli (scoreEntries): dolu koltuk + isim +
                            renk + lider; host canvas skorbord'u ve kumanda taç-peek'i besler
  tabStrip.js               MERKEZİ sekme şeridi (OYUNLAR kategorileri + KARAKTER editörü)
  canvasUI.js               Ortak canvas UI: renderLobbySeatCard, renderLobbyStartButton,
                            renderStandardLobbySeats, renderMatchOver, renderRoundBanner,
                            renderControlGuide, renderMatchHeader, renderArenaWatermarkTimer
  customizeModal.js         İKİ YOLLU avatar atölyesi (RENK/YÜZ/HALKA; TV lobisi + kumanda yolu)
  characterRenderer.js      Birleşik avatar çizimi (yazısız pip kimliği; text-label yasak)
  avatarStage.js            Avatar sahne çizimi (yarıçapa orantılı)
  hostLobby.js              TV/ONLINE bekleme lobisi (QR, oda kodu, oyun çipleri, koltuk editörü)
  joinModal.js              Kumanda katılım modalı & kod kutusu
  pauseModal.js             Duraklatma: tek satır başlık + kalıcı eylemler + şemadan HIZLI şerit + KOLTUKLAR/KONTROLLER sekmeleri (sabit panel yüksekliği)
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
                            tankAI, crownAI, pongAI, zoneAI, archerAI, snakeAI, hordeAI,
                            collapseAI, ninjaAI

src/games/ (Oyun Motorları — BaseMiniGame türevleri):
  game.js / paddle.js / ball.js        PONG motoru
  tanks.js / tanksView.js              Micro-Tanks
  curve.js / curveView.js              Brutal Curve
  bomb.js / bombView.js                Brutal Bomb
  heist.js / heistView.js              Brutal Heist
  archer.js / archerView.js            Brutal Archery
  zone.js / zoneView.js                Brutal Zone (64x64 RLE)
  snake.js / snakeView.js              Brutal Snake
  horde.js / hordeConfig.js / hordeView.js  Brutal Horde
  colossus.js / colossusConfig.js / colossusView.js  Brutal Colossus (Co-op Titan Hunt)
  collapse.js / collapseView.js        Brutal Collapse (13x13)
  crown.js / crownView.js              Brutal Crown (arşivden çıkarıldı)
  ninja.js / ninjaView.js              Brutal Ninja
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
                            control-surface.spec.js — yerel kontrol yüzeyi seçimi
tests/relayProbes.test.mjs  §11'in 3 provasının protokol karşılığı: hazır→lobi sıfırlama,
                            takas isim senkronu, bot görünürlüğü — gerçek WS sunucusu üzerinde.
                            Prova 4-6 ek olarak: 8 Hz STATE_SYNC zarfının kumandaya DÜZ
                            ulaşması, eski kova-şekilli host toleransı, iki transport eşitliği
playwright.config.mjs       e2e yapılandırması (vite:3100 webServer, chromium headless)
tests/worldPacketRadius.test.mjs  Tasarım yarıçap sabitlerinin motor TUNING'iyle eşitliği
                             (view motoru import edemediği için worldCore.js kopyaları var)
.github/workflows/ci.yml   Push/PR kapısı: `npm run check` + `npm run build` +
                             `npm run test:e2e` — doğrulama elle koşulmaz
scripts/typecheck.mjs       tsc --checkJs ratchet'i: --stats dosya tablosu, --max (taban:
                            scripts/typecheck-baseline.txt, şu an 0) — `npm run typecheck`
scripts/rules-lint.mjs      AGENTS.md K1–K7 makine bekçisi (mode=== dalı, ham renk, canvas
                            DPR, cartridge bütünlüğü, emoji, PROJECT_MAP tazeliği); borç
                            tabanı scripts/rules-lint-baseline.json — `npm run check:rules`
```

---

## 2. Motor Tablosu

| Kod | Mod adı | Motor dosyası | Bot | Kumanda | Not |
|-----|---------|---------------|-----|---------|-----|
| PONG | Brutal Pong | `src/games/game.js` | Paddle içinde | `mountPongController` | Set skorü (3 set); ortak skor şeridi + ralli/falso durum satırı; kale %62 + 45° pah; ❄️ dondurma; 120sn limit; 30 Hz world-view |
| TANKS | Micro-Tanks | `src/games/tanks.js` | `tankAI` | `mountTanksController` | Gaz+ateş; 2 chamber + triple pickup; 35sn sudden-death; 30 Hz world-view |
| CURVE | Brutal Curve | `src/games/curve.js` | `curveAI` | `mountCurveController` | NITRO akışı; 24×24 owner+gap maskesi; 30 Hz world-view |
| BOMB | Brutal Bomb | `src/games/bomb.js` | `bombAI` | `mountBombController` | Patlama `blast` katmanı; 90sn draw; 30 Hz world-view |
| HEIST | Brutal Heist | `src/games/heist.js` | `heistAI` | `mountHeistController` | 45sn raunt; bounded draw; 30 Hz world-view |
| ARCHER | Brutal Archery | `src/games/archer.js` | `archerAI` | `TWIN_STICK_ACTION` | Basılı yay + bırakışta ok; 3 harita; power-up'lar; mesafe ölçekli stun; 30 Hz world-view |
| CROWN | Brutal Crown | `src/games/crown.js` | `crownAI` | `mountCrownController` | **Arşivden çıkarıldı**; taç tutma; pinball bumper; 30 Hz world-view |
| ZONE | Brutal Zone | `src/games/zone.js` | `zoneAI` | `mountZoneController` | 64×64 grid kapma; %40 early win; RLE; 30 Hz world-view |
| SNAKE | Brutal Snake | `src/games/snake.js` | `snakeAI` | `mountSnakeController` | Yemle büyü; hold-boost; 30 Hz world-view |
| COLLAPSE | Brutal Collapse | `src/games/collapse.js` | `collapseAI` | `mountCollapseController` | 13×13 çöken ızgara; 60sn; 30 Hz world-view |
| NINJA | Brutal Ninja | `src/games/ninja.js` | `ninjaAI` | `mountNinjaController` | Görünmezlik; selfSlot hayalet; 30 Hz world-view |
| HORDE | Brutal Horde | `src/games/horde.js` | `hordeAI` | `TWIN_STICK_ACTION` | 1-4P takım savunması; 3 tur × 3 dalga; armory; 3 harita; elite+boss; boss bombası = **zemin telegrafı** (gövde değil: çarpışma/vuruş/auto-aim dışı, tek kural daireden çık; `enemies[15]=fuse`); kalp+şarjör plakası; 30 Hz world-view |

---

## 3. Ağ & İletişim Protokolü

İki transport: **Lokal/dev** `src/network.js` (WS) · **Canlı/online** `src/supabaseRelay.js` (Supabase keşif + WebRTC). ONLINE host = P1 oyuncusu; uzak oyuncular P2-P4. TV host varsayılan koltukta değildir, istenirse P1 olur. Relay `players[]` tek koltuk kaynağıdır.

Her WebRTC peer'ında iki DataChannel:
- `control` (`ordered:true`): girdi, hazır, koltuk, 8 Hz HUD/state. WebRTC yoksa Supabase fallback.
- `world` (`ordered:false, maxRetransmits:0`): yalnız ONLINE world-view oyunlarında 30 Hz tam snapshot; client `seq` ile eski/geç kareyi atar. TV_CONSOLE'da kapalı. Playout tabanı 35 ms; pakette `selfPredict:true` varsa client kendi avatarını sunum-taraflı ileri sarar (`core/selfPrediction.js`) — host simülasyonu/yetkisi değişmez. Bayrak yalnız DOĞRUDAN-hareket oyunlarında (CROWN, BOMB, HEIST, COLLAPSE, ARCHER, NINJA, ZONE, HORDE); steer-kinematikli SNAKE/CURVE/PONG/TANKS'ta yoktur (girdi yönü = hareket yönü değil).

Ortak doğrulama `networkProtocol.js`. **Uçtan uca:** oda kur (3 haneli kod) → keşif (kod + role) → `JOIN_SUCCESS` (worldView + reservedHostSlot) → signaling (offer/answer + kuyruklu ICE) → oyun trafiği P2P `control`+`world` → Supabase devre dışı. Kayıp paket: `world` kareleri bağımsız, düzeltme gerekmez; kritik olaylar `control`'dan anında.

### player_msg (uzak telefon → host):
- `INPUT`: joystick `(x,y)` / buton (`FIRE`, `DASH`, `TACKLE`, `HORDE_FIRE/RELEASE`). 40ms throttle; aksiyon throttlesız.
- `AVATAR_UPDATE` (INPUT tüneli): kendi karakteri `{color, expression}`; host sanitize eder.
- `JOIN_ROOM`/`JOIN`, `SWITCH_SLOT`, `PLAYER_READY`, `SET_NAME`, `REACTION`, `PING`.

### host_msg (host → uzak telefon):
- `HOST_STATE_SYNC`/`GAME_STATE` (8 Hz, dirty-check), `WORLD_FRAME` (30 Hz P2P).
- `HOST_FX`/`FX_EVENTS` (anlık güvenilir yol, throttle yok): `network.js` →
  `{ type: 'HOST_FX', events }` · `supabaseRelay.js` → `{ action: 'FX_EVENTS', events }`.
  Olay `{ fx, token, x, y, u, power, slot?, color?, dirX?, dirY?, angle?, size?, ringRadius? }`
  (`fx` kapalı küme, `token` oturum sayaçlı); doğrulama `networkProtocol` (`isValidFxEvent`/
  `normalizeFxEvents`), damga `createFxStamp`, süzgeç `createFxEventFilter`. Kilit:
  `tests/fxEvents.test.mjs`.

**STATE_SYNC zarfı — iki transport'ta AYNI şekil.** Discriminator en üstte, yük düz:
`network.js` → `{ type: 'HOST_STATE_SYNC', ...state }` · `supabaseRelay.js` → `{ action: 'STATE_SYNC', ...state }`.
Kumanda (`gamepad.handleStateSync`) yalnız en-üst-seviye alanları okur (`phase`, `gameMode`,
`scores`, `names`, `t`, `roundGap`); yükü iç içe `{state:{…}}` kovasına gömmek bu alanları
sessizce `undefined` bırakır ve periyodik paketin "kaybolan tek mesajdan kendini toparla"
görevi ölür. `normalizeStateSync` (bkz. `core/networkProtocol.js`) iki şekli de tek düz
pakete indirger: yeni host + eski sunucu ve eski host (kova şekilli) + yeni kumanda/sunucu.
Kilit: `tests/relayProbes.test.mjs` prova 4 (düz ulaşım), 5 (eski host toleransı), 6 (iki
transport aynı tüketiciliği besler).
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
9. **Girdi sertleştirme** — analoglar tek noktada 40ms kısılır (host 33ms ikinci kapı); touchcancel
   yönü 150ms grace ile korur; kopan kumanda nötral + koltuk tutar;
   WS kopma simetriği (30s watchdog + auto-rejoin); oyun kodunda dispatch `if/else` zincirsiz.
10. **Kontrol eşleşmesi** — telefon↔motor, klavye her motorda; basılı yön 250ms keepalive; `bp_control_surface`.
11-15. **Faz A-E (tarama raporları)** — çökme + kritik mantık, güvenlik/validasyon, oda yarışları,
    performans (CURVE ızgarası, bake, chunk, SW), UX/a11y. Gerekçeler kod yorumlarında + testlerdedir.
16. **Cihaz-başı karakter + yazısız kimlik** — avatar = renk + yüz (+ rim); saha içi yazı/text-label yok;
    renk oyuncuya aittir (takas taşır); LOCAL koltuk-başı renk.
17. **Ortak arena/fizik/power-up kiti** — `src/core/` (Faz 3-7). Detay §1 (playfield/arenaKit/physics2d/…).
17b. **Raunt/maç akışı tek sahibi** — `core/roundLifecycle`. Tempo olayın
    özelliğidir, oyunun değil: `ROUND_GAP` tablosu. 12 motor aynı geçiş
    bloğunu kopyalamış, her biri kendi boşluğunu (1.8–2.8 s) seçmişti; kumandadaki
    `roundGap` rozeti o yüzden oyundan oyuna farklı sayıyordu. Artık motor
    `tickRoundFlow` çağırır, üretici `beginRound`/`beginDrawRound`/`endMatch`'tir.
    Maç sonu ANINDA değil boşluk sonrasıdır (her oyunda aynı ölçü) — kazanan
    bant görünmeden kartın açılması "bam" etkisi yapıyordu. Kilit:
    `tests/roundLifecycle.test.mjs` (davranış + "motor kendi geçişini yazmaz" kilidi).
18. **Saha ölçeği tek kaynağı** — `playfield.js`; kompakt yatay dikey pay daralır; `unit` otorite;
    `minFraction` şişme yerine mutlak px taban + tek çarpan; gözle taban seçimi yok.
    Harita-ölçeği hissi gövde/saha oranıdır: `FIELD_TIERS` üç katman — `normal` (BOMB/HEIST/CROWN/
    ARCHER/TANKS/ZONE/NINJA/COLLAPSE/HORDE), `open` (SNAKE/CURVE), `far` (kullanıcısız, bant yerinde duruyor);
    ölçülen tasarım yarıçapı bant kilidine tabi (`movementBudget.test.mjs §B`), PONG hariç.
19. **İkonografi** — Lucide neo-brutalist; tek kaynak `tabletopIcons.js`; butonlarda metin başlığı yok.
20. **Online world-view** — generic çekirdek `worldCore.js` + `[oyun]View` + client renderer; 30 Hz;
    oyun başına deklaratif `extras`. Client simülasyon/AI import etmez. Maç sonu kartı host
    canvas'ıyla AYNI (`hud.renderMatchOver` → `worldViewKit.drawWorldMatchOver`): host ve
    kumanda aynı `enter` ilerlemesiyle solarak açar (ani belirmez); kumanda ayrı
    bant yazmaz; `frame.scores` + `slots`'tan yalnız dolu koltukları çizer, eylem butonu yoktur
    (yeniden başlatma yetkisi hostta). LOCAL tek-cihaz sonucu telefon DOM'unda ortalanmış
    modal olarak açılır (`gamepad.js` nefes payı + `.result-card`).
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

---

## 8. FX Olayları ve Bütçeleri

**Tek kaynak `src/core/fxKit.js`.** Motorlar OLAY üretir (`emitFx`); partikül/halka/pop/flaş/
hit-stop/haptik bütçeleri yalnız buradan geçer. Motor gövdesinde FX sayısı/α'sı UYDURULMAZ;
`fxKit` tablosu ve `fxRuntime` çeviricisi otoritedir. Domainsizdir — host motoru, world-view ve
testler aynı saf fonksiyonları paylaşır.

- **Kapalı olay kümesi:** `FX_KIND` = `shot` · `hit` · `slay` · `kill` · `pickup` · `score` · `blocked` ·
  `spark` · `dust` · `zone`. Küme dışı kind throw eder (`fxProfile`). `slay` = sıradan (trash)
  düşman ölümü: pop+burst+halka+kısa hit-stop, FLAŞ YOK. HORDE çok-ölümlü olduğu için flaş
  yalnız `kill`'e (elit/boss/patlama) saklanır; aksi halde her NPC ölümü ekranı yakıp
  `hitStop = Math.max` ile zamanı kilitler.
- **Bütçe tablosu `FX_PROFILES`:** olay başına partikül patlaması (count/speed/size/life), şok
  halkası (r0→r1/width), `trauma` (0..1, travma² ile uygulanır), `hitStopMs`, `flashSec`.
  Tüm uzamsal sayılar TASARIM px'idir; spawn anında `unit` ile çarpılır (I5/I6).
- **Havuz kapları:** partikül `FX_PARTICLE_CAP` 96 · halka `FX_RING_CAP` 12 · ölüm pop'u
  `FX_POP_CAP` 8; kap dolunca en eski atılır.
- **Zaman/sunum bütçesi:** `advanceHitStop` donuk sürede dt'yi `FX_HITSTOP_SCALE` (0.06) yapar,
  artan gerçek zaman sonraki kareye iade edilir; kill flaşı `fxFlashAlpha` → tepe `FX_FLASH_ALPHA`
  (0.35). Azaltılmış harekette (`motionScale()===0`) hit-stop ve travma üretilmez; partikül bilgi
  taşıdığı için üretilmeye devam eder.
- **Okunurluk hiyerarşisi (3.3, TEK hakem):** `FX_TIER` T1 own / T2 threat / T3 other;
  `FX_TIER_ALPHA` = 1 · 1 · 0.75; `fxReadAlpha({isSelf, isThreat, hasViewer})`. Paylaşılan TV'de
  "kendi" yoktur → dim yok (`hasViewer:false` → 1). Motorlar `globalAlpha`'yı bu çarpanla ÇARPAR.
- **Ağ:** FX olayları anlık GÜVENİLİR yoldan gider (`HOST_FX` / `FX_EVENTS`), world kanalında
  taşınmaz (§3). Olay şeması `{ fx, token, x, y, u, power, slot?, color?, dirX?, dirY?, angle?,
  size?, ringRadius? }`; doğrulama `isValidFxEvent`/`normalizeFxEvents`, damga `createFxStamp`,
  süzgeç `createFxEventFilter`.
- **Haptik:** `FX_HAPTIC` olay→desen; `haptics.js` tercih kapısından geçer.

Kilit testleri: `tests/fxKit.test.mjs`, `tests/fxEvents.test.mjs`.

---

## 8b. Oyun-İçi Ses Ailesi (`src/audio.js`)

Sentezleyici tek modülde; oyun sesleri **olay sınıflarına ayrılmış** seslerdir, çünkü kalabalıkta
"kendi başıma mı oldu" sorusu kulakla yanıtlanmalıdır. HORDE bu yüzden dört ayrı ses tutar
(`tests/hordeAudioSeparation.test.mjs` imzaları kilitler):

| Olay | Fonksiyon | Dalga | Karakter | Neden ayrı |
|------|-----------|-------|----------|------------|
| Düşman öldü (trash) | `playHordeKill` | triangle | tiz, ≤120 ms | Arka planda kaybolmaz; `SLAY_SOUND_THROTTLE` ile 70 ms'den sık çalmaz (spam hasarı maskeler) |
| Bana isabet etti | `playHordeHurt` | square | bas, ≥200 ms | Her zaman çalar (bilgi sinyali), throttle yok |
| Bomba patladı | `playHordeBoom` | sawtooth | derin, ≥400 ms | "Sıradan ölüm" değil, "saha çapında olay" |
| Bombanın fuse'u | `playHordeBombTick(urgency)` | square | tiz, ≤60 ms | Dodge zamanlaması; urgency ile tizleşir |

Aynı dalga ailesini paylaşan sesler (ör. `hurt` ve `fuse` — ikisi de `square`) **süreyle**
ayrışır; imza `(type, duration)` çiftidir. Elit/boss ölümü `playExplosion`'ı korur: "önemli ölüm"
kulağa büyük gelmelidir.

Sample katmanı: her `play*` önce `core/soundBank.js` eşlemesindeki Kenney ogg'yi dener
(`core/soundEngine.js` — bus + throttle + polifoni); önbellekte yoksa/bozuksa yukarıdaki
synth çalar. Testler synth yolunu kilitler, tarayıcıda ikinci vuruştan itibaren örnek
duyulur. Geri sayım `playCountdownTick` (3-2-1 + `fight`), staging iki tarafı da ısıtır
(`warmGameSounds`). Banka bütünlüğü `tests/soundBank.test.mjs`'tedir.

---

## 9. Görsel Dil & Tema Seferberliği ("Vibrant Pastel Arcade")

Oyunun görsel dili, soluk/monokrom krem zeminlerden canlı, neşeli ve oyun kimliğini hissettiren **"Vibrant Pastel Arcade"** diline evrilmiştir.

- **Felsefe ve Okunabilirlik:**
  - Her minigame'e özgü, doymuş ancak göz yormayan 4 duraklı pastel zemin rampası (`floorHigh` → `floorLow`).
  - $L^* \ge 75$ ve $\Delta L^* \le 14$ CIE Lab bütçesi (`tests/fieldKit.test.mjs §8`) ile kilitlenmiş taban; koyu konturlu avatarlar (P1–P4) sahanın her noktasında yüksek kontrastla parlar.
  - Sınır derinliği: sert siyah konturlar yerine pahlı kenar (`edgeLight` + `edgeInk`) ve yumuşak ışık havuzu (`lightPool: 0.58`, `lightAlpha: 0.72`).
  - Viewport çerçevesi (`backdrop`): sahanın dışı siyah veya donuk bej değil, sahanın `floorLow` pastel rengiyle harmanlanmış yumuşak vinyet.

- **Merkezi Mimari (Single Source of Truth):**
  - **Tasarım token'ları:** `src/styles/tokens.css` ve `src/ui/tokens.js`.
  - **Saha paletleri & temalar:** `src/core/fieldKit.js` içindeki `FIELD_THEMES` ve `fieldTheme(mode)` fonksiyonu.
  - **Dönüşüm kolaylığı:** Görsel dilin tek merkezden türemesi sayesinde 12 motorun simülasyon koduna veya her oyunun çizim döngüsüne dokunmadan tüm oyunların zeminleri, viewport'ları, HUD'ları ve kumandaları anında senkronize olur.

- **Uygulama ve Yayılım Aşamaları (Roadmap):**
  1. **Saha Zeminleri ve Sahne:** 12 oyunun pastel rampaları (`fieldKit.js`), sunset menü gradyanı ve derinleştirilmiş koyu yüzeyler (`tokens.css`, `scene.css`).
  2. **HUD ve Staging Sayaç:** Oyun içi çip auraları ve 3-2-1 geri sayım perdesinin aktif oyunun `accent` rengini taşıması (`main.js`, `hud.css`, `lobby.css`).
  3. **Telefon Kumandası (Gamepad Shell):** Aktif oyuna göre kumanda üst barı ve buton auralarının temayı yansıtması (`gamepad.js`, `gamepad.css`).
  4. **FX & Partikül Uyumu:** Kıvılcım/toz efektlerinin nötr griden tema vurgusuna geçişi (`fxKit.js`).
  5. **Zafer ve Sonuç Paneli:** Maç sonu kartında kazanan rengi ve pastel kutlama aurası (`resultPanel.js`, `worldViewKit.js`).

### 9.1 Kabuk & Menü Dili — "Arcade Oyuncak Kutusu"

Saha zaten oyuncak-masası dilindeyken kabuk düz koyu panel + ince 1px ayraç dilinde kalmıştı; menüler oyundan kopuk okunuyordu. Kabuk artık sahayla **tek ürün** gibi konuşur.

- **Display tipografi:** `--font-display` (`src/styles/tokens.css`) = `'Fredoka', 'Space Grotesk'`; canvas karşılığı `UI_FONTS.display` (`src/ui/tokens.js`). Gövde `Space Grotesk`, veri/mono `JetBrains Mono` kalır. İki taraf (CSS + canvas `UI_TEXT` kademeleri) **birlikte** değişir, yoksa HUD menüden kopar. Türkçe diakritikleri kapsar (latin-ext).
- **Arcade malzeme ölçeği:** `--arcade-edge-w`, `--arcade-bevel` (üst pah), `--arcade-under` (alt cephe), `--arcade-drop-sm/md/lg`, `--arcade-drop-press`; yarıçap ölçeği `--r-sm/md/lg/xl`. Kural: kalın kenar + üst pah + **sert ofset gölge** (düz 1px ayraç dili yerine). Işık yönü sahayla aynı (sol-üst −45°).
- **Kapsam:** shell (`shell.css`), ortak sahne butonları (`scene.css`), dört ekran (`home/games/profile/room.css`), ortak sheet/modallar (`sheets.css`, `settings.css`, `modals.css`), bildirimler (`notices.css`), canvas HUD/result (`ui/tokens.js` rolleri) ve telefon kumandası (`gamepad.css`). Yeni bir yüzey eklerken renk literali veya düz panel dili açılmaz; bu token'lar tüketilir.
- **Doğrulama:** `npm run check:tokens` + `npm run check:rules` (görsel/mikro-çizim), tam `npm run check` yalnız yapı/protokol/motor değişiminde.

