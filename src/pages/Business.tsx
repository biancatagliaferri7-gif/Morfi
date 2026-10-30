
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BusinessWorkflow from './BusinessWorkflow';
import type { BusinessSection } from './BusinessWorkflow';
import { useAuth } from '../AuthContext';
import { isIngredient, isRecipe } from '../business/calculations';
import type { Ingredient, Recipe } from '../business/types';

type Product = {
  id: number;
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

type Order = {
  id: string | number;
  customer: string;
  product: string;
  total: number;
  status: 'Pendiente' | 'Aceptado' | 'Preparando' | 'Listo para la entrega' | 'Entregado' | 'Rechazado';
};

const initialProducts: Product[] = [
  { id: 1, name: 'Milanesa con puré', price: 9500, available: true, description: 'Milanesa de carne con puré de papas.', category: 'Viandas', quantity: 12, saleMode: 'direct' },
  { id: 2, name: 'Tarta de verduras', price: 8000, available: true, description: 'Tarta casera con verduras de estación.', category: 'Tartas', quantity: 8, saleMode: 'direct' },
  { id: 3, name: 'Pollo al horno con papas', price: 10500, available: true, description: 'Pollo al horno con papas doradas.', category: 'Viandas', quantity: 6, saleMode: 'direct' },
];

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

const initialOrders: Order[] = [
  { id: 101, customer: 'Cliente demo 1', product: 'Milanesa con puré', total: 9500, status: 'Pendiente' },
  { id: 102, customer: 'Cliente demo 2', product: 'Tarta de verduras', total: 8000, status: 'Preparando' },
  { id: 103, customer: 'Cliente demo 3', product: 'Pollo al horno con papas', total: 10500, status: 'Entregado' },
];

const orderStatuses: Order['status'][] = [
  'Pendiente',
  'Aceptado',
  'Preparando',
  'Listo para la entrega',
  'Entregado',
  'Rechazado',
];

const defaultIngredientUnit: IngredientUnit = 'g';
const catalogUpdatedEvent = 'morfi:catalog-updated';
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

function loadData<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) as T : fallback;
  } catch {
    return fallback;
  }
}

function loadOrders(key: string): Order[] {
  const saved = loadData<unknown>(key, initialOrders);
  if (!Array.isArray(saved)) return initialOrders;
  return saved.filter((value): value is Order => {
    if (!value || typeof value !== 'object') return false;
    const order = value as Record<string, unknown>;
    return (
      (typeof order.id === 'number' || typeof order.id === 'string') &&
      typeof order.customer === 'string' &&
      typeof order.product === 'string' &&
      typeof order.total === 'number' &&
      ['Pendiente', 'Aceptado', 'Preparando', 'Listo para la entrega', 'Entregado', 'Rechazado'].includes(String(order.status))
    );
  });
}

const money = (value: number) =>
  value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });

function CostSummary({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl bg-white p-3">
      <p className="text-sm text-gray-600">{label}</p>
      <p className="mt-1 font-black">{value === null ? 'Ingresá tu precio de venta' : money(value)}</p>
    </div>
  );
}

export default function Business() {
  const { profile } = useAuth();
  const productsStorageKey = `morfi_business_products_${profile?.id ?? 'guest'}`;
  const ordersStorageKey = 'morfi_business_orders';
  const [products, setProducts] = useState<Product[]>(() =>
    loadData(productsStorageKey, initialProducts)
  );
  const [orders, setOrders] = useState<Order[]>(() => loadOrders(ordersStorageKey));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [productType, setProductType] = useState(productTypes[0].name);
  const [customProductType, setCustomProductType] = useState('');
  const [saleMode, setSaleMode] = useState<'direct' | 'cost'>('direct');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('');
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
  const [orderStorageError, setOrderStorageError] = useState('');
  const [tab, setTab] = useState<'productos' | 'pedidos' | BusinessSection>('productos');
  const packageFactor = (unit: IngredientUnit) => unit === 'kg' || unit === 'l' ? 1000 : 1;
  useEffect(() => {
    try {
      localStorage.setItem(productsStorageKey, JSON.stringify(products));
      window.dispatchEvent(new Event(catalogUpdatedEvent));
    } catch {
      setFormError('No se pudieron guardar los productos en este navegador. Probá con imágenes más pequeñas.');
    }
  }, [products, productsStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem('morfi_business_orders', JSON.stringify(orders));
      setOrderStorageError('');
    } catch {
      setOrderStorageError('No se pudieron guardar los cambios de pedidos en este navegador.');
    }
  }, [orders]);

  const sales = orders
    .filter(order => order.status === 'Entregado')
    .reduce((sum, order) => sum + order.total, 0);

  const pending = orders.filter(order => !['Entregado', 'Rechazado'].includes(order.status)).length;
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

  function addProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const enteredPrice = price.trim() ? Number(price) : null;
    const amount = enteredPrice ?? (saleMode === 'cost' ? suggestedPrice : 0);
    const availableQuantity = quantity.trim() ? Number(quantity) : undefined;
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
      (productType === 'Otro' && !customProductType.trim()) ||
      description.trim().length > 240 ||
      !Number.isFinite(amount) || amount <= 0 ||
      (availableQuantity !== undefined && (!Number.isInteger(availableQuantity) || availableQuantity < 0)) ||
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

    const costPerUnit = saleMode === 'cost' ? totalCostPerPortion : undefined;
    const productId = Date.now();
    let recipeId: string | undefined;
    if (saleMode === 'cost') {
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
        recipeId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
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
    setProducts(current => [
      ...current,
      {
        id: productId,
        name: name.trim(),
        price: amount,
        description: description.trim(),
        category: productType === 'Otro' ? customProductType.trim() : productType,
        quantity: availableQuantity,
        saleMode,
        costPerUnit,
        rawMaterialCostPerPortion: saleMode === 'cost' ? rawMaterialCost / calculationYield : undefined,
        indirectCostPerPortion: saleMode === 'cost' ? indirectCost / calculationYield : undefined,
        suggestedPrice: saleMode === 'cost' ? suggestedPrice : undefined,
        estimatedGainPerPortion: saleMode === 'cost' ? amount - totalCostPerPortion : undefined,
        ingredients: saleMode === 'cost' ? completeRecipe.map(item => item.name) : [],
        image: productPhoto || undefined,
        sellerAlias: profile?.seller_alias,
        sellerHolder: profile?.seller_holder,
        sellerLocation: profile?.seller_location,
        sellerDirections: profile?.seller_directions,
        recipeId,
        sellerId: profile?.id,
        sellerName: profile?.full_name || name.trim(),
        sellerPhone: profile?.phone,
        available: availableQuantity !== 0,
      },
    ]);
    setName('');
    setDescription('');
    setPrice('');
    setQuantity('');
    setYieldQuantity('');
    setAdditionalCosts('0');
    setIngredientCosts(productTypes.find(item => item.name === productType)?.ingredients.map(ingredientDraft) ?? []);
    setCustomIngredient('');
    setCustomProductType('');
    setProductPhoto('');
    if (photoInput.current) photoInput.current.value = '';
    if (cameraInput.current) cameraInput.current.value = '';
    setFormError('');
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

  function updatePrice(id: number) {
    const product = products.find(item => item.id === id);
    if (!product) return;

    const answer = prompt('¿A cuánto lo querés vender?', String(product.price));
    if (answer === null) return;

    const amount = Number(answer);
    if (!Number.isFinite(amount) || amount <= 0) {
      alert('Ingresá un precio válido.');
      return;
    }

    setProducts(current =>
      current.map(item =>
        item.id === id
          ? {
              ...item,
              price: amount,
              estimatedGainPerPortion: item.costPerUnit === undefined ? undefined : amount - item.costPerUnit,
            }
          : item
      )
    );
  }

  function updateStatus(id: string | number, status: Order['status']) {
    setOrders(current =>
      current.map(order =>
        order.id === id ? { ...order, status } : order
      )
    );
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
            <form
              onSubmit={addProduct}
              className="bg-white rounded-2xl p-6 shadow-sm border border-green-100"
            >
              <h2 className="text-xl font-black mb-2">¿Qué vas a vender?</h2>
              <p className="mb-5 text-sm text-gray-600">Elegí una categoría, completá los datos y publicá tu producto en el catálogo de este panel.</p>

              <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm font-semibold">
                  Tipo de producto
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
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
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
                  maxLength={240}
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

                <label className="text-sm font-semibold">
                  Cantidad disponible (opcional)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={quantity}
                    onChange={event => setQuantity(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal"
                    placeholder="Dejalo vacío si no querés llevar el conteo"
                  />
                </label>
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
                  className="bg-[#F6A623] text-[#8B3F14] font-black rounded-xl p-3"
                >
                  + Guardar producto
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
                      {product.image && <img src={product.image} alt={product.name} className="mb-3 h-32 w-48 rounded-lg object-cover" />}
                      <p className="font-bold">{product.name}</p>
                      {product.description && <p className="text-sm text-gray-600">{product.description}</p>}
                      <p className="text-sm text-gray-500">{product.category ?? 'Producto'}{product.quantity !== undefined ? ` · Cantidad disponible: ${product.quantity}` : ''}</p>
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
                        className="px-4 py-2 bg-[#FFF3E5] rounded-lg font-semibold"
                      >
                        {product.available ? 'Pausar publicación' : 'Publicar'}
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
        ) : tab === 'pedidos' ? (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-green-100">
            <h2 className="text-xl font-black mb-2">Gestión de pedidos</h2>
            <p className="text-gray-500 mb-6">
              Aceptá o rechazá pedidos y actualizá el estado para que el cliente sepa cómo va.
            </p>
            {orderStorageError && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm font-semibold text-red-800">{orderStorageError}</p>}

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

                    {order.status === 'Pendiente' && (
                      <div className="mb-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateStatus(order.id, 'Aceptado')}
                          className="rounded-lg bg-green-700 px-4 py-2 font-bold text-white"
                        >
                          Aceptar pedido
                        </button>
                        <button
                          type="button"
                          onClick={() => updateStatus(order.id, 'Rechazado')}
                          className="rounded-lg border border-red-300 px-4 py-2 font-bold text-red-700"
                        >
                          Rechazar pedido
                        </button>
                      </div>
                    )}
                    <select
                      id={`status-${order.id}`}
                      value={order.status}
                      onChange={event =>
                        updateStatus(
                          order.id,
                          event.target.value as Order['status'],
                        )
                      }
                      className="border border-gray-300 rounded-xl p-3 bg-white"
                    >
                      {orderStatuses.map(status => <option key={status} value={status}>{status === 'Aceptado' ? 'Recibido y aceptado' : status === 'Preparando' ? 'En preparación' : status === 'Listo para la entrega' ? 'Listo para la entrega' : status}</option>)}
                    </select>
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
          MORFI Demo · Datos guardados en este navegador.
          No representa ventas ni pedidos reales.
        </p>
      </div>
    </main>
  );
}
