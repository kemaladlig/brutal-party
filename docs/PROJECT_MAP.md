# PROJECT_MAP — Brutal Party (mini-game-4p) Proje Haritası

Yaşayan doküman: kod değişince burası güncellenir. Kurallar ve yasaklar **`AGENTS.md`**'dedir.
Son doğrulama: kod taramasıyla (Eylül 2026).

---

## 1. Dizin & Dosya Sorumlulukları

```
index.html                  Ana menü (bento kartlar), TV lobi modali, kumanda overlay iskeleti
src/main.js                 Orkestrasyon: mod/oda akışı, host slot listesi, staging+sayaç,
                            8Hz broadcaster, engine registry kayıtları, bot ekle/çıkar
src/net.js                  Ağ seçici (LOCAL / TV_CONSOLE→WS / ONLINE→Supabase) + PUBLIC_URL, env bayrakları
src/network.js              PartyNetwork: lokal WebSocket istemcisi (host + kumanda rolleri)
src/supabaseRelay.js        Supabase Broadcast relay: player_msg / host_msg kanalları, slot tablosu
src/gamepad.js              Telefon kumandası: CONTROLLER_META, mount*Controller, koltuk ızgarası,
                            skor şeridi, ready yönetimi
src/gamepad.css / style.css Kumanda stilleri / TV+menü stilleri (neo-brutalist)
src/controlGuide.js         Oyun-içi kontrol yardımcısı overlay'i
src/touchManager.js         Dokunmatik giriş yöneticisi (TV/lokal)
src/audio.js                Ses efektleri
src/core/engineRegistry.js  GAME_ORDER + registerEngine/getEngine/forEachEngine
src/core/BaseGame.js        BaseMiniGame: slotType/lobby tap altyapısı (onLobbySeatTap, cycleSlotType)
src/core/slotManager.js     updateHostSlot, syncSlotsToEngine, swapEngineSlots
src/games/                  6 motor (tabloya bak) + paylaşılan parçalar (ball.js, paddle.js)
src/ai/                     Bot zekâları: bombAI, curveAI, heistAI, tankAI (PONG/CURVE botu motorda)
src/ui/hostLobby.js         TV bekleme lobisi modali (QR, kod, slot kartları, bot toggle, swap)
src/ui/joinModal.js         Katılma / kod girme modali
src/ui/pauseModal.js        Duraklatma menüsü (lobi dönüşü, koltuklar, oyun değiştirme)
src/ui/toast.js             Bildirim balonları (showInstallToast)
server/roomManager.js       Lokal WS oda sunucusu: slot tablosu, bot/isim/takas, yayınlar
server/vitePluginWs.js      Vite WS eklentisi: mesaj yönlendirme (geliştirme + LAN)
public/                     PWA (manifest, sw.js, ikonlar) + public/assets/games/*.jpg
```

## 2. Motor Tablosu

| Kod | Mod adı | Motor dosyası | Kumanda mount | Not |
|-----|---------|---------------|---------------|-----|
| PONG | Brutal Pong | `game.js` (+`ball.js`,`paddle.js`) | `mountPongController` | Kendi skor tabelası var; score-strip yok |
| TANKS | Micro-Tanks | `tanks.js` (+`ai/tankAI.js`) | `mountTanksController` | Gaz pedalı + ateş, kartuş HUD; max 2 mermi, 0.55s reload |
| CURVE | Brutal Curve | `curve.js` (+`ai/curveAI.js`) | `mountCurveController` | Sol/sağ keskin dönüş yarıları |
| BOMB | Brutal Bomb | `bomb.js` (+`ai/bombAI.js`) | `mountBombController` | Joystick + depar; `MAP_PRESETS` çoklu arena |
| HEIST | Brutal Heist | `heist.js` (+`ai/heistAI.js`) | `mountHeistController` | Joystick + omuz atma; merkezi elmas, dairesel spawn |
| DUEL | Quick Draw | `duel.js` | `mountDuelController` | Sinyalde ilk dokunan; false-start cezası |

## 3. Protokol Tablosu

Supabase iki broadcast akışı kullanır: `player_msg` (kumanda→host) ve `host_msg` (host→kumanda). Payload tip adları WS ile aynıdır.

**Kumanda → Host:**

| Tip | Taşıdığı bilgi | Not |
|-----|----------------|-----|
| `INPUT` | joystick/buton girdisi, `SET_NAME`, `SWITCH_SLOT` | 50ms throttle + ölübant (ateş/DASH hariç) |
| `JOIN_ROOM` | oda kodu + oyuncu adı | Hayalet geri kazanım + bot atlama burada |
| `PLAYER_READY` | hazır bayrağı | Sayaçta kilitli |
| `REACTION` / `PING` | emoji tepkisi / gecikme ölçümü | Ping 15sn |

**Host → Kumanda:**

| Tip | Taşıdığı bilgi | Not |
|-----|----------------|-----|
| `HOST_STATE_SYNC` / `GAME_STATE` | 8Hz oyun durumu + dirty-check | Skor/taşıyıcı/sinyal anında (hızlı yol) |
| `SLOTS_UPDATE` | 4 koltuk snapshot'ı (`slotIndex,name,color,kind,isReady`) | İki relay'de aynı şekil (parity) |
| `SLOT_CHANGED` | kişisel koltuk/renk ataması | Katılım + takas sonrası hedefe |
| `SLOTS_SWAPPED` | iki koltuğun yer değişimi | `kind` dahil taşınır |
| `PLAYER_JOINED` / `PLAYER_LEFT` / `PLAYER_UPDATED` | katılım/ayrılma/isim güncelleme | |
| `STAGING_STARTED` / `COUNTDOWN` / `GAME_STARTED` | akış geçişleri | |
| `GAME_MODE_CHANGED` / `RETURNED_TO_LOBBY` | oyun değişimi / lobiye dönüş | Ready iki tarafta sıfırlanır |
| `JOIN_SUCCESS` / `JOIN_ERROR` / `ROOM_CREATED` / `HOST_DISCONNECTED` | oda yönetimi | `JOIN_SUCCESS` ilk slot tablosunu taşır |

**Host → Server (yalnızca WS, `server/vitePluginWs.js` case'leri):** `HOST_CREATE_ROOM`, `SET_GAME_MODE`, `START_STAGING`, `START_GAME`, `RETURN_TO_LOBBY`, `SET_SLOT_BOT`, `CLEAR_SLOT_BOT`, `SET_SLOT_NAME`, `SWAP_SLOTS`.

## 4. Slot Modeli (özet)

`hostPlayerSlots[i] = { name, isReady, kind }` — TV listesi, motor `slotType`'ları ve telefon ızgarası relay snapshot'ından (`SLOTS_UPDATE` / `getSlots()`) beslenir. Bot = relay'de `isBot` yer tutucu; kumanda ızgarasında kilitli 🤖 rozet. Detay kurallar `AGENTS.md` madde 4'tedir.

## 5. Karar Defteri (neden böyle?)

- **3 haneli oda kodu (100–999):** 4 harfli koddan geçildi; telefonda yazımı hızlı.
- **İki aşamalı lobi:** modal bekleme → `SAHAYA GEÇ` (staging, koltuk serbest) → sayaç (kilitli) → oyun. Tek tıkla başlatmadaki "hazır değilim" kaosu böyle çözüldü.
- **İsimli skor şeridi:** kumandadaki boş alan canlı skor + isimler için kullanılıyor (PONG'un kendi tabelası var).
- **Publishable key:** Supabase `sb_publishable_...` anahtarına geçildi; `.env` → build'e gömülür.
- **8Hz dirty-check yayın:** kör timer yerine JSON karşılaştırmalı yayın + kritik olay hızlı yolu.
- **Host bot ekler:** sahadaki boş karta dokun (staging) veya modal kartına dokun (bekleme) → relay'de `isBot` koltuk; 1 insan kalırsa backfill yine dolar.
- **Ready-reset:** iki taraflı sıfırlama kuralı; tek taraflı denendi, "takılı HAZIR" üretti.
- **Kumanda ergonomisi:** dikey alt-orta kuşak, yatay köşeler (merkez denendi: erişim kötü; tam alt denendi: yapışık hissi).
- **Büyük harf isimler:** brutalist estetik kararı; 12 karakter sınırı.

## 6. Açık İşler

- [ ] HEIST yön oku / fener konisi (kodda yok; kontrol rehberi metni var).
- [ ] Masa-ortası lokal modda 4 yöne yazı döndürme (P2 180°, P3/P4 ±90°).
- [ ] ONLINE combined görünüm: uzaktaki oyuncunun kendi ekranında saha + kontrol bir arada (şu an kumanda saha görmüyor).

## Ek: Örnek Görsel Promptları (2 adet)

Formül `AGENTS.md` madde 10'dadır; `[OYUN NESNELERİ/KONSEPT]` kısmının doldurulmuş 2 örneği:

**Pong (`public/assets/games/pong.jpg`):**
> *"Ultra-minimalist 3D isometric illustration of an air hockey table with two vibrant minimalist paddles (one red, one blue) and a glowing white cube puck in motion, floating on a clean square arena platform with subtle border walls, stylized low-poly matte smooth finish, soft studio lighting, subtle shadow, warm off-white background, modern neo-brutalist game icon, no text, 1:1 aspect ratio."*

**Brutal Bomb (`public/assets/games/bomb.jpg`):**
> *"Ultra-minimalist 3D isometric illustration of a classic matte black spherical bomb with a lit glowing spark star fuse, sitting on a clean square floating platform tile with subtle warning stripes, stylized smooth low-poly finish, soft studio lighting, crisp drop shadow, warm neutral background, modern neo-brutalist party game aesthetic, no text, 1:1 aspect ratio."*

(Kalan 4 oyunun promptları git geçmişindedir: `git log -- AGENTS.md`.)
