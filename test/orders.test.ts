import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVendorStatuses } from '../src/orders/orderPresentation';
import type { MealOrder } from '../src/orders/orderService';

const baseOrder = {
  status: 'pending', delivery_mode: 'pickup', delivery_fee_status: 'not_applicable',
} satisfies Pick<MealOrder, 'status' | 'delivery_mode' | 'delivery_fee_status'>;

test('vendor status transitions respect pickup and delivery journeys', () => {
  assert.deepEqual(nextVendorStatuses(baseOrder), ['accepted', 'rejected']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'accepted' }), ['preparing']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'preparing' }), ['ready']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'ready' }), ['delivered']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'ready', delivery_mode: 'delivery', delivery_fee_status: 'fixed' }), ['on_the_way']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'cancellation_requested' }), ['cancelled']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'delivered' }), []);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'cancelled' }), []);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'rejected' }), []);
});

test('delivery cannot leave while its fee is awaiting a quote', () => {
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'ready', delivery_mode: 'delivery', delivery_fee_status: 'pending' }), []);
});
