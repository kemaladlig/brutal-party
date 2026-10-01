# BRUTAL PARTY — Production Polish & Game Feel Seferberliği
> **Hedef:** Brutal Party'yi teknik olarak kusursuz bir indie prototipten; **Boomerang Fu, Mario Party, Smash Bros ve Brawl Stars** kalitesinde, salonu ayağa kaldıran birinci sınıf (Top-Tier) bir parti oyununa dönüştürmek.

---

## 1. Vizyon & Tasarım Felsefesi

`fieldKit` ve `fxKit` ile zeminlerimiz zenginleşti ve temel görsel efekt altyapımız (hit-stop, partikül havuzu, ekran travması) kuruldu. Ancak bir oyunu "iyi bir web projesi" olmaktan çıkarıp "konsol kalitesi" hissettiren şey, efekt miktarından ziyade **Dramatürji, Algı Hiyerarşisi (Diegetic UI) ve Görsel-İşitsel Sineztezi (Synesthesia)** bütünüdür.

### Tasarım Kriterleri & Mimari Sınırlar
- **Host Otoritesi (§2):** Tüm kritik fizik, sayaç ve dramatürji kararları host'ta üretilir; kumandalar yalnızca sunum ve dokunsal geri bildirim (haptik/görsel flaş) alır.
- **Tek Doğruluk Kaynağı (§4):** Yeni stiller `tokens.css` + `tokens.js` sözlüğüne, FX bütçeleri `fxKit.js` tablosuna, arayüz şemaları `hud.js` ve `quickChrome.js` modellerine eklenir. Kopyalama ve lokal `if/else` yasaktır.
- **Sıfır Ek Yük & 60 FPS Garantisi (§11):** Bütün görsel zenginleşmeler procedural Canvas ve CSS GPU transform/opacity kurallarına (`motion.js`) sadık kalır; harici ağır sprite atlas veya DOM layout thrash oluşturulmaz.

---

## 2. Eylem Fazları (Production Roadmap)

### FAZ 1 — Dramatürji & Maç Rejisi (Staging & Climax)
*Her raundun bir tiyatro sahnesi gibi girişi, tırmanışı, doruk noktası ve kutlaması olmalıdır.*

1. **Elastik Raunt Başlangıç Ritüeli ("READY... GO!"):**
   - Mevcut küçük HUD sayacı yerine, sahneye tepeden ve alttan inen anlık sinematik barlar (letterbox).
   - Ekranın ortasında elastik (*squash & stretch*) olarak patlayan ve hızla kaybolan **"RAUNT X" → "HAZIR..." → "BAŞLA!"** anonsu.
   - "BAŞLA!" anında sahanın hafif bir darbeyle (0.2s) normal ölçeğine oturması.
2. **Kritik Çatışma / Foto-Finiş (Climax & Slow-Motion):**
   - Son 2 oyuncu kaldığında veya son vuruş gerçekleştiğinde 0.3 saniyelik %40 sunum yavaşlaması (*dramatic slow-mo*).
   - Süre bitimine son 5 saniye kala kalp atışı ritminde ekran kenarlarında atan hafif koyu vinyet nabzı.
   - Sahanın son saniyelerde daralması veya aciliyet hissinin görselleştirilmesi (*Sudden Death* anonsu).
3. **Podyum & Zafer Kutlaması (Celebration Hierarchy):**
   - Sonuç ekranı düz bir istatistik kartı olarak değil, kazanan avatarın sahne ortasında podyuma sıçraması, taç takması ve konfeti patlamasıyla sunulması.
   - Elenen oyuncuların arkada yenilgi/hayalet animasyonuyla tebrik etmesi veya tepki emojileri fırlatması.

---

### FAZ 2 — Diegetic UI (Arayüzü Sahaya Gömme)
*Oyuncu gözünü köşelerdeki skor tablosuna değil, kendi karakterine odaklar. Bilgi oyuncunun gözünün baktığı yerde yaşamalıdır.*

1. **"Neredeyim Ben?" Doğuş Göstergeleri (Spawn Indicator):**
   - Raunt başında veya respawn anında oyuncunun avatarı üstünde 1.2 saniye süzülen parlak **"SEN / 1P"** rozeti ve zeminde nabız gibi atan renkli aura halkası.
   - 4 oyunculu kaos anında yerel oyuncunun avatarını rakiplerden anında ayıran hafif dış kontrast hale (T1 hiyerarşisi).
2. **Yüzen Çatışma Metinleri (Floating Combat Juice):**
   - Başarılı savuşturma, blok, kritik isabet veya puan alımlarında darbe noktasından yukarı doğru sıçrayıp sönen dinamik minik tipografiler:
     - `+1`, `BLOCKED!`, `DODGE!`, `RICOCHET!`, `HEADSHOT!`, `STOLEN!`.
3. **Baş Üstü Mikro Durum Yayları (Overhead Arcs):**
   - Bomba taşıyıcısının tepesinde hızlanan geri sayım fitili ve kıvılcımı.
   - Cooldown veya cephane dolumunun avatarın etrafında dolan minik, şık radyal ark ile aktarılması (köşedeki bara bakma ihtiyacını sıfırlar).

---

### FAZ 3 — Tipografik Kimlik & Brutalist Arcade Ruhu
*SaaS benzeri temiz fontlardan, enerjisi yüksek bir arcade kimliğine geçiş.*

1. **Display Font & Tipografi Katmanı:**
   - Anonslar (`MATCH POINT`, `VICTORY`, `SUDDEN DEATH`) ve skor sayıları için hacimli, tok, enerjik bir arcade/display fontunun (örn. *Lilita One* veya *Rubik Mono One*) sisteme kazandırılması.
   - Sayıların düz metin yerine derinlikli brutalist 3D-extrusion (katmanlı sert gölge) ile çizilmesi.
2. **Skor Sayaç Animasyonları (Rolling Score Ticks):**
   - Puan kazanıldığında skorun anında `0 -> 1` olması yerine, minik bir yaylanma (*punch scale 1.25 -> 1.0*) ve tıkırtı sesi eşliğinde sayması.

---

### FAZ 4 — Görsel-İşitsel Sineztezi (Web Audio Rezonansı)
*Arayüz ne kadar parlak olursa olsun, ses olmadan "top-tier" hissettirmesi nörolojik olarak imkansızdır.*

1. **Dinamik Ses Skalası & Varyasyon:**
   - `src/audio.js` içindeki prosedürel synthesizer seslerine ±%6 pitch varyasyonu (aynı sesin robotik tekrarlanmasını engellemek için).
   - 3-2-1 geri sayımında frekansı tırmanan tonlar (Do-Re-Mi-SOL akordu).
2. **Arayüz Dokunsal Sesleri (UI Mechanical Audio):**
   - Menü butonlarına odaklanıldığında ve tıklandığında tok, tatmin edici ahşap/plastik mekanik tıkırtılar.
   - Raunt bittiğinde çalan kısa, retro jingle ve ıslık sesleri.

---

### FAZ 5 — Telefon Kumandasını "Canlı Konsola" Çevirme (Second Screen)
*Oyuncunun elindeki telefon sıradan bir web kumandası değil, oyunun fiziksel bir parçasıdır.*

1. **Reaktif Durum Haptikleri & Flaşları:**
   - **Bomba bende:** Geri sayım daraldıkça sıklaşan gerçekçi bir kalp atışı haptiği (`vibrate([30, 90])`).
   - **Hasar anı:** Telefon ekranının kenarlarında anlık kırmızı vinyet parlaması ve tok sarsıntı.
   - **Şarj hazır:** Yetenek dolduğunda başparmak altına minik bir mekanik "klik" haptiği (`vibrate(12)`).
2. **Elenen Oyuncu Seyirci Modu (Ghost / Crowd Interaction):**
   - Erken elenen oyuncunun ekranı kararmak yerine "HAYALET / TARAFTAR" moduna geçer.
   - Sahadaki oyuncuları desteklemek ya da trolleyebilmek için hızlı emoji yağmuru, alkış veya korna butonları.

---

## 3. Oynanış (Gameplay) Analizi ve Eylem Planı

### Mevcut Durum Değerlendirmesi
| Boyut | Durum (1-10) | Teşhis |
|---|:---:|---|
| **Temel Fizik & Tepkisellik** | **8.5** | `physics2d` ve `playfield` entegrasyonu sağlam, gecikme yok, 60 FPS akıcı. |
| **Görsel Alan & Geri Bildirim** | **7.5** | `fieldKit` renkleri ve `fxKit` partikülleri temeli kurdu. |
| **Ustalık Eğrisi (Mastery Curve)** | **5.5** | Çoğu oyunda mekanikler tek katmanlı; "kolay öğrenilir, zor ustalaşılır" derinliği henüz oluşmadı. |
| **Parti Dengesi & Geri Dönüş (Comeback)** | **4.0** | Öne geçen oyuncu çoğu oyunda rahatça maçı koparıyor; geride kalanı oyuna bağlayan mekanizma zayıf. |
| **Elenen Oyuncu Bekleme Süresi (Downtime)** | **4.5** | Erken elenen oyuncu raunt bitene kadar pasif kalıyor; dikkat dağılıyor. |
| **Slapstick & Komik Kaos Faktörü** | **5.0** | Fizik kuralları bazen fazla steril; partide kahkaha attıran beklenmedik sekme ve kazalar sınırlı. |

---

## 3. Oynanış (Gameplay) Derinleştirme Eylem Planı

### Mevcut Durum Değerlendirmesi
| Boyut | Durum (1-10) | Teşhis |
|---|:---:|---|
| **Temel Fizik & Tepkisellik** | **8.5** | `physics2d` ve `playfield` entegrasyonu sağlam, gecikme yok, 60 FPS akıcı. |
| **Görsel Alan & Geri Bildirim** | **7.5** | `fieldKit` renkleri ve `fxKit` partikülleri temeli kurdu. |
| **Ustalık Eğrisi (Mastery Curve)** | **5.5** | Çoğu oyunda mekanikler tek katmanlı; "kolay öğrenilir, zor ustalaşılır" derinliği henüz oluşmadı. |
| **Parti Dengesi & Geri Dönüş (Comeback)** | **4.0** | Öne geçen oyuncu çoğu oyunda rahatça maçı koparıyor; geride kalanı oyuna bağlayan mekanizma zayıf. |
| **Elenen Oyuncu Bekleme Süresi (Downtime)** | **4.5** | Erken elenen oyuncu raunt bitene kadar pasif kalıyor; dikkat dağılıyor. |
| **Slapstick & Komik Kaos Faktörü** | **5.0** | Fizik kuralları bazen fazla steril; partide kahkaha attıran beklenmedik sekme ve kazalar sınırlı. |
| **Kör Kontrol Ergonomisi (Blind Touch)** | **5.5** | TV'ye bakarken mobilde başparmak kayması (thumb drift) ve hedeften sapma yaşanabiliyor. |

---

### Öncelikli Oynanış Müdahaleleri (2.A, 2.D, 2.E)

```
┌────────────────────────────────────────────────────────────────────────┐
│                      OYNANIŞ ÜÇGENİ (GAMEPLAY TRIAD)                   │
│                                                                        │
│               [ 2.A ] MİKRO-USTALIK (Skill Ceiling)                     │
│               - Perfect Release & Parry                                │
│               - Drift & Recoil Dynamics                                │
│                               ▲                                        │
│                              ╱ ╲                                       │
│                             ╱   ╲                                      │
│                            ╱     ╲                                     │
│                           ▼       ▼                                    │
│        [ 2.D ] SLAPSTICK FİZİK    [ 2.E ] KÖR ERGONOMİ                │
│        - Elastik İtme & Sekme      - Yüzen Joystick (Dynamic Thumb)    │
│        - Komik Çarpışma Kazaları   - Affedici Nişan & Haptik Tıklar   │
└────────────────────────────────────────────────────────────────────────┘
```

---

#### 1. [2.A] Mikro-Ustalık Katmanı (Micro-Mastery Mechanics)
*Amacı: Kuralı 5 saniyede öğrenilen oyunda, 50. saatte bile arkadaşına üstünlük sağlayabileceğin "tatmin edici bir numara" yaratmak.*

* **ARCHER — "Kusursuz Bırakış (Perfect Release)" & "Savuşturma (Parry)":**
  - **Perfect Release:** Yay gerilirken 0.6–0.75 saniyelik altın aralıkta (sweet spot) nişan bırakılırsa; ok altın parıltılı iz (*gold tracer FX*), +%30 hız ve hafif delip geçme gücü kazanır. Erken veya geç bırakış standart atış yapar.
  - **Parry / Deflect:** Kalkan/atılma tam gelen oka karşı doğru 150 ms içinde açılırsa; ok havada durmaz, fırlatıldığı yöne doğru tersine sekerek (*ricochet*) sahibine döner.
* **TANKS — "Geri Tepme (Recoil Shift)" & "Köşe Sekme Hızlanması (Ricochet Accel)":**
  - Namludan çıkan merminin tankı ters yöne 4-6 px anlık itmesi. Usta oyuncu bu itkiyi uçurumlardan veya düşman mermisinden kaçmak için manevra olarak kullanabilir.
  - Duvara 45 dereceden dar açıyla çarpan merminin sekme anında ses perdesi ve hızı artar (*kinetic ricochet*).
* **BOMB — "Omuz Atma / İtme (Tackle-Push)":**
  - Bombayı devrederken son anda basılan aksiyon butonu rakibe doğru kısa bir omuz darbesi vurur; rakip 0.3 saniye sersemler (*daze*), bombayı kaçıramaz.
* **PONG — "Kavis & Smaç (Slice & Smash)":**
  - Raketin en dış %20'lik köşesiyle vurulduğunda top belirgin bir kavis çizer (*curve trail*) ve hız çarpanı anlık pik yapar.

---

#### 2. [2.D] Slapstick Fizik & Komik Kazalar (Emergent Slapstick)
*Amacı: Parti oyununun gerçek yakıtı olan "beklenmedik komik hatalar" ve kahkaha anlarını fizik üzerinden üretmek.*

* **Elastik İtme Katsayısı (Body Bounce Impulse):**
  - `physics2d` çözücüsünde iki oyuncunun gövdesi çarpıştığında salt pozisyon itmesi yerine; birbirlerini hızlarına oranla zıplatan elastik bir itme darbesi eklenir.
  - İki oyuncu kafa kafaya tosladığında çizgi film tarzı bir sarsılma ve minik dönme (*squash + dizzy stars FX*).
* **Zincirleme Kaza Zincirleri (Domino Collisions):**
  - Bir oyuncunun diğerini iterek mayına, patlayan bombaya veya uçuruma yuvarlaması.
  - Seken okların veya mermilerin sahibini arkadan vurabilmesi (komik self-kill anonsu: `OOPS!`, `SUICIDE!`).

---

#### 3. [2.E] Kör Kontrol Ergonomisi (Blind Touch Navigation)
*Amacı: Oyuncunun telefon kumandasına değil, sadece TV/büyük ekrana odaklanmasını sağlamak.*

* **Yüzen Joystick Merkezi (Dynamic Floating Stick):**
  - Mobilde sol parmak sabit bir daireye muhtaç kalmaz; ekranın sol yarısında dokunulan İLK nokta anında joystick merkezi olur. Başparmak kaysa bile merkez oyuncuyu takip eder.
* **Akıllı & Affedici Nişan (Forgiving Magnetism Cone):**
  - Dokunmatik ekranda 1-2 derecelik açı kaçırmaları can sıkıcıdır. `autoAim` modülü, hedef yönünde ±25° içinde bir düşman varsa nişanı görünmez şekilde hedefe hafifçe kilitler (*soft magnetism*).
* **Dokunsal Göstergeler (Blind Haptic Signatures):**
  - **Mermi/Cooldown Doldu:** Başparmak altında net ve tatmin edici bir mekanik tıkırtı (`vibrate(15)`).
  - **Boş Ateş (Dry-Fire):** Yetenek hazır değilken basıldığında iki hızlı mat titreşim (`vibrate([8, 20, 8])`).
  - **Duvara Çarpma:** Sahanın dışına tosladığında derin, donuk bir sarsıntı (`vibrate(25)`).

---

## 4. Uygulama ve Doğrulama Adımları

1. **Pilot Oyun Seçimi (ARCHER & TANKS):**
   - 2.A (Perfect Release / Recoil) ve 2.D (Elastik çarpışma) ilk olarak ARCHER ve TANKS motorlarında doğrulanır.
2. **Kontrol Katmanı (Gamepad & TouchFlow):**
   - 2.E (Yüzen Joystick ve Haptik Tıklar) `touchFlow.js` ve `gamepadShell.js` seviyesinde merkezi olarak entegre edilir.
3. **Doğrulama Kapıları:**
   - `npm run check` (TypeScript, token, rules-lint tam yeşil).
   - `tests/movementBudget.test.mjs` ve `tests/archerAimPrecision.test.mjs` testlerinin korunması.

