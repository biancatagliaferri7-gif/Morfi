import { supabase } from '../lib/supabaseClient';

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'on_the_way'
  | 'delivered'
  | 'rejected'
  | 'cancellation_requested'
  | 'cancelled';

export type OrderStatusHistoryEntry = {
  status: OrderStatus;
  reason: string | null;
  created_at: string;
};

export type MealOrder = {
  id: string;
  business_id: string;
  business_name: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_mode: 'pickup' | 'delivery';
  delivery_address: string | null;
  payment_method: 'cash' | 'transfer';
  subtotal: number;
  delivery_fee: number;
  total: number;
  status: OrderStatus;
  status_reason: string | null;
  created_at: string;
  items: { product_id: string; product_name: string; quantity: number; line_total: number }[];
  history: OrderStatusHistoryEntry[];
};

export function orderStatusLabel(
  status: OrderStatus,
  deliveryMode: 'pickup' | 'delivery',
): string {
  switch (status) {
    case 'pending': return 'Pedido recibido';
    case 'accepted': return 'Pedido confirmado';
    case 'preparing': return 'En preparación';
    case 'ready': return deliveryMode === 'pickup' ? 'Listo para retirar' : 'Listo para enviar';
    case 'on_the_way': return 'Enviado';
    case 'delivered': return 'Entregado';
    case 'rejected': return 'Rechazado';
    case 'cancellation_requested': return 'Cancelación solicitada';
    case 'cancelled': return 'Cancelado';
  }
}

function getSupabase() {
  if (!supabase) {
    throw new Error('Supabase no está configurado. Revisá las variables públicas de conexión.');
  }
  return supabase;
}

async function loadMealOrders(
  column: 'customer_id' | 'business_id',
  id: string,
): Promise<MealOrder[]> {
  const client = getSupabase();
  const { data: orders, error } = await client
    .from('morfi_orders')
    .select('id, business_id, customer_id, customer_name_snapshot, customer_phone_snapshot, delivery_mode, delivery_address, payment_method, subtotal, delivery_fee, total, status, status_reason, created_at')
    .eq(column, id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  if (orders.length === 0) return [];

  const orderIds = orders.map(order => order.id);
  const businessIds = [...new Set(orders.map(order => order.business_id))];
  const [businessesResult, itemsResult, historyResult] = await Promise.all([
    client.from('morfi_businesses').select('id, name').in('id', businessIds),
    client.from('morfi_order_items')
      .select('order_id, product_id, product_name, quantity, line_total')
      .in('order_id', orderIds),
    client.from('morfi_order_status_history')
      .select('order_id, status, reason, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: true }),
  ]);
  if (businessesResult.error) throw businessesResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (historyResult.error) throw historyResult.error;

  const businessNames = new Map(businessesResult.data.map(business => [business.id, business.name]));
  const itemsByOrder = new Map<string, MealOrder['items']>();
  for (const item of itemsResult.data) {
    const items = itemsByOrder.get(item.order_id) ?? [];
    items.push({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      line_total: Number(item.line_total),
    });
    itemsByOrder.set(item.order_id, items);
  }
  const historyByOrder = new Map<string, OrderStatusHistoryEntry[]>();
  for (const event of historyResult.data) {
    const history = historyByOrder.get(event.order_id) ?? [];
    history.push({
      status: event.status,
      reason: event.reason,
      created_at: event.created_at,
    });
    historyByOrder.set(event.order_id, history);
  }

  return orders.map(order => ({
    id: order.id,
    business_id: order.business_id,
    business_name: businessNames.get(order.business_id) ?? 'Emprendimiento',
    customer_id: order.customer_id,
    customer_name: order.customer_name_snapshot,
    customer_phone: order.customer_phone_snapshot,
    delivery_mode: order.delivery_mode,
    delivery_address: order.delivery_address,
    payment_method: order.payment_method,
    subtotal: Number(order.subtotal),
    delivery_fee: Number(order.delivery_fee),
    total: Number(order.total),
    status: order.status,
    status_reason: order.status_reason,
    created_at: order.created_at,
    items: itemsByOrder.get(order.id) ?? [],
    history: historyByOrder.get(order.id) ?? [],
  }));
}

export function listCustomerMealOrders(customerId: string): Promise<MealOrder[]> {
  return loadMealOrders('customer_id', customerId);
}

export function listBusinessMealOrders(businessId: string): Promise<MealOrder[]> {
  return loadMealOrders('business_id', businessId);
}

export async function createMealOrder(input: {
  businessId: string;
  items: { productId: string; quantity: number }[];
  deliveryMode: 'pickup' | 'delivery';
  deliveryAddress: string | null;
  paymentMethod: 'cash' | 'transfer';
  requestKey: string;
}): Promise<string> {
  const { data, error } = await getSupabase().rpc('morfi_create_order', {
    p_business_id: input.businessId,
    p_items: input.items.map(item => ({
      product_id: item.productId,
      quantity: item.quantity,
    })),
    p_delivery_mode: input.deliveryMode,
    p_delivery_address: input.deliveryAddress,
    p_payment_method: input.paymentMethod,
    p_request_key: input.requestKey,
  });
  if (error) throw error;
  return data;
}

export async function updateMealOrderStatus(
  orderId: string,
  status: OrderStatus,
  reason: string | null,
): Promise<void> {
  const { error } = await getSupabase().rpc('morfi_update_order_status_with_reason', {
    p_order_id: orderId,
    p_new_status: status,
    p_reason: reason,
  });
  if (error) throw error;
}

export function subscribeToMealOrders(
  column: 'customer_id' | 'business_id',
  id: string,
  onChange: () => void,
) {
  const channel = getSupabase()
    .channel(`morfi-orders-${column}-${id}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'morfi_orders', filter: `${column}=eq.${id}` },
      onChange,
    )
    .subscribe();
  return () => {
    void getSupabase().removeChannel(channel);
  };
}
