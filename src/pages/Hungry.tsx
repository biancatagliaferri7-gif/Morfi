import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';

type Dish = { id: string; name: string; description: string; price: number; image: string };
type Shop = {
  id: string;
  name: string;
  category: string;
  description: string;
  logo: string;
  cover: string;
  dishes: Dish[];
  phone?: string;
  alias?: string | null;
  holder?: string | null;
  location?: string | null;
  directions?: string | null;
};
type DemoOrder = { id: string; shop: string; items: { name: string; quantity: number; price: number }[]; total: number; method: string; delivery: string; address?: string; status: string; created: string };
type SellerOrderStatus = 'Pendiente' | 'Aceptado' | 'Preparando' | 'Listo para la entrega' | 'Entregado' | 'Rechazado';
const shops: Shop[] = [
  { id: 'casa', name: 'La Cocina de Casa', category: 'Comida casera', description: 'Viandas y platos tradicionales.', logo: '🍲', cover: 'https://images.unsplash.com/photo-1547592180-85f173990554?w=900&q=80', dishes: [
    { id: 'mila', name: 'Milanesa con puré', description: 'Milanesa de carne con puré de papas.', price: 9500, image: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=700&q=80' },
    { id: 'pasta', name: 'Fideos con salsa', description: 'Pasta casera con salsa de tomate.', price: 8800, image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?w=700&q=80' },
    { id: 'tarta', name: 'Tarta de verduras', description: 'Dos porciones con ensalada.', price: 8200, image: 'https://images.unsplash.com/photo-1576458088443-04a19bb13da6?w=700&q=80' },
  ] },
  { id: 'verde', name: 'Verde y Fresco', category: 'Saludable', description: 'Ensaladas, wraps y opciones frescas.', logo: '🥗', cover: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900&q=80', dishes: [
    { id: 'ensalada', name: 'Ensalada completa', description: 'Hojas verdes, huevo, arroz y vegetales.', price: 8500, image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=700&q=80' },
    { id: 'wrap', name: 'Wrap de pollo', description: 'Pollo, verduras y aderezo suave.', price: 9000, image: 'https://images.unsplash.com/photo-1626700051175-6818013e1d4f?w=700&q=80' },
  ] },
  { id: 'barrio', name: 'Sabores del Barrio', category: 'Rotisería', description: 'Empanadas y comidas para llevar.', logo: '🥟', cover: 'https://images.unsplash.com/photo-1601924582970-9238bcb495d9?w=900&q=80', dishes: [
    { id: 'empanadas', name: 'Media docena de empanadas', description: 'Seis empanadas surtidas.', price: 7500, image: 'https://images.unsplash.com/photo-1606755962773-d324e0a13086?w=700&q=80' },
    { id: 'pizza', name: 'Pizza muzzarella', description: 'Pizza grande de ocho porciones.', price: 10500, image: 'https://images.unsplash.com/photo-1579751626657-72bc17010498?w=700&q=80' },
  ] },
  { id: 'dulce', name: 'Dulce Encuentro', category: 'Panadería', description: 'Panificados y algo rico para la merienda.', logo: '🧁', cover: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=900&q=80', dishes: [
    { id: 'medialunas', name: 'Docena de medialunas', description: 'Recién horneadas, dulces y suaves.', price: 6800, image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=700&q=80' },
    { id: 'budin', name: 'Budín casero', description: 'Porción de budín de limón.', price: 3200, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?w=700&q=80' },
  ] },
  { id: 'parrilla', name: 'El Buen Fuego', category: 'Parrilla', description: 'Clásicos de parrilla para compartir.', logo: '🔥', cover: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=900&q=80', dishes: [
    { id: 'vacio', name: 'Sándwich de vacío', description: 'Vacío a la parrilla con pan y chimichurri.', price: 9900, image: 'https://images.unsplash.com/photo-1553909489-cd47e0ef937f?w=700&q=80' },
    { id: 'provoleta', name: 'Provoleta', description: 'Provoleta dorada con orégano.', price: 7400, image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=700&q=80' },
  ] },
  { id: 'tacos', name: 'Rincón Mexicano', category: 'Internacional', description: 'Sabores caseros con un toque mexicano.', logo: '🌮', cover: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=900&q=80', dishes: [
    { id: 'tacos', name: 'Tacos de pollo', description: 'Tres tacos con pollo y vegetales.', price: 8900, image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=700&q=80' },
    { id: 'quesadillas', name: 'Quesadillas', description: 'Tortillas doradas con queso fundido.', price: 7600, image: 'https://images.unsplash.com/photo-1618040996337-56904b7850b9?w=700&q=80' },
  ] },
];
const money = (value: number) => '$' + value.toLocaleString('es-AR');
const sellerOrdersKey = 'morfi_business_orders';
const pendingOrderKey = 'morfi_pending_order';
const catalogUpdatedEvent = 'morfi:catalog-updated';

function readPublishedShops(): Shop[] {
  const grouped = new Map<string, Shop>();
  const getShop = (id: string, name: string, category: string, logo: string, phone?: string, alias?: string | null, holder?: string | null, location?: string | null, directions?: string | null) => {
    let shop = grouped.get(id);
    if (!shop) {
      shop = {
        id,
        name,
        category,
        description: 'Productos publicados por este comercio.',
        logo: logo || '🍽️',
        cover: '/pasta.jpg',
        dishes: [],
        phone,
        alias,
        holder,
        location,
        directions,
      };
      grouped.set(id, shop);
    }
    return shop;
  };

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith('morfi_business_products_')) continue;
      const ownerId = key.slice('morfi_business_products_'.length);
      const products: unknown = JSON.parse(localStorage.getItem(key) || '[]');
      if (!Array.isArray(products)) continue;
      for (const raw of products) {
        if (!raw || typeof raw !== 'object') continue;
        const product = raw as Record<string, unknown>;
        if (typeof product.sellerId !== 'string' && [1, 2, 3].includes(Number(product.id))) continue;
        if (
          product.available === false ||
          typeof product.name !== 'string' ||
          typeof product.price !== 'number' ||
          !Number.isFinite(product.price)
        ) continue;
        const sellerName = typeof product.sellerName === 'string' ? product.sellerName : 'Emprendimiento MORFI';
        const sellerId = typeof product.sellerId === 'string' ? product.sellerId : ownerId;
        const shop = getShop(
          `business-${sellerId}`,
          sellerName,
          typeof product.category === 'string' ? product.category : 'Emprendimiento',
          '🍽️',
          typeof product.sellerPhone === 'string' ? product.sellerPhone : undefined,
          typeof product.sellerAlias === 'string' ? product.sellerAlias : null,
          typeof product.sellerHolder === 'string' ? product.sellerHolder : null,
          typeof product.sellerLocation === 'string' ? product.sellerLocation : null,
          typeof product.sellerDirections === 'string' ? product.sellerDirections : null,
        );
        const image = typeof product.image === 'string' && product.image ? product.image : '/pasta.jpg';
        shop.dishes.push({
          id: String(product.id),
          name: product.name,
          description: typeof product.description === 'string' ? product.description : '',
          price: product.price,
          image,
        });
        if (shop.cover === '/pasta.jpg' && image !== '/pasta.jpg') shop.cover = image;
      }
    }

    const savings: unknown = JSON.parse(localStorage.getItem('morfi_ahorro_catalog_v1') || '[]');
    if (Array.isArray(savings)) {
      for (const raw of savings) {
        if (!raw || typeof raw !== 'object') continue;
        const listing = raw as Record<string, unknown>;
        if (
          typeof listing.product !== 'string' ||
          typeof listing.price !== 'number' ||
          !Number.isFinite(listing.price)
        ) continue;
        const sellerName = typeof listing.seller === 'string' ? listing.seller : 'Comercio MORFI Ahorro';
        const shopId = `savings-${typeof listing.sellerId === 'string' ? listing.sellerId : sellerName}`;
        const shop = getShop(
          shopId,
          sellerName,
          typeof listing.category === 'string' ? `MORFI Ahorro · ${listing.category}` : 'MORFI Ahorro',
          typeof listing.logo === 'string' ? listing.logo : '🛒',
          typeof listing.phone === 'string' ? listing.phone : undefined,
          typeof listing.sellerAlias === 'string' ? listing.sellerAlias : null,
          typeof listing.sellerHolder === 'string' ? listing.sellerHolder : null,
          typeof listing.sellerLocation === 'string' ? listing.sellerLocation : null,
          typeof listing.sellerDirections === 'string' ? listing.sellerDirections : null,
        );
        const image = typeof listing.photo === 'string' && listing.photo ? listing.photo : '/pasta.jpg';
        shop.dishes.push({
          id: String(listing.id ?? `${sellerName}-${listing.product}`),
          name: listing.product,
          description: typeof listing.description === 'string' ? listing.description : '',
          price: listing.price,
          image,
        });
        if (shop.cover === '/pasta.jpg' && image !== '/pasta.jpg') shop.cover = image;
      }
    }
  } catch {
    return [...grouped.values()];
  }
  return [...grouped.values()];
}

function readPendingOrder() {
  try {
    const saved = sessionStorage.getItem(pendingOrderKey);
    return saved ? JSON.parse(saved) as { selectedId: string; cart: Record<string, number>; delivery: 'pickup' | 'delivery'; address: string; method: 'cash' | 'transfer'; cash: string } : null;
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
  const [publishedShops, setPublishedShops] = useState(readPublishedShops);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(pendingDraft?.selectedId ?? null);
  const [cart, setCart] = useState<Record<string, number>>(pendingDraft?.cart ?? {});
  const [delivery, setDelivery] = useState<'pickup' | 'delivery'>(pendingDraft?.delivery ?? 'pickup');
  const [address, setAddress] = useState(pendingDraft?.address ?? '');
  const [method, setMethod] = useState<'cash' | 'transfer'>(pendingDraft?.method ?? 'cash');
  const [cash, setCash] = useState(pendingDraft?.cash ?? '');
  const [orders, setOrders] = useState<DemoOrder[]>(() => readOrderHistory(orderHistoryKey));
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const syncCatalog = () => setPublishedShops(readPublishedShops());
    window.addEventListener('storage', syncCatalog);
    window.addEventListener(catalogUpdatedEvent, syncCatalog);
    return () => {
      window.removeEventListener('storage', syncCatalog);
      window.removeEventListener(catalogUpdatedEvent, syncCatalog);
    };
  }, []);
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
  const allShops = useMemo(() => [...publishedShops, ...shops], [publishedShops]);
  const filtered = useMemo(() => allShops.filter(s => (s.name + ' ' + s.category + ' ' + s.description + ' ' + s.dishes.map(d => d.name).join(' ')).toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [allShops, search]);
  const selected = allShops.find(s => s.id === selectedId);
  const lines = selected?.dishes.filter(d => (cart[d.id] || 0) > 0) || [];
  const subtotal = lines.reduce((sum, d) => sum + d.price * (cart[d.id] || 0), 0);
  const deliveryFee = delivery === 'delivery' && subtotal > 0 ? 1500 : 0;
  const total = subtotal + deliveryFee;
  const cashValue = Number(cash);
  const canOrder = subtotal > 0 && (delivery === 'pickup' || address.trim().length >= 5) && (method === 'transfer' || (cash.trim() !== '' && Number.isFinite(cashValue) && cashValue >= total));
  const updateQty = (id: string, change: number) => setCart(prev => ({ ...prev, [id]: Math.max(0, (prev[id] || 0) + change) }));
  const choose = (id: string) => { setSelectedId(id); setCart({}); setNotice(''); setCash(''); setAddress(''); setDelivery('pickup'); };
  const confirm = () => {
    if (!selected || !canOrder) return;
    if (!session) {
      try {
        sessionStorage.setItem(pendingOrderKey, JSON.stringify({ selectedId, cart, delivery, address, method, cash }));
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
    let sellerSyncMessage = 'El estado del cliente se actualizará en este navegador al modificar el pedido.';
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
          <p className="mt-2 text-gray-600">Explorá los negocios y sus platos. Para confirmar un pedido, iniciá sesión.</p>
          <p className="mt-3 inline-block rounded-lg bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">Los pedidos todavía son de demostración y no se envían a comercios. También podés explorar publicaciones guardadas en este navegador desde Mi emprendimiento y MORFI Ahorro.</p>
        </div>
        {!selected ? (
          <>
            <label htmlFor="search-shops" className="mb-2 block font-semibold">Buscar negocios o comidas</label>
            <input id="search-shops" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Buscar milanesas, ensaladas, rotisería..." className="mb-7 w-full rounded-xl border border-gray-300 bg-white p-4 outline-none focus:border-[#8B3F14]" />
            <div className="grid gap-5 sm:grid-cols-2 md:grid-cols-3">
              {filtered.map(shop => (
                <article key={shop.id} className="flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                  <div className="relative h-40">
                    <img src={shop.cover} alt={`Comidas de ${shop.name}`} className="h-full w-full object-cover" loading="lazy" />
                    <span className="absolute -bottom-5 left-5 flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border-4 border-white bg-[#FFF3E5] text-3xl shadow-sm" aria-hidden="true">
                      {shop.logo.startsWith('data:image/') || shop.logo.startsWith('http')
                        ? <img src={shop.logo} alt="" className="h-full w-full object-cover" />
                        : shop.logo}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col p-5 pt-8">
                    <span className="text-sm font-semibold text-[#C46018]">{shop.category}</span>
                    <h2 className="mt-1 text-xl font-bold">{shop.name}</h2>
                    <p className="mt-2 mb-4 flex-1 text-gray-600">{shop.description}</p>
                    <p className="mb-4 font-semibold">Desde {money(Math.min(...shop.dishes.map(d => d.price)))}</p>
                    <button onClick={() => choose(shop.id)} className="rounded-xl bg-[#8B3F14] px-4 py-3 font-bold text-white hover:bg-[#B84E0E]">Ver {shop.dishes.length} opciones →</button>
                  </div>
                </article>
              ))}
            </div>
            {filtered.length === 0 && <p className="py-8 text-center">No encontramos resultados para esa búsqueda.</p>}
          </>
        ) : (
          <>
            <button onClick={() => { setSelectedId(null); setNotice(''); }} className="mb-5 font-semibold underline">← Volver a los negocios</button>
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
                      <div><h3 className="font-bold">{d.name}</h3><p className="text-sm text-gray-600">{d.description}</p><p className="mt-2 font-bold">{money(d.price)}</p></div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button aria-label={'Quitar ' + d.name} onClick={() => updateQty(d.id, -1)} className="rounded-lg border px-3 py-2 font-bold">−</button>
                      <span className="w-5 text-center">{cart[d.id] || 0}</span>
                      <button aria-label={'Agregar ' + d.name} onClick={() => updateQty(d.id, 1)} className="rounded-lg bg-[#F6A623] px-3 py-2 font-bold">+</button>
                    </div>
                  </article>
                ))}
              </section>
              <section className="h-fit rounded-2xl bg-white p-5 shadow-sm" aria-label="Carrito">
                <h3 className="mb-4 text-xl font-black">Tu carrito</h3>
                {lines.length === 0 ? <p className="text-gray-600">Agregá un plato para comenzar.</p> : lines.map(d => <p key={d.id} className="mb-2 flex justify-between gap-2 text-sm"><span>{cart[d.id]} × {d.name}</span><strong>{money(cart[d.id] * d.price)}</strong></p>)}
                <div className="my-4 border-t pt-3">
                  <p className="flex justify-between"><span>Subtotal</span><strong>{money(subtotal)}</strong></p>
                  <p className="mt-1 flex justify-between"><span>Envío (demo)</span><strong>{money(deliveryFee)}</strong></p>
                  <p className="mt-2 flex justify-between text-lg font-black"><span>Total</span><span>{money(total)}</span></p>
                </div>
                <label className="mb-1 block font-semibold">Modalidad</label>
                <select value={delivery} onChange={e => setDelivery(e.target.value as 'pickup' | 'delivery')} className="mb-3 w-full rounded-lg border p-3"><option value="pickup">Retiro en el local</option><option value="delivery">Entrega a domicilio (+ $1.500 demo)</option></select>
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
