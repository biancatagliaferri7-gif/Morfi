import type { MealOrder, OrderStatus } from './orderService';

export function nextVendorStatuses(
  order: Pick<MealOrder, 'status' | 'delivery_mode' | 'delivery_fee_status'>,
): OrderStatus[] {
  switch (order.status) {
    case 'pending': return ['accepted', 'rejected'];
    case 'accepted': return ['preparing'];
    case 'preparing': return ['ready'];
    case 'ready': return order.delivery_mode === 'delivery'
      ? order.delivery_fee_status === 'pending' ? [] : ['on_the_way']
      : ['delivered'];
    case 'on_the_way': return ['delivered'];
    case 'cancellation_requested': return ['cancelled'];
    default: return [];
  }
}
