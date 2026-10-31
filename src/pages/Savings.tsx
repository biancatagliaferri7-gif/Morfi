import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownUp, ListChecks, MapPin, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  createSupplier,
  createSupplierProduct,
  createSupplierPromotion,
  deleteSupplierProduct,
  deleteSupplierPromotion,
  listManagedSupplierOffers,
  listManagedSupplierPromotions,
  listManagedSuppliers,
  listPublicSupplierOffers,
  supplierImageUrl,
  updateSupplierLogo,
  updateSupplierMarketVisibility,
  updateSupplierProduct,
  updateSupplierPublication,
  uploadSupplierImage,
} from '../savings/savingsService';
import type { Supplier, SupplierOffer, SupplierPromotion, SupplierProductInput } from '../savings/savingsService';

type CatalogListing = {
  id: string;
  supplierId: string;
  seller: string;
  logo: string;
  product: string;
  description: string;
  category: string;
  saleUnit: string;
  comparisonKey: string;
  price: number;
  photo: string;
  phone: string;
  delivery: boolean;
  paymentMethods: ('cash' | 'transfer')[];
  cashDiscountPercent: number | null;
  isAvailable: boolean;
  isMine: boolean;
  promotion: SupplierPromotion | null;
};

const maxImageBytes = 1024 * 1024;
const catalogCategories = ['Almacén', 'Bebidas', 'Lácteos', 'Carnicería', 'Frutas y verduras', 'Limpieza', 'Panadería', 'Otro'];
const paymentOptions = [
  { value: 'cash' as const, label: 'Efectivo' },
  { value: 'transfer' as const, label: 'Transferencia' },
];
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

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado. Intentá nuevamente.';
}

function normalizeComparisonKey(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es');
}

function asListing(
  offer: SupplierOffer,
  contacts: Map<string, { contact_phone: string | null } | null>,
  managedSupplierIds: Set<string>,
  promotions: SupplierPromotion[],
): CatalogListing {
  const now = Date.now();
  const promotion = promotions.find(item =>
    item.supplier_id === offer.supplier_id &&
    (item.supplier_product_id === null || item.supplier_product_id === offer.product_id) &&
    item.is_active &&
    new Date(item.starts_at).getTime() <= now &&
    new Date(item.ends_at).getTime() > now,
  ) ?? null;

  return {
    id: offer.product_id,
    supplierId: offer.supplier_id,
    seller: offer.supplier_name,
    logo: supplierImageUrl(offer.logo_path),
    product: offer.product_name,
    description: offer.product_description,
    category: offer.category,
    saleUnit: offer.sale_unit,
    comparisonKey: offer.comparison_key,
    price: Number(offer.price),
    photo: supplierImageUrl(offer.image_path),
    phone: contacts.get(offer.supplier_id)?.contact_phone ?? '',
    delivery: offer.accepts_delivery,
    paymentMethods: offer.payment_methods,
    cashDiscountPercent: offer.cash_discount_percent,
    isAvailable: offer.is_available,
    isMine: managedSupplierIds.has(offer.supplier_id),
    promotion,
  };
}

function promotionPrice(listing: CatalogListing): number | null {
  if (!listing.promotion) return null;
  const discounted = listing.promotion.discount_type === 'percent'
    ? listing.price * (1 - Number(listing.promotion.discount_value) / 100)
    : Number(listing.promotion.discount_value);
  return discounted > 0 && discounted < listing.price ? discounted : null;
}

function supplierWhatsAppUrl(phone: string, product: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return null;
  const international = digits.startsWith('54')
    ? digits
    : `54${digits.replace(/^0/, '').replace(/^15/, '')}`;
  return `https://wa.me/${international}?text=${encodeURIComponent(`Hola, quiero consultar por ${product}`)}`;
}

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
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
  const [publicOffers, setPublicOffers] = useState<SupplierOffer[]>([]);
  const [managedOffers, setManagedOffers] = useState<SupplierOffer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [contacts, setContacts] = useState(new Map<string, { contact_phone: string | null } | null>());
  const [promotions, setPromotions] = useState<SupplierPromotion[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [managementLoading, setManagementLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [managementError, setManagementError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState('new');
  const [seller, setSeller] = useState('');
  const [supplierDescription, setSupplierDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneIsPublic, setPhoneIsPublic] = useState(false);
  const [product, setProduct] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(catalogCategories[0]);
  const [customCategory, setCustomCategory] = useState('');
  const [saleUnit, setSaleUnit] = useState('unidad');
  const [price, setPrice] = useState('');
  const [cashDiscountPercent, setCashDiscountPercent] = useState('');
  const [delivery, setDelivery] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<('cash' | 'transfer')[]>(['cash']);
  const [logo, setLogo] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [photo, setPhoto] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [editingProductId, setEditingProductId] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyListingId, setBusyListingId] = useState('');
  const [busySupplierId, setBusySupplierId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [promotionTitle, setPromotionTitle] = useState('');
  const [promotionDescription, setPromotionDescription] = useState('');
  const [promotionType, setPromotionType] = useState<'percent' | 'fixed_price'>('percent');
  const [promotionValue, setPromotionValue] = useState('');
  const [promotionProductId, setPromotionProductId] = useState('');
  const [promotionStarts, setPromotionStarts] = useState(localDateTimeValue(new Date()));
  const [promotionEnds, setPromotionEnds] = useState(localDateTimeValue(new Date(Date.now() + 86400000)));
  const [promotionBusy, setPromotionBusy] = useState(false);
  const logoInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  const managedSupplierIds = useMemo(() => new Set(suppliers.map(supplier => supplier.id)), [suppliers]);
  const selectedSupplier = suppliers.find(supplier => supplier.id === selectedSupplierId);

  const reloadPublicCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const result = await listPublicSupplierOffers();
      setPublicOffers(result.offers);
      setContacts(result.contacts);
      setPromotions(current => {
        const managed = current.filter(item => managedSupplierIds.has(item.supplier_id));
        return [...result.promotions, ...managed];
      });
    } catch (caught) {
      setCatalogError(messageFor(caught));
    } finally {
      setCatalogLoading(false);
    }
  }, [managedSupplierIds]);

  const reloadManagement = useCallback(async () => {
    if (!session?.user.id) {
      setSuppliers([]);
      setManagedOffers([]);
      setManagementLoading(false);
      return;
    }
    setManagementLoading(true);
    setManagementError('');
    try {
      const nextSuppliers = await listManagedSuppliers(session.user.id);
      const ids = nextSuppliers.map(supplier => supplier.id);
      const [nextOffers, nextPromotions] = await Promise.all([
        listManagedSupplierOffers(ids),
        listManagedSupplierPromotions(ids),
      ]);
      setSuppliers(nextSuppliers);
      setManagedOffers(nextOffers);
      setPromotions(current => [
        ...current.filter(item => !ids.includes(item.supplier_id)),
        ...nextPromotions,
      ]);
    } catch (caught) {
      setManagementError(messageFor(caught));
    } finally {
      setManagementLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    void reloadPublicCatalog();
  }, [reloadPublicCatalog]);

  useEffect(() => {
    void reloadManagement();
  }, [reloadManagement]);

  useEffect(() => {
    if (editingProductId) return;
    if (selectedSupplierId === 'new') {
      setSeller('');
      setSupplierDescription('');
      setLogo('');
      setLogoFile(null);
      if (profile?.phone) setPhone(profile.phone);
      return;
    }
    const supplier = suppliers.find(item => item.id === selectedSupplierId);
    if (!supplier) return;
    setSeller(supplier.name);
    setSupplierDescription(supplier.description);
    setLogo(supplierImageUrl(supplier.logo_path));
    setLogoFile(null);
  }, [editingProductId, profile?.phone, selectedSupplierId, suppliers]);

  const listings = useMemo(() => {
    const combined = new Map<string, SupplierOffer>();
    publicOffers.forEach(offer => combined.set(offer.product_id, offer));
    managedOffers.forEach(offer => combined.set(offer.product_id, offer));
    return [...combined.values()].map(offer =>
      asListing(offer, contacts, managedSupplierIds, promotions),
    );
  }, [contacts, managedOffers, managedSupplierIds, promotions, publicOffers]);

  const filteredListings = listings.filter(item =>
    `${item.product} ${item.seller} ${item.category}`.toLocaleLowerCase('es')
      .includes(search.toLocaleLowerCase('es')),
  );
  const currentSupplierOffers = managedOffers.filter(offer => offer.supplier_id === selectedSupplierId);
  const currentSupplierPromotions = promotions.filter(item => item.supplier_id === selectedSupplierId);

  async function handleImage(
    event: React.ChangeEvent<HTMLInputElement>,
    setImage: (value: string) => void,
    setFile: (value: File | null) => void,
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setImage(await imageData(file));
      setFile(file);
      setError('');
    } catch (caught) {
      setError(messageFor(caught));
      event.target.value = '';
    }
  }

  function resetProductForm() {
    setProduct('');
    setDescription('');
    setCategory(catalogCategories[0]);
    setCustomCategory('');
    setSaleUnit('unidad');
    setPrice('');
    setCashDiscountPercent('');
    setDelivery(false);
    setPaymentMethods(['cash']);
    setPhoto('');
    setPhotoFile(null);
    setEditingProductId('');
    if (photoInput.current) photoInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
  }

  function beginEdit(listing: CatalogListing) {
    setEditingProductId(listing.id);
    setSelectedSupplierId(listing.supplierId);
    setProduct(listing.product);
    setDescription(listing.description);
    setCategory(catalogCategories.includes(listing.category) ? listing.category : 'Otro');
    setCustomCategory(catalogCategories.includes(listing.category) ? '' : listing.category);
    setSaleUnit(listing.saleUnit);
    setPrice(String(listing.price));
    setCashDiscountPercent(listing.cashDiscountPercent === null ? '' : String(listing.cashDiscountPercent));
    setDelivery(listing.delivery);
    setPaymentMethods(listing.paymentMethods);
    setPhoto(listing.photo);
    setPhotoFile(null);
    setError('');
    setNotice('');
    document.getElementById('publicar')?.scrollIntoView({ behavior: 'smooth' });
  }

  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(price);
    const discount = cashDiscountPercent === '' ? null : Number(cashDiscountPercent);
    const listingCategory = category === 'Otro' ? customCategory.trim() : category;
    const creatingSupplier = selectedSupplierId === 'new';
    const phoneDigits = phone.trim().replace(/\D/g, '');

    if (
      (creatingSupplier && (!seller.trim() || !logoFile || phoneDigits.length < 7)) ||
      !product.trim() ||
      !description.trim() ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !listingCategory ||
      listingCategory.length > 100 ||
      !saleUnit.trim() ||
      saleUnit.trim().length > 40 ||
      paymentMethods.length === 0 ||
      (discount !== null && (!Number.isFinite(discount) || discount < 0 || discount > 100))
    ) {
      setError(creatingSupplier
        ? 'Completá el comercio, su logotipo, teléfono, producto, categoría, unidad, medios de pago y un precio válido.'
        : 'Completá producto, categoría, unidad, medios de pago y un precio válido.');
      return;
    }
    if (!session?.user.id) {
      setError('Iniciá sesión para publicar ofertas.');
      return;
    }
    if (!creatingSupplier && !selectedSupplier) {
      setError('Elegí un proveedor que administres.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      let supplierId = selectedSupplierId;
      if (creatingSupplier) {
        const supplier = await createSupplier(session.user.id, {
          name: seller.trim(),
          description: supplierDescription.trim(),
          logoPath: null,
          contactPhone: phone.trim(),
          phoneIsPublic,
        });
        supplierId = supplier.id;
        setSelectedSupplierId(supplier.id);
        setSuppliers(current => [...current, { ...supplier, role: 'owner' }]);
        if (!logoFile) throw new Error('El proveedor se creó, pero no se seleccionó un logotipo para subir.');
        let uploadedLogo: string;
        try {
          uploadedLogo = await uploadSupplierImage(supplier.id, logoFile, 'logo');
        } catch (caught) {
          throw new Error(`El proveedor se creó, pero no se pudo guardar el logotipo. ${messageFor(caught)}`);
        }
        const updatedSupplier = await updateSupplierLogo(supplier.id, uploadedLogo);
        setSuppliers(current => current.map(item => item.id === updatedSupplier.id
          ? { ...updatedSupplier, role: 'owner' }
          : item));
        setLogo(uploadedLogo);
        setLogoFile(null);
      }

      let imagePath = photo || null;
      if (photoFile) imagePath = await uploadSupplierImage(supplierId, photoFile, 'products');
      const productInput: SupplierProductInput = {
        name: product.trim(),
        description: description.trim(),
        category: listingCategory,
        comparison_key: normalizeComparisonKey(product),
        sale_unit: saleUnit.trim(),
        image_path: imagePath,
        price: amount,
        is_available: true,
        accepts_delivery: delivery,
        payment_methods: paymentMethods,
        cash_discount_percent: discount,
      };

      if (editingProductId) {
        await updateSupplierProduct(supplierId, editingProductId, productInput);
        setNotice('La oferta se actualizó correctamente.');
      } else {
        await createSupplierProduct(supplierId, productInput);
        setNotice('La oferta se publicó correctamente en Supabase.');
      }
      resetProductForm();
      await Promise.all([reloadPublicCatalog(), reloadManagement()]);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setSaving(false);
    }
  }

  async function removeListing(listing: CatalogListing) {
    if (!window.confirm(`¿Eliminar la oferta “${listing.product}” de Supabase?`)) return;
    setBusyListingId(listing.id);
    setError('');
    setNotice('');
    try {
      await deleteSupplierProduct(listing.supplierId, listing.id);
      setNotice('La oferta se eliminó correctamente.');
      await Promise.all([reloadPublicCatalog(), reloadManagement()]);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusyListingId('');
    }
  }

  async function toggleAvailability(listing: CatalogListing) {
    setBusyListingId(listing.id);
    setError('');
    setNotice('');
    try {
      await updateSupplierProduct(listing.supplierId, listing.id, {
        name: listing.product,
        description: listing.description,
        category: listing.category,
        comparison_key: listing.comparisonKey,
        sale_unit: listing.saleUnit,
        image_path: listing.photo || null,
        price: listing.price,
        is_available: !listing.isAvailable,
        accepts_delivery: listing.delivery,
        payment_methods: listing.paymentMethods,
        cash_discount_percent: listing.cashDiscountPercent,
      });
      setNotice(listing.isAvailable ? 'La oferta se marcó como no disponible.' : 'La oferta vuelve a estar disponible.');
      await Promise.all([reloadPublicCatalog(), reloadManagement()]);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusyListingId('');
    }
  }

  async function toggleSupplierPublication(supplier: Supplier) {
    setBusySupplierId(supplier.id);
    setManagementError('');
    setNotice('');
    try {
      const updated = await updateSupplierPublication(supplier.id, !supplier.is_published);
      setSuppliers(current => current.map(item => item.id === supplier.id
        ? { ...updated, role: supplier.role }
        : item));
      setNotice(updated.is_published ? 'El proveedor está publicado.' : 'El proveedor quedó pausado.');
      await reloadPublicCatalog();
    } catch (caught) {
      setManagementError(messageFor(caught));
    } finally {
      setBusySupplierId('');
    }
  }

  async function toggleSupplierMarket(supplier: Supplier) {
    setBusySupplierId(supplier.id);
    setManagementError('');
    setNotice('');
    try {
      const updated = await updateSupplierMarketVisibility(supplier.id, !supplier.show_in_market);
      setSuppliers(current => current.map(item => item.id === supplier.id
        ? { ...updated, role: supplier.role }
        : item));
      setNotice(updated.show_in_market
        ? `Los productos de ${supplier.name} se mostrarán en Mercado cuando el proveedor esté publicado.`
        : `Los productos de ${supplier.name} ya no se mostrarán en Mercado.`);
    } catch (caught) {
      setManagementError(messageFor(caught));
    } finally {
      setBusySupplierId('');
    }
  }

  async function publishPromotion(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const supplier = suppliers.find(item => item.id === selectedSupplierId);
    const amount = Number(promotionValue);
    const starts = new Date(promotionStarts);
    const ends = new Date(promotionEnds);
    if (!supplier || !['owner', 'manager'].includes(supplier.role ?? '') ||
      !promotionTitle.trim() || !Number.isFinite(amount) || amount <= 0 ||
      (promotionType === 'percent' && amount > 100) ||
      Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      setManagementError('Revisá el proveedor, el título, el descuento y las fechas de la promoción.');
      return;
    }
    setPromotionBusy(true);
    setManagementError('');
    setNotice('');
    try {
      await createSupplierPromotion(supplier.id, {
        supplier_product_id: promotionProductId || null,
        title: promotionTitle.trim(),
        description: promotionDescription.trim(),
        discount_type: promotionType,
        discount_value: amount,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
        is_active: true,
      });
      setPromotionTitle('');
      setPromotionDescription('');
      setPromotionValue('');
      setPromotionProductId('');
      setNotice('La promoción se publicó correctamente.');
      await Promise.all([reloadPublicCatalog(), reloadManagement()]);
    } catch (caught) {
      setManagementError(messageFor(caught));
    } finally {
      setPromotionBusy(false);
    }
  }

  async function removePromotion(promotion: SupplierPromotion) {
    setPromotionBusy(true);
    setManagementError('');
    try {
      await deleteSupplierPromotion(promotion.supplier_id, promotion.id);
      setNotice('La promoción se eliminó correctamente.');
      await Promise.all([reloadPublicCatalog(), reloadManagement()]);
    } catch (caught) {
      setManagementError(messageFor(caught));
    } finally {
      setPromotionBusy(false);
    }
  }

  const canManagePromotions = selectedSupplier && ['owner', 'manager'].includes(selectedSupplier.role ?? '');

  const catalogSection = (
    <section className="mt-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black">Catálogo de ofertas</h1>
          <p className="mt-1 text-sm text-[#77553C]">Productos y promociones publicados por proveedores y comercios.</p>
        </div>
        <button type="button" onClick={() => void reloadPublicCatalog()} disabled={catalogLoading} className="rounded-lg border border-[#E8C9AA] px-3 py-2 text-sm font-semibold disabled:opacity-60">
          {catalogLoading ? 'Actualizando…' : 'Actualizar catálogo'}
        </button>
      </div>
      <label className="mb-4 block text-sm font-semibold">
        Buscar en el catálogo
        <input value={search} onChange={event => setSearch(event.target.value)} type="search" className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal" placeholder="Producto, comercio o categoría" />
      </label>
      {catalogError && (
        <div role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">
          No se pudo cargar el catálogo de Supabase: {catalogError}
        </div>
      )}
      {catalogLoading && listings.length === 0 ? (
        <p role="status" className="rounded-2xl border border-dashed border-[#E8C9AA] bg-white p-8 text-center text-[#77553C]">Cargando ofertas de Supabase…</p>
      ) : listings.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#E8C9AA] bg-white p-8 text-center text-[#77553C]">
          No hay proveedores publicados con ofertas disponibles. Cuando se publiquen ofertas reales, aparecerán acá.
        </p>
      ) : (
        filteredListings.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-[#E8C9AA] bg-white p-8 text-center text-[#77553C]">
            No encontramos ofertas para esa búsqueda.
          </p>
        ) : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredListings.map(item => {
            const discountedPrice = promotionPrice(item);
            const whatsappUrl = supplierWhatsAppUrl(item.phone, item.product);
            return (
              <article key={item.id} className="overflow-hidden rounded-2xl border border-[#F2DDCA] bg-white shadow-sm">
                {item.photo
                  ? <img src={item.photo} alt={item.product} className="h-44 w-full object-cover" loading="lazy" />
                  : <div className="flex h-44 items-center justify-center bg-[#FFF3E5] text-sm font-semibold text-[#8B3F14]">Sin foto de producto</div>}
                <div className="p-5">
                  <div className="flex items-center gap-3">
                    {item.logo
                      ? <img src={item.logo} alt={`Logo de ${item.seller}`} className="h-12 w-12 rounded-full border border-[#F2DDCA] object-cover" />
                      : <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FFF0DD] font-black text-[#A14516]">{item.seller.slice(0, 1).toUpperCase()}</div>}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-[#8B3F14]">{item.seller}</p>
                      <p className="text-xs text-[#77553C]">{item.category} · {item.saleUnit}</p>
                    </div>
                  </div>
                  <h2 className="mt-4 text-lg font-black">{item.product}</h2>
                  {item.description && <p className="mt-1 min-h-10 text-sm text-[#77553C]">{item.description}</p>}
                  {item.promotion && discountedPrice !== null && (
                    <p className="mt-3 inline-flex rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-800">{item.promotion.title}</p>
                  )}
                  <p className="mt-3 text-xl font-black text-[#C25B19]">{money(discountedPrice ?? item.price)}</p>
                  {discountedPrice !== null && <p className="text-sm text-[#77553C] line-through">{money(item.price)}</p>}
                  {!item.isAvailable && <p className="mt-2 text-sm font-bold text-amber-800">No disponible para clientes</p>}
                  {item.cashDiscountPercent !== null && item.cashDiscountPercent > 0 && (
                    <p className="mt-2 text-sm text-[#77553C]">{item.cashDiscountPercent}% de descuento en efectivo</p>
                  )}
                  <p className="mt-2 text-sm text-[#77553C]">
                    {item.delivery ? 'Hace delivery' : 'Solo retiro'}
                    {item.paymentMethods.length ? ` · ${item.paymentMethods.map(method => method === 'cash' ? 'Efectivo' : 'Transferencia').join(' / ')}` : ''}
                  </p>
                  {whatsappUrl ? (
                    <a
                      href={whatsappUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white"
                    >
                      Consultar por WhatsApp
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      title="El proveedor no habilitó un teléfono público válido para consultas."
                      className="mt-3 inline-flex cursor-not-allowed rounded-lg bg-gray-300 px-4 py-2 text-sm font-bold text-gray-600"
                    >
                      Consultar por WhatsApp
                    </button>
                  )}
                  {item.isMine && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[#F2DDCA] pt-3">
                      <button type="button" onClick={() => beginEdit(item)} className="rounded-lg border px-3 py-2 text-sm font-semibold">Editar</button>
                      <button type="button" disabled={busyListingId === item.id} onClick={() => void toggleAvailability(item)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-60">
                        {item.isAvailable ? 'Marcar agotado' : 'Volver a ofrecer'}
                      </button>
                      {suppliers.find(supplier => supplier.id === item.supplierId)?.role !== 'staff' && (
                        <button type="button" disabled={busyListingId === item.id} onClick={() => void removeListing(item)} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-60">
                          {busyListingId === item.id ? 'Guardando…' : 'Eliminar'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  return (
    <main className="min-h-screen bg-[#FFF9F2] px-4 py-8 text-[#693416] md:py-12">
      <div className="mx-auto max-w-6xl">
        <Link to="/" className="inline-flex items-center gap-2 font-semibold text-[#8B3F14] no-underline hover:text-[#C25B19]">
          <span aria-hidden="true">←</span>
          Volver al inicio
        </Link>

        {catalogSection}

        <section className="mt-6 grid overflow-hidden rounded-[2rem] bg-white shadow-sm md:grid-cols-2">
          <div className="flex flex-col justify-center p-6 md:p-12">
            <span className="mb-4 w-fit rounded-full bg-[#FFF0DD] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-[#A14516]">
              Catálogo de comercios
            </span>
            <h2 className="text-4xl font-black leading-tight md:text-5xl">
              MORFI <span className="text-[#F07821]">Ahorro</span>
            </h2>
            <p className="mt-4 max-w-lg text-lg leading-relaxed text-[#77553C]">
              Compará precios y promociones publicados por proveedores y comercios.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#publicar" className="inline-flex items-center gap-2 rounded-xl bg-[#F07821] px-5 py-3 font-bold text-white no-underline">
                <Search className="h-5 w-5" />
                Publicar una oferta
              </a>
              <span className="inline-flex items-center rounded-xl border border-[#F2DDCA] px-4 py-3 text-sm font-semibold text-[#8B3F14]">
                {listings.length} {listings.length === 1 ? 'oferta' : 'ofertas'}
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
              <p className="text-xs text-[#77553C]">Ofertas reales de comercios</p>
            </div>
          </div>
        </section>

        <section id="publicar" className="mt-8 rounded-2xl border border-[#F2DDCA] bg-white p-5 shadow-sm md:p-7">
          <h2 className="text-2xl font-black">{editingProductId ? 'Editá tu oferta' : 'Publicá en MORFI Ahorro'}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[#77553C]">
            Las ofertas se guardan en Supabase. Tus publicaciones anteriores de este navegador se conservan, pero no se importan al catálogo.
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
            <form onSubmit={event => void publish(event)} className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold md:col-span-2">
                Proveedor o comercio
                <select
                  value={selectedSupplierId}
                  onChange={event => setSelectedSupplierId(event.target.value)}
                  disabled={Boolean(editingProductId) || managementLoading}
                  className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal"
                >
                  <option value="new">Registrar un proveedor nuevo</option>
                  {suppliers.map(supplier => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                  ))}
                </select>
              </label>
              {selectedSupplierId === 'new' ? (
                <>
                  <label className="text-sm font-semibold">
                    Nombre del comercio
                    <input value={seller} onChange={event => setSeller(event.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: Almacén del Barrio" />
                  </label>
                  <label className="text-sm font-semibold">
                    Teléfono de contacto
                    <input type="tel" value={phone} onChange={event => setPhone(event.target.value)} maxLength={30} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: +54 380 400 0000" />
                  </label>
                  <label className="text-sm font-semibold md:col-span-2">
                    Descripción del comercio
                    <textarea value={supplierDescription} onChange={event => setSupplierDescription(event.target.value)} maxLength={2000} rows={2} className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Contá brevemente qué ofrecés" />
                  </label>
                  <label className="flex items-start gap-2 text-sm font-normal md:col-span-2">
                    <input type="checkbox" checked={phoneIsPublic} onChange={event => setPhoneIsPublic(event.target.checked)} />
                    Acepto que el teléfono se muestre públicamente para consultas por WhatsApp.
                  </label>
                  <label className="text-sm font-semibold md:col-span-2">
                    Logotipo del comercio (máximo 1 MB)
                    <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void handleImage(event, setLogo, setLogoFile)} required={!logoFile} className="mt-1 block w-full rounded-xl border border-gray-300 p-2 text-sm font-normal" />
                    {logo && <img src={logo} alt="Vista previa del logotipo" className="mt-2 h-16 w-16 rounded-full border object-cover" />}
                  </label>
                </>
              ) : (
                <div className="flex items-center gap-3 rounded-xl bg-[#FFF3E5] p-3 md:col-span-2">
                  {logo && <img src={logo} alt="" className="h-12 w-12 rounded-full border object-cover" />}
                  <p className="text-sm text-[#77553C]">
                    Publicando como <strong>{selectedSupplier?.name}</strong>.
                    {selectedSupplier && !selectedSupplier.is_published ? ' El proveedor está pausado y sus ofertas no aparecerán al público.' : ''}
                  </p>
                </div>
              )}
              <label className="text-sm font-semibold">
                Producto
                <input value={product} onChange={event => setProduct(event.target.value)} maxLength={160} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Ej.: Aceite de girasol 900 ml" />
              </label>
              <label className="text-sm font-semibold">
                Precio
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
              <label className="text-sm font-semibold">
                Unidad de venta
                <input value={saleUnit} onChange={event => setSaleUnit(event.target.value)} maxLength={40} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="unidad, kg, litro..." />
              </label>
              <label className="text-sm font-semibold">
                Descuento por pago en efectivo (opcional)
                <input type="number" min="0" max="100" step="0.01" value={cashDiscountPercent} onChange={event => setCashDiscountPercent(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Porcentaje" />
              </label>
              <label className="text-sm font-semibold md:col-span-2">
                Descripción del producto
                <textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={1000} rows={2} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" placeholder="Presentación, marca o detalle útil para quien compra" />
              </label>
              <label className="text-sm font-semibold">
                ¿Hacés delivery?
                <select value={delivery ? 'yes' : 'no'} onChange={event => setDelivery(event.target.value === 'yes')} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal">
                  <option value="no">No, solo retiro</option>
                  <option value="yes">Sí, hago delivery</option>
                </select>
              </label>
              <fieldset className="rounded-xl border border-[#F2DDCA] p-3">
                <legend className="px-1 text-sm font-semibold">Medios de pago</legend>
                <div className="flex flex-wrap gap-4">
                  {paymentOptions.map(option => (
                    <label key={option.value} className="flex items-center gap-2 text-sm font-normal">
                      <input
                        type="checkbox"
                        checked={paymentMethods.includes(option.value)}
                        onChange={event => setPaymentMethods(current => event.target.checked
                          ? [...current, option.value]
                          : current.filter(method => method !== option.value))}
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="text-sm font-semibold md:col-span-2">
                Foto del producto (opcional, máximo 1 MB)
                <span className="mt-1 flex flex-wrap gap-2">
                  <button type="button" onClick={() => cameraInput.current?.click()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Abrir cámara</button>
                  <button type="button" onClick={() => photoInput.current?.click()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Elegir de galería</button>
                </span>
                <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => void handleImage(event, setPhoto, setPhotoFile)} className="sr-only" />
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => void handleImage(event, setPhoto, setPhotoFile)} className="sr-only" />
                {photo && <img src={photo} alt="Vista previa del producto" className="mt-2 h-16 w-24 rounded-lg border object-cover" />}
                {!photo && <span className="mt-1 block text-xs font-normal text-gray-500">Podés publicar sin foto.</span>}
              </label>
              {error && <p role="alert" className="text-sm font-semibold text-red-700 md:col-span-2">{error}</p>}
              {notice && <p role="status" className="text-sm font-semibold text-green-800 md:col-span-2">{notice}</p>}
              <button type="submit" disabled={saving} className="min-h-12 rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white hover:bg-[#B84E0E] disabled:opacity-60 md:col-span-2">
                {saving ? 'Guardando en Supabase…' : editingProductId ? 'Guardar cambios' : 'Publicar oferta'}
              </button>
              {editingProductId && (
                <button type="button" onClick={resetProductForm} className="rounded-xl border px-5 py-3 font-semibold md:col-span-2">
                  Cancelar edición
                </button>
              )}
            </form>
          )}

          {session && profile?.enabled_panels?.includes('ahorro') && (
            <div className="mt-6 border-t border-[#F2DDCA] pt-5">
              <h3 className="text-lg font-black">Administrá tus proveedores</h3>
              {managementLoading && <p role="status" className="mt-2 text-sm text-[#77553C]">Cargando tus proveedores…</p>}
              {managementError && <p role="alert" className="mt-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">{managementError}</p>}
              {suppliers.length === 0 && !managementLoading ? (
                <p className="mt-2 text-sm text-[#77553C]">Todavía no administrás proveedores. Podés registrar uno al publicar tu primera oferta.</p>
              ) : (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {suppliers.map(supplier => (
                    <div key={supplier.id} className="flex flex-col gap-3 rounded-xl border border-[#F2DDCA] p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {supplier.logo_path && <img src={supplierImageUrl(supplier.logo_path)} alt="" className="h-10 w-10 rounded-full object-cover" />}
                        <div className="min-w-0">
                          <p className="truncate font-bold">{supplier.name}</p>
                          <p className="text-xs text-[#77553C]">{supplier.is_published ? 'Publicado' : 'No publicado'} · {supplier.role}</p>
                        </div>
                      </div>
                      {supplier.role !== 'staff' && (
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            disabled={busySupplierId === supplier.id}
                            onClick={() => void toggleSupplierPublication(supplier)}
                            className="w-full rounded-lg border border-[#E8C9AA] px-3 py-2 text-xs font-bold disabled:opacity-60"
                          >
                            {busySupplierId === supplier.id ? 'Guardando…' : supplier.is_published ? 'Pausar' : 'Publicar'}
                          </button>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={supplier.show_in_market}
                            disabled={busySupplierId === supplier.id}
                            onClick={() => void toggleSupplierMarket(supplier)}
                            className={`w-full rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-60 ${supplier.show_in_market ? 'border-green-700 bg-green-50 text-green-800' : 'border-[#E8C9AA] text-[#8B3F14]'}`}
                          >
                            {busySupplierId === supplier.id ? 'Guardando…' : `Mostrar mis productos en Mercado: ${supplier.show_in_market ? 'Sí' : 'No'}`}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {selectedSupplier && canManagePromotions && (
            <div className="mt-6 border-t border-[#F2DDCA] pt-5">
              <h3 className="text-lg font-black">Promociones de {selectedSupplier.name}</h3>
              <form onSubmit={event => void publishPromotion(event)} className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold">
                  Título
                  <input value={promotionTitle} onChange={event => setPromotionTitle(event.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                </label>
                <label className="text-sm font-semibold">
                  Aplicar a
                  <select value={promotionProductId} onChange={event => setPromotionProductId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal">
                    <option value="">Todo el proveedor</option>
                    {currentSupplierOffers.map(offer => <option key={offer.product_id} value={offer.product_id}>{offer.product_name}</option>)}
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  Tipo de descuento
                  <select value={promotionType} onChange={event => setPromotionType(event.target.value === 'percent' ? 'percent' : 'fixed_price')} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal">
                    <option value="percent">Porcentaje</option>
                    <option value="fixed_price">Precio final</option>
                  </select>
                </label>
                <label className="text-sm font-semibold">
                  {promotionType === 'percent' ? 'Porcentaje de descuento' : 'Precio final'}
                  <input type="number" min="0.01" max={promotionType === 'percent' ? 100 : undefined} step="0.01" value={promotionValue} onChange={event => setPromotionValue(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                </label>
                <label className="text-sm font-semibold">
                  Empieza
                  <input type="datetime-local" value={promotionStarts} onChange={event => setPromotionStarts(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                </label>
                <label className="text-sm font-semibold">
                  Termina
                  <input type="datetime-local" value={promotionEnds} onChange={event => setPromotionEnds(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                </label>
                <label className="text-sm font-semibold md:col-span-2">
                  Descripción (opcional)
                  <textarea value={promotionDescription} onChange={event => setPromotionDescription(event.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                </label>
                <button type="submit" disabled={promotionBusy} className="rounded-xl bg-[#F07821] px-4 py-3 font-bold text-white disabled:opacity-60 md:col-span-2">
                  {promotionBusy ? 'Guardando…' : 'Publicar promoción'}
                </button>
              </form>
              {currentSupplierPromotions.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {currentSupplierPromotions.map(promotion => (
                    <li key={promotion.id} className="flex items-center justify-between gap-3 rounded-lg bg-[#FFF3E5] p-3 text-sm">
                      <span><strong>{promotion.title}</strong> · {promotion.discount_type === 'percent' ? `${promotion.discount_value}%` : money(Number(promotion.discount_value))}</span>
                      <button type="button" disabled={promotionBusy} onClick={() => void removePromotion(promotion)} className="text-xs font-bold text-red-700 disabled:opacity-60">Eliminar</button>
                    </li>
                  ))}
                </ul>
              )}
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
          <strong>Etapa inicial:</strong> las ofertas, promociones y proveedores se consultan o guardan en Supabase. El catálogo local anterior permanece intacto y no se muestra como oferta online. No se conectaron compras, pagos ni pedidos.
        </p>
      </div>
    </main>
  );
}
