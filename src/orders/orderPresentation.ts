import type { MorfiOrder, OrderStatus } from './orderService';

export const statusLabel: Record<OrderStatus, string> = {
  pending: 'Pedido recibido', accepted: 'Aceptado', preparing: 'En preparación',
  ready: 'Listo para retirar', on_the_way: 'En camino', delivered: 'Entregado',
  rejected: 'Rechazado', cancellation_requested: 'Cancelación solicitada', cancelled: 'Cancelado',
};

export function nextVendorStatuses(order: MorfiOrder): OrderStatus[] {
  switch (order.status) {
    case 'pending': return ['accepted', 'rejected'];
    case 'accepted': return ['preparing'];
    case 'preparing': return ['ready'];
    case 'ready': return [order.delivery_mode === 'delivery' ? 'on_the_way' : 'delivered'];
    case 'on_the_way': return ['delivered'];
    case 'cancellation_requested': return ['cancelled'];
    default: return [];
  }
}

export function orderSummary(order: MorfiOrder): string {
  return order.items.map(item => `${item.quantity} × ${item.product_name}`).join(', ');
}
