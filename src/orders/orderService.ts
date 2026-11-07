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

export type PaymentStatus =
  | 'not_applicable'
  | 'awaiting_collection'
  | 'awaiting_delivery_quote'
  | 'pending_payment'
  | 'pending_verification'
  | 'verified'
  | 'rejected';

export type DeliveryFeeStatus =
  | 'pending'
  | 'free'
  | 'fixed'
  | 'not_applicable'
  | 'legacy';

export type OrderStatusHistoryEntry = {
  status: OrderStatus;
  reason: string | null;
  created_at: string;
};

export type MealOrder = {
  id: string;
  order_number: number | null;
  business_id: string;
  business_name: string;
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  delivery_mode: 'pickup' | 'delivery';
  delivery_address: string | null;
  delivery_references: string | null;
  delivery_fee_status: DeliveryFeeStatus;
  payment_method: 'cash' | 'transfer';
  payment_status: PaymentStatus | null;
  transfer_bank: string | null;
  transfer_alias: string | null;
  transfer_holder: string | null;
  subtotal: number;
  discount_total: number;
  delivery_fee: number | null;
  total: number | null;
  customer_notes: string | null;
  status: OrderStatus;
  status_reason: string | null;
  created_at: string;
  items: {
    product_id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
    customer_notes: string | null;
  }[];
  history: OrderStatusHistoryEntry[];
};

export type WhatsAppOrderDetails = {
  order_number: number | null;
  customer_name: string;
  customer_phone: string | null;
  delivery_mode: 'pickup' | 'delivery';
  delivery_address: string | null;
  delivery_references: string | null;
  delivery_fee_status: DeliveryFeeStatus;
  payment_method: 'cash' | 'transfer';
  payment_status: PaymentStatus | null;
  subtotal: number;
  discount_total: number;
  delivery_fee: number | null;
  total: number | null;
  transfer_alias: string | null;
  customer_notes: string | null;
  items: {
    product_name: string;
    quantity: number;
    line_total: number;
    customer_notes: string | null;
  }[];
};

type OrderRecord = {
  id: string;
  business_id: string;
  customer_id: string;
  customer_name_snapshot: string;
  customer_phone_snapshot: string | null;
  delivery_mode: 'pickup' | 'delivery';
  delivery_address: string | null;
  payment_method: 'cash' | 'transfer';
  subtotal: number;
  delivery_fee: number | null;
  total: number | null;
  status: OrderStatus;
  status_reason: string | null;
  created_at: string;
  order_number?: number | null;
  delivery_references?: string | null;
  delivery_fee_status?: DeliveryFeeStatus;
  payment_status?: PaymentStatus | null;
  transfer_bank_snapshot?: string | null;
  transfer_alias_snapshot?: string | null;
  transfer_holder_snapshot?: string | null;
  customer_notes?: string | null;
  discount_total?: number;
};

type OrderItemRecord = {
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
  customer_notes?: string | null;
};

export const isOrderCheckoutV2Enabled =
  import.meta.env.VITE_MORFI_ORDER_CHECKOUT_V2 === 'true';

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

export function paymentStatusLabel(
  status: PaymentStatus | null,
  deliveryFeeStatus?: DeliveryFeeStatus,
): string {
  switch (status) {
    case 'pending_payment':
      return deliveryFeeStatus === 'pending'
        ? 'Pendiente de pago; envío por cotizar, no transferir todavía'
        : 'Pendiente de pago';
    case 'awaiting_delivery_quote': return 'Esperando costo de envío; no transferir todavía';
    case 'pending_verification': return 'Transferencia pendiente de verificación';
    case 'verified': return 'Transferencia verificada';
    case 'rejected': return 'Pago rechazado';
    case 'awaiting_collection':
      return deliveryFeeStatus === 'pending'
        ? 'Efectivo pendiente de pago al recibir; envío a cotizar'
        : 'Pago pendiente al retirar/recibir';
    case 'not_applicable': return 'No aplica';
    default: return 'Estado de pago no disponible';
  }
}

export function deliveryFeeStatusLabel(status: DeliveryFeeStatus): string {
  switch (status) {
    case 'pending': return 'Envío a confirmar';
    case 'free': return 'Envío gratis';
    case 'fixed': return 'Tarifa definida';
    case 'not_applicable': return 'Sin costo de envío';
    case 'legacy': return 'No informado';
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
  let orders: OrderRecord[];
  if (isOrderCheckoutV2Enabled) {
    const result = await client
      .from('morfi_orders')
      .select('id, business_id, customer_id, customer_name_snapshot, customer_phone_snapshot, delivery_mode, delivery_address, payment_method, subtotal, delivery_fee, total, status, status_reason, created_at, order_number, delivery_references, delivery_fee_status, payment_status, transfer_bank_snapshot, transfer_alias_snapshot, transfer_holder_snapshot, customer_notes, discount_total')
      .eq(column, id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    orders = result.data;
  } else {
    const result = await client
      .from('morfi_orders')
      .select('id, business_id, customer_id, customer_name_snapshot, customer_phone_snapshot, delivery_mode, delivery_address, payment_method, subtotal, delivery_fee, total, status, status_reason, created_at')
      .eq(column, id)
      .order('created_at', { ascending: false });
    if (result.error) throw result.error;
    orders = result.data;
  }
  if (orders.length === 0) return [];

  const orderIds = orders.map(order => order.id);
  const businessIds = [...new Set(orders.map(order => order.business_id))];
  let orderItems: OrderItemRecord[];
  if (isOrderCheckoutV2Enabled) {
    const result = await client.from('morfi_order_items')
      .select('order_id, product_id, product_name, quantity, unit_price, line_total, customer_notes')
      .in('order_id', orderIds);
    if (result.error) throw result.error;
    orderItems = result.data;
  } else {
    const result = await client.from('morfi_order_items')
      .select('order_id, product_id, product_name, quantity, unit_price, line_total')
      .in('order_id', orderIds);
    if (result.error) throw result.error;
    orderItems = result.data;
  }
  const [businessesResult, historyResult] = await Promise.all([
    client.from('morfi_businesses').select('id, name').in('id', businessIds),
    client.from('morfi_order_status_history')
      .select('order_id, status, reason, created_at')
      .in('order_id', orderIds)
      .order('created_at', { ascending: true }),
  ]);
  if (businessesResult.error) throw businessesResult.error;
  if (historyResult.error) throw historyResult.error;

  const businessNames = new Map(businessesResult.data.map(business => [business.id, business.name]));
  const itemsByOrder = new Map<string, MealOrder['items']>();
  for (const item of orderItems) {
    const items = itemsByOrder.get(item.order_id) ?? [];
    items.push({
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      unit_price: Number(item.unit_price),
      line_total: Number(item.line_total),
      customer_notes: isOrderCheckoutV2Enabled ? item.customer_notes ?? null : null,
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

  return orders.map(order => {
    const total = order.total == null ? null : Number(order.total);
    const deliveryFee = order.delivery_fee == null ? null : Number(order.delivery_fee);
    return {
      id: order.id,
      order_number: isOrderCheckoutV2Enabled ? order.order_number ?? null : null,
      business_id: order.business_id,
      business_name: businessNames.get(order.business_id) ?? 'Emprendimiento',
      customer_id: order.customer_id,
      customer_name: order.customer_name_snapshot,
      customer_phone: order.customer_phone_snapshot,
      delivery_mode: order.delivery_mode,
      delivery_address: order.delivery_address,
      delivery_references: isOrderCheckoutV2Enabled ? order.delivery_references ?? null : null,
      delivery_fee_status: isOrderCheckoutV2Enabled
        ? order.delivery_fee_status ?? 'legacy'
        : order.delivery_mode === 'delivery' ? 'legacy' : 'not_applicable',
      payment_method: order.payment_method,
      payment_status: isOrderCheckoutV2Enabled ? order.payment_status ?? null : null,
      transfer_bank: isOrderCheckoutV2Enabled ? order.transfer_bank_snapshot ?? null : null,
      transfer_alias: isOrderCheckoutV2Enabled ? order.transfer_alias_snapshot ?? null : null,
      transfer_holder: isOrderCheckoutV2Enabled ? order.transfer_holder_snapshot ?? null : null,
      subtotal: Number(order.subtotal),
      discount_total: isOrderCheckoutV2Enabled ? Number(order.discount_total ?? 0) : 0,
      delivery_fee: deliveryFee,
      total,
      customer_notes: isOrderCheckoutV2Enabled ? order.customer_notes ?? null : null,
      status: order.status,
      status_reason: order.status_reason,
      created_at: order.created_at,
      items: itemsByOrder.get(order.id) ?? [],
      history: historyByOrder.get(order.id) ?? [],
    };
  });
}

export function listCustomerMealOrders(customerId: string): Promise<MealOrder[]> {
  return loadMealOrders('customer_id', customerId);
}

export function listBusinessMealOrders(businessId: string): Promise<MealOrder[]> {
  return loadMealOrders('business_id', businessId);
}

export async function getWhatsAppOrderDetails(
  orderId: string,
  transferDetails: { alias: string | null },
): Promise<WhatsAppOrderDetails> {
  const client = getSupabase();
  const orderResult = isOrderCheckoutV2Enabled
    ? await client
      .from('morfi_orders')
      .select('order_number, customer_name_snapshot, customer_phone_snapshot, delivery_mode, delivery_address, delivery_references, delivery_fee_status, payment_method, payment_status, subtotal, discount_total, delivery_fee, total, transfer_alias_snapshot, customer_notes')
      .eq('id', orderId)
      .single()
    : await client
      .from('morfi_orders')
      .select('customer_name_snapshot, customer_phone_snapshot, delivery_mode, delivery_address, payment_method, subtotal, delivery_fee, total')
      .eq('id', orderId)
      .single();
  if (orderResult.error) throw orderResult.error;
  const itemsResult = isOrderCheckoutV2Enabled
    ? await client
      .from('morfi_order_items')
      .select('product_name, quantity, line_total, customer_notes')
      .eq('order_id', orderId)
      .order('product_name', { ascending: true })
    : await client
      .from('morfi_order_items')
      .select('product_name, quantity, line_total')
      .eq('order_id', orderId)
      .order('product_name', { ascending: true });
  const { data: items, error: itemsError } = itemsResult;
  if (itemsError) throw itemsError;
  if (items.length === 0) {
    throw new Error('El pedido se registró sin productos consultables.');
  }

  const order = orderResult.data;
  const transferAlias = isOrderCheckoutV2Enabled && 'transfer_alias_snapshot' in order
    ? order.transfer_alias_snapshot
    : transferDetails.alias;
  const rawDeliveryFeeStatus = isOrderCheckoutV2Enabled && 'delivery_fee_status' in order
    ? order.delivery_fee_status
    : null;
  const deliveryFeeStatus: DeliveryFeeStatus =
    rawDeliveryFeeStatus === 'pending' ||
    rawDeliveryFeeStatus === 'free' ||
    rawDeliveryFeeStatus === 'fixed' ||
    rawDeliveryFeeStatus === 'not_applicable' ||
    rawDeliveryFeeStatus === 'legacy'
      ? rawDeliveryFeeStatus
      : order.delivery_mode === 'delivery' ? 'legacy' : 'not_applicable';
  const rawPaymentStatus = isOrderCheckoutV2Enabled && 'payment_status' in order
    ? order.payment_status
    : null;
  const paymentStatus: PaymentStatus | null =
    rawPaymentStatus === 'not_applicable' ||
    rawPaymentStatus === 'awaiting_collection' ||
    rawPaymentStatus === 'awaiting_delivery_quote' ||
    rawPaymentStatus === 'pending_payment' ||
    rawPaymentStatus === 'pending_verification' ||
    rawPaymentStatus === 'verified' ||
    rawPaymentStatus === 'rejected'
      ? rawPaymentStatus
      : null;
  const rawCustomerNotes = isOrderCheckoutV2Enabled && 'customer_notes' in order
    ? order.customer_notes
    : null;
  return {
    order_number: isOrderCheckoutV2Enabled && 'order_number' in order && order.order_number !== null
      ? Number(order.order_number)
      : null,
    customer_name: order.customer_name_snapshot,
    customer_phone: order.customer_phone_snapshot,
    delivery_mode: order.delivery_mode,
    delivery_address: order.delivery_address,
    delivery_references: isOrderCheckoutV2Enabled && 'delivery_references' in order &&
      typeof order.delivery_references === 'string'
      ? order.delivery_references
      : null,
    delivery_fee_status: deliveryFeeStatus,
    payment_method: order.payment_method,
    payment_status: paymentStatus,
    subtotal: Number(order.subtotal),
    discount_total: isOrderCheckoutV2Enabled && 'discount_total' in order
      ? Number(order.discount_total ?? 0)
      : 0,
    delivery_fee: order.delivery_fee === null ? null : Number(order.delivery_fee),
    total: order.total === null ? null : Number(order.total),
    transfer_alias: typeof transferAlias === 'string' ? transferAlias : null,
    customer_notes: typeof rawCustomerNotes === 'string' ? rawCustomerNotes : null,
    items: items.map(item => ({
      product_name: item.product_name,
      quantity: item.quantity,
      line_total: Number(item.line_total),
      customer_notes: 'customer_notes' in item && typeof item.customer_notes === 'string'
        ? item.customer_notes
        : null,
    })),
  };
}

export async function createMealOrder(input: {
  businessId: string;
  customerPhone: string;
  items: { productId: string; quantity: number; customerNotes?: string | null }[];
  deliveryMode: 'pickup' | 'delivery';
  deliveryAddress: string | null;
  deliveryReferences?: string | null;
  customerNotes?: string | null;
  paymentMethod: 'cash' | 'transfer';
  requestKey: string;
}): Promise<{ id: string; orderNumber: number | null }> {
  const client = getSupabase();
  if (isOrderCheckoutV2Enabled) {
    const { data, error } = await client.rpc('morfi_create_order_v2', {
      p_business_id: input.businessId,
      p_customer_phone: input.customerPhone,
      p_items: input.items.map(item => ({
        product_id: item.productId,
        quantity: item.quantity,
        customer_notes: item.customerNotes ?? null,
      })),
      p_delivery_mode: input.deliveryMode,
      p_delivery_address: input.deliveryAddress,
      p_delivery_references: input.deliveryReferences ?? null,
      p_payment_method: input.paymentMethod,
      p_customer_notes: input.customerNotes ?? null,
      p_request_key: input.requestKey,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.order_id) {
      throw new Error('La nueva RPC no devolvió el identificador del pedido.');
    }
    return { id: row.order_id, orderNumber: row.order_number ?? null };
  }

  if (
    input.deliveryReferences?.trim() ||
    input.customerNotes?.trim() ||
    input.items.some(item => item.customerNotes?.trim())
  ) {
    throw new Error('Aplicá las migraciones de checkout antes de confirmar observaciones o referencias.');
  }

  const { data, error } = await client.rpc('morfi_create_order', {
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
  if (typeof data !== 'string') {
    throw new Error('La RPC de pedidos existente devolvió una respuesta inesperada.');
  }
  return { id: data, orderNumber: null };
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

export async function setMealOrderDeliveryFee(
  orderId: string,
  deliveryFee: number,
): Promise<void> {
  if (!isOrderCheckoutV2Enabled) {
    throw new Error('El registro de cotizaciones estará disponible cuando se apliquen las migraciones.');
  }
  const { error } = await getSupabase().rpc('morfi_set_order_delivery_fee', {
    p_order_id: orderId,
    p_delivery_fee: deliveryFee,
  });
  if (error) throw error;
}

export async function reviewMealOrderTransfer(
  orderId: string,
  approved: boolean,
): Promise<void> {
  const { error } = await getSupabase().rpc('morfi_review_transfer_payment', {
    p_order_id: orderId,
    p_order_type: 'business',
    p_approved: approved,
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
