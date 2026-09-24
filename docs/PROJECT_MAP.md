# PROJECT_MAP — Brutal Party (mini-game-4p) Proje Haritası

Yaşayan doküman: kod veya mimari değiştiğinde burası güncellenir. Temel kurallar ve yasaklar **`AGENTS.md`**'dedir. Teknik yol haritası ve faz planı **`docs/TECHNICAL_ROADMAP.md`**'dedir.
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
  controllerTemplates.js    Deklaratif kumanda şablonları (JOYSTICK_ACTION, ARCADE_DRIVE, TWO_BUTTON_STEER, SLIDER_1D, STEER_BOOST)
  gamepadSchemas.js         14 oyun için deklaratif kumanda konfigürasyonları ve canlı senkronizasyon hook'ları
src/gamepad.css             Kumanda stilleri (neo-brutalist mobil ergonomi)
src/style.css               Modüler stil orkestratörü (@import src/styles/*)
src/styles/                 Modüler CSS katmanı (tokens, base, hud, modals, menu, lobby, animations)
src/controlGuide.js         Oyun-içi kontrol yardımcısı overlay'i
src/touchManager.js         Dokunmatik giriş yöneticisi (TV / masa-ortası lokal mod)
src/i18n.js                 Hafif UI metin motoru (t(), dil state, olaylar)
src/locales/                Yerelleştirme sözlükleri (tr.js, en.js)
src/types/game.d.ts         Ortak tip tanımları (PlayerSlot, Cartridge, EngineContract)
src/audio.js                Synthesizer / Web Audio API ses efektleri

src/core/
  BaseGame.js               BaseMiniGame: Tüm motorların ortak ata sınıfı
  engineRegistry.js         GAME_ORDER, CARTRIDGES (14 oyun kartuşu + metadatalar)
  slotManager.js            Koltuk yönetimi: hostPlayerSlots (+avatar/displayColor)
  safeStorage.js            localStorage sarmalayıcı
  inputMaps.js              Tek klavye slot haritası
  customizationManager.js   Cihaz-başı TEK profil
  touchFlow.js              Tek dokunmatik akış
  physics2d.js              Ortak 2D fizik & çarpışma yardımcıları
  pickupSystem.js           Ortak taktiksel power-up yönetimi
  arenaKit.js               Ortak arena görsel kiti
  playerEntity.js           Ortak oyuncu varlığı yönetimi
  avatarInGame.js           Ortak oyun içi avatar çizimi

src/ui/
  canvasUI.js               Tüm motorlar için ortak Canvas UI bileşenleri
  customizeModal.js         Sekmeli avatar atölyesi
  characterRenderer.js      Birleşik avatar çizimi
  hostLobby.js              TV bekleme lobisi modali
  joinModal.js              Kumanda katılım modali
  pauseModal.js             Oyun içi duraklatma menüsü
  toast.js                  PWA yükleme bildirimleri
  menuManager.js            TV ana menü orkestrasyonu
  settingsModal.js          Ayarlar modalı
  fullscreen.js             Tam ekran istek/yönetim

src/ai/
  bombAI.js                 Brutal Bomb bot zekâsı
  curveAI.js                Brutal Curve bot zekâsı
  heistAI.js                Brutal Heist bot zekâsı
  tankAI.js                 Micro-Tanks bot zekâsı
  crownAI.js                Brutal Crown bot zekâsı
  pongAI.js                 Brutal Pong bot zekâsı
  zoneAI.js                 Brutal Zone bot zekâsı
  archerAI.js               Brutal Archery bot zekâsı
  snakeAI.js                Brutal Snake bot zekâsı
  laserAI.js                Brutal Laser bot zekâsı
  cloneAI.js                Brutal Clone bot zekâsı
  collapseAI.js             Brutal Collapse bot zekâsı
  ninjaAI.js                Brutal Ninja bot zekâsı
  raceAI.js                 Brutal Race bot zekâsı

src/games/ (Oyun Motorları - BaseMiniGame türevleri):
  game.js                   Brutal Pong motoru
  tanks.js                  Micro-Tanks motoru
  curve.js                  Brutal Curve motoru
  bomb.js                   Brutal Bomb motoru
  heist.js                  Brutal Heist motoru
  archer.js                 Brutal Archery motoru
  crown.js                  Brutal Crown motoru
  zone.js                   Brutal Zone motoru
  snake.js                  Brutal Snake motoru
  laser.js                  Brutal Laser motoru
  clone.js                  Brutal Clone motoru
  collapse.js               Brutal Collapse motoru
  ninja.js                  Brutal Ninja motoru
  race.js                   Brutal Race motoru (3-checkpoint parkour yarışı, depar nitro, pürüzsüz fizik)

server/
  index.js                  Lokal WebSocket bağımsız sunucu başlatıcı
  roomManager.js            Lokal WS oda yöneticisi
  vitePluginWs.js           Vite geliştirme sunucusuna entegre WebSocket plugin'i

public/                     PWA + public/assets/games/*.jpg
```

---

## 2. Motor Tablosu

| Kod | Mod adı | Motor dosyası | Bot Yapay Zekâsı | Kumanda Mount | Not |
|-----|---------|---------------|------------------|---------------|-----|
| PONG | Brutal Pong | `src/games/game.js` | Paddle içinde | `mountPongController` | Kendi saha skor tabelası var |
| TANKS | Micro-Tanks | `src/games/tanks.js` | `src/ai/tankAI.js` | `mountTanksController` | Gaz pedalı + ateş, kartuş HUD |
| CURVE | Brutal Curve | `src/games/curve.js` | `src/ai/curveAI.js` | `mountCurveController` | Sol/sağ keskin dönüş yarıları |
| BOMB | Brutal Bomb | `src/games/bomb.js` | `src/ai/bombAI.js` | `mountBombController` | Sanal joystick + depar |
| HEIST | Brutal Heist | `src/games/heist.js` | `src/ai/heistAI.js` | `mountHeistController` | Sanal joystick + omuz atma |
| ARCHER | Brutal Archery | `src/games/archer.js` | `src/ai/archerAI.js` | `JOYSTICK_ACTION` | Yay germe + nişan salınımı |
| CROWN | Brutal Crown | `src/games/crown.js` | `src/ai/crownAI.js` | `mountCrownController` | Altın taç krallığı |
| ZONE | Brutal Zone | `src/games/zone.js` | `src/ai/zoneAI.js` | `mountZoneController` | Grid bölge kapma |
| SNAKE | Brutal Snake | `src/games/snake.js` | `src/ai/snakeAI.js` | `mountSnakeController` | Yemle büyü |
| LASER | Brutal Laser | `src/games/laser.js` | `src/ai/laserAI.js` | `mountLaserController` | Hareketli lazer-tag |
| CLONE | Brutal Clone | `src/games/clone.js` | `src/ai/cloneAI.js` | `mountCloneController` | 2 gecikmeli kopya |
| COLLAPSE | Brutal Collapse | `src/games/collapse.js` | `src/ai/collapseAI.js` | `mountCollapseController` | 13x13 çöken ızgara |
| NINJA | Brutal Ninja | `src/games/ninja.js` | `src/ai/ninjaAI.js` | `mountNinjaController` | Durunca görünmezleşme |
| RACE | Brutal Race | `src/games/race.js` | `src/ai/raceAI.js` | `JOYSTICK_ACTION` (nitro dash schema) | Parkour 3-checkpoint yarışı (CP1->CP2->CP3), depar nitro, araç çarpışmaları, 3 tur yarışı |
