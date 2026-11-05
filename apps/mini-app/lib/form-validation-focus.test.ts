import assert from 'node:assert/strict';
import { test } from 'node:test';

import { focusFirstValidationErrorField, getFirstValidationErrorField } from './form-validation-focus';

test('selects the first invalid field in form order', () => {
  assert.equal(
    getFirstValidationErrorField({ displayName: undefined, birthDate: 'Invalid date' }, ['displayName', 'birthDate']),
    'birthDate'
  );
  assert.equal(
    getFirstValidationErrorField({ dateFrom: 'Invalid date', dateTo: 'End is before start' }, ['destination', 'dateFrom', 'dateTo']),
    'dateFrom'
  );
});

test('returns null when the error map has no visible field errors', () => {
  assert.equal(getFirstValidationErrorField({ displayName: undefined, birthDate: undefined }, ['displayName', 'birthDate']), null);
});

test('focuses the matching first invalid field and does not focus another input', () => {
  const focused: string[] = [];
  const field = focusFirstValidationErrorField(
    { destination: undefined, dateFrom: undefined, dateTo: 'Дата окончания не может быть раньше даты начала' },
    ['destination', 'dateFrom', 'dateTo'],
    {
      destination: { focus: () => focused.push('destination') },
      dateFrom: { focus: () => focused.push('dateFrom') },
      dateTo: { focus: () => focused.push('dateTo') }
    }
  );

  assert.equal(field, 'dateTo');
  assert.deepEqual(focused, ['dateTo']);
});
