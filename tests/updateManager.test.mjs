import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { isUpdateAvailable, onUpdateStatusChange, applyUpdate, checkForUpdates } from '../src/core/updateManager.js';

describe('updateManager', () => {
  let origNavigator;
  let origWindow;

  beforeEach(() => {
    origNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    origWindow = globalThis.window;
  });

  afterEach(() => {
    if (origNavigator) {
      Object.defineProperty(globalThis, 'navigator', origNavigator);
    }
    globalThis.window = origWindow;
  });

  test('isUpdateAvailable returns boolean default state', () => {
    assert.equal(typeof isUpdateAvailable(), 'boolean');
  });

  test('onUpdateStatusChange registers and unsubscribes cleanly', () => {
    let called = 0;
    const unsubscribe = onUpdateStatusChange((avail) => {
      called++;
    });

    assert.equal(typeof unsubscribe, 'function');
    unsubscribe();
  });

  test('checkForUpdates reports unsupported when serviceWorker is missing', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    const res = await checkForUpdates({ silent: true });
    assert.equal(res.status, 'unsupported');
  });

  test('applyUpdate calls reload or skipWaiting message without throwing', () => {
    let reloaded = false;
    globalThis.window = {
      location: {
        reload: () => { reloaded = true; },
      },
    };

    applyUpdate();
    assert.ok(reloaded);
  });
});
