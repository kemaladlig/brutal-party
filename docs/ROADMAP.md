# BRUTAL PARTY // 4P — DÖNÜŞÜM YOL HARİTASI & MASTER PLAN

Bu belge, oyun testlerinden elde edilen kullanıcı geri bildirimleri doğrultusunda uygulamanın mekanik, görsel ve online çoklu cihaz dönüşümünü adım adım planlar.

---

## 🎯 VİZYON: ÜÇLÜ HİBRİT MİMARİ (TRIPLE-MODE ARCHITECTURE)

Uygulama tek bir kod tabanı üzerinden **3 farklı senaryoda** kesintisiz çalışacaktır:

1. **📱 LOKAL MOD (Tek Cihaz / Masa Ortası):**
   - İnternet gerekmez; tek bir tablet veya telefon masanın ortasına konur, 2-4 kişi aynı ekrandan oynar.
2. **📺 KONSOL / PARTİ MODU (Jackbox & AirConsole Modeli):**
   - TV, PC veya masa ortasındaki Tablet = **Ana Ekran (Display / Host)**.
   - Oyuncuların telefonları = QR kod okutularak bağlanan **Büyük Dokunmatik Kumandalar (Gamepad)**.
   - Ekranda el sıkışması yok, herkes koltuğunda rahat.
3. **🌐 ONLINE ÇOK OYUNCULU MOD (Uzak Bağlantı - İstanbul / Ankara):**
   - WhatsApp üzerinden oda linki (`brutalparty.app/oda/ABCD`) paylaşılır.
   - Her oyuncunun kendi ekranında hem oyun sahası hem de kendi kontrolleri yer alır.

---

## 🛠️ GELİŞTİRME FAZLARI

```
FAZ 1: Oyun Modlarını Mükemmelleştirme & Görsel Polish (Offline / Çekirdek)
  ├── 1.1 Pong Fiziği, Kale Oranları & Hazard Optimizasyonu
  ├── 1.2 Micro-Tanks Reload HUD & Mekanik İyileştirmeleri
  ├── 1.3 Brutal Curve Kontrollerinin Baştan İnşası
  ├── 1.4 Brutal Heist Spawn Mesafeleri & Yön İpuçları
  ├── 1.5 Brutal Bomb Kontrolleri & Çoklu Map Havuzu
  ├── 1.6 Quick Draw "İlk Basan" & Dereceli Puan Sistemi
  └── 1.7 Global Tipografi & 4 Yönlü Oyuncu Rotasyonu (Ters Yazılar)
       ↓
FAZ 2: Çoklu Cihaz & Online Ağ Altyapısı (Networking Core)
  ├── 2.1 Hafif WebSocket / WebRTC Oda Sunucusu (Room Server)
  ├── 2.2 Host (TV/Tablet) Ekran Modu + QR Kod Üretimi
  ├── 2.3 Telefon Kumanda Modu (Özelleştirilmiş Büyük Gamepad UI)
  └── 2.4 Uzaktan Online Senkronizasyon (İstanbul <-> Ankara)
```

---

## 📋 FAZ 1: OYUN MODLARI POLISH & DETAYLI DÜZELTMELER

### 1. 🏓 BRUTAL PONG (HOCKEY)
- **Top İvmelenmesi:** Her vuruştaki %20'lik aşırı hızlanma katsayısı (`boostMultiplier = 1.20`) ve lineer hız tabanı artışı dengelenecek; logarithmic yumuşak bir ivmelenmeye çekilecek.
- **Kale Genişlikleri Dengelemesi (Kritik Keşif):** Dikey ekranlarda yan kaleler (`arena.height` baz alındığı için) üst/alt kalelerin neredeyse 2 katı genişliğe ulaşıyordu. Kaleler her kenarda eşit koruma/açıklık sağlayacak şekilde dengelenecek.
- **Orta Saha Engeli (Rally 10 Hazard Core):** 
  - 10. rally'de aniden merkezde belirip topu kaleye saptıran engel kaldırılacak veya 2.5 saniye önceden merkezde kırmızı kesik çizgili uyarı halkası (`⚡ TEHLİKE YAKLAŞIYOR ⚡`) ile haber verilecek (ayrıca ayarlardan açılıp kapatılabilir olacak).

### 2. 🛡️ MICRO-TANKS
- **Mermi & Reload Göstergesi (Visual Clue & 7px Font Düzeltmesi):**
  - Şu anki 7px okunaksız minik yazı kaldırılacak.
  - Maksimum 2 mermi sınırı ve mermilerin duvarlarda sekme süresince ateş edememe durumu için net durum HUD'u: Tankın üzerinde ve kontrol köşesinde belirgin mermi kartuşları (`▮▮▮▯▯`), mermi sekmedeyken veya dolarken büyük ve net "DOLUYOR..." göstergesi.
  - Mermi bittiğinde/dolduğunda net haptik ve Brutalist görsel geri bildirim.
- **Görsel Polish & Sekme Hissi:**
  - Seken mermiler için namludan çıkan kıvılcım izleri ve duvar sekme partikülleri belirginleşecek.
  - Tank gövdesi ile namlu açısı ayrışacak, tank hareket hissi oturacak.

### 3. 🔄 GENEL GÖRSELLİK & 4 YÖNLÜ OYUNCU ROTASYONU (TÜM MODLAR)
- **Ters ve Yan Yazı Desteği (Omnidirectional Player UI):**
  - Masa etrafında veya tablette oynanırken karşıdaki (Üst P2: 180°), soldaki (P3: 90°) ve sağdaki (P4: -90°) oyuncular yazıları baş aşağı veya yan okumak zorunda kalmayacak.
  - Canvas context `save()`, `translate()`, `rotate()`, `restore()` ile ilgili oyuncunun adı, skoru, lobi yönergeleri ve butonları doğrudan **o oyuncunun baktığı yöne doğru döndürülecek**.
- **Büyük Tipografi & Netlik:**
  - Yazı boyutları tablet ve telefon ekranlarına göre scale edilecek (min 16-28px Space Grotesk/JetBrains Mono).
  - Skor tabelaları minik bantlar yerine net, kalın, brutalist kartlar haline gelecek.

### 4. 🐍 BRUTAL CURVE
- **Kontrol Yeniden İnşası & Çökme Hatası Giderimi:**
  - Oyunu kitleyen `cornerTouches` `null` referans hatası (`TypeError: Cannot read properties of null`) tespit edildi ve temizlenecek.
  - Ekran ikiye bölünecek: Oyuncunun alanının sol yarısına basınca Sola Keskin Dönüş, sağ yarısına basınca Sağa Keskin Dönüş.
  - Dokunma tutulduğu sürece pürüzsüz açı dönüşü sağlanacak, parmak kaldırıldığında düz gitmeye devam edecek.

### 5. 💎 BRUTAL HEIST (SOYGUN)
- **Eşit Doğum Noktaları (Fair Radial Spawns):**
  - Dikey ekranda üst-alt oyuncular ile yan oyuncular arasındaki dengesiz mesafe düzeltilecek. Kasalar ve oyuncu başlangıç noktaları merkezdeki elmasa eşit yarıçapta (`circle-distance layout`) yerleştirilecek.
- **Yön Göstergesi & Sabit Kontrol:**
  - Hırsız karakterinin önüne parlak bir yön oku / fener konisi eklenecek; oyuncu nereye baktığını her an görecek.
  - Karakter kontrolleri köşeye sabitlenmiş şık bir analog halkaya bağlanacak; parmağın diğer oyuncunun alanına kayması engellenecek.

### 6. 💣 BRUTAL BOMB
- **Kontrol & Yön İpuçları:**
  - Karakterin baktığı yöne doğru koşan animasyonlu yön oku.
  - Bombayı taşıyan oyuncunun etrafında devasa nabız gibi atan alev/fitil efekti ve zemin uyarı gölgesi.
- **Çoklu Harita Havuzu (Map Presets & Otomatik Rotasyon):**
  - Ezberlenen tek harita stratejisini kırmak için haritalar her raunt başında otomatik değişecek veya lobi ekranında belirgin harita seçici olacak (5 farklı dinamik arena: Labirent, Açık Meydan, 4 Sütunlu Siperler, Hızlandırıcı Bantlı Arena, Çapraz Koridorlar).

### 7. 🤠 QUICK DRAW (DÜELLO)
- **Mekanik Değişimi: "İlk Basan Kazanır (Tap on Signal)":**
  - Basılı tutup kaldırma yerine sinyali ("ATEŞ! / ÇEK!") görür görmez ekrana ilk dokunan kovboy ateş edecek. Çok daha doğal, refleks tabanlı ve eğlenceli.
- **Sıralamalı Puanlama (3-4 Oyuncu İçin Adil Sistem):**
  - 1. olan: +3 Puan
  - 2. olan: +2 Puan
  - 3. olan: +1 Puan
  - Erken basan (False Start): -1 Puan ceza
- **Genişletilmiş Skor Tabelası:**
  - Büyük kovboy arayüzü ve tepki süresi (milisaniye) dökümü.

---

## 🌐 FAZ 2: ÇOKLU EKRAN & ONLINE ALTYAPISI

1. **Sunucu Mimarisi (Node.js WebSocket):**
   - Hafif, tek bir porttan çalışan oda tabanlı sunucu.
   - `ODA_KUR` -> `KOD: 7X8Y`
   - Gecikme hedefi: Türkiye içi fiberde 10-25 ms.
2. **Roller:**
   - **Ekran (Display Host):** Oyunu büyük ekranda render eder.
   - **Kumanda (Gamepad Controller):** Sadece dokunmatik kontrolleri gösterir (D-Pad, Büyük Dash Tuşu, İsim seçimi).
   - **Online Oyuncu (Combined):** Uzaktan oynayanlar için hem oyun hem kontroller tek ekranda.

---

## 🎯 FAZ 3: CANLI TEST GERİ BİLDİRİMLERİ & OYNANIŞ POLISH (AKTİF)

### 1. 📺 Kalıcı Parti Lobisi (Persistent Party Hub & Game Switcher)
- **Problem:** Oyun bitince veya menüye dönünce oda kapanıyor / dağılıyor, oyuncular kopuyor.
- **Çözüm:** 
  - Bir kere lobi kurulduğunda (`#KOD`), maç bitse veya yarıda kesilse dahi **oyuncular odada kalır**.
  - Oyun içi ekranda (TV'de) sol üstte **"📺 LOBİYE DÖN / OYUN DEĞİŞTİR"** butonu yer alacak.
  - Maç bittiğinde veya bu butona basıldığında TV anında mevcut oyuncuların (`P1 Kemal`, `P2...`) bağlı olduğu Lobiye dönecek, telefon kumandaları da otomatik `LOBBY` ekranına geçecek.
  - TV'den tek tıkla başka bir oyun (örneğin Tanks veya Curve) seçilip hemen başlatılabilecek.

### 2. 🏓 Pong Top Hız Eğrisi (Diminishing Acceleration)
- **Problem:** Ralli uzadıkça hız doğrusal olarak sürekli artıyor ve bir yerden sonra refleks sınırını aşan kontrolsüz bir patlama yaşanıyor.
- **Çözüm:** Hız artışını lineer yerine **logaritmik / azalan artış (diminishing returns)** formülüne bağlamak ve maksimum tepe hız tavanı (`maxSpeedCap`) getirmek. Ralli uzadıkça hızlanma yavaşlayacak ve oyun oynanabilir hız bandında kalacak.

### 3. 📱 Pong Kumanda Ergonomisi (Paddle Touch Track)
- **Problem:** Dokunma alanı tüm telefon genişliğine yayılmış, başparmağı uçtan uca gezdirmek ergonomik değil.
- **Çözüm:** Dokunma alanını başparmağın doğal erişim kavisinde (%75-80 kompakt genişlik) tutmak ve hassasiyet çarpanı (`sensitivity: 1.25x`) ile parmağı ekranın en dışına zorlamadan TV sahasının köşelerine tam erişim sağlamak.

### 4. 📊 Kumanda Skor HUD & Canlı Bilgi Alanı
- **Problem:** Kumanda ekranındaki boş alan değerlendirilmiyor.
- **Çözüm:** Maç esnasında kumandada canlı skor tablosu (Örn: `🔴 3 - 2 🔵`), ralli sayacı ve maç durumu göstergesi yer alacak.

### 5. 🛡️ Micro-Tanks Arcade Sürüş & 2 Mermi / Cooldown Dengesi
- **Problem:** Mermiler spam şeklinde üçerli çıkıyordu ve bekleme süresi yoktu.
- **Çözüm:**
  - Joystick kaldırıldı; tank kendi ekseninde otomatik dönüyor.
  - Sol alanda **`🚀 İLERLE (BASILI TUT)`** gaz pedalı.
  - Sağ alanda **`💥 ATEŞ`** butonu: Sahada aynı anda en fazla 2 mermi (`maxBullets = 2`), her mermi atışında 0.55s reload bekleme süresi ve kumandada 2'li kartuş HUD'u (`▮▮`).

### 6. 💺 Mobilden 4 Koltuk Seçimi (Seat Selection Grid)
- **Problem:** Oyuncu lobiye girdiğinde rastgele bir slota düşüyordu ve yerini değiştiremiyordu.
- **Çözüm:**
  - Mobil kumandaya 4 koltuklu interaktif ızgara eklendi (🔴 P1 Alt, 🔵 P2 Üst, 🟡 P3 Sol, 🟢 P4 Sağ).
  - Oyuncu boş bir koltuğa dokunduğunda (`SWITCH_SLOT`) anında o slota ve TV'deki ilgili alana geçer.

### 7. 🔠 Zorunlu BÜYÜK HARF (UPPERCASE) İsim Standardı
- **Problem:** Küçük harf veya karışık yazım brutalist estetiği bozuyordu.
- **Çözüm:** Tüm oyuncu isimleri (`storePlayerName`, `getStoredPlayerName`, `executeJoin`, `SET_NAME`, UI gösterimleri) sistem genelinde zorunlu `.toUpperCase()` standardına bağlandı.

### 8. 📱 Sade & Kullanıcı Dostu Ana Menü (Dual Hero Cards)
- **Problem:** "Lokal Mod", "TV Konsol" gibi kafa karıştırıcı sekmeler ve karmaşık teknik jargonlar vardı.
- **Çözüm:**
  - Gereksiz 3'lü sekme yapısı kaldırıldı.
  - İkili Hero Kartı mimarisi:
    1. **`📱 TELEFONU KUMANDA YAP`**: Doğrudan 4 haneli kod kutusu (`[ BOMB ]`) + `BAĞLAN →` butonu ile salondaki oyuna katılma.
    2. **`📺 BU EKRANI OYUN EKRANI YAP`**: Tek tıkla salondaki TV veya tablet için parti odası kurma.
  - **Masa Ortası Tek Cihaz Oyunu:** Aşağıdaki 6 oyundan birine dokunulduğunda soru sormadan hemen lokal maçı başlatır.

### 9. 📲 TV Lobi Ekranında 3 Adımlı Net Bağlantı Düzeni
- **Problem:** QR kod, ham URL linki ve butonlar birbirine girmişti.
- **Çözüm:**
  - **1. YOL // EN HIZLI:** Büyük net QR kod + *"Telefonunun kamerasını tut"* yönergesi.
  - **2. YOL // KOD GİR:** Kocaman `#KOD` + *"Siteye gir ve bu 4 haneli kodu yaz"* yönergesi.
### 10. 🎨 Ultra-Minimalist İzometrik Oyun Görselleri & Standart Prompt Stratejisi
- **Problem:** Oyunların görsel kimliği eksikti ve menü/lobi sadece metin veya emojilerden oluşuyordu.
- **Çözüm:**
  - 6 parti oyununun tamamı için özel ultra-minimalist 3D izometrik illüstrasyonlar üretildi (`public/assets/games/`).
  - Ana menü bento kartlarına, TV host lobisi oyun değiştirme chiplerine ve mobil kumanda lobi ekranına entegre edildi.
  - İleride eklenecek yeni oyunlar için prompt formülü, stil parametreleri ve mimari rehber kök dizindeki [`AGENTS.md`](file:///c:/Users/kemal/Desktop/Hockey/AGENTS.md) dosyasına kalıcı olarak kaydedildi.



