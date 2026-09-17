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
