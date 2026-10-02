# BRUTAL PARTY — Production Polish & Game Feel Seferberliği
> **Hedef:** Brutal Party'yi teknik olarak kusursuz bir indie prototipten; **Boomerang Fu, Mario Party, Smash Bros ve Brawl Stars** kalitesinde, salonu ayağa kaldıran birinci sınıf (Top-Tier) bir parti oyununa dönüştürmek.

---

## 1. Vizyon & Çekirdek Merkezli Mimari İlkeler

`fieldKit` ve `fxKit` ile zeminlerimiz zenginleşti; `soundEngine` ve `soundBank` ile Kenney örnek ses havuzu kurularak işitsel temel atıldı. Bir oyunu "iyi bir web projesi" olmaktan çıkarıp "konsol kalitesi" hissettiren şey, efekt miktarından ziyade **Dramatürji, Algı Hiyerarşisi (Diegetic UI) ve Görsel-İşitsel Sineztezi (Synesthesia)** bütünüdür.

### KESİN MİMARİ KURAL: 12 Oyun İçin Tek Merkez (`src/core/`)
- **Oyun Başına Yama YASAKTIR:** 12 ayrı oyun modumuz (`PONG`, `ARCHER`, `TANKS`, `HORDE`, `BOMB`, `HEIST`, `ZONE`, `SNAKE`, `COLLAPSE`, `NINJA`, `CROWN`, `CURVE`) için ayrı ayrı görsel, HUD veya kontrol kodu yazılmaz.
- **Tek Doğruluk Kaynağı (§4):** Tüm görsel, fiziksel, işitsel ve arayüz iyileştirmeleri `src/core/` altındaki ortak motor bileşenlerine yapılır:
  - Karakter kinetiği & vuruş hissi → `avatarInGame.js` + `fxKit.js`
  - 2.5D engel ve çevre derinliği → `arenaKit.js` (`drawObstacle`) + `fieldKit.js`
  - Baş üstü HUD ve durum göstergeleri → `entityStatus.js`
  - Dokunmatik ergonomi & güvenli marjlar → `playfield.js` + `touchFlow.js`
  - Maç rejisi, anonslar & seslendirme → `roundLifecycle.js` + `hud.js` + `soundEngine.js`
- **Sıfır Ek Yük & 60 FPS Garantisi (§11):** Bütün görsel zenginleşmeler procedural Canvas ve CSS GPU transform/opacity kurallarına (`motion.js`) sadık kalır; harici ağır sprite atlas veya DOM layout thrash oluşturulmaz.

---

## 2. Merkezi Sistemler Durum Panosu

| Çekirdek Sistem | Sorumlu Modül | Kapsam | Durum | Hedef & Etki |
|---|---|---|:---:|---|
| **1. Karakter Kinetiği & Juice** | `avatarInGame.js` + `characterRenderer.js` | **12 Oyunun Tamamı** | ✅ **Tamamlandı** | Squash & stretch (dash/tackle/hız/recoil), 1-kare beyaz hit flash |
| **2. 2.5D Engel & Çevre Derinliği**| `arenaKit.js` (`drawObstacle`) | **Tüm Bloklu Modlar** | ✅ **Tamamlandı** | 2.5D basık ön yüz (bevel), kırılma çizgisi, diorama temas oklüzyonu |
| **3. Diegetic HUD & Durum Yayları** | `entityStatus.js` + `hud.js` | **12 Oyunun Tamamı** | ✅ **Tamamlandı** | 120px devasa barlar kalktı; transient mikro-pips, radyal yaylar, yüzen çatışma metinleri |
| **4. Dokunmatik Ergonomi & Marjlar**| `playfield.js` + `tabletopRenderer.js` + `heistView.js` | **Tüm Mobil/Pad Ekranı**| ✅ **Tamamlandı** | Güvenli başparmak marjları (`safeTouchZones`), %16 mat dinlenme joystick'i, evrensel düz yazı standardı |
| **5. Maç Rejisi & Dramatürji** | `roundLifecycle.js` + `hud.js` | **12 Oyunun Tamamı** | 🟡 **İlerliyor** | Kenney spiker anonsları (`playRoundCall` Round 1/2/3/Final), raunt geçişleri |
| **6. Görsel-İşitsel Sineztezi** | `soundEngine.js` + `soundBank.js` | **Tüm Sistem** | ✅ **Tamamlandı** | 4-Bus mimarisi, Kenney örnek ses bankası, dinamik pitch detune |

---

## 3. Merkezi Eylem Planı (The 5 Central Pillars)

---

### SİSTEM 1 — Merkezi Karakter Kinetiği & Vuruş Hissiyatı (Kinetic Life)
*Merkezi Dosyalar:* `src/core/avatarInGame.js`, `src/core/fxKit.js`, `src/ui/characterRenderer.js`  
*Etkilenen:* **12 Oyunun Tamamı** (PONG'dan HORDE'a kadar tüm avatarlar)

1. **Hız & İvme Esnemesi (Squash & Stretch):**
   - Hızlanırken ve depar atarken hareket yönü boyunca %10–15 uzama (*stretch*).
   - Ani frenleme, duvara çarpma veya toslamada basılma (*squash*).
   - Silah ateşlendiğinde ters yöne mikro tepme (*recoil flinch*).
   - Karakterler hava hokeyi diski gibi kaymayı bırakır, canlı elastik kütle hissi kazanır.
2. **1-Kare Beyaz Vuruş Parıltısı (1-Frame White Hit Flash):**
   - `fxKit.emitFx('HIT')` veya doğrudan hasar anında karakterin silueti 1 kare (16–20 ms) saf beyaz parlar (`flash: true`) ve mikro geriye sıçrar.
   - Vurma/vurulma tatminini (kinetic satisfaction) katlar.
3. **Z-Ekseni Temas ve Havalanma Gölgesi (Contact & Air Shadow):**
   - Karakter yerdeyken altında tok ve yumuşak bir temas oklüzyonu (ambient shadow) bulunur.
   - Karakter zıpladığında, vurulup havaya savrulduğunda veya atıldığında zemin gölgesi küçülüp solarak yerden ayrışır; dikey derinlik (Z-axis) kazanılır.
4. **Reaktif Göz & Tehdit Takibi:**
   - Can %20'nin altına indiğinde gözlerde panik ifadesi ve minik ter damlası.
   - Skor veya şampiyonluk anında muzaffer bakış.

---

### SİSTEM 2 — Dokunsal Saha & 2.5D Engel Derinliği (Diorama Materiality)
*Merkezi Dosyalar:* `src/core/arenaKit.js` (`drawObstacle`), `src/core/fieldKit.js`  
*Etkilenen:* **Tüm Bloklu Modlar** (TANKS, BOMB, HEIST, HORDE, NINJA, ARCHER, SNAKE)  
*Özel Yol Haritası:* [ARENA_ELEVATION_PLAN.md](file:///c:/Users/kemal/Desktop/brutal-party/docs/ARENA_ELEVATION_PLAN.md)

1. **Engellerde 2.5D Basık Ön Yüz Derinliği (Bevel Extrusion):**
   - `drawObstacle` tek merkezden çizilir. Bloklara %10–15'lik basık ön-yüz derinliği (üstte açık ışık yüzü, önde gölgeli cephe) ve alt temas oklüzyonu eklenir.
   - Düz 2B kâğıt şema yerine, masada duran fiziksel ahşap, taş veya metal masaüstü dioraması hissi doğar (*Boomerang Fu / Brawl Stars* standardı).
2. **Zemin Çatışma İzleri (Battle Decals):**
   - Patlamalarda zeminde 3–4 saniyede silinen yarı saydam is lekeleri.
   - Mermi sekmesinde duvardan sıçrayan minik taş/talaş parçacıkları.
   - Sert dönüşlerde zemin rengine uygun hafif patinaj çizgileri.

---

### SİSTEM 3 — Merkezi Diegetic HUD & Durum Mimarisi (Clean Action Zone)
*Merkezi Dosyalar:* `src/core/entityStatus.js`, `src/core/avatarInGame.js`  
*Etkilenen:* **12 Oyunun Tamamı** (Can, mermi, fitil, kalkan, bekleme süresi)

1. **Transient (Geçici) Görünürlük:**
   - Oyuncunun hemen etrafındaki alan en kritik manevra/kaçış bölgesidir.
   - Can, cephane veya yetenek tamken baş üstü göstergeler **GİZLENİR** veya düşük saydamlığa çekilir.
   - Yalnızca hasar alındığında, mermi %30 altına düştüğünde veya doldurma anında 2 saniyeliğine belirip yumuşakça solar (`fade-out`).
2. **Kompakt Radyal Yay & Pips:**
   - Horde gibi modlarda görülen 120px devasa kalp ve plaka yığını yerine; gövde yarıçapını aşmayan şık radyal ark veya gövdeye bitişik mikro-pips dili (`entityStatus.js`).
   - Bomba fitili, ok gerilimi, tank mermisi ve yetenek bekleme süreleri aynı kompakt dille çizilir.
3. **Yüzen Çatışma Metinleri (`fxKit.emitFloatingText`):**
   - Başarılı blok, savuşturma, kritik vuruş veya puan anında yukarı süzülen tok tipografi: `+1`, `BLOCKED!`, `PARRY!`, `DODGE!`, `HEADSHOT!`.

---

### SİSTEM 4 — Merkezi Dokunmatik Ergonomi & Güvenli Marjlar (Touch Ergonomics)
*Merkezi Dosyalar:* `src/core/playfield.js` (`computePlayfield`), `src/controllers/touchFlow.js`, `src/ui/gamepadShell.js`  
*Etkilenen:* **Tüm Mobil / Kumanda Ekranları**

1. **Güvenli Başparmak Saha Marjları (`safeTouchMargins`):**
   - `computePlayfield` telefon modunda alt-sol ve alt-sağ başparmak temas alanlarını hesaplar ve arenayı bu bölgelerden korumaya alır.
   - Sanal kontroller sahadaki hiçbir kaleyi, köşe kasasını, oyuncu kartını veya skoru **ASLA ÖRTMEZ**.
2. **Yüzen & Şeffaflaşan Dinamik Joystick:**
   - Ekranın sol yarısında dokunulan İLK nokta joystick merkezi olur (başparmak kaysa da takip eder).
   - Boşta dururken %15 şeffaflığa inen zarif, mat, dokunsal tasarım dili.
3. **Evrensel Düz Yazı Standardı:**
   - Sahadaki hedef ve skor yazıları (örn. Heist kasaları) yalnız çoklu-dokunmatik masaüstü tablet modu aktifken 180° ters döner; tek ekranda, bot maçında ve TV kumandasında daima düz (okunur) tutulur.
4. **Dokunsal Göstergeler (Haptic Signatures):**
   - Dolum hazır: minik mekanik tıkırtı (`vibrate(12)`).
   - Boş ateş (dry-fire): çift mat titreşim (`vibrate([8, 20, 8])`).
   - Hasar anı: tok sarsıntı + ekran kenarında anlık kırmızı vinyet parıltısı.

---

### SİSTEM 5 — Merkezi Maç Rejisi & Dramatürji (Staging & Climax)
*Merkezi Dosyalar:* `src/core/roundLifecycle.js`, `src/ui/hud.js`, `src/core/soundEngine.js`  
*Etkilenen:* **12 Oyunun Tamamı**

1. **Elastik Raunt Başlangıç Ritüeli ("READY... GO!"):**
   - Raunt başlarken sahneye inen anlık sinematik barlar (letterbox).
   - Elastik (*squash & stretch*) olarak ekranda patlayan tok tipografi: **"RAUNT X" → "HAZIR..." → "BAŞLA!"**.
   - Yeni kurulan Kenney ses bankasından spiker anonsu (`voice: 'ready'`, `'go'`, `'round1'`).
   - "BAŞLA!" anında sahanın hafif bir darbeyle (0.2s) normal ölçeğine oturması.
2. **Kritik Çatışma & Climax Slow-Motion:**
   - Son 2 oyuncu kaldığında veya maç sayısı darbesinde 0.3 saniyelik %40 sunum yavaşlaması (*presentation slow-mo*). Host simülasyonu bozulmaz.
   - Süre bitimine son 5 saniye kala kalp atışı ritminde kenarlarda atan koyu vinyet nabzı.
3. **Podyum & Zafer Kutlaması:**
   - Sonuç ekranı düz istatistik kartı yerine; kazanan avatarın sahne ortasındaki podyuma sıçraması, taç takması ve konfeti patlamasıyla sunulması.
   - Elenen oyuncuların arkada hayalet animasyonuyla tepki emojileri fırlatması.

---

## 4. Oynanış Ustalığı & Slapstick Fizik

* **Mikro-Ustalık (`src/core/physics2d.js` + motorlar):**
  - Perfect Release & Parry: ARCHER/TANKS için zamanlama eşiği.
  - Geri Tepme (Recoil Shift): Ateş anında namludan zıt yöne minik itki.
  - Smaç & Kavis: PONG köşesiyle kesme vuruşu.
* **Slapstick Fizik:**
  - İki oyuncu kafa kafaya tosladığında çizgi film tarzı elastik sekme darbesi ve baş dönmesi yıldızları (*dizzy stars FX*).
  - Zincirleme itmeler ve komik kaza anonsları (`OOPS!`, `SUICIDE!`).

---

## 5. Uygulama Sırası & Doğrulama Kapıları

Bütün geliştirmeler doğrudan `src/core/` modüllerine uygulanır ve 12 oyunun tamamında aynı anda test edilir:

1. **Adım 1:** SİSTEM 1 — Karakter Kinetiği (`avatarInGame.js` squash/stretch + `fxKit.js` 1-frame white hit flash).
2. **Adım 2:** SİSTEM 2 — 2.5D Engel Derinliği (`arenaKit.js` `drawObstacle` bevel pahı).
3. **Adım 3:** SİSTEM 3 — Merkezi Diegetic HUD & Durum Yayları (`entityStatus.js` transient status).
4. **Adım 4:** SİSTEM 4 — Dokunmatik Ergonomi & Güvenli Marjlar (`playfield.js` safe margins + `touchFlow.js`).
5. **Adım 5:** SİSTEM 5 — Maç Rejisi & Spiker Sesleri (`roundLifecycle.js` letterbox + Kenney voiceovers).

### Doğrulama Kapısı
Her adım sonrasında:
- `npm run check` (TypeScript + tokens + rules-lint + 547 test) tam yeşil olmalıdır.
- `npm run health` ve Playwright smoke testleri ihlal vermemelidir.
