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

test('TV host can optionally occupy P1 and releases it again', () => {
  const manager = new RoomManager();
  const host = fakeSocket();
  const room = manager.createRoom(host, 'PONG', { asPlayer: false, name: 'HOST' });

  assert.equal(manager.getReservedHostSlot(room), null);
  const joined = manager.handleSetHostPlayer(host, true, { name: 'HOST' });
  assert.equal(joined.success, true);
  assert.equal(manager.getReservedHostSlot(room), 0);
  assert.equal(manager.getSlots(room)[0].isHost, true);
  assert.equal(manager.getSlots(room)[0].isReady, true);

  const phone = fakeSocket();
  const phoneJoin = manager.joinRoom(room.code, phone, 'PHONE', 'phone-1', { color: '#1D5D8A' });
  assert.equal(phoneJoin.success, true);
  assert.equal(phoneJoin.slotIndex, 1);

  manager.handleSwapSlots(host, 0, 1);
  assert.equal(manager.getReservedHostSlot(room), 0, 'host seat must not be swappable');

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
