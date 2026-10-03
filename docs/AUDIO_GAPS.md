# Ses Eksikleri — Tarama Notu (2026-10-03)

DURUM: düzeltildi. `npm run check` yeşil (684 test + health 13/13).
Kural: click/karar anında `playMenuTick` (gezme) / `playMenuPop` (onay), maç başında `playStart`, sonda fanfar.

## A. Menüler — tamamen sessiz dosyalar

- `src/ui/views/gamesView.js` — hiç audio import yok. `tile click select()` :101 ve `playBtn.onclick onGameSelect` :155 sessiz. homeView'deki OYNA pop veriyor, buradaki vermiyor. Sekme şeridi kendisi tick veriyor (tabStrip), o kısım tamam.
- `src/ui/pauseModal.js` — hiç audio import yok. Sessiz: resume :283, close :287, settings :294/:295, reset :297, exit :303, tv-lobby :327, koltuk swap :204, rotate :351.
- `src/ui/hostLobby.js` — hiç play yok. Sessiz: dismiss :408, invite :410, seat-invite :411, chip :419, switch :474, dice :480, slot aksiyonlar :497/:527/:579, toggle :589, launch :596, close :612, copy :620/:621/:623, whatsapp :634.
- `src/ui/joinModal.js` — hiç play yok. Sessiz: paste :129, cancel :142, submit :165, hero join :195, hero paste :212.
- `src/main.js` staging bar — sessiz: edit-seats :588, launch :591, lobby :594.
- `src/ui/settings/settingsSheet.js:43` close sessiz (satırlar tick veriyor, kapama vermiyor).
- `src/ui/windowChrome.js:148-149` fullscreen tap sessiz. `src/ui/controllerLayoutEditor.js:237-251` save/cancel/close/reset sessiz.
- `src/ui/appShell.js:609` `#shell-home` click sessiz (diğer shell butonları :109/:514/:610 tick veriyor).

## B. Menüler — kısmi eksik

- `src/ui/customizeModal.js` — tek ses preview boing :436. Sessiz: close :164, backdrop :165, tab :168, save :174, reset :182, palet gridler :254/:276/:295.
- `src/ui/playerNameField.js:140` saveBtn `commit()` ses vermiyor (yanındaki reroll :129 pop veriyor).
- `src/ui/views/lobbyView.js:221` grid close `closeOverlay` ticksiz. `:244` face click gridi ticksiz açıyor (gridBtn :228 tickli).
- `src/games/bomb.js:1019`, `crown.js:1419` `cycleMap` onClick sessiz. `src/games/game.js:1173/1182` seat cycle/join toggle sessiz.

## C. Oyun içi — lobi + maç sonu

- Win/Lose fanfar ölü kod: `playWinVoice/playLoseVoice/playWinJingle/playLoseJingle` `audio.js`'de tanımlı ama repo genelinde hiç çağrılmıyor. Hiçbir oyunda maç sonu kazanma/kaybetme jingle yok.
- Canvas lobi tap'leri sessiz: `touchFlow.js` bilerek ses çıkarmıyor, `lobbyCenterStartTap` soundu `startNewMatch` içindeki gecikmiş `playStart`'a kalıyor, anlık tick/pop yok. `lobbyQuadrantTap` koltuk değişiminde 12 oyunun tamamında ticksiz (tanks dahil).
- Maç sonu restart tutarsız: `playJoin` var — archer :518, collapse :545, curve :441, game.js :347, ninja :578, snake :515, zone :1008. Yok — bomb :554, colossus :117, crown :1439, heist :502, horde :1961, tanks :583.
- `hud.js:1232-1233` maç sonu kartı `onRestart/onLobby` aksiyonları soundu çağırana bırakıyor, kartın kendisi ses vermiyor.

## D. Düzeltme (uygulandı)

- Koltuk sesi tabana indi: `BaseGame.onSeatCycled` join çalar, 4 kopya override silindi (bomb/crown/heist/zone). Renk noktası `cycleLocalSeat` tick verir. Lobi başlatma zaten `startNewMatch→playStart` ile sesliydi, dokunulmadı. `cycleMap` zaten içinden join çalıyordu, dokunulmadı.
- Restart standardize: 6 motorda tap-yolu `playJoin` eklendi (bomb/colossus/crown/heist/horde/tanks). Kart butonu `hud.js` tek kapıdan ses verir (birincil→join, ikincil→tick).
- Maç sonu fanfar: host `main.js` döngüsü MATCH_OVER girişinde `playWinJingle` (12 motor ortak), kumanda sonuç açılışında pop+jingle.
- Ölü kod silindi: `playGunshot`, `playFakeoutCrow` + bank eşlemesi (çağıran yoktu, testler yeşil).
- Warm listesi genişledi: `jingle.start`, `tick.bomb`, `voice.count1`, `voice.fight` eklendi.
- Düzeltme sırasında temize çıkanlar (ilk notta yanlış işaretlenmişti): `appShell` shell-home tickliymiş, `game.js` join zaten sesliymiş.

---

## E. 2. Tur — gözden kaçanlar (derin tarama, düzeltildi)

- Ölü sesler (tanımlı, hiç çağrılmıyor): `playGunshot`, `playFakeoutCrow` — `audio.js` + bank mapping var (`shot.laserLarge`), repo genelinde sıfır caller. Win/lose dörtlüsüyle birlikte 6 ölü fonksiyon. Ya bağla ya sil.
- Telefon kumandası (`gamepad.js`) sessizleri: score-peek `:976` ticksiz (yanındaki menuBtn tickli), leave-gamepad `:981` sessiz, fullscreen `:991` sessiz, leave-lobby-direct `:1481` ve `:1525` (armed + confirm ikisi de sessiz), edit-character açma `:1489` sessiz (kaydetme tickli, açma değil).
- Pong yön butonu (`controllerTemplates.js:776` invertBtn) sessiz — toggle tick olmalı. spinBtn `:774` `cooledAction`'dan geçiyor, motor tarafında karşılığı yoksa oyun içi spin de sessiz kalır (şüpheli, engine tarafı bakılmalı).
- Reaction picker: trigger açma (`reactionPicker.js:88-93`) sessiz, backdrop kapatma (`:62`) sessiz — sadece seçim `:57` pop veriyor.
- Blocked-shot feedback tutarsız: `notifyFireBlocked` archer + horde + colossus'ta bağlı. tanks `playDryFire`'ı ham çağırıyor; aynı tetikte hâlâ farklı his.
- Mute toggle (`toggleAudio`) iki yönde de sessiz — mute'ta normal ama unmute'ta confirm pop olmalı.
- `warmGameSounds` yalnız 4 sample ısıtıyor (tick, confirm, punchLight, laserSmall). bomb tick, countdown voice, start jingle ilk basışta geç kalabilir.
- Temiz çıkanlar (tekrar bakma): profileView (palet/yüz/rim/zar hepsi tickli), homeView + showcase + heroAvatar (pop/tick yerinde), tabStrip, settingsRow, roomView oda seçimi.
