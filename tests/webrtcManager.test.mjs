import test from 'node:test';
import assert from 'node:assert/strict';
import { WebRTCManager } from '../src/webrtcManager.js';

class FakeDataChannel {
  constructor(label, options) {
    this.label = label;
    this.options = options;
    this.readyState = 'connecting';
    this.bufferedAmount = 0;
    this.sent = [];
  }

  send(value) {
    this.sent.push(value);
  }

  close() {
    this.readyState = 'closed';
  }
}

class FakePeerConnection {
  static instances = [];

  constructor() {
    this.remoteDescription = null;
    this.channels = [];
    this.addedCandidates = [];
    FakePeerConnection.instances.push(this);
  }

  createDataChannel(label, options) {
    const channel = new FakeDataChannel(label, options);
    this.channels.push(channel);
    return channel;
  }

  async createOffer() {
    return { type: 'offer', sdp: 'offer-sdp' };
  }

  async createAnswer() {
    return { type: 'answer', sdp: 'answer-sdp' };
  }

  async setLocalDescription() {}
  async setRemoteDescription(description) {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate) {
    this.addedCandidates.push(candidate);
  }

  close() {}
}

class FakeSessionDescription {
  constructor(init) {
    Object.assign(this, init);
  }
}

class FakeIceCandidate {
  constructor(init) {
    Object.assign(this, init);
  }
}

globalThis.RTCPeerConnection = FakePeerConnection;
globalThis.RTCSessionDescription = FakeSessionDescription;
globalThis.RTCIceCandidate = FakeIceCandidate;

test('controller creates reliable control and unreliable world channels', async () => {
  const signals = [];
  const manager = new WebRTCManager({
    isHost: false,
    sendSignal: (_peerId, signal) => signals.push(signal),
    onMessage: () => {},
    onStatusChange: () => {},
  });

  await manager.connectToHost('host-1');
  const peer = manager.peers.get('host-1');

  assert.deepEqual(peer.control.options, { ordered: true });
  assert.deepEqual(peer.world.options, { ordered: false, maxRetransmits: 0 });
  assert.equal(signals[0].type, 'offer');

  peer.control.readyState = 'open';
  peer.world.readyState = 'open';
  assert.equal(manager.sendTo('host-1', { action: 'INPUT' }, 'control'), true);
  assert.equal(manager.sendTo('host-1', { action: 'WORLD_FRAME' }, 'world'), true);
  assert.equal(peer.control.sent.length, 1);
  assert.equal(peer.world.sent.length, 1);
});

test('host queues ICE candidates that arrive before the offer', async () => {
  const signals = [];
  const manager = new WebRTCManager({
    isHost: true,
    sendSignal: (_peerId, signal) => signals.push(signal),
    onMessage: () => {},
    onStatusChange: () => {},
  });

  const candidate = { candidate: 'candidate:fake', sdpMid: '0' };
  await manager.handleSignal('player-1', { type: 'candidate', candidate });
  assert.equal(manager.peers.has('player-1'), false);

  await manager.handleSignal('player-1', {
    type: 'offer',
    sdp: { type: 'offer', sdp: 'remote-offer' },
  });

  const peer = manager.peers.get('player-1');
  assert.equal(peer.pc.addedCandidates[0].candidate, candidate.candidate);
  assert.equal(peer.pc.addedCandidates[0].sdpMid, candidate.sdpMid);
  assert.equal(signals.at(-1).type, 'answer');
});
