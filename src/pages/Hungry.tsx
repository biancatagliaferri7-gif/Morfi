import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { listPublishedBusinessCatalog } from '../business/publicCatalogService';
import type { PublicBusinessCatalog } from '../business/publicCatalogService';
import { listBusinessReviews } from '../business/reviewService';
import type { PublicReview } from '../business/reviewService';
import {
  createMealOrder,
  listCustomerMealOrders,
  orderStatusLabel,
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
  alias?: string | null;
  holder?: string | null;
  location?: string | null;
  directions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  deliveryFee: number;
  paymentMethods: ('cash' | 'transfer')[];
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
      deliveryFee: Number(business.delivery_fee),
      paymentMethods: business.payment_methods,
      averageRating: business.average_rating,
      reviewCount: business.review_count,
      phone: contact?.contact_phone ?? undefined,
      alias: contact?.transfer_alias ?? null,
      holder: contact?.transfer_holder ?? null,
      location: contact?.location ?? null,
      directions: contact?.directions ?? null,
    };
  });
}

function readPendingOrder() {
  try {
    const saved = sessionStorage.getItem(pendingOrderKey);
    return saved ? JSON.parse(saved) as { selectedId: string; selectedKind?: 'business' | 'supplier'; cart: Record<string, number>; delivery: 'pickup' | 'delivery'; address: string; method: 'cash' | 'transfer'; cash: string } : null;
  } catch {
    return null;
  }
}

function whatsappUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, '');
  const international = digits.startsWith('54')
    ? digits
    : `54${digits.replace(/^0/, '').replace(/^15/, '')}`;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
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
  const [method, setMethod] = useState<'cash' | 'transfer'>(pendingDraft?.method ?? 'cash');
  const [cash, setCash] = useState(pendingDraft?.cash ?? '');
  const [customerOrders, setCustomerOrders] = useState<MealOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderBusy, setOrderBusy] = useState(false);
  const [customerOrderBusyId, setCustomerOrderBusyId] = useState<string | null>(null);
  const [ordersReload, setOrdersReload] = useState(0);
  const [orderRequestKey, setOrderRequestKey] = useState<string | null>(null);
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
  const lines = selected?.dishes.filter(d => (cart[d.id] || 0) > 0) || [];
  const subtotal = lines.reduce((sum, d) => sum + d.price * (cart[d.id] || 0), 0);
  const deliveryAllowed = selected?.kind === 'supplier'
    ? lines.length > 0 && lines.every(d => d.acceptsDelivery)
    : selected?.acceptsDelivery ?? false;
  const deliveryFee = selected?.kind === 'business' && delivery === 'delivery' && subtotal > 0
    ? selected.deliveryFee
    : 0;
  const total = subtotal + deliveryFee;
  const cashValue = Number(cash);
  const canOrder = subtotal > 0 &&
    (delivery === 'pickup' ? selected?.acceptsPickup : deliveryAllowed && address.trim().length >= 5) &&
    (selected?.kind === 'supplier' || selected?.paymentMethods.includes(method)) &&
    (method === 'transfer' || (cash.trim() !== '' && Number.isFinite(cashValue) && cashValue >= total));
  const updateQty = (id: string, change: number) => {
    const dish = selected?.dishes.find(item => item.id === id);
    if (change > 0 && delivery === 'delivery' && selected?.kind === 'supplier' && !dish?.acceptsDelivery) {
      setDelivery('pickup');
      setAddress('');
      setNotice('El producto agregado no tiene delivery; cambiamos la modalidad a retiro.');
    }
    setOrderRequestKey(null);
    setCart(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + change) }));
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
    setCart({});
    setNotice('');
    setCash('');
    setMethod('cash');
    setAddress('');
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
    if (!selected || selected.kind !== 'business' || !canOrder || orderBusy) return;
    if (!session) {
      try {
        sessionStorage.setItem(pendingOrderKey, JSON.stringify({ selectedId, selectedKind, cart, delivery, address, method, cash }));
        navigate('/login?next=%2Fhungry');
      } catch {
        setNotice('Iniciá sesión para continuar con tu pedido. No se pudo guardar el carrito temporalmente.');
      }
      return;
    }
    const requestKey = orderRequestKey ?? crypto.randomUUID();
    setOrderRequestKey(requestKey);
    setOrderBusy(true);
    setNotice('');
    try {
      await createMealOrder({
        businessId: selected.id,
        items: lines.map(dish => ({ productId: dish.id, quantity: cart[dish.id] })),
        deliveryMode: delivery,
        deliveryAddress: delivery === 'delivery' ? address.trim() : null,
        paymentMethod: method,
        requestKey,
      });
      sessionStorage.removeItem(pendingOrderKey);
      setCart({});
      setCash('');
      setAddress('');
      setOrderRequestKey(null);
      setOrdersReload(current => current + 1);
      setNotice('El pedido se guardó en MORFI y ya está disponible para el emprendimiento.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setNotice(`No se pudo confirmar el pedido: ${detail}`);
    } finally {
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
            {(selected.phone || selected.alias || selected.location) && (
              <div className="mb-5 rounded-xl bg-white p-4 shadow-sm">
                {selected.alias && <p><strong>Alias para transferir:</strong> {selected.alias}{selected.holder ? ` · ${selected.holder}` : ''}</p>}
                {selected.location && <p className="mt-1"><strong>Local:</strong> {selected.location}{selected.directions ? ` · ${selected.directions}` : ''}</p>}
                {selected.phone && <a href={whatsappUrl(selected.phone, `Hola, quiero consultar por los productos de ${selected.name}`)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white">Contactar por WhatsApp</a>}
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
                        {d.cashDiscountPercent !== null && d.cashDiscountPercent !== undefined && d.cashDiscountPercent > 0 && (
                          <p className="mt-1 text-xs text-gray-600">{d.cashDiscountPercent}% de descuento en efectivo</p>
                        )}
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
                {lines.length === 0 ? <p className="text-gray-600">Agregá un producto para comenzar.</p> : lines.map(d => <p key={d.id} className="mb-2 flex justify-between gap-2 text-sm"><span>{cart[d.id]} × {d.name}{d.saleUnit ? ` (${d.saleUnit})` : ''}</span><strong>{money(cart[d.id] * d.price)}</strong></p>)}
                <div className="my-4 border-t pt-3">
                  {selected.kind === 'supplier' && (
                    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                      El carrito es de demostración: no procesa pagos ni aplica descuentos por medio de pago. La promoción, si aparece en el producto, ya está reflejada en el precio mostrado.
                    </p>
                  )}
                  <p className="flex justify-between"><span>Subtotal</span><strong>{money(subtotal)}</strong></p>
                  <p className="mt-1 flex justify-between"><span>{selected.kind === 'supplier' ? 'Envío (demo)' : 'Envío'}</span><strong>{money(deliveryFee)}</strong></p>
                  <p className="mt-2 flex justify-between text-lg font-black"><span>Total</span><span>{money(total)}</span></p>
                </div>
                <label className="mb-1 block font-semibold">Modalidad</label>
                <select value={delivery} onChange={e => setDelivery(e.target.value as 'pickup' | 'delivery')} className="mb-3 w-full rounded-lg border p-3">
                  <option value="pickup" disabled={!selected.acceptsPickup}>Retiro en el local</option>
                  <option value="delivery" disabled={!deliveryAllowed}>
                    {selected.kind === 'supplier' ? 'Entrega (demo, costo no calculado)' : `Entrega a domicilio (+ ${money(selected.deliveryFee)})`}
                    {!deliveryAllowed ? ' · no disponible para todo el carrito' : ''}
                  </option>
                </select>
                {delivery === 'delivery' && <input aria-label="Dirección de entrega" value={address} onChange={e => setAddress(e.target.value)} placeholder={selected.kind === 'supplier' ? 'Dirección de entrega (demo)' : 'Dirección de entrega'} className="mb-3 w-full rounded-lg border p-3" />}
                <label className="mb-1 block font-semibold">{selected.kind === 'supplier' ? 'Pago de demostración' : 'Medio de pago'}</label>
                <select value={method} onChange={e => setMethod(e.target.value as 'cash' | 'transfer')} className="mb-3 w-full rounded-lg border p-3">
                  <option value="cash">Efectivo</option>
                  <option value="transfer" disabled={selected.kind === 'business' && !selected.paymentMethods.includes('transfer')}>
                    {selected.kind === 'supplier' ? 'Transferencia simulada' : 'Transferencia'}
                  </option>
                </select>
                {method === 'cash' && <><input aria-label="Monto con el que pagás" type="number" min="0" value={cash} onChange={e => setCash(e.target.value)} placeholder="¿Con cuánto pagás?" className="w-full rounded-lg border p-3" />{cash !== '' && cashValue >= total && subtotal > 0 && <p className="mt-2 text-sm">Vuelto: <strong>{money(cashValue - total)}</strong></p>}</>}
                <button disabled={!canOrder || orderBusy} onClick={() => void confirm()} className="mt-4 w-full rounded-xl bg-[#8B3F14] p-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                  {!session ? 'Iniciar sesión para confirmar' : orderBusy ? 'Guardando pedido…' : selected.kind === 'business' ? 'Confirmar pedido' : 'Registrar pedido de demostración'}
                </button>
                {ordersError && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{ordersError}</p>}
                {notice && <p role="status" className="mt-3 rounded-lg bg-green-100 p-3 text-sm font-semibold">{notice}</p>}
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
              <div className="flex flex-wrap justify-between gap-2"><strong>{order.business_name} · Pedido #{order.id.slice(0, 8)}</strong><span className="font-bold">{money(order.total)}</span></div>
              <p className="mt-1 text-sm text-gray-600">{new Date(order.created_at).toLocaleString('es-AR')} · {order.delivery_mode === 'pickup' ? 'Retiro en el local' : `Entrega: ${order.delivery_address ?? ''}`} · {order.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}</p>
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
                {order.items.map((item, index) => <li key={`${order.id}-item-${index}`}>{item.quantity} × {item.product_name} · {money(item.line_total)}</li>)}
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
