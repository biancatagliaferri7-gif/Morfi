import { useEffect, useState } from 'react';
import {
  areUnitsCompatible,
  getIngredientUnitCost,
  getRecipeCosts,
  isIngredient,
  isProductionBatch,
  isRecipe,
  isValidRecipeIngredient,
  UNIT_OPTIONS,
  toBaseQuantity,
} from '../business/calculations';
import type {
  Ingredient,
  IngredientUnit,
  ProductionBatch,
  Recipe,
  RecipeIngredient,
  RecipeYieldUnit,
} from '../business/types';

export type BusinessSection = 'ingredientes' | 'recetas' | 'produccion';

type Props = {
  ownerId: string;
  section: BusinessSection;
  onNavigate: (section: BusinessSection) => void;
};

const STORAGE_KEYS = {
  ingredients: 'morfi_business_ingredients_v1',
  recipes: 'morfi_business_recipes_v1',
  production: 'morfi_business_production_v1',
};

const money = (value: number) =>
  value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 2,
  });

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readList<T>(
  key: string,
  validate: (value: unknown) => value is T,
): { value: T[]; error: string | null } {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return { value: [], error: null };
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed) || !parsed.every(validate)) {
      return {
        value: [],
        error: 'Los datos guardados tienen un formato inválido; no se reemplazaron.',
      };
    }
    return { value: parsed, error: null };
  } catch {
    return {
      value: [],
      error: 'No se pudieron leer los datos guardados; no se reemplazaron.',
    };
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}

type ReportPeriod = 'day' | 'week' | 'month' | 'year';

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function reportBucket(date: Date, period: ReportPeriod) {
  if (period === 'day') return localDateKey(date);
  if (period === 'month') return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  if (period === 'year') return String(date.getFullYear());
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return localDateKey(monday);
}

function makeReportBuckets(period: ReportPeriod) {
  const count = period === 'day' ? 7 : period === 'week' ? 8 : period === 'month' ? 12 : 5;
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (period === 'day') date.setDate(date.getDate() - (count - index - 1));
    if (period === 'week') date.setDate(date.getDate() - (count - index - 1) * 7);
    if (period === 'month') date.setMonth(date.getMonth() - (count - index - 1), 1);
    if (period === 'year') date.setFullYear(date.getFullYear() - (count - index - 1), 0, 1);
    const key = reportBucket(date, period);
    const label = period === 'day'
      ? date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
      : period === 'week'
        ? date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })
        : period === 'month'
          ? date.toLocaleDateString('es-AR', { month: 'short' })
          : String(date.getFullYear());
    return { key, label };
  });
}

function localSaleDate() {
  return localDateKey(new Date());
}

export default function BusinessWorkflow({ ownerId, section, onNavigate }: Props) {
  const scopedKeys = {
    ingredients: `${STORAGE_KEYS.ingredients}_${ownerId}`,
    recipes: `${STORAGE_KEYS.recipes}_${ownerId}`,
    production: `${STORAGE_KEYS.production}_${ownerId}`,
  };
  const [initialData] = useState(() => ({
    ingredients: readList(scopedKeys.ingredients, isIngredient),
    recipes: readList(scopedKeys.recipes, isRecipe),
    production: readList(scopedKeys.production, isProductionBatch),
  }));
  const [ingredients, setIngredients] = useState(initialData.ingredients.value);
  const [recipes, setRecipes] = useState(initialData.recipes.value);
  const [production, setProduction] = useState(initialData.production.value);
  const [storageErrors, setStorageErrors] = useState<Record<string, string>>(() => {
    const errors: Record<string, string> = {};
    if (initialData.ingredients.error) errors.ingredients = initialData.ingredients.error;
    if (initialData.recipes.error) errors.recipes = initialData.recipes.error;
    if (initialData.production.error) errors.production = initialData.production.error;
    return errors;
  });
  const [ingredientsDirty, setIngredientsDirty] = useState(false);
  const [recipesDirty, setRecipesDirty] = useState(false);
  const [productionDirty, setProductionDirty] = useState(false);

  useEffect(() => {
    if (!ingredientsDirty) return;
    try {
      localStorage.setItem(scopedKeys.ingredients, JSON.stringify(ingredients));
      setStorageErrors(current => ({ ...current, ingredients: '' }));
    } catch (error) {
      setStorageErrors(current => ({
        ...current,
        ingredients: `No se pudieron guardar los ingredientes: ${errorMessage(error)}`,
      }));
    }
  }, [ingredients, ingredientsDirty, ownerId]);

  useEffect(() => {
    if (!recipesDirty) return;
    try {
      localStorage.setItem(scopedKeys.recipes, JSON.stringify(recipes));
      setStorageErrors(current => ({ ...current, recipes: '' }));
    } catch (error) {
      setStorageErrors(current => ({
        ...current,
        recipes: `No se pudieron guardar las recetas: ${errorMessage(error)}`,
      }));
    }
  }, [recipes, recipesDirty, ownerId]);

  useEffect(() => {
    if (!productionDirty) return;
    try {
      localStorage.setItem(scopedKeys.production, JSON.stringify(production));
      setStorageErrors(current => ({ ...current, production: '' }));
    } catch (error) {
      setStorageErrors(current => ({
        ...current,
        production: `No se pudo guardar el historial de producción: ${errorMessage(error)}`,
      }));
    }
  }, [production, productionDirty, ownerId]);

  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900">
        Estos datos se guardan en este navegador y todavía no se sincronizan con Supabase ni con otros dispositivos.
      </p>
      {Object.values(storageErrors).filter(Boolean).map(message => (
        <p key={message} role="alert" className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-800">
          {message}
        </p>
      ))}
      {section === 'ingredientes' && (
        <IngredientsPanel
          ingredients={ingredients}
          recipes={recipes}
          onChange={next => {
            setIngredients(next);
            setIngredientsDirty(true);
          }}
        />
      )}
      {section === 'recetas' && (
        <RecipesPanel
          ingredients={ingredients}
          recipes={recipes}
          production={production}
          onChange={next => {
            setRecipes(next);
            setRecipesDirty(true);
          }}
          onNavigate={onNavigate}
        />
      )}
      {section === 'produccion' && (
        <ProductionPanel
          ingredients={ingredients}
          recipes={recipes}
          production={production}
          onProductionChange={next => {
            setProduction(next);
            setProductionDirty(true);
          }}
          onNavigate={onNavigate}
        />
      )}
    </div>
  );
}

type IngredientsPanelProps = {
  ingredients: Ingredient[];
  recipes: Recipe[];
  onChange: (ingredients: Ingredient[]) => void;
};

function IngredientsPanel({ ingredients, recipes, onChange }: IngredientsPanelProps) {
  const [name, setName] = useState('');
  const [purchaseQuantity, setPurchaseQuantity] = useState('');
  const [purchaseUnit, setPurchaseUnit] = useState<IngredientUnit>('kg');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');

  function resetForm() {
    setName('');
    setPurchaseQuantity('');
    setPurchaseUnit('kg');
    setPurchasePrice('');
    setEditingId(null);
    setFormError('');
  }

  function editIngredient(ingredient: Ingredient) {
    setEditingId(ingredient.id);
    setName(ingredient.name);
    setPurchaseQuantity(String(ingredient.purchaseQuantity));
    setPurchaseUnit(ingredient.purchaseUnit);
    setPurchasePrice(String(ingredient.purchasePrice));
    setFormError('');
  }

  function saveIngredient(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const purchaseAmount = Number(purchaseQuantity);
    const price = Number(purchasePrice);
    if (
      !name.trim() ||
      !Number.isFinite(purchaseAmount) ||
      purchaseAmount <= 0 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      setFormError('Revisá el nombre, las cantidades y el precio ingresado.');
      return;
    }
    if (
      editingId &&
      recipes.some(recipe =>
        recipe.ingredients.some(line =>
          line.ingredientId === editingId &&
          !areUnitsCompatible(purchaseUnit, line.unit),
        ),
      )
    ) {
      setFormError('La nueva unidad de compra no coincide con una receta existente. Editá primero esa receta o conservá una unidad compatible.');
      return;
    }
    if (
      editingId &&
      recipes.some(recipe =>
        recipe.ingredients.some(line =>
          line.ingredientId === editingId &&
          !areUnitsCompatible(purchaseUnit, line.unit),
        ),
      )
    ) {
      setFormError('La nueva unidad no coincide con una receta existente. Editá primero esa receta o conservá una unidad compatible.');
      return;
    }

    const updated: Ingredient = {
      id: editingId ?? createId(),
      name: name.trim(),
      purchaseQuantity: purchaseAmount,
      purchaseUnit,
      purchasePrice: price,
      stockQuantity: ingredients.find(item => item.id === editingId)?.stockQuantity ?? purchaseAmount,
      stockUnit: purchaseUnit,
    };
    onChange(
      editingId
        ? ingredients.map(item => (item.id === editingId ? updated : item))
        : [...ingredients, updated],
    );
    resetForm();
  }

  function deleteIngredient(ingredient: Ingredient) {
    if (recipes.some(recipe => recipe.ingredients.some(line => line.ingredientId === ingredient.id))) {
      setFormError('No podés eliminar un ingrediente que usa una receta. Editá primero esa receta.');
      return;
    }
    if (!window.confirm(`¿Eliminar ${ingredient.name}?`)) {
      return;
    }
    onChange(ingredients.filter(item => item.id !== ingredient.id));
  }

  return (
    <>
      <section className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-2xl font-black">Ingredientes</h2>
        <p className="mt-1 text-gray-600">
          Anotá la presentación que comprás y su precio. MORFI calcula el costo por gramo, mililitro o unidad.
        </p>
        <form onSubmit={saveIngredient} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-semibold">
            Nombre
            <input
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Ej.: harina"
              className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal"
              required
            />
          </label>
          <label className="text-sm font-semibold">
            Presentación que comprás
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                min="0.001"
                step="any"
                value={purchaseQuantity}
                onChange={event => setPurchaseQuantity(event.target.value)}
                placeholder="1"
                className="w-full min-w-0 rounded-xl border border-gray-300 p-3 text-base font-normal"
                required
              />
              <UnitSelect value={purchaseUnit} onChange={setPurchaseUnit} />
            </div>
          </label>
          <label className="text-sm font-semibold">
            Precio del paquete
            <input
              type="number"
              min="0"
              step="0.01"
              value={purchasePrice}
              onChange={event => setPurchasePrice(event.target.value)}
              placeholder="Ej.: 1800"
              className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal"
              required
            />
          </label>
          {formError && <p role="alert" className="text-sm font-semibold text-red-700 md:col-span-2 xl:col-span-4">{formError}</p>}
          <div className="flex flex-wrap gap-3 md:col-span-2 xl:col-span-4">
            <button type="submit" className="min-h-12 rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white hover:bg-[#B84E0E]">
              {editingId ? 'Guardar cambios' : 'Agregar ingrediente'}
            </button>
            {editingId && (
              <button type="button" onClick={resetForm} className="min-h-12 rounded-xl border px-5 py-3 font-semibold">
                Cancelar edición
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm md:p-6">
        <h3 className="text-xl font-black">Lo que tenés guardado</h3>
        {ingredients.length === 0 ? (
          <p className="mt-3 rounded-xl bg-[#FFF3E5] p-4 text-gray-700">
            Todavía no cargaste ingredientes. Empezá por la harina, la carne o los ingredientes que más usás.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {ingredients.map(ingredient => {
              const unitCost = getIngredientUnitCost(ingredient);
              const baseUnit = ingredient.purchaseUnit === 'kg' ? 'g' : ingredient.purchaseUnit === 'l' ? 'ml' : ingredient.purchaseUnit;
              return (
                <article key={ingredient.id} className="flex flex-col gap-3 rounded-xl border border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-bold">{ingredient.name}</h4>
                    <p className="text-sm text-gray-600">
                      Costo estimado: {unitCost === null ? 'No disponible' : `${money(unitCost)} por ${baseUnit}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => editIngredient(ingredient)} className="min-h-10 rounded-lg border px-4 py-2 font-semibold">
                      Editar
                    </button>
                    <button type="button" onClick={() => deleteIngredient(ingredient)} className="min-h-10 rounded-lg border border-red-200 px-4 py-2 font-semibold text-red-700">
                      Eliminar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function UnitSelect({
  value,
  onChange,
  compatibleWith,
}: {
  value: IngredientUnit;
  onChange: (unit: IngredientUnit) => void;
  compatibleWith?: IngredientUnit;
}) {
  const options = compatibleWith
    ? UNIT_OPTIONS.filter(option => areUnitsCompatible(option.value, compatibleWith))
    : UNIT_OPTIONS;
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value as IngredientUnit)}
      className="min-w-24 rounded-xl border border-gray-300 bg-white px-2 py-3 text-sm font-normal"
    >
      {options.map(option => <option key={option.value} value={option.value}>{option.value}</option>)}
    </select>
  );
}

type RecipesPanelProps = {
  ingredients: Ingredient[];
  recipes: Recipe[];
  production: ProductionBatch[];
  onChange: (recipes: Recipe[]) => void;
  onNavigate: (section: BusinessSection) => void;
};

type RecipeIngredientDraft = Omit<RecipeIngredient, 'quantity'> & {
  quantity: string;
};

function RecipesPanel({ ingredients, recipes, production, onChange, onNavigate }: RecipesPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [yieldQuantity, setYieldQuantity] = useState('12');
  const [yieldUnit, setYieldUnit] = useState<RecipeYieldUnit>('unidades');
  const [additionalCosts, setAdditionalCosts] = useState('0');
  const [sellingPrice, setSellingPrice] = useState('');
  const [lines, setLines] = useState<RecipeIngredientDraft[]>([{ ingredientId: '', quantity: '1', unit: 'g' }]);
  const [formError, setFormError] = useState('');

  function resetForm() {
    setEditingId(null);
    setName('');
    setYieldQuantity('12');
    setYieldUnit('unidades');
    setAdditionalCosts('0');
    setSellingPrice('');
    setLines([{ ingredientId: '', quantity: '1', unit: ingredients[0]?.stockUnit ?? 'g' }]);
    setFormError('');
  }

  function editRecipe(recipe: Recipe) {
    setEditingId(recipe.id);
    setName(recipe.name);
    setYieldQuantity(String(recipe.yieldQuantity));
    setYieldUnit(recipe.yieldUnit);
    setAdditionalCosts(String(recipe.additionalCosts));
    setSellingPrice(recipe.sellingPrice === null ? '' : String(recipe.sellingPrice));
    setLines(recipe.ingredients.map(line => ({ ...line, quantity: String(line.quantity) })));
    setFormError('');
  }

  function updateLine(index: number, patch: Partial<RecipeIngredientDraft>) {
    setLines(current => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, ...patch };
      if (patch.ingredientId) {
        const ingredient = ingredients.find(item => item.id === patch.ingredientId);
        if (ingredient) next.unit = ingredient.stockUnit;
      }
      return next;
    }));
  }

  function saveRecipe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const yieldAmount = Number(yieldQuantity);
    const extra = Number(additionalCosts);
    const price = sellingPrice.trim() ? Number(sellingPrice) : null;
    const recipeIngredients = lines.map(line => ({
      ...line,
      quantity: Number(line.quantity),
    }));
    if (
      !name.trim() ||
      !Number.isFinite(yieldAmount) ||
      yieldAmount <= 0 ||
      (yieldUnit === 'unidades' && !Number.isInteger(yieldAmount)) ||
      !Number.isFinite(extra) ||
      extra < 0 ||
      (price !== null && (!Number.isFinite(price) || price < 0)) ||
      lines.length === 0 ||
      recipeIngredients.some(line => !isValidRecipeIngredient(line, ingredients))
    ) {
      setFormError('Completá el nombre, el rendimiento, los costos y al menos un ingrediente con cantidades válidas.');
      return;
    }

    const existing = recipes.find(recipe => recipe.id === editingId);
    const updated: Recipe = {
      id: editingId ?? createId(),
      name: name.trim(),
      yieldQuantity: yieldAmount,
      yieldUnit,
      ingredients: recipeIngredients,
      additionalCosts: extra,
      sellingPrice: price,
      finishedStock: existing?.finishedStock ?? 0,
    };
    const costs = getRecipeCosts(updated, ingredients);
    if (!costs) {
      setFormError('No se pudo calcular el costo. Verificá las unidades y los ingredientes.');
      return;
    }
    if (updated.sellingPrice === null) updated.sellingPrice = costs.perUnit * 1.3;
    onChange(
      editingId
        ? recipes.map(recipe => recipe.id === editingId ? updated : recipe)
        : [...recipes, updated],
    );
    resetForm();
  }

  function duplicateRecipe(recipe: Recipe) {
    onChange([
      ...recipes,
      {
        ...recipe,
        id: createId(),
        name: `${recipe.name} (copia)`,
        ingredients: recipe.ingredients.map(line => ({ ...line })),
        finishedStock: 0,
      },
    ]);
  }

  function deleteRecipe(recipe: Recipe) {
    const hasProduction = production.some(batch => batch.recipeId === recipe.id);
    if (hasProduction || recipe.finishedStock > 0) return;
    if (window.confirm(`¿Eliminar la receta "${recipe.name}"?`)) {
      onChange(recipes.filter(item => item.id !== recipe.id));
    }
  }

  return (
    <>
      <section className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-2xl font-black">Mis recetas</h2>
        <p className="mt-1 text-gray-600">
          Cargá una receta una vez. El costo se actualiza cuando cambian los precios de tus ingredientes.
        </p>
        {ingredients.length === 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-900">
            <p className="font-semibold">Primero necesitás cargar ingredientes.</p>
            <button type="button" onClick={() => onNavigate('ingredientes')} className="mt-2 font-bold underline">
              Ir a Ingredientes
            </button>
          </div>
        )}
        <form onSubmit={saveRecipe} className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-semibold">
              Nombre de la preparación
              <input value={name} onChange={event => setName(event.target.value)} placeholder="Ej.: empanadas de carne" className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal" required />
            </label>
            <label className="text-sm font-semibold">
              Rinde
              <input type="number" min="0.001" step={yieldUnit === 'unidades' ? '1' : 'any'} value={yieldQuantity} onChange={event => setYieldQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal" required />
            </label>
            <label className="text-sm font-semibold">
              Tipo de rendimiento
              <select value={yieldUnit} onChange={event => setYieldUnit(event.target.value as RecipeYieldUnit)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 text-base font-normal">
                <option value="unidades">unidades</option>
                <option value="porciones">porciones</option>
              </select>
            </label>
            <label className="text-sm font-semibold">
              Otros costos por receta completa
              <input type="number" min="0" step="0.01" value={additionalCosts} onChange={event => setAdditionalCosts(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal" />
            </label>
          </div>
          <label className="block max-w-sm text-sm font-semibold">
            Precio de venta por unidad (opcional)
            <input type="number" min="0" step="0.01" value={sellingPrice} onChange={event => setSellingPrice(event.target.value)} placeholder="Dejalo vacío si todavía no lo definiste" className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal" />
          </label>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Ingredientes y cantidades</h3>
              <button type="button" onClick={() => setLines(current => [...current, { ingredientId: '', quantity: '1', unit: ingredients[0]?.stockUnit ?? 'g' }])} disabled={ingredients.length === 0} className="min-h-10 rounded-lg border px-4 py-2 font-semibold disabled:opacity-50">
                + Agregar ingrediente
              </button>
            </div>
            <div className="space-y-2">
              {lines.map((line, index) => {
                const ingredient = ingredients.find(item => item.id === line.ingredientId);
                return (
                  <div key={`${index}-${line.ingredientId}`} className="grid gap-2 rounded-xl bg-[#FFF3E5] p-3 sm:grid-cols-[minmax(0,1fr)_140px_130px_auto]">
                    <select value={line.ingredientId} onChange={event => updateLine(index, { ingredientId: event.target.value })} className="min-w-0 rounded-lg border border-gray-300 bg-white p-3" aria-label={`Ingrediente ${index + 1}`}>
                      <option value="">Elegí un ingrediente</option>
                      {ingredients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                    <input type="number" min="0.001" step="any" value={line.quantity} onChange={event => updateLine(index, { quantity: event.target.value })} className="min-w-0 rounded-lg border border-gray-300 p-3" aria-label={`Cantidad de ingrediente ${index + 1}`} />
                    <UnitSelect value={line.unit} compatibleWith={ingredient?.purchaseUnit} onChange={unit => updateLine(index, { unit })} />
                    <button type="button" onClick={() => setLines(current => current.filter((_, lineIndex) => lineIndex !== index))} aria-label={`Quitar ingrediente ${index + 1}`} className="min-h-11 rounded-lg border border-red-200 px-3 font-semibold text-red-700">
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
          {formError && <p role="alert" className="text-sm font-semibold text-red-700">{formError}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={ingredients.length === 0} className="min-h-12 rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white hover:bg-[#B84E0E] disabled:opacity-50">
              {editingId ? 'Guardar cambios' : 'Guardar receta'}
            </button>
            {editingId && <button type="button" onClick={resetForm} className="min-h-12 rounded-xl border px-5 py-3 font-semibold">Cancelar edición</button>}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm md:p-6">
        <h3 className="text-xl font-black">Recetas guardadas</h3>
        {recipes.length === 0 ? (
          <p className="mt-3 rounded-xl bg-[#FFF3E5] p-4 text-gray-700">Cuando guardes una receta, acá vas a ver el costo estimado y las producciones registradas.</p>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {recipes.map(recipe => {
              const costs = getRecipeCosts(recipe, ingredients);
              const grossPerUnit = costs && recipe.sellingPrice !== null ? recipe.sellingPrice - costs.perUnit : null;
              const margin = costs && recipe.sellingPrice !== null && recipe.sellingPrice > 0
                ? ((recipe.sellingPrice - costs.perUnit) / recipe.sellingPrice) * 100
                : null;
              const hasProduction = production.some(batch => batch.recipeId === recipe.id);
              return (
                <article key={recipe.id} className="rounded-xl border border-gray-100 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h4 className="text-lg font-bold">{recipe.name}</h4>
                      <p className="text-sm text-gray-600">Rinde {recipe.yieldQuantity} {recipe.yieldUnit}</p>
                    </div>
                  </div>
                  <div className="mt-3 space-y-1 text-sm">
                    <p>Costo receta: <strong>{costs ? money(costs.total) : 'Revisá ingredientes'}</strong></p>
                    <p>Costo por {recipe.yieldUnit === 'porciones' ? 'porción' : 'unidad'}: <strong>{costs ? money(costs.perUnit) : 'No disponible'}</strong></p>
                    {recipe.sellingPrice !== null && (
                      <>
                        <p>Ganancia bruta estimada por unidad: <strong>{grossPerUnit === null ? 'No disponible' : money(grossPerUnit)}</strong></p>
                        <p>Margen estimado sobre el precio: <strong>{margin === null ? 'No disponible' : `${margin.toFixed(1)}%`}</strong></p>
                      </>
                    )}
                  </div>
                  <p className="mt-3 text-xs text-gray-500">Estimación bruta según costos cargados; no incluye necesariamente todos los gastos ni garantiza ganancia neta.</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={() => editRecipe(recipe)} className="min-h-10 rounded-lg border px-4 py-2 font-semibold">Editar</button>
                    <button type="button" onClick={() => duplicateRecipe(recipe)} className="min-h-10 rounded-lg border px-4 py-2 font-semibold">Duplicar</button>
                    <button type="button" disabled={hasProduction || recipe.finishedStock > 0} onClick={() => deleteRecipe(recipe)} title={hasProduction || recipe.finishedStock > 0 ? 'No se puede borrar una receta con producción o unidades todavía disponibles.' : undefined} className="min-h-10 rounded-lg border border-red-200 px-4 py-2 font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40">Eliminar</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

type ProductionPanelProps = {
  ingredients: Ingredient[];
  recipes: Recipe[];
  production: ProductionBatch[];
  onProductionChange: (batches: ProductionBatch[]) => void;
  onNavigate: (section: BusinessSection) => void;
};

function ProductionPanel({
  ingredients,
  recipes,
  production,
  onProductionChange,
  onNavigate,
}: ProductionPanelProps) {
  const [recipeId, setRecipeId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [saleDate, setSaleDate] = useState(localSaleDate);
  const [reportPeriod, setReportPeriod] = useState<ReportPeriod>('day');
  const [formError, setFormError] = useState('');
  const recipe = recipes.find(item => item.id === recipeId);
  const amount = Number(quantity);
  const costs = recipe ? getRecipeCosts(recipe, ingredients) : null;
  const salePrice = recipe?.sellingPrice ?? null;
  const estimatedCost = costs && amount > 0 ? costs.perUnit * amount : null;
  const estimatedRevenue = salePrice !== null && amount > 0 ? salePrice * amount : null;
  const estimatedProfit = estimatedRevenue !== null && estimatedCost !== null ? estimatedRevenue - estimatedCost : null;
  const ingredientDetails = recipe && amount > 0
    ? recipe.ingredients.map(line => {
        const ingredient = ingredients.find(item => item.id === line.ingredientId);
        const unitCost = ingredient ? getIngredientUnitCost(ingredient) : null;
        const usedQuantity = line.quantity * amount / recipe.yieldQuantity;
        return {
          name: ingredient?.name ?? 'Ingrediente no disponible',
          quantity: usedQuantity,
          unit: line.unit,
          totalCost: unitCost === null ? 0 : unitCost * toBaseQuantity(usedQuantity, line.unit),
        };
      })
    : [];
  const reportBuckets = makeReportBuckets(reportPeriod).map(bucket => {
    const bucketSales = production.filter(batch => {
      const date = new Date(batch.createdAt);
      return !Number.isNaN(date.getTime()) && reportBucket(date, reportPeriod) === bucket.key;
    });
    return {
      ...bucket,
      income: bucketSales.reduce((sum, batch) => sum + (batch.totalRevenue ?? 0), 0),
      profit: bucketSales.reduce((sum, batch) => sum + (batch.totalProfit ?? ((batch.totalRevenue ?? 0) - batch.totalCost)), 0),
    };
  });
  const maxReportProfit = Math.max(1, ...reportBuckets.map(bucket => bucket.profit));
  const reportIncome = reportBuckets.reduce((sum, bucket) => sum + bucket.income, 0);
  const reportProfit = reportBuckets.reduce((sum, bucket) => sum + bucket.profit, 0);

  function produce(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const saleTimestamp = new Date(`${saleDate}T12:00:00`);
    if (
      !recipe ||
      !costs ||
      salePrice === null ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Number.isNaN(saleTimestamp.getTime()) ||
      (recipe.yieldUnit === 'unidades' && !Number.isInteger(amount))
    ) {
      setFormError('Elegí una receta guardada, una fecha y una cantidad vendida válida.');
      return;
    }

    const batch: ProductionBatch = {
      id: createId(),
      recipeId: recipe.id,
      recipeName: recipe.name,
      quantity: amount,
      yieldUnit: recipe.yieldUnit,
      totalCost: estimatedCost ?? 0,
      costPerUnit: costs.perUnit,
      totalRevenue: estimatedRevenue ?? 0,
      totalProfit: estimatedProfit ?? 0,
      indirectCost: recipe.additionalCosts * amount / recipe.yieldQuantity,
      ingredientCosts: ingredientDetails,
      createdAt: saleTimestamp.toISOString(),
    };
    onProductionChange([batch, ...production]);
    setQuantity('');
    setFormError('');
  }

  return (
    <>
      <section className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm md:p-6">
        <h2 className="text-2xl font-black">Producción</h2>
        <p className="mt-1 text-gray-600">
          Elegí una receta guardada e ingresá lo vendido. El costo y la ganancia se calculan con los costos y el precio de venta de esa receta.
        </p>
        {recipes.length === 0 ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-900">
            <p className="font-semibold">Primero necesitás guardar una receta.</p>
            <button type="button" onClick={() => onNavigate(ingredients.length ? 'recetas' : 'ingredientes')} className="mt-2 font-bold underline">
              {ingredients.length ? 'Ir a Mis recetas' : 'Ir a Ingredientes'}
            </button>
          </div>
        ) : (
          <form onSubmit={produce} className="mt-5 max-w-3xl space-y-4">
            <label className="block text-sm font-semibold">
              ¿Qué vas a preparar?
              <select value={recipeId} onChange={event => { setRecipeId(event.target.value); setFormError(''); }} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 text-base font-normal" required>
                <option value="">Elegí una receta</option>
                {recipes.map(item => <option key={item.id} value={item.id}>{item.name} (rinde {item.yieldQuantity} {item.yieldUnit})</option>)}
              </select>
            </label>
            <label className="block max-w-sm text-sm font-semibold">
              Cantidad vendida ({recipe?.yieldUnit ?? 'unidades'})
              <input type="number" min="0.001" step={recipe?.yieldUnit === 'unidades' ? '1' : 'any'} value={quantity} onChange={event => setQuantity(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal" required />
            </label>
            <label className="block max-w-sm text-sm font-semibold">
              Día de la venta
              <input type="date" value={saleDate} onChange={event => setSaleDate(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 p-3 text-base font-normal" required />
            </label>
            {recipe && costs && amount > 0 && (
              <div className="rounded-xl bg-[#FFF3E5] p-4">
                <h3 className="font-bold">Resumen automático de la venta</h3>
                <p className="mt-1">Fecha de venta: <strong>{saleDate}</strong></p>
                <p className="mt-1">Cantidad vendida: <strong>{amount}</strong></p>
                <p className="mt-1">Costo total: <strong>{estimatedCost === null ? 'No disponible' : money(estimatedCost)}</strong></p>
                <ul className="mt-2 space-y-1 text-sm">
                  {ingredientDetails.map((line, index) => (
                    <li key={`${line.name}-${index}`} className="flex flex-wrap justify-between gap-2">
                      <span>{line.name}: {line.quantity.toLocaleString('es-AR', { maximumFractionDigits: 3 })} {line.unit}</span>
                      <strong>{money(line.totalCost)}</strong>
                    </li>
                  ))}
                  {recipe.additionalCosts > 0 && (
                    <li className="flex justify-between gap-2"><span>Costos indirectos</span><strong>{money(recipe.additionalCosts * amount / recipe.yieldQuantity)}</strong></li>
                  )}
                </ul>
                <p className="mt-1">Ingreso total: <strong>{estimatedRevenue === null ? 'No disponible' : money(estimatedRevenue)}</strong></p>
                <p className="mt-1">Ganancia total calculada: <strong>{estimatedProfit === null ? 'No disponible' : money(estimatedProfit)}</strong></p>
                <p className="mt-1 text-sm text-gray-600">Se guarda la fecha elegida y el costo vigente de los ingredientes cargados.</p>
              </div>
            )}
            {formError && <p role="alert" className="text-sm font-semibold text-red-700">{formError}</p>}
            <button type="submit" disabled={!recipe || !costs || salePrice === null} className="min-h-12 rounded-xl bg-[#8B3F14] px-5 py-3 font-bold text-white hover:bg-[#B84E0E] disabled:cursor-not-allowed disabled:opacity-50">
              Registrar venta
            </button>
          </form>
        )}
      </section>

      <section className="rounded-2xl border border-green-100 bg-white p-5 shadow-sm md:p-6">
        <h3 className="text-xl font-black">Ventas registradas</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Ver resultados por
            <select value={reportPeriod} onChange={event => setReportPeriod(event.target.value as ReportPeriod)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white p-3 font-normal">
              <option value="day">Día (últimos 7 días)</option>
              <option value="week">Semana (últimas 8 semanas)</option>
              <option value="month">Mes (últimos 12 meses)</option>
              <option value="year">Año (últimos 5 años)</option>
            </select>
          </label>
          <div className="rounded-xl bg-[#FFF3E5] p-3 text-sm">
            <p>Ingresos del período: <strong>{money(reportIncome)}</strong></p>
            <p>Ganancia calculada del período: <strong>{money(reportProfit)}</strong></p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {reportBuckets.map(bucket => (
            <div key={bucket.key} className="rounded-xl border border-gray-100 p-3 text-center">
              <p className="text-xs font-semibold">{bucket.label}</p>
              <div className="mt-2 flex h-24 items-end justify-center rounded bg-[#FFF9F2]">
                <div
                  className={`w-8 rounded-t ${bucket.profit < 0 ? 'bg-red-500' : 'bg-[#F07821]'}`}
                  style={{ height: `${Math.max(4, Math.min(100, Math.abs(bucket.profit) / maxReportProfit * 100))}%` }}
                  title={`Ganancia: ${money(bucket.profit)}`}
                />
              </div>
              <p className="mt-2 text-xs font-bold">{money(bucket.profit)}</p>
              <p className="text-[10px] text-gray-500">Ingreso {money(bucket.income)}</p>
            </div>
          ))}
        </div>
        {production.length === 0 ? (
          <p className="mt-2 text-gray-600">Todavía no registraste producciones.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {production.slice(0, 20).map(batch => (
              <article key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 p-4">
                <div>
                  <p className="font-bold">{batch.recipeName} · {batch.quantity} {batch.yieldUnit} vendidos</p>
                  <p className="text-sm text-gray-600">{new Date(batch.createdAt).toLocaleDateString('es-AR')}</p>
                  {batch.ingredientCosts && <ul className="mt-2 text-xs text-gray-600">
                    {batch.ingredientCosts.map((line, index) => <li key={`${line.name}-${index}`}>{line.name}: {line.quantity.toLocaleString('es-AR', { maximumFractionDigits: 3 })} {line.unit} · {money(line.totalCost)}</li>)}
                    {(batch.indirectCost ?? 0) > 0 && <li>Costos indirectos: {money(batch.indirectCost ?? 0)}</li>}
                  </ul>}
                </div>
                <div className="text-right text-sm">
                  <p>Costo registrado: <strong>{money(batch.totalCost)}</strong></p>
                  <p>Ingreso: {money(batch.totalRevenue ?? 0)}</p>
                  <p>Ganancia: <strong>{money(batch.totalProfit ?? ((batch.totalRevenue ?? 0) - batch.totalCost))}</strong></p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
