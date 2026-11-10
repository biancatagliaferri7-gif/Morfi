import test from 'node:test';
import assert from 'node:assert/strict';
import { messageForOrderError } from '../src/orders/orderErrors';

test('checkout explains a Supabase stock rejection instead of hiding its message', () => {
  assert.match(messageForOrderError({ code: 'P0001', message: 'Insufficient finished stock for product pan de campo' }), /pan de campo está agotado/);
  assert.match(messageForOrderError({ code: 'P0001', message: 'Finished stock changed while placing the order' }), /stock cambió/);
  assert.doesNotMatch(messageForOrderError({ code: 'XX000', message: 'internal SQL error' }), /internal SQL error/);
});
