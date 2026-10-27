import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

type Dish = { id: string; name: string; description: string; price: number };
type Shop = { id: string; name: string; category: string; description: string; dishes: Dish[] };
type DemoOrder = { id: string; shop: string; items: { name: string; quantity: number; price: number }[]; total: number; method: string; delivery: string; address?: string; status: string; created: string };
const shops: Shop[] = [
  { id: 'casa', name: 'La Cocina de Casa', category: 'Comida casera', description: 'Viandas y platos tradicionales.', dishes: [
    { id: 'mila', name: 'Milanesa con puré', description: 'Milanesa de carne con puré de papas.', price: 9500 },
    { id: 'pasta', name: 'Fideos con salsa', description: 'Pasta casera con salsa de tomate.', price: 8800 },
    { id: 'tarta', name: 'Tarta de verduras', description: 'Dos porciones con ensalada.', price: 8200 },
  ] },
  { id: 'verde', name: 'Verde y Fresco', category: 'Saludable', description: 'Ensaladas, wraps y opciones frescas.', dishes: [
    { id: 'ensalada', name: 'Ensalada completa', description: 'Hojas verdes, huevo, arroz y vegetales.', price: 8500 },
    { id: 'wrap', name: 'Wrap de pollo', description: 'Pollo, verduras y aderezo suave.', price: 9000 },
  ] },
  { id: 'barrio', name: 'Sabores del Barrio', category: 'Rotisería', description: 'Empanadas y comidas para llevar.', dishes: [
    { id: 'empanadas', name: 'Media docena de empanadas', description: 'Seis empanadas surtidas.', price: 7500 },
    { id: 'pizza', name: 'Pizza muzzarella', description: 'Pizza grande de ocho porciones.', price: 10500 },
  ] },
];
const money = (value: number) => '$' + value.toLocaleString('es-AR');
const storageKey = 'morfi_demo_orders_v1';

export default function Hungry() {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [delivery, setDelivery] = useState<'pickup' | 'delivery'>('pickup');
  const [address, setAddress] = useState('');
  const [method, setMethod] = useState<'cash' | 'transfer'>('cash');
  const [cash, setCash] = useState('');
  const [orders, setOrders] = useState<DemoOrder[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(saved) ? saved : []; }
    catch { return []; }
  });
  const [notice, setNotice] = useState('');
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(orders)); } catch { /* private mode or storage disabled */ } }, [orders]);
  const filtered = useMemo(() => shops.filter(s => (s.name + ' ' + s.category + ' ' + s.description + ' ' + s.dishes.map(d => d.name).join(' ')).toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))), [search]);
  const selected = shops.find(s => s.id === selectedId);
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
    const order: DemoOrder = {
      id: 'DEMO-' + Date.now().toString().slice(-7), shop: selected.name,
      items: lines.map(d => ({ name: d.name, price: d.price, quantity: cart[d.id] })),
      total, method: method === 'cash' ? 'Efectivo' : 'Transferencia simulada',
      delivery: delivery === 'pickup' ? 'Retiro' : 'Entrega', address: delivery === 'delivery' ? address.trim() : undefined,
      status: 'Recibido', created: new Date().toLocaleString('es-AR'),
    };
    setOrders(prev => [order, ...prev]); setCart({}); setNotice('Pedido de demostración ' + order.id + ' confirmado. No se envió a ningún comercio.');
  };
  return (
    <div className="min-h-screen bg-[#F8FAF6] px-4 py-8 text-[#173D2B]">
      <div className="mx-auto max-w-6xl">
        <Link to="/" className="font-semibold hover:underline">← Volver al inicio</Link>
        <div className="mt-6 mb-6">
          <h1 className="text-4xl font-black">Tengo hambre</h1>
          <p className="mt-2 text-gray-600">Explorá negocios, elegí tu comida y probá cómo sería un pedido.</p>
          <p className="mt-3 inline-block rounded-lg bg-amber-100 px-3 py-2 text-sm font-bold text-amber-900">MODO DEMO: todos los negocios y precios son ficticios. No se realizan pedidos ni pagos reales.</p>
        </div>
        {!selected ? (
          <>
            <label htmlFor="search-shops" className="mb-2 block font-semibold">Buscar negocios o comidas</label>
            <input id="search-shops" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="🔎 Buscar milanesas, ensaladas, rotisería..." className="mb-7 w-full rounded-xl border border-gray-300 bg-white p-4 outline-none focus:border-[#173D2B]" />
            <div className="grid gap-5 md:grid-cols-3">
              {filtered.map(shop => (
                <article key={shop.id} className="flex flex-col rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                  <span className="mb-3 text-4xl">{shop.id === 'verde' ? '🥗' : shop.id === 'barrio' ? '🥟' : '🍽️'}</span>
                  <span className="text-sm font-semibold text-[#477E58]">{shop.category}</span>
                  <h2 className="mt-1 text-xl font-bold">{shop.name}</h2>
                  <p className="mt-2 mb-4 flex-1 text-gray-600">{shop.description}</p>
                  <p className="mb-4 font-semibold">Desde {money(Math.min(...shop.dishes.map(d => d.price)))}</p>
                  <button onClick={() => choose(shop.id)} className="rounded-xl bg-[#173D2B] px-4 py-3 font-bold text-white hover:bg-[#24583E]">Ver menú →</button>
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
            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
              <section className="space-y-3" aria-label="Menú">
                {selected.dishes.map(d => (
                  <article key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-4 shadow-sm">
                    <div><h3 className="font-bold">{d.name}</h3><p className="text-sm text-gray-600">{d.description}</p><p className="mt-2 font-bold">{money(d.price)}</p></div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button aria-label={'Quitar ' + d.name} onClick={() => updateQty(d.id, -1)} className="rounded-lg border px-3 py-2 font-bold">−</button>
                      <span className="w-5 text-center">{cart[d.id] || 0}</span>
                      <button aria-label={'Agregar ' + d.name} onClick={() => updateQty(d.id, 1)} className="rounded-lg bg-[#B9E769] px-3 py-2 font-bold">+</button>
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
                <button disabled={!canOrder} onClick={confirm} className="mt-4 w-full rounded-xl bg-[#173D2B] p-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Confirmar pedido DEMO</button>
                {notice && <p role="status" className="mt-3 rounded-lg bg-green-100 p-3 text-sm font-semibold">{notice}</p>}
              </section>
            </div>
          </>
        )}
        <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-black">Mis pedidos de demostración</h2>
          <p className="mb-4 text-sm text-gray-600">Se guardan únicamente en este navegador. Los estados no se actualizan automáticamente.</p>
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
