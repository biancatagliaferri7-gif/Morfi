import { useEffect, useRef, useState } from 'react';
import { ArrowDownUp, ListChecks, MapPin, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';

type CatalogListing = {
  id: string;
  sellerId?: string;
  seller: string;
  logo: string;
  product: string;
  description: string;
  category: string;
  price: number;
  photo: string;
  phone?: string;
  sellerAlias?: string | null;
  sellerHolder?: string | null;
  sellerLocation?: string | null;
  sellerDirections?: string | null;
  delivery?: boolean;
  paymentMethods?: string[];
};

const catalogKey = 'morfi_ahorro_catalog_v1';
const catalogUpdatedEvent = 'morfi:catalog-updated';
const maxImageBytes = 1024 * 1024;
const catalogCategories = ['Almacén', 'Bebidas', 'Lácteos', 'Carnicería', 'Frutas y verduras', 'Limpieza', 'Panadería', 'Otro'];
const paymentOptions = ['Efectivo', 'Transferencia'];
type CatalogReadResult = { listings: CatalogListing[]; error: string };
const features = [
  {
    icon: <ArrowDownUp className="h-6 w-6" />,
    title: 'Compará precios',
    description: 'Encontrá productos y precios publicados por comercios y proveedores.',
  },
  {
    icon: <ListChecks className="h-6 w-6" />,
    title: 'Armá tu lista',
    description: 'Organizá lo que necesitás comprar y consultalo cuando salís a hacer las compras.',
  },
  {
    icon: <MapPin className="h-6 w-6" />,
    title: 'Descubrí cerca',
    description: 'Conocé proveedores y negocios de tu zona sin compartir tu ubicación exacta.',
  },
];

const money = (value: number) => value.toLocaleString('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
});

function readCatalog(): CatalogReadResult {
  try {
    const saved = localStorage.getItem(catalogKey);
    if (!saved) return { listings: [], error: '' };
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every((item): item is CatalogListing =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.seller === 'string' &&
      typeof item.logo === 'string' &&
      typeof item.product === 'string' &&
      typeof item.description === 'string' &&
      typeof item.category === 'string' &&
      typeof item.price === 'number' &&
      Number.isFinite(item.price) &&
      item.price > 0 &&
      typeof item.photo === 'string',
    )) {
      return { listings: [], error: 'El catálogo guardado tiene un formato inválido; no se modificaron los datos.' };
    }
    return { listings: parsed, error: '' };
  } catch {
    return { listings: [], error: 'No se pudo leer el catálogo guardado; no se modificaron los datos.' };
  }
}

function imageData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      reject(new Error('Elegí una imagen JPG, PNG o WebP.'));
      return;
    }
    if (file.size > maxImageBytes) {
      reject(new Error('La imagen debe pesar 1 MB o menos.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('No se pudo leer la imagen.'));
    };
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });
}

export default function Savings() {
  const { session, profile } = useAuth();
  const [catalogInitial] = useState(readCatalog);
  const [listings, setListings] = useState<CatalogListing[]>(catalogInitial.listings);
  const [seller, setSeller] = useState('');
  const [product, setProduct] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(catalogCategories[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [price, setPrice] = useState('');
  const [phone, setPhone] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(['Efectivo']);
  const [logo, setLogo] = useState('');
  const [photo, setPhoto] = useState('');
  const logoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(catalogInitial.error);
  const [catalogDirty, setCatalogDirty] = useState(false);
  useEffect(() => {
    if (profile?.phone) setPhone(profile.phone);
  }, [profile?.phone]);
  const filteredListings = listings.filter(item =>
    `${item.product} ${item.seller} ${item.category}`.toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es')),
  );

  useEffect(() => {
    if (!catalogDirty) return;
    try {
      localStorage.setItem(catalogKey, JSON.stringify(listings));
      window.dispatchEvent(new Event(catalogUpdatedEvent));
      setStorageError('');
    } catch {
      setStorageError('No se pudo guardar el catálogo en este navegador. Probá con imágenes más pequeñas.');
    }
  }, [catalogDirty, listings]);

  async function handleImage(
    event: React.ChangeEvent<HTMLInputElement>,
    setImage: (value: string) => void,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setImage(await imageData(file));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo cargar la imagen.');
      event.target.value = '';
    }
  }

  function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(price);
    const listingCategory = category === 'Otro' ? customCategory.trim() : category;
    if (
      !seller.trim() ||
      !product.trim() ||
      !description.trim() ||
      phone.trim().replace(/\D/g, '').length < 7 ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !logo ||
      !listingCategory ||
      paymentMethods.length === 0
    ) {
      setError('Completá los datos del comercio, categoría, teléfono, al menos un medio de pago, un precio válido y el logotipo.');
      return;
    }
    setListings(current => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sellerId: profile?.id,
      seller: seller.trim(),
      logo,
      product: product.trim(),
      description: description.trim(),
      category: listingCategory,
      price: amount,
      photo,
      phone: phone.trim(),
      sellerAlias: profile?.seller_alias,
      sellerHolder: profile?.seller_holder,
      sellerLocation: profile?.seller_location,
      sellerDirections: profile?.seller_directions,
      delivery,
      paymentMethods,
    }, ...current]);
    setCatalogDirty(true);
    setProduct('');
    setDescription('');
    setCategory(catalogCategories[0]);
    setCustomCategory('');
    setPrice('');
    setPhoto('');
    if (photoInput.current) photoInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
    setError('');
  }

  function removeListing(id: string) {
    setListings(current => current.filter(item => item.id !== id));
    setCatalogDirty(true);
  }

  return (
    <main className="min-h-screen bg-[#FFF9F2] px-4 py-8 text-[#693416] md:py-12">
      <div className="mx-auto max-w-6xl">
        <Link to="/" className="inline-flex items-center gap-2 font-semibold text-[#8B3F14] no-underline hover:text-[#C25B19]">
          <span aria-hidden="true">←</span>
          Volver al inicio
        </Link>

        <section className="mt-6 grid overflow-hidden rounded-[2rem] bg-white shadow-sm md:grid-cols-2">
          <div className="flex flex-col justify-center p-6 md:p-12">
            <span className="mb-4 w-fit rounded-full bg-[#FFF0DD] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#A14516]">
              Catálogo de comercios
            </span>
            <h1 className="text-4xl font-black leading-tight md:text-5xl">
              MORFI <span className="text-[#F07821]">Ahorro</span>
            </h1>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-[#77553C]">
              Publicá productos con el logo de tu comercio, una descripción y su precio. Explorá las publicaciones del catálogo.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#publicar" className="inline-flex items-center gap-2 rounded-xl bg-[#F07821] px-5 py-3 font-bold text-white no-underline">
                <Search className="h-5 w-5" />
                Publicar un producto
              </a>
              <span className="inline-flex items-center rounded-xl border border-[#F2DDCA] px-4 py-3 text-sm font-semibold text-[#8B3F14]">
                {listings.length} {listings.length === 1 ? 'publicación' : 'publicaciones'}
              </span>
            </div>
          </div>
          <div className="relative min-h-64 md:min-h-[390px]">
            <img
              src="https://images.unsplash.com/photo-1542838132-92c53300491e?w=1000&q=85"
              alt="Verduras frescas en un mercado"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#4B260D]/55 via-transparent to-transparent" />
            <div className="absolute bottom-5 left-5 rounded-2xl bg-white/95 px-4 py-3 shadow-lg">
              <p className="text-sm font-bold text-[#8B3F14]">Más opciones para elegir</p>
              <p className="text-xs text-[#77553C]">Productos publicados por comercios</p>
            </div>
          </div>
        </section>

        <section id="publicar" className="mt-8 rounded-2xl border border-[#F2DDCA] bg-white p-5 shadow-sm md:p-7">
          <h2 className="text-2xl font-black">Publicá en MORFI Ahorro</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#77553C]">
            Cargá tu logo, el producto, el precio y una descripción corta. En esta versión de demostración, las publicaciones quedan guardadas solamente en este navegador.
          </p>
          {!session ? (
            <p className="mt-4 rounded-xl bg-[#FFF3E5] p-4 text-sm">
              Para publicar, <Link to="/login?next=%2Fsavings" className="font-bold underline">iniciá sesión o registrate</Link> y habilitá el panel MORFI Ahorro.
            </p>
          ) : !profile?.enabled_panels?.includes('ahorro') ? (
            <p role="alert" className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              Tu cuenta no tiene habilitado MORFI Ahorro. Cerrá sesión y registrate habilitando ese panel para publicar.
            </p>
          ) : (
          <form onSubmit={publish} className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="text-sm font-semibold">
              Nombre del comercio
              <input value={seller} onChange={event => setSeller(event.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: Almacén del Barrio" />
            </label>
            <label className="text-sm font-semibold">
              Producto
              <input value={product} onChange={event => setProduct(event.target.value)} maxLength={160} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: Aceite de girasol 900 ml" />
            </label>
            <label className="text-sm font-semibold">
              ¿A qué precio lo querés vender?
              <input type="number" min="0.01" step="0.01" value={price} onChange={event => setPrice(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: 2500" />
            </label>
            <label className="text-sm font-semibold">
              Categoría
              <select value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal">
                {catalogCategories.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            {category === 'Otro' && (
              <label className="text-sm font-semibold">
                Escribí la categoría
                <input value={customCategory} onChange={event => setCustomCategory(event.target.value)} maxLength={100} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="¿Qué categoría es?" />
              </label>
            )}
            <label className="text-sm font-semibold md:col-span-2">
              Descripción breve
              <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={300} rows={2} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Presentación, marca o detalle útil para quien compra" />
            </label>
            <label className="text-sm font-semibold">
              Teléfono de contacto
              <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={30} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: +54 380 400 0000" />
            </label>
            <label className="text-sm font-semibold">
              ¿Hacés delivery?
              <select value={delivery ? 'yes' : 'no'} onChange={event => setDelivery(event.target.value === 'yes')} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal">
                <option value="no">No, solo retiro</option>
                <option value="yes">Sí, hago delivery</option>
              </select>
            </label>
            <fieldset className="rounded-xl border border-[#F2DDCA] p-3 md:col-span-2">
              <legend className="px-1 text-sm font-semibold">Medios de pago que aceptás</legend>
              <div className="flex flex-wrap gap-4">
                {paymentOptions.map(option => (
                  <label key={option} className="flex items-center gap-2 text-sm font-normal">
                    <input
                      type="checkbox"
                      checked={paymentMethods.includes(option)}
                      onChange={event => setPaymentMethods(current => event.target.checked
                        ? [...current, option]
                        : current.filter(method => method !== option))}
                    />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-sm font-semibold">
              Logotipo del comercio (máximo 1 MB)
              <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void handleImage(event, setLogo)} required={!logo} className="mt-1 block w-full rounded-xl border border-gray-300 p-2 text-sm font-normal" />
              {logo && <img src={logo} alt="Vista previa del logotipo" className="mt-2 h-16 w-16 rounded-full border object-cover" />}
            </label>
            <label className="text-sm font-semibold">
              Foto del producto (opcional, máximo 1 MB)
              <span className="mt-1 flex flex-wrap gap-2">
                <button type="button" onClick={() => cameraInput.current?.click()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Abrir cámara</button>
                <button type="button" onClick={() => photoInput.current?.click()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Elegir de galería</button>
              </span>
              <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => void handleImage(event, setPhoto)} className="sr-only" />
              <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void handleImage(event, setPhoto)} className="sr-only" />
              {photo && <img src={photo} alt="Vista previa del producto" className="mt-2 h-16 w-24 rounded-lg border object-cover" />}
              {!photo && <span className="mt-1 block text-xs font-normal text-gray-500">Podés publicar sin foto.</span>}
            </label>
            {error && <p role="alert" className="text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}
            <button type="submit" className="min-h-12 rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white hover:bg-[#B84E0E] md:col-span-2">
              Publicar producto en este catálogo
            </button>
          </form>
          )}
          {storageError && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{storageError}</p>}
        </section>

        <section className="mt-8">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-2xl font-black">Catálogo de productos</h2>
              <p className="mt-1 text-sm text-[#77553C]">Buscá productos cargados desde este navegador.</p>
            </div>
          </div>
          <label className="mb-4 block text-sm font-semibold">
            Buscar en el catálogo
            <input value={search} onChange={event => setSearch(event.target.value)} type="search" className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal" placeholder="Producto, comercio o categoría" />
          </label>
          {listings.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#E8C9AA] bg-white p-8 text-center text-[#77553C]">
              Todavía no hay productos publicados. Usá el formulario para cargar el primero.
            </p>
          ) : (
            filteredListings.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#E8C9AA] bg-white p-8 text-center text-[#77553C]">
                No encontramos productos para esa búsqueda.
              </p>
            ) : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredListings.map(item => (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-[#F2DDCA] bg-white shadow-sm">
                  {item.photo
                    ? <img src={item.photo} alt={item.product} className="h-44 w-full object-cover" loading="lazy" />
                    : <div className="flex h-44 items-center justify-center bg-[#FFF3E5] text-sm font-semibold text-[#8B3F14]">Sin foto de producto</div>}
                  <div className="p-5">
                    <div className="flex items-center gap-3">
                      <img src={item.logo} alt={`Logo de ${item.seller}`} className="h-12 w-12 rounded-full border border-[#F2DDCA] object-cover" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#8B3F14]">{item.seller}</p>
                        <p className="text-xs text-[#77553C]">{item.category}</p>
                      </div>
                    </div>
                    <h3 className="mt-4 text-lg font-black">{item.product}</h3>
                    {item.description && <p className="mt-1 min-h-10 text-sm text-[#77553C]">{item.description}</p>}
                    <p className="mt-3 text-xl font-black text-[#C25B19]">{money(item.price)}</p>
                    {item.paymentMethods?.includes('Transferencia') && item.sellerAlias && (
                      <p className="mt-2 text-sm">
                        <strong>Alias para transferir:</strong> {item.sellerAlias}
                        {item.sellerHolder ? ` · ${item.sellerHolder}` : ''}
                      </p>
                    )}
                    {item.sellerLocation && <p className="mt-1 text-sm text-[#77553C]"><strong>Local:</strong> {item.sellerLocation}{item.sellerDirections ? ` · ${item.sellerDirections}` : ''}</p>}
                    <p className="mt-2 text-sm text-[#77553C]">
                      {item.delivery ? 'Hace delivery' : 'Solo retiro'}
                      {item.paymentMethods?.length ? ` · ${item.paymentMethods.join(' / ')}` : ''}
                    </p>
                    {item.phone && (
                      <a
                        href={`https://wa.me/${item.phone.replace(/\D/g, '').startsWith('54') ? item.phone.replace(/\D/g, '') : `54${item.phone.replace(/\D/g, '').replace(/^0/, '').replace(/^15/, '')}`}?text=${encodeURIComponent(`Hola, quiero consultar por ${item.product}`)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white"
                      >
                        Consultar por WhatsApp
                      </a>
                    )}
                    <button type="button" onClick={() => removeListing(item.id)} className="mt-4 rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700">
                      Quitar publicación de prueba
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {features.map(feature => (
            <article key={feature.title} className="rounded-2xl border border-[#F2DDCA] bg-white p-6 shadow-sm">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[#FFF0DD] text-[#C25B19]">
                {feature.icon}
              </div>
              <h2 className="text-xl font-black">{feature.title}</h2>
              <p className="mt-2 leading-relaxed text-[#77553C]">{feature.description}</p>
            </article>
          ))}
        </section>

        <p role="status" className="mt-6 rounded-2xl border border-[#F4D6A8] bg-[#FFF3DA] p-4 text-sm leading-relaxed text-[#70410D]">
          <strong>Modo de demostración:</strong> el catálogo guarda las publicaciones e imágenes solo en este navegador, no las comparte con otros usuarios. Para publicar en línea habrá que configurar autenticación y conectar las tablas de Supabase después de revisar y ejecutar la migración.
        </p>
      </div>
    </main>
  );
}
