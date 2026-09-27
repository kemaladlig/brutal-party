// Slot Manager: Host Player Slots State, Engine Slot & Score Mapping
// Koltuk kartlarının DOM boyaması `ui/slotCardView.js`'dedir; burada yalnız
// durum ve motor eşlemesi vardır.
import { getSlotCustomization, findSlotColorDuplicates, getBotPersona, getLocalSeatColors, rimHex } from './customizationManager.js';
import { reportError } from './errorReporter.js';
import {
  hasSlotCard,
  paintSlotAvatar,
  paintSlotCard,
  paintReadyCounter,
  paintColorClashBadges,
  dispatchHostSlotsChanged,
  dispatchColorClash,
} from '../ui/slotCardView.js';
import { safeGet, safeSet } from './safeStorage.js';
import { getStoredPlayerName, ensureStoredNick } from '../net.js';

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
  // Kart DOM'u yoksa (LOCAL/oyun içi kabuk) durum da boyama da değişmez:
  // hostPlayerSlots yalnız host lobisinde yazılır.
  if (!hasSlotCard(slotIndex)) return;

  // Çip, kart metninden ÖNCE çizilir ve kaynak eski kayıttır (mevcut sıra).
  paintSlotAvatar(slotIndex, { isConnected, kind, entry: hostPlayerSlots[slotIndex] });

  if (isConnected) {
    const prevEntry = hostPlayerSlots[slotIndex];
    hostPlayerSlots[slotIndex] = {
      name, isReady, kind,
      isHost: isHost !== undefined ? !!isHost : !!prevEntry?.isHost,
      avatar: avatar !== undefined ? avatar : (prevEntry?.avatar || null),
      displayColor: displayColor !== undefined ? displayColor : (prevEntry?.displayColor || null),
    };
  } else {
    hostPlayerSlots[slotIndex] = null;
  }

  paintSlotCard(slotIndex, hostPlayerSlots[slotIndex], { botsEnabled: isBotEkleEnabled() });
  paintReadyCounter(hostPlayerSlots);
  refreshColorClashUI();
  // Host lobi koltuk düzenleyicisi aynı slot snapshot'ını okur; yeni katılım,
  // ayrılma veya renk güncellemesinde seçim butonlarını da anında tazele.
  dispatchHostSlotsChanged();
}

// Aynı display rengine sahip insan koltuklarına çakışma rozeti + kart vurgusu.
// Kart DOM'u yoksa (LOCAL/oyun içi) sessizce geçilir.
export function refreshColorClashUI() {
  let clash = /** @type {any} */ ([]);
  try {
    clash = findSlotColorDuplicates(hostPlayerSlots);
  } catch {
    clash = [];
  }
  paintColorClashBadges(clash);
  dispatchColorClash(clash);
}

function applySlotDataToEntity(engine, currentMode, i, slotType, slotName, slotColor, isJoined, rimColor) {
  if (currentMode === 'PONG') {
    const p = engine.paddles?.[i];
    if (p) {
      p.isJoined = isJoined;
      p.slotType = slotType;
      p.name = slotName;
      p.color = slotColor;
      p.rimColor = rimColor;
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
      tank.rimColor = rimColor;
    }
  } else if (currentMode === 'CURVE') {
    if (engine.slotTypes) engine.slotTypes[i] = slotType;
    const player = engine.players?.[i];
    if (player) {
      player.isJoined = isJoined;
      player.slotType = slotType;
      player.name = slotName;
      player.color = slotColor;
      player.rimColor = rimColor;
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
      player.rimColor = rimColor;
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
      // Halka botlarda sabit klasik; insanda relay avatarı → cihaz profili.
      const slotRim = isAnyBot
        ? rimHex('CLASSIC')
        : rimHex(slot?.avatar?.rim || custom.rim);
      const slotName = slot
        ? resolveSlotName(i, botType, slot.name)
        : `P${i + 1}`;

      applySlotDataToEntity(engine, currentMode, i, botType, slotName, slotColor, !!slot, slotRim);
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
      const slotRim = isAnyBot ? rimHex('CLASSIC') : rimHex(custom.rim);
      const slotName = resolveSlotName(i, slotType);

      applySlotDataToEntity(engine, currentMode, i, slotType, slotName, slotColor, isJoined, slotRim);
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
  } catch (err) { reportError(err, 'slotManager.clearRemoteMove', { warnOnly: true }); }
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
  } catch (err) { reportError(err, 'slotManager.clearRemoteAim', { warnOnly: true }); }
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
  } catch (err) { reportError(err, 'slotManager.clearRemoteSlot', { warnOnly: true }); }
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

// Tek koltuk kartını state'ten yeniden çiz (name/isReady/kind güncel kayıttan).
// Ekstra veri taşımayan "yakala ve yeniden boya" çağrılarının tek yeri.
export function refreshSlotCard(i) {
  const slot = hostPlayerSlots[i];
  if (slot) {
    updateHostSlot(i, true, slot.name, slot.isReady, slot.kind);
  } else {
    updateHostSlot(i, false);
  }
}

export function refreshAllHostSlots() {
  for (let i = 0; i < 4; i++) {
    refreshSlotCard(i);
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('brutal_customization_changed', () => {
    refreshAllHostSlots();
  });
}

