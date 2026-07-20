import assert from 'node:assert/strict';
import { test } from 'node:test';

import type * as ProfileValidationModule from './profile-validation';

const { validateProfile }: typeof ProfileValidationModule = await import(
  new URL('./profile-validation.ts', import.meta.url).href
);

test('rejects an empty name', () => {
  const result = validateProfile({ name: '', city: 'Москва' });

  assert.equal(result.isValid, false);
  assert.equal(result.errors.name, 'Укажите имя');
});

test('rejects a name that contains only whitespace', () => {
  const result = validateProfile({ name: '  \t ', city: 'Москва' });

  assert.equal(result.isValid, false);
  assert.equal(result.errors.name, 'Укажите имя');
});

test('rejects an empty city', () => {
  const result = validateProfile({ name: 'Алина', city: '' });

  assert.equal(result.isValid, false);
  assert.equal(result.errors.city, 'Укажите город');
});

test('rejects a city that contains only whitespace', () => {
  const result = validateProfile({ name: 'Алина', city: ' \n ' });

  assert.equal(result.isValid, false);
  assert.equal(result.errors.city, 'Укажите город');
});

test('accepts valid data', () => {
  const result = validateProfile({ name: 'Алина', city: 'Москва' });

  assert.deepEqual(result, { errors: {}, isValid: true });
});

test('accepts valid data without mutating the input', () => {
  const input = Object.freeze({ name: '  Алина  ', city: '  Москва  ' });
  const beforeValidation = { ...input };

  const result = validateProfile(input);

  assert.deepEqual(result, { errors: {}, isValid: true });
  assert.deepEqual(input, beforeValidation);
});
