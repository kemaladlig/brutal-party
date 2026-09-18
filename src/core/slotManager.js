// Slot Manager: Host Player Slots State, UI Sync, Engine Slot & Score Mapping

export const hostPlayerSlots = [null, null, null, null];

// Bot ekleme ayarı (varsayılan KAPALI; pause menüsünden açılır, localStorage'da saklanır)
const BOT_SETTING_KEY = 'brutalparty.botEkle';
export function isBotEkleEnabled() {
  try {
    return localStorage.getItem(BOT_SETTING_KEY) === '1';
  } catch {
    return false;
  }
}
export function setBotEkleEnabled(on) {
  try {
    localStorage.setItem(BOT_SETTING_KEY, on ? '1' : '0');
  } catch {}
}

export function updateHostSlot(slotIndex, isConnected, name = '', isReady = false, kind = 'human') {
  const slotEl = document.getElementById(`slot-p${slotIndex + 1}`);
  const readyTag = document.getElementById(`ready-tag-p${slotIndex + 1}`);
  if (!slotEl) return;

  const nameEl = slotEl.querySelector('.slot-name');
  const botBtn = slotEl.querySelector('.slot-bot-btn');
  if (isConnected) {
    hostPlayerSlots[slotIndex] = { name, isReady, kind };
    slotEl.classList.add('connected');
    slotEl.classList.toggle('is-bot', kind === 'bot');
    slotEl.classList.toggle('ready', isReady && kind !== 'bot');
    if (nameEl) nameEl.textContent = kind === 'bot' ? 'BOT' : name;
    if (readyTag) {
      if (kind === 'bot') {
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
      if (botsOn && kind === 'bot') {
        botBtn.textContent = '✕';
        botBtn.classList.remove('hidden');
      } else {
        botBtn.classList.add('hidden');
      }
    }
  } else {
    hostPlayerSlots[slotIndex] = null;
    slotEl.classList.remove('connected', 'ready', 'is-bot');
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
  const humans = hostPlayerSlots.filter((p) => p !== null && p.kind !== 'bot');
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
}

export function syncSlotsToEngine(engine, currentMode, isHosting) {
  // NOT: Bu fonksiyon SADECE slot eşitleme yapar, motoru ASLA çalıştırmaz.
  // Maç başlangıcı iki kademeli host akışıyla olur: SAHAYA GEÇ (staging) → sayaç → start.
  if (!engine || !isHosting) return;

  // NOT: boş oda dahil her durumda slotlar aynen yazılır (otomatik bot doldurma yok).
  // LOCAL mod bu fonksiyona hiç girmez (isHosting=false) — solo antrenman düzeni korunur.

  if (currentMode === 'PONG') {
    for (let i = 0; i < 4; i++) {
      const p = engine.paddles?.[i];
      if (!p) continue;
      const slot = hostPlayerSlots[i];
      if (slot) {
        p.isJoined = true;
        p.slotType = slot.kind === 'bot' ? 'bot_normal' : 'human';
        p.name = slot.name || `P${i + 1}`;
      } else {
        p.isJoined = false;
        p.slotType = 'empty';
        p.name = ['ALT', 'ÜST', 'SOL', 'SAĞ'][i];
      }
      p.updateLayout?.(engine.arena);
    }
  } else if (currentMode === 'TANKS') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const tank = engine.tanks?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = slot.kind === 'bot' ? 'bot_normal' : 'human';
        if (tank) {
          tank.isJoined = true;
          tank.slotType = slot.kind === 'bot' ? 'bot_normal' : 'human';
          tank.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (tank) {
          tank.isJoined = false;
          tank.slotType = 'empty';
          tank.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
        }
      }
    }
  } else if (currentMode === 'CURVE') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = slot.kind === 'bot' ? 'bot_normal' : 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = slot.kind === 'bot' ? 'bot_normal' : 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (player) {
          player.isJoined = false;
          player.slotType = 'empty';
          player.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
        }
      }
    }
  } else if (currentMode === 'BOMB') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = slot.kind === 'bot' ? 'bot_normal' : 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = slot.kind === 'bot' ? 'bot_normal' : 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (player) {
          player.isJoined = false;
          player.slotType = 'empty';
          player.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
        }
      }
    }
  } else if (currentMode === 'HEIST') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = slot.kind === 'bot' ? 'bot_normal' : 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = slot.kind === 'bot' ? 'bot_normal' : 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (player) {
          player.isJoined = false;
          player.slotType = 'empty';
          player.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
        }
      }
    }
  } else if (currentMode === 'CROWN') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = slot.kind === 'bot' ? 'bot_normal' : 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = slot.kind === 'bot' ? 'bot_normal' : 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (engine.slotTypes) engine.slotTypes[i] = 'empty';
        if (player) {
          player.isJoined = false;
          player.slotType = 'empty';
          player.name = ['KIRMIZI', 'MAVİ', 'SARI', 'YEŞİL'][i];
        }
      }
    }
  } else if (currentMode === 'DUEL') {
    if (!engine.playerNames) engine.playerNames = ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      if (slot) {
        if (engine.joinedPlayers) engine.joinedPlayers[i] = true;
        engine.playerNames[i] = slot.name || `P${i + 1}`;
      } else {
        if (engine.joinedPlayers) engine.joinedPlayers[i] = false;
        engine.playerNames[i] = '';
      }
    }
    if (typeof engine.updateTriggerPads === 'function') {
      engine.updateTriggerPads();
    }
  }
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
  } else if (currentMode === 'TANKS' || currentMode === 'CURVE' || currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'DUEL' || currentMode === 'CROWN') {
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
