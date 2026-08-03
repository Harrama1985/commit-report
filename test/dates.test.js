import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDay, resolveRange, toIsoDay, today } from '../src/dates.js';

test('parseDay accepts ISO days', () => {
  assert.equal(parseDay('2026-08-03'), '2026-08-03');
});

test('parseDay accepts keywords and offsets', () => {
  const now = today();
  assert.equal(parseDay('today'), now);

  const yesterday = new Date(`${now}T12:00:00`);
  yesterday.setDate(yesterday.getDate() - 1);
  assert.equal(parseDay('yesterday'), toIsoDay(yesterday));
  assert.equal(parseDay('-1'), toIsoDay(yesterday));
});

test('parseDay rejects nonsense and impossible dates', () => {
  assert.throws(() => parseDay('03/08/2026'), /Invalid date/);
  assert.throws(() => parseDay('2026-02-30'), /not a real calendar date/);
});

test('resolveRange defaults to a single day', () => {
  assert.deepEqual(resolveRange({ date: '2026-08-03' }), {
    from: '2026-08-03',
    to: '2026-08-03',
  });
  assert.deepEqual(resolveRange({}), { from: today(), to: today() });
});

test('resolveRange builds windows from --days and --from/--to', () => {
  assert.deepEqual(resolveRange({ days: '3', to: '2026-08-03' }), {
    from: '2026-08-01',
    to: '2026-08-03',
  });
  assert.deepEqual(resolveRange({ from: '2026-07-01', to: '2026-07-31' }), {
    from: '2026-07-01',
    to: '2026-07-31',
  });
});

test('resolveRange rejects reversed ranges and bad counts', () => {
  assert.throws(() => resolveRange({ from: '2026-08-05', to: '2026-08-01' }), /is after/);
  assert.throws(() => resolveRange({ days: '0' }), /Invalid --days/);
});
