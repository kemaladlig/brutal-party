import test from 'node:test';
import assert from 'node:assert/strict';
import { perfMonitor } from '../src/core/perfMonitor.js';

test('perf monitor summarizes recorded series and keeps the last gauges', () => {
  perfMonitor.reset();
  for (let i = 0; i < 100; i++) perfMonitor.record('host.render', i);
  perfMonitor.record('host.render', 1000);
  perfMonitor.gauge('client.playout', 35);
  perfMonitor.gauge('client.jitter', 4);

  const snap = perfMonitor.snapshot();
  const s = snap.series['host.render'];
  assert.equal(s.n, 101);
  assert.ok(s.max >= 1000, `max=${s.max}`);
  assert.ok(s.avg > 0 && s.avg < 1000, `avg=${s.avg}`);
  assert.ok(s.p95 >= s.avg, `p95=${s.p95} avg=${s.avg}`);
  assert.equal(snap.gauges['client.playout'], 35);
  assert.equal(snap.gauges['client.jitter'], 4);

  perfMonitor.reset();
  assert.deepEqual(perfMonitor.snapshot(), { series: {}, gauges: {} });
});

test('perf monitor ignores non-finite samples and gauges', () => {
  perfMonitor.reset();
  perfMonitor.record('x', Number.NaN);
  perfMonitor.record('x', Infinity);
  perfMonitor.record('x', 5);
  perfMonitor.gauge('g', Number.NaN);

  const snap = perfMonitor.snapshot();
  assert.equal(snap.series['x'].n, 1);
  assert.deepEqual(snap.gauges, {});

  perfMonitor.reset();
});
