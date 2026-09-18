// Slot Manager: Host Player Slots State, UI Sync, Engine Slot & Score Mapping

export const hostPlayerSlots = [null, null, null, null];

export function updateHostSlot(slotIndex, isConnected, name = '', isReady = false) {
  const slotEl = document.getElementById(`slot-p${slotIndex + 1}`);
  const readyTag = document.getElementById(`ready-tag-p${slotIndex + 1}`);
  if (!slotEl) return;

  const nameEl = slotEl.querySelector('.slot-name');
  if (isConnected) {
    hostPlayerSlots[slotIndex] = { name, isReady };
    slotEl.classList.add('connected');
    slotEl.classList.toggle('ready', isReady);
    if (nameEl) nameEl.textContent = name;
    if (readyTag) {
      readyTag.textContent = isReady ? '✓ HAZIR' : '⏳ BEKLİYOR';
      readyTag.classList.toggle('ready', isReady);
    }
  } else {
    hostPlayerSlots[slotIndex] = null;
    slotEl.classList.remove('connected', 'ready');
    if (nameEl) nameEl.textContent = 'BEKLENİYOR...';
    if (readyTag) {
      readyTag.textContent = '— BOŞ';
      readyTag.classList.remove('ready');
    }
  }

  const connectedCount = hostPlayerSlots.filter((p) => p !== null).length;
  const readyCount = hostPlayerSlots.filter((p) => p?.isReady).length;
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
  if (!engine || !isHosting) return;

  const humanCount = hostPlayerSlots.filter((p) => p !== null).length;
  if (humanCount === 0) return;

  if (currentMode === 'PONG') {
    for (let i = 0; i < 4; i++) {
      const p = engine.paddles?.[i];
      if (!p) continue;
      const slot = hostPlayerSlots[i];
      if (slot) {
        p.isJoined = true;
        p.slotType = 'human';
        p.name = slot.name || `P${i + 1}`;
      } else {
        if (humanCount === 1 && i === 1) {
          p.isJoined = true;
          p.slotType = 'bot_normal';
          p.name = 'BOT // MAVİ';
        } else {
          p.isJoined = false;
          p.slotType = 'empty';
          p.name = ['ALT', 'ÜST', 'SOL', 'SAĞ'][i];
        }
      }
      p.updateLayout?.(engine.arena);
    }
    if (engine.state === 'LOBBY' && engine.getJoinedPlayerCount?.() >= 2) {
      engine.startGame?.();
    }
  } else if (currentMode === 'TANKS') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const tank = engine.tanks?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = 'human';
        if (tank) {
          tank.isJoined = true;
          tank.slotType = 'human';
          tank.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (humanCount === 1 && i === 1) {
          if (engine.slotTypes) engine.slotTypes[1] = 'bot_normal';
          if (tank) {
            tank.isJoined = true;
            tank.slotType = 'bot_normal';
            tank.name = 'BOT // MAVİ';
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
    }
    if (engine.state === 'LOBBY') {
      engine.startRound?.();
    }
  } else if (currentMode === 'CURVE') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (humanCount === 1 && i === 1) {
          if (engine.slotTypes) engine.slotTypes[1] = 'bot_normal';
          if (player) {
            player.isJoined = true;
            player.slotType = 'bot_normal';
            player.name = 'BOT // MAVİ';
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
    }
    if (engine.state === 'LOBBY') {
      engine.startRound?.();
    }
  } else if (currentMode === 'BOMB') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (humanCount === 1 && i === 1) {
          if (engine.slotTypes) engine.slotTypes[1] = 'bot_normal';
          if (player) {
            player.isJoined = true;
            player.slotType = 'bot_normal';
            player.name = 'BOT // MAVİ';
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
    }
    if (engine.state === 'LOBBY') {
      engine.startRound?.();
    }
  } else if (currentMode === 'HEIST') {
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      const player = engine.players?.[i];
      if (slot) {
        if (engine.slotTypes) engine.slotTypes[i] = 'human';
        if (player) {
          player.isJoined = true;
          player.slotType = 'human';
          player.name = slot.name || `P${i + 1}`;
        }
      } else {
        if (humanCount === 1 && i === 1) {
          if (engine.slotTypes) engine.slotTypes[1] = 'bot_normal';
          if (player) {
            player.isJoined = true;
            player.slotType = 'bot_normal';
            player.name = 'BOT // MAVİ';
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
    }
    if (engine.state === 'LOBBY') {
      engine.startRound?.();
    }
  } else if (currentMode === 'DUEL') {
    if (!engine.playerNames) engine.playerNames = ['', '', '', ''];
    for (let i = 0; i < 4; i++) {
      const slot = hostPlayerSlots[i];
      if (slot) {
        if (engine.joinedPlayers) engine.joinedPlayers[i] = true;
        engine.playerNames[i] = slot.name || `P${i + 1}`;
      } else {
        if (engine.joinedPlayers) engine.joinedPlayers[i] = humanCount === 1 && i === 1;
        engine.playerNames[i] = '';
      }
    }
    if (typeof engine.updateTriggerPads === 'function') {
      engine.updateTriggerPads();
    }
    if (engine.state === 'LOBBY' && engine.getActivePlayerCount?.() >= 2) {
      engine.startMatch?.();
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
  } else if (currentMode === 'TANKS' || currentMode === 'CURVE' || currentMode === 'BOMB' || currentMode === 'HEIST' || currentMode === 'DUEL') {
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
