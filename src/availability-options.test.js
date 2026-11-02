import assert from 'node:assert/strict';
import { test } from 'node:test';
import { availabilityOptions } from './availability-options.js';

const people = [{ id: 1, name: 'Available' }, { id: 2, name: 'Unavailable' }, { id: 3, name: 'Pending' }];

test('default list excludes both kinds of tomorrow responses without mutating players', () => {
  const responses = { available: [{ id: 1 }], notAvailable: [{ id: 2 }] };
  assert.deepEqual(availabilityOptions(people, responses), [people[2]]);
  assert.equal(people.length, 3);
  assert.deepEqual(availabilityOptions(people, responses, true), people);
});

test('unanswered players remain selectable and everyone-responded yields an empty list', () => {
  assert.deepEqual(availabilityOptions(people, { available: [], notAvailable: [] }), people);
  assert.deepEqual(availabilityOptions(people, { available: people, notAvailable: [] }), []);
  assert.deepEqual(availabilityOptions([], { available: [], notAvailable: [] }), []);
});
