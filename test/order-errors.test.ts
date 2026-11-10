import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrderHistoryUnavailable, messageForOrderError } from '../src/orders/orderErrors';

test('checkout explains a Supabase stock rejection instead of hiding its message', () => {
  assert.match(messageForOrderError({ code: 'P0001', message: 'Insufficient finished stock for product pan de campo' }), /pan de campo está agotado/);
  assert.match(messageForOrderError({ code: 'P0001', message: 'Finished stock changed while placing the order' }), /stock cambió/);
  assert.doesNotMatch(messageForOrderError({ code: 'XX000', message: 'internal SQL error' }), /internal SQL error/);
});

test('a missing timeline does not hide an otherwise saved order', () => {
  assert.equal(isOrderHistoryUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.morfi_order_status_history' in the schema cache" }), true);
  assert.equal(isOrderHistoryUnavailable({ code: '42501', message: 'permission denied for table morfi_order_status_history' }), false);
  assert.equal(isOrderHistoryUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.morfi_orders'" }), false);
});
