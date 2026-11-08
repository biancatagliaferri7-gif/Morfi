import { supabase } from '../lib/supabaseClient';

export type PaymentMethod = 'cash' | 'transfer';
export type DeliveryMode = 'pickup' | 'delivery';
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

export type OrderItemInput = { productId: string; quantity: number };

export type MorfiOrderItem = {
  id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
};

export type MorfiOrder = {
  id: string;
  business_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  status: OrderStatus;
  delivery_mode: DeliveryMode;
  delivery_address: string | null;
  payment_method: PaymentMethod;
  subtotal: number;
  discount_total: number;
  delivery_fee: number;
  total: number;
  created_at: string;
  updated_at: string;
  items: MorfiOrderItem[];
};

type OrderRow = Omit<MorfiOrder, 'items'> & { morfi_order_items: MorfiOrderItem[] | null };

function client() {
  if (!supabase) throw new Error('Supabase no está configurado.');
  return supabase;
}

function mapOrder(row: OrderRow): MorfiOrder {
  const { morfi_order_items, ...order } = row;
  return { ...order, items: morfi_order_items ?? [] };
}

const orderColumns = `
  id, business_id, customer_name, customer_phone, status, delivery_mode,
  delivery_address, payment_method, subtotal, discount_total, delivery_fee,
  total, created_at, updated_at,
  morfi_order_items (id, product_name, quantity, unit_price, line_total)
`;

export async function createOrder(input: {
  businessId: string;
  items: OrderItemInput[];
  deliveryMode: DeliveryMode;
  deliveryAddress?: string;
  paymentMethod: PaymentMethod;
  requestKey: string;
}): Promise<string> {
  const { data, error } = await client().rpc('morfi_create_order', {
    p_business_id: input.businessId,
    p_items: input.items.map(item => ({ product_id: item.productId, quantity: item.quantity })),
    p_delivery_mode: input.deliveryMode,
    p_delivery_address: input.deliveryMode === 'delivery' ? input.deliveryAddress?.trim() ?? '' : null,
    p_payment_method: input.paymentMethod,
    p_request_key: input.requestKey,
  });
  if (error) throw error;
  return data as string;
}

export async function listCustomerOrders(): Promise<MorfiOrder[]> {
  const currentClient = client();
  const { data: userData, error: userError } = await currentClient.auth.getUser();
  if (userError) throw userError;
  if (!userData.user) return [];
  const { data, error } = await currentClient
    .from('morfi_orders')
    .select(orderColumns)
    .eq('customer_id', userData.user.id)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapOrder);
}

export async function listBusinessOrders(businessIds: string[]): Promise<MorfiOrder[]> {
  if (!businessIds.length) return [];
  const { data, error } = await client()
    .from('morfi_orders')
    .select(orderColumns)
    .in('business_id', businessIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(mapOrder);
}

export async function updateOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const { error } = await client().rpc('morfi_update_order_status', {
    p_order_id: orderId,
    p_new_status: status,
  });
  if (error) throw error;
}
