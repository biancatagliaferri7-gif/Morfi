import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { supabase } from '../lib/supabaseClient';
import { listPublishedBusinessCatalog } from '../business/publicCatalogService';
import type { PublicBusinessCatalog } from '../business/publicCatalogService';
import { listBusinessReviews } from '../business/reviewService';
import type { PublicReview } from '../business/reviewService';
import BusinessLocationMap from '../components/BusinessLocationMap';
import {
  createMealOrder,
  getWhatsAppOrderDetails,
  isOrderCheckoutV2Enabled,
  listCustomerMealOrders,
  orderStatusLabel,
  paymentStatusLabel,
  subscribeToMealOrders,
  updateMealOrderStatus,
} from '../orders/orderService';
import type { MealOrder } from '../orders/orderService';
import OrderReviewForm from './OrderReviewForm';

type Dish = {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice?: number;
  promotionTitle?: string;
  saleUnit?: string;
  acceptsDelivery?: boolean;
  cashDiscountPercent?: number | null;
  paymentMethods?: ('cash' | 'transfer')[];
  averageRating?: number | null;
  reviewCount?: number;
  image: string;
};
type Shop = {
  id: string;
  kind: 'business' | 'supplier';
  name: string;
  category: string;
  description: string;
  logo: string;
  cover: string;
  dishes: Dish[];
  isOpen: boolean;
  acceptsDelivery: boolean;
  acceptsPickup: boolean;
  phone?: string;
  location?: string | null;
  directions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryFee: number | null;
  deliveryFeeStatus: 'pending' | 'free' | 'fixed' | null;
  averageRating: number | null;
  reviewCount: number;
};
type Coordinates = { latitude: number; longitude: number };
const money = (value: number) => '$' + value.toLocaleString('es-AR');
const pendingOrderKey = 'morfi_pending_order';
function distanceInKm(shop: Shop, coordinates: Coordinates): number {
  if (shop.latitude == null || shop.longitude == null) return Number.POSITIVE_INFINITY;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const latitude1 = toRadians(coordinates.latitude);
  const latitude2 = toRadians(shop.latitude);
  const latitudeDifference = latitude2 - latitude1;
  const longitudeDifference = toRadians(shop.longitude - coordinates.longitude);
  const a = Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function mapPublicCatalog(catalog: PublicBusinessCatalog[]): Shop[] {
  return catalog.map(({ business, products, contact }) => {
    const dishes = products.map(product => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      acceptsDelivery: product.accepts_delivery,
      paymentMethods: product.payment_methods,
      cashDiscountPercent: product.cash_discount_percent,
      averageRating: product.average_rating,
      reviewCount: product.review_count,
      image: product.image_path || '/morfi-emprendimiento.png',
    }));
    return {
      id: business.id,
      kind: 'business',
      name: business.name,
      category: 'Emprendimiento',
      description: business.description || 'Productos publicados por este emprendimiento.',
      logo: business.logo_path || '/MORFI_logo_naranja_transparente.png',
      cover: dishes[0]?.image || '/portada.jpeg',
      dishes,
      isOpen: business.is_open,
      acceptsDelivery: business.accepts_delivery,
      acceptsPickup: business.accepts_pickup,
      latitude: business.latitude,
      longitude: business.longitude,
      deliveryFee: business.delivery_fee == null || Number(business.delivery_fee) <= 0
        ? business.delivery_fee_status === 'free' ? 0 : null
        : Number(business.delivery_fee),
      deliveryFeeStatus: business.delivery_fee_status,
      averageRating: business.average_rating,
      reviewCount: business.review_count,
      phone: contact?.contact_phone ?? undefined,
      location: contact?.location ?? null,
      directions: contact?.directions ?? null,
    };
  });
}

function readPendingOrder() {
  try {
    const saved = sessionStorage.getItem(pendingOrderKey);
    return saved ? JSON.parse(saved) as {
      selectedId: string;
      selectedKind?: 'business' | 'supplier';
      cart: Record<string, number>;
      delivery: 'pickup' | 'delivery';
      address: string;
      references?: string;
      productNotes?: Record<string, string>;
      orderNotes?: string;
      method?: 'cash' | 'transfer';
      cash?: string;
    } : null;
  } catch {
    return null;
  }
}

function whatsappUrl(phone: string, message: string) {
  let digits = phone.replace(/\D/g, '').replace(/^0/, '').replace(/^15/, '');
  if (!digits.startsWith('54')) digits = `54${digits}`;
  if (digits.length < 10 || digits.length > 15) return null;
  const international = digits;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}

function normalizeCustomerPhone(phone: string) {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+') && /^\+[1-9][0-9]{7,14}$/.test(`+${digits}`)) {
    return `+${digits}`;
  }
  if (digits.length === 10) return `+549${digits}`;
  if (digits.length >= 8 && digits.length <= 15 && digits.startsWith('549')) {
    return `+${digits}`;
  }
  return null;
}

function RatingDisplay({ average, count }: { average: number | null; count: number }) {
  if (!count || average === null) return null;
  return (
    <p className="mt-1 text-sm text-amber-700" aria-label={`${average.toFixed(1)} de 5 estrellas, ${count} valoraciones`}>
      <span aria-hidden="true">★★★★★</span>
      <strong className="ml-2">{average.toFixed(1)}</strong>
      <span className="ml-1 text-gray-500">({count})</span>
    </p>
  );
}

export default function Hungry() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const [pendingDraft] = useState(readPendingOrder);
  const [publishedShops, setPublishedShops] = useState<Shop[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [catalogReload, setCatalogReload] = useState(0);
  const [customerCoordinates, setCustomerCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationNotice, setLocationNotice] = useState('');
  const businessLogoListRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(
    pendingDraft?.selectedKind === 'supplier' ? null : pendingDraft?.selectedId ?? null,
  );
  const [selectedKind, setSelectedKind] = useState<'business' | 'supplier'>(
    pendingDraft?.selectedKind === 'supplier' ? 'business' : pendingDraft?.selectedKind ?? 'business',
  );
  const [cart, setCart] = useState<Record<string, number>>(
    pendingDraft?.selectedKind === 'supplier' ? {} : pendingDraft?.cart ?? {},
  );
  const [delivery, setDelivery] = useState<'pickup' | 'delivery'>(pendingDraft?.delivery ?? 'pickup');
  const [address, setAddress] = useState(pendingDraft?.address ?? '');
  const [deliveryReferences, setDeliveryReferences] = useState(pendingDraft?.references ?? '');
  const [productNotes, setProductNotes] = useState<Record<string, string>>(pendingDraft?.productNotes ?? {});
  const [orderNotes, setOrderNotes] = useState(pendingDraft?.orderNotes ?? '');
  const [method, setMethod] = useState<'cash' | 'transfer'>(
    pendingDraft?.method === 'cash' ? 'cash' : 'transfer',
  );
  const [customerPhoneInput, setCustomerPhoneInput] = useState('');
  const [customerOrders, setCustomerOrders] = useState<MealOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);
  const orderBusyRef = useRef(false);
  const [customerOrderBusyId, setCustomerOrderBusyId] = useState<string | null>(null);
  const [ordersReload, setOrdersReload] = useState(0);
  const [orderRequestKey, setOrderRequestKey] = useState<string | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    orderLabel: string;
    whatsappOrderUrl: string | null;
  } | null>(null);
  const [businessReviews, setBusinessReviews] = useState<PublicReview[]>([]);
  const [businessReviewsLoading, setBusinessReviewsLoading] = useState(false);
  const [businessReviewsError, setBusinessReviewsError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      setCatalogLoading(true);
      setCatalogError('');
      try {
        const catalog = await listPublishedBusinessCatalog();
        if (active) setPublishedShops(mapPublicCatalog(catalog));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) {
          setPublishedShops([]);
          setCatalogError(`No se pudo cargar el catálogo de emprendimientos: ${detail}`);
        }
      } finally {
        if (active) setCatalogLoading(false);
      }
    }

    void loadCatalog();
    return () => {
      active = false;
    };
  }, [catalogReload]);
  useEffect(() => {
    let active = true;
    if (!profile?.id) {
      setCustomerOrders([]);
      setOrdersLoading(false);
      setOrdersError('');
      return;
    }
    const customerId = profile.id;

    async function loadOrders() {
      setOrdersLoading(true);
      setOrdersError('');
      try {
        const data = await listCustomerMealOrders(customerId);
        if (active) setCustomerOrders(data);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) {
          setCustomerOrders([]);
          setOrdersError(`No se pudieron cargar tus pedidos de Supabase: ${detail}`);
        }
      } finally {
        if (active) setOrdersLoading(false);
      }
    }

    void loadOrders();
    const unsubscribe = subscribeToMealOrders('customer_id', customerId, () => {
      void loadOrders();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [profile?.id, ordersReload]);
  useEffect(() => {
    setCustomerPhoneInput(profile?.phone ?? '');
  }, [profile?.id, profile?.phone]);
  useEffect(() => {
    if (!profile?.id || !supabase) return;
    let active = true;
    const metadataPhone = profile.phone ?? '';
    void supabase.from('morfi_profiles').select('phone').eq('id', profile.id).single()
      .then(({ data, error }) => {
        if (!active || error) return;
        setCustomerPhoneInput(current => current === metadataPhone ? data.phone ?? '' : current);
      });
    return () => { active = false; };
  }, [profile?.id, profile?.phone]);
  useEffect(() => {
    let active = true;
    if (!selectedId || selectedKind !== 'business') {
      setBusinessReviews([]);
      setBusinessReviewsLoading(false);
      setBusinessReviewsError('');
      return;
    }
    const businessId = selectedId;

    async function loadReviews() {
      setBusinessReviewsLoading(true);
      setBusinessReviewsError('');
      try {
        const reviews = await listBusinessReviews(businessId);
        if (active) setBusinessReviews(reviews);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) {
          setBusinessReviews([]);
          setBusinessReviewsError(`No se pudieron cargar las opiniones: ${detail}`);
        }
      } finally {
        if (active) setBusinessReviewsLoading(false);
      }
    }

    void loadReviews();
    return () => {
      active = false;
    };
  }, [selectedId, selectedKind]);
  const allShops = publishedShops;
  const shopsSortedByDistance = useMemo(() => {
    if (!customerCoordinates) return allShops;
    return [...allShops].sort((left, right) =>
      distanceInKm(left, customerCoordinates) - distanceInKm(right, customerCoordinates),
    );
  }, [allShops, customerCoordinates]);
  const nearbyBusinesses = useMemo(() => {
    if (!customerCoordinates) return publishedShops;
    return [...publishedShops].sort((left, right) =>
      distanceInKm(left, customerCoordinates) - distanceInKm(right, customerCoordinates),
    );
  }, [publishedShops, customerCoordinates]);
  const filtered = useMemo(() => shopsSortedByDistance.filter(s => (s.name + ' ' + s.category + ' ' + s.description + ' ' + s.dishes.map(d => d.name).join(' ')).toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [shopsSortedByDistance, search]);
  const selected = selectedId ? publishedShops.find(s => s.id === selectedId) : undefined;
  const shopContactUrl = selected?.phone
    ? whatsappUrl(selected.phone, `Hola, quiero consultar por los productos de ${selected.name}`)
    : null;
  const lines = selected?.dishes.filter(d => (cart[d.id] || 0) > 0) || [];
  const subtotal = lines.reduce((sum, d) => sum + d.price * (cart[d.id] || 0), 0);
  const discountTotal = method === 'cash'
    ? lines.reduce((sum, dish) => sum +
      dish.price * (cart[dish.id] || 0) * (dish.cashDiscountPercent ?? 0) / 100, 0)
    : 0;
  const discountedSubtotal = subtotal - discountTotal;
  const supportsPickup = selected?.acceptsPickup ?? false;
  const supportsDelivery = selected?.acceptsDelivery === true &&
    (selected.kind === 'supplier' || (lines.length > 0 && lines.every(d => d.acceptsDelivery)));
  const transferAvailable = selected?.kind === 'business' &&
    lines.length > 0 &&
    lines.every(dish => dish.paymentMethods?.includes('transfer') ?? false);
  const cashAvailable = selected?.kind === 'business' &&
    lines.length > 0 &&
    lines.every(dish => dish.paymentMethods?.includes('cash') ?? false);
  const selectedPaymentAvailable = method === 'transfer' ? transferAvailable : cashAvailable;
  const businessWhatsappAvailable = selected?.kind === 'business' &&
    Boolean(selected.phone?.trim() && whatsappUrl(selected.phone, '') !== null);
  const deliveryFee = selected?.kind === 'business' && delivery === 'delivery' && subtotal > 0
    ? selected.deliveryFeeStatus === 'free'
      ? 0
      : selected.deliveryFeeStatus === 'pending'
        ? null
        : selected.deliveryFee
    : 0;
  const total = deliveryFee === null ? null : discountedSubtotal + deliveryFee;
  const canPlaceOrder = subtotal > 0 &&
    (delivery === 'pickup' ? supportsPickup : supportsDelivery && address.trim().length >= 5) &&
    selectedPaymentAvailable &&
    (delivery !== 'delivery' || deliveryFee !== null || isOrderCheckoutV2Enabled) &&
    businessWhatsappAvailable;
  const normalizedCustomerPhone = normalizeCustomerPhone(customerPhoneInput);
  const customerDetailsComplete = Boolean(profile?.full_name?.trim() && normalizedCustomerPhone);
  const checkoutV2Required = !isOrderCheckoutV2Enabled && (
    (delivery === 'delivery' && deliveryFee === null) ||
    Object.values(productNotes).some(note => note.trim()) ||
    orderNotes.trim().length > 0 ||
    deliveryReferences.trim().length > 0
  );
  const checkoutBlockers = [
    ...(lines.length === 0 ? ['Agregá al menos un producto al carrito.'] : []),
    ...(lines.length > 0 && (delivery === 'pickup' ? !supportsPickup : !supportsDelivery)
      ? ['El emprendimiento o algún producto del carrito no admite esta modalidad de entrega.']
      : []),
    ...(lines.length > 0 && !selectedPaymentAvailable
      ? ['Todos los productos deben aceptar el medio de pago seleccionado.']
      : []),
    ...(lines.length > 0 && !businessWhatsappAvailable
      ? ['El WhatsApp debe estar habilitado como público por el emprendimiento.']
      : []),
    ...(session && lines.length > 0 && !profile?.full_name?.trim()
      ? ['Completá tu nombre en el perfil.']
      : []),
    ...(session && lines.length > 0 && !normalizedCustomerPhone
      ? ['Ingresá un teléfono de cliente válido.']
      : []),
    ...(checkoutV2Required
      ? ['Esta opción todavía no está disponible. Quitá las observaciones y referencias, o elegí retiro si el envío está pendiente de cotización. También podés consultar al comercio por WhatsApp.']
      : []),
  ];
  const canOrder = canPlaceOrder &&
    customerDetailsComplete &&
    (isOrderCheckoutV2Enabled || (
      !Object.values(productNotes).some(note => note.trim()) &&
      !orderNotes.trim() &&
      !deliveryReferences.trim()
    ));
  useEffect(() => {
    if (method === 'transfer' && !transferAvailable && cashAvailable) {
      setMethod('cash');
    } else if (method === 'cash' && !cashAvailable && transferAvailable) {
      setMethod('transfer');
    }
  }, [method, transferAvailable, cashAvailable]);
  useEffect(() => {
    if (delivery === 'delivery' && !supportsDelivery) {
      if (supportsPickup) setDelivery('pickup');
      setAddress('');
      setDeliveryReferences('');
    } else if (delivery === 'pickup' && !supportsPickup && supportsDelivery) {
      setDelivery('delivery');
    }
  }, [delivery, supportsDelivery, supportsPickup]);
  const updateQty = (id: string, change: number) => {
    const dish = selected?.dishes.find(item => item.id === id);
    if (change > 0 && delivery === 'delivery' && selected?.kind === 'supplier' && !dish?.acceptsDelivery) {
      setDelivery('pickup');
      setAddress('');
      setNotice('El producto agregado no tiene delivery; cambiamos la modalidad a retiro.');
    }
    setOrderRequestKey(null);
    setConfirmedOrder(null);
    setProductNotes(current => {
      if ((cart[id] || 0) + change > 0) return current;
      const { [id]: _removed, ...remaining } = current;
      return remaining;
    });
    setCart(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + change) }));
  };
  const choosePaymentMethod = (nextMethod: 'cash' | 'transfer') => {
    if (method === nextMethod) return;
    setMethod(nextMethod);
    setOrderRequestKey(null);
    setConfirmedOrder(null);
  };
  const choose = (id: string, kind: 'business' | 'supplier') => {
    if (selectedId === id && selectedKind === kind) {
      setSelectedId(id);
      return;
    }
    const hasItems = Object.values(cart).some(quantity => quantity > 0);
    if (hasItems && (selectedId !== id || selectedKind !== kind) &&
      !window.confirm('Tu carrito tiene productos de otro vendedor. ¿Querés vaciarlo y empezar un carrito nuevo?')) {
      return;
    }
    setSelectedId(id);
    setSelectedKind(kind);
    setOrderRequestKey(null);
    setConfirmedOrder(null);
    setCart({});
    setProductNotes({});
    setOrderNotes('');
    setNotice('');
    setAddress('');
    setDeliveryReferences('');
    setDelivery('pickup');
  };
  function prioritizeNearbyBusinesses() {
    if (!navigator.geolocation) {
      setLocationNotice('Tu navegador no ofrece ubicación GPS. Podés seguir explorando todos los emprendimientos.');
      return;
    }

    setLocationNotice('Solicitando permiso para ordenar por cercanía…');
    navigator.geolocation.getCurrentPosition(
      position => {
        setCustomerCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
        setLocationNotice('Mostramos primero los emprendimientos más cercanos. El resto sigue disponible.');
      },
      error => {
        const detail = error.code === error.PERMISSION_DENIED
          ? 'No se autorizó el acceso a la ubicación.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'El GPS no está disponible en este momento.'
            : 'No se pudo obtener la ubicación a tiempo.';
        setLocationNotice(`${detail} Podés seguir explorando todos los emprendimientos.`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }
  function scrollBusinessLogos(direction: -1 | 1) {
    businessLogoListRef.current?.scrollBy({ left: direction * 280, behavior: 'smooth' });
  }
  async function requestOrderCancellation(order: MealOrder) {
    const newStatus = order.status === 'pending'
      ? 'cancelled'
      : 'cancellation_requested';
    const enteredReason = window.prompt('Motivo de cancelación (opcional):');
    if (enteredReason === null) return;

    setCustomerOrderBusyId(order.id);
    setOrdersError('');
    try {
      await updateMealOrderStatus(order.id, newStatus, enteredReason.trim() || null);
      setOrdersReload(current => current + 1);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setOrdersError(`No se pudo cancelar o solicitar la cancelación: ${detail}`);
    } finally {
      setCustomerOrderBusyId(null);
    }
  }
  const confirm = async () => {
    if (!selected || selected.kind !== 'business' || orderBusyRef.current) return;
    if (!session) {
      try {
        sessionStorage.setItem(pendingOrderKey, JSON.stringify({
          selectedId,
          selectedKind,
          cart,
          delivery,
          address,
          references: deliveryReferences,
          productNotes,
          orderNotes,
          method,
        }));
        navigate('/login?next=%2Fhungry');
      } catch {
        setNotice('Iniciá sesión para continuar con tu pedido. No se pudo guardar el carrito temporalmente.');
      }
      return;
    }
    if (!canOrder) {
      setNotice(checkoutBlockers.join(' '));
      return;
    }
    const customerPhone = normalizedCustomerPhone;
    if (!customerPhone) {
      setNotice('Completá el teléfono del cliente antes de confirmar.');
      return;
    }
    const requestKey = orderRequestKey ?? crypto.randomUUID();
    setOrderRequestKey(requestKey);
    orderBusyRef.current = true;
    setOrderBusy(true);
    setNotice('');
    setConfirmedOrder(null);
    let savedOrderId: string | null = null;
    let savedOrderNumber: number | null = null;
    try {
      if (!isOrderCheckoutV2Enabled) {
        if (!supabase) throw new Error('No hay conexión con Supabase. Intentá de nuevo.');
        const { data, error } = await supabase
          .from('morfi_profiles')
          .update({ phone: customerPhone })
          .eq('id', session.user.id)
          .select('phone')
          .single();
        if (error || data?.phone !== customerPhone) {
          console.error('No se pudo guardar el teléfono del cliente antes de crear el pedido:', error);
          throw new Error('No pudimos guardar tu teléfono para el pedido. Intentá de nuevo.');
        }
      }
      const createdOrder = await createMealOrder({
        businessId: selected.id,
        customerPhone,
        items: lines.map(dish => ({
          productId: dish.id,
          quantity: cart[dish.id],
          customerNotes: productNotes[dish.id]?.trim() || null,
        })),
        deliveryMode: delivery,
        deliveryAddress: delivery === 'delivery' ? address.trim() : null,
        deliveryReferences: delivery === 'delivery' ? deliveryReferences.trim() || null : null,
        customerNotes: orderNotes.trim() || null,
        paymentMethod: method,
        requestKey,
      });
      savedOrderId = createdOrder.id;
      savedOrderNumber = createdOrder.orderNumber;
      const persistedOrder = await getWhatsAppOrderDetails(createdOrder.id);
      const orderLabel = String(
        persistedOrder.order_number ?? createdOrder.orderNumber ?? createdOrder.id.slice(0, 8),
      );
      const orderDetails = persistedOrder.items.map(item =>
        `${item.quantity}, ${item.product_name}: ${money(item.line_total)}`,
      ).join('\n');
      const orderMessage = [
        '🍔 NUEVO PEDIDO DESDE MORFI',
        '',
        `🏪 Emprendimiento: ${selected.name}`,
        `🔢 Número de pedido: #${orderLabel}`,
        `👤 Cliente: ${persistedOrder.customer_name}`,
        `📱 Teléfono: ${persistedOrder.customer_phone ?? customerPhone}`,
        '',
        '🛒 PRODUCTOS',
        orderDetails,
        ...persistedOrder.items
          .filter(item => item.customer_notes?.trim())
          .map(item => `  Observación (${item.product_name}): ${item.customer_notes?.trim()}`),
        ...(persistedOrder.customer_notes?.trim()
          ? ['', `📝 Observaciones generales: ${persistedOrder.customer_notes.trim()}`]
          : []),
        '',
        `🚚 Entrega: ${persistedOrder.delivery_mode === 'pickup' ? 'Retiro en el local' : 'Delivery'}`,
        ...(persistedOrder.delivery_mode === 'pickup' && selected.location
          ? [`📍 Ubicación del local: ${selected.location}`]
          : []),
        ...(persistedOrder.delivery_mode === 'delivery' ? [
          `📍 Dirección: ${persistedOrder.delivery_address ?? ''}`,
          ...(persistedOrder.delivery_references?.trim()
            ? [`Referencias: ${persistedOrder.delivery_references.trim()}`]
            : []),
          'Costo de envío: a coordinar con el emprendimiento por WhatsApp.',
        ] : []),
        '',
        `Subtotal de productos: ${money(persistedOrder.subtotal)}`,
        ...(persistedOrder.discount_total > 0
          ? [`Descuento en efectivo: -${money(persistedOrder.discount_total)}`]
          : []),
        ...(persistedOrder.delivery_mode === 'delivery'
          ? ['💰 Total del pedido: costo de envío a coordinar.']
          : [`💰 TOTAL: ${persistedOrder.total === null ? money(persistedOrder.subtotal - persistedOrder.discount_total) : money(persistedOrder.total)}`]),
        '',
        ...(persistedOrder.payment_method === 'transfer' ? [
          '🏦 PAGO POR TRANSFERENCIA',
          '⏳ Pago pendiente. El emprendimiento coordinará los datos para completar la transferencia por este chat.',
        ] : [
          '💵 PAGO EN EFECTIVO',
          '⏳ Pago pendiente al retirar o recibir el pedido.',
        ]),
      ].join('\n');
      const orderUrl = selected.phone ? whatsappUrl(selected.phone, orderMessage) : null;
      if (!orderUrl) {
        throw new Error('El pedido se registró, pero el WhatsApp público del emprendimiento no es válido.');
      }
      try {
        sessionStorage.removeItem(pendingOrderKey);
      } catch (error) {
        console.warn('No se pudo limpiar el carrito temporal después de confirmar:', error);
      }
      setCart({});
      setProductNotes({});
      setOrderNotes('');
      setAddress('');
      setDeliveryReferences('');
      setOrderRequestKey(null);
      setOrdersReload(current => current + 1);
      setConfirmedOrder({
        orderLabel,
        whatsappOrderUrl: orderUrl,
      });
      let whatsappOpened = false;
      try {
        const whatsappWindow = window.open(orderUrl, '_blank');
        whatsappOpened = whatsappWindow !== null;
        if (whatsappWindow) whatsappWindow.opener = null;
      } catch (error) {
        console.warn('No se pudo abrir WhatsApp después de registrar el pedido:', error);
      }
      setNotice(whatsappOpened
        ? `El pedido #${orderLabel} quedó registrado. Revisá el mensaje y presioná Enviar en WhatsApp.`
        : `El pedido #${orderLabel} quedó registrado. Si WhatsApp no se abrió, usá el botón para reintentar sin crear otro pedido.`);
    } catch (error) {
      if (savedOrderId) {
        setNotice(
          `El pedido #${savedOrderNumber ?? savedOrderId.slice(0, 8)} quedó registrado, pero no se pudo preparar WhatsApp. Reintentá sin cambiar el carrito para reutilizar el mismo pedido.`,
        );
      } else {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        setNotice(`No se pudo confirmar el pedido: ${detail}`);
      }
    } finally {
      orderBusyRef.current = false;
      setOrderBusy(false);
    }
  };
  return (
    <div className="min-h-screen bg-[#FFF3E5] px-4 py-8 text-[#8B3F14]">
      <div className="mx-auto max-w-6xl">
        <Link to="/" className="font-semibold hover:underline">← Volver al inicio</Link>
        <div className="mt-6 mb-6">
          <h1 className="text-4xl font-black">Tengo hambre</h1>
          <p className="mt-2 text-gray-600">Explorá comidas y productos de negocios. Para confirmar un pedido, iniciá sesión.</p>
          <p className="mt-3 inline-block rounded-lg bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">Los pedidos de emprendimientos se guardan en MORFI.</p>
        </div>
        {!selected ? (
          <>
            <section className="mb-7 rounded-2xl bg-white p-4 shadow-sm" aria-labelledby="business-logo-strip-heading">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 id="business-logo-strip-heading" className="font-bold">Emprendimientos</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={prioritizeNearbyBusinesses}
                    className="rounded-lg border border-[#E8C9AA] px-3 py-2 text-sm font-semibold"
                  >
                    Mostrar cercanos
                  </button>
                  <div className="hidden gap-1 md:flex">
                    <button type="button" onClick={() => scrollBusinessLogos(-1)} aria-label="Desplazar emprendimientos a la izquierda" className="rounded-lg border px-3 py-2">←</button>
                    <button type="button" onClick={() => scrollBusinessLogos(1)} aria-label="Desplazar emprendimientos a la derecha" className="rounded-lg border px-3 py-2">→</button>
                  </div>
                </div>
              </div>
              {locationNotice && <p className="mb-3 text-sm text-gray-600" role="status">{locationNotice}</p>}
              {catalogLoading && <p className="py-2 text-sm text-gray-500" role="status">Cargando emprendimientos…</p>}
              {!catalogLoading && catalogError && <p className="py-2 text-sm text-red-700" role="alert">{catalogError}</p>}
              {!catalogLoading && !catalogError && nearbyBusinesses.length === 0 && (
                <p className="py-2 text-sm text-gray-500">Todavía no hay emprendimientos publicados.</p>
              )}
              {nearbyBusinesses.length > 0 && (
                <div ref={businessLogoListRef} className="flex gap-4 overflow-x-auto scroll-smooth pb-2" aria-label="Logos de emprendimientos publicados">
                  {nearbyBusinesses.map(shop => (
                    <button
                      key={shop.id}
                      type="button"
                      onClick={() => choose(shop.id, 'business')}
                      className="flex w-20 shrink-0 flex-col items-center gap-2 text-center text-xs font-semibold"
                    >
                      <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-[#F6A623] bg-[#FFF3E5] text-2xl">
                        {shop.logo.startsWith('data:image/') || shop.logo.startsWith('http') || shop.logo.startsWith('/')
                          ? <img src={shop.logo} alt="" className="h-full w-full object-contain p-1" />
                          : shop.logo}
                      </span>
                      <span className="line-clamp-2 w-full">{shop.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
            {catalogLoading && (
              <p className="mb-5 rounded-xl bg-white p-4 text-sm text-gray-600" role="status">
                Cargando emprendimientos publicados…
              </p>
            )}
            {catalogError && (
              <div className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">
                <p>{catalogError}</p>
                <button type="button" onClick={() => setCatalogReload(current => current + 1)} className="mt-2 underline">
                  Reintentar carga
                </button>
              </div>
            )}
            <label htmlFor="search-shops" className="mb-2 block font-semibold">Buscar negocios o comidas</label>
            <input id="search-shops" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Buscar milanesas, ensaladas, rotisería..." className="mb-7 w-full rounded-xl border border-gray-300 bg-white p-4 outline-none focus:border-[#8B3F14]" />
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
              {filtered.map(shop => (
                <article key={shop.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="relative h-40">
                    <img src={shop.cover} alt={`Comidas de ${shop.name}`} className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute -bottom-5 left-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-[#FFF3E5] text-3xl shadow-sm" aria-hidden="true">
                      {shop.logo.startsWith('data:image/') || shop.logo.startsWith('http') || shop.logo.startsWith('/')
                        ? <img src={shop.logo} alt="" className="h-full w-full object-contain p-1" />
                        : shop.logo}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-5 pt-8">
                    <span className="text-sm font-semibold text-[#C46018]">{shop.category}</span>
                    <h2 className="mt-1 text-xl font-bold">{shop.name}</h2>
                    <RatingDisplay average={shop.averageRating} count={shop.reviewCount} />
                    <p className="mt-1 text-xs font-semibold text-gray-500">
                      {shop.kind === 'supplier'
                        ? `${shop.dishes.length} productos disponibles${shop.acceptsDelivery ? ' · Delivery' : ''}`
                        : `${shop.isOpen ? 'Abierto' : 'Cerrado'} · ${shop.acceptsPickup ? 'Retiro' : ''}${shop.acceptsPickup && shop.acceptsDelivery ? ' · ' : ''}${shop.acceptsDelivery ? 'Delivery' : ''}`}
                    </p>
                    <p className="mt-2 mb-4 flex-1 text-gray-600">{shop.description}</p>
                    <p className="mb-4 font-semibold">{shop.dishes.length > 0 ? `Desde ${money(Math.min(...shop.dishes.map(d => d.price)))}` : 'Sin productos disponibles por el momento'}</p>
                    <button onClick={() => choose(shop.id, shop.kind)} className="rounded-xl bg-[#8B3F14] px-4 py-3 font-bold text-white hover:bg-[#B84E0E]">{shop.dishes.length > 0 ? `Ver ${shop.dishes.length} ${shop.kind === 'supplier' ? 'productos' : 'opciones'}` : 'Ver negocio'} →</button>
                  </div>
                </article>
              ))}
            </div>
            {!catalogLoading && !catalogError && allShops.length === 0 && (
              <p className="rounded-xl bg-white p-8 text-center text-gray-700">
                Todavía no hay emprendimientos publicados en MORFI.
              </p>
            )}
            {!catalogLoading && !catalogError &&
              allShops.length > 0 && filtered.length === 0 && <p className="py-8 text-center">No encontramos resultados para esa búsqueda.</p>}
          </>
        ) : (
          <>
            <button onClick={() => { setSelectedId(null); setNotice(''); }} className="mb-5 font-semibold underline">← Volver a los negocios</button>
            <p className="mb-1 text-sm font-bold uppercase tracking-wide text-[#C46018]">Comidas · Emprendimiento</p>
            <h2 className="mb-2 text-2xl font-black">{selected.name}</h2>
            <RatingDisplay average={selected.averageRating} count={selected.reviewCount} />
            <p className="mb-6 text-gray-600">{selected.description}</p>
            {(selected.phone || selected.location ||
              (selected.latitude != null && selected.longitude != null)) && (
              <div className="mb-5 rounded-xl bg-white p-4 shadow-sm">
                {selected.location && <p className="mt-1"><strong>Local:</strong> {selected.location}{selected.directions ? ` · ${selected.directions}` : ''}</p>}
                {selected.phone && <p className="mt-1"><strong>WhatsApp:</strong> {selected.phone}</p>}
                {selected.kind === 'business' && selected.latitude != null && selected.longitude != null && (
                  <BusinessLocationMap latitude={selected.latitude} longitude={selected.longitude} />
                )}
                {shopContactUrl && <a href={shopContactUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white">Contactar por WhatsApp</a>}
              </div>
            )}
            {selected.kind === 'business' && (
              <section className="mb-5 rounded-xl bg-white p-4 shadow-sm" aria-labelledby="business-reviews-heading">
                <h3 id="business-reviews-heading" className="font-bold">Opiniones del emprendimiento</h3>
                {businessReviewsLoading && <p role="status" className="mt-2 text-sm text-gray-500">Cargando opiniones…</p>}
                {businessReviewsError && <p role="alert" className="mt-2 text-sm text-red-700">{businessReviewsError}</p>}
                {!businessReviewsLoading && !businessReviewsError && businessReviews.length === 0 && (
                  <p className="mt-2 text-sm text-gray-600">Todavía no hay opiniones.</p>
                )}
                <ul className="mt-2 space-y-3">
                  {businessReviews.map((review, index) => (
                    <li key={`${selected.id}-review-${index}`} className="border-t pt-3">
                      <p className="text-amber-700" aria-label={`${review.rating} de 5 estrellas`}>
                        <span aria-hidden="true">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
                      </p>
                      {review.comment && <p className="mt-1 text-sm">{review.comment}</p>}
                      <p className="mt-1 text-xs text-gray-500">{new Date(review.created_at).toLocaleDateString('es-AR')}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <section className="space-y-3" aria-label="Menú">
                {selected.dishes.map(d => (
                  <article key={d.id} className="flex flex-col gap-3 rounded-xl bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <img src={d.image} alt={d.name} className="h-20 w-24 shrink-0 rounded-lg object-cover" loading="lazy" />
                      <div>
                        <h3 className="font-bold">{d.name}</h3>
                        <p className="text-sm text-gray-600">{d.description}</p>
                        <RatingDisplay average={d.averageRating ?? null} count={d.reviewCount ?? 0} />
                        {selected.kind === 'supplier' && (
                          <p className="mt-1 text-xs font-semibold text-green-800">
                            Disponible{d.saleUnit ? ` · Presentación: ${d.saleUnit}` : ''}
                          </p>
                        )}
                        {d.promotionTitle && <p className="mt-1 text-xs font-bold text-green-800">{d.promotionTitle}</p>}
                        <p className="mt-2 font-bold">{money(d.price)}{d.saleUnit ? ` / ${d.saleUnit}` : ''}</p>
                        {d.originalPrice && <p className="text-sm text-gray-500 line-through">{money(d.originalPrice)}</p>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button aria-label={'Quitar ' + d.name} onClick={() => updateQty(d.id, -1)} className="rounded-lg border px-3 py-2 font-bold">−</button>
                      <span className="w-5 text-center">{cart[d.id] || 0}</span>
                      <button aria-label={'Agregar ' + d.name} onClick={() => updateQty(d.id, 1)} className="rounded-lg bg-[#F6A623] px-3 py-2 font-bold">+</button>
                    </div>
                  </article>
                ))}
                {selected.dishes.length === 0 && (
                  <p className="rounded-xl bg-white p-5 text-gray-600">
                    Este emprendimiento no tiene productos disponibles en este momento.
                  </p>
                )}
              </section>
              <section className="h-fit rounded-2xl bg-white p-5 shadow-sm" aria-label="Carrito">
                <h3 className="mb-4 text-xl font-black">Tu carrito</h3>
                {lines.length === 0 ? <p className="text-gray-600">Agregá un producto para comenzar.</p> : lines.map(d => (
                  <div key={d.id} className="mb-4 border-b border-orange-100 pb-3 last:border-0">
                    <p className="flex justify-between gap-2 text-sm">
                      <span>{cart[d.id]} × {d.name}{d.saleUnit ? ` (${d.saleUnit})` : ''}</span>
                      <strong>{money(
                        cart[d.id] * d.price *
                        (method === 'cash' ? 1 - (d.cashDiscountPercent ?? 0) / 100 : 1),
                      )}</strong>
                    </p>
                    <label htmlFor={`product-note-${d.id}`} className="mt-2 block text-sm font-semibold">Observaciones para {d.name}</label>
                    <textarea
                      id={`product-note-${d.id}`}
                      value={productNotes[d.id] ?? ''}
                      onChange={event => setProductNotes(current => ({ ...current, [d.id]: event.target.value }))}
                      maxLength={500}
                      placeholder="Ej.: sin cebolla, sin tomate, salsa aparte"
                      className="mt-1 w-full rounded-lg border border-orange-200 p-3 text-sm"
                      rows={2}
                    />
                  </div>
                ))}
                <label htmlFor="order-notes" className="mt-2 block font-semibold">Observaciones generales</label>
                <textarea
                  id="order-notes"
                  value={orderNotes}
                  onChange={event => setOrderNotes(event.target.value)}
                  maxLength={1000}
                  placeholder="Indicaciones para todo el pedido"
                  className="mt-1 w-full rounded-lg border border-orange-200 p-3 text-sm"
                  rows={2}
                />
                <div className="my-4 border-t pt-3">
                  {selected.kind === 'supplier' && (
                    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                      El carrito es de demostración: no procesa pagos ni aplica descuentos por medio de pago. La promoción, si aparece en el producto, ya está reflejada en el precio mostrado.
                    </p>
                  )}
                  <p className="flex justify-between"><span>Subtotal</span><strong>{money(subtotal)}</strong></p>
                  {discountTotal > 0 && (
                    <p className="mt-1 flex justify-between text-green-800">
                      <span>Descuento en efectivo</span><strong>-{money(discountTotal)}</strong>
                    </p>
                  )}
                  {delivery === 'delivery' ? (
                    <p className="mt-1 text-sm text-gray-700">El costo de envío se coordina por WhatsApp.</p>
                  ) : null}
                  <p className="mt-2 flex justify-between text-lg font-black">
                    <span>{delivery === 'delivery' ? 'Subtotal de productos' : 'Total'}</span>
                    <span>{money(delivery === 'delivery' ? discountedSubtotal : total ?? discountedSubtotal)}</span>
                  </p>
                </div>
                {session && selected.kind === 'business' && (
                  <label className="mb-3 block text-sm font-semibold">
                    Tu teléfono
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={customerPhoneInput}
                      onChange={event => setCustomerPhoneInput(event.target.value)}
                      placeholder="+5492611234567"
                      className="mt-1 w-full rounded-lg border p-3 font-normal"
                      required
                    />
                    <span className="mt-1 block text-xs font-normal text-gray-600">
                      Se incluirá en el pedido para que el emprendimiento pueda contactarte.
                    </span>
                  </label>
                )}
                <label className="mb-1 block font-semibold">Modalidad de entrega</label>
                {supportsPickup && supportsDelivery ? (
                  <select
                    value={delivery}
                    onChange={event => {
                      const nextDelivery = event.target.value as 'pickup' | 'delivery';
                      setDelivery(nextDelivery);
                      if (nextDelivery === 'pickup') {
                        setAddress('');
                        setDeliveryReferences('');
                      }
                    }}
                    className="mb-3 w-full rounded-lg border p-3"
                  >
                    <option value="pickup">Retiro en el local</option>
                    <option value="delivery">Delivery</option>
                  </select>
                ) : (
                  <p className="mb-3 rounded-lg bg-orange-50 p-3 text-sm font-semibold">
                    {supportsPickup ? 'Retiro en el local' : supportsDelivery ? 'Delivery' : 'Este emprendimiento no ofrece una modalidad disponible para los productos del carrito.'}
                  </p>
                )}
                {delivery === 'delivery' && supportsDelivery && (
                  <div className="mb-3 space-y-3">
                    <label className="block text-sm font-semibold">
                      Dirección de entrega
                      <input
                        aria-label="Dirección de entrega"
                        value={address}
                        onChange={event => setAddress(event.target.value)}
                        placeholder="Calle, número, localidad"
                        className="mt-1 w-full rounded-lg border p-3 font-normal"
                      />
                    </label>
                    <label className="block text-sm font-semibold">
                      Referencias (opcional)
                      <textarea
                        value={deliveryReferences}
                        onChange={event => setDeliveryReferences(event.target.value)}
                        maxLength={300}
                        placeholder="Piso, departamento, entre calles, indicaciones"
                        className="mt-1 w-full rounded-lg border p-3 font-normal"
                        rows={2}
                      />
                    </label>
                    {selected.kind === 'business' && selected.deliveryFee === null && (
                      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                        Envío a confirmar con el emprendimiento. Podés registrar el pedido ahora.
                        {' No transfieras hasta conocer el costo de envío y el total definitivo.'}
                      </p>
                    )}
                  </div>
                )}
                <fieldset className="mb-3">
                  <legend className="mb-2 font-semibold">Elegí el medio de pago</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className={`flex items-start gap-2 rounded-lg border p-3 ${cashAvailable ? 'cursor-pointer border-orange-200' : 'cursor-not-allowed border-gray-200 opacity-50'}`}>
                      <input
                        type="radio"
                        name="payment-method"
                        value="cash"
                        checked={method === 'cash'}
                        disabled={!cashAvailable}
                        onChange={() => choosePaymentMethod('cash')}
                      />
                      <span>
                        <strong className="block">Efectivo</strong>
                        <span className="text-sm text-gray-600">Al retirar o recibir</span>
                      </span>
                    </label>
                    <label className={`flex items-start gap-2 rounded-lg border p-3 ${transferAvailable ? 'cursor-pointer border-orange-200' : 'cursor-not-allowed border-gray-200 opacity-50'}`}>
                      <input
                        type="radio"
                        name="payment-method"
                        value="transfer"
                        checked={method === 'transfer'}
                        disabled={!transferAvailable}
                        onChange={() => choosePaymentMethod('transfer')}
                      />
                      <span>
                        <strong className="block">Transferencia bancaria</strong>
                        <span className="text-sm text-gray-600">El emprendimiento coordina el pago por WhatsApp</span>
                      </span>
                    </label>
                  </div>
                  {lines.length === 0 && (
                    <p className="mt-2 text-sm text-gray-600">Agregá productos para ver los medios de pago disponibles.</p>
                  )}
                  {lines.length > 0 && !cashAvailable && !transferAvailable && (
                    <p role="alert" className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                      No hay un medio de pago común aceptado por todos los productos del carrito.
                    </p>
                  )}
                </fieldset>
                {method === 'cash' && lines.length > 0 && (
                  <p className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-900">
                    El pago queda pendiente y se realiza en efectivo al retirar o recibir el pedido.
                  </p>
                )}
                {lines.length > 0 && (
                  <section className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4" aria-label="Resumen del pedido">
                    <h4 className="font-black">Resumen del pedido</h4>
                    <ul className="mt-2 space-y-2 text-sm">
                      {lines.map(dish => (
                        <li key={`summary-${dish.id}`}>
                          <div className="flex justify-between gap-2">
                            <span>
                              {cart[dish.id]} × {dish.name} · {money(
                                dish.price *
                                (method === 'cash'
                                  ? 1 - (dish.cashDiscountPercent ?? 0) / 100
                                  : 1),
                              )} c/u
                            </span>
                            <strong>{money(
                              cart[dish.id] * dish.price *
                              (method === 'cash'
                                ? 1 - (dish.cashDiscountPercent ?? 0) / 100
                                : 1),
                            )}</strong>
                          </div>
                          {productNotes[dish.id]?.trim() && <p className="mt-1 text-gray-700">Observación: {productNotes[dish.id].trim()}</p>}
                        </li>
                      ))}
                    </ul>
                    {orderNotes.trim() && <p className="mt-2 text-sm"><strong>Observaciones generales:</strong> {orderNotes.trim()}</p>}
                    <p className="mt-2 text-sm"><strong>Entrega:</strong> {delivery === 'pickup' ? 'Retiro en el local' : `Delivery · ${address.trim() || 'Dirección pendiente'}`}</p>
                    {delivery === 'delivery' && deliveryReferences.trim() && <p className="mt-1 text-sm"><strong>Referencias:</strong> {deliveryReferences.trim()}</p>}
                    <p className="mt-1 text-sm"><strong>Pago:</strong> {method === 'cash' ? 'Efectivo' : 'Transferencia bancaria'}</p>
                    <div className="mt-3 space-y-1 border-t border-orange-200 pt-2 text-sm">
                      <p className="flex justify-between"><span>Subtotal</span><strong>{money(subtotal)}</strong></p>
                      {discountTotal > 0 && <p className="flex justify-between text-green-800"><span>Descuento en efectivo</span><strong>-{money(discountTotal)}</strong></p>}
                      {delivery === 'delivery' ? (
                        <p className="text-gray-700">Costo de envío a coordinar por WhatsApp.</p>
                      ) : null}
                      <p className="flex justify-between text-base font-black">
                        <span>{delivery === 'delivery' ? 'Subtotal de productos' : 'Total'}</span>
                        <span>{money(delivery === 'delivery' ? discountedSubtotal : total ?? discountedSubtotal)}</span>
                      </p>
                    </div>
                  </section>
                )}
                {checkoutBlockers.length > 0 && (
                  <ul role="alert" className="mt-3 list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-8 text-sm text-amber-900">
                    {checkoutBlockers.map(blocker => <li key={blocker}>{blocker}</li>)}
                  </ul>
                )}
                <button disabled={orderBusy || (session ? !canOrder : !canPlaceOrder)} onClick={() => void confirm()} className="mt-4 min-h-14 w-full rounded-xl bg-[#8B3F14] p-4 text-lg font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {!session ? 'Iniciar sesión para continuar' : orderBusy ? 'Registrando pedido…' : 'Confirmar pedido por WhatsApp'}
                </button>
                {ordersError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{ordersError}</p>}
                {notice && <p role="status" className="mt-3 rounded-lg bg-green-100 p-3 text-sm font-semibold">{notice}</p>}
                {confirmedOrder && (
                  <section className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4" aria-label="Pedido confirmado">
                    <h4 className="font-black">Pedido #{confirmedOrder.orderLabel} confirmado</h4>
                    <p className="mt-1 text-sm">
                      El pedido ya está registrado en MORFI. WhatsApp no lo envía automáticamente: revisá el mensaje y presioná Enviar.
                    </p>
                    {confirmedOrder.whatsappOrderUrl ? (
                      <a
                        href={confirmedOrder.whatsappOrderUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-green-700 px-4 py-4 text-center text-lg font-black text-white"
                      >
                        Enviar pedido por WhatsApp
                      </a>
                    ) : (
                      <p role="status" className="mt-3 rounded-lg bg-white p-3 text-sm text-amber-900">
                        El pedido quedó confirmado, pero este emprendimiento no tiene un WhatsApp público disponible.
                      </p>
                    )}
                  </section>
                )}
              </section>
            </div>
          </>
        )}
        <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-black">Mis pedidos</h2>
            <button type="button" onClick={() => setOrdersReload(current => current + 1)} className="text-sm font-semibold underline">Actualizar</button>
          </div>
          {ordersLoading && <p role="status" className="mt-3 text-sm text-gray-600">Cargando tus pedidos…</p>}
          {ordersError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{ordersError}</p>}
          {!ordersLoading && !ordersError && customerOrders.length === 0 && (
            <p className="mt-3 text-gray-600">{session ? 'Todavía no tenés pedidos de emprendimientos.' : 'Iniciá sesión para consultar tus pedidos.'}</p>
          )}
          {customerOrders.map(order => (
            <div key={order.id} className="mt-3 rounded-xl border p-3">
              <div className="flex flex-wrap justify-between gap-2">
                <strong>{order.business_name} · Pedido #{order.order_number ?? order.id.slice(0, 8)}</strong>
                <span className="font-bold">
                  {order.delivery_mode === 'delivery'
                    ? `Subtotal productos: ${money(order.subtotal - order.discount_total)}`
                    : order.total === null ? 'Total pendiente' : money(order.total)}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-600">{new Date(order.created_at).toLocaleString('es-AR')} · {order.delivery_mode === 'pickup' ? 'Retiro en el local' : `Entrega: ${order.delivery_address ?? ''}`} · {order.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}</p>
              {order.delivery_mode === 'delivery' && (
                <p className="mt-1 text-sm">
                  Costo de envío a coordinar por WhatsApp
                  {order.delivery_references && ` · Referencias: ${order.delivery_references}`}
                </p>
              )}
              {order.customer_notes && <p className="mt-1 text-sm"><strong>Observaciones del pedido:</strong> {order.customer_notes}</p>}
              <p className="mt-1 text-sm font-semibold">Pago: {paymentStatusLabel(order.payment_status, order.delivery_fee_status)}</p>
              <p className="mt-2 font-bold">{orderStatusLabel(order.status, order.delivery_mode)}</p>
              {order.status_reason && <p className="mt-1 text-sm text-gray-600">Motivo: {order.status_reason}</p>}
              {['pending', 'accepted', 'preparing', 'ready'].includes(order.status) && (
                <button
                  type="button"
                  onClick={() => void requestOrderCancellation(order)}
                  disabled={customerOrderBusyId === order.id}
                  className="mt-2 rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
                >
                  {customerOrderBusyId === order.id ? 'Enviando…' : order.status === 'pending' ? 'Cancelar pedido' : 'Solicitar cancelación'}
                </button>
              )}
              <ul className="mt-2 text-sm">
                {order.items.map((item, index) => <li key={`${order.id}-item-${index}`}>{item.quantity} × {item.product_name} · {money(item.line_total)}{item.customer_notes ? ` · Obs.: ${item.customer_notes}` : ''}</li>)}
              </ul>
              {order.history.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-semibold">Historial de estados</summary>
                  <ol className="mt-2 space-y-1">
                    {order.history.map((entry, index) => (
                      <li key={`${order.id}-history-${index}`}>
                        {new Date(entry.created_at).toLocaleString('es-AR')} · {orderStatusLabel(entry.status, order.delivery_mode)}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {order.status === 'delivered' && (
                <OrderReviewForm
                  order={order}
                  onSubmitted={() => setCatalogReload(current => current + 1)}
                />
              )}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
