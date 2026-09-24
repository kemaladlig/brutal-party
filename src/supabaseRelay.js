// src/supabaseRelay.js
// Supabase Realtime Broadcast Relay for Online Multiplayer
// With WebRTC DataChannel acceleration for zero-quota, low-latency gameplay.

import { createClient } from '@supabase/supabase-js';
import { cleanPlayerName, getClientId } from './net.js';
import { WebRTCManager } from './webrtcManager.js';
import { sanitizeAvatar, pickFreeColor, isPaletteHex, getAvatarProfile } from './core/customizationManager.js';
import { isValidNetworkInput } from './core/networkProtocol.js';
import { t } from './i18n.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

function assertSupabaseConfig() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(t('net.noConfig'));
  }
}

// Unique browser tab ID to distinguish self-messages
const MY_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const PLAYER_COLORS = ['#D84727', '#1D5D8A', '#D99B26', '#2F6A4F'];

export class SupabaseRelay {
  constructor() {
    this.supabase = null;
    this.channel = null;
    this.role = null; // 'HOST' | 'CONTROLLER'
    this.roomCode = null;
    this.myId = MY_ID;
    this.ping = 0;

    // WebRTC Katmanı (direct peer-to-peer input/state)
    this.webrtcManager = null;
    this._webRtcAvailable = false; // Supabase Broadcast fallback bayrağı

    // --- HOST state ---
    this.players = [null, null, null, null]; // { id, name, color, slotIndex }
    this.ready = [false, false, false, false];
    this.gameMode = 'PONG';
    this.hostPlayerActive = false;
    this.hostPlayerSlot = null;

    // --- CONTROLLER state ---
    this.playerIndex = null;
    this.playerName = null;
    this.color = null;
    this.hostId = null;

    // Callbacks (same interface as PartyNetwork)
    this.callbacks = {};

    // ONLINE cihazlarda uzaktan oyun sahası yalnız P2P world kanalından gelir.
    // TV_CONSOLE host odasında world kapalıdır; host isteğe bağlı local P1
    // oyuncusuna katılsa da telefonlar kumanda olarak kalır.
    this.supportsWorldFrames = false;
    this.reservedHostSlot = null;

    // Ping tracking
    this.pingInterval = null;
    this.lastPingSent = 0;

    // Host canlılık takibi (controller tarafı watchdog için)
    this._lastHostMsgAt = 0;
    this._hostWatchdog = null;

    // Otomatik re-join durumu (WS PartyNetwork muadili)
    this._lastJoin = null;
    this._joinedOnce = false;
    this._manualClose = false;
    this._reconnectTries = 0;
    this._reconnectTimer = null;
    this._joinAttempts = 0;
    this._webrtcRetryTimer = null;
    this._webrtcConnectTimer = null;
    this._webrtcRetryDelay = 1000;
    this._webrtcGeneration = 0;
  }

  get isHosting() {
    return this.role === 'HOST';
  }

  _hostPlayerIndex() {
    return this.players.findIndex((p) => p?.isHost);
  }

  _removeHostPlayer() {
    const slot = this._hostPlayerIndex();
    if (slot < 0) return { success: false, error: 'HOST OYUNCU DEĞİL' };
    this.players[slot] = null;
    this.ready[slot] = false;
    this.hostPlayerActive = false;
    this.hostPlayerSlot = null;
    this.reservedHostSlot = null;
    return { success: true, slotIndex: slot };
  }

  _installHostPlayer(identity = {}) {
    this.hostId = this.myId;
    const asPlayer = identity.asPlayer !== false;
    if (!asPlayer) {
      this._removeHostPlayer();
      return { success: true, active: false, slotIndex: null, player: null };
    }

    let slotIndex = this._hostPlayerIndex();
    if (slotIndex < 0) {
      if (this.players[0]) return { success: false, error: 'P1 DOLU' };
      slotIndex = 0;
    }

    let avatar = null;
    try {
      avatar = sanitizeAvatar(identity.avatar || getAvatarProfile(), { keepColor: true });
    } catch {
      avatar = sanitizeAvatar({ color: pickFreeColor([]) }, { keepColor: true });
    }
    const name = cleanPlayerName(identity.name || 'HOST');
    const player = {
      id: this.myId,
      clientId: getClientId(),
      name,
      color: avatar.color,
      avatar,
      slotIndex,
      lastSeen: performance.now(),
      isHost: true,
    };
    this.players[slotIndex] = player;
    this.ready[slotIndex] = true;
    this.hostPlayerActive = true;
    this.hostPlayerSlot = slotIndex;
    this.reservedHostSlot = slotIndex;
    return { success: true, active: true, slotIndex, player };
  }

  _resetReadyFlags() {
    this.ready = [false, false, false, false];
  }

  /**
   * Deliver a host message to each player over the best available transport.
   * WebRTC is per-peer; Supabase fallback is targeted so players connected by
   * DataChannel do not receive duplicate room-wide state packets.
   */
  _sendHostPayload(payload) {
    if (!payload || typeof payload !== 'object') return;

    const openPeerIds = new Set(this.webrtcManager?.getOpenPeerIds?.('control') || []);
    if (this.webrtcManager) {
      for (const peerId of openPeerIds) {
        if (!this.webrtcManager.sendTo(peerId, payload, 'control')) {
          openPeerIds.delete(peerId);
        }
      }
    }

    if (!this.channel) return;

    if (payload.targetId) {
      if (!openPeerIds.has(payload.targetId)) {
        this._broadcast('host_msg', payload);
      }
      return;
    }

    // No WebRTC peers: preserve the original one room-wide Supabase packet.
    if (openPeerIds.size === 0) {
      this._broadcast('host_msg', payload);
      return;
    }

    for (const player of this.players) {
      if (!player || player.isBot || player.isHost || openPeerIds.has(player.id)) continue;
      this._broadcast('host_msg', { ...payload, targetId: player.id });
    }
  }

  _sendControllerPayload(payload) {
    if (
      this._webRtcAvailable
      && this.hostId
      && this.webrtcManager?.hasActiveConnection(this.hostId, 'control')
      && this.webrtcManager.sendTo(this.hostId, payload, 'control')
    ) {
      return true;
    }
    return false;
  }

  // ━━━━━━━━━━━━━━━━━━━ HOST API ━━━━━━━━━━━━━━━━━━━

  async hostRoom(gameMode = 'PONG', callbacks = {}, hostIdentity = {}) {
    assertSupabaseConfig();
    this.role = 'HOST';
    this.gameMode = gameMode;
    this.callbacks = { ...this.callbacks, ...callbacks };
    this.players = [null, null, null, null];
    this.ready = [false, false, false, false];
    this.supportsWorldFrames = hostIdentity.worldView !== false;
    this._installHostPlayer(hostIdentity);
    this.hostPlayerActive = hostIdentity.asPlayer !== false;
    this.hostPlayerSlot = this.hostPlayerActive ? 0 : null;
    this.reservedHostSlot = this.hostPlayerSlot;

    // Generate room code
    this.roomCode = this._generateRoomCode();

    // Connect to Supabase
    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 30 } },
    });

    const channelName = `brutal-party-${this.roomCode}`;
    this.channel = this.supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    // Listen for controller messages
    this.channel.on('broadcast', { event: 'player_msg' }, ({ payload }) => {
      if (!payload || payload.senderId === this.myId) return;
      this._hostHandleMessage(payload);
    });

    // Host WebRTC Yöneticisini Başlat
    this.webrtcManager = new WebRTCManager({
      isHost: true,
      sendSignal: (targetId, signal) => {
        this._broadcast('host_msg', {
          action: 'WEBRTC_SIGNAL',
          targetId,
          signal,
        });
      },
      onMessage: (peerId, data) => {
        // WebRTC üzerinden gelen oyuncu verisi
        this._hostHandleMessage({ ...data, senderId: peerId });
      },
      onStatusChange: (peerId, status, channel) => {
        console.log(`[SupabaseRelay] Host WebRTC ${channel} (${peerId}): ${status}`);
      },
    });

    try {
      await new Promise((resolve, reject) => {
        const failTimer = setTimeout(() => {
          reject(new Error(t('net.relayTimeout')));
        }, 10000);
        this.channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(failTimer);
            console.log(`[SupabaseRelay] HOST subscribed to ${channelName}`);
            this._startHostAnnounce();
            if (this.callbacks.onConnectionRestored) this.callbacks.onConnectionRestored();
            if (this.callbacks.onRoomCreated) {
              this.callbacks.onRoomCreated(this.roomCode, this.gameMode, {
                hostPlayer: this.getHostPlayerState()?.player || null,
                reservedHostSlot: this.reservedHostSlot,
              });
            }
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(failTimer);
            console.error('[SupabaseRelay] HOST subscribe failed:', status, err?.message || '');
            reject(new Error(t('net.relayStatus', status)));
          }
        });
      });
    } catch (err) {
      try { this.supabase?.removeChannel(this.channel); } catch { /* sessiz */ }
      this.channel = null;
      throw err;
    }

    this._startPingHeartbeat();
  }

  _startHostAnnounce() {
    this._stopHostAnnounce();
    const announce = () => {
      this._broadcast('host_msg', {
        action: 'HOST_ANNOUNCE',
        hostId: this.myId,
        gameMode: this.gameMode,
        roomCode: this.roomCode,
      });
    };
    announce();
    this._announceInterval = setInterval(announce, 5000);
  }

  _stopHostAnnounce() {
    if (this._announceInterval) {
      clearInterval(this._announceInterval);
      this._announceInterval = null;
    }
  }

  _hostHandleMessage(msg) {
    switch (msg.action) {
      case 'WEBRTC_SIGNAL': {
        if (
          msg.targetId === this.myId
          && this._findSlotByPlayerId(msg.senderId) !== -1
          && this.webrtcManager
        ) {
          this.webrtcManager.handleSignal(msg.senderId, msg.signal);
        }
        break;
      }

      case 'JOIN': {
        if (msg.hostId && msg.hostId !== this.myId) return;
        const now = performance.now();
        let baseName = cleanPlayerName(msg.name);
        let slotIndex = -1;

        for (let i = 0; i < 4; i++) {
          const p = this.players[i];
          if (!p || p.isBot || p.isHost) continue;
          if (msg.clientId && p.clientId && p.clientId === msg.clientId) { slotIndex = i; break; }
          if (p.name === baseName && now - (p.lastSeen || 0) > 20000) { slotIndex = i; break; }
        }

        if (slotIndex === -1) {
          for (let i = 0; i < 4; i++) {
            if (!this.players[i]) { slotIndex = i; break; }
          }
        }

        if (slotIndex === -1) {
          for (let i = 0; i < 4; i++) {
            if (
              this.players[i]
              && !this.players[i].isBot
              && !this.players[i].isHost
              && now - (this.players[i].lastSeen || 0) > 20000
            ) {
              slotIndex = i;
              break;
            }
          }
        }

        if (slotIndex === -1) {
          this._broadcast('host_msg', {
            action: 'JOIN_ERROR',
            targetId: msg.senderId,
            error: 'ODA DOLU (MAKSİMUM 4 OYUNCU)',
          });
          return;
        }

        const takenByOther = (name) => this.players.some(
          (p, i) => p && !p.isBot && !p.isHost && i !== slotIndex && p.name === name
        );
        let finalName = baseName;
        if (takenByOther(finalName)) {
          for (let n = 2; n <= 9; n++) {
            const cand = `${baseName.slice(0, 10)}·${n}`;
            if (!takenByOther(cand)) { finalName = cand; break; }
          }
        }

        // Cihaz-başı karakter: renk oyuncuyla gelir; yoksa boş rastgele renk.
        // Reclaim'de mevcut avatar korunur.
        const takenColors = this.players
          .filter((p, i) => p && !p.isBot && !p.isHost && i !== slotIndex)
          .map((p) => p.color);
        const isReclaim = !!(this.players[slotIndex] && !this.players[slotIndex].isBot && !this.players[slotIndex].isHost);
        let cleanAvatar = null;
        if (msg.avatar && typeof msg.avatar === 'object') {
          try { cleanAvatar = sanitizeAvatar(msg.avatar, { keepColor: true }); } catch { cleanAvatar = null; }
        }
        if (!cleanAvatar && isReclaim && this.players[slotIndex].avatar) {
          cleanAvatar = this.players[slotIndex].avatar;
        }
        if (!cleanAvatar) {
          cleanAvatar = sanitizeAvatar({ color: pickFreeColor(takenColors) }, { keepColor: true });
        } else if (takenColors.map((c) => String(c).toUpperCase()).includes(cleanAvatar.color.toUpperCase())) {
          // Geçerli ama alınmış renk → boş rastgele renge çek (yüz/aksesuar korunur)
          cleanAvatar = { ...cleanAvatar, color: pickFreeColor(takenColors) };
        }
        const previousPlayer = this.players[slotIndex];
        if (previousPlayer && !previousPlayer.isHost && previousPlayer.id !== msg.senderId) {
          this.webrtcManager?.closePeer?.(previousPlayer.id);
        }

        const player = {
          id: msg.senderId,
          clientId: msg.clientId || null,
          name: finalName,
          color: cleanAvatar.color,
          avatar: cleanAvatar,
          slotIndex,
          lastSeen: now,
        };
        this.players[slotIndex] = player;
        this.ready[slotIndex] = false;

        this._broadcast('host_msg', {
          action: 'JOIN_SUCCESS',
          targetId: msg.senderId,
          hostId: this.myId,
          roomCode: this.roomCode,
          gameMode: this.gameMode,
          slotIndex,
          name: player.name,
          color: player.color,
          avatar: player.avatar,
          slots: this.getSlots(),
          reservedHostSlot: this._hostPlayerIndex() >= 0 ? this._hostPlayerIndex() : null,
          worldView: this.supportsWorldFrames,
        });

        if (this.callbacks.onPlayerJoined) {
          this.callbacks.onPlayerJoined({
            slotIndex, name: player.name, color: player.color, avatar: player.avatar,
          });
        }
        this.broadcastSlots();
        break;
      }

      case 'INPUT': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        if (!isValidNetworkInput(msg.data)) return;
        if (this.players[slot]) this.players[slot].lastSeen = performance.now();
        if (this.callbacks.onPlayerInput) {
          this.callbacks.onPlayerInput(slot, msg.data);
        }
        break;
      }

      case 'READY': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        if (this.players[slot]) this.players[slot].lastSeen = performance.now();
        this.ready[slot] = !!msg.isReady;
        if (this.callbacks.onPlayerReadyStatus) {
          this.callbacks.onPlayerReadyStatus(slot, !!msg.isReady);
        }
        this.broadcastSlots();
        break;
      }

      case 'REACTION': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1) return;
        if (this.players[slot]) this.players[slot].lastSeen = performance.now();
        if (this.callbacks.onPlayerReaction) {
          this.callbacks.onPlayerReaction(slot, msg.emoji);
        }
        break;
      }

      case 'LEAVE': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot === -1 || this.players[slot]?.isHost) return;
        const leftPlayer = this.players[slot];
        if (leftPlayer && !leftPlayer.isHost) {
          this.webrtcManager?.closePeer?.(leftPlayer.id);
        }
        this.players[slot] = null;
        this.ready[slot] = false;
        if (this.callbacks.onPlayerLeft) {
          this.callbacks.onPlayerLeft({ slotIndex: slot, name: leftPlayer?.name || 'OYUNCU' });
        }
        this.broadcastSlots();
        break;
      }

      case 'PONG_REPLY': {
        const slot = this._findSlotByPlayerId(msg.senderId);
        if (slot !== -1 && this.players[slot]) {
          this.players[slot].lastSeen = performance.now();
        }
        if (msg.targetId === this.myId && msg.timestamp) {
          this.ping = Math.round((performance.now() - msg.timestamp) / 2);
        }
        break;
      }

      default:
        break;
    }
  }

  _findSlotByPlayerId(playerId) {
    for (let i = 0; i < 4; i++) {
      if (this.players[i]?.id === playerId) return i;
    }
    return -1;
  }

  getSlots() {
    return this.players.map((p, idx) => {
      if (!p) return null;
      const entry = {
        slotIndex: idx,
        name: p.name,
        color: p.color,
        isReady: !!this.ready[idx],
        kind: p.isBot ? 'bot' : 'human',
        isHost: !!p.isHost,
      };
      if (!p.isBot && p.avatar) entry.avatar = p.avatar;
      return entry;
    });
  }

  // Host kaynaklı display-renk override (lobi hızlı palet/🎲): profil değişmez.
  setSlotColor(slotIndex, color) {
    if (this.role !== 'HOST') return;
    if (slotIndex < 0 || slotIndex > 3) return;
    const p = this.players[slotIndex];
    if (!p || p.isBot) return;
    if (!isPaletteHex(color)) return;
    const hex = String(color).toUpperCase();
    p.color = hex;
    const msg = { action: 'SLOT_CHANGED', targetId: p.id, slotIndex, color: hex };
    this._sendHostPayload(msg);
    this.broadcastSlots();
  }

  broadcastSlots() {
    if (this.role !== 'HOST') return;
    const payload = {
      action: 'SLOTS_UPDATE',
      slots: this.getSlots(),
      reservedHostSlot: this._hostPlayerIndex() >= 0 ? this._hostPlayerIndex() : null,
    };
    this._sendHostPayload(payload);
  }

  setPlayerName(slotIndex, name) {
    if (this.role !== 'HOST' || !this.players[slotIndex]) return;
    this.players[slotIndex].name = name;
    this.broadcastSlots();
  }

  // Host broadcasts game state: WebRTC for connected peers, targeted Supabase
  // fallback for every other player in the room.
  broadcastHostState(state) {
    if (this.role !== 'HOST') return;
    this._sendHostPayload({ action: 'STATE_SYNC', ...state });
  }

  // 30 Hz world frames are disposable full snapshots. They never fall back to
  // Supabase and never share the reliable control channel.
  broadcastWorldFrame(frame) {
    if (this.role !== 'HOST' || !this.supportsWorldFrames || !frame) return;
    this.webrtcManager?.broadcast?.(
      { action: 'WORLD_FRAME', hostId: this.myId, ...frame },
      'world'
    );
  }

  getHostPlayerState() {
    const slotIndex = this._hostPlayerIndex();
    if (slotIndex < 0) return { active: false, slotIndex: null, player: null };
    return {
      active: true,
      slotIndex,
      player: { ...this.players[slotIndex], isHost: true },
      isReady: !!this.ready[slotIndex],
    };
  }

  setHostPlayerActive(active, identity = {}) {
    if (this.role !== 'HOST') return false;
    const result = active
      ? this._installHostPlayer({ ...identity, asPlayer: true })
      : this._removeHostPlayer();
    if (!result.success) return false;

    const state = this.getHostPlayerState();
    if (this.callbacks.onHostPlayerState) this.callbacks.onHostPlayerState(state);
    this.broadcastSlots();
    return true;
  }

  setHostGameMode(gameMode) {
    if (this.role !== 'HOST') return;
    this.gameMode = gameMode;
    const payload = { action: 'GAME_MODE_CHANGED', gameMode };
    this._sendHostPayload(payload);
  }

  startGame(gameMode) {
    if (this.role !== 'HOST') return;
    if (gameMode) this.gameMode = gameMode;
    this.ready = [false, false, false, false];
    const payload = { action: 'GAME_STARTED', gameMode: this.gameMode };
    this._sendHostPayload(payload);
    this.broadcastSlots();
  }

  setSlotBot(slotIndex, name, kind = 'bot') {
    if (this.role !== 'HOST') return;
    if (slotIndex < 0 || slotIndex > 3 || this.players[slotIndex]) return;
    this.players[slotIndex] = {
      id: `bot-${slotIndex}`,
      name: (name || `BOT // P${slotIndex + 1}`).slice(0, 12),
      color: PLAYER_COLORS[slotIndex],
      slotIndex,
      isBot: true,
      kind: kind || 'bot',
    };
    this.ready[slotIndex] = false;
    this.broadcastSlots();
  }

  clearSlotBot(slotIndex) {
    if (this.role !== 'HOST') return;
    const p = this.players[slotIndex];
    if (!p || !p.isBot) return;
    this.players[slotIndex] = null;
    this.ready[slotIndex] = false;
    this.broadcastSlots();
  }

  startStaging(gameMode) {
    if (this.role !== 'HOST') return;
    if (gameMode) this.gameMode = gameMode;
    this._resetReadyFlags();
    const hostSlot = this._hostPlayerIndex();
    if (hostSlot >= 0) this.ready[hostSlot] = true;
    const payload = { action: 'STAGING_STARTED', gameMode: this.gameMode };
    this._sendHostPayload(payload);
    this.broadcastSlots();
  }

  broadcastCountdown(t) {
    if (this.role !== 'HOST') return;
    const payload = { action: 'COUNTDOWN', t, gameMode: this.gameMode };
    this._sendHostPayload(payload);
  }

  returnToLobby() {
    if (this.role !== 'HOST') return;
    this._resetReadyFlags();
    const hostSlot = this._hostPlayerIndex();
    if (hostSlot >= 0) this.ready[hostSlot] = true;
    const payload = { action: 'RETURNED_TO_LOBBY', gameMode: this.gameMode };
    this._sendHostPayload(payload);
    this.broadcastSlots();
  }

  swapSlots(slotA, slotB) {
    if (this.role !== 'HOST') return;
    if (slotA < 0 || slotA > 3 || slotB < 0 || slotB > 3 || slotA === slotB) return;
    if (this.players[slotA]?.isBot || this.players[slotB]?.isBot) return;
    if (this.players[slotA]?.isHost || this.players[slotB]?.isHost) return;

    const pA = this.players[slotA];
    const pB = this.players[slotB];
    this.players[slotA] = pB;
    this.players[slotB] = pA;

    const readyA = this.ready[slotA];
    this.ready[slotA] = this.ready[slotB];
    this.ready[slotB] = readyA;

    // Renk oyuncuyla taşınır: takasta renk/avatar değişmez, sadece koltuk no güncellenir.
    if (pA) {
      pA.slotIndex = slotB;
      const p = { action: 'SLOT_CHANGED', targetId: pA.id, slotIndex: slotB, color: pA.color };
      this._sendHostPayload(p);
    }
    if (pB) {
      pB.slotIndex = slotA;
      const p = { action: 'SLOT_CHANGED', targetId: pB.id, slotIndex: slotA, color: pB.color };
      this._sendHostPayload(p);
    }

    if (this.callbacks.onSlotsSwapped) {
      this.callbacks.onSlotsSwapped(slotA, slotB);
    }
    this.broadcastSlots();
  }

  rotateSeats() {
    if (this.role !== 'HOST') return;
    if (this.players.some((player) => player?.isHost)) return;
    const order = Array(2, 3, 1, 0);
    const old = this.players.slice(0, 4);
    if (old.some((p) => p?.isBot)) return;
    const oldReady = [...this.ready];
    for (let i = 0; i < 4; i++) {
      const p = old[order[i]];
      this.players[i] = p || null;
      this.ready[i] = oldReady[order[i]];
      if (p) {
        p.slotIndex = i;
        const pl = { action: 'SLOT_CHANGED', targetId: p.id, slotIndex: i, color: p.color };
        this._sendHostPayload(pl);
      }
    }
    this.broadcastSlots();
  }

  // ━━━━━━━━━━━━━━━━━━━ CONTROLLER API ━━━━━━━━━━━━━━━━━━━

  async joinRoom(roomCode, playerName, callbacks = {}, avatar = null, _isRetry = false) {
    assertSupabaseConfig();
    this.role = 'CONTROLLER';
    this.roomCode = roomCode.toUpperCase().trim();
    this.playerName = cleanPlayerName(playerName);
    this.callbacks = { ...this.callbacks, ...callbacks };
    if (!_isRetry) {
      this._manualClose = false;
      this._reconnectTries = 0;
      this._joinAttempts = 0;
      if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
      this._lastJoin = { roomCode: this.roomCode, playerName: this.playerName, avatar };
    } else if (avatar && this._lastJoin) {
      this._lastJoin.avatar = avatar;
    }

    this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 30 } },
    });

    const channelName = `brutal-party-${this.roomCode}`;
    this.channel = this.supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    // Listen for host messages
    this.channel.on('broadcast', { event: 'host_msg' }, ({ payload }) => {
      if (!payload) return;
      this._controllerHandleMessage(payload);
    });

    try {
      await new Promise((resolve, reject) => {
        const failTimer = setTimeout(() => {
          reject(new Error(t('net.relayTimeout')));
        }, 10000);
        this.channel.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(failTimer);
            console.log(`[SupabaseRelay] CONTROLLER subscribed to ${channelName}`);
            this._seenHosts = new Map();
            this.hostId = null;
            this._announceWait = setTimeout(() => this._sendLockedJoin(), 1500);
            resolve();
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            clearTimeout(failTimer);
            console.error('[SupabaseRelay] CONTROLLER subscribe failed:', status, err?.message || '');
            reject(new Error(t('net.relayStatus', status)));
          }
        });
      });
    } catch (err) {
      try { this.supabase?.removeChannel(this.channel); } catch { /* sessiz */ }
      this.channel = null;
      throw err;
    }

    this._startPingHeartbeat();
  }

  _sendLockedJoin() {
    this._announceWait = null;
    if (this._manualClose || this._joinedOnce || !this._lastJoin) return;

    const now = performance.now();
    const fresh = [...(this._seenHosts || [])]
      .filter(([, at]) => now - at < 10000)
      .map(([id]) => id);
    if (fresh.length >= 2) {
      if (this.callbacks.onError) {
        this.callbacks.onError(t('net.roomClash'));
      }
      this.disconnect();
      return;
    }
    if (fresh.length === 1) {
      this.hostId = fresh[0];
    }

    let joinAvatar = this._lastJoin.avatar || null;
    if (!joinAvatar) {
      try { joinAvatar = getAvatarProfile(); } catch { joinAvatar = null; }
    }
    const joinPayload = { action: 'JOIN', name: this.playerName, clientId: getClientId(), avatar: joinAvatar };
    if (this.hostId) joinPayload.hostId = this.hostId;
    this._joinAttempts += 1;
    this._broadcast('player_msg', joinPayload);

    if (this._joinTimeout) clearTimeout(this._joinTimeout);
    this._joinTimeout = setTimeout(() => {
      if (this._joinedOnce) return;
      if (this._joinAttempts < 5) {
        this._sendLockedJoin();
        return;
      }
      if (this.callbacks.onError) {
        this.callbacks.onError(t('net.roomMissing'));
      }
    }, 2500);
  }

  _controllerHandleMessage(msg) {
    if (!msg || (msg.targetId && msg.targetId !== this.myId)) return;
    this._lastHostMsgAt = performance.now();

    switch (msg.action) {
      case 'WEBRTC_SIGNAL': {
        if (
          msg.targetId === this.myId
          && msg.senderId === this.hostId
          && this.webrtcManager
        ) {
          this.webrtcManager.handleSignal(msg.senderId, msg.signal);
        }
        break;
      }

      case 'HOST_ANNOUNCE': {
        if (msg.hostId) {
          if (!this._seenHosts) this._seenHosts = new Map();
          this._seenHosts.set(msg.hostId, performance.now());
          // Host may subscribe after the controller's first join attempt.
          // Retry immediately when a fresh announcement arrives.
          if (!this._joinedOnce && this._lastJoin && this._joinAttempts < 5) {
            if (this._announceWait) {
              clearTimeout(this._announceWait);
              this._announceWait = null;
            }
            this._sendLockedJoin();
          }
        }
        break;
      }

      case 'JOIN_SUCCESS': {
        if (msg.hostId && this.hostId && msg.hostId !== this.hostId) break;
        if (this._announceWait) { clearTimeout(this._announceWait); this._announceWait = null; }
        if (this._joinTimeout) { clearTimeout(this._joinTimeout); this._joinTimeout = null; }
        this._joinedOnce = true;
        this._joinAttempts = 0;
        this._reconnectTries = 0;
        if (this._reconnectTimer) {
          clearTimeout(this._reconnectTimer);
          this._reconnectTimer = null;
        }
        const hasWorldView = msg.worldView !== false;
        this.supportsWorldFrames = hasWorldView;
        this.reservedHostSlot = Object.prototype.hasOwnProperty.call(msg, 'reservedHostSlot')
          ? (Number.isInteger(msg.reservedHostSlot) ? msg.reservedHostSlot : null)
          : (hasWorldView ? 0 : null);
        this.playerIndex = msg.slotIndex;
        this.playerName = msg.name;
        this.color = msg.color;
        this.hostId = msg.hostId || this.hostId;
        this._lastHostMsgAt = performance.now();
        this._webrtcRetryDelay = 1000;
        this._clearWebRtcTimers();
        this._startHostWatchdog();

        // Odaya katılım başarılı olunca Host'a WebRTC DataChannel el sıkışması başlat
        this._initControllerWebRTC();

        if (this.callbacks.onConnectionRestored) this.callbacks.onConnectionRestored();
        if (this.callbacks.onJoinedSuccess) {
          this.callbacks.onJoinedSuccess(msg);
        }
        break;
      }

      case 'JOIN_ERROR': {
        clearTimeout(this._joinTimeout);
        if (this.callbacks.onError) {
          this.callbacks.onError(msg.error);
        }
        break;
      }

      case 'STATE_SYNC': {
        if (this.callbacks.onGameState) {
          this.callbacks.onGameState(msg);
        }
        break;
      }

      case 'WORLD_FRAME': {
        if (this.callbacks.onWorldFrame) {
          this.callbacks.onWorldFrame(msg);
        }
        break;
      }

      case 'GAME_MODE_CHANGED': {
        if (this.callbacks.onGameModeChanged) {
          this.callbacks.onGameModeChanged(msg.gameMode);
        }
        break;
      }

      case 'GAME_STARTED': {
        if (this.callbacks.onGameStarted) {
          this.callbacks.onGameStarted(msg.gameMode);
        }
        break;
      }

      case 'STAGING_STARTED': {
        if (this.callbacks.onStagingStarted) {
          this.callbacks.onStagingStarted(msg.gameMode);
        }
        break;
      }

      case 'COUNTDOWN': {
        if (this.callbacks.onCountdown) {
          this.callbacks.onCountdown(msg.t, msg.gameMode);
        }
        break;
      }

      case 'RETURNED_TO_LOBBY': {
        if (this.callbacks.onReturnedToLobby) {
          this.callbacks.onReturnedToLobby(msg.gameMode);
        }
        break;
      }

      case 'SLOT_CHANGED': {
        this.playerIndex = msg.slotIndex;
        this.color = msg.color;
        if (this.callbacks.onSlotChanged) {
          this.callbacks.onSlotChanged(msg.slotIndex, msg.color);
        }
        break;
      }

      case 'SLOTS_UPDATE': {
        if (Object.prototype.hasOwnProperty.call(msg, 'reservedHostSlot')) {
          this.reservedHostSlot = Number.isInteger(msg.reservedHostSlot) ? msg.reservedHostSlot : null;
        }
        if (this.callbacks.onSlotsUpdate) {
          this.callbacks.onSlotsUpdate(msg.slots, this.reservedHostSlot);
        }
        break;
      }

      case 'HOST_DISCONNECTED': {
        if (this.callbacks.onHostDisconnected) {
          this.callbacks.onHostDisconnected(msg.message || t('net.hostLeft'));
        }
        break;
      }

      case 'PING_REQ': {
        const reply = {
          action: 'PONG_REPLY',
          targetId: msg.senderId,
          timestamp: msg.timestamp,
        };
        if (!this._sendControllerPayload(reply)) {
          this._broadcast('player_msg', reply);
        }
        break;
      }

      default:
        break;
    }
  }

  _clearWebRtcTimers() {
    if (this._webrtcRetryTimer) {
      clearTimeout(this._webrtcRetryTimer);
      this._webrtcRetryTimer = null;
    }
    if (this._webrtcConnectTimer) {
      clearTimeout(this._webrtcConnectTimer);
      this._webrtcConnectTimer = null;
    }
  }

  _scheduleWebRtcRetry() {
    if (
      this.role !== 'CONTROLLER'
      || !this._joinedOnce
      || !this.hostId
      || this._manualClose
      || this._webrtcRetryTimer
    ) return;

    const delay = this._webrtcRetryDelay;
    this._webrtcRetryDelay = Math.min(8000, this._webrtcRetryDelay * 2);
    this._webrtcRetryTimer = setTimeout(() => {
      this._webrtcRetryTimer = null;
      if (!this._manualClose && this._joinedOnce) this._initControllerWebRTC();
    }, delay);
  }

  _initControllerWebRTC() {
    if (!this.hostId) return;
    const generation = ++this._webrtcGeneration;
    if (this.webrtcManager) {
      this.webrtcManager.destroy();
    }
    this._clearWebRtcTimers();

    this.webrtcManager = new WebRTCManager({
      isHost: false,
      sendSignal: (targetId, signal) => {
        this._broadcast('player_msg', {
          action: 'WEBRTC_SIGNAL',
          targetId: this.hostId,
          signal,
        });
      },
      onMessage: (peerId, data) => {
        if (generation !== this._webrtcGeneration || peerId !== this.hostId) return;
        this._controllerHandleMessage(data);
      },
      onStatusChange: (peerId, status, channel) => {
        if (generation !== this._webrtcGeneration || peerId !== this.hostId) return;
        if (channel === 'control') {
          this._webRtcAvailable = (status === 'connected');
          if (status === 'connected') {
            this._webrtcRetryDelay = 1000;
            this._clearWebRtcTimers();
          } else if (status === 'disconnected') {
            this._scheduleWebRtcRetry();
          }
        } else if (status === 'disconnected') {
          if (!this.webrtcManager?.hasActiveConnection(this.hostId, 'control')) {
            this._scheduleWebRtcRetry();
          }
        }
        console.log(`[SupabaseRelay] Controller WebRTC ${channel}: ${status}`);
      },
    });

    this.webrtcManager.connectToHost(this.hostId);
    this._webrtcConnectTimer = setTimeout(() => {
      this._webrtcConnectTimer = null;
      if (!this.webrtcManager?.hasActiveConnection(this.hostId, 'control')) {
        this._scheduleWebRtcRetry();
      }
    }, 12000);
  }

  sendInput(data) {
    if (this.role !== 'CONTROLLER') return;
    const isCurveSteerChange = data.action === 'CURVE_STEER' && data.dir !== this._lastCurveDir;
    const isDiscrete =
      (data.action !== 'JOYSTICK_MOVE' &&
        data.action !== 'PADDLE_MOVE') ||
      isCurveSteerChange ||
      data.force === 0 ||
      data.dir === 0;

    const now = performance.now();
    if (!isDiscrete) {
      if (now - (this._lastInputSent || 0) < 50) return;
      if (data.action === 'PADDLE_MOVE' && typeof data.position === 'number') {
        if (Math.abs(data.position - (this._lastPaddlePos ?? -1)) < 0.003) return;
        this._lastPaddlePos = data.position;
      } else if (data.action === 'JOYSTICK_MOVE') {
        const dx = data.dx || 0;
        const dy = data.dy || 0;
        const ldx = this._lastJoy?.dx || 0;
        const ldy = this._lastJoy?.dy || 0;
        if (Math.hypot(dx - ldx, dy - ldy) < 0.02) return;
        this._lastJoy = { dx, dy };
      }
    }

    if (data.action === 'CURVE_STEER') {
      this._lastCurveDir = data.dir;
    }

    if (!isDiscrete) this._lastInputSent = now;

    const payload = { action: 'INPUT', data };

    // WebRTC DataChannel açıksa Supabase'e hiç uğramadan gönder; gönderim
    // başarısız olursa aynı paketi Supabase fallback ile tekrar dene.
    if (this._sendControllerPayload(payload)) return;

    if (this.channel) {
      this._broadcast('player_msg', payload);
    }
  }

  notePlayerName(name) {
    if (name) this.playerName = cleanPlayerName(name);
  }

  // Kumanda kendi karakterini host'a bildirir (INPUT tüneli).
  sendAvatarUpdate(avatar) {
    if (this.role !== 'CONTROLLER') return;
    if (this._lastJoin) this._lastJoin.avatar = avatar;
    const payload = { action: 'INPUT', data: { action: 'AVATAR_UPDATE', avatar } };
    if (this._sendControllerPayload(payload)) return;
    if (this.channel) {
      this._broadcast('player_msg', payload);
    }
  }

  sendReaction(emoji) {
    const payload = { action: 'REACTION', emoji };
    if (this._sendControllerPayload(payload)) return;
    if (this.channel) {
      this._broadcast('player_msg', payload);
    }
  }

  setReady(isReady) {
    const payload = { action: 'READY', isReady };
    if (this._sendControllerPayload(payload)) return;
    if (this.channel) {
      this._broadcast('player_msg', payload);
    }
  }

  // ━━━━━━━━━━━━━━━━━━━ SHARED ━━━━━━━━━━━━━━━━━━━

  _broadcast(event, payload) {
    if (!this.channel) return;
    this.channel.send({
      type: 'broadcast',
      event,
      payload: { ...payload, senderId: this.myId },
    });
  }

  _generateRoomCode() {
    return String(Math.floor(100 + Math.random() * 900));
  }

  _startPingHeartbeat() {
    this._stopPingHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.role === 'HOST') {
        this._broadcast('host_msg', {
          action: 'PING_REQ',
          timestamp: performance.now(),
        });
      }
    }, 15000);
  }

  _stopPingHeartbeat() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _startHostWatchdog() {
    this._stopHostWatchdog();
    this._hostWatchdog = setInterval(() => {
      if (this.role !== 'CONTROLLER') return;
      if (this.playerIndex === null || this.playerIndex === undefined) return;
      if (performance.now() - this._lastHostMsgAt < 30000) return;
      this._stopHostWatchdog();
      if (this.callbacks.onHostDisconnected) {
        this.callbacks.onHostDisconnected(t('net.hostGoneRetry'));
      }
      const lastJoin = this._lastJoin;
      const wasJoined = this._joinedOnce;
      this.disconnect();
      if (wasJoined && lastJoin) {
        this._manualClose = false;
        this._lastJoin = lastJoin;
        this._scheduleRelayReconnect();
      }
    }, 5000);
  }

  _scheduleRelayReconnect() {
    if (this._manualClose || !this._lastJoin) return;
    if ((this._reconnectTries || 0) >= 5) {
      this._lastJoin = null;
      if (this.callbacks.onError) this.callbacks.onError(t('net.retryFail'));
      return;
    }
    const delay = Math.min(8000, 1000 * 2 ** (this._reconnectTries || 0));
    this._reconnectTries = (this._reconnectTries || 0) + 1;
    if (this.callbacks.onError) this.callbacks.onError(t('net.retrying', this._reconnectTries));
    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      if (this._manualClose || !this._lastJoin) return;
      try {
        await this.joinRoom(this._lastJoin.roomCode, this._lastJoin.playerName, {}, this._lastJoin.avatar || null, true);
      } catch {
        this._scheduleRelayReconnect();
      }
    }, delay);
  }

  _stopHostWatchdog() {
    if (this._hostWatchdog) {
      clearInterval(this._hostWatchdog);
      this._hostWatchdog = null;
    }
  }

  disconnect() {
    this._manualClose = true;
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
    this._lastJoin = null;
    this._joinedOnce = false;
    this._reconnectTries = 0;
    this._joinAttempts = 0;
    this._stopPingHeartbeat();
    this._stopHostWatchdog();
    this._stopHostAnnounce();
    this._clearWebRtcTimers();
    if (this._joinTimeout) {
      clearTimeout(this._joinTimeout);
      this._joinTimeout = null;
    }
    if (this._announceWait) {
      clearTimeout(this._announceWait);
      this._announceWait = null;
    }
    this._seenHosts = null;

    this._webrtcGeneration += 1;
    if (this.webrtcManager) {
      this.webrtcManager.destroy();
      this.webrtcManager = null;
    }
    this._webRtcAvailable = false;

    if (this.role === 'CONTROLLER') {
      this._broadcast('player_msg', { action: 'LEAVE' });
    } else if (this.role === 'HOST') {
      this._broadcast('host_msg', {
        action: 'HOST_DISCONNECTED',
        message: t('net.hostLeft'),
      });
    }

    if (this.channel) {
      this.supabase?.removeChannel(this.channel);
      this.channel = null;
    }
    if (this.supabase) {
      this.supabase = null;
    }

    this.role = null;
    this.roomCode = null;
    this.hostId = null;
    this.playerIndex = null;
    this.supportsWorldFrames = false;
    this.reservedHostSlot = null;
    this.hostPlayerActive = false;
    this.hostPlayerSlot = null;
    this.players = [null, null, null, null];
    this.ready = [false, false, false, false];
  }
}

export const supabaseRelay = new SupabaseRelay();