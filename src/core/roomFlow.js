import { t } from '../i18n.js';
import { ensureStoredNick, storePlayerName, cleanPlayerName, ensureActiveNetwork, supabaseRelay } from '../net.js';
import { hostPlayerSlots, updateHostSlot, syncSlotsToEngine, swapEngineSlots, clearRemoteSlot, clearAllRemoteSlots, clearRemoteMove, clearRemoteAim, getColorClashIndices, isBotEkleEnabled, refreshSlotCard, refreshAllHostSlots } from './slotManager.js';
import { getAvatarProfile, sanitizeAvatar, pickFreeColor, setSlotAvatar, clearSlotAvatar, loadLocalSeatColors, ensureLocalSeatColorsForTypes, getLocalSeatColors } from './customizationManager.js';
import { getSlotSwapError } from './slotRules.js';
import { reportError } from './errorReporter.js';
import { showInstallToast, showConnectionBanner, hideConnectionBanner } from '../ui/toast.js';
import { showHostLobbyModal, getEffectiveJoinUrl, hideHostLobbyModal, startHostPingBadge, stopHostPingBadge, getCurrentHostGameMode, setCurrentHostGameMode, setHostPlayerButtonState, openHostSeatEditor } from '../ui/hostLobby.js';
import { getEngine, isEngineWarm, forEachEngine, getControllerMeta, ensureEngine, releaseAllExcept } from './engineRegistry.js';
import { setIsPaused, closePauseModal, renderPauseSeats } from '../ui/pauseModal.js';
import { hideAppShell, revealAppShell, lockLandscape, beginMatchChrome } from '../ui/appShell.js';
import { resolveLocalControlMode } from '../ui/tokens.js';
import { showReaction, clearReactions } from '../ui/reactionLayer.js';
import { playJoin, playCountdownTick, playFightShout, warmGameSounds } from '../audio.js';
import { acquireWakeLock, releaseWakeLock } from './wakeLock.js';
import { setPreference } from './preferences.js';

export function createRoomFlow(deps) {
  const {
    activeNet, getPlatformMode, updatePlatformMode,
    canvas, onNetworkReaction,
    touchManager, localGamepadManager, gamepadManager, inputRouter,
    inGameHud, btnQuickTvLobby, getActiveGameEngine, updateReactionButtons,
    disconnectInactiveNetwork, partyNetwork,
  } = deps;

  // -- SLICE 1 --
let currentMode = 'MENU';
let lastTransitionTime = 0;

// ONLINE host P1 olarak açılır; koltuk düzenleyici ile sonradan taşınabilir.
// TV_CONSOLE host ise bu state'i lobi butonuyla açıp kapatır; network
// authority yine host cihazda kalır.
let hostPlayerActive = false;
let hostPlayerSlot = null;
let pendingHostSeatBeforeSwap = null;

// Sahne durumu (AGENTS §7): LOBBY → STAGING → COUNTDOWN → GAME.
// `stagingMode` hangi oyunun sahasının açık olduğunu, `seatsLocked` sayaç
// anında koltukların kilitli olduğunu taşır.
let stagingMode = null;
let seatsLocked = false;
let countdownTimer = null;
let lastCountdownT = 0;

function markTransition() {
  lastTransitionTime = performance.now();
}

/**
 * "KALDIĞIN YER" kaydının TEK yazma noktası (okuma: `views/homeView.js`).
 * Saha geçişi başarılı olduktan sonra çağrılır; katalogda gezinmek ya da
 * lobide oyun değiştirmek kaydı yazmaz — kayıt "oynanan" oyunu anlatır.
 * @param {string} mode
 */
function rememberLastPlayedGame(mode) {
  if (!mode || mode === 'MENU') return;
  setPreference('lastGameMode', mode);
  setPreference('lastPlayedAt', Date.now());
}

  
  
  
  
  let modeSwitchToken = 0;
  let consecutiveEngineErrors = 0;
  let lastEngineError = null;

  // -- SLICE 2 --
async function setGameMode(mode) {
  markTransition();
  modeSwitchToken += 1;
  const token = modeSwitchToken;
  // Error boundary kurtarma: mod değişiminde hata sayacı sıfırlanır, yoksa
  // çöken motordan dönülünce yeni motorun update() döngüsü kilitli kalırdı.
  consecutiveEngineErrors = 0;
  lastEngineError = null;
  setIsPaused(false);
  closePauseModal();
  touchManager.resetTouches();

  if (mode === 'MENU') {
    currentMode = mode;
    // Yerel kumanda yaşam döngüsünün TEK sahibi `main.js` kare döngüsüdür;
    // burada yalnız görünürlüğü kapatıyoruz, ikinci bir "aktif" bayrağı yok.
    localGamepadManager.hide();
    // Faz 3: menüye dönüşte host ekran kilidi bırakılır. Tam ekran NIYETI
    // bırakılmaz — o, sekmenin krom ilişkisinin kaydıdır ve `fullscreen.js`'te
    // yaşar (menüde düğmeyle girilen tam ekran bir sonraki maçı da kapsar).
    releaseWakeLock();
    // Faz 4.5 tek-koltuk: menüde örnek tutulmaz — tüm motorlar yıkılır.
    // (Klavye sahipliği/temiz tuş döngüsüne gerek kalmadı: ayakta motor yok.)
    releaseAllExcept(null);

    if (btnQuickTvLobby) {
      btnQuickTvLobby.classList.add('hidden');
    }
    updateReactionButtons(false);
    clearReactions();

    // MENU: shell görünür olur ve görünüm yığını köke döner.
    revealAppShell();
    inGameHud.classList.add('hidden');
    touchManager.setHandler(null);
    return;
  }

  // Oyun yolu: motoru istenirse yükle (dinamik import + kurulum).
  // Yükleme bildirimi sadece ilk indirmede gösterilir (önbellekteyse anlıktır).
  if (!isEngineWarm(mode)) {
    showInstallToast(t('toast.loading', getControllerMeta(mode)?.lobbyTitle || mode));
  }
  let entry = null;
  try {
    entry = await ensureEngine(mode);
  } catch (err) {
    console.error(`[Engine Load: ${mode}]`, err);
    showInstallToast(t('toast.loadFail'));
    return;
  }
  if (token !== modeSwitchToken || !entry) return;
  currentMode = mode;

  // Faz 4.5 tek-koltuk: aktif olmayan tüm motor örnekleri yıkılır; klavye
  // sahipliği yalnız aktif motorda (yeni kurulan örnek false doğar, burada açılır).
  releaseAllExcept(mode);
  entry.game.isLocalInputActive = true;

  const now = performance.now();

  if (btnQuickTvLobby) {
    btnQuickTvLobby.classList.toggle('hidden', !activeNet().isHosting);
  }
  updateReactionButtons(activeNet().isHosting);

  hideAppShell();
  inGameHud.classList.remove('hidden');
  const activeEl = /** @type {HTMLElement | null} */ (document.activeElement);
  if (activeEl && typeof activeEl.blur === 'function') {
    try { activeEl.blur(); } catch {}
  }
  try { canvas.focus(); } catch {}
  lockLandscape();
  touchManager.setHandler(entry.game);
  // LOCAL: kayıtlı koltuk renkleri reset ÖNCESİ deftere yüklenir (init renkleri
  // doğru kurulsun), reset sonrası varsayılan insan koltuklarına boş renk atanır.
  if (!activeNet().isHosting) {
    loadLocalSeatColors();
  }
  entry.reset();
  if (!activeNet().isHosting) {
    ensureLocalSeatColorsForTypes(entry.game.slotTypes);
    // Reset'te kurulan oyuncu renklerini LOCAL koltuk renkleriyle eşitle
    const locals = getLocalSeatColors();
    for (let i = 0; i < 4; i++) {
      if (locals[i] && typeof entry.game.applyLocalSeatColor === 'function') {
        entry.game.applyLocalSeatColor(i, locals[i]);
      }
    }
  }
  entry.onEnter(now);
  entry.game.resize(window.innerWidth, window.innerHeight);
  // Örnekler saha yüzeyi açılırken arka planda ısıtılır: LOCAL dahil her yolda
  // ilk çalma synth'e düşmesin (raunt/fight anonsları dahil).
  try { warmGameSounds(); } catch {}
  syncSlotsToEngine(entry.game, currentMode, activeNet().isHosting);
  setSeatTapHook();
}

function resetActiveGame() {
  const now = performance.now();
  getEngine(currentMode)?.reset();
  touchManager.resetTouches();
}

function onResumeAfterPause() {
  const now = performance.now();
  getEngine(currentMode)?.onResume(now);
  touchManager.resetTouches();
}

  // -- SLICE 3 --
async function openHostLobby(gameMode = 'HORDE') {
  pendingHostSeatBeforeSwap = null;
  setCurrentHostGameMode(gameMode);
  hostPlayerActive = getPlatformMode() === 'ONLINE';
  hostPlayerSlot = hostPlayerActive ? 0 : null;
  setHostPlayerButtonState(hostPlayerActive, getPlatformMode());
  let hostAvatar = null;
  try { hostAvatar = getAvatarProfile(); } catch { hostAvatar = null; }
  const hostIsPlayer = getPlatformMode() === 'ONLINE';
  const hostIdentity = {
    name: ensureStoredNick(),
    avatar: hostAvatar,
    // ONLINE: telefon host başlangıçta P1 olur ve her oyuncu world görür.
    // TV_CONSOLE: TV ekranı varsayılan olarak oyuncusuz host kalır;
    // lobi içindeki düğme ile aynı cihazı P1'e dahil edebilir.
    asPlayer: hostIsPlayer,
    slotIndex: hostIsPlayer ? 0 : null,
    worldView: hostIsPlayer,
  };
  try {
    // ONLINE/public dalında relay modülü ilk yükte gelmez; oda kurulmadan
    // hemen önce burada yüklenir. Yükleme hatası bu catch'e düşer.
    const net = await ensureActiveNetwork(getPlatformMode());
    await net.hostRoom(gameMode, {
      onConnectionRestored: () => markConnectionRestored(),
      onHostPlayerState: (state) => {
        applyHostPlayerState(state);
        if (state?.error) showInstallToast(t('toast.hostPlayerJoinFail'));
      },
      onRoomCreated: (roomCode) => {
        const joinUrl = getEffectiveJoinUrl(roomCode, getPlatformMode());
        showHostLobbyModal(roomCode, joinUrl);
        startHostPingBadge(() => activeNet().ping, getPlatformMode());
        setSeatTapHook();
        // LOCAL koltuk renkleri relay odasına sızmasın (gelen avatarlar yazar)
        for (let i = 0; i < 4; i++) {
          clearSlotAvatar(i);
          updateHostSlot(i, false);
        }
        // ONLINE odada host cihaz aynı zamanda P1 oyuncusudur. TV_CONSOLE
        // host'un kendi P1'i ancak lobi düğmesiyle aktifleşir.
        const hostState = getPlatformMode() === 'ONLINE'
          ? activeNet().getHostPlayerState?.()
          : null;
        const onlineHostPlayer = hostState?.player || activeNet().players?.[0] || null;
        if (onlineHostPlayer) {
          applyHostPlayerState({
            active: true,
            slotIndex: hostState?.slotIndex ?? onlineHostPlayer.slotIndex ?? 0,
            player: onlineHostPlayer,
            isReady: hostState?.isReady !== false,
          });
        } else {
          applyHostPlayerState({ active: false });
        }
        refreshAllHostSlots();
      },
      onPlayerJoined: (msg) => {
        playJoin();
        // Cihaz-başı avatar: relay'den gelir; yoksa/geçersizse boş rastgele renk.
        let av = null;
        try {
          av = msg.avatar ? sanitizeAvatar(msg.avatar, { keepColor: true }) : null;
        } catch { av = null; }
        if (!av) {
          const taken = hostPlayerSlots
            .filter((p, i) => p && p.kind !== 'bot' && p.kind !== 'bot_god' && i !== msg.slotIndex)
            .map((p) => p.displayColor || p.avatar?.color || p.color)
            .filter(Boolean);
          av = sanitizeAvatar({ color: pickFreeColor(taken) }, { keepColor: true });
        }
        setSlotAvatar(msg.slotIndex, av);
        updateHostSlot(msg.slotIndex, true, msg.name, false, 'human', av, msg.color || av.color);
        refreshStagingBar();
        // Staging/sayaç sırasında katılan geç kalanı mevcut faza sok
        // (STAGING_STARTED geçmişte kaldı, yoksa bekleme ekranında takılır).
        // Sayaçtaysa STAGING + güncel tik + koltuklar yeniden basılır —
        // katılan odaya girdiği için yayın ona da ulaşır.
        if (stagingMode && !countdownTimer) {
          activeNet().startStaging(stagingMode);
        } else if (stagingMode && countdownTimer) {
          activeNet().startStaging(stagingMode);
          activeNet().broadcastCountdown(lastCountdownT);
        }
        const engine = getActiveGameEngine();
        if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
        showInstallToast(t('toast.ctrlJoined', msg.name));
      },
      onPlayerLeft: (msg) => {
        // Önce latch'i nötrle (hayalet sürüş/dönüş kalmasın), sonra koltuğu boşa çıkar
        const engineLeft = getActiveGameEngine();
        if (engineLeft) clearRemoteSlot(engineLeft, currentMode, msg.slotIndex);
        delete lastRemoteInputAt[msg.slotIndex];
        delete lastMoveAt[msg.slotIndex];
        delete lastAimAt[msg.slotIndex];
        delete lastAvatarAt[msg.slotIndex];
        clearSlotAvatar(msg.slotIndex);
        updateHostSlot(msg.slotIndex, false);
        refreshStagingBar();
        const engine = getActiveGameEngine();
        if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
        showInstallToast(t('toast.ctrlLeft', msg.name));
      },
      onPlayerUpdated: (msg) => {
        const slot = hostPlayerSlots[msg.slotIndex];
        if (slot && slot.kind !== 'bot') {
          slot.name = msg.name;
          if (msg.avatar) {
            try {
              const clean = sanitizeAvatar(msg.avatar, { keepColor: true });
              slot.avatar = clean;
              slot.displayColor = msg.color || clean.color;
              setSlotAvatar(msg.slotIndex, clean);
            } catch (err) { reportError(err, 'roomFlow.onPlayerUpdated.avatar', { warnOnly: true }); }
          }
          refreshSlotCard(msg.slotIndex);
          refreshStagingBar();
          const engine = getActiveGameEngine();
          if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
          renderPauseSeats(handleSeatSwap);
        }
      },
      onPlayerReadyStatus: (slotIndex, isReady) => {
        // Sayaç anında gelen READY yeni turun sayacına sızmasın
        if (seatsLocked) return;
        if (hostPlayerSlots[slotIndex]) {
          updateHostSlot(slotIndex, true, hostPlayerSlots[slotIndex].name, isReady, hostPlayerSlots[slotIndex].kind);
          refreshStagingBar();
        }
      },
      onSlotsSwapped: (slotA, slotB) => {
        const temp = hostPlayerSlots[slotA];
        hostPlayerSlots[slotA] = hostPlayerSlots[slotB];
        hostPlayerSlots[slotB] = temp;
        syncHostSeatAfterSwap(slotA, slotB);
        setSeatTapHook();
        // Avatar kayıt defteri koltuk-bazlıdır: takas sonrası iki koltuğu yeniden yaz
        setSlotAvatar(slotA, hostPlayerSlots[slotA]?.avatar || null);
        setSlotAvatar(slotB, hostPlayerSlots[slotB]?.avatar || null);
        refreshSlotCard(slotA);
        refreshSlotCard(slotB);
        refreshStagingBar();

        const engine = getActiveGameEngine();
        if (engine) {
          swapEngineSlots(engine, currentMode, activeNet().isHosting, slotA, slotB);
        }

        showInstallToast(t('toast.slotsSwapped', slotA + 1, slotB + 1));
        renderPauseSeats(handleSeatSwap);
      },
      onPlayerInput: (slotIndex, data) => {
        // Kumanda kendi karakterini güncelledi: avatar + display tazelenir,
        // host override sıfırlanır (çakışırsa lobi uyarısı yeniden doğar).
        if (data.action === 'AVATAR_UPDATE' && data.avatar) {
          const slot = hostPlayerSlots[slotIndex];
          if (slot && slot.kind !== 'bot' && slot.kind !== 'bot_god') {
            const nowAv = performance.now();
            if (!lastAvatarAt[slotIndex] || nowAv - lastAvatarAt[slotIndex] > 1000) {
              lastAvatarAt[slotIndex] = nowAv;
              try {
                const clean = sanitizeAvatar(data.avatar, { keepColor: true });
                slot.avatar = clean;
                slot.displayColor = clean.color;
                setSlotAvatar(slotIndex, clean);
                updateHostSlot(slotIndex, true, slot.name, slot.isReady, slot.kind, clean, clean.color);
                refreshStagingBar();
                const engineAv = getActiveGameEngine();
                if (engineAv) syncSlotsToEngine(engineAv, currentMode, activeNet().isHosting);
                renderPauseSeats(handleSeatSwap);
              } catch (err) { reportError(err, 'roomFlow.onSlotAvatar.avatar', { warnOnly: true }); }
            }
          }
          return;
        }
        if (data.action === 'SET_NAME' && data.name) {
          const slot = hostPlayerSlots[slotIndex];
          if (slot) {
            slot.name = cleanPlayerName(data.name);
            refreshSlotCard(slotIndex);
            refreshStagingBar();
            activeNet().setPlayerName?.(slotIndex, slot.name);
            const engine = getActiveGameEngine();
            if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
            renderPauseSeats(handleSeatSwap);
          }
          return;
        }
        if (data.action === 'SWITCH_SLOT' && typeof data.targetSlot === 'number') {
          const target = data.targetSlot;
          const locked = seatsLocked || (currentMode !== 'MENU' && !stagingMode);
          const swapError = getSlotSwapError({
            from: slotIndex,
            to: target,
            slots: hostPlayerSlots,
            reservedHostSlot: activeNet().reservedHostSlot,
            locked,
            remote: true,
          });
          if (swapError) return;
          const hostSeatBefore = getCurrentHostSeat();
          const hostIsMoving = hostPlayerActive
            && (slotIndex === hostSeatBefore || target === hostSeatBefore);
          pendingHostSeatBeforeSwap = hostIsMoving ? hostSeatBefore : null;
          activeNet().swapSlots(slotIndex, target);
          if (hostIsMoving && pendingHostSeatBeforeSwap !== null) {
            hostPlayerSlot = slotIndex === hostSeatBefore ? target : slotIndex;
            if ('hostPlayerSlot' in activeNet()) activeNet().hostPlayerSlot = hostPlayerSlot;
            if ('reservedHostSlot' in activeNet()) activeNet().reservedHostSlot = hostPlayerSlot;
          }
          return;
        }
        if (typeof slotIndex !== 'number' || slotIndex < 0 || slotIndex > 3) return;
        // Analog sessizlik süpürücüsü için son-girdi damgası (sürekli akış takibi).
        // Move ve aim ayrı damgalanır: hareketsiz durmak ateşi, aim bırakmak
        // koşuyu öldürmemeli.
        if (data.action === 'JOYSTICK_MOVE' || data.action === 'PADDLE_MOVE' || data.action === 'TANK_DRIVE'
          || data.action === 'CURVE_STEER' || data.action === 'SNAKE_STEER') {
          lastRemoteInputAt[slotIndex] = performance.now();
          lastMoveAt[slotIndex] = performance.now();
        } else if (data.action === 'AIM_MOVE' || data.action === 'AIM_PRESS') {
          lastRemoteInputAt[slotIndex] = performance.now();
          // Aktif basılı tutma (aimHeld), ilk basış veya hareketli aim damgayı günceller.
          // Yalnızca serbest bırakılmış nötr paketler damgayı yeniden diriltemez.
          if (data.action === 'AIM_PRESS' || data.aimHeld || (Number(data.force) > 0)) {
            lastAimAt[slotIndex] = performance.now();
          }
        } else if (data.action === 'AIM_RELEASE') {
          // Release arrival is not an acknowledgement: a reordered packet may
          // be rejected by AimInputState. Keep the timestamp so stale cleanup
          // still closes a genuinely held stick.
          lastRemoteInputAt[slotIndex] = performance.now();
        }
        const engine = getActiveGameEngine();
        if (engine && typeof engine.handleRemoteInput === 'function') {
          inputRouter.dispatch(slotIndex, data, 'network');
        }
      },
      onPlayerReaction: onNetworkReaction,
    }, hostIdentity);
  } catch (err) {
    console.error('[Host] Oda açılamadı:', err);
    if (activeNet() === supabaseRelay) {
      console.warn('[Host] Supabase subscription failed, falling back to local WebSocket...');
      showInstallToast(t('toast.supabaseFallback'));
      updatePlatformMode('TV_CONSOLE');
      setTimeout(() => {
        openHostLobby(gameMode);
      }, 500);
    } else {
      const detail = err?.message ? ` Sebep: ${err.message}` : '';
      showInstallToast(t('toast.hostOpenFail', detail));
    }
  }
}

function getHostPlayerIdentity() {
  let avatar = null;
  try { avatar = getAvatarProfile(); } catch { avatar = null; }
  return {
    name: ensureStoredNick(),
    avatar,
  };
}

function applyHostPlayerState(state = {}) {
  const previousSlot = hostPlayerSlot;
  const active = state.active === true || state.player?.isHost === true;
  if (!active) pendingHostSeatBeforeSwap = null;
  const slot = active
    ? (Number.isInteger(state.slotIndex) ? state.slotIndex : (state.player?.slotIndex ?? 0))
    : null;

  hostPlayerActive = active;
  hostPlayerSlot = slot;
  setHostPlayerButtonState(active, getPlatformMode());

  if (active && slot !== null) {
    const player = state.player || getHostPlayerIdentity();
    setSlotAvatar(slot, player.avatar || null);
    updateHostSlot(
      slot,
      true,
      player.name || ensureStoredNick(),
      state.isReady !== false,
      'human',
      player.avatar || null,
      player.color || player.avatar?.color,
      true
    );
  } else if (previousSlot !== null) {
    pendingHostSeatBeforeSwap = null;
    clearSlotAvatar(previousSlot);
    updateHostSlot(previousSlot, false);
  }

  setSeatTapHook();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  refreshAllHostSlots();
  renderPauseSeats(handleSeatSwap);
}

// Cihaz profili değiştiğinde (KARAKTER ekranı / TV-lobi atölyesi / zar):
// host'un kendi koltuğu taze profili izler (uzak koltuklar AVATAR_UPDATE ile
// gelir) ve canlı motor yeniden senkronlanır. Bu kapı yokken seçim ancak
// sonraki mod geçişinde sahaya yansıyordu ("bazen yansımıyor" raporu).
if (typeof window !== 'undefined') {
  window.addEventListener('brutal_customization_changed', () => {
    try {
      if (hostPlayerActive && hostPlayerSlot !== null) {
        const seat = hostPlayerSlots[hostPlayerSlot];
        if (seat && seat.kind !== 'bot' && seat.kind !== 'bot_god') {
          const fresh = getAvatarProfile();
          seat.avatar = { ...fresh };
          seat.displayColor = fresh.color;
          setSlotAvatar(hostPlayerSlot, { ...fresh });
          updateHostSlot(hostPlayerSlot, true, seat.name, seat.isReady, seat.kind, { ...fresh }, fresh.color);
        }}
    } catch (err) { reportError(err, 'roomFlow.onProfileUpdated.seatAvatar', { warnOnly: true }); }
    try { refreshStagingBar(); } catch (err) { reportError(err, 'roomFlow.onProfileUpdated.refreshStagingBar'); }
    try { const liveEngine = getActiveGameEngine(); if (liveEngine) syncSlotsToEngine(liveEngine, currentMode, activeNet().isHosting); } catch (err) { reportError(err, 'roomFlow.onProfileUpdated.syncSlotsToEngine'); }
  });
}

function toggleHostPlayer() {
  if (getPlatformMode() !== 'TV_CONSOLE' || !activeNet().isHosting) return false;
  if (hostPlayerActive) {
    const result = activeNet().setHostPlayerActive?.(false);
    if (result === false) {
      showInstallToast(t('toast.hostPlayerLeaveFail'));
      return false;
    }
    applyHostPlayerState({ active: false });
    showInstallToast(t('toast.hostPlayerLeft'));
    return true;
  }

  // TV_CONSOLE host joins the first empty seat. Once seated, the existing
  // slot-swap controls remain available; no second seat-picker is required.
  const availableSlot = hostPlayerSlots.findIndex((entry) => !entry);
  if (availableSlot < 0) {
    showInstallToast(t('toast.hostPlayerNoEmptySeat'));
    return false;
  }
  const identity = getHostPlayerIdentity();
  const result = activeNet().setHostPlayerActive?.(true, { ...identity, slotIndex: availableSlot });
  if (result === false) {
    showInstallToast(t('toast.hostPlayerJoinFail'));
    return false;
  }
  applyHostPlayerState({
    active: true,
    slotIndex: availableSlot,
    player: { ...identity, color: identity.avatar?.color, isHost: true },
    isReady: true,
  });
  showInstallToast(t('toast.hostPlayerJoined'));
  return true;
}

// Controller Join Room Execution
// Bağlantı vs uygulama hatası yönlendirici: reconnect/kopuş mesajları kalıcı
// banda, diğer hatalar (oda bulunamadı, kod çakışması vb.) kaybolan toast'a.
// Kopuş sonrası ilk oyun durumu geldiğinde online flash'i için bayrak tutulur.
let connectionWasDown = false;
function routeConnectionMessage(err) {
  let msg = String(err?.message || err || '');
  // Sunucudan gelen bilinen hata kodları istemci diline çevrilir (kablo sabit).
  if (/ODA DOLU|ROOM FULL/.test(msg)) msg = t('net.roomFull');
  if (/yeniden bağlanılıyor|reconnecting/i.test(msg)) {
    connectionWasDown = true;
    showConnectionBanner('reconnecting', msg);
  } else if (/BAĞLANTI KOPTU|CONNECTION LOST/i.test(msg)) {
    connectionWasDown = true;
    showConnectionBanner('offline', msg);
  } else {
    showInstallToast(msg);
  }
}

// Bağlantı başarısı lobi ve oyun akışlarının ikisinde de geçerlidir. Eski
// yaklaşım yalnızca GAME_STATE'e bakıyordu; lobide kalan "yeniden
// bağlanıyor" bandının kalmasının ana nedeni buydu.
function markConnectionRestored(message = t('net.reconnected'), forceOnline = false) {
  const wasDown = connectionWasDown;
  connectionWasDown = false;
  if (wasDown || forceOnline) {
    showConnectionBanner('online', message);
  } else {
    hideConnectionBanner();
  }
}

async function executeJoin(rawCode, rawName, requestedMode = null) {
  if (requestedMode) updatePlatformMode(requestedMode);
  const code = (rawCode || '').trim().toUpperCase();
  const name = (rawName || '').trim().toUpperCase() || ensureStoredNick();

  if (!code || code.length < 3) {
    showInstallToast(t('toast.enterCode'));
    return;
  }

  storePlayerName(name);
  showInstallToast(t('toast.joining', code));

  disconnectInactiveNetwork(getPlatformMode());
  let net = activeNet();
  gamepadManager.network = net;

  try {
    // ONLINE/public dalında relay modülü ilk yükte gelmez; katılmadan hemen
    // önce burada yüklenir. Yükleme hatası aşağıdaki catch'e düşer.
    net = await ensureActiveNetwork(getPlatformMode());
    gamepadManager.network = net;
    let joinAvatar = null;
    try { joinAvatar = getAvatarProfile(); } catch { joinAvatar = null; }
    await net.joinRoom(code, name, {
      onConnectionRestored: () => markConnectionRestored(),
      onJoinedSuccess: (msg) => {
        // Supabase host, modu worldView bayrağıyla birlikte duyurur.
        // TV_CONSOLE'da telefon ekranı sadece kumanda olur; host P1'e
        // katılırsa reservedHostSlot snapshot'tan ayrıca gelir.
        if (typeof msg.worldView === 'boolean') {
          net.supportsWorldFrames = msg.worldView;
          net.reservedHostSlot = msg.worldView ? 0 : null;
        } else if (net === partyNetwork) {
          net.supportsWorldFrames = false;
          net.reservedHostSlot = null;
        }
        if (Object.prototype.hasOwnProperty.call(msg, 'reservedHostSlot')) {
          net.reservedHostSlot = Number.isInteger(msg.reservedHostSlot) ? msg.reservedHostSlot : null;
        }
        // Kumanda moduna geçiş: shell gizlenir, kumanda overlay'i devralır.
        hideAppShell();
        gamepadManager.init(msg, 'LOBBY');
        showInstallToast(t('toast.joined', msg.roomCode));
      },
      onGameModeChanged: (newMode) => {
        gamepadManager.selectedHostGame = newMode;
        if (gamepadManager.gameMode === 'LOBBY') {
          gamepadManager.renderGameController('LOBBY');
        }
        showInstallToast(t('toast.modeChanged', newMode));
      },
      onGameStarted: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.resetReady();
        gamepadManager.renderGameController(mode);
        showInstallToast(t('toast.gameStarted', mode));
      },
      onStagingStarted: (mode) => {
        gamepadManager.enterStaging(mode);
        // Saha açılırken hazır da sıfırlanır (host tarafıyla aynı kural; geç kalmış
        // bayrak bir sonraki turun sayacına sızamaz)
        gamepadManager.resetReady();
        showInstallToast(t('toast.stagingOpen'));
      },
      onCountdown: (t) => {
        gamepadManager.showCountdown(t);
      },
      onReturnedToLobby: (mode) => {
        gamepadManager.exitStaging();
        gamepadManager.resetReady();
        gamepadManager.selectedHostGame = mode || 'PONG';
        gamepadManager.renderGameController('LOBBY');
        showInstallToast(t('toast.backToLobby'));
      },
      onSlotChanged: (slotIndex, color) => {
        gamepadManager.updateSlot(slotIndex, color);
        showInstallToast(t('toast.slotChanged', slotIndex + 1));
      },
      onSlotsUpdate: (slots, reservedHostSlot) => {
        if (reservedHostSlot !== undefined) {
          net.reservedHostSlot = Number.isInteger(reservedHostSlot) ? reservedHostSlot : null;
        }
        gamepadManager.updateSlots(slots, net.reservedHostSlot);
      },
      // Kumanda ekranında kimlik rengi `gamepadManager.slots`'tan gelir (skor
      // çipiyle aynı kaynak); relay/WS `players` dizisi yalnız host'ta doludur.
      onPlayerReaction: (slotIndex, key) => {
        showReaction({ key, slotIndex, color: gamepadManager.slots?.[slotIndex]?.color || null });
      },
      onGameState: (data) => {
        if (connectionWasDown) markConnectionRestored();
        gamepadManager.handleStateSync(data);
      },
      onWorldFrame: (frame) => {
        gamepadManager.handleWorldFrame(frame);
      },
      onFxEvents: (events) => {
        // FX olayları (anlık güvenilir yol): kumanda yalnız oynatır (§2).
        gamepadManager.handleFxEvents(events);
      },
      onError: (err) => {
        routeConnectionMessage(err);
      },
      onHostDisconnected: (msg) => {
        connectionWasDown = true;
        showConnectionBanner('offline', String(msg || t('net.hostLost')));
        gamepadManager.hide();
        // Host koptu: kumanda overlay'i kapanır, ana menüye dönülür.
        hideAppShell();
        revealAppShell();
      },
    }, joinAvatar);
  } catch (err) {
    console.error('[Join] Odaya bağlanılamadı:', err);
    if (net === supabaseRelay) {
      console.warn('[Join] Supabase connection failed, falling back to local WebSocket...');
      showInstallToast(t('toast.supabaseFallback'));
      updatePlatformMode('TV_CONSOLE');
      gamepadManager.network = partyNetwork;
      setTimeout(() => {
        executeJoin(rawCode, rawName);
      }, 500);
    } else {
      const detail = err?.message ? ` Sebep: ${err.message}` : '';
      showInstallToast(t('toast.joinFail', detail));
    }
  }
}

function getCurrentHostSeat() {
  const state = activeNet().getHostPlayerState?.();
  if (state?.active && Number.isInteger(state.slotIndex)) return state.slotIndex;
  return hostPlayerSlot;
}

function syncHostSeatFromNetwork() {
  const net = activeNet();
  if (!net.isHosting) return;
  const state = net.getHostPlayerState?.();
  if (state?.active && Number.isInteger(state.slotIndex)) {
    hostPlayerActive = true;
    hostPlayerSlot = state.slotIndex;
    if ('hostPlayerSlot' in net) net.hostPlayerSlot = state.slotIndex;
    if ('reservedHostSlot' in net) net.reservedHostSlot = state.slotIndex;
    return;
  }
  if (hostPlayerActive && Number.isInteger(hostPlayerSlot)) {
    if ('hostPlayerSlot' in net) net.hostPlayerSlot = hostPlayerSlot;
    if ('reservedHostSlot' in net) net.reservedHostSlot = hostPlayerSlot;
  }
}

function syncHostSeatAfterSwap(slotA, slotB) {
  const net = activeNet();
  if (!net.isHosting || !hostPlayerActive || pendingHostSeatBeforeSwap === null) {
    pendingHostSeatBeforeSwap = null;
    syncHostSeatFromNetwork();
    return;
  }

  const previous = pendingHostSeatBeforeSwap;
  pendingHostSeatBeforeSwap = null;
  if (previous !== slotA && previous !== slotB) {
    syncHostSeatFromNetwork();
    return;
  }

  hostPlayerSlot = previous === slotA ? slotB : slotA;
  if ('hostPlayerSlot' in net) net.hostPlayerSlot = hostPlayerSlot;
  if ('reservedHostSlot' in net) net.reservedHostSlot = hostPlayerSlot;
  syncHostSeatFromNetwork();
}

function handleSeatSwap(slotA, slotB) {
  const net = activeNet();
  if (!Number.isInteger(slotA) || !Number.isInteger(slotB) || slotA < 0 || slotA > 3 || slotB < 0 || slotB > 3 || slotA === slotB) {
    return false;
  }
  // LOCAL pause seat swap engine üzerindeki gerçek slotları taşır; host
  // panelindeki bot/host kuralları yalnız networked snapshot'a uygulanır.
  const error = net.isHosting
    ? getSlotSwapError({
      from: slotA,
      to: slotB,
      slots: hostPlayerSlots,
      locked: seatsLocked,
      remote: false,
    })
    : null;
  if (error) {
    if (error === 'locked') showInstallToast(t('toast.countdownLock'));
    else if (error === 'bot') showInstallToast(t('toast.botSeatLocked'));
    return false;
  }

  const hostSeatBefore = getCurrentHostSeat();
  const swapsHostSeat = hostPlayerActive
    && (slotA === hostSeatBefore || slotB === hostSeatBefore);
  pendingHostSeatBeforeSwap = swapsHostSeat ? hostSeatBefore : null;
  activeNet().swapSlots(slotA, slotB);
  if (swapsHostSeat) {
    hostPlayerSlot = slotA === hostSeatBefore ? slotB : slotA;
    if ('hostPlayerSlot' in net) net.hostPlayerSlot = hostPlayerSlot;
    if ('reservedHostSlot' in net) net.reservedHostSlot = hostPlayerSlot;
  }
  syncHostSeatFromNetwork();
  setSeatTapHook();
  if (!activeNet().isHosting) {
    const temp = hostPlayerSlots[slotA];
    hostPlayerSlots[slotA] = hostPlayerSlots[slotB];
    hostPlayerSlots[slotB] = temp;
    const engine = getActiveGameEngine();
    if (engine) swapEngineSlots(engine, currentMode, activeNet().isHosting, slotA, slotB);
  }
  return true;
}

function handleRotateSeats() {
  if (seatsLocked) {
    showInstallToast(t('toast.countdownLock'));
    return;
  }
  if (activeNet().isHosting && (
    activeNet().players?.some((player) => player?.isHost)
    || hostPlayerActive
  )) return;
  // Skor permütasyonu (relay'deki [2,3,1,0] ile aynı sonuç)
  const rotateScoresLocally = () => {
    const engine = getActiveGameEngine();
    if (engine) {
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 0, 2);
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 2, 1);
      swapEngineSlots(engine, currentMode, activeNet().isHosting, 1, 3);
    }
  };
  if (!activeNet().isHosting) {
    const p0 = hostPlayerSlots[0];
    const p1 = hostPlayerSlots[1];
    const p2 = hostPlayerSlots[2];
    const p3 = hostPlayerSlots[3];
    hostPlayerSlots[0] = p3;
    hostPlayerSlots[2] = p0;
    hostPlayerSlots[1] = p2;
    hostPlayerSlots[3] = p1;
    rotateScoresLocally();
    return;
  }
  // Host: skorları yerelde döndür, koltukları relay'de atomik döndür
  // (tek yayın — ara flicker/yanlış koltuk yok). Bot varsa iptal (relay de iptal eder).
  if (hostPlayerSlots.some((s) => s?.kind === 'bot' || s?.kind === 'bot_god')) {
    showInstallToast(t('toast.botLockRotate'));
    return;
  }
  rotateScoresLocally();
  if (typeof activeNet().rotateSeats === 'function') {
    activeNet().rotateSeats();
    // Relay aynı permütasyonu uygular; host tablosu + avatar kayıt defteri de
    // yerelde döner (yoksa isimler/yüzler yanlış koltukta kalır).
    const order = [2, 3, 1, 0];
    const oldEntries = [hostPlayerSlots[0], hostPlayerSlots[1], hostPlayerSlots[2], hostPlayerSlots[3]];
    for (let i = 0; i < 4; i++) {
      hostPlayerSlots[i] = oldEntries[order[i]];
      setSlotAvatar(i, hostPlayerSlots[i]?.avatar || null);
    }
    refreshAllHostSlots();
    renderPauseSeats(handleSeatSwap);
  } else {
    activeNet().swapSlots(0, 2);
    activeNet().swapSlots(2, 1);
    activeNet().swapSlots(1, 3);
  }
}

// Host lobi kartlarını state'ten yeniden çiz: `slotManager.refreshAllHostSlots`
// tek sahibedir (lokalde eski refreshHostSlotCards kopyası kapanmıştır).

function setLocalReadyFlags(isReady) {
  for (let i = 0; i < 4; i++) {
    const entry = hostPlayerSlots[i];
    if (entry) updateHostSlot(i, true, entry.name, isReady, entry.kind);
  }
}

function returnHostToLobby() {
  pendingHostSeatBeforeSwap = null;
  exitStagingToLobby();
  if (!activeNet().isHosting) {
    setGameMode('MENU');
    return;
  }
  closePauseModal();
  // Lobiye dönüşte latch'ler nötrlenir (maç-sonu hayaleti lobiye/staging'e sızmasın)
  const engineLobby = getActiveGameEngine();
  if (engineLobby) clearAllRemoteSlots(engineLobby, currentMode);
  for (let i = 0; i < 4; i++) { delete lastRemoteInputAt[i]; delete lastMoveAt[i]; delete lastAimAt[i]; }
  setGameMode('MENU');
  activeNet().returnToLobby();
  setLocalReadyFlags(false);
  // TV host P1 olarak katıldıysa lobiye dönüşte de otomatik hazır kalır.
  if (hostPlayerActive && hostPlayerSlot !== null && hostPlayerSlots[hostPlayerSlot]) {
    updateHostSlot(hostPlayerSlot, true, hostPlayerSlots[hostPlayerSlot].name, true, 'human');
  }
  // Lobiye dönüşte botlar temizlenir — koltuklar insanlara kalır
  for (let i = 0; i < 4; i++) {
    if (hostPlayerSlots[i]?.kind === 'bot') {
      activeNet().clearSlotBot?.(i);
      updateHostSlot(i, false);
    }
  }
  // Oda korunur: hostRoom tekrar çağrılmaz (yeni kod üretip koltukları siliyordu —
  // kumandalar eski kanalda asılı kalıp STAGING_STARTED'i kaçırıyordu).
  const roomCode = activeNet().roomCode;
  if (roomCode) {
    const joinUrl = getEffectiveJoinUrl(roomCode, getPlatformMode());
    showHostLobbyModal(roomCode, joinUrl);
    startHostPingBadge(() => activeNet().ping, getPlatformMode());
    setSeatTapHook();
    refreshAllHostSlots();
  } else {
    openHostLobby(getCurrentHostGameMode());
  }
}

function handleExitToMenu() {
  pendingHostSeatBeforeSwap = null;
  if (activeNet().isHosting) {
    closePauseModal();
    exitStagingToLobby();
    hideHostLobbyModal();
    for (let i = 0; i < 4; i++) {
      clearSlotAvatar(i);
      updateHostSlot(i, false);
    }
    applyHostPlayerState({ active: false });
    hideConnectionBanner();
    connectionWasDown = false;
    activeNet().disconnect();
    setSeatTapHook();
    setGameMode('MENU');
  } else {
    closePauseModal();
    setGameMode('MENU');
  }
}

// Oyun katalogu her zaman LOCAL akıştır: eski oda (host ya da kumanda)
// açık kalmışsa önce tamamen yıkılır, yoksa OYNA eski host lobisine düşer.
function teardownRoomForLocal() {
  const net = activeNet();
  if (!net.isHosting && net.role !== 'CONTROLLER') return;
  pendingHostSeatBeforeSwap = null;
  closePauseModal();
  exitStagingToLobby();
  hideHostLobbyModal();
  for (let i = 0; i < 4; i++) {
    clearSlotAvatar(i);
    updateHostSlot(i, false);
  }
  applyHostPlayerState({ active: false });
  hideConnectionBanner();
  connectionWasDown = false;
  try { net.disconnect(); } catch {}
  try { gamepadManager.hide(); } catch {}
  setSeatTapHook();
}

function handleGameCardClick(mode) {
  // Host oyunu değiştirme yolu lobi karuseli/grididir (`setHostGameMode`);
  // katalog OYNA her zaman temiz LOCAL giriş yapar.
  teardownRoomForLocal();
  updatePlatformMode('LOCAL');
  setGameMode(mode);
}

// ── İki kademeli başlatma: LOBİ → STAGING (saha+koltuk) → sayaç → OYUN ──



// Son sayaç değeri: 8 Hz yayın paketi (`stateSync`) ve yerel kumanda paketi
// buradan okur (değer iki yerde tutulmaz).


/**
 * Oda fazının TEK türetimi. Uzak 8 Hz paket ile YEREL kumanda paketi aynı
 * kararı okumak zorundadır (AGENTS §8: state iki yerde tutulmaz).
 *
 * Ölçülen kusur: yerel paket `phase: 'GAME'` yazıyordu — yani tek cihazda
 * masa-ortası/telefon-üstü oynayan oyuncu SAHAYA GEÇ aşamasını ve 3-2-1
 * geri sayımını kumanda yüzeyinde HİÇ görmüyordu; TV/host canvas'ı sayacı
 * gösterirken onun ekranı doğrudan oyuna atlıyordu.
 */
function roomPhase() {
  if (currentMode === 'MENU') return 'LOBBY';
  if (countdownTimer) return 'COUNTDOWN';
  if (stagingMode) return 'STAGING';
  return 'GAME';
}

// Uzak-girdi canlılık damgaları: analog sessizlik süpürücüsü için.
// Koltuk politikası değişmez — sadece latch nötrlenir, koltuk dolu kalır.
// Move ve aim ayrı izlenir; biri stale olunca yalnız o taraf temizlenir.
const lastRemoteInputAt = {};
const lastMoveAt = {};
const lastAimAt = {};
// Kumanda avatar-güncelleme kısması (slot başına 1sn sel koruması)
const lastAvatarAt = {};
const STALE_ANALOG_MS = 1500;
setInterval(() => {
  if (!activeNet().isHosting) return;
  if (currentMode === 'MENU' || stagingMode || countdownTimer) return;
  const engine = getActiveGameEngine();
  if (!engine) return;
  const now = performance.now();
  for (let i = 0; i < 4; i++) {
    const lastMove = lastMoveAt[i];
    const lastAim = lastAimAt[i];
    const lastAny = lastRemoteInputAt[i];
    if (lastMove === undefined && lastAim === undefined && lastAny === undefined) continue;
    const moveStale = lastMove !== undefined && now - lastMove >= STALE_ANALOG_MS;
    const aimStale = lastAim !== undefined && now - lastAim >= STALE_ANALOG_MS;
    const anyStale = lastAny !== undefined && now - lastAny >= STALE_ANALOG_MS
      && lastMove === undefined && lastAim === undefined;
    if (moveStale && aimStale) {
      clearRemoteSlot(engine, currentMode, i);
      delete lastMoveAt[i];
      delete lastAimAt[i];
      delete lastRemoteInputAt[i];
    } else if (moveStale) {
      clearRemoteMove(engine, currentMode, i);
      delete lastMoveAt[i];
      if (lastAim === undefined) delete lastRemoteInputAt[i];
    } else if (aimStale) {
      clearRemoteAim(engine, currentMode, i);
      delete lastAimAt[i];
      if (lastMove === undefined) delete lastRemoteInputAt[i];
    } else if (anyStale) {
      clearRemoteSlot(engine, currentMode, i);
      delete lastRemoteInputAt[i];
    }
  }
}, 500);

function refreshStagingBar() {
  if (!stagingMode) return;
  const humans = hostPlayerSlots.filter((p) => p !== null && p.kind !== 'bot');
  const connected = humans.length;
  const ready = humans.filter((p) => p?.isReady).length;
  const clash = activeNet().isHosting ? getColorClashIndices() : [];
  const pill = document.getElementById('staging-ready-pill');
  if (pill) {
    pill.textContent = connected === 0 ? t('lobby.waiting') : t('lobby.connected', connected, ready);
    if (clash.length > 0) pill.textContent += ` • ${t('lobby.clash')}`;
    pill.classList.toggle('clash', clash.length > 0);
  }
  const btn = document.getElementById('btn-staging-launch');
  if (btn) {
    btn.textContent = clash.length > 0 ? t('stage.split') : t('stage.start', ready, connected);
    btn.classList.toggle('blocked', clash.length > 0);
  }
}

function showStagingBar() {
  document.getElementById('staging-bar')?.classList.remove('hidden');
  refreshStagingBar();
}

function hideStagingBar() {
  document.getElementById('staging-bar')?.classList.add('hidden');
}

function showCountdownOverlay(t) {
  const ov = document.getElementById('countdown-overlay');
  const num = document.getElementById('countdown-overlay-number');
  if (!ov || !num) return;
  num.textContent = t > 0 ? String(t) : t('count.go');
  ov.classList.remove('hidden');

  // Force layout reflow and retrigger CSS animation on each tick
  num.classList.remove('animate');
  void num.offsetWidth;
  num.classList.add('animate');
}

function hideCountdownOverlay() {
  document.getElementById('countdown-overlay')?.classList.add('hidden');
}

function cancelCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  hideCountdownOverlay();
}

function startEngineNow(mode) {
  // Maç başı reset motorun oyuncu renklerini yeniden kurar; host display
  // renkleri (override dahil) hemen ardından tekrar yazılır.
  const engine = getEngine(mode);
  engine?.start();
  const active = getActiveGameEngine();
  if (active) syncSlotsToEngine(active, mode, activeNet().isHosting);
  // Motor bayrakları maç başında tazelenir: koltuk/host rolü değişmiş olabilir.
  setSeatTapHook();
}

// Faz 3 — yaşam döngüsü.
// Krom NIYETI `src/ui/fullscreen.js`'te tutulur (ikinci bir yerde değil —
// AGENTS §8). Host'un ekranını açık tutan wake lock `src/core/wakeLock.js`'te
// tek sahibindedir (kumanda `gamepad.js` ile aynı bütçe).

// BAŞLAT dokunuşu (kullanıcı hareketi) içinden çağrılır: yön kilidi ve tam
// ekran kabuğun krom politikasından geçer (`appShell.beginMatchChrome` — main.js
// içine krom dalı yazılmaz). Host telefon hem oyun hem kumanda olduğu için
// ekran açık tutulur (kapalı kumanda yüzeyi varsayılanı).
function requestMatchChrome() {
  beginMatchChrome();
  acquireWakeLock();
}

// BAŞLAT #1: sahayı aç — motor LOBBY'de arena gösterir, koltuk seçimi başlar
async function enterStaging(mode) {
  // Sert renk engeli: aynı display rengine sahip iki insan koltuğu varken
  // sahaya geçilemez (LOCAL'de koltuklar boş → küme boş → engel yok).
  if (activeNet().isHosting && getColorClashIndices().length > 0) {
    showInstallToast(t('toast.clashLobby'));
    return;
  }
  await setGameMode(mode);
  // Yükleme başarısızsa veya araya yeni geçiş girdiyse saha açılmaz.
  if (currentMode !== mode) return;
  // "KALDIĞIN YER" kaydı: maç GERÇEKTEN sahaya geçtiğinde yazılır (katalogda
  // gezinmek kaydı ezmez). Yazma yeri tektir; ana menü yalnız okur.
  rememberLastPlayedGame(mode);
  stagingMode = mode;
  seatsLocked = false;
  // Lobiden çıkışta herkes BEKLE'ye çekilir (yerel sıfırlama, ekstra çağrı yok —
  // aksi halde eski turun bayrağı yeni turun sayacına sızar)
  for (let i = 0; i < 4; i++) {
    const e = hostPlayerSlots[i];
    const currentHostSeat = getCurrentHostSeat();
    const isReady = (getPlatformMode() === 'ONLINE' && hostPlayerActive && i === currentHostSeat)
      || (getPlatformMode() === 'TV_CONSOLE' && hostPlayerActive && i === currentHostSeat);
    if (e) updateHostSlot(i, true, e.name, isReady, e.kind);
  }
  refreshStagingBar();
  // Saha açılırken koltuklar bir kez daha yazılır (kurucu varsayılan botları ezilir)
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, mode, activeNet().isHosting);
  activeNet().startStaging(mode);
  showStagingBar();
  showInstallToast(t('toast.stagingOpenHost'));
  // Voice/countdown files warm while players ready up (lazy, no UI block).
  try { warmGameSounds(['ui.tick', 'ui.confirm', 'hit.punchLight', 'shot.laserSmall', 'voice.count3', 'voice.count2', 'voice.count1', 'voice.fight', 'voice.round1', 'voice.round2', 'voice.round3', 'voice.final']); } catch {}
}

// BAŞLAT #2: 3-2-1 → oyun (koltuklar kilitli)
function runCountdown() {
  if (!stagingMode || countdownTimer) return;
  if (activeNet().isHosting && hostPlayerSlots.filter(Boolean).length < 2) {
    showInstallToast(t('lobby.waiting'));
    return;
  }
  // Staging sırasında avatar değişimi çakışma doğurmuş olabilir → sayaç kapısı
  if (activeNet().isHosting && getColorClashIndices().length > 0) {
    showInstallToast(t('toast.clashCountdown'));
    return;
  }
  const mode = stagingMode;
  // Sayaç başında yarım kalmış latch taşınmasın (önceki turun hayaleti)
  const enginePre = getActiveGameEngine();
  if (enginePre) clearAllRemoteSlots(enginePre, mode);
  for (let i = 0; i < 4; i++) { delete lastRemoteInputAt[i]; delete lastMoveAt[i]; delete lastAimAt[i]; }
  seatsLocked = true;
  // Faz 3: sayaç BAŞLAT dokunuşunun kullanıcı hareketi penceresinden tam ekran
  // + yön kilidi + ekran açık tutma istenir.
  requestMatchChrome();
  window.dispatchEvent(new CustomEvent('brutal_host_slots_changed'));
  let secsLeft = 3;
  const tick = () => {
    if (secsLeft > 0) {
      showCountdownOverlay(secsLeft);
      try { playCountdownTick(secsLeft); } catch {}
      lastCountdownT = secsLeft;
      activeNet().broadcastCountdown(secsLeft);
      secsLeft -= 1;
    } else {
      cancelCountdown();
      seatsLocked = false;
      hideStagingBar();
      stagingMode = null;
      setLocalReadyFlags(false);
      activeNet().startGame(mode);
      try { playFightShout(); } catch {}
      startEngineNow(mode);
    }
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

function exitStagingToLobby() {
  cancelCountdown();
  seatsLocked = false;
  stagingMode = null;
  hideStagingBar();
  hideCountdownOverlay();
}

// ── Tek koltuk gerçeği: TV sahasından koltuğa dokununca bot ekle/çıkar ──
const BOT_SEAT_NAMES = ['BOT · 1', 'BOT · 2', 'BOT · 3', 'BOT · 4'];

function handleLobbySeatTap(index) {
  if (!activeNet().isHosting) return;
  // Bot ekleme kapalıysa normal akış: sadece oyuncu eklenir/çıkarılır
  if (!isBotEkleEnabled()) return;
  if (seatsLocked) {
    showInstallToast(t('toast.countdownLock'));
    return;
  }
  const entry = hostPlayerSlots[index];
  if (entry && entry.kind === 'bot') {
    addBotGodSlot(index);
  } else if (entry && entry.kind === 'bot_god') {
    removeBotSlot(index);
  } else if (!entry) {
    addBotSlot(index, 'bot');
  } else {
    showInstallToast(t('toast.seatFull', index + 1));
  }
}

function addBotSlot(index, kind = 'bot') {
  const name = kind === 'bot_god' ? `GOD · ${index + 1}` : (BOT_SEAT_NAMES[index] || `BOT · ${index + 1}`);
  activeNet().setSlotBot?.(index, name, kind);
  updateHostSlot(index, true, name, false, kind);
  refreshStagingBar();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  renderPauseSeats(handleSeatSwap);
  showInstallToast(kind === 'bot_god' ? t('toast.godAdded', index + 1) : t('toast.botAdded', index + 1));
}

function addBotGodSlot(index) {
  addBotSlot(index, 'bot_god');
}

function removeBotSlot(index) {
  activeNet().clearSlotBot?.(index);
  updateHostSlot(index, false);
  refreshStagingBar();
  const engine = getActiveGameEngine();
  if (engine) syncSlotsToEngine(engine, currentMode, activeNet().isHosting);
  renderPauseSeats(handleSeatSwap);
  showInstallToast(t('toast.seatCleared', index + 1));
}

// Otorite cihazın yerel kontrol yüzeyi — TEK karar (`ui/tokens.js`).
// `main.js` ve motorlar bu sonucu okur; ikinci bir yorum yok.
function getLocalControlMode() {
  const hosting = activeNet().isHosting;
  return resolveLocalControlMode({
    isHosting: hosting,
    isLocalHostPlayer: hosting && hostPlayerActive && hostPlayerSlot !== null,
    isLocalMode: getPlatformMode() === 'LOCAL',
    localSlot: hostPlayerSlot,
  });
}

// Motorların LOBBY tap'lerini host'a yönlendir (sadece host iken aktif)
// + canvas MAÇI BAŞLAT butonunu host'ta gizle: TV akışı tek yoldan
// (DOM staging çubuğu → sayaç) yürür, çift başlat düğmesi kalmaz.
function setSeatTapHook() {
  const hosting = activeNet().isHosting;
  const surface = getLocalControlMode();
  const fn = hosting ? handleLobbySeatTap : null;
  forEachEngine((_mode, entry) => {
    entry.game.onLobbySeatTap = fn;
    entry.game.hideLobbyStartButton = hosting;
    entry.game.localControlMode = surface.mode;
    // null → tüm insan köşeleri çizilir; bu cihazın koltuku belliyse
    // yalnız onun köşesi authority'ye açılır.
    entry.game.localControlSlot = surface.localControlSlot;
  });
}

  return {
    getCurrentMode: () => currentMode,
    getStagingMode: () => stagingMode,
    getSeatsLocked: () => seatsLocked,
    getHostPlayerActive: () => hostPlayerActive,
    getHostPlayerSlot: () => hostPlayerSlot,
    getLocalControlMode,
    getCountdownTimer: () => countdownTimer,
    getLastCountdownT: () => lastCountdownT,
    getConnectionWasDown: () => connectionWasDown,
    setConnectionWasDown: (val) => connectionWasDown = val,
    markTransition, setGameMode, resetActiveGame, onResumeAfterPause,
    openHostLobby, getHostPlayerIdentity, applyHostPlayerState, toggleHostPlayer,
    routeConnectionMessage, markConnectionRestored, executeJoin, getCurrentHostSeat,
    syncHostSeatFromNetwork, syncHostSeatAfterSwap, handleSeatSwap, handleRotateSeats,
    setLocalReadyFlags, returnHostToLobby, handleExitToMenu, handleGameCardClick,
    roomPhase, refreshStagingBar, showStagingBar, hideStagingBar,
    showCountdownOverlay, hideCountdownOverlay, cancelCountdown, startEngineNow,
    requestMatchChrome, enterStaging, runCountdown, exitStagingToLobby,
    handleLobbySeatTap, addBotSlot, addBotGodSlot, removeBotSlot, setSeatTapHook,
    lastRemoteInputAt, lastMoveAt, lastAimAt
  };
}
