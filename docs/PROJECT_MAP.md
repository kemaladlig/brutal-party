# PROJECT_MAP — Brutal Party (mini-game-4p) Proje Haritası

Yaşayan doküman: kod veya mimari değiştiğinde burası güncellenir. Temel kurallar ve yasaklar **`AGENTS.md`**'dedir.
Son doğrulama: Refactoring & Modülerleştirme sonrası (Eylül 2026).

---

## 1. Dizin & Dosya Sorumlulukları

```
index.html                  Ana menü (bento kartlar), TV lobi modali, kumanda overlay iskeleti
src/main.js                 Ana orkestratör: mod/oda akışı, host slot listesi, staging+sayaç,
                            8Hz broadcaster, engine registry başlatıcı, render döngüsü
src/net.js                  Ağ seçici (LOCAL / TV_CONSOLE→WS / ONLINE→Supabase) + PUBLIC_URL, env bayrakları
src/network.js              PartyNetwork: lokal WebSocket istemcisi (host + kumanda rolleri)
src/supabaseRelay.js        Supabase Broadcast relay: player_msg / host_msg kanalları, slot tablosu
src/gamepad.js              Telefon kumandası: CONTROLLER_META, koltuk ızgarası,
                            skor şeridi, ready yönetimi, dokunmatik girdiler
src/controllers/
  controllerTemplates.js    Deklaratif kumanda şablonları (JOYSTICK_ACTION, ARCADE_DRIVE, TWO_BUTTON_STEER, SLIDER_1D, REACTION_TAP, DPAD_BOOST)
  gamepadSchemas.js         13 oyun için deklaratif kumanda konfigürasyonları ve canlı senkronizasyon hook'ları
src/gamepad.css             Kumanda stilleri (neo-brutalist mobil ergonomi)
src/style.css               TV konsolu + ana menü stilleri (neo-brutalist)
src/controlGuide.js         Oyun-içi kontrol yardımcısı overlay'i
src/touchManager.js         Dokunmatik giriş yöneticisi (TV / masa-ortası lokal mod)
src/i18n.js                 UI metin sözlüğü (t() anahtarları)
src/audio.js                Synthesizer / Web Audio API ses efektleri

src/core/
  BaseGame.js               BaseMiniGame: Tüm motorların ortak ata sınıfı (canvas, state, scores,
                            slotTypes, trauma/screenshake, handleUiTap, bindStandardKeyboard,
                            handleStandardJoystickTouchStart/Move/End, renderStandardLobby,
                            handleStandardRemoteJoystick)
  engineRegistry.js         GAME_ORDER, CARTRIDGES (13 oyun kartuşu + metadatalar), initAllCartridges, getControllerMeta, registerEngine/getEngine/forEachEngine
  slotManager.js            Koltuk yönetimi: hostPlayerSlots (+avatar/displayColor), updateHostSlot,
                            syncSlotsToEngine, swapEngineSlots, getColorClashIndices (sert renk engeli)
  safeStorage.js            localStorage sarmalayıcı (JSON parse/try-catch tek nokta)
  inputMaps.js              Tek klavye slot haritası: STANDARD_KEY_SLOTS (P1 WASD+Space…P4 TFGH+B),
                            SECOND_ACTION_KEYS (ninja smoke/laser dash), getSlotKeys, keyboardVectorFrom,
                            readSlotKeys, isSlotActionEvent, slotForActionCode, buildCodeToSlotMap —
                            motorlar tuş kopyası tutmaz (Faz 1 refactor, Eylül 2026)
  customizationManager.js   Cihaz-başı TEK profil (localStorage), rastgele varsayılan renk,
                            sanitizeAvatar/pickFreeColor/findSlotColorDuplicates, koltuk avatar kayıt defteri
  touchFlow.js              Tek dokunmatik akış: getQuadrant (BL/BR→TL/TR: 0/1/2/3),
                            roundOverSkipGuard (timerField varsayılan roundTransitionTimer;
                            PONG roundOverTimer geçirir), lobbyCenterStartTap (r=65, min 2),
                            lobbyQuadrantTap (+onSeatChange), matchOverRestartTap (r=75) —
                            motorlar quadrant/skip kopyası tutmaz (Faz 2 refactor, Eylül 2026);
                            İSTİSNA: tanks getCornerZone (merkez -1, PLAYING'de gerekli),
                            PONG getPlayerZoneAt (paddle bölgeleri), bomb/zone MATCH_OVER→LOBBY.
                            Faz 2c (Eylül 2026): 12 motor lobi kartı renderStandardLobby'ye
                            geçti (archer/bomb/clone/collapse/crown/curve/heist/laser/ninja/
                            snake/tanks/zone); only PONG hand-rolled kaldı (rotate kart + bölge)
  physics2d.js              Ortak 2D fizik & çarpışma yardımcıları: clampToArena (arena sınır kısıtlama),
                            resolveAABB (çember-AABB engel kayma çarpışması), pointBlocked (engel nokta testi),
                            updateMovers (hareketli engel salınımı), distToSegmentSquared (çizgi mesafesi) —
                            bomb, heist, archer, ninja, clone, laser, curve, snake entegre (Faz 3 refactor, Eylül 2026)
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
  hostLobby.js              TV bekleme lobisi modali (QR kod canvas, oda kodu, lobi oyun chip'leri, WhatsApp/link paylaşımı, ping badge)
  joinModal.js              Kumanda katılım modali & Hero kod kutusu, panodan yapıştırma
  pauseModal.js             Oyun içi duraklatma menüsü, 4 koltuk takası, 90° saat yönü ekran döndürme, ses aç/kapa
  toast.js                  PWA yükleme bildirimleri (showInstallToast, setupPwaInstallPrompt)
  menuManager.js            TV ana menü orkestrasyonu (bento kart, ayar/ses kısayolları)
  settingsModal.js          Ayarlar modalı (ses, tam ekran, bot ekleme tercihi)
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
    cloneAI.js                Brutal Clone bot zekâsı: devriye + menzil omuz tehdidi
    collapseAI.js             Brutal Collapse bot zekâsı: güvenli hücre + tehlike zıplaması
    ninjaAI.js                Brutal Ninja bot zekâsı: pusu/saklanma + kısa menzil av

src/games/ (Oyun Motorları - BaseMiniGame türevleri):
  game.js                   Brutal Pong motoru (+ src/games/ball.js, src/games/paddle.js)
  tanks.js                  Micro-Tanks motoru (sekme fiziği, mermi cooldown & HUD)
  curve.js                  Brutal Curve motoru (kuyruk izi, delikler, power-up)
  bomb.js                   Brutal Bomb motoru (patlama zamanlayıcısı, depar, çoklu harita)
  heist.js                  Brutal Heist motoru (altın toplama, kasa bankalama, omuz atma)
   archer.js                 Brutal Archery okçuluk arenası (yay germe + nişan salınımı + yakın menzil 2 puan, 60sn/2 raund)
   crown.js                  Brutal Crown motoru (altın taç, omuz atma, pinball bumper'lar, taç süresi)
    zone.js                   Brutal Zone motoru (64x64 grid bölge kapma, iz kesme→base-reset+2sn stun, %40/90sn)
    snake.js                  Brutal Snake motoru (yemle büyü, kuyruk/çarpışma, hold-boost)
    laser.js                  Brutal Laser motoru (hareketli lazer-tag, 3 can, dash i-frame)
    clone.js                  Brutal Clone motoru (2 gecikmeli kopya, gerçek/sahte vuruş)
    collapse.js               Brutal Collapse motoru (13x13 çöken ızgara, zıplama, itişme)
    ninja.js                  Brutal Ninja motoru (görünmezleşme, kılıç cooldown, siper kutuları)

server/
  index.js                  Lokal WebSocket bağımsız sunucu başlatıcı
  roomManager.js            Lokal WS oda yöneticisi: slot tablosu, bot/isim/takas senkronizasyonu
  vitePluginWs.js           Vite geliştirme sunucusuna entegre WebSocket plugin'i

public/                     PWA (manifest.webmanifest, sw.js, ikonlar) + public/assets/games/*.jpg
```

---

## 2. Motor Tablosu

| Kod | Mod adı | Motor dosyası | Bot Yapay Zekâsı | Kumanda Mount | Not |
|-----|---------|---------------|------------------|---------------|-----|
| PONG | Brutal Pong | `src/games/game.js` | Paddle içinde | `mountPongController` | Kendi saha skor tabelası var; score-strip yok; kale %62 kenar-oranlı + 45° pah (ince dikiş) + anti-lock + klavye + ❄️ dondurma skili + stall-kırıcı |
| TANKS | Micro-Tanks | `src/games/tanks.js` | `src/ai/tankAI.js` | `mountTanksController` | Gaz pedalı + ateş, kartuş HUD; max 2 mermi, 0.55s reload |
| CURVE | Brutal Curve | `src/games/curve.js` | `src/ai/curveAI.js` | `mountCurveController` | Sol/sağ keskin dönüş yarıları |
| BOMB | Brutal Bomb | `src/games/bomb.js` | `src/ai/bombAI.js` | `mountBombController` | Sanal joystick + depar; MAP_PRESETS çoklu arena |
| HEIST | Brutal Heist | `src/games/heist.js` | `src/ai/heistAI.js` | `mountHeistController` | Sanal joystick + omuz atma; merkezi elmas, kasa bankalama |
| ARCHER | Brutal Archery | `src/games/archer.js` | `src/ai/archerAI.js` | `JOYSTICK_ACTION` (hold-charge schema) | Serbest hareket + basılı yay germe (nişan salınımı) + bırakınca ok; yakın vuruş 2p / uzak 1p; 60sn raund, 2 raund alan şampiyon; **raund başına rastgele 3 harita (PILLARS/CROSS/SCATTER+hareketli duvar)**; power-up: TURBO/TELEPORT/SLIP + MULTI/QUICKDRAW/SHIELD; mesafe ölçekli stun (yakın 0.12sn → uzak 0.8sn, spam kilitlenmesin) |
| CROWN | Brutal Crown | `src/games/crown.js` | `src/ai/crownAI.js` | `mountCrownController` | Altın taç krallığı (15s tutan kazanır), omuz atarak taç düşürme, pinball tamponları |
| ZONE | Brutal Zone | `src/games/zone.js` | `src/ai/zoneAI.js` | `mountZoneController` | Grid bölge kapma (iz kesme→base-reset+2sn stun, ölüm yok; duvar cezasız); 90sn + %40 erken zafer, 2 raund alan şampiyon; kumanda joystick + ⚡depar (2.2x/0.22sn/4sn) |
| SNAKE | Brutal Snake | `src/games/snake.js` | `src/ai/snakeAI.js` | `mountSnakeController` | Yemle büyü (max 300), kuyruk/çarpışma eleme, hold-boost; bot ızgara-raycast + yem kovalama; kumanda joystick + basılı boost |
| LASER | Brutal Laser | `src/games/laser.js` | `src/ai/laserAI.js` | `mountLaserController` | Hareketli lazer-tag: tek çubuk koş+nişan, 3 can + 2sn respawn, dash i-frame (2.2x/0.22sn/4sn), 2-sekmelik nişan önizlemesi, 90sn/10 kill yarışı, ❤/⚡ pickup, 3 harita preset; bot strafe+dodge+pickup; kumanda joystick + ATEŞ + DASH |
| CLONE | Brutal Clone | `src/games/clone.js` | `src/ai/cloneAI.js` | `mountCloneController` | 2 gecikmeli kopya (0.6/1.2sn), gerçek-vuruş skor + sahte-vuruş 2.5sn slow; bot devriye + menzil omuzu (blöf yer); kumanda joystick + OMUZ (`TACKLE` yeniden kullanımı, %cd göstergeli) |
| COLLAPSE | Brutal Collapse | `src/games/collapse.js` | `src/ai/collapseAI.js` | `mountCollapseController` | 13x13 çöken ızgara (0.8sn uyarı), zıplama 0.45sn/1.8s cooldown + itişme; bot güvenli-hücre + tehlike zıplaması; kumanda joystick + ZIPLA (`DASH` yeniden kullanımı, %cd göstergeli) |
| NINJA | Brutal Ninja | `src/games/ninja.js` | `src/ai/ninjaAI.js` | `mountNinjaController` | Durunca görünmezleşme (0.3sn/0.05 iz), kılıç atılması 0.2sn/1.5s cooldown + siper kutuları; bot MOVE/HIDE pusu + 90px av; kumanda joystick + KILIÇ (`DASH` yeniden kullanımı, %cd göstergeli) |

---

## 3. Ağ & İletişim Protokolü

Sistem iki relay kullanabilir:
1. **Lokal Ağ / Geliştirme:** `src/network.js` (PartyNetwork WebSocket üzerinden)
2. **Canlı / İnternet:** `src/supabaseRelay.js` (Supabase Realtime Broadcast: `player_msg` ve `host_msg`)

### Kumanda → TV Host (`player_msg`):
* `INPUT`: Joystick yönü `(x, y)` veya buton basımları (`FIRE`, `DASH`, `TACKLE`). 50ms throttle ile sınırlandırılmıştır; aksiyon butonları throttlesızdır.
* `INPUT` tüneli `AVATAR_UPDATE`: kumanda kendi karakterini bildirir (`{color, expression, accessory, pattern}`; host sanitize eder, 1sn rate-limit).
* `JOIN_ROOM` / `JOIN`: 3 haneli oda kodu + oyuncu adı + `avatar` ile odaya katılma isteği. Avatarsız eski istemciye host boş rastgele renk + varsayılan yüz atar; alınmış renkle gelenin rengi boşa çekilir (yüz korunur).
* `SWITCH_SLOT`: Kumandadan boş bir koltuğa geçiş talebi (`targetIndex`).
* `PLAYER_READY`: Hazır / Hazır değil durum değişimi.
* `SET_NAME`: İsim güncellemesi (büyük harf, maks 12 karakter).
* `REACTION` / `PING`: Emoji tepkisi / gecikme ölçümü.

### TV Host → Kumanda (`host_msg`):
* `HOST_STATE_SYNC` / `GAME_STATE`: 8Hz periyodik oyun durumu yayını (dirty-check ile değişmediyse göndermez).
* `SLOTS_UPDATE`: 4 koltuğun güncel durumu (`slotIndex, name, color, kind, isReady` + insanlarda `avatar`). Hem WS hem Supabase'de birebir aynı şemadır.
* `SLOT_CHANGED`: koltuk no + display rengi. Renk oyuncuyla taşınır (takas/döndürmede koltuğa sabitlenmez).
* `SET_SLOT_COLOR` (host-only): host lobi hızlı palet/🎲 display-renk override'ı (profil değişmez).
* `SLOT_CHANGED`: Oyuncuya atanan yeni slot indeksi ve rengi.
* `SLOTS_SWAPPED`: Host tarafından iki koltuk takas edildiğinde kumandaları bilgilendirir.
* `STAGING_STARTED` / `COUNTDOWN` / `GAME_STARTED`: Lobi akış geçişleri.
* `RETURNED_TO_LOBBY`: Lobiye dönüş (hazır bayrakları sıfırlanır, oda kapanmaz).

---

## 4. Slot Modeli Kuralları

* TV tarafında: `hostPlayerSlots[i] = { name, isReady, kind, avatar, displayColor }`, `kind ∈ 'human' | 'bot'`.
* Relay tarafı (`supabaseRelay.players[]` veya `room.players[]`) tek doğru gerçektir (Single Source of Truth).
* **Sert renk engeli:** İki insan koltuğu aynı display rengine sahipse `SAHAYA GEÇ` + sayaç kilitlenir (lobide `⚠️ AYNI RENK` + 🎲 hızlı atama). LOCAL muaf (koltuklar boş → küme boş).
* **Bot Kuralları:**
  * Bot koltukları ne hedef ne kaynak olabilir; `SWITCH_SLOT` ile botun üstüne oturulamaz.
  * Sayaç başladığında (`COUNTDOWN`) koltuk seçimleri kilitlenir (`seatsLocked`).
* **Ready-Reset:**
  * `GAME_STARTED` ve `RETURNED_TO_LOBBY` anında `isReady` bayrağı hem host'ta hem kumandada kesinlikle `false` yapılır.

---

## 5. Mimari Karar Defteri (Architectural Decisions)

1. **TV Host Tek Yetkilidir (Authoritative):**
   * Tüm fizik hesaplamaları, çarpışmalar, puanlar ve bot yapay zekaları TV Host üzerinde çalışır. Kumandalar sadece girdi yollar.
2. **Engine Registry Prensibi:**
   * `main.js` içinde `if (mode === 'PONG') ... else if` zincirleri yasaktır. Tüm oyunlar `engineRegistry.js` üzerinden `registerEngine` ile kaydedilir ve polimorfik olarak çağrılır.
3. **BaseMiniGame Ortak Tabanı:**
   * Tüm oyunlar `src/core/BaseGame.js` sınıfından türer; ekran sarsıntısı (`trauma`), skorlar, buton tıklamaları ortak işletilir.
4. **Kumanda Ergonomisi Kuşağı:**
   * Dokunmatik alanlar dikeyde `safe-area + 12vh` alt-orta kuşakta, yatayda sol/sağ alt köşelerdedir (Sol: yön, Sağ: aksiyon).
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
   * `src/ui/tokens.js` (renk/tipografi/ölçü sözlüğü, CSS `:root` ile aynı değerler) + `src/ui/hud.js` (`renderTopPill`, `renderCornerScores`, `renderRoundBanner`, `renderMatchOver`) + `src/ui/motion.js` (`prefersReducedMotion`, `motionScale`, `pulse`).
   * Final state adı tektir: `MATCH_OVER` (PONG/BOMB/HEIST/CROWN `GAME_OVER` birleştirildi). DUEL fazları (`STANDOFF/TENSION/SIGNAL`) oyun mekaniğidir, korunur.
   * Oyuncu paleti tektir: `UI_COLORS.players` (DUEL kanonik palete bağlandı, TV↔kumanda eşleşir).
   * Tematik istisnalar: DUEL skor şeridi/sinyal dili + CROWN final kutusu (ölçüleri standart, kutu dili oyuna özel).
9. **Girdi Sertleştirme (TV_CONSOLE öncelikli, bütçeler sabit):**
   * Kumanda analog akışı taşıma-bağımsız tek noktada kısılır (`gamepad.js:_sendAnalog` — 50ms + ölübant PONG 0.003 / joystick Δ 0.02); sıfır/discrete paketler bypass. Sunucu ikinci sigortadır (slot başına ~30Hz + 64KB `bufferedAmount` atlama).
   * Kopan kumanda "nötrlenir + koltuğu tutar": `slotManager:clearRemoteSlot` (joy/isDriving/steer sıfırlar; isim/skor/kind korunur) — `onPlayerLeft`, sayaç başı, lobiye dönüş ve 1.5s analog-sessizlik süpürücüsünde çağrılır.
   * WS kopma gözetimi Supabase ile simetriktir (30s watchdog + üstel geri çekilmeli auto-rejoin, maks 5); BOMB/HEIST/CROWN `handleRemoteInput` ölü-slot guard'ı TANKS/CURVE/PONG ile aynıdır.
10. **Kontrol Eşleşmesi (kumanda↔motor + lokal klavye):**
   * 7/7 telefon kumandası motora doğru konuşur. HEIST `gemCarrier` alanı motorda hiç yoktu → rozet söküldü (kumanda skor+süre şeridi, pakette `timeLeft` durur). BOMB `carrier:-1` artık `BOMBA BOŞTA` gösterir (`P0` etiketi kapandı).
   * Klavyesi olmayan motor kalmadı: TANKS (bas=TUT/sür, bırak=dur+ateş + `driveOwner` sahipliği — bırakma başka kaynağın sürüşü ezmez) ve CURVE (eklemeli `keyboardSteer`, dokunmatik basılıyken klavye bırakması ezmez) BOMB desenini izler. DUEL klavyeye `Enter/O/B` eklendi (P2/P3/P4).
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
   * Girdi denetimi: WS + Supabase şema/aralık (`isValidInputData/isValidRelayInput`), discrete rate-limit (FIRE/DASH/TACKLE 100ms, SWITCH 500ms, READY 300ms…), emoji/boyut budama; `SWITCH_SLOT` host kapısı (aralık + bot hedef/kaynak reddi); motorlarda `finite/clamp` derinliği.
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
   * SW v11: oyun görselleri precache + 60 kayıt sınırı + `?join=` navigation fallback + yeni-sürüm toast'ı.
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
17. **Ortak arena/fizik/power-up kiti (`src/core/`, refactor Faz 3-7):** Motorlar tekrar eden mantığı kopyalamaz, `src/core/`'dan `import` eder: `physics2d.js` (clampToArena / resolveAABB / pointBlocked / updateMovers / distToSegmentSquared), `pickupSystem.js` (spawnPickup / collectPickups / tickPickupTimers + EFFECTS), `playerEntity.js` (createPlayer / tickEffectTimers / advancePlayer), `avatarInGame.js` (drawGameAvatar / normalizeExpression). `arenaKit.js` `drawObstacle` + `PICKUP_META`/`drawPickup` **ve** `buildLayout(name, arena)` düzen presets servis eder (`pillars`, `columns4`, `cross`, `crossfire`, `scatter`, `bunker`, `courtyard`, `split`). Motor kendi `buildMap()`'i yalnız oyuna özgü ek katmanları/meta'yı tutar (crown conveyor/bumper/movingHazards gibi); ortak düzen geometrisi preset adıyla çağrılır (archer `pillars/cross/scatter`, bomb `columns4/bunker/crossfire/courtyard/split`). **Açık iş:** tanks/laser/snake/curve/clone/collapse `drawObstacle`/`drawPickup` görsel kitine taşınacak; ninja/collapse/snake/clone/tanks/zone/crown pickup spawn/collect kopyaları `pickupSystem`'e bağlanacak (metadata `PICKUP_META`'da hazır).

---

## 6. Yeni Oyun Ekleme Adımları (Hızlı Rehber)

Yeni bir oyun ekleneceğinde aşağıdaki dosyalar güncellenir:
1. `src/games/[oyun].js`: `BaseMiniGame`'den türetilmiş oyun motoru:
   * Motor sözleşmesi: `resetMatch()`, `startNewRound()`, `update()`, `render()`, `resize()`, `handleRemoteInput()`.
   * Lokal Lobi: Canvas üzerinde 4 köşe slot kartı (`uiButtons` -> `cycleSlotType`) ve merkez `▶ MAÇI BAŞLAT` (`startNewMatch`).
   * Lokal Kontroller: 4 slot klavye eşlemesi (WASD, Oklar, IJKL, TFGH) + 4 köşe dokunmatik joystick (`TouchManager`).
   * Kontrol Rehberi: `renderControlGuide` çağrısı.
2. `src/ai/[oyun]AI.js`: Bot karar mekanizması.
3. `src/core/engineRegistry.js`: `GAME_ORDER` dizisine ekleme.
4. `src/core/slotManager.js`: `syncSlotsToEngine` ve `swapEngineSlots` içine mod desteği.
5. `src/main.js`: `registerEngine` kaydı (tek satır).
6. `src/gamepad.js`: `mount[Oyun]Controller` fonksiyonu ve `CONTROLLER_META` tablosuna satır ekleme.
7. `index.html`: Bento menü kartı (`#btn-select-[mod]`), TV lobi çipi (`data-game="[MOD]"`).
8. `src/style.css`: `.card-[mod]` üst kenarlık vurgu rengi.
9. `public/assets/games/[oyun].jpg`: Madde 10 formülüyle 1:1 neo-brutalist izometrik görsel.
10. `npm run build`: 0 hata doğrulaması.

---

## 7. Global Kurallar Katmanı

- `~/.config/opencode/AGENTS.md` — tüm projelerde geçerli temel (mimari, UI/UX motion/responsive, agentic süreç, hard rules).
- Bu depo: `AGENTS.md` (proje sözleşmeleri) + `docs/PROJECT_MAP.md` (harita). Global ile çakışırsa **proje dosyası kazanır**.
- Antigravity/Claude/Copilot global dosyaları master'dan import/kopya ile beslenir; master değişince Copilot elle senkronlanır.
