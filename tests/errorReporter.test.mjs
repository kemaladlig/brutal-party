import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { reportError, safeCall } from '../src/core/errorReporter.js';

describe('errorReporter', () => {
  test('reportError formats log with context and does not throw', () => {
    let logged = null;
    const origError = console.error;
    console.error = (prefix, err) => {
      logged = { prefix, err };
    };

    try {
      const err = new Error('test-failure');
      reportError(err, 'unitTest');
      assert.ok(logged);
      assert.equal(logged.prefix, '[ErrorReporter:unitTest]');
      assert.equal(logged.err, err);
    } finally {
      console.error = origError;
    }
  });

  test('reportError supports warnOnly option', () => {
    let warned = null;
    const origWarn = console.warn;
    console.warn = (prefix, err) => {
      warned = { prefix, err };
    };

    try {
      const err = new Error('test-warning');
      reportError(err, 'unitWarn', { warnOnly: true });
      assert.ok(warned);
      assert.equal(warned.prefix, '[ErrorReporter:unitWarn]');
      assert.equal(warned.err, err);
    } finally {
      console.warn = origWarn;
    }
  });

  test('safeCall executes cleanly or catches and returns fallback', () => {
    const success = safeCall(() => 42, 'test.success', 0);
    assert.equal(success, 42);

    const fallback = safeCall(() => {
      throw new Error('boom');
    }, 'test.fail', 'fallback-val');
    assert.equal(fallback, 'fallback-val');
  });
});
