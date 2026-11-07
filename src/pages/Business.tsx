
import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import BusinessWorkflow from './BusinessWorkflow';
import type { BusinessSection } from './BusinessWorkflow';
import { useAuth } from '../AuthContext';
import { isIngredient, isRecipe } from '../business/calculations';
import {
  deliveryFeeStatusLabel,
  isOrderCheckoutV2Enabled,
  listBusinessMealOrders,
  orderStatusLabel,
  paymentStatusLabel,
  reviewMealOrderTransfer,
  setMealOrderDeliveryFee,
  subscribeToMealOrders,
  updateMealOrderStatus,
} from '../orders/orderService';
import type { MealOrder, OrderStatus } from '../orders/orderService';
import {
  createBusiness,
  createBusinessProduct,
  deleteBusinessProduct,
  listBusinessProducts,
  listManagedBusinesses,
  uploadBusinessLogo,
  updateBusinessCoordinates,
  updateBusinessLocation,
  updateBusinessPhoneVisibility,
  updateBusinessPublication,
  updateBusinessProduct,
} from '../business/businessService';
import { argentinePaymentProviders } from '../business/paymentOptions';
import {
  getPendingBusinessSetup,
  removePendingBusinessSetup,
  savePendingBusinessSetup,
} from '../business/pendingRegistration';
import type { PendingBusinessSetup } from '../business/pendingRegistration';
import BusinessLocationMap from '../components/BusinessLocationMap';
import type {
  BusinessProduct,
  BusinessProductInput,
  BusinessRegistrationInput,
} from '../business/businessService';
import type { ManagedBusiness } from '../business/businessService';
import type { Ingredient, Recipe } from '../business/types';

type Product = {
  id: number | string;
  name: string;
  price: number;
  available: boolean;
  description?: string;
  category?: string;
  quantity?: number;
  saleMode?: 'direct' | 'cost';
  costPerUnit?: number;
  rawMaterialCostPerPortion?: number;
  indirectCostPerPortion?: number;
  suggestedPrice?: number;
  estimatedGainPerPortion?: number;
  ingredients?: string[];
  image?: string;
  sellerAlias?: string | null;
  sellerHolder?: string | null;
  sellerLocation?: string | null;
  sellerDirections?: string | null;
  recipeId?: string;
  sellerId?: string;
  sellerName?: string;
  sellerPhone?: string | null;
  businessId?: string;
  acceptsDelivery?: boolean;
  paymentMethods?: ('cash' | 'transfer')[];
  cashDiscountPercent?: number | null;
};

type IngredientUnit = 'g' | 'kg' | 'ml' | 'l' | 'unidad';
type IngredientDraft = {
  name: string;
  unit: IngredientUnit;
  recipeUnit: IngredientUnit;
  packageQuantity: string;
  packagePrice: string;
  recipeQuantity: string;
};

const productTypes: { name: string; ingredients: string[] }[] = [
  { name: 'Lomitos', ingredients: ['Pan', 'Carne', 'Jamón', 'Queso', 'Huevo', 'Tomate', 'Lechuga'] },
  { name: 'Empanadas', ingredients: ['Tapas', 'Carne', 'Cebolla', 'Huevo', 'Condimentos'] },
  { name: 'Pizzas', ingredients: ['Harina', 'Tomate', 'Muzzarella', 'Levadura', 'Aceite'] },
  { name: 'Pan', ingredients: ['Harina', 'Levadura', 'Sal', 'Aceite'] },
  { name: 'Tortillas', ingredients: ['Papa', 'Huevo', 'Cebolla', 'Aceite'] },
  { name: 'Viandas', ingredients: ['Carne o pollo', 'Verduras', 'Papa o arroz', 'Aceite', 'Condimentos'] },
  { name: 'Medialunas', ingredients: ['Harina', 'Manteca', 'Levadura', 'Azúcar', 'Huevo', 'Leche'] },
  { name: 'Pastas', ingredients: ['Harina', 'Huevo', 'Salsa', 'Queso', 'Aceite'] },
  { name: 'Tartas', ingredients: ['Tapa de tarta', 'Huevo', 'Queso', 'Verduras', 'Crema'] },
  { name: 'Otro', ingredients: [] },
];

const defaultIngredientUnit: IngredientUnit = 'g';
const ingredientUnits: { value: IngredientUnit; label: string }[] = [
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l' },
  { value: 'unidad', label: 'unidad' },
];

function ingredientDraft(name: string): IngredientDraft {
  return {
    name,
    unit: defaultIngredientUnit,
    recipeUnit: defaultIngredientUnit,
    packageQuantity: '',
    packagePrice: '',
    recipeQuantity: '',
  };
}

function toProduct(product: BusinessProduct): Product {
  return {
    id: product.id,
    businessId: product.business_id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    image: product.image_path ?? undefined,
    quantity: product.stock_quantity,
    available: product.is_available,
    acceptsDelivery: product.accepts_delivery,
    paymentMethods: product.payment_methods,
    cashDiscountPercent: product.cash_discount_percent,
    category: 'Producto',
  };
}

const money = (value: number) =>
  value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });

function nextOrderStatuses(order: MealOrder): OrderStatus[] {
  switch (order.status) {
    case 'pending': return ['accepted', 'rejected'];
    case 'accepted': return ['preparing'];
    case 'preparing': return ['ready'];
    case 'ready': return order.delivery_mode === 'delivery'
      ? order.delivery_fee_status === 'pending' ? [] : ['on_the_way']
      : ['delivered'];
    case 'on_the_way': return ['delivered'];
    case 'cancellation_requested': return ['cancelled'];
    default: return [];
  }
}

function CostSummary({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-1 font-black">{value === null ? 'Ingresá tu precio de venta' : money(value)}</p>
    </div>
  );
}

export default function Business() {
  const { profile, session } = useAuth();
  const userId = session?.user.id;
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<MealOrder[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [productType, setProductType] = useState(productTypes[0].name);
  const [customProductType, setCustomProductType] = useState('');
  const [saleMode, setSaleMode] = useState<'direct' | 'cost'>('direct');
  const [price, setPrice] = useState('');
  const [isAvailable, setIsAvailable] = useState(true);
  const [acceptsDelivery, setAcceptsDelivery] = useState(false);
  const [productPaymentMethods, setProductPaymentMethods] = useState<('cash' | 'transfer')[]>(['cash', 'transfer']);
  const [cashDiscountPercent, setCashDiscountPercent] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('');
  const [additionalCosts, setAdditionalCosts] = useState('0');
  const [ingredientCosts, setIngredientCosts] = useState<IngredientDraft[]>(
    productTypes[0].ingredients.map(ingredientDraft),
  );
  const [customIngredient, setCustomIngredient] = useState('');
  const [productPhoto, setProductPhoto] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [formError, setFormError] = useState('');
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState('');
  const [orderStatusBusyId, setOrderStatusBusyId] = useState<string | null>(null);
  const [managedBusinesses, setManagedBusinesses] = useState<ManagedBusiness[]>([]);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  const [businessesError, setBusinessesError] = useState('');
  const [businessFormError, setBusinessFormError] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessDescription, setBusinessDescription] = useState('');
  const [businessPhone, setBusinessPhone] = useState(profile?.phone ?? '');
  const [businessPhonePublic, setBusinessPhonePublic] = useState(true);
  const [businessLocation, setBusinessLocation] = useState('');
  const [businessDirections, setBusinessDirections] = useState('');
  const [businessLatitude, setBusinessLatitude] = useState<number | null>(null);
  const [businessLongitude, setBusinessLongitude] = useState<number | null>(null);
  const [businessLocationNotice, setBusinessLocationNotice] = useState('');
  const [businessLogo, setBusinessLogo] = useState<File | null>(null);
  const [businessLogoPreview, setBusinessLogoPreview] = useState('');
  const [acceptsCash, setAcceptsCash] = useState(true);
  const [acceptsTransfer, setAcceptsTransfer] = useState(false);
  const businessLogoInput = useRef<HTMLInputElement>(null);
  const managedLogoInput = useRef<HTMLInputElement>(null);
  const [logoBusinessId, setLogoBusinessId] = useState<string | null>(null);
  const [uploadingLogoBusinessId, setUploadingLogoBusinessId] = useState<string | null>(null);
  const [bankName, setBankName] = useState('');
  const [otherBankName, setOtherBankName] = useState('');
  const [transferAlias, setTransferAlias] = useState('');
  const [transferHolder, setTransferHolder] = useState('');
  const [bankCuit, setBankCuit] = useState('');
  const [creatingBusiness, setCreatingBusiness] = useState(false);
  const [businessNotice, setBusinessNotice] = useState('');
  const [publicationNotice, setPublicationNotice] = useState('');
  const [publicationError, setPublicationError] = useState('');
  const [publicationBusyId, setPublicationBusyId] = useState<string | null>(null);
  const [editingLocationBusinessId, setEditingLocationBusinessId] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState('');
  const [directionsDraft, setDirectionsDraft] = useState('');
  const [locationSaveError, setLocationSaveError] = useState('');
  const [locationSaveNotice, setLocationSaveNotice] = useState('');
  const [savingLocationBusinessId, setSavingLocationBusinessId] = useState<string | null>(null);
  const [phoneVisibilityError, setPhoneVisibilityError] = useState('');
  const [phoneVisibilitySavingId, setPhoneVisibilitySavingId] = useState<string | null>(null);
  const [businessesReload, setBusinessesReload] = useState(0);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState('');
  const [productsNotice, setProductsNotice] = useState('');
  const [productsReload, setProductsReload] = useState(0);
  const [savingProduct, setSavingProduct] = useState(false);
  const [productActionId, setProductActionId] = useState<string | null>(null);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [tab, setTab] = useState<'productos' | 'pedidos' | BusinessSection>('productos');
  const packageFactor = (unit: IngredientUnit) => unit === 'kg' || unit === 'l' ? 1000 : 1;

  useEffect(() => {
    if (!businessLogo) {
      setBusinessLogoPreview('');
      return;
    }
    const preview = URL.createObjectURL(businessLogo);
    setBusinessLogoPreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [businessLogo]);

  useEffect(() => {
    let active = true;
    async function loadBusinesses() {
      setBusinessesLoading(true);
      setBusinessesError('');
      try {
        if (!userId) throw new Error('No se pudo identificar la sesión autenticada.');
        let businesses = await listManagedBusinesses(userId);
        const accountEmail = session?.user.email;
        if (accountEmail) {
          let pendingSetup: PendingBusinessSetup | undefined;
          try {
            pendingSetup = await getPendingBusinessSetup(accountEmail);
          } catch (setupReadError) {
            const detail = setupReadError instanceof Error ? setupReadError.message : 'Error inesperado.';
            setBusinessFormError(`No se pudo consultar el guardado pendiente del registro: ${detail}`);
          }
          const targetBusiness = pendingSetup
            ? businesses.find(business => business.name === pendingSetup.businessName)
            : undefined;
          if (pendingSetup && targetBusiness) {
            let updatedBusiness = targetBusiness;
            let remainingSetup = pendingSetup;
            try {
              if (pendingSetup.latitude !== null && pendingSetup.longitude !== null) {
                await updateBusinessCoordinates(
                  targetBusiness.id,
                  pendingSetup.latitude,
                  pendingSetup.longitude,
                );
                updatedBusiness = {
                  ...updatedBusiness,
                  latitude: pendingSetup.latitude,
                  longitude: pendingSetup.longitude,
                };
                remainingSetup = { ...remainingSetup, latitude: null, longitude: null };
              }
              if (pendingSetup.logo) {
                const logoPath = await uploadBusinessLogo(targetBusiness.id, pendingSetup.logo);
                updatedBusiness = { ...updatedBusiness, logo_path: logoPath };
                remainingSetup = { ...remainingSetup, logo: null };
              }
              if (remainingSetup.logo || remainingSetup.latitude !== null || remainingSetup.longitude !== null) {
                await savePendingBusinessSetup(remainingSetup);
              } else {
                await removePendingBusinessSetup(accountEmail);
              }
              businesses = businesses.map(business =>
                business.id === updatedBusiness.id ? updatedBusiness : business,
              );
              if (pendingSetup.logo || pendingSetup.latitude !== null || pendingSetup.longitude !== null) {
                setBusinessNotice('El logo y la ubicación del registro se guardaron automáticamente.');
              }
            } catch (setupError) {
              const detail = setupError instanceof Error ? setupError.message : 'Error inesperado.';
              setBusinessFormError(`La cuenta se creó, pero no se pudo guardar automáticamente el logo o la ubicación: ${detail}. MORFI lo volverá a intentar al abrir este panel.`);
            }
          }
        }
        if (active) {
          setManagedBusinesses(businesses);
          setSelectedBusinessId(current =>
            businesses.some(business => business.id === current) ? current : businesses[0]?.id ?? ''
          );
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) setBusinessesError(`No se pudieron consultar tus emprendimientos: ${detail}`);
      } finally {
        if (active) setBusinessesLoading(false);
      }
    }

    void loadBusinesses();
    return () => {
      active = false;
    };
  }, [userId, businessesReload, session?.user.email]);

  async function registerBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = businessName.trim();
    const trimmedDescription = businessDescription.trim();
    const trimmedPhone = businessPhone.trim();
    const trimmedLocation = businessLocation.trim();
    const normalizedCuit = bankCuit.replace(/\D/g, '');
    const selectedBankName = bankName === 'Otro' ? otherBankName.trim() : bankName.trim();
    setBusinessNotice('');
    setBusinessFormError('');
    if (!userId) {
      setBusinessFormError('No se pudo identificar la sesión autenticada. Volvé a ingresar e intentá nuevamente.');
      return;
    }
    if (!trimmedName) {
      setBusinessFormError('Ingresá el nombre de tu emprendimiento.');
      return;
    }
    if (!trimmedLocation || !trimmedPhone) {
      setBusinessFormError('Completá la dirección del punto de venta y el WhatsApp para recibir pedidos.');
      return;
    }
    if (trimmedName.length > 120 || trimmedDescription.length > 2000 ||
      trimmedLocation.length > 180 || businessDirections.trim().length > 300) {
      setBusinessFormError('Revisá los largos: nombre hasta 120, descripción hasta 2000, dirección hasta 180 y referencia hasta 300 caracteres.');
      return;
    }
    if (!acceptsCash && !acceptsTransfer) {
      setBusinessFormError('Elegí al menos un medio de pago.');
      return;
    }
    if (acceptsTransfer && (
      !selectedBankName ||
      !transferAlias.trim() ||
      !transferHolder.trim() ||
      !/^\d{11}$/.test(normalizedCuit)
    )) {
      setBusinessFormError('Para recibir pedidos, completá banco, alias, titular y un CUIT de 11 números.');
      return;
    }
    if (businessLogo && (
      !['image/jpeg', 'image/png', 'image/webp'].includes(businessLogo.type) ||
      businessLogo.size > 5 * 1024 * 1024
    )) {
      setBusinessFormError('El logo debe ser JPG, PNG o WebP y pesar hasta 5 MB.');
      return;
    }

    setCreatingBusiness(true);
    try {
      const businessInput: BusinessRegistrationInput = {
        name: trimmedName,
        description: trimmedDescription,
        contact_phone: trimmedPhone,
        phone_is_public: businessPhonePublic,
        location: trimmedLocation,
        directions: businessDirections.trim(),
        latitude: businessLatitude,
        longitude: businessLongitude,
        bank_name: acceptsTransfer ? selectedBankName : null,
        transfer_alias: acceptsTransfer ? transferAlias.trim() : null,
        transfer_holder: acceptsTransfer ? transferHolder.trim() : null,
        bank_cuit: acceptsTransfer ? normalizedCuit : null,
        payment_methods: [
          ...(acceptsCash ? ['cash' as const] : []),
          ...(acceptsTransfer ? ['transfer' as const] : []),
        ],
      };
      const business = await createBusiness(userId, businessInput);
      setManagedBusinesses(current => [business, ...current.filter(item => item.id !== business.id)]);
      setSelectedBusinessId(business.id);
      setBusinessName('');
      setBusinessDescription('');
      setBusinessPhone(profile?.phone ?? '');
      setBusinessPhonePublic(true);
      setBusinessLocation('');
      setBusinessDirections('');
      setBusinessLatitude(null);
      setBusinessLongitude(null);
      setBusinessLocationNotice('');
      setBankName('');
      setTransferAlias('');
      setTransferHolder('');
      setBankCuit('');
      setAcceptsCash(true);
      setAcceptsTransfer(false);
      setBankName('');
      setOtherBankName('');
      const selectedLogo = businessLogo;
      setBusinessLogo(null);
      if (selectedLogo) {
        try {
          const logoPath = await uploadBusinessLogo(business.id, selectedLogo);
          setManagedBusinesses(current => current.map(item =>
            item.id === business.id ? { ...item, logo_path: logoPath } : item,
          ));
          setBusinessNotice('Emprendimiento y logo guardados en Supabase. Ya podés continuar con tu panel.');
        } catch (logoError) {
          const detail = logoError instanceof Error ? logoError.message : 'Error inesperado.';
          setBusinessFormError(`El emprendimiento se guardó, pero no se pudo subir el logo: ${detail}. Podés volver a intentarlo en la lista.`);
        }
      } else {
        setBusinessNotice('Emprendimiento registrado en Supabase y asociado a tu cuenta como propietario.');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setBusinessFormError(`No se pudo registrar el emprendimiento: ${detail}`);
    } finally {
      setCreatingBusiness(false);
    }
  }

  async function saveBusinessLocation(businessId: string) {
    const trimmedLocation = locationDraft.trim();
    const trimmedDirections = directionsDraft.trim();
    setLocationSaveError('');
    setLocationSaveNotice('');
    if (!trimmedLocation || trimmedLocation.length > 180 || trimmedDirections.length > 300) {
      setLocationSaveError('Ingresá una dirección de hasta 180 caracteres y una referencia opcional de hasta 300.');
      return;
    }

    setSavingLocationBusinessId(businessId);
    try {
      await updateBusinessLocation(businessId, trimmedLocation, trimmedDirections);
      setManagedBusinesses(current => current.map(business =>
        business.id === businessId
          ? { ...business, location: trimmedLocation, directions: trimmedDirections }
          : business,
      ));
      setEditingLocationBusinessId(null);
      setLocationSaveNotice('La dirección y la referencia se guardaron.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setLocationSaveError(`No se pudo actualizar la ubicación: ${detail}`);
    } finally {
      setSavingLocationBusinessId(null);
    }
  }

  async function setBusinessPhoneVisibility(businessId: string, isPublic: boolean) {
    setPhoneVisibilityError('');
    setPhoneVisibilitySavingId(businessId);
    try {
      await updateBusinessPhoneVisibility(businessId, isPublic);
      setManagedBusinesses(current => current.map(business =>
        business.id === businessId ? { ...business, phone_is_public: isPublic } : business,
      ));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setPhoneVisibilityError(`No se pudo actualizar la visibilidad del WhatsApp: ${detail}`);
    } finally {
      setPhoneVisibilitySavingId(null);
    }
  }

  function useBusinessLocation() {
    setBusinessLocationNotice('');
    if (!navigator.geolocation) {
      setBusinessLocationNotice('Este dispositivo o navegador no ofrece ubicación GPS. Podés escribir la dirección manualmente.');
      return;
    }

    setBusinessLocationNotice('Solicitando permiso para acceder a tu ubicación…');
    navigator.geolocation.getCurrentPosition(
      position => {
        setBusinessLatitude(position.coords.latitude);
        setBusinessLongitude(position.coords.longitude);
        setBusinessLocationNotice('Ubicación guardada. Podés corregir la dirección manualmente.');
      },
      error => {
        const detail = error.code === error.PERMISSION_DENIED
          ? 'No se autorizó el acceso a la ubicación.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'El GPS no está disponible en este momento.'
            : 'No se pudo obtener la ubicación a tiempo.';
        setBusinessLocationNotice(`${detail} Podés escribir la dirección manualmente.`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  async function uploadManagedBusinessLogo(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const businessId = logoBusinessId;
    event.target.value = '';
    if (!file || !businessId) return;

    setUploadingLogoBusinessId(businessId);
    setBusinessFormError('');
    setBusinessNotice('');
    try {
      const logoPath = await uploadBusinessLogo(businessId, file);
      setManagedBusinesses(current => current.map(item =>
        item.id === businessId ? { ...item, logo_path: logoPath } : item,
      ));
      setBusinessNotice('Logo actualizado correctamente.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setBusinessFormError(`No se pudo actualizar el logo: ${detail}`);
    } finally {
      setUploadingLogoBusinessId(null);
      setLogoBusinessId(null);
    }
  }

  async function toggleBusinessPublication(business: ManagedBusiness) {
    setPublicationNotice('');
    setPublicationError('');
    setPublicationBusyId(business.id);
    try {
      const updatedBusiness = await updateBusinessPublication(business.id, !business.is_published);
      setManagedBusinesses(current => current.map(item =>
        item.id === updatedBusiness.id ? updatedBusiness : item
      ));
      setPublicationNotice(
        updatedBusiness.is_published
          ? `${updatedBusiness.name} está publicado y puede aparecer en Tengo hambre cuando tenga productos disponibles.`
          : `${updatedBusiness.name} está pausado y ya no aparecerá en el catálogo público.`,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setPublicationError(`No se pudo cambiar la publicación del emprendimiento: ${detail}`);
    } finally {
      setPublicationBusyId(null);
    }
  }

  useEffect(() => {
    let active = true;
    async function loadProducts() {
      setProducts([]);
      if (!selectedBusinessId) {
        setProductsLoading(false);
        setProductsError('');
        return;
      }

      setProductsLoading(true);
      setProductsError('');
      try {
        const data = await listBusinessProducts(selectedBusinessId);
        if (active) setProducts(data.map(toProduct));
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) setProductsError(`No se pudieron cargar los productos de este emprendimiento: ${detail}`);
      } finally {
        if (active) setProductsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      active = false;
    };
  }, [selectedBusinessId, productsReload]);

  useEffect(() => {
    let active = true;
    if (!selectedBusinessId) {
      setOrders([]);
      setOrdersError('');
      setOrdersLoading(false);
      return;
    }

    async function loadOrders() {
      setOrdersLoading(true);
      setOrdersError('');
      try {
        const data = await listBusinessMealOrders(selectedBusinessId);
        if (active) setOrders(data);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Error inesperado.';
        if (active) {
          setOrders([]);
          setOrdersError(`No se pudieron cargar los pedidos de Supabase: ${detail}`);
        }
      } finally {
        if (active) setOrdersLoading(false);
      }
    }

    void loadOrders();
    const unsubscribe = subscribeToMealOrders('business_id', selectedBusinessId, () => {
      void loadOrders();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [selectedBusinessId]);

  const sales = orders
    .filter(order => order.status === 'delivered' && order.total !== null)
    .reduce((sum, order) => sum + (order.total ?? 0), 0);

  const pending = orders.filter(order => !['delivered', 'rejected', 'cancelled'].includes(order.status)).length;
  const recipeYield = Number(yieldQuantity);
  const indirectCost = Number(additionalCosts);
  const rawMaterialCost = ingredientCosts.reduce((sum, item) => {
    const packageAmount = Number(item.packageQuantity);
    const packageCost = Number(item.packagePrice);
    const usedAmount = Number(item.recipeQuantity);
    if (
      packageAmount <= 0 ||
      packageCost < 0 ||
      usedAmount < 0 ||
      !ingredientUnits.some(unit => unit.value === item.recipeUnit) ||
      !((item.unit === 'g' || item.unit === 'kg') && (item.recipeUnit === 'g' || item.recipeUnit === 'kg')) &&
      !((item.unit === 'ml' || item.unit === 'l') && (item.recipeUnit === 'ml' || item.recipeUnit === 'l')) &&
      !(item.unit === 'unidad' && item.recipeUnit === 'unidad')
    ) return sum;
    return sum + packageCost * (usedAmount * packageFactor(item.recipeUnit)) / (packageAmount * packageFactor(item.unit));
  }, 0);
  const calculationYield = recipeYield > 0 ? recipeYield : 1;
  const totalRecipeCost = rawMaterialCost + (Number.isFinite(indirectCost) && indirectCost >= 0 ? indirectCost : 0);
  const totalCostPerPortion = totalRecipeCost / calculationYield;
  const suggestedPrice = totalCostPerPortion * 1.3;
  const salePrice = Number(price);
  const estimatedGainPerPortion = Number.isFinite(salePrice) && salePrice > 0
    ? salePrice - totalCostPerPortion
    : null;

  async function addProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const enteredPrice = price.trim() ? Number(price) : null;
    const amount = enteredPrice ?? (saleMode === 'cost' ? suggestedPrice : 0);
    const completeRecipe = ingredientCosts.map(item => ({
      ...item,
      name: item.name.trim(),
      packageAmount: Number(item.packageQuantity),
      packageCost: Number(item.packagePrice),
      usedAmount: Number(item.recipeQuantity),
      usedUnit: item.recipeUnit,
    }));
    if (
      !name.trim() ||
      productPaymentMethods.length === 0 ||
      name.trim().length > 160 ||
      description.trim().length > 1000 ||
      !Number.isFinite(amount) || amount <= 0 ||
      (cashDiscountPercent.trim() !== '' && (
        !Number.isFinite(Number(cashDiscountPercent)) ||
        Number(cashDiscountPercent) < 0 ||
        Number(cashDiscountPercent) > 100
      )) ||
      (saleMode === 'cost' && (
        (yieldQuantity.trim() !== '' && (!Number.isFinite(recipeYield) || recipeYield <= 0)) ||
        !Number.isFinite(indirectCost) || indirectCost < 0 ||
        !Number.isFinite(rawMaterialCost) ||
        completeRecipe.length === 0 ||
        completeRecipe.some(item =>
          !item.name ||
          !item.packageQuantity.trim() ||
          !item.packagePrice.trim() ||
          !item.recipeQuantity.trim() ||
          !Number.isFinite(item.packageAmount) || item.packageAmount <= 0 ||
          !Number.isFinite(item.packageCost) || item.packageCost < 0 ||
          !Number.isFinite(item.usedAmount) || item.usedAmount <= 0
          || !((item.unit === 'g' || item.unit === 'kg') && (item.usedUnit === 'g' || item.usedUnit === 'kg')) &&
          !((item.unit === 'ml' || item.unit === 'l') && (item.usedUnit === 'ml' || item.usedUnit === 'l')) &&
          !(item.unit === 'unidad' && item.usedUnit === 'unidad')
        )
      ))
    ) {
      setFormError('Completá el producto, el precio y los datos de cada ingrediente. Revisá que las unidades sean compatibles.');
      return;
    }
    if (!selectedBusinessId) {
      setFormError('Seleccioná un emprendimiento antes de guardar productos.');
      return;
    }

    if (saleMode === 'cost' && !editingProductId) {
      try {
        const ownerId = profile?.id;
        if (!ownerId) throw new Error('No se pudo identificar la cuenta del emprendimiento.');
        const ingredientKey = `morfi_business_ingredients_v1_${ownerId}`;
        const recipeKey = `morfi_business_recipes_v1_${ownerId}`;
        const storedIngredients: unknown = JSON.parse(localStorage.getItem(ingredientKey) || '[]');
        const storedRecipes: unknown = JSON.parse(localStorage.getItem(recipeKey) || '[]');
        if (
          !Array.isArray(storedIngredients) ||
          !storedIngredients.every(isIngredient) ||
          !Array.isArray(storedRecipes) ||
          !storedRecipes.every(isRecipe)
        ) {
          throw new Error('Los ingredientes o recetas guardados tienen un formato inválido; no se modificaron.');
        }

        const ingredients = [...storedIngredients] as Ingredient[];
        const recipeIngredients = completeRecipe.map(item => {
          const existing = ingredients.find(ingredient => ingredient.name.trim().toLocaleLowerCase('es') === item.name.toLocaleLowerCase('es'));
          const ingredient: Ingredient = {
            id: existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: item.name,
            purchaseQuantity: item.packageAmount,
            purchaseUnit: item.unit,
            purchasePrice: item.packageCost,
            stockQuantity: existing?.stockQuantity ?? item.packageAmount,
            stockUnit: existing?.stockUnit ?? item.unit,
          };
          if (existing) {
            if (
              !(((ingredient.purchaseUnit === 'g' || ingredient.purchaseUnit === 'kg') && (existing.stockUnit === 'g' || existing.stockUnit === 'kg')) ||
                ((ingredient.purchaseUnit === 'ml' || ingredient.purchaseUnit === 'l') && (existing.stockUnit === 'ml' || existing.stockUnit === 'l')) ||
                (ingredient.purchaseUnit === 'unidad' && existing.stockUnit === 'unidad'))
            ) {
              throw new Error(`La unidad de compra de ${item.name} no coincide con el ingrediente guardado.`);
            }
            ingredients[ingredients.findIndex(value => value.id === existing.id)] = ingredient;
          } else {
            ingredients.push(ingredient);
          }
          return {
            ingredientId: ingredient.id,
            quantity: item.usedAmount,
            unit: item.usedUnit,
          };
        });
        const recipeId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const recipe: Recipe = {
          id: recipeId,
          name: name.trim(),
          yieldQuantity: calculationYield,
          yieldUnit: 'porciones',
          ingredients: recipeIngredients,
          additionalCosts: indirectCost,
          sellingPrice: amount,
          finishedStock: 0,
        };
        const recipeCosts: Recipe[] = [...storedRecipes as Recipe[], recipe];
        const previousIngredients = localStorage.getItem(ingredientKey);
        const previousRecipes = localStorage.getItem(recipeKey);
        try {
          localStorage.setItem(ingredientKey, JSON.stringify(ingredients));
          localStorage.setItem(recipeKey, JSON.stringify(recipeCosts));
        } catch (storageError) {
          if (previousIngredients === null) localStorage.removeItem(ingredientKey);
          else localStorage.setItem(ingredientKey, previousIngredients);
          if (previousRecipes === null) localStorage.removeItem(recipeKey);
          else localStorage.setItem(recipeKey, previousRecipes);
          throw storageError;
        }
      } catch (caught) {
        setFormError(caught instanceof Error ? caught.message : 'No se pudieron guardar los ingredientes y la receta.');
        return;
      }
    }
    const productInput: BusinessProductInput = {
      name: name.trim(),
      description: description.trim(),
      image_path: productPhoto || null,
      price: amount,
      is_available: isAvailable,
      accepts_delivery: acceptsDelivery,
      payment_methods: productPaymentMethods,
      cash_discount_percent: cashDiscountPercent.trim() ? Number(cashDiscountPercent) : null,
    };

    setSavingProduct(true);
    setProductsError('');
    setProductsNotice('');
    try {
      const saved = editingProductId
        ? await updateBusinessProduct(selectedBusinessId, editingProductId, productInput)
        : await createBusinessProduct(selectedBusinessId, productInput);
      const savedProduct = toProduct(saved);
      setProducts(current => editingProductId
        ? current.map(product => product.id === savedProduct.id ? savedProduct : product)
        : [savedProduct, ...current]);
      setProductsNotice(editingProductId
        ? 'Producto actualizado en Supabase.'
        : 'Producto registrado en Supabase.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setProductsError(`No se pudo guardar el producto en Supabase: ${detail}`);
      setSavingProduct(false);
      return;
    }

    setName('');
    setDescription('');
    setPrice('');
    setIsAvailable(true);
    setAcceptsDelivery(false);
    setProductPaymentMethods(['cash', 'transfer']);
    setCashDiscountPercent('');
    setYieldQuantity('');
    setAdditionalCosts('0');
    setIngredientCosts(productTypes.find(item => item.name === productType)?.ingredients.map(ingredientDraft) ?? []);
    setCustomIngredient('');
    setCustomProductType('');
    setProductPhoto('');
    setEditingProductId(null);
    if (photoInput.current) photoInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
    setFormError('');
    setSavingProduct(false);
  }

  function loadProductPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 400 * 1024) {
      setFormError('La foto debe ser JPG, PNG o WebP de hasta 400 KB para poder guardarla en este navegador.');
      event.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setProductPhoto(reader.result);
        setFormError('');
      } else {
        setFormError('No se pudo leer la foto seleccionada.');
      }
    };
    reader.onerror = () => setFormError('No se pudo leer la foto seleccionada.');
    reader.readAsDataURL(file);
  }

  function editProduct(product: Product) {
    setEditingProductId(String(product.id));
    setName(product.name);
    setDescription(product.description ?? '');
    setPrice(String(product.price));
    setIsAvailable(product.available);
    setAcceptsDelivery(product.acceptsDelivery ?? false);
    setCashDiscountPercent(product.cashDiscountPercent == null ? '' : String(product.cashDiscountPercent));
    setProductPaymentMethods(product.paymentMethods ?? []);
    setProductPhoto(product.image ?? '');
    setSaleMode('direct');
    setFormError('');
    document.getElementById('product-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function toggleProductAvailability(product: Product) {
    if (!selectedBusinessId) return;
    setProductActionId(String(product.id));
    setProductsError('');
    setProductsNotice('');
    try {
      const updated = await updateBusinessProduct(selectedBusinessId, String(product.id), {
        is_available: !product.available,
      });
      setProducts(current => current.map(item => item.id === updated.id ? toProduct(updated) : item));
      setProductsNotice(updated.is_available ? 'Producto publicado.' : 'Publicación pausada.');
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setProductsError(`No se pudo cambiar la disponibilidad del producto: ${detail}`);
    } finally {
      setProductActionId(null);
    }
  }

  async function removeProduct(product: Product) {
    if (!selectedBusinessId || !window.confirm('¿Eliminar este producto de Supabase?')) return;
    setProductActionId(String(product.id));
    setProductsError('');
    setProductsNotice('');
    try {
      await deleteBusinessProduct(selectedBusinessId, String(product.id));
      setProducts(current => current.filter(item => item.id !== product.id));
      setProductsNotice('Producto eliminado de Supabase.');
      if (editingProductId === String(product.id)) setEditingProductId(null);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setProductsError(`No se pudo eliminar el producto: ${detail}`);
    } finally {
      setProductActionId(null);
    }
  }

  async function updateStatus(order: MealOrder, status: OrderStatus) {
    let reason: string | null = null;
    if (status === 'rejected') {
      const enteredReason = window.prompt('¿Por qué rechazás el pedido?');
      if (enteredReason === null) return;
      reason = enteredReason.trim();
      if (!reason) {
        setOrdersError('Ingresá un motivo para rechazar el pedido.');
        return;
      }
    } else if (status === 'cancelled') {
      const enteredReason = window.prompt('Motivo de cancelación (opcional):');
      if (enteredReason === null) return;
      reason = enteredReason.trim() || null;
    }

    setOrderStatusBusyId(order.id);
    setOrdersError('');
    try {
      await updateMealOrderStatus(order.id, status, reason);
      const refreshedOrders = await listBusinessMealOrders(selectedBusinessId);
      setOrders(refreshedOrders);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setOrdersError(`No se pudo actualizar el estado del pedido: ${detail}`);
    } finally {
      setOrderStatusBusyId(null);
    }
  }

  async function setDeliveryQuote(order: MealOrder) {
    const enteredFee = window.prompt('Costo de envío acordado en pesos (ingresá 0 si es gratuito):');
    if (enteredFee === null) return;
    const fee = Number(enteredFee.trim().replace(',', '.'));
    if (!Number.isFinite(fee) || fee < 0) {
      setOrdersError('Ingresá un costo de envío válido, mayor o igual a cero.');
      return;
    }

    setOrderStatusBusyId(order.id);
    setOrdersError('');
    try {
      await setMealOrderDeliveryFee(order.id, fee);
      setOrders(await listBusinessMealOrders(selectedBusinessId));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setOrdersError(`No se pudo guardar el costo de envío: ${detail}`);
    } finally {
      setOrderStatusBusyId(null);
    }
  }

  async function reviewTransfer(order: MealOrder, approved: boolean) {
    const prompt = approved
      ? '¿Confirmás que verificaste manualmente el ingreso de esta transferencia?'
      : '¿Rechazás la transferencia? El pedido también se marcará como rechazado y se devolverá el stock.';
    if (!window.confirm(prompt)) return;

    setOrderStatusBusyId(order.id);
    setOrdersError('');
    try {
      await reviewMealOrderTransfer(order.id, approved);
      setOrders(await listBusinessMealOrders(selectedBusinessId));
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Error inesperado.';
      setOrdersError(`No se pudo revisar la transferencia: ${detail}`);
    } finally {
      setOrderStatusBusyId(null);
    }
  }

  return (
    <main className="min-h-screen bg-[#FFF3E5] text-[#8B3F14]">
      <div className="max-w-6xl mx-auto px-5 py-10">
        <Link
          to="/"
          className="inline-block mb-6 font-semibold text-[#8B3F14]"
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

        <section className="mb-8 rounded-2xl border border-green-100 bg-white p-6 shadow-sm" aria-labelledby="business-account-heading">
          <h2 id="business-account-heading" className="text-xl font-black">Mis emprendimientos</h2>
          <p className="mt-1 text-sm text-gray-600">Estos registros se guardan en Supabase y solo se consultan los que administrás.</p>

          {businessesLoading && <p className="mt-4 text-sm text-gray-600" role="status">Cargando tus emprendimientos…</p>}
          {businessesError && (
            <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">
              <p>{businessesError}</p>
              <button
                type="button"
                onClick={() => setBusinessesReload(current => current + 1)}
                className="mt-2 underline"
              >
                Reintentar consulta
              </button>
            </div>
          )}
          {businessNotice && <p className="mt-4 rounded-xl bg-green-50 p-4 text-sm font-semibold text-green-800" role="status">{businessNotice}</p>}
          {publicationError && <p className="mt-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">{publicationError}</p>}
          {publicationNotice && <p className="mt-4 rounded-xl bg-green-50 p-4 text-sm font-semibold text-green-800" role="status">{publicationNotice}</p>}
          <input
            ref={managedLogoInput}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={event => void uploadManagedBusinessLogo(event)}
          />

          {!businessesLoading && !businessesError && managedBusinesses.length === 0 && (
            <p className="mt-4 text-sm text-gray-600">Todavía no tenés emprendimientos registrados en Supabase.</p>
          )}
          {managedBusinesses.length > 0 && (
            <ul className="mt-4 grid gap-3">
              {managedBusinesses.map(business => (
                <li key={business.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-orange-100 p-4">
                  <div>
                    <h3 className="font-bold">{business.name}</h3>
                    {business.description && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{business.description}</p>}
                    {business.location && <p className="mt-1 text-sm text-gray-600">{business.location}</p>}
                    {business.directions && <p className="mt-1 text-sm text-gray-600">Referencia: {business.directions}</p>}
                    <label className="mt-2 flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={business.phone_is_public}
                        onChange={event => void setBusinessPhoneVisibility(business.id, event.target.checked)}
                        disabled={phoneVisibilitySavingId !== null}
                      />
                      <span>
                        {phoneVisibilitySavingId === business.id
                          ? 'Guardando visibilidad del WhatsApp…'
                          : 'Mostrar WhatsApp en el catálogo público'}
                      </span>
                    </label>
                    <p className={`mt-2 text-sm font-bold ${business.is_published ? 'text-green-700' : 'text-gray-500'}`}>
                      Estado: {business.is_published ? 'Publicado' : 'No publicado'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingLocationBusinessId(current =>
                          current === business.id ? null : business.id,
                        );
                        setLocationDraft(business.location ?? '');
                        setDirectionsDraft(business.directions ?? '');
                        setLocationSaveError('');
                        setLocationSaveNotice('');
                      }}
                      className="rounded-xl border border-[#E8C9AA] px-4 py-2 font-bold"
                    >
                      {editingLocationBusinessId === business.id ? 'Cancelar ubicación' : 'Editar ubicación'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLogoBusinessId(business.id);
                        managedLogoInput.current?.click();
                      }}
                      disabled={uploadingLogoBusinessId !== null}
                      className="rounded-xl border border-[#E8C9AA] px-4 py-2 font-bold disabled:opacity-60"
                    >
                      {uploadingLogoBusinessId === business.id ? 'Subiendo logo…' : business.logo_path ? 'Cambiar logo' : 'Subir logo'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleBusinessPublication(business)}
                      disabled={businessesLoading || publicationBusyId !== null}
                      className={`rounded-xl px-4 py-2 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60 ${business.is_published ? 'bg-gray-600 hover:bg-gray-700' : 'bg-[#8B3F14] hover:bg-[#B84E0E]'}`}
                    >
                      {publicationBusyId === business.id
                        ? 'Actualizando…'
                        : business.is_published ? 'Pausar negocio' : 'Publicar negocio'}
                    </button>
                  </div>
                  {editingLocationBusinessId === business.id && (
                    <div className="grid w-full basis-full gap-3 rounded-xl bg-orange-50 p-4">
                      <label className="text-sm font-semibold">
                        Dirección exacta
                        <input
                          value={locationDraft}
                          onChange={event => setLocationDraft(event.target.value)}
                          maxLength={180}
                          className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                          placeholder="Calle, número, barrio y localidad"
                        />
                      </label>
                      <label className="text-sm font-semibold">
                        Referencia para llegar (opcional)
                        <textarea
                          value={directionsDraft}
                          onChange={event => setDirectionsDraft(event.target.value)}
                          maxLength={300}
                          rows={2}
                          className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                          placeholder="Indicaciones breves para encontrar el local"
                        />
                      </label>
                      {locationSaveError && <p role="alert" className="text-sm font-semibold text-red-700">{locationSaveError}</p>}
                      <button
                        type="button"
                        onClick={() => void saveBusinessLocation(business.id)}
                        disabled={savingLocationBusinessId !== null}
                        className="w-fit rounded-xl bg-[#8B3F14] px-4 py-2 font-bold text-white disabled:opacity-60"
                      >
                        {savingLocationBusinessId === business.id ? 'Guardando…' : 'Guardar ubicación'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {locationSaveNotice && <p role="status" className="mt-3 text-sm font-semibold text-green-800">{locationSaveNotice}</p>}
          {phoneVisibilityError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{phoneVisibilityError}</p>}

          <form onSubmit={registerBusiness} className="mt-5 grid gap-3 border-t border-orange-100 pt-5">
            <h3 className="font-bold">Registrar un emprendimiento</h3>
            {businessFormError && <p className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">{businessFormError}</p>}
            <label className="text-sm font-semibold">
              Nombre
              <input
                value={businessName}
                onChange={event => setBusinessName(event.target.value)}
                maxLength={120}
                required
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                placeholder="Nombre de tu emprendimiento"
              />
            </label>
            <label className="text-sm font-semibold">
              Descripción (opcional)
              <textarea
                value={businessDescription}
                onChange={event => setBusinessDescription(event.target.value)}
                maxLength={2000}
                rows={3}
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                placeholder="Contá brevemente qué ofrecés"
              />
            </label>
            <label className="text-sm font-semibold">
              Dirección del punto de venta
              <input
                value={businessLocation}
                onChange={event => setBusinessLocation(event.target.value)}
                maxLength={180}
                required
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                placeholder="Calle, número, barrio y localidad"
              />
            </label>
            <label className="text-sm font-semibold">
              Referencia para llegar (opcional)
              <textarea
                value={businessDirections}
                onChange={event => setBusinessDirections(event.target.value)}
                maxLength={300}
                rows={2}
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                placeholder="Indicaciones breves para encontrar el local"
              />
            </label>
            <label className="text-sm font-semibold">
              WhatsApp para recibir pedidos
              <input
                type="tel"
                value={businessPhone}
                onChange={event => setBusinessPhone(event.target.value)}
                maxLength={16}
                required
                className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                placeholder="+5492611234567"
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={businessPhonePublic}
                onChange={event => setBusinessPhonePublic(event.target.checked)}
              />
              <span>Autorizo que este WhatsApp se muestre en el catálogo público para recibir consultas y pedidos. Está activado por defecto.</span>
            </label>
            <div className="rounded-xl border border-orange-100 p-4">
              <p className="text-sm">Para ubicar tu emprendimiento en MORFI, permití el acceso a tu ubicación GPS.</p>
              <button
                type="button"
                onClick={useBusinessLocation}
                className="mt-3 rounded-xl border border-[#E8C9AA] px-4 py-2 font-bold"
              >
                USAR MI UBICACIÓN
              </button>
              {businessLocationNotice && <p className="mt-2 text-sm" role="status">{businessLocationNotice}</p>}
              {businessLatitude !== null && businessLongitude !== null && (
                <>
                  <p className="mt-1 text-xs text-gray-500">Ubicación GPS lista para guardar.</p>
                  <BusinessLocationMap latitude={businessLatitude} longitude={businessLongitude} />
                </>
              )}
            </div>
            <div>
              <input
                ref={businessLogoInput}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={event => {
                  setBusinessLogo(event.target.files?.[0] ?? null);
                  event.target.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => businessLogoInput.current?.click()}
                className="rounded-xl border border-[#E8C9AA] px-4 py-3 font-bold"
              >
                SUBIR LOGO
              </button>
              {businessLogo && <p className="mt-2 text-sm">{businessLogo.name}</p>}
              {businessLogoPreview && (
                <img
                  src={businessLogoPreview}
                  alt="Vista previa del logo del emprendimiento"
                  className="mt-3 h-24 w-24 rounded-full border bg-white object-contain p-1"
                />
              )}
            </div>
            <fieldset className="rounded-xl border border-orange-100 p-4">
              <legend className="px-1 text-sm font-bold">Medios de pago</legend>
              <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={acceptsCash} onChange={event => setAcceptsCash(event.target.checked)} />
                Acepto efectivo
              </label>
              <label className="mt-2 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={acceptsTransfer} onChange={event => setAcceptsTransfer(event.target.checked)} />
                Acepto transferencias
              </label>
              {acceptsTransfer && <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-semibold">
                    Banco o billetera
                    <select value={bankName} onChange={event => setBankName(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal">
                      <option value="">Elegí una opción</option>
                      {argentinePaymentProviders.map(provider => <option key={provider} value={provider}>{provider}</option>)}
                      <option value="Otro">Otro</option>
                    </select>
                  </label>
                  {bankName === 'Otro' && (
                    <label className="text-sm font-semibold">
                      Escribí el nombre
                      <input value={otherBankName} onChange={event => setOtherBankName(event.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                    </label>
                  )}
                  <label className="text-sm font-semibold">
                    Alias
                    <input value={transferAlias} onChange={event => setTransferAlias(event.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                  </label>
                  <label className="text-sm font-semibold">
                    Titular de la cuenta
                    <input value={transferHolder} onChange={event => setTransferHolder(event.target.value)} maxLength={120} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                  </label>
                  <label className="text-sm font-semibold">
                    CUIT (11 números)
                    <input inputMode="numeric" value={bankCuit} onChange={event => setBankCuit(event.target.value)} maxLength={13} required className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal" />
                  </label>
              </div>}
            </fieldset>
            <div>
              <button
                type="submit"
                disabled={creatingBusiness || businessesLoading}
                className="rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creatingBusiness ? 'Registrando…' : 'Registrar emprendimiento'}
              </button>
            </div>
          </form>
        </section>

        <section className="mb-8 rounded-2xl border border-green-100 bg-white p-6 shadow-sm">
          <label htmlFor="selected-business" className="block text-sm font-bold">
            Emprendimiento para gestionar productos
            <select
              id="selected-business"
              value={selectedBusinessId}
              onChange={event => {
                setSelectedBusinessId(event.target.value);
                setEditingProductId(null);
                setProductsNotice('');
                setProductsError('');
              }}
              disabled={businessesLoading || managedBusinesses.length === 0 || productsLoading || savingProduct || productActionId !== null}
              className="mt-2 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal disabled:bg-gray-100"
            >
              <option value="">
                {businessesLoading ? 'Cargando emprendimientos…' : 'Seleccioná un emprendimiento'}
              </option>
              {managedBusinesses.map(business => (
                <option key={business.id} value={business.id}>{business.name}</option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-gray-600">
            El stock se consulta desde Supabase, pero la migración actual no concede permisos al cliente para modificar stock_quantity.
          </p>
        </section>

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
                ? 'bg-[#8B3F14] text-white'
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
                ? 'bg-[#8B3F14] text-white'
                : 'bg-white border border-green-200'
            }`}
          >
            Pedidos recibidos
          </button>
          <button
            type="button"
            onClick={() => setTab('ingredientes')}
            className={`px-6 py-3 rounded-xl font-bold ${
              tab === 'ingredientes'
                ? 'bg-[#8B3F14] text-white'
                : 'bg-white border border-green-200'
            }`}
          >
            Costos y preparación
          </button>
          <button
            type="button"
            onClick={() => setTab('recetas')}
            className={`px-6 py-3 rounded-xl font-bold ${
              tab === 'recetas'
                ? 'bg-[#8B3F14] text-white'
                : 'bg-white border border-green-200'
            }`}
          >
            Recetas
          </button>
          <button
            type="button"
            onClick={() => setTab('produccion')}
            className={`px-6 py-3 rounded-xl font-bold ${
              tab === 'produccion'
                ? 'bg-[#8B3F14] text-white'
                : 'bg-white border border-green-200'
            }`}
          >
            Preparar productos
          </button>
        </div>

        {tab === 'productos' ? (
          <div className="space-y-6">
            {!selectedBusinessId ? (
              <p className="rounded-xl bg-amber-50 p-4 text-sm font-semibold text-amber-900" role="status">
                Elegí uno de tus emprendimientos para cargar y administrar sus productos.
              </p>
            ) : null}
            <form
              id="product-form"
              onSubmit={event => void addProduct(event)}
              className="bg-white rounded-2xl p-6 shadow-sm border border-green-100"
            >
              <h2 className="text-xl font-black mb-2">¿Qué vas a vender?</h2>
              <p className="mb-5 text-sm text-gray-600">Completá los datos del producto y guardalo en el emprendimiento seleccionado.</p>
              {editingProductId && (
                <p className="mb-4 flex flex-wrap items-center gap-3 rounded-xl bg-orange-50 p-3 text-sm font-semibold">
                  Editando producto
                  <button
                    type="button"
                    onClick={() => {
                      setEditingProductId(null);
                      setName('');
                      setDescription('');
                      setPrice('');
                      setProductPhoto('');
                      setIsAvailable(true);
                      setAcceptsDelivery(false);
                      setProductPaymentMethods(['cash', 'transfer']);
                      setCashDiscountPercent('');
                    }}
                    className="underline"
                  >
                    Cancelar edición
                  </button>
                </p>
              )}

              {!editingProductId && <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold">
                  Plantilla de ingredientes
                  <select
                    value={productType}
                    onChange={event => {
                      const selectedType = productTypes.find(item => item.name === event.target.value);
                      setProductType(event.target.value);
                      setIngredientCosts(selectedType?.ingredients.map(ingredientDraft) ?? []);
                      setCustomProductType('');
                    }}
                    className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3"
                  >
                    {productTypes.map(type => <option key={type.name} value={type.name}>{type.name}</option>)}
                  </select>
                </label>
                {productType === 'Otro' && (
                  <label className="text-sm font-semibold">
                    ¿Qué vas a vender?
                    <input
                      value={customProductType}
                      onChange={event => setCustomProductType(event.target.value)}
                      maxLength={80}
                      required
                      className="mt-1 w-full rounded-xl border border-gray-300 p-3 font-normal"
                      placeholder="Escribí el tipo de producto"
                    />
                  </label>
                )}
                <fieldset className="rounded-xl border border-orange-100 p-3">
                  <legend className="px-1 text-sm font-semibold">¿Cómo querés vender?</legend>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 font-normal">
                      <input type="radio" name="sale-mode" checked={saleMode === 'direct'} onChange={() => setSaleMode('direct')} />
                      Vender directo
                    </label>
                    <label className="flex items-center gap-2 font-normal">
                      <input type="radio" name="sale-mode" checked={saleMode === 'cost'} onChange={() => setSaleMode('cost')} />
                      Calcular costos primero
                    </label>
                  </div>
                </fieldset>
              </div>}
              {!editingProductId && (
                <p className="mb-4 text-xs text-gray-500">
                  La tabla actual de productos no tiene columna de categoría; esta plantilla solo propone ingredientes para el cálculo local de costos.
                </p>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  maxLength={160}
                  aria-label="Nombre del producto"
                  placeholder="Nombre del producto (ej.: empanadas de carne)"
                  className="border border-gray-300 rounded-xl p-3"
                  required
                />

                <input
                  value={description}
                  onChange={event => setDescription(event.target.value)}
                  aria-label="Descripción breve"
                  placeholder="Descripción breve de tu producto"
                  maxLength={1000}
                  className="border border-gray-300 rounded-xl p-3"
                />

                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={price}
                  onChange={event => setPrice(event.target.value)}
                  aria-label="¿A cuánto lo querés vender?"
                  placeholder="¿A cuánto lo querés vender?"
                  className="border border-gray-300 rounded-xl p-3"
                  required={saleMode === 'direct'}
                />
                {saleMode === 'cost' && (
                  <button
                    type="button"
                    disabled={suggestedPrice <= 0}
                    onClick={() => setPrice(suggestedPrice.toFixed(2))}
                    className="rounded-xl border border-orange-200 p-3 text-left font-semibold disabled:opacity-50"
                  >
                    Usar precio sugerido: {money(suggestedPrice)}
                  </button>
                )}

                <label className="flex items-center gap-2 rounded-xl border border-orange-100 p-3 text-sm font-semibold">
                  <input type="checkbox" checked={isAvailable} onChange={event => setIsAvailable(event.target.checked)} />
                  Disponible para publicar
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-orange-100 p-3 text-sm font-semibold">
                  <input type="checkbox" checked={acceptsDelivery} onChange={event => setAcceptsDelivery(event.target.checked)} />
                  Acepta delivery
                </label>
                <fieldset className="rounded-xl border border-orange-100 p-3">
                  <legend className="px-1 text-sm font-semibold">Medios de pago para este producto</legend>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm font-normal">
                      <input
                        type="checkbox"
                        checked={productPaymentMethods.includes('cash')}
                        onChange={event => setProductPaymentMethods(current =>
                          event.target.checked
                            ? [...current, 'cash']
                            : current.filter(method => method !== 'cash')
                        )}
                      />
                      Efectivo
                    </label>
                    <label className="flex items-center gap-2 text-sm font-normal">
                      <input
                        type="checkbox"
                        checked={productPaymentMethods.includes('transfer')}
                        onChange={event => setProductPaymentMethods(current =>
                          event.target.checked
                            ? [...current, 'transfer']
                            : current.filter(method => method !== 'transfer')
                        )}
                      />
                      Transferencia
                    </label>
                  </div>
                </fieldset>
              </div>

              <div className="mt-4">
                <p className="text-sm font-semibold">Foto del producto (opcional, hasta 400 KB)</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => cameraInput.current?.click()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Sacar foto</button>
                  <button type="button" onClick={() => photoInput.current?.click()} className="rounded-lg border px-3 py-2 text-sm font-semibold">Elegir de galería</button>
                </div>
                <input ref={cameraInput} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={loadProductPhoto} className="sr-only" />
                <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" onChange={loadProductPhoto} className="sr-only" />
                {productPhoto && <img src={productPhoto} alt="Vista previa del producto" className="mt-3 h-24 w-32 rounded-lg border object-cover" />}
              </div>

              {saleMode === 'cost' && (
                <div className="mt-5 rounded-xl bg-[#FFF9F2] p-4">
                  <h3 className="font-bold">Armá la receta y calculá los costos</h3>
                  <p className="mt-1 text-sm text-gray-600">Indicá qué presentación compraste, cuánto pagaste y la cantidad y unidad que usás en esta receta.</p>
                  <div className="mt-3 space-y-2">
                    {ingredientCosts.map((item, index) => {
                      const packageAmount = Number(item.packageQuantity);
                      const packagePrice = Number(item.packagePrice);
                      const usedAmount = Number(item.recipeQuantity);
                      const compatibleUnits =
                        ((item.unit === 'g' || item.unit === 'kg') && (item.recipeUnit === 'g' || item.recipeUnit === 'kg')) ||
                        ((item.unit === 'ml' || item.unit === 'l') && (item.recipeUnit === 'ml' || item.recipeUnit === 'l')) ||
                        (item.unit === 'unidad' && item.recipeUnit === 'unidad');
                      const ingredientCost = item.packageQuantity.trim() !== '' &&
                        item.packagePrice.trim() !== '' &&
                        item.recipeQuantity.trim() !== '' &&
                        packageAmount > 0 && packagePrice >= 0 && usedAmount > 0 && compatibleUnits
                        ? packagePrice * (usedAmount * packageFactor(item.recipeUnit)) / (packageAmount * packageFactor(item.unit))
                        : null;
                      return <div key={`${item.name}-${index}`} className="grid gap-2 rounded-xl border border-orange-100 bg-white p-3 sm:grid-cols-2 lg:grid-cols-[minmax(120px,1fr)_100px_minmax(110px,1fr)_100px_100px_minmax(110px,1fr)_110px_auto]">
                        <input
                          value={item.name}
                          onChange={event => setIngredientCosts(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, name: event.target.value } : line))}
                          aria-label={`Ingrediente ${index + 1}`}
                          placeholder="Ingrediente"
                          className="min-w-0 rounded-lg border border-gray-300 p-3"
                          required
                        />
                        <select
                          value={item.unit}
                          onChange={event => setIngredientCosts(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, unit: event.target.value as IngredientUnit } : line))}
                          aria-label={`Unidad de compra de ${item.name}`}
                          className="rounded-lg border border-gray-300 bg-white p-3"
                        >
                          {ingredientUnits.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                        </select>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={item.packageQuantity}
                          onChange={event => setIngredientCosts(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, packageQuantity: event.target.value } : line))}
                          aria-label={`Cantidad comprada de ${item.name}`}
                          placeholder={`Comprás (${item.unit})`}
                          className="min-w-0 rounded-lg border border-gray-300 p-3"
                          required
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.packagePrice}
                          onChange={event => setIngredientCosts(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, packagePrice: event.target.value } : line))}
                          aria-label={`Precio de compra de ${item.name}`}
                          placeholder="Precio pagado"
                          className="min-w-0 rounded-lg border border-gray-300 p-3"
                          required
                        />
                        <select
                          value={item.recipeUnit}
                          onChange={event => setIngredientCosts(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, recipeUnit: event.target.value as IngredientUnit } : line))}
                          aria-label={`Unidad usada en receta para ${item.name}`}
                          className="rounded-lg border border-gray-300 bg-white p-3"
                        >
                          {ingredientUnits.map(unit => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                        </select>
                        <input
                          type="number"
                          min="0.001"
                          step="any"
                          value={item.recipeQuantity}
                          onChange={event => setIngredientCosts(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, recipeQuantity: event.target.value } : line))}
                          aria-label={`Cantidad de ${item.name} usada en la receta`}
                          placeholder={`Usás (${item.recipeUnit})`}
                          className="min-w-0 rounded-lg border border-gray-300 p-3"
                          required
                        />
                        <p className="self-center text-sm font-semibold text-[#8B3F14]">{ingredientCost === null ? 'Costo de uso: —' : `Costo de uso: ${money(ingredientCost)}`}</p>
                        <button type="button" onClick={() => setIngredientCosts(current => current.filter((_, lineIndex) => lineIndex !== index))} aria-label={`Quitar ${item.name}`} className="rounded-lg border border-red-200 px-3 font-semibold text-red-700">Quitar</button>
                      </div>;
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <input value={customIngredient} onChange={event => setCustomIngredient(event.target.value)} placeholder="Otro ingrediente" className="min-w-0 flex-1 rounded-lg border border-gray-300 p-3" />
                    <button
                      type="button"
                      onClick={() => {
                        const ingredient = customIngredient.trim();
                        if (!ingredient) return;
                        setIngredientCosts(current => [...current, ingredientDraft(ingredient)]);
                        setCustomIngredient('');
                      }}
                      className="rounded-lg border px-4 py-2 font-semibold"
                    >
                      + Agregar ingrediente
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="text-sm font-semibold">
                      Porciones que rinde la receta (opcional)
                      <input type="number" min="1" step="1" value={yieldQuantity} onChange={event => setYieldQuantity(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal" />
                    </label>
                    <label className="text-sm font-semibold">
                      Costos indirectos de toda la receta
                      <input type="number" min="0" step="0.01" value={additionalCosts} onChange={event => setAdditionalCosts(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 p-3 font-normal" required />
                    </label>
                  </div>
                  {ingredientCosts.length > 0 && ingredientCosts.every(item =>
                    item.packageQuantity.trim() !== '' &&
                    item.packagePrice.trim() !== '' &&
                    item.recipeQuantity.trim() !== '' &&
                    Number(item.packageQuantity) > 0 &&
                    Number.isFinite(Number(item.packagePrice)) &&
                    Number(item.packagePrice) >= 0 &&
                    Number(item.recipeQuantity) > 0
                  ) && (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <CostSummary label="Materia prima por porción" value={rawMaterialCost / recipeYield} />
                      <CostSummary label="Costos indirectos por porción" value={indirectCost / recipeYield} />
                      <CostSummary label="Costo total por porción" value={totalCostPerPortion} />
                      <CostSummary label="Precio sugerido (30% adicional)" value={suggestedPrice} />
                      <CostSummary label="Ganancia estimada por porción" value={estimatedGainPerPortion} />
                    </div>
                  )}
                  {!yieldQuantity.trim() && <p className="mt-2 text-xs text-gray-500">Sin indicar porciones, MORFI toma el costo de la receta completa como costo por porción.</p>}
                  <p className="mt-3 text-xs text-gray-500">La ganancia es una estimación con los costos ingresados; no incluye impuestos ni otros gastos que no hayas cargado.</p>
                </div>
              )}
              {formError && <p role="alert" className="mt-3 text-sm font-semibold text-red-700">{formError}</p>}

              <div className="mt-4">
                <button
                  type="submit"
                  disabled={!selectedBusinessId || savingProduct || businessesLoading}
                  className="bg-[#F6A623] text-[#8B3F14] font-black rounded-xl p-3 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {savingProduct ? 'Guardando…' : editingProductId ? 'Guardar cambios' : '+ Guardar producto'}
                </button>
              </div>
            </form>

            <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
              <h2 className="text-xl font-black mb-5">Catálogo del negocio</h2>
              {productsLoading && <p className="mb-4 text-sm text-gray-600" role="status">Cargando productos desde Supabase…</p>}
              {productsError && (
                <div className="mb-4 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800" role="alert">
                  <p>{productsError}</p>
                  <button type="button" onClick={() => setProductsReload(current => current + 1)} className="mt-2 underline">
                    Reintentar carga
                  </button>
                </div>
              )}
              {productsNotice && <p className="mb-4 rounded-xl bg-green-50 p-4 text-sm font-semibold text-green-800" role="status">{productsNotice}</p>}

              <div className="space-y-3">
                {products.map(product => (
                  <div
                    key={product.id}
                    className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-100 pb-4"
                  >
                    <div>
                      {product.image && <img src={product.image} alt={product.name} className="mb-3 h-32 w-48 rounded-lg object-cover" />}
                      <p className="font-bold">{product.name}</p>
                      {product.description && <p className="text-sm text-gray-600">{product.description}</p>}
                      <p className="text-sm text-gray-500">{product.category ?? 'Producto'}{product.quantity !== undefined ? ` · Stock registrado: ${product.quantity}` : ''}</p>
                      <p className="text-sm text-gray-500">
                        {product.acceptsDelivery ? 'Acepta delivery' : 'Sin delivery'} ·
                        {' '}{product.paymentMethods?.includes('transfer')
                          ? 'Transferencia'
                          : 'Actualizá el producto para aceptar transferencia'}
                      </p>
                      <p className="text-gray-600">{money(product.price)}</p>
                      {product.sellerAlias && <p className="mt-2 text-sm"><strong>Alias para transferir:</strong> {product.sellerAlias}{product.sellerHolder ? ` · ${product.sellerHolder}` : ''}</p>}
                      {product.sellerLocation && <p className="mt-1 text-sm text-gray-600"><strong>Local:</strong> {product.sellerLocation}{product.sellerDirections ? ` · ${product.sellerDirections}` : ''}</p>}
                      {profile?.phone && <a href={`https://wa.me/${profile.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hola, quiero consultar por ${product.name}`)}`} target="_blank" rel="noreferrer" className="mt-2 inline-block rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white">Consultar por WhatsApp</a>}
                      {product.saleMode === 'cost' && product.costPerUnit !== undefined && (
                        <div className="mt-2 space-y-1 text-sm text-gray-600">
                          <p>Materia prima por porción: {money(product.rawMaterialCostPerPortion ?? 0)}</p>
                          <p>Costos indirectos por porción: {money(product.indirectCostPerPortion ?? 0)}</p>
                          <p>Costo total por porción: {money(product.costPerUnit)}</p>
                          <p>Precio sugerido: {money(product.suggestedPrice ?? 0)}</p>
                          <p>Ganancia estimada por porción: {money(product.estimatedGainPerPortion ?? 0)}</p>
                        </div>
                      )}
                      <p className={`text-sm font-semibold ${
                        product.available ? 'text-green-700' : 'text-red-600'
                      }`}>
                        {product.available ? 'Publicado' : 'Pausado'}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => editProduct(product)}
                        disabled={productsLoading || productActionId !== null}
                        className="px-4 py-2 border rounded-lg font-semibold"
                      >
                        Editar producto
                      </button>

                      <button
                        type="button"
                        onClick={() => void toggleProductAvailability(product)}
                        disabled={productsLoading || productActionId === String(product.id)}
                        className="px-4 py-2 bg-[#FFF3E5] rounded-lg font-semibold"
                      >
                        {productActionId === String(product.id) ? 'Guardando…' : product.available ? 'Pausar publicación' : 'Publicar'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void removeProduct(product)}
                        disabled={productsLoading || productActionId === String(product.id)}
                        className="px-4 py-2 text-red-700 border border-red-200 rounded-lg font-semibold"
                      >
                        Eliminar
                      </button>
                    </div>
                  </div>
                ))}

                {!productsLoading && selectedBusinessId && products.length === 0 && (
                  <p className="text-gray-500">Todavía no hay productos.</p>
                )}
              </div>
            </div>
          </div>
        ) : tab === 'pedidos' ? (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <h2 className="text-xl font-black mb-2">Gestión de pedidos</h2>
            <p className="text-gray-500 mb-6">
              Aceptá o rechazá pedidos y actualizá el estado para que el cliente sepa cómo va.
            </p>
            {ordersError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{ordersError}</p>}
            {ordersLoading && <p role="status" className="mb-4 text-sm text-gray-600">Cargando pedidos de Supabase…</p>}
            {!ordersLoading && !ordersError && orders.length === 0 && (
              <p className="rounded-xl border border-dashed p-5 text-gray-600">Todavía no recibiste pedidos.</p>
            )}

            <div className="space-y-4">
              {orders.map(order => (
                <div
                  key={order.id}
                  className="border border-gray-200 rounded-xl p-4 flex flex-wrap justify-between gap-4"
                >
                  <div>
                    <p className="font-black">Pedido #{order.order_number ?? order.id.slice(0, 8)}</p>
                    <p>{order.customer_name || 'Cliente MORFI'}</p>
                    {order.customer_phone && <p className="text-sm text-gray-600">WhatsApp: {order.customer_phone}</p>}
                    {order.customer_phone && (
                      <a
                        href={`https://wa.me/${order.customer_phone.replace(/\D/g, '').replace(/^0/, '').replace(/^15/, '').replace(/^([^5])/, '54$1')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white"
                      >
                        Contactar por WhatsApp
                      </a>
                    )}
                    <ul className="mt-2 text-sm text-gray-600">
                      {order.items.map((item, index) => (
                        <li key={`${order.id}-${index}`}>
                          {item.quantity} × {item.product_name} · {money(item.line_total)}
                          {item.customer_notes && <p className="ml-3 text-gray-700">Observación: {item.customer_notes}</p>}
                        </li>
                      ))}
                    </ul>
                    {order.customer_notes && <p className="mt-2 text-sm"><strong>Observaciones del pedido:</strong> {order.customer_notes}</p>}
                    <p className="mt-2 text-sm">Subtotal: {money(order.subtotal)}{order.discount_total > 0 ? ` · Descuento: ${money(order.discount_total)}` : ''}</p>
                    <p className="mt-1 text-sm font-bold">
                      {order.total === null ? 'Total pendiente de cotización' : `Total: ${money(order.total)}`}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(order.created_at).toLocaleString('es-AR')} · {order.delivery_mode === 'pickup' ? 'Retiro en el local' : `Entrega: ${order.delivery_address ?? ''}`} · {order.payment_method === 'cash' ? 'Efectivo' : 'Transferencia'}
                    </p>
                    {order.delivery_mode === 'delivery' && (
                      <p className="mt-1 text-sm">
                        {deliveryFeeStatusLabel(order.delivery_fee_status)}
                        {order.delivery_fee !== null && ` · ${money(order.delivery_fee)}`}
                        {order.delivery_references && ` · Referencias: ${order.delivery_references}`}
                      </p>
                    )}
                    <p className="mt-1 text-sm font-semibold">Estado del pago: {paymentStatusLabel(order.payment_status, order.delivery_fee_status)}</p>
                    {order.payment_method === 'transfer' && (order.transfer_bank || order.transfer_alias || order.transfer_holder) && (
                      <p className="mt-1 text-sm">
                        Datos de transferencia: {order.transfer_bank || 'Banco no informado'} · Alias: {order.transfer_alias || 'No informado'} · Titular: {order.transfer_holder || 'No informado'}
                      </p>
                    )}
                    <p className="mt-2 text-sm font-bold">{orderStatusLabel(order.status, order.delivery_mode)}</p>
                    {order.status_reason && <p className="mt-1 text-sm text-gray-600">Motivo: {order.status_reason}</p>}
                    {isOrderCheckoutV2Enabled && order.delivery_mode === 'delivery' && order.delivery_fee_status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => void setDeliveryQuote(order)}
                        disabled={orderStatusBusyId === order.id}
                        className="mt-3 rounded-lg bg-[#F6A623] px-3 py-2 text-sm font-bold text-[#8B3F14] disabled:opacity-50"
                      >
                        Registrar costo acordado (0 si es gratis)
                      </button>
                    )}
                    {order.payment_method === 'transfer' &&
                      ['pending_payment', 'pending_verification'].includes(order.payment_status ?? '') &&
                      order.delivery_fee_status !== 'pending' && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void reviewTransfer(order, true)}
                          disabled={orderStatusBusyId === order.id}
                          className="rounded-lg bg-green-700 px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          Verifiqué manualmente la transferencia
                        </button>
                        <button
                          type="button"
                          onClick={() => void reviewTransfer(order, false)}
                          disabled={orderStatusBusyId === order.id}
                          className="rounded-lg border border-red-300 px-3 py-2 text-sm font-bold text-red-700 disabled:opacity-50"
                        >
                          Rechazar transferencia
                        </button>
                      </div>
                    )}
                    {order.history.length > 0 && (
                      <details className="mt-3 text-sm">
                        <summary className="cursor-pointer font-semibold">Historial del pedido</summary>
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
                        void updateStatus(order, event.target.value as OrderStatus)
                      }
                      disabled={orderStatusBusyId === order.id || nextOrderStatuses(order).length === 0}
                      className="border border-gray-300 rounded-xl p-3 bg-white disabled:bg-gray-100"
                    >
                      <option value={order.status}>{orderStatusLabel(order.status, order.delivery_mode)}</option>
                      {nextOrderStatuses(order).map(status => (
                        <option key={status} value={status}>{orderStatusLabel(status, order.delivery_mode)}</option>
                      ))}
                    </select>
                    {orderStatusBusyId === order.id && <p className="mt-2 text-sm text-gray-600" role="status">Guardando…</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <BusinessWorkflow
            ownerId={profile?.id ?? 'guest'}
            section={tab}
            onNavigate={section => setTab(section)}
          />
        )}

        <p className="text-center text-gray-500 text-sm mt-10">
          MORFI · Los pedidos se consultan y actualizan en Supabase.
        </p>
      </div>
    </main>
  );
}
