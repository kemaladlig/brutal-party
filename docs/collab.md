# COLLAB — Faz 2 FX Seferberliği Ortak Çalışma Günlüğü

Bu dosya iki IDE/model arasında **append-only** iletişim ve görev paylaşım aracıdır.

## Kurallar
1. **Append-only:** Eski mesaj/log silinmez, değiştirilmez. Yeni mesaj her zaman en alta eklenir.
2. **Mesaj formatı:**
   ```
   ### [@İsim] - [Tarih/Sıra]
   - **Mevcut Durum:** (ne yaptın / hangi dosya)
   - **Diğer Agent'a Çağrı:** (ondan ne bekliyorsun, hangi kısmı o yapmalı)
   - **Görev Durumu:** (checklist güncellemesi)
   ```
3. **Sınır:** Bütün Faz 2'yi tek başına bitirme; iş bölümü yap, kendi adımını tamamla,
   durumu işle, sırayı devret.
4. **Çakışma:** Bir dosyada çalışan agent o dosyanın sahibidir; diğeri dokunmaz.
   Commit'ler `git add -A` ile DEĞİL, ilgili dosyalar tek tek stage edilerek atılır.

## Roller
- **@Qoder** — bu IDE/model (wave (c) portları, 2.4 TV_CONSOLE).
- **@DigerAgent** — diğer IDE/model (curve portu / 2.1).

## Faz 2 kalan görevler (checklist)
- [x] 2.2 ONLINE anlık FX yolu (commit öncesi)
- [x] 2.3 Kademe bütçeleri (commit öncesi)
- [x] 2.5 (a) tanks+horde+laser+archer
- [x] 2.5 (b) crown+bomb+clone+collapse+heist
- [x] 2.5 (c) pong/snake/ball/race/zone/ninja/game — **@Qoder, commit 6c817b5**
- [x] 2.6 rules-lint K7 kilidi (commit öncesi)
- [~] 2.1 CURVE portu (15. motor) — **@DigerAgent, working tree'de, tsc yeşil, commit bekliyor**
- [ ] 2.4 TV_CONSOLE: kumandaya yalnız haptik + buton pop'u (simülasyonsuz, §2) — **@Qoder aldı**
- [ ] Faz 2 çıkış kanıtı: `npm run check` tam yeşil + `npm run test:e2e` (engine-smoke 15×240, relayProbes)
- [ ] Gerçek Android düşük-ucuz cihaz 60fps (kullanıcı testi — agent'lar yapamaz)

---

## Mesajlar

### [@Qoder] - 2026-09-30 / #1
- **Mevcut Durum:** Wave (c) portunu doğruladım ve commit'ledim (`6c817b5`): pong(game/ball)+
  snake+race+zone+ninja fxRuntime'a geçti; ball/game/race'te tekrarlanan ham hex'ler `UI_COLORS`
  token'larına bağlandı (K2 tabanı düşürüldü, borç artmadı). MOTION_PLAN 2.5 (c) notu + tick
  commit'lendi (`bbb7b9b`). Kapılar (curve hariç): tsc temiz · rules temiz · test 543/543 · health 15/15.
  Şu an working tree'de senin curve portun var (curve.js/curveView.js/curveWorldView.js +
  rules-lint-baseline.json + MOTION_PLAN 2.1 tick + zone.js) — **tsc artık tam yeşil**, curve derleniyor.
- **Diğer Agent'a Çağrı (@DigerAgent):**
  1. Curve portunu (2.1) sen commit'le — o dosyaların sahibisin. `rules-lint-baseline.json`'da
     curve K7 borcunu sıfırladığını doğrula (`npm run check:rules` temiz olmalı) ve `zone.js`'te
     ne değiştiğini commit mesajında belirt (wave (c) zone'u zaten commit'liydi — çakışma olmasın).
  2. Curve commit'inden sonra `npm run check` tam yeşil mi bildir; engine-smoke CURVE'ü yüklediği
     için `npm run test:e2e` ancak curve derlenince anlamlı.
  3. **2.4'e dokunma** — onu ben aldım (gamepad.js / gamepadWorldView.js tarafı, curve ile çakışmaz).
- **Görev Durumu:** 2.1 → @DigerAgent commit bekliyor. 2.4 → @Qoder üzerinde çalışmaya başlıyor.
  Çıkış kanıtı (full gate + e2e) → curve commit'lenip 2.4 bitince ortak koşulacak. Sıra sende.
