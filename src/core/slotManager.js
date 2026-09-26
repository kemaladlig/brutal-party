// Slot Manager: Host Player Slots State, UI Sync, Engine Slot & Score Mapping
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { getSlotCustomization, findSlotColorDuplicates, getBotPersona, getLocalSeatColors } from './customizationManager.js';
import { safeGet, safeSet } from './safeStorage.js';
import { getStoredPlayerName, ensureStoredNick } from '../net.js';
import { t } from '../i18n.js';

export function resolveSlotName(index, slotType = 'human', customName = '') {
  if (slotType === 'bot_normal') return getBotPersona(index, false).name;
  if (slotType === 'bot_god') return getBotPersona(index, true).name;
  if (customName && typeof customName === 'string') {
    const clean = customName.replace(/^P[1-4]\s*[•·\-–—]\s*/i, '').trim();
    if (clean && clean !== `P${index + 1}`) return clean;
  }
  if (index === 0) {
    const stored = getStoredPlayerName() || ensureStoredNick();
    if (stored) return stored;
  }
  return `P${index + 1}`;
}

// Koltuk girişi: { name, isReady, kind, avatar, displayColor }
// avatar: oyuncunun cihaz profili (relay) · displayColor: host override dahil
// o koltukta GÖRÜNEN renk (yoksa avatar rengi). Renk oyuncuyla taşınır.
export const hostPlayerSlots = [null, null, null, null];

export function getSlotDisplayColor(i) {
  const s = hostPlayerSlots[i];
  if (!s || s.kind === 'bot' || s.kind === 'bot_god') return null;
  return s.displayColor || s.avatar?.color || s.color || null;
}

// Bağlı insan koltukları arasında aynı display rengine sahip indisler.
// Boşsa sahaya geçiş serbest; doluysa SAHAYA GEÇ kilitlenir (relay modları).
export function getColorClashIndices() {
  return [...findSlotColorDuplicates(hostPlayerSlots)];
}

// Bot ekleme ayarı (varsayılan KAPALI; pause menüsünden açılır, localStorage'da saklanır)
const BOT_SETTING_KEY = 'brutalparty.botEkle';
export function isBotEkleEnabled() {
  return safeGet(BOT_SETTING_KEY) === '1';
}
export function setBotEkleEnabled(on) {
  safeSet(BOT_SETTING_KEY, on ? '1' : '0');
}

export function updateHostSlot(
  slotIndex,
  isConnected,
  name = '',
  isReady = false,
  kind = 'human',
  avatar = undefined,
  displayColor = undefined,
  isHost = undefined,
) {
  const slotEl = document.getElementById(`slot-p${slotIndex + 1}`);
  const readyTag = document.getElementById(`ready-tag-p${slotIndex + 1}`);
  if (!slotEl) return;

  const nameEl = slotEl.querySelector('.slot-name');
  const botBtn = slotEl.querySelector('.slot-bot-btn');
  const slotCanvas = document.getElementById(`slot-canvas-p${slotIndex + 1}`);

  if (slotCanvas) {
    const ctx = slotCanvas.getContext('2d');
    ctx.clearRect(0, 0, slotCanvas.width, slotCanvas.height);
    if (isConnected) {
      if (kind === 'bot_god') {
        const persona = getBotPersona(slotIndex, true);
        drawBrutalAvatar(ctx, 17, 17, 13, {
          slotIndex,
          color: persona.color,
          expression: persona.expression,
          showPointer: false,
          borderWidth: 2,
          shadowOffset: 1.5,
        });
      } else if (kind === 'bot') {
        const persona = getBotPersona(slotIndex, false);
        drawBrutalAvatar(ctx, 17, 17, 13, {
          slotIndex,
          color: persona.color,
          expression: persona.expression,
          showPointer: false,
          borderWidth: 2,
          shadowOffset: 1.5,
        });
      } else {
        const entryPrev = hostPlayerSlots[slotIndex];
        drawBrutalAvatar(ctx, 17, 17, 13, {
          slotIndex,
          avatar: entryPrev?.avatar || undefined,
          color: entryPrev?.displayColor || entryPrev?.avatar?.color || undefined,
          showPips: false,
          showPointer: false,
          borderWidth: 2,
          shadowOffset: 1.5,
        });
      }
    } else {
      // Boş yuvarlak kesikli sınır
      ctx.strokeStyle = '#C8C3BA';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(17, 17, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  if (isConnected) {
    const prevEntry = hostPlayerSlots[slotIndex];
    hostPlayerSlots[slotIndex] = {
      name, isReady, kind,
      isHost: isHost !== undefined ? !!isHost : !!prevEntry?.isHost,
      avatar: avatar !== undefined ? avatar : (prevEntry?.avatar || null),
      displayColor: displayColor !== undefined ? displayColor : (prevEntry?.displayColor || null),
    };
    const isBotNormal = kind === 'bot';
    const isBotGod = kind === 'bot_god';
    const isAnyBot = isBotNormal || isBotGod;
    const persona = isAnyBot ? getBotPersona(slotIndex, isBotGod) : null;

    slotEl.classList.add('connected');
    slotEl.classList.toggle('is-bot', isAnyBot);
    slotEl.classList.toggle('is-bot-god', isBotGod);
    slotEl.classList.toggle('ready', isReady && !isAnyBot);

    if (nameEl) nameEl.textContent = isAnyBot ? (name || persona.name) : name;
    if (readyTag) {
      if (isBotGod) {
        readyTag.textContent = persona.shortName || t('lobby.god');
        readyTag.classList.remove('ready');
      } else if (isBotNormal) {
        readyTag.textContent = persona.shortName || t('lobby.bot');
        readyTag.classList.remove('ready');
      } else {
        readyTag.textContent = isReady ? t('lobby.ready') : t('lobby.wait');
        readyTag.classList.toggle('ready', isReady);
      }
    }
    // Açık buton (sadece ayar açıksa): bot kartında ✕ (kaldır), boş koltukta +BOT.
    // Kapalıyken normal akışta sadece oyuncu eklenir/çıkarılır.
    const botsOn = isBotEkleEnabled();
    if (botBtn) {
      if (botsOn && isAnyBot) {
        const label = botBtn.querySelector('.slot-bot-label');
        if (label) label.textContent = t('host.removeBot');
        else botBtn.textContent = '✕';
        botBtn.classList.remove('hidden');
      } else {
        botBtn.classList.add('hidden');
      }
    }
  } else {
    hostPlayerSlots[slotIndex] = null;
    slotEl.classList.remove('connected', 'ready', 'is-bot', 'is-bot-god');
    if (nameEl) nameEl.textContent = t('pause.empty');
    if (readyTag) {
      readyTag.textContent = t('pause.empty');
      readyTag.classList.remove('ready');
    }
    // Boş koltukta +BOT butonu (sadece ayar açıksa)
    if (botBtn) {
      if (isBotEkleEnabled()) {
        const label = botBtn.querySelector('.slot-bot-label');
        if (label) label.textContent = t('host.addBot');
        else botBtn.textContent = t('host.addBot');
        botBtn.classList.remove('hidden');
      } else {
        botBtn.classList.add('hidden');
      }
    }
  }

  // Botlar sayıma dahil değildir (hazır vermezler, sayacı kilitlemezler)
  const humans = hostPlayerSlots.filter((p) => p !== null && p.kind !== 'bot' && p.kind !== 'bot_god');
  const connectedCount = humans.length;
  const readyCount = humans.filter((p) => p?.isReady).length;
  const readyCounter = document.getElementById('lobby-ready-counter');
  if (readyCounter) {
    if (connectedCount === 0) {
      readyCounter.textContent = t('lobby.waiting');
    } else if (readyCount === connectedCount) {
      readyCounter.textContent = t('lobby.readyToStart', readyCount, connectedCount);
    } else {
      readyCounter.textContent = t('lobby.connected', connectedCount, readyCount);
    }
  }
  refreshColorClashUI();
  // Host lobi koltuk düzenleyicisi aynı slot snapshot'ını okur; yeni katılım,
  // ayrılma veya renk güncellemesinde seçim butonlarını da anında tazele.
  try {
    window.dispatchEvent(new CustomEvent('brutal_host_slots_changed'));
  } catch {}
}

// Aynı display rengine sahip insan koltuklarına ⚠️ rozeti + kart vurgusu.
// Kart DOM'u yoksa (LOCAL/oyun içi) sessizce geçilir.
export function refreshColorClashUI() {
  let clash = new Set();
  try {
    clash = findSlotColorDuplicates(hostPlayerSlots);
  } catch { clash = new Set(); }
  for (let i = 0; i < 4; i++) {
    const slotEl = document.getElementById(`slot-p${i + 1}`);
    if (!slotEl) continue;
    const isClash = clash.has(i);
    slotEl.classList.toggle('color-clash', isClash);
    let warn = slotEl.querySelector('.slot-clash-tag');
    if (isClash && !warn) {
      warn = document.createElement('span');
      warn.className = 'slot-clash-tag';
      slotEl.appendChild(warn);
    }
    if (warn) {
      warn.textContent = isClash ? t('lobby.clash') : '';
      warn.classList.toggle('hidden', !isClash);
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('brutal_color_clash', {
      detail: { clash: [...clash] },
    }));
  } catch {}
}

function applySlotDataToEntity(engine, currentMode, i, slotType, slotName, slotColor, isJoined) {
  if (currentMode === 'PONG') {
    const p = engine.paddles?.[i];
    if (p) {
      p.isJoined = isJoined;
      p.slotType = slotType;
      p.name = slotName;
      p.color = slotColor;
      p.updateLayout?.(engine.arena);
    }
  } else if (currentMode === 'TANKS') {
    if (engine.slotTypes) engine.slotTypes[i] = slotType;
    const tank = engine.tanks?.[i];
    if (tank) {
      tank.isJoined = isJoined;
      tank.slotType = slotType;
      tank.name = slotName;
      tank.color = slotColor;
    }
  } else if (currentMode === 'CURVE') {
    if (engine.slotTypes) engine.slotTypes[i] = slotType;
    const player = engine.players?.[i];
    if (player) {
      player.isJoined = isJoined;
      player.slotType = slotType;
      player.name = slotName;
      player.color = slotColor;
    }
  } else if (
    currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'ARCHER' ||
    currentMode === 'CROWN' || currentMode === 'ZONE' || currentMode === 'SNAKE' ||
    currentMode === 'LASER' || currentMode === 'CLONE' || currentMode === 'COLLAPSE' ||
    currentMode === 'NINJA' || currentMode === 'HORDE' || currentMode === 'RACE'
  ) {
    if (engine.slotTypes) engine.slotTypes[i] = slotType;
    const player = engine.players?.[i];
    if (player) {
      player.isJoined = isJoined;
      player.slotType = slotType;
      player.name = slotName;
      player.color = slotColor;
    }
  }
}

export function syncSlotsToEngine(engine, currentMode, isHosting) {
  if (!engine) return;

  if (isHosting) {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const custom = getSlotCustomization(i);
      const isBotNormal = slot ? slot.kind === 'bot' : false;
      const isBotGod = slot ? slot.kind === 'bot_god' : false;
      const isAnyBot = isBotNormal || isBotGod;
      const botPersona = isAnyBot ? getBotPersona(i, isBotGod) : null;
      const botType = slot ? (isBotGod ? 'bot_god' : (isBotNormal ? 'bot_normal' : 'human')) : 'empty';
      const slotColor = isAnyBot
        ? botPersona.color
        : (slot?.displayColor || slot?.avatar?.color || custom.color);
      const slotName = slot
        ? resolveSlotName(i, botType, slot.name)
        : `P${i + 1}`;

      applySlotDataToEntity(engine, currentMode, i, botType, slotName, slotColor, !!slot);
    }
  } else {
    // LOCAL mod: engine.slotTypes veya paddle slotlarını cihaz profili & bot personalarıyla eşle
    const locals = getLocalSeatColors();
    for (let i = 0; i < 4; i++) {
      const slotType = engine.slotTypes ? engine.slotTypes[i] : (engine.paddles?.[i]?.slotType || (i === 0 ? 'human' : 'empty'));
      const isJoined = slotType !== 'empty';
      const isBotNormal = slotType === 'bot_normal';
      const isBotGod = slotType === 'bot_god';
      const isAnyBot = isBotNormal || isBotGod;
      const botPersona = isAnyBot ? getBotPersona(i, isBotGod) : null;
      const custom = getSlotCustomization(i);
      const slotColor = isAnyBot
        ? botPersona.color
        : (locals[i] || custom.color);
      const slotName = resolveSlotName(i, slotType);

      applySlotDataToEntity(engine, currentMode, i, slotType, slotName, slotColor, isJoined);
    }
  }
}

// Kopan/kapanan kumandanın latch'li girdisini nötrle — koltuk, isim, skor,
// bot bayrakları AYNEN korunur (koltuğu tut politikası). Host bot ekle/çıkar,
// sayaç kilidi, ready-reset kurallarına dokunmaz.
// Aim basılıyken hareketsiz durmak ateşi kesmemeli.
export function clearRemoteMove(engine, currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
    if (currentMode === 'TANKS') {
      const tank = engine.tanks?.[slotIndex];
      if (tank) tank.isDriving = false;
    } else if (currentMode === 'CURVE') {
      const player = engine.players?.[slotIndex];
      if (player) player.steer = 0;
    } else if (currentMode === 'SNAKE') {
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steer = 0;
        player.isBoost = false;
      }
    } else if (currentMode === 'ARCHER') {
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
    } else if (currentMode === 'CLONE' || currentMode === 'COLLAPSE' || currentMode === 'NINJA' || currentMode === 'LASER') {
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
      }
      const joy = engine.joysticks?.[slotIndex];
      if (joy) {
        joy.active = false;
        joy.force = 0;
        if ('id' in joy) joy.id = -1;
      }
    } else if (currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'CROWN' || currentMode === 'ZONE' || currentMode === 'HORDE' || currentMode === 'RACE') {
      const joy = engine.joysticks?.[slotIndex];
      if (joy) {
        joy.active = false;
        joy.force = 0;
        if ('id' in joy) joy.id = -1;
      }
      if (currentMode === 'HORDE') {
        const player = engine.players?.[slotIndex];
        if (player) {
          player.remoteMoveActive = false;
          player.steerX = 0;
          player.steerY = 0;
        }
      }
    }
  } catch {}
}

// Aim tarafı stale düştüğünde: nişan/ateş bırakılır, hareket korunur.
// Yürürken aim keepalive gecikse bile koşu takılmaz.
export function clearRemoteAim(engine, currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
    if (['ARCHER', 'HORDE', 'LASER'].includes(currentMode) && typeof engine.clearAimInput === 'function') {
      engine.clearAimInput(slotIndex, 'network', true);
      return;
    }
    if (currentMode === 'ARCHER') {
      const player = engine.players?.[slotIndex];
      if (player) {
        player.charging = false;
        player.charge = 0;
      }
    } else if (currentMode === 'LASER') {
      const player = engine.players?.[slotIndex];
      if (player) player.isAiming = false;
    } else if (currentMode === 'HORDE') {
      const player = engine.players?.[slotIndex];
      if (player) player.isAiming = false;
    }
  } catch {}
}

export function clearRemoteSlot(engine, currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
    if (['ARCHER', 'HORDE', 'LASER'].includes(currentMode)) {
      if (typeof engine.resetAimInput === 'function') engine.resetAimInput(slotIndex);
      else if (typeof engine.clearAimInput === 'function') engine.clearAimInput(slotIndex, 'network', true);
    }
    if (currentMode === 'TANKS') {
      const tank = engine.tanks?.[slotIndex];
      if (tank) tank.isDriving = false;
    } else if (currentMode === 'CURVE') {
      const player = engine.players?.[slotIndex];
      if (player) player.steer = 0;
    } else if (currentMode === 'SNAKE') {
      // Takılı boost + direksiyon sıfırlanır (koltuk/skor korunur)
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steer = 0;
        player.isBoost = false;
      }
    } else if (currentMode === 'ARCHER') {
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
        player.charging = false;
        player.charge = 0;
      }
    } else if (currentMode === 'CLONE' || currentMode === 'COLLAPSE' || currentMode === 'NINJA' || currentMode === 'LASER') {
      // Takılı yön sıfırlanır; LASER'ın aim latch'i dekopte bağlantıda kapatılır.
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steerX = 0;
        player.steerY = 0;
        player.remoteActive = false;
        if (currentMode === 'LASER') player.isAiming = false;
      }
      const joy = engine.joysticks?.[slotIndex];
      if (joy) {
        joy.active = false;
        joy.force = 0;
        if ('id' in joy) joy.id = -1;
      }
    } else if (currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'CROWN' || currentMode === 'ZONE' || currentMode === 'HORDE' || currentMode === 'RACE') {
      const joy = engine.joysticks?.[slotIndex];
      if (joy) {
        joy.active = false;
        joy.force = 0;
        if ('id' in joy) joy.id = -1;
      }
      if (currentMode === 'HORDE') {
        const player = engine.players?.[slotIndex];
        if (player) {
          player.remoteMoveActive = false;
          player.steerX = 0;
          player.steerY = 0;
          player.isAiming = false;
        }
      }
    }
    // PONG mutlak pozisyondur (sürüklenmez) — nötr gerekmez.
  } catch {}
}

export function clearAllRemoteSlots(engine, currentMode) {
  for (let i = 0; i < 4; i++) clearRemoteSlot(engine, currentMode, i);
}

export function swapEngineSlots(engine, currentMode, isHosting, slotA, slotB) {
  if (!engine) return;

  if (currentMode === 'PONG') {
    if (engine.setScores) {
      const tempS = engine.setScores[slotA];
      engine.setScores[slotA] = engine.setScores[slotB];
      engine.setScores[slotB] = tempS;
    }
    if (!isHosting && engine.paddles) {
      const pA = engine.paddles[slotA];
      const pB = engine.paddles[slotB];
      if (pA && pB) {
        const tempJoined = pA.isJoined;
        pA.isJoined = pB.isJoined;
        pB.isJoined = tempJoined;
        const tempType = pA.slotType;
        pA.slotType = pB.slotType;
        pB.slotType = tempType;
      }
    }
  } else if (['TANKS', 'CURVE', 'BOMB', 'HEIST', 'ARCHER', 'CROWN', 'ZONE', 'SNAKE', 'LASER', 'CLONE', 'COLLAPSE', 'NINJA', 'HORDE', 'RACE'].includes(currentMode)) {
    if (Array.isArray(engine.scores)) {
      const temp = engine.scores[slotA];
      engine.scores[slotA] = engine.scores[slotB];
      engine.scores[slotB] = temp;
    }
    if (!isHosting && Array.isArray(engine.slotTypes)) {
      const tempType = engine.slotTypes[slotA];
      engine.slotTypes[slotA] = engine.slotTypes[slotB];
      engine.slotTypes[slotB] = tempType;
    }
  }

  if (isHosting) {
    syncSlotsToEngine(engine, currentMode, isHosting);
  }
}

export function refreshAllHostSlots() {
  for (let i = 0; i < 4; i++) {
    const slot = hostPlayerSlots[i];
    if (slot) {
      updateHostSlot(i, true, slot.name, slot.isReady, slot.kind);
    } else {
      updateHostSlot(i, false);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('brutal_customization_changed', () => {
    refreshAllHostSlots();
  });
}

