import test from 'node:test';
import assert from 'node:assert/strict';
import { nextVendorStatuses, orderSummary, statusLabel } from '../src/orders/orderPresentation';
import type { MorfiOrder } from '../src/orders/orderService';

const baseOrder: MorfiOrder = {
  id: '00000000-0000-0000-0000-000000000000', business_id: 'business', customer_name: 'Ana',
  customer_phone: '+5493800000000', status: 'pending', delivery_mode: 'pickup', delivery_address: null,
  payment_method: 'cash', subtotal: 100, discount_total: 0, delivery_fee: 0, total: 100,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  items: [{ id: 'line', product_name: 'Empanada', quantity: 2, unit_price: 50, line_total: 100 }],
};

test('vendor status transitions respect pickup and delivery journeys', () => {
  assert.deepEqual(nextVendorStatuses(baseOrder), ['accepted', 'rejected']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'ready' }), ['delivered']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'ready', delivery_mode: 'delivery' }), ['on_the_way']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'cancellation_requested' }), ['cancelled']);
  assert.deepEqual(nextVendorStatuses({ ...baseOrder, status: 'delivered' }), []);
});

test('order summaries remain understandable to vendors', () => {
  assert.equal(orderSummary(baseOrder), '2 × Empanada');
  assert.equal(statusLabel.preparing, 'En preparación');
});
