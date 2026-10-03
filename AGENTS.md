# AGENTS.md — AI Agent Çalışma Kuralları

Bu dosya her oturumda yüklenir: yalnız sözleşmeler, bütçeler ve yasaklar. Gerekçe/hikâye barındırmaz.
Geniş mimari detaylar `docs/PROJECT_MAP.md`'dedir. Yapı, protokol veya motor değiştiğinde iki dosya da senkron güncellenir.

---

## 1. Yığın, Modlar & Yetki

- **Teknoloji:** Vanilla HTML5 + CSS3 + ES Modules, Canvas 2D, Vite, PWA (`sw.js`).
- **3 Çalışma Modu:**
  - `LOCAL`: Tek cihaz, ağ yok. 4 slot yerel klavye/joystick.
  - `TV_CONSOLE`: TV host ekranı + telefonlar kumanda (lokal WebSocket).
  - `ONLINE`: P1 telefonu host; keşif Supabase, veri WebRTC.
- **Kesin Yetki:** Host tek simülasyon otoritesidir. Kumandalar yalnız girdi (`(x,y)` / buton) gönderir, simülasyon yapmaz. Motorda ağ kodu bulunmaz.
- **Girdi Geçidi:** Uzak girdiler yalnız `handleRemoteInput(slotIndex, data)` üzerinden işlenir.
- **Güvenlik:** Supabase anahtarları yalnız `.env`'den okunur (`VITE_SUPABASE_*`). Koda gömülmez, commit'lenmez.

---

## 2. Engine Registry (Tek Kayıt Noktası)

- `src/core/engineRegistry.js` → `GAME_ORDER` (14 oyun) ve `CARTRIDGES[MOD]` sözleşmesi.
- `main.js` veya `gamepad.js` içine `if (mode === ...)` dalı yazmak **YASAKTIR**. Yeni oyun = registry kaydı + şema.
- **Motor Sözleşmesi:** `resetMatch/reset`, `startNewMatch`, `startNewRound`, `update`, `render`, `resize(w,h)`, `handleRemoteInput`.
- **LOCAL Mod Gereksinimi:** Her motor tek ekranda 4 köşeli dokunmatik lobi ve klavye haritasıyla (P1: WASD+Space, P2: Oklar+Enter, P3: IJKL+O, P4: TFGH+B) eksiksiz çalışmalıdır.

---

## 3. Çekirdek Mantık & Living Diorama İlkeleri (`src/core/`)

Motorlar ortak mantığı kopyalamaz, `src/core/` modüllerinden `import` eder:

- **Living Tabletop Diorama Görselliği:**
  - Zemin ve çevre yalnız `drawField` + `paintBackdrop` ile çizilir; motor kendi zemin/duvar dolgusunu çizmez.
  - **2.5D Hacim & Extrusion:** Engeller ve duvarlar düz 2D kutu değil; sol-üst -45° ana ışıktan beslenen parlak pah (specular bevel), alt tarafta koyu ön cephe (front face) ve tok yönlü temas gölgeleri (contact AO) ile çizilir.
  - **Sıfır GC Çöpü:** Çizim döngüsünde (kare başına) yeni `CanvasGradient`, `Path2D` veya nesne tahsisi yapılamaz. Ortak damgalar ve havuzlar kullanılır.
  - **Sıfır Ağ Maliyeti:** Zemin izleri, ışık havuzları, kenar esnemeleri ve darbe çatlakları tamamen istemci taraflı görselleştirmedir (client-side juice). Pakete alan eklenmez.
- **Tek Ayarlar Yüzeyi:** `src/ui/settings/` (actions → schema → row → panel → sheet). Ayarlar için ayrı DOM veya ad-hoc event dinleyicisi yazılmaz.
- **Tip Sözleşmesi:** `src/types/minigame.d.ts` ve `src/types/geometry.d.ts` tek kaynaktır.
- **Ölçek & Hız:** Ham piksel yazılmaz. Hareket `fieldSpeed`, boyutlar `fieldRadius` / `fieldPx` ve `arena.unit` üzerinden türetilir.
- **Avatarlar:** Sahada daima `faceMode: 'play'`, yuvarlak siluet ve 2.5D küresel hacim taşır.

---

## 4. Slot & Ağ Bütçesi

- **Slotlar:** Tek otorite relay snapshot'ıdır (`players[]`). İsimler büyük harf, $\le 12$ karakter.
- **Host → Kumanda:** 8 Hz dirty-check; kritik durumlar anlık. ONLINE world-view 30 Hz unreliable `world` kanalı (jitter buffer + 60 Hz interpolasyon).
- **Kumanda → Host:** 40 ms throttle + deadzone; aksiyonlar (ateş, dash, tackle) throttle dışı.
- **STATE_SYNC Paketi:** Discriminator en üstte, yük daima düz nesnedir (`core/networkProtocol.normalizeStateSync`).

---

## 5. UI & Arayüz Standartları

- **Tasarım Sözlüğü:** `src/styles/tokens.css` + `src/ui/tokens.js`. Ham renk literalleri ve tanımsız `var()` yasaktır.
- **Overlay & Modal:** Tek merkez `src/ui/overlayHost.js`.
- **Düz Panel Dili:** Kenarlık/kutu kirliliği yok; ince ayraçlar, sabit yükseklikli sekmeler, $\ge 44\text{ px}$ dokunma hedefleri.
- **Skorbord:** Tek yüzey `tabletopRenderer.renderStandardScoreboard` → `hud.js renderMatchHeader`.
- **İkonlar:** `src/core/tabletopIcons.js`. Ham OS emojisi yasaktır (istisna: `reactions.js`).
- **Motion:** Yalnız GPU dostu `transform` ve `opacity` (150–250 ms). `prefers-reduced-motion` desteklenir.

---

## 6. Kesin Yasaklar (Hard Rules)

1. Çekirdek dosyalara moda/ekrana özel `if/else` dalı eklemek.
2. `src/core/` mantığını motor dosyalarına kopyala-yapıştır yapmak.
3. Kumandada simülasyon / motorda ağ kodu çalıştırmak.
4. Ağ paketlerine keyfi veya salt görsel amaçlı yeni alanlar eklemek.
5. Kare başına (60 FPS döngüsünde) bellek tahsisi (allocation/GC thrash) yapmak.
6. İznisiz `git push` veya `commit` yapmak.

---

## 7. Agentic Workflow & Orantılı Doğrulama (Proportional Verification)

Gereksiz uzun test döngüleri agentik akışı yavaşlatır. Doğrulama işin büyüklüğüne göre **orantılı** yürütülür:

- **1. Görsel & Stil Dokunuşları (CSS, renk, gölge, parçacık, mikro-çizim):**
  - Tüm test suite'ini koşmak **GEREKSİZDİR**.
  - İlgili dosyanın lint kontrolünü yap (`npm run check:tokens` veya `npm run check:rules`) ve tarayıcıda görseli doğrula.
- **2. Küçük Düzeltme & Tek Modül (1-2 dosya, mantık iyileştirmesi):**
  - Yalnızca etkilenen test dosyasını çalıştır: `node --test tests/[ilgili].test.mjs`.
- **3. Ağ, Protokol, Motor veya Mimari Değişikliği (Büyük Özellik):**
  - Tam kontrol kapısını çalıştır: `npm run check` (`tsc` + linter'lar + testler + `health`).
- **E2E & CI (`npm run test:e2e`):** Yalnızca majör motor döngüsü değişikliklerinde veya PR öncesi koşulur; ufak adımlarda zorunlu değildir.
- **Varsayım Politikası:** Küçük detaylarda inisiyatif alıp kararı uygula; yalnızca geri dönüşü zor veya yapısal kararlarda kullanıcıya danış.
- **Git & Push:** Yalnızca kullanıcı açıkça istediğinde commit/push yapılır.
