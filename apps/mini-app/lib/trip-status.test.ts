import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getTripStatusLabel } from './trip-status';

test('returns the draft trip status label', () => {
  assert.equal(getTripStatusLabel('draft'), 'Черновик');
});

test('returns the planning trip status label', () => {
  assert.equal(getTripStatusLabel('planning'), 'Планируется');
});

test('returns the ready trip status label', () => {
  assert.equal(getTripStatusLabel('ready'), 'Готово');
});
