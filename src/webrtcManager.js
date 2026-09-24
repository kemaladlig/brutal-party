// src/webrtcManager.js

const MAX_BUFFERED_AMOUNT = 64 * 1024;
const CONTROL_CHANNEL = 'control';
const WORLD_CHANNEL = 'world';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export class WebRTCManager {
  constructor({ isHost, onMessage, onStatusChange, sendSignal }) {
    this.isHost = isHost;
    this.onMessage = onMessage; // (peerId, data, channel) => void
    this.onStatusChange = onStatusChange; // (peerId, status, channel) => void
    this.sendSignal = sendSignal; // (targetId, signalData) => void

    // Host için: controllerId -> { pc, control, world, pendingCandidates }
    // Controller için: hostId -> aynı kayıt yapısı
    this.peers = new Map();
    this.orphanCandidates = new Map();
  }

  async connectToHost(hostId) {
    if (!hostId) return;
    this._cleanupPeer(hostId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    const control = pc.createDataChannel(CONTROL_CHANNEL, { ordered: true });
    const world = pc.createDataChannel(WORLD_CHANNEL, { ordered: false, maxRetransmits: 0 });

    this.peers.set(hostId, { pc, control, world, pendingCandidates: [] });
    this._setupDataChannel(hostId, control);
    this._setupDataChannel(hostId, world);
    this._setupPeerConnection(hostId, pc);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(hostId, { type: 'offer', sdp: offer });
    } catch (err) {
      console.warn('[WebRTC] Offer oluşturulamadı:', err);
    }
  }

  async handleSignal(senderId, signal) {
    if (!signal || !senderId) return;

    if (signal.type === 'offer') {
      let peer = this.peers.get(senderId);
      const orphaned = this.orphanCandidates.get(senderId) || [];
      if (peer && ['failed', 'disconnected', 'closed'].includes(peer.pc.connectionState)) {
        this._cleanupPeer(senderId);
        peer = null;
      }
      if (!peer) {
        const pc = new RTCPeerConnection(ICE_SERVERS);
        peer = { pc, control: null, world: null, pendingCandidates: [...orphaned] };
        this.orphanCandidates.delete(senderId);
        this.peers.set(senderId, peer);

        pc.ondatachannel = (event) => {
          const channel = event.channel;
          if (channel.label === WORLD_CHANNEL) peer.world = channel;
          else peer.control = channel;
          this._setupDataChannel(senderId, channel);
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
      const peer = this.peers.get(senderId);
      if (peer?.pc) {
        try {
          await peer.pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          await this._flushPendingCandidates(senderId, peer);
        } catch (err) {
          console.warn('[WebRTC] RemoteDescription (answer) ayarlanamadı:', err);
        }
      }
    } else if (signal.type === 'candidate') {
      const peer = this.peers.get(senderId);
      const peerUnavailable = !peer || ['failed', 'disconnected', 'closed'].includes(peer.pc?.connectionState);
      if (signal.candidate && peerUnavailable) {
        const pending = this.orphanCandidates.get(senderId) || [];
        if (pending.length < 64) pending.push(signal.candidate);
        this.orphanCandidates.set(senderId, pending);
        return;
      }
      if (peer?.pc && signal.candidate) {
        if (peer.pc.remoteDescription) {
          try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.warn('[WebRTC] ICE adayı eklenemedi:', err);
          }
        } else {
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

  sendTo(peerId, data, channelName = CONTROL_CHANNEL) {
    const peer = this.peers.get(peerId);
    const channel = peer?.[channelName];
    if (
      channel
      && channel.readyState === 'open'
      && (channel.bufferedAmount || 0) <= MAX_BUFFERED_AMOUNT
    ) {
      try {
        channel.send(typeof data === 'string' ? data : JSON.stringify(data));
        return true;
      } catch (err) {
        console.warn(`[WebRTC] ${peerId}/${channelName} gönderimi başarısız:`, err);
      }
    }
    return false;
  }

  broadcast(data, channelName = CONTROL_CHANNEL) {
    let sentCount = 0;
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    for (const peerId of this.peers.keys()) {
      if (this.sendTo(peerId, payload, channelName)) sentCount += 1;
    }
    return sentCount > 0;
  }

  getOpenPeerIds(channelName = CONTROL_CHANNEL) {
    return [...this.peers.entries()]
      .filter(([, peer]) => peer[channelName]?.readyState === 'open')
      .map(([peerId]) => peerId);
  }

  hasActiveConnection(peerId, channelName = CONTROL_CHANNEL) {
    const peer = this.peers.get(peerId);
    return !!(peer?.[channelName]?.readyState === 'open');
  }

  hasAnyConnection(channelName = CONTROL_CHANNEL) {
    for (const peer of this.peers.values()) {
      if (peer[channelName]?.readyState === 'open') return true;
    }
    return false;
  }

  closePeer(peerId) {
    this._cleanupPeer(peerId);
  }

  _setupPeerConnection(peerId, pc) {
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal(peerId, { type: 'candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.onStatusChange?.(peerId, 'disconnected', CONTROL_CHANNEL);
        this._cleanupPeer(peerId);
      } else if (pc.connectionState === 'disconnected') {
        this.onStatusChange?.(peerId, 'disconnected', CONTROL_CHANNEL);
      }
    };
  }

  _setupDataChannel(peerId, channel) {
    channel.onopen = () => {
      console.log(`%c[WebRTC] ${channel.label} BAĞLANDI! (Peer: ${peerId})`, 'color: #10B981; font-weight: bold;');
      this.onStatusChange?.(peerId, 'connected', channel.label);
    };

    channel.onclose = () => {
      console.log(`[WebRTC] ${channel.label} kapandı (Peer: ${peerId})`);
      this.onStatusChange?.(peerId, 'disconnected', channel.label);
    };

    channel.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        this.onMessage?.(peerId, parsed, channel.label);
      } catch {
        this.onMessage?.(peerId, event.data, channel.label);
      }
    };
  }

  _cleanupPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    for (const channel of [peer.control, peer.world]) {
      if (!channel) continue;
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
    }
    if (peer.pc) {
      peer.pc.onicecandidate = null;
      peer.pc.onconnectionstatechange = null;
      peer.pc.ondatachannel = null;
    }
    try { peer.control?.close(); } catch {}
    try { peer.world?.close(); } catch {}
    try { peer.pc?.close(); } catch {}
    this.peers.delete(peerId);
    this.orphanCandidates.delete(peerId);
  }

  destroy() {
    for (const [peerId] of this.peers) {
      this._cleanupPeer(peerId);
    }
    this.peers.clear();
    this.orphanCandidates.clear();
  }
}

export { CONTROL_CHANNEL, WORLD_CHANNEL };
