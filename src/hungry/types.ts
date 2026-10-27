// ─── Domain Types ─────────────────────────────────────────────────────────────

export interface Business {
  id: string;
  name: string;
  category: string;
  cuisine: string[];
  rating: number;
  reviewCount: number;
  deliveryTime: string;
  deliveryFee: number;    // ARS, 0 = free
  minimumOrder: number;
  address: string;
  neighborhood: string;
  description: string;
  coverImage: string;
  tags: string[];
  isOpen: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
}

export interface MenuItem {
  id: string;
  businessId: string;
  category: string;
  name: string;
  description: string;
  ingredients: string[];
  price: number;          // ARS
  image: string;
  isAvailable: boolean;
  isVegetarian?: boolean;
  isVegan?: boolean;
  isGlutenFree?: boolean;
}

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
}

export type DeliveryMode  = 'pickup' | 'delivery';
export type PaymentMethod = 'cash'   | 'transfer';
export type OrderStatus   = 'received' | 'preparing' | 'ready' | 'delivered';

export interface OrderStatusEntry {
  status: OrderStatus;
  at: string; // ISO string
}

export interface Order {
  id: string;
  businessId: string;
  businessName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryMode: DeliveryMode;
  deliveryAddress?: string;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  change?: number;
  status: OrderStatus;
  createdAt: string;
  statusHistory: OrderStatusEntry[];
}

export interface CreateOrderParams {
  businessId: string;
  businessName: string;
  items: CartItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryMode: DeliveryMode;
  deliveryAddress?: string;
  paymentMethod: PaymentMethod;
  cashAmount?: number;
  change?: number;
}
