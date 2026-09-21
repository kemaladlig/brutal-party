// Slot Manager: Host Player Slots State, UI Sync, Engine Slot & Score Mapping
import { drawBrutalAvatar } from '../ui/characterRenderer.js';
import { getSlotCustomization, findSlotColorDuplicates } from './customizationManager.js';
import { safeGet, safeSet } from './safeStorage.js';

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

export function updateHostSlot(slotIndex, isConnected, name = '', isReady = false, kind = 'human', avatar = undefined, displayColor = undefined) {
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
        drawBrutalAvatar(ctx, 17, 17, 13, {
          color: '#FF0055',
          expression: 'ANGRY',
          accessory: 'GLASSES',
          pattern: 'STRIPES',
          showPointer: false,
          borderWidth: 2,
          shadowOffset: 1.5,
        });
      } else if (kind === 'bot') {
        drawBrutalAvatar(ctx, 17, 17, 13, {
          color: '#8E8E93',
          expression: 'CYBORG',
          accessory: 'NONE',
          pattern: 'SOLID',
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
      avatar: avatar !== undefined ? avatar : (prevEntry?.avatar || null),
      displayColor: displayColor !== undefined ? displayColor : (prevEntry?.displayColor || null),
    };
    const isBotNormal = kind === 'bot';
    const isBotGod = kind === 'bot_god';
    const isAnyBot = isBotNormal || isBotGod;

    slotEl.classList.add('connected');
    slotEl.classList.toggle('is-bot', isAnyBot);
    slotEl.classList.toggle('is-bot-god', isBotGod);
    slotEl.classList.toggle('ready', isReady && !isAnyBot);

    if (nameEl) nameEl.textContent = isBotGod ? '⚡ GOD' : (isBotNormal ? 'BOT' : name);
    if (readyTag) {
      if (isBotGod) {
        readyTag.textContent = '⚡ GOD';
        readyTag.classList.remove('ready');
      } else if (isBotNormal) {
        readyTag.textContent = 'BOT';
        readyTag.classList.remove('ready');
      } else {
        readyTag.textContent = isReady ? 'HAZIR' : 'BEKLE';
        readyTag.classList.toggle('ready', isReady);
      }
    }
    // Açık buton (sadece ayar açıksa): bot kartında ✕ (kaldır), boş koltukta +BOT.
    // Kapalıyken normal akışta sadece oyuncu eklenir/çıkarılır.
    const botsOn = isBotEkleEnabled();
    if (botBtn) {
      if (botsOn && isAnyBot) {
        botBtn.textContent = '✕';
        botBtn.classList.remove('hidden');
      } else {
        botBtn.classList.add('hidden');
      }
    }
  } else {
    hostPlayerSlots[slotIndex] = null;
    slotEl.classList.remove('connected', 'ready', 'is-bot', 'is-bot-god');
    if (nameEl) nameEl.textContent = 'BOŞ';
    if (readyTag) {
      readyTag.textContent = 'BOŞ';
      readyTag.classList.remove('ready');
    }
    // Boş koltukta +BOT butonu (sadece ayar açıksa)
    if (botBtn) {
      if (isBotEkleEnabled()) {
        botBtn.textContent = '+ BOT';
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
      readyCounter.textContent = 'OYUNCU BEKLENİYOR';
    } else if (readyCount === connectedCount) {
      readyCounter.textContent = `✓ ${readyCount}/${connectedCount} HAZIR — BAŞLATILABILIR`;
    } else {
      readyCounter.textContent = `${connectedCount} BAĞLANDI • ${readyCount} HAZIR`;
    }
  }
  refreshColorClashUI();
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
      warn.textContent = isClash ? '⚠️ AYNI RENK' : '';
      warn.classList.toggle('hidden', !isClash);
    }
  }
  try {
    window.dispatchEvent(new CustomEvent('brutal_color_clash', {
      detail: { clash: [...clash] },
    }));
  } catch {}
}

export function syncSlotsToEngine(engine, currentMode, isHosting) {
  // NOT: Bu fonksiyon SADECE slot eşitleme yapar, motoru ASLA çalıştırmaz.
  // Maç başlangıcı iki kademeli host akışıyla olur: SAHAYA GEÇ (staging) → sayaç → start.
  if (!engine || !isHosting) return;

  // NOT: boş oda dahil her durumda slotlar aynen yazılır (otomatik bot doldurma yok).
  // LOCAL mod bu fonksiyona hiç girmez (isHosting=false) — solo antrenman düzeni korunur.

  for (let i = 0; i < 4; i++) {
    const slot = hostPlayerSlots[i];
    const custom = getSlotCustomization(i);
    const botType = slot ? (slot.kind === 'bot_god' ? 'bot_god' : (slot.kind === 'bot' ? 'bot_normal' : 'human')) : 'human';
    // Display rengi: host override → oyuncu avatar rengi → cihaz profili.
    const slotColor = (slot && (slot.kind === 'bot' || slot.kind === 'bot_god')) ? (slot.kind === 'bot_god' ? '#FF0055' : '#8E8E93') : (slot?.displayColor || slot?.avatar?.color || custom.color);

    if (currentMode === 'PONG') {
      const p = engine.paddles?.[i];
      if (p) {
        if (slot) {
          p.isJoined = true;
          p.slotType = botType;
          p.name = slot.name || `P${i + 1}`;
          p.color = slotColor;
        } else {
          p.isJoined = false;
          p.slotType = 'empty';
          p.name = ['P1', 'P2', 'P3', 'P4'][i];
          p.color = custom.color;
        }
        p.updateLayout?.(engine.arena);
      }
    } else if (currentMode === 'TANKS') {
      const tank = engine.tanks?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = botType;
        if (tank) {
          tank.isJoined = true;
          tank.slotType = botType;
          tank.name = slot.name || `P${i + 1}`;
          tank.color = slotColor;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (tank) {
          tank.isJoined = false;
          tank.slotType = 'empty';
          tank.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
          tank.color = custom.color;
        }
      }
    } else if (currentMode === 'CURVE') {
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = botType;
        if (player) {
          player.isJoined = true;
          player.slotType = botType;
          player.name = slot.name || `P${i + 1}`;
          player.color = slotColor;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (player) {
          player.isJoined = false;
          player.slotType = 'empty';
          player.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
          player.color = custom.color;
        }
      }
    } else if (currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'CROWN' || currentMode === 'ZONE' || currentMode === 'SNAKE' || currentMode === 'LASER' || currentMode === 'CLONE' || currentMode === 'COLLAPSE' || currentMode === 'NINJA') {
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = botType;
        if (player) {
          player.isJoined = true;
          player.slotType = botType;
          player.name = slot.name || `P${i + 1}`;
          player.color = slotColor;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (player) {
          player.isJoined = false;
          player.slotType = 'empty';
          player.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
          player.color = custom.color;
        }
      }
    } else if (currentMode === 'DUEL') {
      if (!engine.playerNames) engine.playerNames = ['', '', '', ''];
      if (!engine.slotTypes) engine.slotTypes = ['empty', 'empty', 'empty', 'empty'];
      if (!engine.playerColors) engine.playerColors = ['', '', '', ''];
      if (slot) {
        engine.slotTypes[i] = botType;
        if (engine.joinedPlayers) engine.joinedPlayers[i] = true;
        engine.playerNames[i] = slot.name || `P${i + 1}`;
        engine.playerColors[i] = slotColor;
      } else {
        engine.slotTypes[i] = 'empty';
        if (engine.joinedPlayers) engine.joinedPlayers[i] = false;
        engine.playerNames[i] = '';
        engine.playerColors[i] = custom.color;
      }
    }
  }
}

// Kopan/kapanan kumandanın latch'li girdisini nötrle — koltuk, isim, skor,
// bot bayrakları AYNEN korunur (koltuğu tut politikası). Host bot ekle/çıkar,
// sayaç kilidi, ready-reset kurallarına dokunmaz.
export function clearRemoteSlot(engine, currentMode, slotIndex) {
  if (!engine || slotIndex < 0 || slotIndex > 3) return;
  try {
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
    } else if (currentMode === 'CLONE' || currentMode === 'COLLAPSE' || currentMode === 'NINJA' || currentMode === 'LASER') {
      // Takılı yön sıfırlanır (atılma/zıplama/kılıç/ateş anlık olaydır, latch tutmaz)
      const player = engine.players?.[slotIndex];
      if (player) {
        player.steerX = 0;
        player.steerY = 0;
      }
    } else if (currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'CROWN' || currentMode === 'ZONE') {
      const joy = engine.joysticks?.[slotIndex];
      if (joy) {
        joy.active = false;
        joy.force = 0;
        if ('id' in joy) joy.id = -1;
      }
    }
    // PONG mutlak pozisyondur (sürüklenmez), DUEL stateless event'tir — nötr gerekmez.
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
    if (engine.matchScores) {
      const tempM = engine.matchScores[slotA];
      engine.matchScores[slotA] = engine.matchScores[slotB];
      engine.matchScores[slotB] = tempM;
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
  } else if (['TANKS', 'CURVE', 'BOMB', 'HEIST', 'DUEL', 'CROWN', 'ZONE', 'SNAKE', 'LASER', 'CLONE', 'COLLAPSE', 'NINJA'].includes(currentMode)) {
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
    // DUEL: slotTypes takasda joinedPlayers/playerNames de döner (lokal koltuk takası senkronu)
    if (!isHosting && currentMode === 'DUEL') {
      if (Array.isArray(engine.joinedPlayers)) {
        const tj = engine.joinedPlayers[slotA];
        engine.joinedPlayers[slotA] = engine.joinedPlayers[slotB];
        engine.joinedPlayers[slotB] = tj;
      }
      if (Array.isArray(engine.playerNames)) {
        const tn = engine.playerNames[slotA];
        engine.playerNames[slotA] = engine.playerNames[slotB];
        engine.playerNames[slotB] = tn;
      }
      if (typeof engine.syncJoinFromSlots === 'function') engine.syncJoinFromSlots();
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

