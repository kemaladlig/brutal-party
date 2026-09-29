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

function applySlotDataToEntity(engine, i, slotType, slotName, slotColor, isJoined, rimColor) {
  engine?.applySlotIdentity?.(i, { slotType, name: slotName, color: slotColor, rimColor, isJoined });
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

      applySlotDataToEntity(engine, i, botType, slotName, slotColor, !!slot, slotRim);
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

      applySlotDataToEntity(engine, i, slotType, slotName, slotColor, isJoined, slotRim);
    }
  }
}

// Kopan/kapanan kumandanın latch'li girdisini nötrle — koltuk, isim, skor,
// bot bayrakları AYNEN korunur (koltuğu tut politikası). Host bot ekle/çıkar,
// sayaç kilidi, ready-reset kurallarına dokunmaz.
// Move ve aim ayrı kapsamlardır: hareket stale olunca aim korunur ('move'),
// aim stale olunca hareket korunur ('aim'), bağlantı koptuğunda ikisi de ('all').
// Aim basılıyken hareketsiz durmak ateşi kesmemeli.
export function clearRemoteMove(engine, _currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
    engine.neutralizeSlotInput?.(slotIndex, 'move');
  } catch (err) { reportError(err, 'slotManager.clearRemoteMove', { warnOnly: true }); }
}

// Aim tarafı stale düştüğünde: nişan/ateş bırakılır, hareket korunur.
// Yürürken aim keepalive gecikse bile koşu takılmaz.
export function clearRemoteAim(engine, _currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
    engine.neutralizeSlotInput?.(slotIndex, 'aim');
  } catch (err) { reportError(err, 'slotManager.clearRemoteAim', { warnOnly: true }); }
}

export function clearRemoteSlot(engine, _currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
    engine.neutralizeSlotInput?.(slotIndex, 'all');
  } catch (err) { reportError(err, 'slotManager.clearRemoteSlot', { warnOnly: true }); }
}

export function clearAllRemoteSlots(engine, currentMode) {
  for (let i = 0; i < 4; i++) clearRemoteSlot(engine, currentMode, i);
}

export function swapEngineSlots(engine, currentMode, isHosting, slotA, slotB) {
  if (!engine) return;
  try {
    engine.swapLocalSlots?.(slotA, slotB, isHosting);
  } catch (err) { reportError(err, 'slotManager.swapEngineSlots', { warnOnly: true }); }

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

