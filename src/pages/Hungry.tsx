import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { listPublishedBusinessCatalog } from '../business/publicCatalogService';
import type { PublicBusinessCatalog } from '../business/publicCatalogService';
import { listPublicMarketOffers, supplierImageUrl } from '../savings/savingsService';
import type { SupplierOffer, SupplierPromotion } from '../savings/savingsService';

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
};
type DemoOrder = { id: string; shop: string; items: { name: string; quantity: number; price: number }[]; total: number; method: string; delivery: string; address?: string; status: string; created: string };
type SellerOrderStatus = 'Pendiente' | 'Aceptado' | 'Preparando' | 'Listo para la entrega' | 'Entregado' | 'Rechazado';
const money = (value: number) => '$' + value.toLocaleString('es-AR');
const sellerOrdersKey = 'morfi_business_orders';
const pendingOrderKey = 'morfi_pending_order';
function percentPromotionPrice(basePrice: number, discountPercent: number): number {
  const baseCents = BigInt(Math.round(basePrice * 100));
  const discountBasisPoints = BigInt(Math.round(discountPercent * 100));
  const discountedCents = (
    baseCents * (10000n - discountBasisPoints) + 5000n
  ) / 10000n;
  return Number(discountedCents) / 100;
}

function promotedPrice(offer: SupplierOffer, promotions: SupplierPromotion[]): { price: number; title?: string } {
  const now = Date.now();
  const basePrice = Number(offer.price);
  const applicablePromotions = promotions
    .filter(item =>
      item.supplier_id === offer.supplier_id &&
      (item.supplier_product_id === null || item.supplier_product_id === offer.product_id) &&
      item.is_active &&
      new Date(item.starts_at).getTime() <= now &&
      new Date(item.ends_at).getTime() > now,
    )
    .map(item => ({
      item,
      price: item.discount_type === 'percent'
        ? percentPromotionPrice(basePrice, Number(item.discount_value))
        : Number(item.discount_value),
    }))
    .filter(candidate => candidate.price > 0 && candidate.price < basePrice)
    .sort((left, right) =>
      left.price - right.price || (left.item.id < right.item.id ? -1 : left.item.id > right.item.id ? 1 : 0),
    );

  const bestPromotion = applicablePromotions[0];
  return bestPromotion
    ? { price: bestPromotion.price, title: bestPromotion.item.title }
    : { price: basePrice };
}

function mapPublicCatalog(catalog: PublicBusinessCatalog[]): Shop[] {
  return catalog.map(({ business, products, contact }) => {
    const dishes = products.map(product => ({
      id: product.id,
      name: product.name,
      description: product.description,
      price: Number(product.price),
      image: product.image_path || '/morfi-emprendimiento.png',
    }));
    return {
      id: business.id,
      kind: 'business',
      name: business.name,
      category: 'Emprendimiento',
      description: business.description || 'Productos publicados por este emprendimiento.',
      logo: business.logo_path || '🍽️',
      cover: dishes[0]?.image || '/morfi-portada.jpeg',
      dishes,
      isOpen: business.is_open,
      acceptsDelivery: business.accepts_delivery,
      acceptsPickup: business.accepts_pickup,
      phone: contact?.contact_phone ?? undefined,
      alias: contact?.transfer_alias ?? null,
      holder: contact?.transfer_holder ?? null,
      location: contact?.location ?? null,
      directions: contact?.directions ?? null,
    };
  });
}

function mapMarketCatalog(
  offers: SupplierOffer[],
  promotions: SupplierPromotion[],
  contacts: Map<string, { contact_phone: string | null } | null>,
): Shop[] {
  const suppliers = new Map<string, Shop>();
  offers.forEach(offer => {
    let supplier = suppliers.get(offer.supplier_id);
    if (!supplier) {
      supplier = {
        id: offer.supplier_id,
        kind: 'supplier',
        name: offer.supplier_name,
        category: 'Mercado',
        description: offer.supplier_description || 'Productos publicados por este proveedor.',
        logo: supplierImageUrl(offer.logo_path) || '🛒',
        cover: supplierImageUrl(offer.image_path) || '/morfi-portada.jpeg',
        dishes: [],
        isOpen: true,
        acceptsDelivery: false,
        acceptsPickup: true,
        phone: contacts.get(offer.supplier_id)?.contact_phone ?? undefined,
      };
      suppliers.set(offer.supplier_id, supplier);
    }
    supplier.acceptsDelivery ||= offer.accepts_delivery;
    const pricing = promotedPrice(offer, promotions);
    supplier.dishes.push({
      id: offer.product_id,
      name: offer.product_name,
      description: offer.product_description,
      price: pricing.price,
      originalPrice: pricing.title ? Number(offer.price) : undefined,
      promotionTitle: pricing.title,
      saleUnit: offer.sale_unit,
      acceptsDelivery: offer.accepts_delivery,
      cashDiscountPercent: offer.cash_discount_percent,
      image: supplierImageUrl(offer.image_path) || '/morfi-emprendimiento.png',
    });
  });
  return [...suppliers.values()];
}

function readPendingOrder() {
  try {
    const saved = sessionStorage.getItem(pendingOrderKey);
    return saved ? JSON.parse(saved) as { selectedId: string; selectedKind?: 'business' | 'supplier'; cart: Record<string, number>; delivery: 'pickup' | 'delivery'; address: string; method: 'cash' | 'transfer'; cash: string } : null;
  } catch {
    return null;
  }
}

function readOrderHistory(key: string) {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(saved) ? saved as DemoOrder[] : [];
  } catch {
    return [];
  }
}

function whatsappUrl(phone: string, message: string) {
  const digits = phone.replace(/\D/g, '');
  const international = digits.startsWith('54')
    ? digits
    : `54${digits.replace(/^0/, '').replace(/^15/, '')}`;
  return `https://wa.me/${international}?text=${encodeURIComponent(message)}`;
}

function customerStatus(status: SellerOrderStatus) {
  switch (status) {
    case 'Aceptado': return 'Recibido y aceptado';
    case 'Preparando': return 'En preparación';
    case 'Listo para la entrega': return 'Listo para la entrega';
    case 'Entregado': return 'Entregado';
    case 'Rechazado': return 'Rechazado';
    default: return 'Recibido';
  }
}

export default function Hungry() {
  const { session, profile } = useAuth();
  const navigate = useNavigate();
  const [pendingDraft] = useState(readPendingOrder);
  const orderHistoryKey = `morfi_demo_orders_${profile?.id ?? 'guest'}`;
  const [publishedShops, setPublishedShops] = useState<Shop[]>([]);
  const [marketShops, setMarketShops] = useState<Shop[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketError, setMarketError] = useState('');
  const [catalogReload, setCatalogReload] = useState(0);
  const [search, setSearch] = useState('');
  const [mainCategory, setMainCategory] = useState<'comidas' | 'mercado'>(pendingDraft?.selectedKind === 'supplier' ? 'mercado' : 'comidas');
  const [selectedId, setSelectedId] = useState<string | null>(pendingDraft?.selectedId ?? null);
  const [selectedKind, setSelectedKind] = useState<'business' | 'supplier'>(pendingDraft?.selectedKind ?? 'business');
  const [cart, setCart] = useState<Record<string, number>>(pendingDraft?.cart ?? {});
  const [delivery, setDelivery] = useState<'pickup' | 'delivery'>(pendingDraft?.delivery ?? 'pickup');
  const [address, setAddress] = useState(pendingDraft?.address ?? '');
  const [method, setMethod] = useState<'cash' | 'transfer'>(pendingDraft?.method ?? 'cash');
  const [cash, setCash] = useState(pendingDraft?.cash ?? '');
  const [orders, setOrders] = useState<DemoOrder[]>(() => readOrderHistory(orderHistoryKey));
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
    async function loadMarketCatalog() {
      setMarketLoading(true);
      setMarketError('');
      try {
        const catalog = await listPublicMarketOffers();
        if (active) setMarketShops(mapMarketCatalog(catalog.offers, catalog.promotions, catalog.contacts));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) {
          setMarketShops([]);
          setMarketError(`No se pudo cargar el catálogo de Mercado: ${detail}`);
        }
      } finally {
        if (active) setMarketLoading(false);
      }
    }

    void loadMarketCatalog();
    return () => {
      active = false;
    };
  }, [catalogReload]);
  useEffect(() => { try { localStorage.setItem(orderHistoryKey, JSON.stringify(orders)); } catch { setNotice('No se pudo guardar el historial de pedidos de demostración en este navegador.'); } }, [orders, orderHistoryKey]);
  useEffect(() => {
    function syncSellerStatuses() {
      try {
        const saved = JSON.parse(localStorage.getItem(sellerOrdersKey) || '[]') as unknown;
        if (!Array.isArray(saved)) throw new Error('El formato de pedidos del vendedor no es válido.');
        const statuses = new Map<string, string>();
        saved.forEach(value => {
          if (
            value &&
            typeof value === 'object' &&
            typeof value.id === 'string' &&
            typeof value.status === 'string' &&
            ['Pendiente', 'Aceptado', 'Preparando', 'Listo para la entrega', 'Entregado', 'Rechazado'].includes(value.status)
          ) {
            statuses.set(value.id, customerStatus(value.status as SellerOrderStatus));
          }
        });
        setOrders(current => current.map(order => ({
          ...order,
          status: statuses.get(order.id) ?? order.status,
        })));
      } catch {
        setNotice('No se pudieron actualizar los estados de pedidos en este navegador.');
      }
    }
    syncSellerStatuses();
    window.addEventListener('storage', syncSellerStatuses);
    return () => window.removeEventListener('storage', syncSellerStatuses);
  }, []);
  const allShops = mainCategory === 'comidas' ? publishedShops : marketShops;
  const filtered = useMemo(() => allShops.filter(s => (s.name + ' ' + s.category + ' ' + s.description + ' ' + s.dishes.map(d => d.name).join(' ')).toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [allShops, search]);
  const selected = selectedId
    ? (selectedKind === 'supplier' ? marketShops : publishedShops).find(s => s.id === selectedId)
    : undefined;
  const lines = selected?.dishes.filter(d => (cart[d.id] || 0) > 0) || [];
  const subtotal = lines.reduce((sum, d) => sum + d.price * (cart[d.id] || 0), 0);
  const deliveryAllowed = selected?.kind === 'supplier'
    ? lines.length > 0 && lines.every(d => d.acceptsDelivery)
    : selected?.acceptsDelivery ?? false;
  const deliveryFee = selected?.kind === 'business' && delivery === 'delivery' && subtotal > 0 ? 1500 : 0;
  const total = subtotal + deliveryFee;
  const cashValue = Number(cash);
  const canOrder = subtotal > 0 && (delivery === 'pickup' || address.trim().length >= 5) && (method === 'transfer' || (cash.trim() !== '' && Number.isFinite(cashValue) && cashValue >= total));
  const updateQty = (id: string, change: number) => {
    const dish = selected?.dishes.find(item => item.id === id);
    if (change > 0 && delivery === 'delivery' && selected?.kind === 'supplier' && !dish?.acceptsDelivery) {
      setDelivery('pickup');
      setAddress('');
      setNotice('El producto agregado no tiene delivery; cambiamos la modalidad a retiro.');
    }
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
    setMainCategory(kind === 'supplier' ? 'mercado' : 'comidas');
    setCart({});
    setNotice('');
    setCash('');
    setAddress('');
    setDelivery('pickup');
  };
  const confirm = () => {
    if (!selected || !canOrder) return;
    if (!session) {
      try {
        sessionStorage.setItem(pendingOrderKey, JSON.stringify({ selectedId, selectedKind, cart, delivery, address, method, cash }));
        navigate('/login?next=%2Fhungry');
      } catch {
        setNotice('Iniciá sesión para continuar con tu pedido. No se pudo guardar el carrito temporalmente.');
      }
      return;
    }
    const order: DemoOrder = {
      id: 'DEMO-' + Date.now().toString().slice(-7), shop: selected.name,
      items: lines.map(d => ({ name: d.name, price: d.price, quantity: cart[d.id] })),
      total, method: method === 'cash' ? 'Efectivo' : 'Transferencia simulada',
      delivery: delivery === 'pickup' ? 'Retiro' : 'Entrega', address: delivery === 'delivery' ? address.trim() : undefined,
      status: 'Recibido', created: new Date().toLocaleString('es-AR'),
    };
    let sellerSyncMessage = 'El pedido quedó guardado únicamente en el historial local de demostración.';
    if (selected.kind === 'business') {
      sellerSyncMessage = 'El estado del cliente se actualizará en este navegador al modificar el pedido.';
      try {
        const saved = JSON.parse(localStorage.getItem(sellerOrdersKey) || '[]') as unknown;
        if (!Array.isArray(saved)) throw new Error('El formato de pedidos del vendedor no es válido.');
        localStorage.setItem(sellerOrdersKey, JSON.stringify([{
          id: order.id,
          customer: 'Cliente de demostración',
          product: order.items.map(item => `${item.quantity} × ${item.name}`).join(', '),
          total: order.total,
          status: 'Pendiente',
        }, ...saved]));
      } catch {
        sellerSyncMessage = 'No se pudo compartir el pedido con el panel vendedor en este navegador.';
      }
    }
    setOrders(prev => [order, ...prev]);
    sessionStorage.removeItem(pendingOrderKey);
    setCart({});
    setNotice(`Pedido de demostración ${order.id} confirmado. No se envió a ningún comercio. ${sellerSyncMessage}`);
  };
  return (
    <div className="min-h-screen bg-[#FFF3E5] px-4 py-8 text-[#8B3F14]">
      <div className="mx-auto max-w-6xl">
        <Link to="/" className="font-semibold hover:underline">← Volver al inicio</Link>
        <div className="mt-6 mb-6">
          <h1 className="text-4xl font-black">Tengo hambre</h1>
          <p className="mt-2 text-gray-600">Explorá comidas y productos de negocios. Para confirmar un pedido, iniciá sesión.</p>
          <p className="mt-3 inline-block rounded-lg bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">Comidas y Mercado consultan productos de Supabase. Los pedidos, pagos y costos de envío siguen siendo de demostración; ningún pedido se envía al vendedor.</p>
        </div>
        {!selected ? (
          <>
            <div className="mb-6 grid grid-cols-2 gap-3" aria-label="Categorías principales">
              <button
                type="button"
                aria-pressed={mainCategory === 'comidas'}
                onClick={() => setMainCategory('comidas')}
                className={`rounded-xl border px-4 py-3 text-left font-bold ${mainCategory === 'comidas' ? 'border-[#8B3F14] bg-[#8B3F14] text-white' : 'border-[#E8C9AA] bg-white text-[#8B3F14]'}`}
              >
                Comidas
                <span className="mt-1 block text-xs font-normal opacity-90">Emprendimientos gastronómicos</span>
              </button>
              <button
                type="button"
                aria-pressed={mainCategory === 'mercado'}
                onClick={() => setMainCategory('mercado')}
                className={`rounded-xl border px-4 py-3 text-left font-bold ${mainCategory === 'mercado' ? 'border-[#8B3F14] bg-[#8B3F14] text-white' : 'border-[#E8C9AA] bg-white text-[#8B3F14]'}`}
              >
                Mercado
                <span className="mt-1 block text-xs font-normal opacity-90">Almacenes, supermercados y mayoristas</span>
              </button>
            </div>
            {(mainCategory === 'comidas' ? catalogLoading : marketLoading) && (
              <p className="mb-5 rounded-xl bg-white p-4 text-sm text-gray-600" role="status">
                {mainCategory === 'comidas' ? 'Cargando emprendimientos publicados…' : 'Cargando proveedores publicados en Mercado…'}
              </p>
            )}
            {(mainCategory === 'comidas' ? catalogError : marketError) && (
              <div className="mb-5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">
                <p>{mainCategory === 'comidas' ? catalogError : marketError}</p>
                <button type="button" onClick={() => setCatalogReload(current => current + 1)} className="mt-2 underline">
                  Reintentar carga
                </button>
              </div>
            )}
            <label htmlFor="search-shops" className="mb-2 block font-semibold">{mainCategory === 'comidas' ? 'Buscar negocios o comidas' : 'Buscar proveedores o productos'}</label>
            <input id="search-shops" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder={mainCategory === 'comidas' ? '🔎 Buscar milanesas, ensaladas, rotisería...' : '🔎 Buscar almacenes, productos o categorías...'} className="mb-7 w-full rounded-xl border border-gray-300 bg-white p-4 outline-none focus:border-[#8B3F14]" />
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
              {filtered.map(shop => (
                <article key={shop.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="relative h-40">
                    <img src={shop.cover} alt={`${mainCategory === 'comidas' ? 'Comidas' : 'Productos'} de ${shop.name}`} className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute -bottom-5 left-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-[#FFF3E5] text-3xl shadow-sm" aria-hidden="true">
                      {shop.logo.startsWith('data:image/') || shop.logo.startsWith('http')
                        ? <img src={shop.logo} alt="" className="h-full w-full object-cover" />
                        : shop.logo}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-5 pt-8">
                    <span className="text-sm font-semibold text-[#C46018]">{shop.category}</span>
                    <h2 className="mt-1 text-xl font-bold">{shop.name}</h2>
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
            {!(mainCategory === 'comidas' ? catalogLoading : marketLoading) &&
              !(mainCategory === 'comidas' ? catalogError : marketError) && allShops.length === 0 && (
              <p className="rounded-xl bg-white p-8 text-center text-gray-700">
                {mainCategory === 'comidas'
                  ? 'Todavía no hay emprendimientos publicados en MORFI.'
                  : 'Todavía no hay proveedores con productos publicados en Mercado.'}
              </p>
            )}
            {!(mainCategory === 'comidas' ? catalogLoading : marketLoading) &&
              !(mainCategory === 'comidas' ? catalogError : marketError) &&
              allShops.length > 0 && filtered.length === 0 && <p className="py-8 text-center">No encontramos resultados para esa búsqueda.</p>}
          </>
        ) : (
          <>
            <button onClick={() => { setSelectedId(null); setNotice(''); }} className="mb-5 font-semibold underline">← Volver a los negocios</button>
            <p className="mb-1 text-sm font-bold uppercase tracking-wide text-[#C46018]">{selected.kind === 'supplier' ? 'Mercado · Proveedor' : 'Comidas · Emprendimiento'}</p>
            <h2 className="mb-2 text-2xl font-black">{selected.name}</h2>
            <p className="mb-6 text-gray-600">{selected.description}</p>
            {(selected.phone || selected.alias || selected.location) && (
              <div className="mb-5 rounded-xl bg-white p-4 shadow-sm">
                {selected.alias && <p><strong>Alias para transferir:</strong> {selected.alias}{selected.holder ? ` · ${selected.holder}` : ''}</p>}
                {selected.location && <p className="mt-1"><strong>Local:</strong> {selected.location}{selected.directions ? ` · ${selected.directions}` : ''}</p>}
                {selected.phone && <a href={whatsappUrl(selected.phone, `Hola, quiero consultar por los productos de ${selected.name}`)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white">Contactar por WhatsApp</a>}
              </div>
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
                  <p className="mt-1 flex justify-between"><span>Envío (demo)</span><strong>{money(deliveryFee)}</strong></p>
                  <p className="mt-2 flex justify-between text-lg font-black"><span>Total</span><span>{money(total)}</span></p>
                </div>
                <label className="mb-1 block font-semibold">Modalidad</label>
                <select value={delivery} onChange={e => setDelivery(e.target.value as 'pickup' | 'delivery')} className="mb-3 w-full rounded-lg border p-3">
                  <option value="pickup">Retiro en el local</option>
                  <option value="delivery" disabled={!deliveryAllowed}>
                    {selected.kind === 'supplier' ? 'Entrega (demo, costo no calculado)' : 'Entrega a domicilio (+ $1.500 demo)'}
                    {!deliveryAllowed ? ' · no disponible para todo el carrito' : ''}
                  </option>
                </select>
                {delivery === 'delivery' && <input aria-label="Dirección de entrega" value={address} onChange={e => setAddress(e.target.value)} placeholder="Dirección de entrega (demo)" className="mb-3 w-full rounded-lg border p-3" />}
                <label className="mb-1 block font-semibold">Pago de demostración</label>
                <select value={method} onChange={e => setMethod(e.target.value as 'cash' | 'transfer')} className="mb-3 w-full rounded-lg border p-3"><option value="cash">Efectivo</option><option value="transfer">Transferencia simulada</option></select>
                {method === 'cash' && <><input aria-label="Monto con el que pagás" type="number" min="0" value={cash} onChange={e => setCash(e.target.value)} placeholder="¿Con cuánto pagás?" className="w-full rounded-lg border p-3" />{cash !== '' && cashValue >= total && subtotal > 0 && <p className="mt-2 text-sm">Vuelto: <strong>{money(cashValue - total)}</strong></p>}</>}
                <button disabled={!canOrder} onClick={confirm} className="mt-4 w-full rounded-xl bg-[#8B3F14] p-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">{session ? 'Confirmar pedido DEMO' : 'Iniciar sesión para confirmar'}</button>
                {notice && <p role="status" className="mt-3 rounded-lg bg-green-100 p-3 text-sm font-semibold">{notice}</p>}
              </section>
            </div>
          </>
        )}
        <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Mis pedidos de demostración</h2>
          <p className="mb-4 text-sm text-gray-600">Se guardan únicamente en este navegador. Los cambios del vendedor se reflejan al volver a abrir este panel.</p>
          {orders.length === 0 ? <p className="text-gray-600">Todavía no hay pedidos de prueba.</p> : orders.slice(0, 8).map(order => (
            <div key={order.id} className="mb-3 rounded-xl border p-3">
              <div className="flex flex-wrap justify-between gap-2"><strong>{order.id} · {order.shop}</strong><span className="font-bold">{money(order.total)}</span></div>
              <p className="text-sm text-gray-600">{order.created} · {order.delivery} · {order.method} · Estado: {order.status}</p>
              <p className="mt-1 text-sm">{order.items.map(item => `${item.quantity} × ${item.name}`).join(', ')}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
