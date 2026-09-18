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
src/gamepad.js              Telefon kumandası: CONTROLLER_META, mount*Controller, koltuk ızgarası,
                            skor şeridi, ready yönetimi, dokunmatik girdiler
src/gamepad.css             Kumanda stilleri (neo-brutalist mobil ergonomi)
src/style.css               TV konsolu + ana menü stilleri (neo-brutalist)
src/controlGuide.js         Oyun-içi kontrol yardımcısı overlay'i
src/touchManager.js         Dokunmatik giriş yöneticisi (TV / masa-ortası lokal mod)
src/touch.js                [YEDEK/LEGACY] Eski dokunmatik modülü (touchManager.js kullanılır)
src/audio.js                Synthesizer / Web Audio API ses efektleri

src/core/
  BaseGame.js               BaseMiniGame: Tüm motorların ortak ata sınıfı (canvas, state, scores,
                            slotTypes, trauma/screenshake, handleUiTap)
  engineRegistry.js         GAME_ORDER + registerEngine/getEngine/forEachEngine
  slotManager.js            Koltuk yönetimi: hostPlayerSlots, updateHostSlot, syncSlotsToEngine, swapEngineSlots

src/ui/
  hostLobby.js              TV bekleme lobisi modali (QR kod canvas, oda kodu, lobi oyun chip'leri, WhatsApp/link paylaşımı, ping badge)
  joinModal.js              Kumanda katılım modali & Hero kod kutusu, panodan yapıştırma
  pauseModal.js             Oyun içi duraklatma menüsü, 4 koltuk takası, 90° saat yönü ekran döndürme, ses aç/kapa
  toast.js                  PWA yükleme bildirimleri (showInstallToast, setupPwaInstallPrompt)

src/ai/
  bombAI.js                 Brutal Bomb bot zekâsı: duvar kaçınması, tehlike raycast'i, bomba paslaşma/kaçış
  curveAI.js                Brutal Curve bot zekâsı: sol/sağ ışın örnekleme, delik geçişi, merkez takibi
  heistAI.js                Brutal Heist bot zekâsı: kasa bankalama stratejisi, ganimet önceliği, taktiksel omuz atma
  tankAI.js                 Micro-Tanks bot zekâsı: duvar seken mermi hesaplaması, hedef önleme raycast'i, akıllı ateş

src/ (Oyun Motorları - BaseMiniGame türevleri):
  game.js                   Brutal Pong motoru (+ src/ball.js, src/paddle.js)
  tanks.js                  Micro-Tanks motoru (sekme fiziği, mermi cooldown & HUD)
  curve.js                  Brutal Curve motoru (kuyruk izi, delikler, power-up)
  bomb.js                   Brutal Bomb motoru (patlama zamanlayıcısı, depar, çoklu harita)
  heist.js                  Brutal Heist motoru (altın toplama, kasa bankalama, omuz atma)
  duel.js                   Quick Draw kovboy düellosu (refleks tetiği, false-start cezası)

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
| PONG | Brutal Pong | `src/game.js` | Paddle içinde | `mountPongController` | Kendi saha skor tabelası var; score-strip yok |
| TANKS | Micro-Tanks | `src/tanks.js` | `src/ai/tankAI.js` | `mountTanksController` | Gaz pedalı + ateş, kartuş HUD; max 2 mermi, 0.55s reload |
| CURVE | Brutal Curve | `src/curve.js` | `src/ai/curveAI.js` | `mountCurveController` | Sol/sağ keskin dönüş yarıları |
| BOMB | Brutal Bomb | `src/bomb.js` | `src/ai/bombAI.js` | `mountBombController` | Sanal joystick + depar; MAP_PRESETS çoklu arena |
| HEIST | Brutal Heist | `src/heist.js` | `src/ai/heistAI.js` | `mountHeistController` | Sanal joystick + omuz atma; merkezi elmas, kasa bankalama |
| DUEL | Quick Draw | `src/duel.js` | Refleks timer | `mountDuelController` | Sinyalde ilk dokunan; false-start cezası |

---

## 3. Ağ & İletişim Protokolü

Sistem iki relay kullanabilir:
1. **Lokal Ağ / Geliştirme:** `src/network.js` (PartyNetwork WebSocket üzerinden)
2. **Canlı / İnternet:** `src/supabaseRelay.js` (Supabase Realtime Broadcast: `player_msg` ve `host_msg`)

### Kumanda → TV Host (`player_msg`):
* `INPUT`: Joystick yönü `(x, y)` veya buton basımları (`FIRE`, `DASH`, `TACKLE`). 50ms throttle ile sınırlandırılmıştır; aksiyon butonları throttlesızdır.
* `JOIN_ROOM`: 3 haneli oda kodu + oyuncu adı ile odaya katılma isteği.
* `SWITCH_SLOT`: Kumandadan boş bir koltuğa geçiş talebi (`targetIndex`).
* `PLAYER_READY`: Hazır / Hazır değil durum değişimi.
* `SET_NAME`: İsim güncellemesi (büyük harf, maks 12 karakter).
* `REACTION` / `PING`: Emoji tepkisi / gecikme ölçümü.

### TV Host → Kumanda (`host_msg`):
* `HOST_STATE_SYNC` / `GAME_STATE`: 8Hz periyodik oyun durumu yayını (dirty-check ile değişmediyse göndermez).
* `SLOTS_UPDATE`: 4 koltuğun güncel durumu (`slotIndex, name, color, kind, isReady`). Hem WS hem Supabase'de birebir aynı şemadır.
* `SLOT_CHANGED`: Oyuncuya atanan yeni slot indeksi ve rengi.
* `SLOTS_SWAPPED`: Host tarafından iki koltuk takas edildiğinde kumandaları bilgilendirir.
* `STAGING_STARTED` / `COUNTDOWN` / `GAME_STARTED`: Lobi akış geçişleri.
* `RETURNED_TO_LOBBY`: Lobiye dönüş (hazır bayrakları sıfırlanır, oda kapanmaz).

---

## 4. Slot Modeli Kuralları

* TV tarafında: `hostPlayerSlots[i] = { name, isReady, kind }`, `kind ∈ 'human' | 'bot'`.
* Relay tarafı (`supabaseRelay.players[]` veya `room.players[]`) tek doğru gerçektir (Single Source of Truth).
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

---

## 6. Yeni Oyun Ekleme Adımları (Hızlı Rehber)

Yeni bir oyun ekleneceğinde aşağıdaki 6 dosya güncellenir:
1. `src/[oyun].js`: `BaseMiniGame`'den türetilmiş oyun motoru.
2. `src/ai/[oyun]AI.js`: Bot karar mekanizması.
3. `src/core/engineRegistry.js`: `GAME_ORDER` dizisine ekleme ve `registerEngine` kaydı.
4. `src/gamepad.js`: `mount[Oyun]Controller` fonksiyonu ve `CONTROLLER_META` tablosuna satır ekleme.
5. `index.html`: Bento menü kartı (`#btn-select-[mod]`), TV lobi çipi ve kumanda önizlemesi.
6. `npm run build`: 0 hata doğrulaması.
