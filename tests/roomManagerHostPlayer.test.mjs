import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from '../server/roomManager.js';

function fakeSocket() {
  return {
    readyState: 1,
    messages: [],
    send(raw) {
      this.messages.push(JSON.parse(raw));
    },
  };
}

test('TV host can join the first empty seat and move after joining', () => {
  const manager = new RoomManager();
  const host = fakeSocket();
  const room = manager.createRoom(host, 'PONG', { asPlayer: false, name: 'HOST' });
  const phone = fakeSocket();
  const phoneJoin = manager.joinRoom(room.code, phone, 'PHONE', 'phone-1', { color: '#1D5D8A' });
  assert.equal(phoneJoin.success, true);
  assert.equal(phoneJoin.slotIndex, 0);

  assert.equal(manager.getReservedHostSlot(room), null);
  const joined = manager.handleSetHostPlayer(host, true, { name: 'HOST', slotIndex: 1 });
  assert.equal(joined.success, true);
  assert.equal(manager.getReservedHostSlot(room), 1);
  assert.equal(manager.getSlots(room)[1].isHost, true);
  assert.equal(manager.getSlots(room)[1].isReady, true);

  manager.handleSwapSlots(host, 1, 2);
  assert.equal(manager.getReservedHostSlot(room), 2, 'host seat remains swappable after joining');

  const left = manager.handleSetHostPlayer(host, false);
  assert.equal(left.success, true);
  assert.equal(manager.getReservedHostSlot(room), null);
});

test('online-style host identity starts in P1 when requested', () => {
  const manager = new RoomManager();
  const host = fakeSocket();
  const room = manager.createRoom(host, 'PONG', { asPlayer: true, name: 'P1 HOST' });

  assert.equal(manager.getReservedHostSlot(room), 0);
  assert.equal(manager.getSlots(room)[0].name, 'P1 HOST');
  assert.equal(manager.getHostPlayerState(room).active, true);
});
