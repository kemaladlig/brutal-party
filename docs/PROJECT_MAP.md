# PROJECT_MAP — Brutal Party (mini-game-4p) Proje Haritası

Yaşayan doküman: kod veya mimari değiştiğinde burası güncellenir. Temel kurallar ve yasaklar **`AGENTS.md`**'dedir. Teknik yol haritası ve faz planı **`docs/TECHNICAL_ROADMAP.md`**'dedir.
Son doğrulama: Refactoring & Modülerleştirme sonrası (Eylül 2026).

---

## 1. Dizin & Dosya Sorumlulukları

```
index.html                  Ana menü (bento kartlar), TV lobi modali, kumanda overlay iskeleti
src/main.js                 Ana orkestratör: mod/oda akışı, ONLINE P1 host slotu, staging+sayaç,
                            8Hz HUD/state + 30Hz P2P world broadcaster, render döngüsü
src/net.js                  Ağ seçici (LOCAL / TV_CONSOLE→WS / ONLINE→Supabase) + PUBLIC_URL, env bayrakları
src/network.js              PartyNetwork: lokal WebSocket istemcisi (host + kumanda rolleri)
src/supabaseRelay.js        ONLINE host/player tabloları, Supabase keşfi/signaling/fallback,
                            reliable control + unreliable world DataChannel yönlendirmesi
src/webrtcManager.js        Star P2C manager: peer Map, SDP/ICE kuyruğu, control/world kanalları
src/gamepad.js              Telefon kumandası: full-screen world canvas + overlay kontroller,
                            koltuk ızgarası, skor şeridi, ready yönetimi, dokunmatik girdiler
src/controllers/
  controllerTemplates.js    Deklaratif kumanda şablonları (JOYSTICK_ACTION, ARCADE_DRIVE, TWO_BUTTON_STEER, SLIDER_1D, STEER_BOOST) + PONG canlı skorbord/falso senkronu; semantic layout target'ları
  gamepadInputAdapter.js   Transport'tan bağımsız 50ms analog throttle + dead-zone sınırı
  physicalGamepadAdapter.js Browser Gamepad API polling; touch/keyboard/pointer öncelikli ikincil kaynak
  gamepadShell.js         GamepadManager'dan ayrılmış stabil shell/presenter markup'ı
  gamepadSchemas.js         15 oyun için deklaratif kumanda konfigürasyonları, canlı senkronizasyon hook'ları (BOMB/CROWN/HEIST uyarıları) + merkezi `def` referansı
  controlDefs.js            Merkezi kontrol sözleşmesi: sol (joystick/steer/slider/pedal) + sağ (max 2 aksiyon) + landscape-first politikası + nötr paket haritası; telefon + tabletop parite kaynağı
  controllerStatus.js       Üst durum şeridi metinleri (15 oyun, tek kayıt) — gamepad handleStateSync zincirsiz çağırır
  controllerGuide.js        CONTROL_DEFS + gamepad schema'dan türetilen görünür/semantik kontrol rehberi
src/gamepad.css             Kumanda stilleri (neo-brutalist mobil ergonomi + canvas/control katmanları)
src/ui/gamepadWorldView.js  Generic client world-frame canvas: DPR, 3-8 snapshot jitter buffer, 60 Hz rAF sunum, seq/stale yönetimi
src/ui/worldViewKit.js      World-view kromu (banner/placeholder/stale + fitWorld) — tüm renderer'lar tek kaynaktan
src/ui/snakeWorldView.js    Client-only Snake world renderer; simülasyon/fizik çalıştırmaz
src/ui/pongWorldView.js     Client-only Pong world renderer; simülasyon/fizik çalıştırmaz
src/ui/raceWorldView.js     Client-only Race world renderer; simülasyon/fizik çalıştırmaz
src/ui/crownWorldView.js    Client-only Crown world renderer; simülasyon/fizik çalıştırmaz
src/ui/archerWorldView.js   Client-only Archer world renderer; simülasyon/fizik çalıştırmaz
src/ui/bombWorldView.js     Client-only Bomb world renderer; simülasyon/fizik çalıştırmaz
src/ui/heistWorldView.js    Client-only Heist world renderer; simülasyon/fizik çalıştırmaz
src/ui/tanksWorldView.js    Client-only Tanks world renderer; simülasyon/fizik çalıştırmaz
src/ui/cloneWorldView.js    Client-only Clone world renderer; simülasyon/fizik çalıştırmaz
src/ui/ninjaWorldView.js    Client-only Ninja world renderer; simülasyon/fizik çalıştırmaz (selfSlot hayalet)
src/ui/laserWorldView.js    Client-only Laser world renderer; simülasyon/fizik çalıştırmaz
src/ui/zoneWorldView.js     Client-only Zone world renderer; RLE grid → offscreen katman
src/ui/collapseWorldView.js Client-only Collapse world renderer; 13x13 grid
src/ui/curveWorldView.js    Client-only Curve world renderer; iki katmanlı trail (near + field maskesi)
src/ui/hordeWorldView.js    Client-only Horde world renderer; capped enemy/projectile snapshot'ları
src/style.css               Modüler stil orkestratörü (@import src/styles/*)
src/styles/                 Modüler CSS katmanı (tokens, base, hud, modals, menu, lobby, animations)
src/controlGuide.js         Oyun-içi kontrol yardımcısı overlay'i
src/touchManager.js         Dokunmatik giriş yöneticisi (TV / masa-ortası lokal mod)
src/i18n.js                 Hafif UI metin motoru (t(), dil state, olaylar)
src/locales/                Yerelleştirme sözlükleri (tr.js, en.js)
src/types/game.d.ts         Ortak tip tanımları (PlayerSlot, Cartridge, EngineContract)
src/audio.js                Synthesizer / Web Audio API ses efektleri

src/core/
  BaseGame.js               BaseMiniGame: Tüm motorların ortak ata sınıfı (canvas, state, scores,
                            slotTypes, trauma/screenshake, handleUiTap, bindStandardKeyboard,
                            handleStandardJoystickTouchStart/Move/End, renderStandardLobby,
                            handleStandardRemoteJoystick, viewport docking, renderHUD,
                            renderControls [tabletop sanal joystickler & proximity ghosting],
                            renderStandardScoreboard, renderStandardRoundBanner, renderStandardMatchOver;
                            Evrensel Masa-ortası Katmanı (Eylül 2026): getTabletopSchema (deklaratif
                            buton şeması — joystick veya steer:true [◀ / ▶ direksiyon butonları] + actions[]:
                            icon/cooldownField/maxCooldown/cooldownMaxField/readyField/holdToCharge/keyHint;
                            sıfır metin kirliliği: butonlar büyük ortalanmış 22px ikonlarla çalışır, yazı okunmaz),
                            getTabletopControlCorners (köşe başına joystick/steer + buton kutuları),
                            handleTabletopTouchStart/Move/End (dokunma geometrisi tek merkezden eşlenir,
                            handleSlotAction(slot,id,isDown) ve onSlotSteer(slot,dir) sinyali),
                            resetTabletopTouches. Motorlar özel buton çizimi geometrisi tutmaz —
                            yalnız şema bildirir (Snake, Curve, Horde ve Pong dahil 15 oyunun tamamı merkezi katmana bağlı);
                            renderControls cooldown maskesi/charge barı/proximity ghosting/slot-başı klavye rozeti çizer)
  tabletopIcons.js          Masa-ortası & Mobil Kumanda Lucide Vektör İkon Kütüphanesi: OS emojileri yerine Canvas 2D
                            için drawTabletopIcon, Gamepad DOM SVG butonları için getTabletopIconSvg (zap, rocket, bomb,
                            crosshair, flame, rotate-cw, arrow-left/right, maximize-2, message-square vb.); 0 dependency (Eylül 2026).
  engineRegistry.js         GAME_ORDER (aktif önce, retired sonra), CARTRIDGES (15 oyun kartuşu + lifecycle/controller metadataları), ensureEngine/preloadEngine, getControllerMeta, registerEngine/getEngine/forEachEngine
  slotManager.js            Koltuk yönetimi: hostPlayerSlots (+avatar/displayColor), updateHostSlot,
                            syncSlotsToEngine, swapEngineSlots, getColorClashIndices (sert renk engeli)
  slotRules.js              Saf koltuk taşıma kuralları: hedef/kaynak, bot, host rezervasyonu ve kilit guard'ı
  safeStorage.js            localStorage sarmalayıcı (JSON parse/try-catch tek nokta)
  preferences.js            Versiyonlu cihaz tercihleri: controlSurface/audio/haptics/PONG + global controller layout + v1→v2 migration
  controllerLayout.js       Saf cihaz-geneli kontrol yerleşimi: normalize, safe-frame fit, merkez koruması, minimum 44px, sol/sağ taşıma çözümü
  haptics.js                Tek haptik preference gate; tüm engine/controller vibration çağrıları buradan
  inputSource.js            Saf keyboard/touch/pointer arbitration; hareket/aim kanalı coexistence bypass'ı
  controlDescriptor.js      phone/tabletop/network normalize kontrol sözleşmesi + parity doğrulaması
  inputIntent.js            Transport action → canonical engine intent projeksiyonu
  aimInput.js               Oyuncu başına canonical aim state: held/active/vector/sequence,
                            stale/out-of-order guard ve release policy verisi
  fireFeedback.js           ARCHER/HORDE/LASER cooldown progress + blocked/ready/shot state
  fireFeedbackEffects.js    blockedSes/haptic efektlerini episode başına bir kez uygular

  AIM_MOVE/PRESS/RELEASE    ARCHER/HORDE/LASER sağ analog + bas/bırak attack lifecycle'ı
  inputRouter.js            Local/network input → aktif authoritative engine yönlendirmesi
  networkProtocol.js        Ortak ONLINE/TV_CONSOLE input doğrulama sözleşmesi
  worldInterpolation.js     Snapshot tabanlı sunum interpolasyonu: stable-id blend, delayed buffer, no-extrapolation
  inputMaps.js              Tek klavye slot haritası: STANDARD_KEY_SLOTS (P1 WASD+Space…P4 TFGH+B),
                            SECOND_ACTION_KEYS (ninja smoke/laser dash), getSlotKeys, keyboardVectorFrom,
                            readSlotKeys, isSlotActionEvent, slotForActionCode, buildCodeToSlotMap,
                            KEY_LABELS/getKeyLabel — motorlar tuş kopyası tutmaz (Faz 1 refactor, Eylül 2026)
  customizationManager.js   Cihaz-başı TEK profil (localStorage), rastgele varsayılan renk,
                            sanitizeAvatar/pickFreeColor/findSlotColorDuplicates, koltuk avatar kayıt defteri
  touchFlow.js              Tek dokunmatik akış: getQuadrant (BL/BR→TL/TR: 0/1/2/3),
                            roundOverSkipGuard (timerField varsayılan roundTransitionTimer;
                            PONG roundOverTimer geçirir), lobbyCenterStartTap (r=65, min 2),
                            lobbyQuadrantTap (+onSeatChange), matchOverRestartTap (r=75) —
                            15 motorun lobi tap'leri tek merkezden (zone/heist/race/horde dahil, Faz 2 kapanış);
                            İSTİSNA: tanks getCornerZone (merkez -1, PLAYING'de gerekli),
                            PONG getPlayerZoneAt (paddle bölgeleri), zone MATCH_OVER radius:Infinity
                            (her dokunuş restart — davranış paritesi), bomb/zone MATCH_OVER→LOBBY.
                            Faz 2c (Eylül 2026): 12 motor lobi kartı renderStandardLobby'ye
                            geçti (archer/bomb/clone/collapse/crown/curve/heist/laser/ninja/
                            snake/tanks/zone); only PONG hand-rolled kaldı (rotate kart + bölge)
  physics2d.js              Ortak 2D fizik & çarpışma yardımcıları: clampToArena (arena sınır kısıtlama),
                            resolveAABB (çember-AABB engel kayma çarpışması), pointBlocked (engel nokta testi),
                            updateMovers (hareketli engel salınımı), distToSegmentSquared (çizgi mesafesi), segmentCircleIntersection/segmentAabbIntersection (swept projectile) ve getProjectileSubsteps —
                            bomb, heist, archer, ninja, clone, laser, curve, snake, tanks entegre (Faz 3 refactor + Batch 1, Eylül 2026)
  playfield.js             Saha geometrisinin TEK kaynağı: computePlayfield(w,h,preset) + FIELD_PRESETS
                             (standard/roomy/crown/flat/dense/racing) + fieldPx/fieldRadius/fieldSpeed. 15 motorun
                             kenarlık hesabı buraya taşındı; `unit` saha içi ölçeğin tek otoritesidir (Eylül 2026)
  roundLifecycle.js         Ortak raunt terminal sözleşmesi: timeout, all-survivor draw, MATCH_OVER geçişi.
  pickupSystem.js           Ortak taktiksel power-up yönetimi: EFFECTS (etki kayıt defteri), spawnPickup,
                            collectPickups, tickPickupTimers — bomb, archer, laser, curve entegre (Faz 4 refactor, Eylül 2026)
  arenaKit.js               Ortak arena görsel kiti: buildLayout (düzen builder) + drawObstacle (neo-brutalist blok) +
                            PICKUP_META/drawPickup (power-up rozetleri, tek kayıt) — (Faz 5 refactor, Eylül 2026)
  playerEntity.js           Ortak oyuncu varlığı yönetimi: createPlayer (varlık üretimi), tickEffectTimers, advancePlayer —
                            bomb, heist entegre (Faz 6 refactor, Eylül 2026)
  avatarInGame.js           Ortak oyun içi avatar çizimi: drawGameAvatar & normalizeExpression —
                            archer, ninja, bomb, heist entegre (Faz 7 refactor, Eylül 2026)

src/ui/
  canvasUI.js               Tüm motorlar için ortak Canvas UI bileşenleri (renderLobbySeatCard,
                            renderLobbyStartButton, renderStandardLobbySeats, renderMatchOver,
                            renderRoundBanner, renderControlGuide, renderCornerScores,
                            renderArenaWatermarkTimer, getStandardSeatRects)
  customizeModal.js         Sekmeli (renk/yüz/aksesuar/desen) tek-profil avatar atölyesi (TV menü + host + kumanda lobi)
  characterRenderer.js      Birleşik avatar çizimi: options.avatar/kayıt defteri, yazısız pip kimliği
                            (P1=● … P4=●●●●), saha içi text-label yasaktır
  hostLobby.js              TV/ONLINE bekleme lobisi modali (QR kod canvas, oda kodu, lobi oyun chip'leri, WhatsApp/link paylaşımı, ping badge, iki dokunuşlu doğrudan koltuk düzenleyici)
  joinModal.js              Kumanda katılım modali & Hero kod kutusu, panodan yapıştırma
  pauseModal.js             Oyun içi duraklatma menüsü, 4 koltuk takası, 90° saat yönü ekran döndürme, ses aç/kapa
  toast.js                  PWA yükleme bildirimleri (showInstallToast, setupPwaInstallPrompt)
  menuManager.js            TV ana menü orkestrasyonu (bento kart, ayar/ses kısayolları)
  settingsModal.js          Ayarlar modalı (ses, haptik, kontrol yüzeyi auto/mobile/tabletop, PONG yönü/hassasiyet)
  controllerLayoutEditor.js Cihaz-geneli kumanda düzen editörü: live preview, boyut, sol/sağ sürükleme, save/reset; remote + LOCAL ortak
  fullscreen.js             Tam ekran istek/yönetim (TV + kumanda)

src/ai/
  bombAI.js                 Brutal Bomb bot zekâsı: duvar kaçınması, tehlike raycast'i, bomba paslaşma/kaçış
  curveAI.js                Brutal Curve bot zekâsı: sol/sağ ışın örnekleme, delik geçişi, merkez takibi
  heistAI.js                Brutal Heist bot zekâsı: kasa bankalama stratejisi, ganimet önceliği, taktiksel omuz atma
  tankAI.js                 Micro-Tanks bot zekâsı: duvar seken mermi hesaplaması, hedef önleme raycast'i, akıllı ateş
   crownAI.js                Brutal Crown bot zekâsı: taç kovalama, önleyici tackle/omuz atma, kral kaçış manevrası
   pongAI.js                 Brutal Pong bot zekâsı: normal takip + god matador vuruşu, gölgeleme, iniş tahmini
    zoneAI.js                 Brutal Zone bot zekâsı: risk-bütçeli açılım/dönüş, BFS eve dönüş, düşman izi avı
    archerAI.js               Brutal Archery bot zekâsı: mesafe yönetimi + yay germe zamanlaması + kaçınma
    snakeAI.js                Brutal Snake bot zekâsı: ızgara raycast + yem kovalama
    laserAI.js                Brutal Laser bot zekâsı: strafe/dodge + pickup önceliği
     hordeAI.js                Brutal Horde bot zekâsı: portal önceliği, güvenli revive, hedef/dash kararı
    cloneAI.js                Brutal Clone bot zekâsı: devriye + menzil omuz tehdidi
    collapseAI.js             Brutal Collapse bot zekâsı: güvenli hücre + tehlike zıplaması
    ninjaAI.js                Brutal Ninja bot zekâsı: pusu/saklanma + kısa menzil av
     raceAI.js                 Brutal Race bot zekâsı: checkpoint, nitro, draft, oil/spinner avoidance

src/games/ (Oyun Motorları - BaseMiniGame türevleri):
  game.js                   Brutal Pong motoru (+ src/games/ball.js, src/games/paddle.js)
  pongView.js               Ortak Pong snapshot serializer + client-safe çizim yardımcıları
  tanks.js                  Micro-Tanks motoru (sekme fiziği, mermi cooldown & HUD)
   tanksView.js             Ortak Tanks snapshot serializer + host/client çizim yardımcıları (worldCore deklaratif extras)
  curve.js                  Brutal Curve motoru (kuyruk izi, delikler, power-up)
   curveView.js             Ortak Curve snapshot serializer (iki katmanlı trail sıkıştırma) + client çizim
  bomb.js                   Brutal Bomb motoru (patlama zamanlayıcısı, depar, çoklu harita)
  heist.js                  Brutal Heist motoru (altın toplama, kasa bankalama, omuz atma)
   archer.js                 Brutal Archery okçuluk arenası (yay germe + nişan salınımı + yakın menzil 2 puan, 60sn/2 raund)
    zone.js                   Brutal Zone motoru (64x64 grid bölge kapma, iz kesme→base-reset+2sn stun, %40/90sn)
     zoneView.js              Ortak Zone snapshot serializer (RLE grid) + host/client çizim yardımcıları
    snake.js                  Brutal Snake motoru (yemle büyü, kuyruk/çarpışma, hold-boost)
     snakeView.js             Ortak Snake snapshot serializer + host/client çizim yardımcıları
      archerView.js            Ortak Archer snapshot serializer + host/client çizim yardımcıları (world-view)
       bombView.js              Ortak Bomb snapshot serializer + host/client çizim yardımcıları (world-view)
        heistView.js             Ortak Heist snapshot serializer + host/client çizim yardımcıları (worldCore deklaratif extras)
        worldCore.js             Generic world-view snapshot çekirdeği (createWorldSnapshot + isValidWorldBase + packers + drawSquareParticles)
    laser.js                  Brutal Laser motoru (hareketli lazer-tag, 3 can, dash i-frame)
     laserView.js             Ortak Laser snapshot serializer + host/client çizim yardımcıları (worldCore deklaratif extras)
     horde.js                  Brutal Horde motoru (3 tur × 3 dalga, round extraction, armory, 5 can, revive)
      hordeConfig.js           Saf Horde silah/upgrade/map tuning sözleşmeleri (DOM-free)
       hordeView.js             Ortak Horde snapshot serializer + capped enemy/projectile/armory doğrulama ve çizim
    collapse.js               Brutal Collapse motoru (13x13 çöken ızgara, zıplama, itişme)
     collapseView.js          Ortak Collapse snapshot serializer (13x13 grid) + host/client çizim yardımcıları
    ninja.js                  Brutal Ninja motoru (görünmezleşme, kılıç cooldown, siper kutuları)
     ninjaView.js             Ortak Ninja snapshot serializer + host/client çizim yardımcıları (worldCore deklaratif extras)
    race.js                   Brutal Race motoru (3 checkpoint, 3 tur, dash/jump, nitro, drafting, EMP)
  raceView.js               Ortak Race snapshot serializer + client-safe çizim yardımcıları
    raceLogic.js              Race tuning + saf continuous checkpoint progress (DOM-free test yüzeyi)

src/games-retired/ (Oynanabilir legacy cartridge motorları; UI'de aktif oyunlardan sonra):
  crown.js                   Brutal Crown motoru (altın taç, omuz atma, pinball bumper'lar, taç süresi)
  crownView.js               Ortak Crown snapshot serializer + client-safe çizim yardımcıları
  clone.js                   Brutal Clone motoru (klon/NPC ayrımı, gerçek/sahte vuruş)
  cloneView.js               Ortak Clone snapshot serializer + host/client çizim yardımcıları (worldCore deklaratif extras)

server/
  index.js                  Lokal WebSocket bağımsız sunucu başlatıcı
  roomManager.js            Lokal WS oda yöneticisi: slot tablosu, bot/isim/takas senkronizasyonu
  vitePluginWs.js           Vite geliştirme sunucusuna entegre WebSocket plugin'i

public/                     PWA (manifest.webmanifest, sw.js, ikonlar) + public/assets/games/*.jpg
tests/                      Node test runner: network protocol, WebRTC kanal/ICE regresyonları,
                            PONG/RACE/CROWN world snapshot, client renderer ve kontrol rehberi regresyonları
```

---

## 2. Motor Tablosu

| Kod | Mod adı | Motor dosyası | Bot Yapay Zekâsı | Kumanda Mount | Not |
|-----|---------|---------------|------------------|---------------|-----|
| PONG | Brutal Pong | `src/games/game.js` | Paddle içinde | `mountPongController` | Kendi saha skor tabelası var; score-strip yok; kale %62 kenar-oranlı + 45° pah (ince dikiş) + anti-lock + klavye + ❄️ dondurma skili + deterministik stall-kırıcı + 120sn hard round limit; **30 Hz P2P world-view** (`pongView.js` + `pongWorldView.js`) |
| TANKS | Micro-Tanks | `src/games/tanks.js` | `src/ai/tankAI.js` | `mountTanksController` | Gaz pedalı + ateş, kartuş HUD; max 2 chamber + triple pickup burst, 0.55s reload; 2sn spawn gate; 35sn shrinking sudden-death + 90sn hard limit; projectile substeps + stable IDs; **30 Hz P2P world-view** (telefon canvası + overlay kontrol) |
| CURVE | Brutal Curve | `src/games/curve.js` | `src/ai/curveAI.js` | `mountCurveController` | Sol/sağ keskin dönüş yarıları; 120sn terminal draw, intro input gate, 24x24 owner + gap maskesi; **30 Hz P2P world-view** |
| BOMB | Brutal Bomb | `src/games/bomb.js` | `src/ai/bombAI.js` | `mountBombController` | Sanal joystick + depar; 90sn terminal draw, zero-survivor resolution, resize clamp, **30 Hz P2P world-view** |
| HEIST | Brutal Heist | `src/games/heist.js` | `src/ai/heistAI.js` | `mountHeistController` | Sanal joystick + omuz atma; 45sn raunt, bounded tie draw, loot/resize clamp; **30 Hz P2P world-view** |
| ARCHER | Brutal Archery | `src/games/archer.js` | `src/ai/archerAI.js` | `TWIN_STICK_ACTION` (sol koşu + sağ aim/release) | Serbest hareket + sağ çubukta basılı yay germe (nişan salınımı) + bırakınca ok; yakın vuruş 2p / uzak 1p; 60sn raund, 2 raund alan şampiyon; **raund başına rastgele 3 harita (PILLARS/CROSS/SCATTER+hareketli duvar)**; power-up: TURBO/TELEPORT/SLIP + MULTI/QUICKDRAW/SHIELD; mesafe ölçekli stun (yakın 0.12sn → uzak 0.8sn, spam kilitlenmesin); hit-count tiebreak + bounded draw; swept arrows; spawn/power-up state; **30 Hz P2P world-view** (telefon canvası + overlay kontrol) |
| CROWN | Brutal Crown | `src/games-retired/crown.js` | `src/ai/crownAI.js` | `mountCrownController` | **RETIRED ama oynanabilir; UI listesinde sonlarda.** 15s taç tutma + 45s round clock, bounded tie draw, hold-time reset, resize state preservation; pinball hazards; **30 Hz P2P world-view** (`crownView.js` + `crownWorldView.js`) |
| ZONE | Brutal Zone | `src/games/zone.js` | `src/ai/zoneAI.js` | `mountZoneController` | Grid territory capture; 90sn + %40 early win, bounded tie draw, swept trail cuts, BFS bounty fix, exact RLE validation; **30 Hz P2P world-view** |
| SNAKE | Brutal Snake | `src/games/snake.js` | `src/ai/snakeAI.js` | `mountSnakeController` | Yemle büyü (max 320), swept collision, 120sn terminal draw, hold-boost; **30 Hz P2P world-view**: mesafe örnekli tam snapshot |
| LASER | Brutal Laser | `src/games/laser.js` | `src/ai/laserAI.js` | `mountLaserController` | Hareketli lazer-tag: sol koşu + sağ twin-stick aim, bırakışta ateş; 3 can + 2sn respawn, dash i-frame (2.2x/0.22sn/4sn), 2-sekmelik nişan önizlemesi, 90sn/10 kill yarışı, timeout draw + round/session ID, owner-lazer guard, resize clamp; **30 Hz P2P world-view** |
| CLONE | Brutal Clone | `src/games-retired/clone.js` | `src/ai/cloneAI.js` | `mountCloneController` | **RETIRED ama oynanabilir; UI listesinde sonlarda.** 2 gecikmeli kopya, gerçek-vuruş skor + sahte-vuruş 2.5sn slow; 60sn timeout, bounded draw, swept tackle + wall occlusion, resize state preservation; **30 Hz P2P world-view** |
| COLLAPSE | Brutal Collapse | `src/games/collapse.js` | `src/ai/collapseAI.js` | `mountCollapseController` | 13x13 çöken ızgara, 60sn terminal clock, bounded draw, swept hole collision, pickup expiry, resize state remap; **30 Hz P2P world-view** |
| NINJA | Brutal Ninja | `src/games/ninja.js` | `src/ai/ninjaAI.js` | `mountNinjaController` | Görünmezlik, 45sn timeout, bounded draw, swept strike + wall occlusion, lantern resize preservation; **30 Hz P2P world-view** (self ghost) |
| HORDE | Brutal Horde | `src/games/horde.js` | `src/ai/hordeAI.js` | `TWIN_STICK_ACTION` (sol koşu + sağ hold-fire + dash) | 1-4 oyunculu takım savunması; 3 tur × 3 dalga, yalnız 1-3/2-3 sonrası edge extraction, tur arası 3 silah + 1 upgrade armory, FOUNDRY/REACTOR/CORE mapaları, 5 tabanca/SMG/SAKMA/UZUN MENZİLLİ/ŞOK BİÇAK, elite + boss-add wave progression, obstacle-safe swept combat; **30 Hz P2P world-view** |
| RACE | Brutal Race | `src/games/race.js` | `src/ai/raceAI.js` | `JOYSTICK_ACTION` | 3 checkpoint + 3 tur; CIRCUIT/ZIGZAG/SPIRAL; 90sn, round IDs, bounded timeout tie draw, resize clamp/EMP scaling; continuous progress + explicit simultaneous-finish handling; **30 Hz P2P world-view** (`raceView.js` + `raceWorldView.js`) |

---

## 3. Ağ & İletişim Protokolü

Sistem iki transport kullanır:
1. **Lokal Ağ / Geliştirme:** `src/network.js` (PartyNetwork WebSocket)
2. **Canlı / İnternet:** `src/supabaseRelay.js` (Supabase Broadcast oda keşfi/lobi/signaling + WebRTC)

ONLINE host artık TV değil, kendisi P1 olan oyuncu telefonudur; P1 rezerve, uzak oyuncular P2-P4 olur. TV_CONSOLE host cihazı varsayılan olarak oyuncu değildir; host lobi düğmesiyle aynı cihazı isteğe bağlı P1 oyuncusuna dönüştürebilir. Supabase `players[]` / lokal `room.players[]` tek koltuk kaynağıdır.

Her WebRTC peer'ında iki DataChannel bulunur:
- `control`: `ordered:true`; giriş, hazır, koltuk ve 8 Hz HUD/state. WebRTC yoksa hedefli Supabase fallback kullanılır.
- `world`: `ordered:false, maxRetransmits:0`; yalnız ONLINE host→client tam dünya snapshot'ı. TV_CONSOLE odasında bu kanal kapalıdır. World-view oyunları (PONG, SNAKE, ARCHER, BOMB, HEIST, TANKS, CLONE, NINJA, LASER, ZONE, COLLAPSE, CURVE, HORDE, RACE, CROWN) ONLINE'da 30 Hz gönderir, Supabase'e düşmez ve client `seq` ile eski/geç kareyi yok sayar.

ONLINE ve TV_CONSOLE aynı `src/core/networkProtocol.js` input doğrulamasını kullanır. Host yalnız katılmış peer'lardan signal kabul eder; controller kilitlediği hostId dışındaki signal'ı reddeder. ICE adayları remote description sonrasına kuyruğa alınır.

### Uçtan uca: iki telefon nasıl bağlanır (ONLINE)

1. **Oda kurma** — P1 telefonu 3 haneli kod üretir (100–999) ve odayı Supabase Broadcast üzerinden açar. Bu aşamada henüz WebRTC yoktur.
2. **Keşif** — Diğer telefon ana sayfadaki **ONLINE PARTY kartından** (ayrı kod alanı) kodu girer. `join-room-modal` ONLINE modunda "oyuncu" metniyle açılır; TV kartı ise "kumanda" metniyle. Aynı modal, iki farklı rol.
3. **Katılım** — Supabase `players[]` tablosu tek koltuk kaynağıdır; host, katılan peer'ı `JOIN_SUCCESS` ile onaylar. Bu bayrak aynı zamanda `worldView: true` taşır (telefonda world canvası açılır, host koltuğu snapshot'ta rezerve olarak görünür).
4. **Signaling** — Host WebRTC `offer` üretir, client `answer` + ICE adayları gönderir. ICE, remote description'dan önce gelen adaylar kuyruğa alınarak sonradan işlenir. İki `RTCDataChannel` kurulur.
5. **Oyun trafiği** — Bundan sonra Supabase devre dışıdır; tüm oyun verisi doğrudan host→client gider. `control` (güvenilir) girdi + 8 Hz HUD taşır, `world` (atılabilir) 30 Hz tam snapshot taşır.
6. **Oyun döngüsü** — Uzak telefon **yalnız girdi gönderir** (joystick + aksiyon). Motor/fizik/AI host'ta çalışır; sonuç 30 Hz `WORLD_FRAME` olarak yayınlanır, telefon 50-120 ms adaptive playout buffer ile 60 Hz+ native rAF sunum yapar ve kontrol overlay'i üstüne bindirilir.

Kayıp paket davranışı: `world` kanalında kareler bağımsız olduğu için düzeltme gerekmez (sonraki kare gelir). Kritik olaylar (skor, raund/maç sonu, slot değişimi) `control` kanalından anında gider. `seq` alanı ile geç gelen kareler yok sayılır. 15 sn ping / 30 sn watchdog ile kopan peer tespit edilir.

> Not: TV_CONSOLE modunda telefon **kumandadır** (TV sahadır) ve `world` kanalı kullanılmaz. ONLINE modunda telefon hem kumanda hem oyuncudur; aynı cihazda dünya + overlay birlikte çalışır.

### Uzak Telefon → Host (`player_msg`):
* `INPUT`: Joystick yönü `(x, y)` veya buton basımları (`FIRE`, `DASH`, `TACKLE`, HORDE `HORDE_FIRE/HORDE_FIRE_RELEASE`). 50ms throttle ile sınırlandırılmıştır; aksiyon butonları throttlesızdır.
* `INPUT` tüneli `AVATAR_UPDATE`: kumanda kendi karakterini bildirir (`{color, expression, accessory, pattern}`; host sanitize eder, 1sn rate-limit).
* `JOIN_ROOM` / `JOIN`: 3 haneli oda kodu + oyuncu adı + `avatar` ile odaya katılma isteği. Avatarsız eski istemciye host boş rastgele renk + varsayılan yüz atar; alınmış renkle gelenin rengi boşa çekilir (yüz korunur).
* `SWITCH_SLOT`: Telefon lobi/staging ekranından seçilen hedef koltuğa geçiş talebi (`targetSlot`); boş veya başka bir insan koltuğu hedeflenebilir, host/bot kilitlidir.
* `PLAYER_READY`: Hazır / Hazır değil durum değişimi.
* `SET_NAME`: İsim güncellemesi (büyük harf, maks 12 karakter).
* `REACTION` / `PING`: Emoji tepkisi / gecikme ölçümü.

### Host → Uzak Telefon (`host_msg`):
* `HOST_STATE_SYNC` / `GAME_STATE`: 8 Hz periyodik HUD/kumanda durumu (dirty-check ile değişmediyse göndermez).
* `WORLD_FRAME`: world-view oyunlarında (PONG, SNAKE, ARCHER, BOMB, HEIST, TANKS, CLONE, NINJA, LASER, ZONE, COLLAPSE, CURVE, HORDE, RACE, CROWN) yalnız P2P `world` kanalından 30 Hz tam snapshot; full-frame olduğu için kayıp paket sonraki kareyi bozmaz. Transport envelope host `sentAt` damgası taşır; client `GamepadWorldView` bunları 3-8 frame jitter buffer'da tutup native 60 Hz+ rAF ile sunar, interpolate edilen sürekli alanları stable-id ile eşleştirir, round/state/host sınırında snap yapar ve extrapolation yapmaz. ARCHER/LASER/HORDE player snapshot'ları normalized `fireCooldown` ve `fireFeedback` taşır. Büyük grid/trail oyunlarında (ZONE 4096 hücre, CURVE 24.000 segment) snapshot RLE / iki katmanlı sıkıştırma ile tavan altına indirilir; çarpışma host'ta tam çözünürlükte kalır.
* `SLOTS_UPDATE`: 4 koltuğun güncel durumu (`slotIndex, name, color, kind, isReady, isHost` + insanlarda `avatar`) ve `reservedHostSlot`. Hem WS hem Supabase'de birebir aynı şemadır.
* `JOIN_SUCCESS`: Supabase ayrıca `worldView` ve `reservedHostSlot` bayraklarını taşır; ONLINE odada worldView true, TV_CONSOLE odasında false. TV host isteğe bağlı P1'e katılırsa reservedHostSlot 0 olur.
* `SLOT_CHANGED`: koltuk no + display rengi. Renk oyuncuyla taşınır (takas/döndürmede koltuğa sabitlenmez).
* `SET_SLOT_COLOR` (host-only): host lobi hızlı palet/🎲 display-renk override'ı (profil değişmez).
* `SET_HOST_PLAYER` (host-only): TV_CONSOLE host'un aynı authority cihazını isteğe bağlı P1 local oyuncusuna eklemesi/çıkarması.
* `SLOT_CHANGED`: Oyuncuya atanan yeni slot indeksi ve rengi.
* `SLOTS_SWAPPED`: Host tarafından iki koltuk takas edildiğinde kumandaları bilgilendirir.
* `STAGING_STARTED` / `COUNTDOWN` / `GAME_STARTED`: Lobi akış geçişleri.
* `RETURNED_TO_LOBBY`: Lobiye dönüş (hazır bayrakları sıfırlanır, oda kapanmaz).

---

## 4. Slot Modeli Kuralları

* Host cihaz tarafında: `hostPlayerSlots[i] = { name, isReady, kind, avatar, displayColor }`, `kind ∈ 'human' | 'bot'`. ONLINE host başlangıçta P1'dir; açık koltuk düzenleyicide host veya oyuncular başka bir insana/boş koltuğa taşınabilir. TV_CONSOLE host varsayılan olarak koltuklarda yer almaz, lobi düğmesiyle açtığında local oyuncu olarak eklenir.
* Relay tarafı (`supabaseRelay.players[]` veya `room.players[]`) tek doğru gerçektir (Single Source of Truth). TV host P1'e katılırsa aynı host socket'i hem authority hem local player olarak işaretlenir; host kapanınca oda kapanır.
* **Sert renk engeli:** İki insan koltuğu aynı display rengine sahipse `SAHAYA GEÇ` + sayaç kilitlenir (lobide `⚠️ AYNI RENK` + 🎲 hızlı atama). LOCAL muaf (koltuklar boş → küme boş).
* **Bot Kuralları:**
  * Bot koltukları ne hedef ne kaynak olabilir; `SWITCH_SLOT` ile botun üstüne oturulamaz.
  * Sayaç başladığında (`COUNTDOWN`) koltuk seçimleri kilitlenir (`seatsLocked`).
* **Ready-Reset:**
  * `GAME_STARTED` ve `RETURNED_TO_LOBBY` anında `isReady` bayrağı hem host'ta hem kumandada kesinlikle `false` yapılır.

---

## 5. Mimari Karar Defteri (Architectural Decisions)

1. **Host Cihaz Tek Yetkilidir (Authoritative):**
   * ONLINE host P1 runs the simulation; TV_CONSOLE host is the authoritative local display and can optionally occupy local P1 from the lobby. Remote phones only send input. ONLINE/TV_CONSOLE mode is explicit on the home cards and is preserved in invite links (`mode=online|tv`).
2. **Engine Registry Prensibi:**
   * `main.js` içinde `if (mode === 'PONG') ... else if` zincirleri yasaktır. Tüm oyunlar `engineRegistry.js` üzerinden `registerEngine` ile kaydedilir ve polimorfik olarak çağrılır.
3. **BaseMiniGame Ortak Tabanı:**
   * Tüm oyunlar `src/core/BaseGame.js` sınıfından türer; ekran sarsıntısı (`trauma`), skorlar, buton tıklamaları ortak işletilir.
4. **Kumanda Ergonomisi Kuşağı (landscape-first):**
   * Oyun yatay oynanır; lobi portrait kalabilir. Portrait + oyun ise kumanda `rotate-gate` animasyonu basar (iOS lock API yok — telkin, kilit yok).
   * Dokunmatik alanlar dikeyde `safe-area + 12vh` alt-orta kuşakta, yatayda sol/sağ alt köşelerdedir (Sol: yön, Sağ: max 2 aksiyon). Üst-orta asla buton olmaz — üstte tek durum şeridi.
   * Merkezi sözleşme `src/controllers/controlDefs.js` (sol + sağ-max-2); telefon `gamepadSchemas.def`, tabletop `BaseGame.getCentralTabletopLayout/assertTabletopParity` ile aynı kaynağa bakar.
   * Yüzey farkı sabittir: PONG telefonda slider / masada steer, TANKS telefonda pedal / masada joystick (`TABLETOP_LEFT` haritası). Sözleşme sol tipi + sağ-max-2'yi kilitler, oyuna özgü detay (ikon/cooldown) motorda kalır.
   * Telefon senkronu zincirsizdir: durum metni `controllerStatus.getControllerStatus`, uyarılar şema `onSync/onTeardown`, nötr paket `controlDefs.getNeutralInput` — `gamepad.js` içinde oyun-`if/else` tutulmaz (PONG score-strip muafiyeti hariç: kendi skorbord'u var).
5. **3 Haneli Sayısal Oda Kodu (100–999):**
   * Mobil klavyeden tek elle hızlıca girilebilmesi için 4 harfli kodlardan 3 haneli sayılara geçildi.
6. **Çift Platform (Lokal & TV/Kumanda) Eşitliği:**
   * Her motor sadece TV+telefon modunda değil, tek cihazda (`LOCAL`) da tam oynanabilir olmalıdır.
   * LOBBY durumunda canvas üzerinde 4 köşe slot kartı (`uiButtons` -> `cycleSlotType`) ve merkez `▶ MAÇI BAŞLAT` (`startNewMatch`) bulunmalıdır.
   * PC için 4 oyunculu klavye eşlemesi (WASD, Oklar, IJKL, TFGH) ve mobil için 4 köşe dokunmatik joystick tam desteklenmelidir.
7. **Tek Tip Lobi Koltuğu:**
   * Canvas-içi koltuk kartları `src/controlGuide.js` içindeki `renderLobbySeatCard` + `getStandardSeatRects` (responsive kare, `min*0.22`, 96–148px, inset 20) + `renderLobbyStartButton` (min(220)x60, şartlı yazı) ile çizilir; ölçü/stil tüm motorlarda aynıdır.
   * Konum istisnası: PONG kenar-orta kullanır (ölçü yine standart kare). Davranış (cycle zinciri, tap hook, bot kuralları) motora aittir, helper sadece çizer.
8. **Arayüz Sistemi (token → helper → erişilebilirlik):**
   * `src/ui/tokens.js` (renk/tipografi/ölçü sözlüğü, CSS `:root` ile aynı değerler, `getDisplayProfile`, `shouldShowVirtualControls`) + `src/ui/hud.js` (`renderTopPill`, `renderAdaptiveScoreboard`, `renderEntityHUD`, `renderCornerScores`, `renderRoundBanner`, `renderMatchOver`) + `src/ui/motion.js` (`prefersReducedMotion`, `motionScale`, `pulse`).
  * `getDisplayProfile` yalnız **UI** ölçeği (`baseUnit`/`safePadding`) üretir. Saha içi varlık ölçeği burada **değildir**: eski `entityScale` alanı hiçbir motor tarafından okunmadığı için kaldırıldı, yetkisi `playfield.js` → `arena.unit` + `fieldPx`/`fieldRadius`/`fieldSpeed` oldu.
   * Final state adı tektir: `MATCH_OVER` (PONG/BOMB/HEIST/CROWN `GAME_OVER` birleştirildi). DUEL fazları (`STANDOFF/TENSION/SIGNAL`) oyun mekaniğidir, korunur.
   * Oyuncu paleti tektir: `UI_COLORS.players` (DUEL kanonik palete bağlandı, TV↔kumanda eşleşir).
   * Tematik istisnalar: DUEL skor şeridi/sinyal dili + CROWN final kutusu (ölçüleri standart, kutu dili oyuna özel).
9. **Girdi Sertleştirme (TV_CONSOLE öncelikli, bütçeler sabit):**
   * Kumanda analog akışı taşıma-bağımsız tek noktada kısılır (`gamepad.js:_sendAnalog` — 50ms + ölübant PONG 0.003 / joystick Δ 0.02); `JOYSTICK_MOVE` ve `AIM_MOVE` ayrı bütçelerdedir, böylece sağ aim sol hareketi starve olmaz. `AIM_PRESS`/`AIM_RELEASE` discrete bypass'tır; aim paketleri `seq` taşır, host eski/out-of-order paketi uygulamaz. Aktif sağ joystick 200ms keepalive ile host stale-input temizleyicisine bağlı kalmaz. Sunucu/Supabase relay ikinci sigortadır (slot+aksiyon başına ~30Hz + 64KB `bufferedAmount` atlama).
   * Kopan kumanda "nötrlenir + koltuğu tutar": `slotManager:clearRemoteSlot` (joy/isDriving/steer sıfırlar; isim/skor/kind korunur) — `onPlayerLeft`, sayaç başı, lobiye dönüş ve 1.5s analog-sessizlik süpürücüsünde çağrılır.
   * WS kopma gözetimi Supabase ile simetriktir (30s watchdog + üstel geri çekilmeli auto-rejoin, maks 5); BOMB/HEIST/CROWN `handleRemoteInput` ölü-slot guard'ı TANKS/CURVE/PONG ile aynıdır.
10. **Kontrol Eşleşmesi (kumanda↔motor + lokal klavye):**
   * 7/7 telefon kumandası motora doğru konuşur. HEIST `gemCarrier` alanı motorda hiç yoktu → rozet söküldü (kumanda skor+süre şeridi, pakette `timeLeft` durur). BOMB `carrier:-1` artık `BOMBA BOŞTA` gösterir (`P0` etiketi kapandı).
   * Klavyesi olmayan motor kalmadı: TANKS (bas=TUT/sür, bırak=dur+ateş + `driveOwner` sahipliği — bırakma başka kaynağın sürüşü ezmez) ve CURVE (eklemeli `keyboardSteer`, dokunmatik basılıyken klavye bırakması ezmez) BOMB desenini izler. DUEL klavyeye `Enter/O/B` eklendi (P2/P3/P4).
   * Kontrol yüzeyi tercihi: `bp_control_surface` (`mobile` varsayılan / `tabletop`) LOCAL'da tek oyunculu mobil kumanda ile aynı cihazda çok oyunculu masa-ortası canvas katmanını seçer. Dokunmatik olmayan cihazlarda görsel yüzey açılmaz; klavye authority girişini korur. TV/ONLINE authority-local dokunmatik köprüsü bu ayardan bağımsız çalışır.
   * PONG dokunmatik `isPlayerActive` artık botu dışlar (klavyeyle aynı kapı). Ölü dallar silindi: `TANK_MOVE`, CROWN `JOYSTICK/MOVE/DASH` aliasları.
11. **Faz A — Çökme + kritik mantık (tarama raporu):**
   * DUEL `ROUND_OVER` filigranı tanımsız `reactionTimes` okuyordu → `playerStatus[].reactionMs` (çökme kapandı).
   * WS sunucu rol kapısı: `HOST_ONLY_MSG` seti (`vitePluginWs`) + `roomManager` metod guard'ları — kumanda maç başlatamaz/sahte skor basamaz.
   * HEIST kumbara bağlandı: 30sn/15sn spawn + sekme fiziği + omuz-vuruşu (`hitPiggyBank`, 3 can → 5 COIN + 1 DIAMOND) + render. Beraberlikte/boş rauntta skor yok (`roundTied` + 🤝 bandı).
   * BOMB/HEIST `initPlayers` CROWN `existing?.name` desenine çekildi (raunt başı isim silinmez).
12. **Faz B — Güvenlik + validasyon (tarama raporu):**
   * Oda kodu çakışma kalkanı: host 5sn'de `HOST_ANNOUNCE` ilan eder, kumanda JOIN'i ilan edilen `hostId`'ye kilitler (2+ host → çakışma hatası, 0 → eski-host uyumu).
   * İsim tek kaynak (`net.js:cleanPlayerName` + sunucu `cleanSlotName`): trim/upper/12 + etiket temizliği; dolu isim `·2` suffix alır; reclaim kalıcı `clientId` ile (canlı slot gasp edilemez); skor şeridi + koltuk kartı `escapeHtml`.
   * WS `joinRoom(clientId)` + ölü-soket reclaim + disconnect'te `ready=false` (sokak reclaim edildiyse dokunmaz). Kumanda JOIN + host SET_NAME aynı temizlikten geçer.
   * Girdi denetimi: WS + Supabase şema/aralık (`isValidInputData/isValidRelayInput`), discrete rate-limit (FIRE/DASH/TACKLE 100ms, SWITCH 500ms, READY 300ms…), emoji/boyut budama; `SWITCH_SLOT` host kapısı (aralık + bot hedef/kaynak reddi) ve yalnız LOBBY/STAGING fazında kabul; motorlarda `finite/clamp` derinliği.
   * Uzak tetikleyicilere `PLAYING` kapısı: TANKS `attemptFire`, BOMB `triggerDash`, HEIST `triggerTackle` (CROWN'da vardı).
13. **Faz C — Oda akışı yarışları (tarama raporu):**
   * WS hayalet süpürücü: 10sn yoklama, >20sn sessiz + ölü soketli slotu boşa çıkarır (`ready=false` dahil); INPUT/READY/REACTION `lastSeen` tazeler; reclaim edilmiş soketin `close`'u başkasının slotunu boşaltmaz.
   * İsim tazeliği: `notePlayerName` (iki relay) + kumanda `saveName` — re-join güncel isimle döner.
   * Ready atomik: WS staging/game/lobby geçişlerinde `ready` sıfırlama + `SLOTS_UPDATE` birlikte; Supabase `startStaging/startGame` aynı; sayaçta (`seatsLocked`) gelen READY host'ta yoksayılır.
   * Sayaçta geç katılım: `onPlayerJoined` STAGING + güncel tik yeniden basar.
   * Atomik rotate `[2,3,1,0]`: tek permütasyon, kumanda başına tek `SLOT_CHANGED` + tek `SLOTS_UPDATE`; bot varsa iptal; skorlar host'ta yerelde döner (`ROTATE_SEATS` host-only).
   * Supabase auto-rejoin: watchdog kopuşunda 5× üstel retry, kalıcı `clientId` ile koltuk reclaim.
14. **Faz D — Performans (tarama raporu):**
   * CURVE iz ızgarası: 48px hücre + damgalı sorgu (`forEachSegmentNear`), çarpışma + bot raycast aynı aday kümesi; 24K emniyet supabı, makas budaması tembel-rebuild. Oyun kuralı aynı.
   * Yayın: `ctx` tekil önbellek; paket her kare kurulur ama `stringify` yalnızca kirlenme/125ms'te (sığ `samePacket` ön kontrol — anında-iletim korunur).
   * Bundle: `vendor-supabase` + `vendor-qr` ayrı chunk (önbellek/paralel); lobi çiplerine `loading=lazy`.
   * Ses: paylaşımlı noise tamponu (`getNoiseBuffer`) — ateş başı üretim yok.
   * Kumanda: `_el` önbelleği + diff'li yazım (şerit/skor/ralli/durum aynıysa DOM'a dokunulmaz).
   * SW v11: oyun görselleri precache + 60 kayıt sınırı + `?join=&mode=online|tv` navigation fallback + yeni-sürüm toast'ı.
   * Not: `npm run build` çıktısı tamamlanıp süreç canlı kaldığında kabuk zaman aşımına düşebilir (WS eklentisi) — çıktıdaki `✓ built` esastır.
15. **Faz E — UX, a11y, bakım (tarama raporu):**
   * Metin/sınıf: pause başlığına CROWN, kumanda/çip alt'ları oyun adı, rozet sınıfı CSS ile eşleşti, `motionScale` `addTrauma`'ya bağlandı.
   * Davranış: CROWN 4-durumlu slot döngüsü (bot_god AI'da vardı), BOMB lobide seçilen harita korunur, PONG paketi gerçek skoru (`setScores`) yayınlar.
   * a11y: zoom kilidi kalktı (max 5x), altın `:focus-visible` halkası (TV + kumanda), kontrast tokenları koyulaştı, kritik butonlar ≥44px.
   * Bakım: `cooledAction` + `canSwitchSlot` (kumanda), CdTimer mount-abort ile temizlenir.
   * Resize: LOBBY dışı tam kurulum yok — 5 motor + PONG orantılı `remapPoint` (BaseGame) ile taşınır.
   * Klavye: `isLocalInputActive` (BaseGame + setGameMode) — pasif motorun tuşu yanlış oyunu tetiklemez.
   * Tank botu aktif direksiyon (kısa-yön dönüş + duvar kaçışı), boşta spin korunur.
   * Kalan: ses `playTone` birleştirme + DUEL ok-tuşu gerilimi (sözleşme literali korundu).
16. **Cihaz-başı karakter + yazısız kimlik (avatar senkronu):**
    * Her cihaz tek profil tutar (`brutalparty.avatar.profile`); ilk açılışta rastgele renk — herkes default kırmızıyla gelmez. Atölye 4 sekmelidir (renk/yüz/aksesuar/desen; TV menü + kumanda lobi aynı modal).
    * Kumanda profilini relay ile taşır (JOIN/`AVATAR_UPDATE`); host sanitize eder (`sanitizeAvatar`), yüz kayıt defterinden (`slotIndex` → avatar) okunur. Renk koltuğa değil oyuncuya aittir (takasta taşınır).
    * Saha içi yazı yasaktır: kimlik = display rengi + pip (koltuk no kadar nokta) + köşe/koltuk pozisyonu. `renderTextLabel` kapısı kaldırıldı.
    * Ağ bütçesi korunur: avatar ~40B, JOIN/slot yayınlarında taşınır; 8Hz dirty-check + discrete 1sn kısma geçerlidir.
    * LOCAL (tek cihaz): yüz cihaz profilinden, renk koltuk başınadır (`brutalparty.local.seatColors`, kalıcı). Lobi kartındaki renk noktasına dokununca sıradaki boş renge geçilir; yeni insan koltuğuna otomatik boş renk atanır. Nokta butonu tap dispatch'te karttan önce gelir (ilk eşleşme kazanır).
17. **Ortak arena/fizik/power-up kiti (`src/core/`, refactor Faz 3-7):** Motorlar tekrar eden mantığı kopyalamaz, `src/core/`'dan `import` eder: `physics2d.js` (clampToArena / resolveAABB / pointBlocked / updateMovers / distToSegmentSquared / segmentCircleIntersection / segmentAabbIntersection / getProjectileSubsteps / normalizeAngle), `playfield.js` (computePlayfield + FIELD_PRESETS + fieldPx/fieldRadius/fieldSpeed), `roundLifecycle.js` (timeout / all-survivor draw), `pickupSystem.js` (spawnPickup / collectPickups / tickPickupTimers + EFFECTS), `playerEntity.js` (createPlayer / tickEffectTimers / advancePlayer), `avatarInGame.js` (drawGameAvatar / normalizeExpression). `arenaKit.js` `drawObstacle` + `PICKUP_META`/`drawPickup` **ve** `buildLayout(name, arena)` düzen presets servis eder (`pillars`, `columns4`, `cross`, `crossfire`, `scatter`, `bunker`, `courtyard`, `split`). Motor kendi `buildMap()`'i yalnız oyuna özgü ek katmanları/meta'yı tutar (crown conveyor/bumper/movingHazards gibi); ortak düzen geometrisi preset adıyla çağrılır (archer `pillars/cross/scatter`, bomb `columns4/bunker/crossfire/courtyard/split`). **Açık iş:** tanks/laser/snake/curve/clone/collapse `drawObstacle`/`drawPickup` görsel kitine taşınacak; ninja/collapse/snake/clone/tanks/zone/crown pickup spawn/collect kopyaları `pickupSystem`'e bağlanacak (metadata `PICKUP_META`'da hazır).
18. **Saha ölçeği tek kaynağı (`src/core/playfield.js`, Eylül 2026):** 15 motorun `resize()` içinde kendi kopyasını taşıdığı kenarlık/arena hesabı tek bir `computePlayfield(w, h, preset)` çağrısına taşındı. Altı kenar biçimi `FIELD_PRESETS` veri tablosunda: `standard` (PONG/ARCHER/BOMB/HEIST/CURVE/NINJA/SNAKE/LASER/COLLAPSE/CLONE), `roomy` (HORDE), `crown`, `flat` (TANKS), `dense` (ZONE), `racing` (RACE).
     * Taşıma **sayısal olarak nötr** oldu: `tests/playfield.test.mjs` her preset için migration öncesi formülleri (13 viewport) karşılaştırır; `tests/playfieldEngines.test.mjs` 15 motoru SSR ile yükleyip arena eşitliğini, DPR backing store'un değişmediğini ve maç ortası resize'da varlıkların saha içinde kaldığını doğrular.
     * **DPR hatası giderildi:** RACE `canvas.width/height` okuyup **yazıyordu** (cihaz px'iyle arena hesabı + `ctx.scale(dpr,dpr)`'ı silme → kalıcı 1x bulanık). 12 motorun arka plan `fillRect`'i ve COLLAPSE'in uçurum ızgarası da device px kullanıyordu (telefonda ızgarayı ~3x sıklaştırıyordu). Artık tümü `this.viewport` (CSS px) okur; `main.js` canvas boyutunun tek sahibidir.
     * `tokens.js`'teki ölü `entityScale` silindi; saha içi ölçeğin otoritesi `arena.unit`.
     * **Stage 2 — telefon yatayda dikey pay geri kazanıldı:** kompakt yatay (`width > height` ve `getDisplayProfile().type === 'MOBILE'`, yani kısa kenar < 540px) viewport'ta dikey kenar boşluğu `max(10, floor(h*0.03))`'e iner (393px yükseklikte 32px → 11px). Gerekçe: kumanda kuşağı yalnızca sol-alt/sağ-alt **köşeleri** kaplar, orta bant zaten serbest; sabit 32px kısa ekranda dikeyin ~%16'sını boşa yiyordu. Kazanç: saha yüksekliği motor başına **+%6.6 … +15** (en çok `roomy`/HORDE +%15, en az `dense`/ZONE +%6.6 çünkü ZONE zaten 4.5% kullanıyordu). `racing`/RACE'de kısa kenar yüzdesi %8 → %4 iner, sabit 30/20px bantlar (HUD çerçevesi) yerinde kalır → +%11. **Dokunulmayanlar:** masaüstü/TV/tablet **%0.0**, telefon **portrait %0.0** (12% payı döndürme istemini ve portre kontrol yığınını temizler), yatay **kenar boşluğu** (yan duvarlar görsel bütünlüğün parçası). Alan artık tam taşar (full-bleed) ve kontrol kuşağı saha üstüne biner; okunabilirlik için `gamepad.css` landscape bloğuna geri çekilmez bir "control-deck scrim" eklendi.
     * **Güvenli alan (`tokens.js` `getSafeAreaInsets`):** Canvas JS `env(safe-area-inset-*)` okuyamaz; sabit konumlu görünmez bir probe üzerinden CSS custom property olarak okunur (değerler döndürmeyle değiştiği için cache viewport boyutuna bağlı). Kompakt yatayda kenarlar **cihazın güvenli alanı** ile birleşir: yatay `max(preset, 3+notch)`, dikey **ayrı ayrı** `max(3, 3+top)` / `max(3, 3+bottom)`. Çentikli iPhone'da yatay notch 47-59px, eski sabit 34px tahmininden **geniş** olduğu için oyuncular çentik altında doğuyordu — bu bir hata düzeltmesidir, alan kazanımı değil. Home indicator yalnız altta olduğu için üst kenar taban payda kalır (~21px gereksiz kayıp olmasın diye kenarlar ayrı hesaplanır). Masaüstü/tablet/portrait güvenli alanı hiç sorgulamaz.
     * **Play-state chrome kuralı (Stage 2 sonrası):** Stage 2 saha üst payını 32px → ~3px indirdiği için **`arena.top`'a göre konumlanan her UI öğesi** yeniden ele alınmalıdır. Yapılanlar: (a) `renderControlGuide` artık `duringPlay` opsiyonu alır ve kompakt yatayda oynarken **çizmez** — üst şeridi (`y=6`, ~28px) sahayı %7 kalıcı kapatıyordu, bu bir regresyondu (2px örtüşme → 28px); RACE bu bayrağı geçirir, LOBBY şeridi korunur. (b) `renderArenaRailTally` mobil skor rayı `arena.top - barH/2` ile **ekran dışına** çiziliyordu; görünür kalana kadar kırpılıyor. (c) `playfield.js` `isCompactLandscape(w,h)` UI yerleşimi için de dışa açıldı — cihaz sınıflandırması tek kaynaktan okunur.
     * **Kontrol referansı menüye taşındı:** kaldırılan üst şeridin bilgisi artık tek butonun açtığı mola panelinde (`#pause-controls-section` / `pauseModal.js renderPauseControls(mode)`). Metin kopyalanmaz: `controllers/controllerGuide.js` `getControllerGuide()` (bu dosya oyun dışında **hiç kullanılmıyordu**, tam bu iş için yazılmış) + `inputMaps` `getSlotKeys`/`KEY_LABELS` tek kaynaklarından türetilir. Dokunmatik taraf **yalnız SVG ikon** (`getTabletopIconSvg`, `controllerTemplates` ile aynı desen) — locale'deki `pad.*` etiketlerinde ham OS emojisi bulunduğu için metin yüzeye çıkarılmaz. 15 oyunun tamamı için guide üretildiği doğrulandı.
     * **Skor rayı köşeye taşındı:** `renderArenaRailTally` kompakt yatayda üst-orta yerine **sol üst köşeye** yaslanır (sağ üst köşe DOM chrome'una ve çentik tarafına bırakılır; sahanın sol kenarı zaten safe-area ile temizlenmiştir). Masaüstü/tablette üst duvar ortası aynen korunur.
     * **Stage 4 — `buildLayout` en-boy duyarlı (`LAYOUT_TUNING`):** presetler kare alanda yazıldı (`size = min(w,h)` cinsinden, merkezden) ve 21:9 telefon yatayında sahanın yalnız %26-41'ini kaplıyordu. Artık iki aşamalı: **(1) YAY** `spread = 1 + (aspect - designAspect) * spreadGain`, kare saha'da birebir 1.0 döner (eski davranış korunur, testle kilitli), geniş sahada konumları açar; blok **boyutları değişmez** (oran bozulmaz). **(2) YOĞUNLUK** `aspect > densifyFrom` iken preset'in kendi bloklarından `ringScale` küçültülmüş ikinci bir halka eklenir — yay sonrası "az sayıda minik blok" hissini telafi eder, yeni geometri uydurmaz. `scatter`/`bunker` gibi kendi `buildMap`'i olan motorlar preset yolunu kullanmıyorsa dokunulmaz.
     * **Sonuç (genişlik kapsaması, eski → yeni):** telefon 852×393'te `pillars` %30→%62, `columns4` %28→%59, `crossfire` %39→%80, `bunker` %38→%86. Cihazlar arası **oran** sabit: telefon (2.03) ve tablet (1.50) neredeyse aynı yüzdeyi veriyor, masaüstü (1.86) arada — "mobilde farklı hissettirmesin" hedefi bu yüzden sağlanıyor. `maxSpread` 2.6 ile aşırı oranlarda bloklar uç noktada yığılmıyor.
     * **`drawObstacle` kromu ölçekli:** 3px çerçeve / 5px gölge / 8px perçin iç boşluğu sabitken 41px'lik mobil bloğun siluetini yiyordu. Artık `u = clamp(min(w,h)/48, 0.42, 1.5)` bloğun KENDİ boyutundan türetiliyor (sahadan/cihazdan bağımsız, her boyutta aynı görsel oran); bevel ve perçinler bloğu taşıyabilecek kadar büyükse çiziliyor. Aynı desen `drawPickup`'ta da geçerli.
     * **Stage 3a — gövde + hız ölçeği (7/15 motor):** `fieldRadius` (göreli taban) + `fieldSpeed` ile dönüştürüldü: BOMB, HEIST, ARCHER/NINJA/CURVE (hız), HORDE, ZONE, TANKS, RACE, CROWN, PONG topu. RACE'de `RACE_TUNING` hem zaman hem uzam içerdiği için iki ayrı okuyucu ayrıldı (`this.px` / `this.spd`): **süreler ölçeklenmez**, px ve px/s ölçeklenir. Ölçülen gövde/saha oranları masaüstü→telefon: RACE %1.68→%1.68, BOMB/HEIST %3.78→%3.78, HORDE %2.40→%2.40, TANKS %3.20→%3.20 (hepsi **1.00x**). `hordeAI` kaçış mesafesi (58/92px) de ölçeklendi: sabit px telefonda sahanın %24'üydü, bot çok daha erken kaçıyordu.
     * **Ölçülebilir kabul kriteri:** gövde saha kısa kenarına göre sabit oran işgal eder **ve** `size / speed` geçiş süresi cihazdan bağımsızdır (BOMB: masaüstü 952/175 = 5.44sn, telefon 387/71 = 5.44sn). İkincisi olmadan küçülen gövdelerde oyun ağırlaşır — hissedilen farklılık tam olarak budur. `tests/playfieldEngines.test.mjs` bunu 15 motor için ölçüyor ve oran tablosunu CI loguna basıyor.
     * **Stage 3b — ARCHER + NINJA üçlü değişiklik (tamamlandı):** `ARCHER_RADIUS = 18` (archer.js) ve `NINJA_RADIUS` (ninjaView.js'ten import) modül sabitleriydi; çarpışmada, mermi çıkışında, isabet tespitinde ve çizimde kullanılıyorlardı. ARCHER telefonda saha yüksekliğinin %4.65'ini, masaüstünde %1.89'unu kaplıyordu (**2.5x şişik**). Üç parça birlikte çevrildi: (1) motor oyuncu nesnesine `radius: fieldRadius(arena, TASARIM, 0.02)` koyar, (2) `*View.js` sabiti değil `player.radius` okur (`R` yerel değişkeni; `NINJA_RADIUS` yalnız eski paket fallback'i), (3) world packet `radius` alanını taşır ve validator opsiyonel kabul eder.
     * **View dosyaları için kural:** `*View.js` host VE kumanda client'ı tarafından **ORTAK** kullanılır; client dünya uzayını `fitWorld` ile sığdırır. Bu yüzden uzamsal ölçek **host'ta bir kez** yapılır, view'de **asla** tekrar ölçeklenmez — aksi halde çarpışma ile görsel ayrışır ve kumanda ekranı host'u yansıtmaz.
     * **Stage 3c — krom + AI algısı (tamamlandı):** (a) `avatarInGame` **15 motorun ortak kodu** olduğu için tek değişiklik hepsini düzeltti: sabit 3px çerçeve, masaüstündeki 36px avatarın yarıçapının %8'i iken telefondaki 12px avatarın **%25'i** idi. Artık `max(1.2, radius*0.12)`. (b) `bombView` efekt kromu: sabit `radius+6/+7/+8` halkalar ve 10px yazı, telefonda (yarıçap ~15px) halkaları gövdenin **1.4-1.8 katına**, yazıyı gövde çapının %69'una itiyordu; `u = radius/36` normalize ölçeği eklendi (u=1'de değerler aynen korunur). (c) LASER'ın view'daki 19/24px halkaları ve 14px avatarı `player.radius`'a bağlandı; motor + view + packet üçlüsüyle dönüştü. (d) **AI algı sabitleri** ölçeklendi: `tankAI` `dodgeRadius 80/130` (telefonda saha kısa kenarının %21/%34'ü) ve mermi uçuş süresi öngörüsü; `crownAI` `threatRadius 280/320` (telefonda saha **genişliğinin** %35-40'ı — "uzaktaki oyuncu bile tehdittir") ve `centerFar`. Bunlar oyuncuya görünmese de bot davranışını cihazdan bağımsızlaştırıyor.
     * **DİKKAT — çift ölçek tuzağı:** `tankAI.estimateVelocity` içinde `t.driveSpeed` **zaten** motor tarafında `fieldSpeed` ile ölçeklenmişti; onu tekrar sarmalamak çift ölçekleme yapardı. Sadece dosyadaki ham sabitler (`285`, `220`) sarmalandı. Genel kural: bir değer `fieldX` ile yazıldıysa, onu okuyan taraf **asla** tekrar sarmalamaz.
     * **Stage 3d — CURVE + denetim (`tests/pxConstants.test.mjs`):** CURVE'de `headRadius 5` hem motorda hem view'da kopyalıydı ve çarpışmada da `5` yazılıydı; üçlü desenle dönüştürüldü (ölçeklenmiş gövde artık %0.60 → %0.60). Ardından kaynak taraması yazıldı: **varlık nesnesi literallerinde** (`speed: 175`, `radius: 24`) mutlak px kalmaması. Bu tarama bir toplu düzenlemenin **sessizce uygulanmamasını** yakaladı — Stage 3'te `curve.js` için yazılan toplu script "done" demiş ama hiçbir şeyi uygulamamıştı ve hiçbir test bunu görmemişti. Tarama üç oyuncu-hızı atlamsı buldu ve düzeltildi: **COLLAPSE `speed: 125`, SNAKE `speed: 140`, CLONE `speed: 135`**. Tasarım tabloları (`HORDE_TUNING` enemy satırları, `RACE_TUNING`) kullanımda sarmalandığı için `DESIGN_TABLES` listesinde açıkça sınıflandırıldı.
     * **Kalan taban 61:** hepsi oyuncu gövdesi **değil** — harita prop'ları (RACE yağ/engel yarıçapları 26-30, CLONE oda, CROWN pickup/hazard) ve HUD proxy yarıçapları (PONG paddle 24, TANKS mermi 10). Oynanışı değil kompozisyonu etkiler. Tarama bir **taban** olarak sabitlendi: sayı ARTMAYACAK, yeni mutlak px eklenirse test kırılır.
     * **Ölçüm düzeltmesi — gözle taban seçimi (Eylül 2026):** Stage 3'te her gövdeye "göreli taban" eklendi ama bunlar **gözle** seçildi ve tasarım payının ÜSTÜNDE çıktı: HORDE oyuncu tabanı %2.40 (tasarım %1.68 → **+%43**), chaser %2.20 (%1.68 → +%31), shooter %2.20 (%1.47 → **+%50**), tank %2.20 (%2.21 → +%0), TANKS %3.20 (%2.73 → +%17), ARCHER/NINJA %2.00 (%1.89 → +%6). Sonuç masaüstü **ve** telefonda gövdeyi şişiriyor, NPC boyut çeşitliliğini eziyor ve "oyuncu büyük / NPC küçük" hissi doğuyordu. **Tabanların hepsi kaldırıldı**: alt sınırı zaten `FIELD_DESIGN.minUnit` (0.30) veriyor. Genel kural: **taban, tasarım payından küçük olmalı; hiçbir alanda şişirebilir.**
     * **Testin kaçırdığı:** ölçüm testi 1.00x raporluyordu ve doğrudu — çünkü tabanlar *cihaz tutarlılığını* bozmuyor, *tasarım sadakatini* bozuyor. Test cihazlar arası oranı ölçüyordu, referansta tasarıma uygunluğu ölçmüyordu. `arenaLayout.test.mjs` artık **çakışma** kontrolü de içeriyor.
     * **Engel çakışması (gözle bulundu, yapısal düzeltildi):** `densify` halkası `ringOffset` ile konumu merkeze doğru 0.62 katına çekiyordu; **zaten merkezde duran bloğun (pillars'ın ortadaki karesi) kopyası yine merkeze düşüp üstüne biniyordu** — ölçülen çakışma alanın **%95'i**. Ayrıca `cross` preset'i kolların iç ucu merkez kareye girene kadar (%22, 5 çakışma) **kasıtsız** tasarım hatasıyla çakışıyordu. Çözüm preset başına ayar değil yapısal: (1) merkeze `ringMinOffset` (0.16) kadar yakın node halkaya katılmaz, (2) mevcut bir bloğa binen halka node'u elenir. `cross` kolları kısaltılıp merkezden ayrıldı (`armGap`). Sonuç: **8 preset × 5 en-boy oranı = sıfır çakışma**, teste bağlandı.
     * **ARCHER gövdesi 18 → 22px:** ARCHER'ın gövde/saha oranı (%1.89) tüm motorlar arasında en küçüktü (BOMB %3.78, CROWN %4.47, TANKS %3.20) — masaüstünde karakter diğer oyunlara göre belirgin küçüktü. 22px → %2.31.
     * **HEIST sayacı küçültüldü:** `renderArenaWatermarkTimer` yazı tavanı saha kısa kenarının %18'i (masaüstünde ~142px = yüksekliğin %15.6'sı) ve halka tabanı %14 idi. Kalıcı bir sayaç için gereğinden büyük; tavan %9.5'e, halka %10'a indi. Konum merkezde kaldı (bilgi okunur kalmalı, ilerleme halkada).
     * **Açık iş — kalan play-state chrome:** `renderTopPill` için `persistent` bayrağı eklendi: oyun boyunca sürekli görünen çubuk (RACE tur sayacı) kompakt yatayda opak kutu yerine **çıplak metne** düşer (kutu/gölge/çerçeve yok, alfa ≤0.62, 1px koyu gölge). Konum üst-orta korundu — köşeler `renderCornerScores`'un dört rozetine ait; sola yaslamak P2 çipiyle çakışıyordu. `persistent` verilmezse (TANKS sudden death gibi geçici alarmlar) çubuk her boyutta çizilir.
     * **Düzeltilmiş kayıt — köşe rozetleri çakışmıyor (yanlış kayıttı):** `renderUniversalScoreboard` `layout:'corners'` için "iki köşe chip'i çakışıyor" notu bu oturumda ÖLÇÜLDÜ ve **yanlış çıktı**: kart geometrisi (`cardW ≤ 0.22*width`) 10 viewport'ta (1920x1080, 852x393, 1180x820, 2560x1080, 1024x768, 2400x500, 667x375, 900x900, 3440x1440, 1600x900) hiçbir çift için örtüşme üretmiyor ve hiçbir kart saha dışına taşmıyor. O gördüğüm görsel, canvas HUD'u değil **lobi koltuk kartlarıydı** ve viewport kenarında kırpılıyordu. Uydurma düzeltme yapılmadı.
     * **HORDE oyuncu çevresi HUD'u da yarıçapa bağlandı:** düşman can çubuğundaki hatanın **oyuncu tarafındaki aynı hali** — cooldown halkası `radius: 15`, can pips'leri `player.y - 27`, cephane çubuğu `32×24` px'te MUTLAKTI. Tasarım boyutunda doğru, telefonda gövdenin (5.7px) 4.7-5.6 katı ötede duruyordu; üçü birden oyuncunun çizilen yayılımını gövdenin **~3.2 katına** çıkarıyordu. `hu = R / 14` ile ölçeklendi: masaüstü tasarım birebir korunur, küçük sahada birlikte küçülür. Silahın `WEAPON_REACH` (0.7) katsayısı da aynı sınıftan: tüm geometri 16px gövdeye göre yazıldığı için silah ucu zaten **2 gövde yarıçapı** ötedeydi ve ölçekleme bu oranı koruyordu. `WEAPON_REACH` yalnız erişimi kısaltır, kalınlığı değil.
     * **Ölçülebilir olmayanı ölçmemek:** saha içi piksel oranını (avatar vs düşman) ölçmek için beş deneme yapıldı ve HEPSİ başarısız oldu: (a) "boş piksel" renk eşiği tutmuyor — saha ızgara deseni + hafif gradyan içeriyor; (b) iki kare farkı (oyuncu varken/yokken) avatarı gizlemiyor, `alive=false` çizimi kaldırmıyor, fark yalnız 79-113 piksel; (c) macenta zemin `render()`'ın arka plan boyamasıyla eziliyor; (d) tarama penceresi 4R/8R/12R denemeleri doydu; (e) `drawBrutalAvatar` **5** parametre alıyor, altıncıyı geçirmek bayrağı sessizce düşürüyor. Çalışmayan araç bırakılmadı — `probe` yalnız **izole** çizim ölçümünde (`probe=extent`) güvenilir kabul edildi, oyun içi oran için dürüstçe "ölçemedim" deniyor.
     * **Geçilebilirlik sözleşmesi (yeni — `minPassage`):** "Engeller çakışmıyor" bir koridorun **geçilebilir** olduğu anlamına gelmiyor. Ölçülen iki ayrı hata: (1) `cross` preset'inin dikey geçişi 10px kalıyordu, karakter çapı 44px — o yol **baştan beri matematiksel olarak kapalıydı** (`armGap` kolların kalınlığından türetiliyordu, oyuncunun boyutundan değil). (2) `densify` halkası yalnız *çakışmayı* eliyordu; 3px açıklıkla duran bir blok "çakışmaz" ve süzgeçten geçer — en dar geçiş halkasız preset'lerde 152-371px iken halka ile **19-68px'e** düşüyordu (8 preset'in 7'si). Çözüm: `buildLayout(name, arena, { minPassage })`; motor kendi **en büyük gövdesinden** türetip geçer (ARCHER oyuncu 22, HORDE tank 21, BOMB 36 → `radius * 2.4`). `tests/helpers/passability.mjs` `discReachability` (ızgara flood fill) + `narrowestPassage` ile 7 oyun × 8 preset × 7 en-boy oranı kilitlendi.
     * **Halka artık boşluğu arar (yerleşim, reddetme değil):** sabit `ringOffset` (0.62) hem çakışma hem seyreklik üretiyordu. Halka artık merkezle asıl node arasındaki ızgara adaylarını (`ringCandidates`) dener ve `minPassage` açıklığı veren en iyisini seçer. Kare sahada yer olmadığı için halka eklenmez (tasarım korunur), geniş sahada ortadaki bantlara yerleşir. `cross` alan kaplaması %3.3 → %3.8, blok 6 → 7-8. Ayrıca `dropOutsideArena` saha **tamamen** dışında kalan bloğu eler (görünmez engel yalnız yer kaplar; kısmen taşan mover atılmaz).
     * **HORDE "oyuncu büyük" algısının kaynağı çizimdi, yarıçap değil:** yarıçaplar zaten eşitti (oyuncu 16, chaser 16). Ölçülen kusurlar: (1) `drawGameAvatar(..., 15, ...)` **sabit 15px** — telefonda çarpışma yarıçapı 6.5px iken gövde 15px çiziliyordu, yani **1.7 kat** (artık `player.radius`). (2) `drawPlayerWeapon` tüm geometrisi mutlak px (`fillRect(13,...,19)`, savurma `arc(10,0,54)`): gövde 16px iken silah 32px, telefonda 6.5px iken 32px = **3.6 kat** (artık `u = radius / 16`). (3) Düşman can çubuğu `Math.max(20, r*1.5)` mutlak tabanla telefonda 20px'de sabit kalıyordu (artık tamamen göreli). (4) `drawHordeStatus` chip'i kompakt yatayda **sola yaslanıyor** ama metni `arena.cx`'e göre ortalıyordu — metin kutudan taşıp sol duvarın üstünde kesiliyordu; kutu artık `measureText` ile içeriğine göre genişliyor ve metin kutunun kendi merkezine hizalanıyor. Chip yüksekliği/yazı boyutu da `u = size/952` ile ölçekleniyor (telefonda saha yüksekliğinin %11'i → %4.7).
     * **Görsel doğrulama aracı — `tests/helpers/render-harness.html`:** motoru herhangi bir boyutta gerçek canvas'a çizer (`?game=ARCHER&cells=3&t=2500&fit=0.7`). `innerWidth/innerHeight` viewport'a bağlı olduğu için telefon yatay (844×390) bileşimi pencere ayarlanmadan incelenebilir; `notch=` güvenli alanını, `seats=`/`match=` lobi-oynanışını simüle eder. Ölçüm raporu sayfadaki `.meta` satırına JSON olarak yazılır. `?probe=extent&r=16` **yalnız izole** çizimde güvenilir (avatarın/accessory'nin çizilen bbox'ı). **Bu oturumda ilk kez piksel düzeyinde doğrulama bu araçla yapıldı** ve `drawGameAvatar(...,15,...)` gibi üç hata ancak görsel olarak yakalandı — sayısal testler geçiyordu.
     * **Mutlak px denetimi SIFIRLANDI (61 → 0, `tests/pxConstants.test.mjs` tabanı 0):** "ölçeklenmemiş mutlak px" hata sınıfı üç kez gerçek hataya dönüştü (HORDE düşman can çubuğu, HORDE oyuncu gövdesi + HUD kümesi, CROWN/CLONE/RACE/TANKS/PONG). Kalanların hepsi ölçüldü ve çevrildi:
       · **RACE** (2.4× mobil şişme): yağ lekesi 26-30, nitro pad 40-45×28, spinner 110-140, EMP 10, başlangıç ızgarası 32/28 → `this.px(...)`. Konumlar ve checkpoint zaten oranlıydı, dekorlar değil.
       · **TANKS**: mermi 4.5, HUD proksi 10 → `fieldRadius`.
       · **PONG**: HUD proksi 24 → `fieldRadius`. (Top zaten `fieldRadius(arena, 16, 0.015)` idi.)
       · **CROWN**: 36 harita yarıçapı, oyuncu/taç 20, mürekkep 22, 6 konveyör hızı (170/180) → `fieldRadius`/`fieldSpeed`.
       · **CLONE**: 6 oda yarıçapı, kon hızı 80+25 → `fieldRadius`/`fieldSpeed`.
       **ZATEN DOĞRU OLANLAR (dokunulmadı):** PONG topu (taban %1.68'in altında), LASER/SNAKE harita tabanları (`Math.max(abs, oran)`, tasarım payının çok altında → bağlamıyor), `DESIGN_TABLES` bildirimleri.
       **Yanlış pozitif düzeltmesi:** tarayıcı kendi düzeltmesini flagliyordu (`radius: 15 * hu`). `SCALED_LITERAL` deseni eklendi — aynı ifadede ölçek çarpanıyla çarpılan literal zaten orantılıdır. Yanlış alarm üreten koruma zamanla yok sayılır, o zaman asıl amacını kaybeder.
       **Koruma doğrulandı:** geçici olarak `zone.js`'e `radius: 42` eklendi → test `1 new untriaged ... (now 1, baseline 0)` ile kırdı; geri alınınca 247/247. Sıfır taban + çalışan negatif test.
       **Constructor tuzağı (test yakaladı):** CROWN tacının yarıçapı constructor'da `fieldRadius(this.arena, ...)` ile sarıldı — ama constructor'ın el yapımı arenasında `unit` yok, sonuç `NaN` ve taç yere düşünce toplanmıyordu. Tasarım px constructor'da kaldı, türetme `resize()`'a taşındı. **Genel kural: `fieldRadius`/`fieldSpeed` çağırmadan önce `arena.unit` dolu olmalı; `resize()` çalışmadan önce kullanıcı güvenme.**
     * **HORDE düşman yarıçapları 1.22x büyütüldü (14/16/18/21 → 17/20/22/26):** 1. dalga / 1. turda `healerChance`/`tankChance`/`shooterChance` sıfır olduğu için sahadaki **tek düşman tipi chaser**'dır — yani bu tablo ilk izlenimi doğrudan belirliyor. Ölçülen şikâyet: "ilk rakipler biraz küçük olması normal, ama bu kadar değil". Oyuncu 16px **değişmedi**; oranlar oyuncu/shooter 0.94, oyuncu/chaser 0.80, oyuncu/tank 0.62. `BOSS_BASE` aynı katsayıyla ölçeklendi (32/28/39/31 → 39/34/48/38), boss/base ilişkisi korunuyor. Düşman büyüdüğü için `minPassage` tabanı da otomatik yükseldi (`ENEMY_BASE.tank.radius` → masaüstünde 52px geçiş) ve geçilebilirlik testleri hâlâ geçiyor.
     * **`compactSilhouette` — görsel şişkinliğin kaynağı dekordu, yarıçap değil:** ölçülen çizilen bbox (`render-harness.html?probe=extent&r=16`): gövde **36x37**, `HALO` **36x45** (+%22 dikey), `WINGS` **49x40** (+%36 yatay), `BOLT`/`CROWN`/`NINJA_COWL` 36x37, düşman chaser 32x32. Cihaz profili `HALO` taşıdığı için oyuncunun tüm dikey taşması haloydu; çarpışma yarıçapı 16'ydı ve doğruydu. `SILHOUETTE_OVERFLOW = {HALO, WINGS}` (characterRenderer'da) + `drawGameAvatar(..., { compactSilhouette: true })` bayrağı: yalnız **taşan** aksesuarları bastırır, gövdeyi küçültmez, listede olmayan kimliğe dokunmaz. Ölçülen sonuç 36x45 → **36x37** (1.41× → 1.16×). Kural `isMicro` (yarıçap < 5) satırıyla **tek bildirimde** birleştirildi. `tests/avatarSilhouette.test.mjs` çizim çağrılarını kaydeden sahte ctx ile en üst noktayı ölçüyor ve listeyi kilitliyor.
19. **İkonografi ve Görsel Dil Standardı (Lucide Neo-Brutalist):**
    * Hem masa-ortası canvas (Tabletop 2D) hem de mobil kumanda (Gamepad DOM) butonlarında işletim sistemi emojileri (⚡, 🚀, 💬, ⛶ vb.) doğrudan kullanılmaz.
    * Tek kaynak `src/core/tabletopIcons.js` modülüdür (Canvas için `drawTabletopIcon`, HTML/DOM için `getTabletopIconSvg`).
    * Kumanda aksiyon butonlarında metin başlığı (BOOST, DASH, DRIVE vb.) yer almaz; ortalanmış, büyük ve net Lucide SVG ikonu kullanılır.
20. **Online world-view katmanı (PONG/RACE/CROWN + SNAKE pilotu → ARCHER → BOMB → HEIST → TANKS → CLONE → NINJA → LASER → ZONE → COLLAPSE → CURVE → HORDE, generic çekirdek):**
    * Cross-cutting altyapı generic'dir ve oyun başına tekrar yazılmaz: `GamepadWorldView` (src/ui/gamepadWorldView.js), `src/core/worldInterpolation.js` (stable-id blend + delayed buffer), 30 Hz broadcast döngüsü (main.js `broadcastWorldStateIfNeeded`), WebRTC `world` DataChannel (webrtcManager + supabaseRelay), kumanda mount kararı (gamepad.js `meta.worldView && network.supportsWorldFrames`).
    * Oyun başına yapılan iş: `src/games/[oyun]View.js` (snapshot serializer + `isValid` doğrulama + host/client ortak draw yardımcıları — client asla simülasyon/AI import etmez) + `src/ui/[oyun]WorldView.js` renderer proxy (`createWorldViewRenderer` döndürür) + `engineRegistry`'de `worldView.load` + `worldPacket`.
    * Client presentasyonu 30 Hz transport'u 50-120 ms adaptive playout buffer ile native 60 Hz+ rAF'e taşır; hareketli alanlar stable-id ile blend edilir, uzun kayıp boşluklarında güvenli snap yapılır, extrapolasyon yapılmaz. `sentAt` transport envelope metadata'sıdır.
     * HEIST ile generic çekirdek `src/games/worldCore.js` çıkarıldı (`createWorldSnapshot` + `isValidWorldBase` + packers + `drawSquareParticles`); 4. world-view oyunundan itibaren ekleme deklaratif `extras` kaydına iner (mode + mapPlayer + extras).
    * TANKS çekirdeği iki noktada genişletti: `createWorldSnapshot` artık `list` override alır (`game.tanks` gibi `players` dışı kadrolar için); şarjör formülü `getTankAmmoVisual` olarak export edilir ve 8 Hz HUD paketiyle world draw aynı kaynaktan beslenir (host + snapshot şeklini ikisini de okur). Batch 1'de mermi snapshot'ı velocity + stable ID, intro countdown ve shrinking sudden-death alanlarını da taşır.
    * CLONE çekirdeği alpha-konvansiyonlu partiküllere genişletti (`packParticles` life→alpha fallback + `drawCircleParticles`); görev istasyonu ikonları id→registry anahtarı eşlemesiyle vektöre çevrildi (tel üstünde ham emoji yok).
    * LASER ile `mapLaserPlayers` tek-kaynak eşlemesi eklendi (host render + snapshot aynı fonksiyon; tuning parametreli, cycle yok) + `drawAlphaTexts` outline/size desteği aldı; nişan pol çizgileri saf `traceAim`'den snapshot'a taşınır.
    * Weird-game kaçış kapağı ZONE/COLLAPSE/CURVE ile kullanıldı: ZONE 64x64 grid'i RLE (`packZoneGridRle`) + `gridV` versiyonuyla sadece repaint edildiğinde client'ta yeniden kurulur; COLLAPSE 13x13 grid ham dizi olarak (169 hücre) taşınır; CURVE 24.000 segmentlik trail iki katmanlıdır — oyuncu başına son 220 `near` segment (3 bit flag + stable id + 60 Hz reveal progress ile) + eski izlerin 24x24 2-bit sahiplik maskesi (hex, 288 karakter). Üçünde de çarpışma host'ta tam çözünürlüktedir.
     * HORDE ekinde frame 28 enemy + 64 projectile + 4 tomb + 4 pickup + 4 loadout crate + 16 obstacle + 8 text + 48 particle ile bounded payload'da tutulur; host full-resolution swept collision çözerken client yalnız doğrulanmış snapshot'ı çizer.
    * NINJA ile `selfSlot` tesisatı eklendi (`GamepadWorldView` 7. render argümanı + `setSelfSlot`; mevcut renderer'lar etkilenmez): görünmezlik karşılıklıdır, yalnız kendi koltuğu hayalet kontur görür (`ghostSlots`). Uçuşan metinler snapshot dışıdır (`renderFloatingTexts` mutate eder — life += dt + splice — client snapshot'ı bozardı).
    * Overlay kontrol katmanı (`gamepad-game-stage`: canvas z-0 + `gamepad-control-overlay` z-2, transparan + `pointer-events` passthrough) oyuna özel değildir — standart `controlDefs` mount'u her world-view oyunu için otomatik gelir.
    * World-view kromu (banner/placeholder/connecting/stale + `fitWorld`) tek kaynak `src/ui/worldViewKit.js`'ten gelir. `GamepadWorldView` ilk kare gelene kadar kısa süre waiting, 1.5 sn sonra açık “world bağlantısı bekleniyor” durumu gösterir. `_mountWorldView` generic `createWorldViewRenderer` çağırır (snake geriye uyum alias'ı korunur).
    * PONG, RACE ve CROWN de aynı generic world-view sözleşmesine alındı: `pongView.js`/`raceView.js`/`crownView.js` snapshot + validator, `pongWorldView.js`/`raceWorldView.js`/`crownWorldView.js` client renderer. PONG'da TV_CONSOLE kontrol-only görünüm korunur; ONLINE world-view aynı telefonda saha + overlay olarak açılır. CROWN retired olsa da aynı protocol/view katmanını korur.
 21. **Kumanda görünürlüğü ve kontrol rehberi:**
     * `src/controllers/controllerGuide.js` `CONTROL_DEFS` + `GAMEPAD_SCHEMAS` kaynaklarından 15 oyun için ortak left/action/hint projeksiyonu üretir; oyun-başına HTML kopyası yoktur.
     * `gamepad.js` shell'i `hud-game-tag`, `hud-live-status`, `tactical-role-text` ve `gamepad-control-guide` alanlarını mount eder; status 8 Hz state sync'ten, taktik rol şema `onSync` hook'larından beslenir.
     * Icon-only controller butonları mount anında `aria-label`/`title` alır; PONG slider'ı `role="slider"` + `aria-valuenow` sunar. Dil değişiminde rehber ve taktik metinler yeniden çözülür.
 22. **Cihaz bağlamı ve kalıcı tercihler (Phase 3):**
     * `src/core/preferences.js` `safeStorage` üzerinde versioned şema tutar; eski `bp_control_surface` / `bp_virtual_controls` değerlerini ilk açılışta migrate eder.
     * Kontrol yüzeyi `Otomatik / Mobil / Masa-ortası` olarak seçilir. Auto, touch + viewport profilinden phone/tabletop çözümler; LOCAL'de 2+ human slot otomatik tabletop surface'a geçer.
     * Ses, haptik ve PONG yön/hassasiyet tercihleri aynı kayıt katmanından okunur; haptik tüm engine/controller çağrılarında `src/core/haptics.js` gate'inden geçer.
 23. **Ergonomi ve dayanıklılık (Phase 4):**
     * Yatay kumanda yüzeyi safe-area + alt kontrol kuşağına taşınır; portrait oyunda görünür rotate gate aktif olur, lobby portrait kalır.
     * Canvas ve dinamik joystick Pointer Events + pointer capture kullanır; eski touch/mouse yolu fallback olarak korunur. Touch hedefleri en az 44px tutulur.
     * `src/core/inputSource.js` keyboard/touch/pointer kaynak çakışmasını kilitler; visibility, blur, resize, orientation, pause ve mod değişimlerinde nötr input uygulanır. Tabletop aim bu kilidi kanal bazlı bypass kullanır: WASD movement + touch aim aynı anda çalışabilir.
 24. **Bakım ve kontrol sözleşmesi (Phase 5):**
      * `src/core/controlDescriptor.js` phone/tabletop/network yüzeylerini aynı structural contract'a normalize eder; 15 oyunluk parity testi transport action, left intent ve action ID'lerini kilitler.
      * `src/core/inputIntent.js` transport packet'lerini değiştirmeden canonical `intent` alanı ekler; motorlar canonical intent'i okur, eski `action` alanı fallback olarak korunur.
      * ARCHER/HORDE/LASER `TWIN_STICK_ACTION` ile solda hareket, sağda `AIM_MOVE` + `AIM_PRESS`/`AIM_RELEASE` attack lifecycle'ı kullanır; ayrı Fire/Charge butonu yoktur. `src/core/aimInput.js` oyuncu başına held/active/vector/sequence state'ini ve stale/out-of-order guard'ını tutar; nötr dokunuş ateş üretmez, merkeze dönüş iptal sayılmaz, explicit touchcancel/build reset durdurur. ARCHER/LASER bırakışta ateşler, HORDE basılıyken ateş edip bırakışta durur; NINJA bu değişiklikten dışarıdadır.
      * `src/core/inputRouter.js` local/network adapter'larını aktif authoritative engine'e taşır; `GamepadManager` ve `BaseGame` yeni transport dalları taşımaz.
      * Yeni fiziksel gamepad API bu canonical intent sınırına ikincil adapter olarak bağlanacak; fiziksel cihaz varsayılan giriş yüzeyi olmayacak.

  25. **Cihaz-geneli kontrol yerleşimi (2026):**
       * `src/core/preferences.js` v2 kaydı `controllerLayout` profilini taşır; v1 preference kaydı ve eski control-surface değerleri merge edilerek korunur. `safeStorage.js` yazılamıyorsa profil yalnız session.memory'de yaşar.
       * `src/core/controllerLayout.js` saf geometri motorudur: normalized sol/sağ `{x,y}`, %80–130 istek ölçeği, safe-area/header/HUD/alt kuşak çerçevesi, merkez oyun alanı koruması, 44px minimum ve overlap-free responsive fit uygular.
       * `src/controllers/controllerTemplates.js` semantic `data-controller-layout-target="left|right"` işaretler; hedeflerin görsel ve hit-zone DOM parçası birlikte taşınır. Oyun moduna özel layout `if/else` zinciri yoktur.
       * `src/ui/controllerLayoutEditor.js` remote phone ve LOCAL mobile yüzeylerde aynı canlı önizleme/size/drag/save/reset deneyimini sunar. Editör açıkken `GamepadManager` nötr input gönderir ve tüm input transport'unu bloklar; görsel hedeflerin hit-zone'ları editor arkasında kalmaz.
       * Mobil controller shell yalnız ikon toolbar'ı ve skor şeridini korur; oyuncu/oda/HUD/kontrol rehberi metinleri üst bantları doldurmaz. Lobi yüzeyi ortak noktalı beyaz zemini kullanır; düzen düğmesi hem lobi profil kartında hem pause sheet'te bulunur.

---

## 6. Yeni Oyun Ekleme Adımları (Hızlı Rehber)

Yeni bir oyun ekleneceğinde aşağıdaki kayıtlar güncellenir:
1. `src/games/[oyun].js`: `BaseMiniGame` türevli motor; `resetMatch/reset`, `startNewMatch`, `startNewRound`, `update`, `render`, `resize`, `handleRemoteInput` sözleşmesi. Lokal lobi, 4 standart klavye, `getTabletopSchema`, `handleSlotAction`, `onTouchStart/Move/End` ve `renderControlGuide` zorunludur.
2. `src/ai/[oyun]AI.js` + gerekiyorsa saf/DOM-free `[oyun]Logic.js`: bot kararları ve test edilebilir oyun matematiği.
3. `src/core/engineRegistry.js`: `GAME_ORDER` + tek `CARTRIDGES[MOD]` kaydı (`load/createEngine/reset/onEnter/onResume/start/packet`). `main.js`/`gamepad.js` moda özel zincir eklenmez.
4. `src/core/slotManager.js`: `applySlotDataToEntity`, `clearRemoteSlot`, `swapEngineSlots` desteği.
5. `src/controllers/controlDefs.js`, `gamepadSchemas.js`, `controllerStatus.js`: telefon + tabletop parite, ikon/cooldown ve canlı durum kaydı.
6. `index.html`: Bento kartı (`#btn-select-[mod]`) ve TV lobi çipi (`data-game="[MOD]"`).
7. `src/styles/menu.css` + `animations.css`: kart vurgusu ve 15. giriş gecikmesi.
8. `public/sw.js`: yeni görseli precache'e ekle ve cache sürümünü artır.
9. `public/assets/games/[oyun].jpg`: 1:1 neo-brutalist görsel.
10. `docs/PROJECT_MAP.md` + `AGENTS.md`: motor/AI/dosya/kontrol kayıtları.
11. `npm test`, `npm run check`, `npm run build`: regresyon, statik kontrol ve production build yeşil olmadan tamamlanmaz.

---

## 7. Global Kurallar Katmanı

- `~/.config/opencode/AGENTS.md` — tüm projelerde geçerli temel (mimari, UI/UX motion/responsive, agentic süreç, hard rules).
- Bu depo: `AGENTS.md` (proje sözleşmeleri) + `docs/PROJECT_MAP.md` (harita). Global ile çakışırsa **proje dosyası kazanır**.
- Antigravity/Claude/Copilot global dosyaları master'dan import/kopya ile beslenir; master değişince Copilot elle senkronlanır.
