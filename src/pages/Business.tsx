
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

type Product = {
  id: number;
  name: string;
  price: number;
  available: boolean;
};

type Order = {
  id: number;
  customer: string;
  product: string;
  total: number;
  status: 'Pendiente' | 'Preparando' | 'Entregado';
};

const initialProducts: Product[] = [
  { id: 1, name: 'Milanesa con puré', price: 9500, available: true },
  { id: 2, name: 'Tarta de verduras', price: 8000, available: true },
  { id: 3, name: 'Pollo al horno con papas', price: 10500, available: true },
];

const initialOrders: Order[] = [
  { id: 101, customer: 'Cliente demo 1', product: 'Milanesa con puré', total: 9500, status: 'Pendiente' },
  { id: 102, customer: 'Cliente demo 2', product: 'Tarta de verduras', total: 8000, status: 'Preparando' },
  { id: 103, customer: 'Cliente demo 3', product: 'Pollo al horno con papas', total: 10500, status: 'Entregado' },
];

function loadData<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

const money = (value: number) =>
  value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });

export default function Business() {
  const [products, setProducts] = useState<Product[]>(() =>
    loadData('morfi_business_products', initialProducts)
  );
  const [orders, setOrders] = useState<Order[]>(() =>
    loadData('morfi_business_orders', initialOrders)
  );
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [tab, setTab] = useState<'productos' | 'pedidos'>('productos');

  useEffect(() => {
    localStorage.setItem('morfi_business_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('morfi_business_orders', JSON.stringify(orders));
  }, [orders]);

  const sales = orders
    .filter(order => order.status === 'Entregado')
    .reduce((sum, order) => sum + order.total, 0);

  const pending = orders.filter(order => order.status !== 'Entregado').length;

  function addProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amount = Number(price);
    if (!name.trim() || !Number.isFinite(amount) || amount <= 0) {
      alert('Ingresá un nombre y un precio válido.');
      return;
    }

    setProducts(current => [
      ...current,
      {
        id: Date.now(),
        name: name.trim(),
        price: amount,
        available: true,
      },
    ]);

    setName('');
    setPrice('');
  }

  function updatePrice(id: number) {
    const product = products.find(item => item.id === id);
    if (!product) return;

    const answer = prompt('Nuevo precio en pesos:', String(product.price));
    if (answer === null) return;

    const amount = Number(answer);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Ingresá un precio válido.');
      return;
    }

    setProducts(current =>
      current.map(item =>
        item.id === id ? { ...item, price: amount } : item
      )
    );
  }

  function updateStatus(id: number, status: Order['status']) {
    setOrders(current =>
      current.map(order =>
        order.id === id ? { ...order, status } : order
      )
    );
  }

  return (
    <main className="min-h-screen bg-[#F7FAF5] text-[#173D2B]">
      <div className="max-w-6xl mx-auto px-5 py-10">
        <Link
          to="/"
          className="inline-block mb-6 font-semibold text-[#173D2B]"
        >
          ← Volver al inicio
        </Link>

        <div className="mb-8">
          <span className="text-sm font-bold text-green-700">
            MORFI · PANEL DEMOSTRATIVO
          </span>
          <h1 className="text-3xl md:text-4xl font-black mt-2">
            Mi emprendimiento
          </h1>
          <p className="text-gray-600 mt-2">
            Administrá productos, pedidos y ventas de tu negocio gastronómico.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <p className="text-gray-500 font-semibold">Productos cargados</p>
            <p className="text-4xl font-black mt-3">{products.length}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <p className="text-gray-500 font-semibold">Pedidos en proceso</p>
            <p className="text-4xl font-black mt-3">{pending}</p>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <p className="text-gray-500 font-semibold">Ventas entregadas (demo)</p>
            <p className="text-3xl font-black mt-3">{money(sales)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <button
            type="button"
            onClick={() => setTab('productos')}
            className={`px-6 py-3 rounded-xl font-bold ${
              tab === 'productos'
                ? 'bg-[#173D2B] text-white'
                : 'bg-white border border-green-200'
            }`}
          >
            Mis productos
          </button>

          <button
            type="button"
            onClick={() => setTab('pedidos')}
            className={`px-6 py-3 rounded-xl font-bold ${
              tab === 'pedidos'
                ? 'bg-[#173D2B] text-white'
                : 'bg-white border border-green-200'
            }`}
          >
            Pedidos recibidos
          </button>
        </div>

        {tab === 'productos' ? (
          <div className="space-y-6">
            <form
              onSubmit={addProduct}
              className="bg-white rounded-2xl p-6 shadow-sm border border-green-100"
            >
              <h2 className="text-xl font-black mb-4">Agregar producto</h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="Nombre de la comida"
                  className="border border-gray-300 rounded-xl p-3"
                  required
                />

                <input
                  type="number"
                  min="1"
                  step="1"
                  value={price}
                  onChange={event => setPrice(event.target.value)}
                  placeholder="Precio en pesos"
                  className="border border-gray-300 rounded-xl p-3"
                  required
                />

                <button
                  type="submit"
                  className="bg-[#B8E86C] text-[#173D2B] font-black rounded-xl p-3"
                >
                  + Agregar producto
                </button>
              </div>
            </form>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
              <h2 className="text-xl font-black mb-5">Catálogo del negocio</h2>

              <div className="space-y-3">
                {products.map(product => (
                  <div
                    key={product.id}
                    className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4"
                  >
                    <div>
                      <p className="font-bold">{product.name}</p>
                      <p className="text-gray-600">{money(product.price)}</p>
                      <p className={`text-sm font-semibold ${
                        product.available ? 'text-green-700' : 'text-red-600'
                      }`}>
                        {product.available ? 'Disponible' : 'Agotado'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => updatePrice(product.id)}
                        className="px-4 py-2 border rounded-lg font-semibold"
                      >
                        Editar precio
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setProducts(current =>
                            current.map(item =>
                              item.id === product.id
                                ? { ...item, available: !item.available }
                                : item
                            )
                          )
                        }
                        className="px-4 py-2 bg-[#E9F5DE] rounded-lg font-semibold"
                      >
                        {product.available ? 'Marcar agotado' : 'Activar'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirm('¿Eliminar este producto?')) {
                            setProducts(current =>
                              current.filter(item => item.id !== product.id)
                            );
                          }
                        }}
                        className="px-4 py-2 text-red-700 border border-red-200 rounded-lg font-semibold"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}

                {products.length === 0 && (
                  <p className="text-gray-500">Todavía no hay productos.</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <h2 className="text-xl font-black mb-2">Gestión de pedidos</h2>
            <p className="text-gray-500 mb-6">
              Pedidos ficticios para demostrar el funcionamiento del sistema.
            </p>

            <div className="space-y-4">
              {orders.map(order => (
                <div
                  key={order.id}
                  className="border border-gray-200 rounded-xl p-4 flex flex-wrap justify-between gap-4"
                >
                  <div>
                    <p className="font-black">Pedido #{order.id}</p>
                    <p>{order.customer}</p>
                    <p className="text-gray-600">{order.product}</p>
                    <p className="font-bold mt-2">{money(order.total)}</p>
                  </div>

                  <div>
                    <label
                      htmlFor={`status-${order.id}`}
                      className="block text-sm font-semibold mb-2"
                    >
                      Estado del pedido
                    </label>

                    <select
                      id={`status-${order.id}`}
                      value={order.status}
                      onChange={event =>
                        updateStatus(
                          order.id,
                          event.target.value as Order['status']
                        )
                      }
                      className="border border-gray-300 rounded-xl p-3 bg-white"
                    >
                      <option value="Pendiente">Pendiente</option>
                      <option value="Preparando">Preparando</option>
                      <option value="Entregado">Entregado</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-gray-500 text-sm mt-10">
          MORFI Demo · Datos guardados en este navegador.
          No representa ventas ni pedidos reales.
        </p>
      </div>
    </main>
  );
}
