# Brutal Party — Technical Roadmap & Master Plan

> **Durum:** Taslak & Karar Kaydı
> **Tarih:** Eylül 2026
> **Kural Hatırlatması:** `AGENTS.md` ve `docs/PROJECT_MAP.md` sözleşmeleri ile uyumlu, modüler, authoritative-host mimarisi.

---

## 0. Görüş Alanı ve Sunum İlkesi (Viewport Policy)

*Karar (Eylül 2026):*
1. **Kamera sistemi tamamen kaldırıldı.** Dinamik zoom ve pan katmanı iptal edilerek klasik 1:1 sabit arena görünümüne dönüldü.
2. **Sabit Tam-Arena Görüşü:** Tüm 13 oyun modunda tüm oyuncular, duvarlar ve nesneler %100 ekranda kalır.
3. **Ekran Titremesi (Trauma/Screen Shake):** Patlama ve çarpışmalarda `addTrauma` ile tuval içi hafif sarsıntı korunur.
4. **Öncelik:** Temel altyapı (Ayrık HUD, motor sözleşmesi, ağ ve kontroller) tamamlanana kadar kamera konusu gündeme alınmayacaktır.

---

## 1. Milestones (Geliştirme Aşamaları)

```
[Faz 1: Evrensel Ayrık HUD & Dokunmatik Katmanı]
       │
       ▼
[Faz 2: 13 Motor Sözleşmesi & Giriş Standardizasyonu]
       │
       ▼
[Faz 3: Ağ & State Senkronizasyonu Sağlamlaştırma]
       │
       ▼
[Faz 4: Paylaşımlı FX, Parçacık Havuzu & Ses/Haptik]
       │
       ▼
[Faz 5: Game Feel & Juiciness (13 Moda Yayılım)]
```

---

### FAZ 1: Evrensel Ayrık HUD & Dokunmatik Katmanı (Universal Discrete HUD)

**Hedef:** Dokunmatik kontrolleri, lobi slot kartlarını ve skor tabelalarını oyun arenasının fiziksel koordinatlarından tamamen ayırmak; her cihazda (PC, Tablet, TV, Telefon) net ve çakışmasız kılmak.

- [x] **Ayrık UI Katmanı (Discrete UI Layer):**
  - Motorların canvas içine çizdiği lobi köşeleri (`uiButtons`) ile oyun içi kontrollerin BaseGame üzerinden standart `renderHUD(ctx)` ve `renderControls(ctx)` katmanlarına taşınması (13 motorun tamamı taşındı).
- [x] **Masa-ortası 4 Köşe Dokunmatik Kontroller (Tabletop Virtual Controls):**
  - 4 köşe dinamik yüzen joystick ve aksiyon butonlarının ekran kenarlarına (`safe-area`) ergonomik sabitlenmesi.
  - Proximity Ghosting: Karakter kontrollerin altına yaklaştığında butonların yumuşakça şeffaflaşması (alpha: 0.22 - 0.25).
- [x] **Duyarlı Ekran Yerleşimi (Responsive Aspect Ratios):**
  - 16:9 (TV/Monitör), 4:3 (iPad/Tablet), 19.5:9 (Mobil dikey/yatay) oranlarında arena ortalanırken HUD elemanlarının ekran sınırlarına akıllı kenetlenmesi (`docking` via `this.viewport`).

---

### FAZ 2: 13 Motor Sözleşmesi & Giriş Standardizasyonu (Engine Contract Unification)

**Hedef:** 13 oyun motorunun istisnasız aynı yaşam döngüsü ve giriş API'sini tüketmesi; kod tekrarının sıfırlanması.

- [ ] **Ortak Motor Yaşam Döngüsü:**
  - `resetMatch()`, `startNewRound()`, `update(dt)`, `renderWorld(ctx)`, `renderHUD(ctx)`, `resize(w,h)`.
- [ ] **Giriş Köprüsü (Dual-Input Bridge):**
  - `handleRemoteInput(slotIndex, data)` (Telefon kumandasından gelen ağ verisi).
  - `handleLocalInput(slotIndex, data)` (Lokal klavye WASD/Oklar/IJKL/TFGH ve masa-ortası dokunmatik).
  - Her motor bu iki kanalı tek bir `applySlotInput(slotIndex, action/vector)` mantığında birleştirir.
- [ ] **Ortak Yardımcıların Tam Entegrasyonu (`src/core/`):**
  - `inputMaps.js`: 4 slot klavye haritalarının eksiksiz kullanımı.
  - `touchFlow.js`: Lobi koltuk seçimleri, bot ekleme/çıkarma tap'lerinin tek merkezden yönetimi.
  - `pickupSystem.js`: Kopyalanmış power-up rutinlerinin yerine ortak spawn/collect yapısının kullanılması.

---

### FAZ 3: Ağ & State Senkronizasyonu Sağlamlaştırma (Netcode & State Hardening)

**Hedef:** TV Console (Yerel WebSocket) ve Online (Supabase Relay) modlarında 8 Hz bütçesinde sıfır desync, kusursuz kopma/yeniden bağlanma yönetimi.

- [ ] **Paket Boyutu & Serileştirme Optimizasyonu:**
  - `packet()` çıktılarının sıkılaştırılması; yalnızca değişen alanların dirty-check ile iletilmesi.
  - Skor, taşıyıcı ve mermi gibi anlık olayların hızlı yol (fast-path) ile anında gönderilmesi.
- [ ] **Kopma & Hayalet Reconnect (Ghost-reconnect Watchdog):**
  - 30 saniyelik kopma köprüsü: Geçici bağlantı kopmalarında koltuğun korunması ve telefon yeniden bağlandığında aynı slotu geri alması.
  - Bot koltuklarının asla hayalet oyuncu tarafından ezilmemesi (`seatsLocked` sayaç güvenliği).
- [ ] **Ready State Çift Taraflı Senkronu:**
  - Lobiye dönüşlerde veya oyun başlangıcında hem host hem de kumanda taraflarında hazır bayrağının eşzamanlı sıfırlanması.

---

### FAZ 4: Paylaşımlı FX, Parçacık Havuzu & Ses/Haptik Altyapısı (Shared FX & Audio)

**Hedef:** Garbage Collection (GC) takılmalarını sıfıra indiren ve zengin vuruş hissi veren hafif altyapı.

- [ ] **Sıfır Tahsisli Parçacık Havuzu (Zero-Allocation Particle Pool):**
  - Önceden ayrılmış (pre-allocated) parçacık havuzu (`ParticlePool`).
  - Toz izleri, kıvılcımlar, patlamalar ve konfetiler için obje üretmeden (GC-free) yeniden kullanım.
- [ ] **Hafif Synthesizer / Web Audio İyileştirmesi (`src/audio.js`):**
  - Ateş, patlama, sekme, sayma ve zafer için modüler synth önayarları.
  - Ses kanalı yönetimi (aynı anda çok fazla ses patlamasını önleyen ses sınırlayıcı / voice limiter).
- [ ] **Titreşim / Haptik Veri Yolu (Gamepad Haptics):**
  - `navigator.vibrate` desteği olan telefon kumandalarında darbe anında mikro-titreşimler (örn: tank mermisi atıldığında 20ms, vurulduğunda 80ms).

---

### FAZ 5: Game Feel & Juiciness (13 Moda Yayılım)

*Teknik taban hazırlandıktan sonra oyunlara sırayla eklenecek cila katmanı.*

- [ ] **Hitstop (Micro-Freeze):** Kritik vuruşlarda 30–60 ms donma ile ağırlık hissi.
- [ ] **Input Buffering:** Erken basılan tuşların 3–4 kare tamponlanarak tam hareket bitiminde icra edilmesi.
- [ ] **Squash & Stretch:** Hızlanma, zıplama ve çarpışmalarda karakter geometrisinin esnemesi.
- [ ] **Zafer & Tur Sonu Töreni (Match Ceremony):** Tur kazananının kutlanması, yavaş çekim (slow-mo) son vuruş.

---

## 2. Karar Özeti & Yeni Ajan Talimatı (Agent Onboarding)

1. **Kamera Kararı:** Kamera (zoom & pan) sistemi tamamen kaldırıldı ve branch temizlendi. Tüm 13 oyunda klasik **1:1 sabit arena görünümü** korunmaktadır.
2. **Geliştirme Sırası:** Öncelik temel teknik mimaride:
   * **Sıradaki İş:** `FAZ 1: Evrensel Ayrık HUD & Dokunmatik Katmanı`
   * Ardından: Faz 2 (Giriş & Motor Sözleşmesi) -> Faz 3 (Ağ) -> Faz 4 (FX & Ses) -> Faz 5 (Game Feel).
3. **Yeni Oturuma Başlarken:** Yeni agent doğrudan bu dosyayı okuyup `FAZ 1` kapsamındaki iş paketini (`renderHUD`, `renderControls`, masa-ortası dokunmatik kontrollerin ayrıştırılması) uygulamaya koymalıdır. Her etapta `npm run check` ve `npm run build` doğrulaması zorunludur.
