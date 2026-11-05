import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatRussianDate, formatRussianDateRange } from './russian-date-format';

test('formats ISO calendar dates in Russian without timezone day shifts', () => {
  assert.equal(formatRussianDate('2026-08-12'), '12 августа 2026 г.');
  assert.equal(formatRussianDate('2024-02-29'), '29 февраля 2024 г.');
});

test('formats partial and complete date ranges and omits absent or invalid values', () => {
  assert.equal(formatRussianDateRange('2026-08-12', '2026-08-18'), '12 августа 2026 г. — 18 августа 2026 г.');
  assert.equal(formatRussianDateRange('2026-08-12', null), '12 августа 2026 г.');
  assert.equal(formatRussianDateRange(null, '2026-08-18'), '18 августа 2026 г.');
  assert.equal(formatRussianDateRange(null, null), null);
  assert.equal(formatRussianDate('2026-02-31'), null);
});
