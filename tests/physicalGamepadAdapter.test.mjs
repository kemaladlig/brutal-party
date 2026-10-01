import test from 'node:test';
import assert from 'node:assert/strict';
import { PhysicalGamepadAdapter } from '../src/controllers/physicalGamepadAdapter.js';
import { getControlDescriptor } from '../src/core/controlDescriptor.js';
import { GAMEPAD_SCHEMAS } from '../src/controllers/gamepadSchemas.js';

function pad(overrides = {}) {
  return {
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
    ...overrides,
  };
}

test('physical gamepad adapter emits canonical transport actions without becoming authoritative', () => {
  let mode = 'BOMB';
  let now = 100;
  const connectedPad = pad({ axes: [0.6, 0, 0, 0] });
  const sent = [];
  const adapter = new PhysicalGamepadAdapter({
    send: (data) => sent.push(data),
    getMode: () => mode,
    getDescriptor: () => getControlDescriptor(mode, GAMEPAD_SCHEMAS[mode]),
    getGamepads: () => [connectedPad],
    now: () => now,
    schedule: () => 1,
    cancel: () => {},
  });

  assert.equal(adapter.start(), true);
  adapter.poll();
  assert.equal(sent[0].action, 'JOYSTICK_MOVE');
  assert.equal(sent[0].intent, undefined);

  connectedPad.buttons[0] = { pressed: true, value: 1 };
  adapter.poll();
  assert.equal(sent.at(-1).action, 'DASH');

  now = 200;
  mode = 'ARCHER';
  connectedPad.buttons[0] = { pressed: false, value: 0 };
  connectedPad.axes = [0, 0, 0.5, 0];
  adapter.poll();
  assert.equal(sent.at(-2).action, 'AIM_MOVE');
  assert.equal(sent.at(-1).action, 'AIM_PRESS');
  assert.equal(Math.abs(sent.at(-1).angle), 0);

  now = 250;
  mode = 'HORDE';
  connectedPad.axes = [0, 0, 0, 0];
  connectedPad.buttons[0] = { pressed: true, value: 1 };
  adapter.poll();
  assert.equal(sent.some((packet) => packet.action === 'AIM_RELEASE' && Math.abs(packet.angle) === 0), true);
  assert.equal(sent.at(-1).action, 'DASH');
  connectedPad.buttons[0] = { pressed: false, value: 0 };
  adapter.poll();
  assert.equal(sent.some((packet) => packet.action === 'HORDE_FIRE' || packet.action === 'HORDE_FIRE_RELEASE'), false);
  adapter.stop();
});

test('physical gamepad adapter neutralizes only channels it actually held', () => {
  // Dokunmatik yüzeyle aynı transport'u paylaşır: adaptör HİÇ tutmadığı bir
  // kanalı nötrlemez, yoksa başka kaynağın basılı girdisini (ör. pedal/joystick)
  // ezer. Yalnız kendi tuttuğu kanalı bırakır.
  let blocked = false;
  const sent = [];
  const connectedPad = pad({ axes: [0.6, 0, 0, 0] });
  const adapter = new PhysicalGamepadAdapter({
    send: (data) => sent.push(data),
    getMode: () => 'BOMB',
    getDescriptor: () => getControlDescriptor('BOMB', GAMEPAD_SCHEMAS.BOMB),
    isBlocked: () => blocked,
    getGamepads: () => [connectedPad],
    now: () => 100,
    schedule: () => 1,
    cancel: () => {},
  });
  adapter.start();
  adapter.poll();
  assert.equal(sent.at(-1).action, 'JOYSTICK_MOVE');
  assert.ok(sent.at(-1).force > 0, 'moving pad emits a live vector');

  // Engelleme geçişi: yalnız KENDİ tuttuğu kanalı bırakır.
  blocked = true;
  adapter.poll();
  const release = sent.at(-1);
  assert.equal(release.action, 'JOYSTICK_MOVE');
  assert.equal(release.force, 0);
  const afterRelease = sent.length;

  // Engelleme sürerken tekrar tekrar nötr yayılmaz (tek geçiş).
  adapter.poll();
  assert.equal(sent.length, afterRelease);
});

test('physical gamepad adapter emits nothing when blocked without ever holding input', () => {
  // Regresyon: yerel girinti kısması (`_lastLocalInputAt`) devreye girdiğinde
  // adaptör mod geneli nötr patlatıyordu; bu, kullanıcının basılı tuttuğu
  // dokunmatik pedalı iptal ediyordu ("ilerleme tuşu geç tepki veriyor").
  const sent = [];
  const adapter = new PhysicalGamepadAdapter({
    send: (data) => sent.push(data),
    getMode: () => 'TANKS',
    getDescriptor: () => getControlDescriptor('TANKS', GAMEPAD_SCHEMAS.TANKS),
    isBlocked: () => true,
    getGamepads: () => [pad()],
    now: () => 100,
    schedule: () => 1,
    cancel: () => {},
  });
  adapter.start();
  adapter.poll();
  adapter.poll();
  assert.equal(sent.length, 0);
});
