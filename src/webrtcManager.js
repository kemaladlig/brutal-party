// src/webrtcManager.js

const MAX_BUFFERED_AMOUNT = 64 * 1024;

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class WebRTCManager {
  constructor({ isHost, onMessage, onStatusChange, sendSignal }) {
    this.isHost = isHost;
    this.onMessage = onMessage; // (peerId, data) => void
    this.onStatusChange = onStatusChange; // (peerId, status) => void
    this.sendSignal = sendSignal; // (targetId, signalData) => void

    // Host için: controllerId -> { pc, dc }
    // Controller için: hostId -> { pc, dc }
    this.peers = new Map();
  }

  // --- CONTROLLER Tarafı: Host'a WebRTC bağlantısı başlatır ---
  async connectToHost(hostId) {
    if (!hostId) return;
    this._cleanupPeer(hostId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const dc = pc.createDataChannel('gameData', { ordered: true });

    this.peers.set(hostId, { pc, dc, pendingCandidates: [] });
    this._setupDataChannel(hostId, dc);
    this._setupPeerConnection(hostId, pc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(hostId, { type: 'offer', sdp: offer });
    } catch (err) {
      console.warn('[WebRTC] Offer oluşturulamadı:', err);
    }
  }

  // --- Ortak: Supabase üzerinden gelen sinyalleri işler ---
  async handleSignal(senderId, signal) {
    if (!signal || !senderId) return;

    if (signal.type === 'offer') {
      // HOST Tarafı: Controller'dan offer geldi
      let peer = this.peers.get(senderId);
      if (!peer) {
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peer = { pc, dc: null, pendingCandidates: [] };
        this.peers.set(senderId, peer);

        pc.ondatachannel = (event) => {
          peer.dc = event.channel;
          this._setupDataChannel(senderId, event.channel);
        };

        this._setupPeerConnection(senderId, pc);
      }

      try {
        await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        await this._flushPendingCandidates(senderId, peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.sendSignal(senderId, { type: 'answer', sdp: answer });
      } catch (err) {
        console.warn('[WebRTC] Offer işlenemedi / Answer oluşturulamadı:', err);
      }

    } else if (signal.type === 'answer') {
      // CONTROLLER Tarafı: Host'tan cevap geldi
      const peer = this.peers.get(senderId);
      if (peer && peer.pc) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await this._flushPendingCandidates(senderId, peer);
        } catch (err) {
          console.warn('[WebRTC] RemoteDescription (answer) ayarlanamadı:', err);
        }
      }

    } else if (signal.type === 'candidate') {
      // ICE Candidate (Ağ rotası) geldi
      const peer = this.peers.get(senderId);
      if (peer && peer.pc && signal.candidate) {
        if (peer.pc.remoteDescription) {
          try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.warn('[WebRTC] ICE adayı eklenemedi:', err);
          }
        } else {
          // Sinyal sırası korunmasa bile adayı remote description sonrasına sakla.
          peer.pendingCandidates = peer.pendingCandidates || [];
          peer.pendingCandidates.push(signal.candidate);
        }
      }
    }
  }

  async _flushPendingCandidates(peerId, peer) {
    if (!peer?.pc || !peer.pendingCandidates?.length) return;
    const candidates = peer.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn(`[WebRTC] ${peerId} bekleyen ICE adayı eklenemedi:`, err);
      }
    }
  }

  // --- Veri Gönderim Metodları ---
  sendTo(peerId, data) {
    const peer = this.peers.get(peerId);
    if (
      peer
      && peer.dc
      && peer.dc.readyState === 'open'
      && (peer.dc.bufferedAmount || 0) <= MAX_BUFFERED_AMOUNT
    ) {
      try {
        peer.dc.send(typeof data === 'string' ? data : JSON.stringify(data));
        return true;
      } catch (err) {
        console.warn(`[WebRTC] ${peerId} gönderimi başarısız:`, err);
      }
    }
    return false;
  }

  broadcast(data) {
    let sentCount = 0;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const peerId of this.peers.keys()) {
      if (this.sendTo(peerId, payload)) sentCount++;
    }
    return sentCount > 0;
  }

  getOpenPeerIds() {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer.dc?.readyState === 'open')
      .map(([peerId]) => peerId);
  }

  hasActiveConnection(peerId) {
    const peer = this.peers.get(peerId);
    return !!(peer && peer.dc && peer.dc.readyState === 'open');
  }

  hasAnyConnection() {
    for (const [_, peer] of this.peers.entries()) {
      if (peer.dc && peer.dc.readyState === 'open') return true;
    }
    return false;
  }

  // --- İç Yapılandırıcılar ---
  _setupPeerConnection(peerId, pc) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.onStatusChange?.(peerId, 'disconnected');
        this._cleanupPeer(peerId);
      }
    };
  }

  _setupDataChannel(peerId, dc) {
    dc.onopen = () => {
      console.log(`%c[WebRTC] DataChannel BAĞLANDI! (Peer: ${peerId})`, 'color: #10B981; font-weight: bold;');
      this.onStatusChange?.(peerId, 'connected');
    };

    dc.onclose = () => {
      console.log(`[WebRTC] DataChannel kapandı (Peer: ${peerId})`);
      this.onStatusChange?.(peerId, 'disconnected');
    };

    dc.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.onMessage?.(peerId, parsed);
      } catch {
        this.onMessage?.(peerId, event.data);
      }
    };
  }

  _cleanupPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer) {
      try { peer.dc?.close(); } catch {}
      try { peer.pc?.close(); } catch {}
      this.peers.delete(peerId);
    }
  }

  destroy() {
    for (const [peerId] of this.peers) {
      this._cleanupPeer(peerId);
    }
    this.peers.clear();
  }
}