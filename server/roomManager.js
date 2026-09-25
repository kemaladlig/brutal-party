// Room & Networking Manager for Brutal Party // 4P
// Manages rooms, host connections, controller slots (P1..P4), and low-latency input streaming.
import { sanitizeAvatar, pickFreeColor, isPaletteHex } from '../src/core/customizationManager.js';
import { isValidNetworkInput } from '../src/core/networkProtocol.js';

// Sunucu tarafı isim temizleyici (istemcideki net.js cleanPlayerName ile aynı
// kural: trim + BÜYÜK HARF + 12 + HTML/tehlikeli karakterleri at)
function cleanSlotName(name) {
  const clean = (name ?? '').toString().replace(/<[^>]*>/g, '').trim().toUpperCase().slice(0, 12).replace(/[<>&"'`=\\/]/g, '');
  return clean || 'OYUNCU';
}

// Input validation is shared with the Supabase relay in src/core/networkProtocol.js.
// This keeps local WebSocket and ONLINE mode behavior identical.

// Discrete aksiyon hız limiti (slot başına, ms): sel/flicker koruması.
// Sürekli akış (JOYSTICK/PADDLE) kendi ~30Hz kısmasına tabidir.
const DISCRETE_MIN_GAP = {
  TANK_FIRE: 100, DASH: 100, TACKLE: 100, CURVE_STEER: 30, SNAKE_STEER: 30, TANK_DRIVE: 30,
  SPIN: 500, SNAKE_BOOST: 30, SNAKE_BOOST_RELEASE: 30,
  ARCHER_CHARGE: 30, ARCHER_CHARGE_END: 30, LASER_AIM: 30, LASER_FIRE: 100,
  HORDE_FIRE: 30, HORDE_FIRE_RELEASE: 30, NINJA_SMOKE: 100,
  SWITCH_SLOT: 500, SET_NAME: 1000,
  READY: 300, REACTION: 1000, AVATAR_UPDATE: 1000,
};

export class RoomManager {
  constructor() {
    // Map<roomCode, RoomData>
    this.rooms = new Map();
    // Hayalet süpürücü: close gelmeden ölüp kalan soketleri 10sn'de bir yokla,
    // >20sn sessiz + ölü soketli insan slotunu boşa çıkar (Supabase reclaim eşiğiyle aynı).
    // unref ŞART: RoomManager vite.config'te import anında kurulur; ref'li timer
    // `vite build` bitse bile Node sürecini açık tutar (çıktıda ✓ built görünür ama
    // kabuk dönmez). unref ile timer süreci tek başına ayakta tutamaz.
    const sweepTimer = setInterval(() => this._sweepGhosts(), 10000);
    if (sweepTimer && typeof sweepTimer.unref === 'function') sweepTimer.unref();
  }

  _touchSlot(room, slotIndex) {
    (room.lastSeen ||= {})[slotIndex] = Date.now();
  }

  _sweepGhosts() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      let changed = false;
      for (let i = 0; i < 4; i++) {
        const p = room.players[i];
        if (!p || p.isBot || (p.ws && p.ws.readyState === 1)) continue;
        if (now - ((room.lastSeen || {})[i] || p.joinedAt || 0) < 20000) continue;
        const name = p.name;
        room.players[i] = null;
        room.ready[i] = false;
        changed = true;
        this.sendToHost(room, { type: 'PLAYER_LEFT', slotIndex: i, name });
      }
      if (changed) this.broadcastSlots(room);
    }
  }

  // 3 haneli sayısal oda kodu (100-999): yazması ve söylemesi kolay.
  // Baştaki sıfır bilerek yok (042 vs 42 karmaşası olmaz).
  generateRoomCode() {
    const code = String(Math.floor(100 + Math.random() * 900));
    // Guarantee uniqueness
    if (this.rooms.has(code)) return this.generateRoomCode();
    return code;
  }

  createRoom(hostWs, gameMode = 'PONG', hostIdentity = {}) {
    const code = this.generateRoomCode();
    const room = {
      code,
      hostWs,
      gameMode,
      state: 'LOBBY',
      createdAt: Date.now(),
      players: [null, null, null, null], // Slots 0..3
      ready: [false, false, false, false],
    };

    this.rooms.set(code, room);

    // Attach room info to host socket for fast cleanup on disconnect
    hostWs.roomCode = code;
    hostWs.isHost = true;

    // ONLINE host (veya ileride seçilebilir TV host) baştan P1 olabilir.
    // TV_CONSOLE varsayılanı asPlayer:false gönderir; lobi düğmesiyle
    // aynı host socket'i P1'e sonradan ekleriz.
    if (hostIdentity?.asPlayer === true) {
      this._installHostPlayer(room, hostWs, hostIdentity);
    }

    return room;
  }

  _installHostPlayer(room, hostWs, identity = {}) {
    if (!room || !hostWs?.isHost) return { success: false, error: 'HOST YOK' };
    const existing = room.players[0];
    if (existing && !existing.isHost) {
      return { success: false, error: 'P1 DOLU' };
    }

    const takenColors = room.players
      .filter((p) => p && !p.isBot && !p.isHost)
      .map((p) => p.color)
      .filter(Boolean);
    let avatar = null;
    if (identity.avatar && typeof identity.avatar === 'object') {
      try { avatar = sanitizeAvatar(identity.avatar, { keepColor: true }); } catch { avatar = null; }
    }
    if (!avatar) avatar = sanitizeAvatar({ color: pickFreeColor(takenColors) }, { keepColor: true });
    if (takenColors.map((c) => String(c).toUpperCase()).includes(avatar.color.toUpperCase())) {
      avatar = { ...avatar, color: pickFreeColor(takenColors) };
    }

    const baseName = cleanSlotName(identity.name || 'HOST');
    const takenByOther = (name) => room.players.some(
      (p, i) => p && !p.isBot && !p.isHost && p.name === name
    );
    let finalName = baseName;
    if (takenByOther(finalName)) {
      for (let n = 2; n <= 9; n++) {
        const candidate = `${baseName.slice(0, 10)}·${n}`;
        if (!takenByOther(candidate)) { finalName = candidate; break; }
      }
    }

    const player = {
      slotIndex: 0,
      name: finalName,
      clientId: identity.clientId || null,
      color: avatar.color,
      avatar,
      ws: hostWs,
      isHost: true,
      joinedAt: Date.now(),
      ping: 0,
    };
    room.players[0] = player;
    room.ready[0] = true;
    hostWs.slotIndex = 0;
    return { success: true, player };
  }

  _removeHostPlayer(room) {
    if (!room) return { success: false, error: 'ODA YOK' };
    const player = room.players[0];
    if (!player?.isHost) return { success: false, error: 'HOST OYUNCU DEĞİL' };
    room.players[0] = null;
    room.ready[0] = false;
    if (room.hostWs) room.hostWs.slotIndex = undefined;
    return { success: true, player };
  }

  getReservedHostSlot(room) {
    const index = room?.players?.findIndex((p) => p?.isHost);
    return index >= 0 ? index : null;
  }

  _resetReadyWithHost(room) {
    room.ready = [false, false, false, false];
    const hostSlot = this.getReservedHostSlot(room);
    if (hostSlot !== null) room.ready[hostSlot] = true;
  }

  getHostPlayerState(room) {
    const slotIndex = this.getReservedHostSlot(room);
    if (slotIndex === null) return { active: false, slotIndex: null, player: null };
    const player = room.players[slotIndex];
    return {
      active: true,
      slotIndex,
      player: {
        slotIndex,
        name: player.name,
        color: player.color,
        avatar: player.avatar,
        isHost: true,
      },
      isReady: !!room.ready[slotIndex],
    };
  }

  handleSetHostPlayer(hostWs, active, identity = {}) {
    if (!hostWs || !hostWs.isHost) return { success: false, error: 'HOST YOK' };
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return { success: false, error: 'ODA YOK' };

    let result;
    if (active) {
      result = this._installHostPlayer(room, hostWs, identity);
    } else {
      result = this._removeHostPlayer(room);
    }
    if (!result.success) return result;

    const state = this.getHostPlayerState(room);
    this.sendToHost(room, {
      type: 'HOST_PLAYER_STATE',
      ...state,
    });
    this.broadcastSlots(room);
    return { success: true, ...state };
  }

  getRoom(code) {
    if (!code) return null;
    return this.rooms.get(code.toUpperCase().trim()) || null;
  }

  // Cihaz-başı karakter: renk oyuncuyla gelir (koltukla değil). Avatarı olmayan
  // eski istemciye boş rastgele renk + varsayılan yüz atanır.
  joinRoom(code, clientWs, playerName = 'OYUNCU', clientId = null, avatar = null) {
    const room = this.getRoom(code);
    if (!room) {
      return { success: false, error: 'ODA BULUNAMADI' };
    }

    const baseName = cleanSlotName(playerName);
    // 1. Reconnect: aynı kalıcı istemci kimliği slotunu geri ver (reload güvenli)
    let slotIndex = -1;
    if (clientId) {
      for (let i = 0; i < 4; i++) {
        if (room.players[i] && !room.players[i].isBot && !room.players[i].isHost && room.players[i].clientId === clientId) {
          slotIndex = i;
          break;
        }
      }
    }

    // 2. Find first free slot (0..3)
    if (slotIndex === -1) {
      for (let i = 0; i < 4; i++) {
        if (!room.players[i]) {
          slotIndex = i;
          break;
        }
      }
    }

    // 3. Ölü soketli (kapanmış ama close gelmemiş) insan slotunu geri kazan
    if (slotIndex === -1) {
      for (let i = 0; i < 4; i++) {
        const p = room.players[i];
        if (p && !p.isBot && !p.isHost && (!p.ws || p.ws.readyState !== 1)) {
          slotIndex = i;
          break;
        }
      }
    }

    if (slotIndex === -1) {
      return { success: false, error: 'ODA DOLU (MAKSİMUM 4 OYUNCU)' };
    }

    // 4. İsim tekilleştir (reclaim edilen kendi slotu hariç)
    let finalName = baseName;
    const takenByOther = (name) => room.players.some(
      (p, i) => p && !p.isBot && !p.isHost && i !== slotIndex && p.name === name
    );
    if (takenByOther(finalName)) {
      for (let n = 2; n <= 9; n++) {
        const cand = `${baseName.slice(0, 10)}·${n}`;
        if (!takenByOther(cand)) { finalName = cand; break; }
      }
    }

    // Avatar çözümleme: reclaim'de mevcut korunur, yeni katılımda istemciden
    // gelir; yoksa/geçersizse boş rastgele renk + varsayılan yüz.
    const takenColors = room.players
      .filter((p, i) => p && !p.isBot && !p.isHost && i !== slotIndex)
      .map((p) => p.color);
    const isReclaim = !!(room.players[slotIndex] && !room.players[slotIndex].isBot && !room.players[slotIndex].isHost);
    let cleanAvatar = null;
    if (avatar && typeof avatar === 'object') {
      try { cleanAvatar = sanitizeAvatar(avatar, { keepColor: true }); } catch { cleanAvatar = null; }
    }
    if (!cleanAvatar && isReclaim && room.players[slotIndex].avatar) {
      cleanAvatar = room.players[slotIndex].avatar;
    }
    if (!cleanAvatar) {
      cleanAvatar = sanitizeAvatar({ color: pickFreeColor(takenColors) }, { keepColor: true });
    } else if (takenColors.map((c) => String(c).toUpperCase()).includes(cleanAvatar.color.toUpperCase())) {
      // Geçerli ama alınmış renk → boş rastgele renge çek (yüz/aksesuar korunur)
      cleanAvatar = { ...cleanAvatar, color: pickFreeColor(takenColors) };
    }
    const player = {
      slotIndex,
      name: finalName,
      clientId: clientId || null,
      color: cleanAvatar.color,
      avatar: cleanAvatar,
      ws: clientWs,
      joinedAt: Date.now(),
      ping: 0,
    };

    room.players[slotIndex] = player;

    // Attach metadata to client socket
    clientWs.roomCode = room.code;
    clientWs.isHost = false;
    clientWs.slotIndex = slotIndex;

    // Notify Host that a player joined
    this.sendToHost(room, {
      type: 'PLAYER_JOINED',
      slotIndex: player.slotIndex,
      name: player.name,
      color: player.color,
      avatar: player.avatar,
    });
    // Diğer kumandaların koltuk ızgarası güncellensin
    this.broadcastSlots(room);

    return {
      success: true,
      roomCode: room.code,
      gameMode: room.gameMode,
      slotIndex: player.slotIndex,
      name: player.name,
      color: player.color,
      avatar: player.avatar,
    };
  }

  // Kumanda seli koruması: sürekli analog akış slot başına ~30Hz'e kısılır
  // (AGENTS §5'in 50ms throttle'ı kumanda tarafında; burası ikinci sigortadır).
  // Bozuk paket düşer, discrete aksiyonlar hıza bağlanır (spam/flicker kapanır).
  handlePlayerInput(clientWs, inputData) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room || !room.hostWs) return;
    // TV host local authority üzerinden oynar; input paketi göndermez.
    if (clientWs.isHost) return;
    if (!isValidNetworkInput(inputData)) return;

    const now = Date.now();
    const action = inputData.action;
    const isContinuous = action === 'JOYSTICK_MOVE' || action === 'PADDLE_MOVE';
    const isStopSignal = inputData.force === 0 || inputData.dir === 0
      || (action === 'TANK_DRIVE' && inputData.driving === false);
    if (isContinuous && !isStopSignal) {
      const key = `in_${clientWs.slotIndex}`;
      if (room._lastInputAt?.[key] && now - room._lastInputAt[key] < 33) return;
      (room._lastInputAt ||= {})[key] = now;
    } else {
      const gap = DISCRETE_MIN_GAP[action] || 0;
      if (gap > 0) {
        const key = `d_${clientWs.slotIndex}_${action}`;
        if (room._lastInputAt?.[key] && now - room._lastInputAt[key] < gap) return;
        (room._lastInputAt ||= {})[key] = now;
      }
    }

    this._touchSlot(room, clientWs.slotIndex);
    // Forward raw input directly to Host with zero allocation overhead
    this.sendToHost(room, {
      type: 'PLAYER_INPUT',
      slotIndex: clientWs.slotIndex,
      data: inputData,
    });
  }

  // Yavaş telefonda ws buffer şişerse head-of-line blocking olur — 64KB üstü
  // host yayınını o telefona atla (sonraki 8Hz tik zaten toparlar).
  _sendToPlayer(player, payloadStr) {
    try {
      if (!player?.ws || player.ws.readyState !== 1) return;
      if (player.ws.bufferedAmount > 65536) return;
      player.ws.send(payloadStr);
    } catch {}
  }

  handleHostBroadcast(hostWs, payload) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;

    // If host changes game mode
    if (payload.gameMode) {
      room.gameMode = payload.gameMode;
    }

    // Broadcast state to all connected controller phones (host seat dahil değil)
    const json = JSON.stringify(payload);
    for (const p of room.players) {
      if (p?.isHost) continue;
      this._sendToPlayer(p, json);
    }
  }

  // Slot başına hız kapısı (spam/flicker koruması)
  _rateOk(room, key, gapMs) {
    const now = Date.now();
    if (room._lastInputAt?.[key] && now - room._lastInputAt[key] < gapMs) return false;
    (room._lastInputAt ||= {})[key] = now;
    return true;
  }

  handleReaction(clientWs, emoji) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room || !room.hostWs) return;
    if (!this._rateOk(room, `r_${clientWs.slotIndex}_REACTION`, 1000)) return;
    this._touchSlot(room, clientWs.slotIndex);

    this.sendToHost(room, {
      type: 'PLAYER_REACTION',
      slotIndex: clientWs.slotIndex,
      emoji: (emoji ?? '🔥').toString().slice(0, 8),
    });
  }

  handlePlayerReady(clientWs, isReady) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room) return;
    const slot = clientWs.slotIndex;
    if (slot !== undefined) {
      if (!this._rateOk(room, `r_${slot}_READY`, 300)) return;
      this._touchSlot(room, slot);
      room.ready[slot] = !!isReady;
      this.sendToHost(room, {
        type: 'PLAYER_READY_STATUS',
        slotIndex: slot,
        isReady: !!isReady,
      });
    }
  }

  handleSetGameMode(hostWs, gameMode) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.gameMode = gameMode;
    this.broadcastToPlayers(room, {
      type: 'GAME_MODE_CHANGED',
      gameMode,
    });
  }

  handleStartGame(hostWs, gameMode) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.state = 'PLAYING';
    room.ready = [false, false, false, false];
    if (gameMode) room.gameMode = gameMode;
    this.broadcastToPlayers(room, {
      type: 'GAME_STARTED',
      gameMode: room.gameMode,
    });
    this.broadcastSlots(room);
  }

  // İki kademeli başlatma 1/2: sahayı aç (staging). Oyun başlamaz.
  handleStartStaging(hostWs, gameMode) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.state = 'STAGING';
    this._resetReadyWithHost(room);
    if (gameMode) room.gameMode = gameMode;
    this.broadcastToPlayers(room, {
      type: 'STAGING_STARTED',
      gameMode: room.gameMode,
    });
    this.broadcastSlots(room);
  }

  // İki kademeli başlatma 2/2: geri sayım tik'i.
  handleCountdown(hostWs, t) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    this.broadcastToPlayers(room, {
      type: 'COUNTDOWN',
      t,
      gameMode: room.gameMode,
    });
  }

  handleReturnToLobby(hostWs) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    room.state = 'LOBBY';
    this._resetReadyWithHost(room);
    this.broadcastToPlayers(room, {
      type: 'RETURNED_TO_LOBBY',
      gameMode: room.gameMode,
    });
    this.broadcastSlots(room);
  }

  handleSwapSlots(hostWs, slotA, slotB) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    if (slotA < 0 || slotA > 3 || slotB < 0 || slotB > 3 || slotA === slotB) return;
    // Bot ve host koltukları ne hedef ne kaynak olur
    if (room.players[slotA]?.isBot || room.players[slotB]?.isBot
      || room.players[slotA]?.isHost || room.players[slotB]?.isHost) return;

    const playerColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    const pA = room.players[slotA];
    const pB = room.players[slotB];

    room.players[slotA] = pB;
    room.players[slotB] = pA;

    // Renk oyuncuyla taşınır (koltuğa sabit değil): takasta renk/avatar değişmez,
    // sadece koltuk numarası güncellenir.
    if (pA) {
      pA.slotIndex = slotB;
      if (pA.ws) {
        pA.ws.slotIndex = slotB;
        pA.ws.send(JSON.stringify({ type: 'SLOT_CHANGED', slotIndex: slotB, color: pA.color }));
      }
    }
    if (pB) {
      pB.slotIndex = slotA;
      if (pB.ws) {
        pB.ws.slotIndex = slotA;
        pB.ws.send(JSON.stringify({ type: 'SLOT_CHANGED', slotIndex: slotA, color: pB.color }));
      }
    }

    this.sendToHost(room, {
      type: 'SLOTS_SWAPPED',
      slotA,
      slotB,
    });
    this.broadcastSlots(room);
  }

  // Atomik rotate: 3 ayrı takas yerine tek permütasyon ([2,3,1,0] —
  // swap(0,2)+swap(2,1)+swap(1,3) ile aynı sonuç). Ara yayın yok: her kumandaya
  // tek SLOT_CHANGED + tek SLOTS_UPDATE gider, flicker/yanlış koltuk kapanır.
  // Host skor takasını yerelde yapar (SLOTS_SWAPPED gönderilmez, çift takas olmaz).
  handleRotateSeats(hostWs) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    const order = [2, 3, 1, 0];
    const old = [room.players[0], room.players[1], room.players[2], room.players[3]];
    // Bot veya host koltuğu takasa girmez — kısmi dönüşüm yapılmaz.
    if (old.some((p) => p?.isBot || p?.isHost)) return;
    for (let i = 0; i < 4; i++) {
      const p = old[order[i]];
      room.players[i] = p || null;
      if (p && !p.isBot) {
        p.slotIndex = i;
        if (p.ws) {
          p.ws.slotIndex = i;
          try {
            p.ws.send(JSON.stringify({ type: 'SLOT_CHANGED', slotIndex: i, color: p.color }));
          } catch {}
        }
      }
    }
    this.broadcastSlots(room);
  }

  // ── Tek koltuk gerçeği: bot koltukları + slot snapshot yayını ──

  getSlots(room) {
    return [0, 1, 2, 3].map((idx) => {
      const p = room.players[idx];
      if (!p) return null;
      const entry = {
        slotIndex: idx,
        name: p.name,
        color: p.color,
        isReady: !!room.ready[idx],
        kind: p.isBot ? (p.kind || 'bot') : 'human',
        isHost: !!p.isHost,
      };
      if (!p.isBot && p.avatar) entry.avatar = p.avatar;
      return entry;
    });
  }

  // Host kaynaklı display-renk override (lobi hızlı palet/🎲): profil değişmez,
  // sadece o odalık görüntü rengi. Kumandaya SLOT_CHANGED ile yansır.
  handleSetSlotColor(hostWs, slotIndex, color) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    if (slotIndex < 0 || slotIndex > 3) return;
    const p = room.players[slotIndex];
    if (!p || p.isBot) return;
    if (!isPaletteHex(color)) return;
    const hex = String(color).toUpperCase();
    p.color = hex;
    if (p.ws && p.ws.readyState === 1) {
      try {
        p.ws.send(JSON.stringify({ type: 'SLOT_CHANGED', slotIndex, color: hex }));
      } catch {}
    }
    this.broadcastSlots(room);
  }

  broadcastSlots(room) {
    if (!room) return;
    this.broadcastToPlayers(room, {
      type: 'SLOTS_UPDATE',
      slots: this.getSlots(room),
      reservedHostSlot: this.getReservedHostSlot(room),
    });
  }

  handleSetSlotBot(hostWs, slotIndex, name, kind = 'bot') {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    if (slotIndex < 0 || slotIndex > 3 || room.players[slotIndex]) return;
    const playerColors = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];
    room.players[slotIndex] = {
      slotIndex,
      name: (name || `BOT // P${slotIndex + 1}`).slice(0, 12),
      color: playerColors[slotIndex],
      ws: null,
      isBot: true,
      kind: kind || 'bot',
      joinedAt: Date.now(),
    };
    room.ready[slotIndex] = false;
    this.broadcastSlots(room);
  }

  handleClearSlotBot(hostWs, slotIndex) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    const p = room.players[slotIndex];
    if (!p || !p.isBot) return;
    room.players[slotIndex] = null;
    room.ready[slotIndex] = false;
    this.broadcastSlots(room);
  }

  handleSetName(clientWs, name) {
    const room = this.getRoom(clientWs.roomCode);
    if (!room) return;
    const slot = clientWs.slotIndex;
    const p = room.players[slot];
    if (slot === undefined || !p || p.isBot) return;
    p.name = cleanSlotName(name) || p.name;
    this.sendToHost(room, {
      type: 'PLAYER_UPDATED',
      slotIndex: slot,
      name: p.name,
    });
    this.broadcastSlots(room);
  }

  // Host kaynaklı isim/bot değişimlerinin kumandalara yayını
  handleSetSlotName(hostWs, slotIndex, name) {
    if (!hostWs || !hostWs.isHost) return;
    const room = this.getRoom(hostWs.roomCode);
    if (!room) return;
    const p = room.players[slotIndex];
    if (!p || p.isBot) return;
    p.name = (name || '').slice(0, 12).toUpperCase() || p.name;
    this.broadcastSlots(room);
  }

  broadcastToPlayers(room, payload) {
    const json = JSON.stringify(payload);
    for (const p of room.players) {
      // Host kendi authority/WebSocket'ini kumanda gibi görmemeli.
      if (p?.isHost) continue;
      this._sendToPlayer(p, json);
    }
  }

  handleDisconnect(ws) {
    const roomCode = ws.roomCode;
    if (!roomCode) return;

    const room = this.rooms.get(roomCode);
    if (!room) return;

    if (ws.isHost) {
      // Host closed/left -> notify all players and tear down room
      for (const p of room.players) {
        if (p && !p.isHost && p.ws && p.ws.readyState === 1) {
          p.ws.send(JSON.stringify({ type: 'HOST_DISCONNECTED', message: 'TV Host odadan ayrıldı.' }));
        }
      }
      this.rooms.delete(roomCode);
    } else {
      // A controller player disconnected
      const slot = ws.slotIndex;
      if (slot !== undefined && room.players[slot]) {
        // Yalnızca bu soketin slotuysa boşalt (reclaim edilmişse dokunma)
        if (room.players[slot].ws !== ws) return;
        const leftPlayer = room.players[slot];
        room.players[slot] = null;
        room.ready[slot] = false;

        this.sendToHost(room, {
          type: 'PLAYER_LEFT',
          slotIndex: slot,
          name: leftPlayer.name,
        });
        this.broadcastSlots(room);
      }
    }
  }

  sendToHost(room, message) {
    if (room && room.hostWs && room.hostWs.readyState === 1) {
      room.hostWs.send(JSON.stringify(message));
    }
  }
}
