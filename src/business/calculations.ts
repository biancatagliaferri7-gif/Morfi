import type {
  Ingredient,
  IngredientUnit,
  ProductionBatch,
  Recipe,
  RecipeIngredient,
} from './types';

export const UNIT_OPTIONS: { value: IngredientUnit; label: string }[] = [
  { value: 'g', label: 'gramos (g)' },
  { value: 'kg', label: 'kilogramos (kg)' },
  { value: 'ml', label: 'mililitros (ml)' },
  { value: 'l', label: 'litros (l)' },
  { value: 'unidad', label: 'unidades' },
];

type UnitDimension = 'mass' | 'volume' | 'count';

const UNIT_DIMENSIONS: Record<IngredientUnit, UnitDimension> = {
  g: 'mass',
  kg: 'mass',
  ml: 'volume',
  l: 'volume',
  unidad: 'count',
};

const UNIT_BASE_FACTORS: Record<IngredientUnit, number> = {
  g: 1,
  kg: 1000,
  ml: 1,
  l: 1000,
  unidad: 1,
};

export function areUnitsCompatible(
  first: IngredientUnit,
  second: IngredientUnit,
): boolean {
  return UNIT_DIMENSIONS[first] === UNIT_DIMENSIONS[second];
}

export function toBaseQuantity(
  quantity: number,
  unit: IngredientUnit,
): number {
  return quantity * UNIT_BASE_FACTORS[unit];
}

export function getIngredientUnitCost(
  ingredient: Ingredient,
): number | null {
  const packageQuantity = toBaseQuantity(
    ingredient.purchaseQuantity,
    ingredient.purchaseUnit,
  );
  if (
    !Number.isFinite(packageQuantity) ||
    packageQuantity <= 0 ||
    !Number.isFinite(ingredient.purchasePrice) ||
    ingredient.purchasePrice < 0
  ) {
    return null;
  }
  return ingredient.purchasePrice / packageQuantity;
}

export function getRecipeCosts(
  recipe: Recipe,
  ingredients: Ingredient[],
): { total: number; perUnit: number } | null {
  if (
    !Number.isFinite(recipe.yieldQuantity) ||
    recipe.yieldQuantity <= 0 ||
    recipe.ingredients.length === 0 ||
    !Number.isFinite(recipe.additionalCosts) ||
    recipe.additionalCosts < 0
  ) {
    return null;
  }

  let total = recipe.additionalCosts;
  for (const line of recipe.ingredients) {
    const ingredient = ingredients.find(item => item.id === line.ingredientId);
    const unitCost = ingredient ? getIngredientUnitCost(ingredient) : null;
    if (
      !ingredient ||
      unitCost === null ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !areUnitsCompatible(ingredient.purchaseUnit, line.unit)
    ) {
      return null;
    }
    total += toBaseQuantity(line.quantity, line.unit) * unitCost;
  }

  if (!Number.isFinite(total)) return null;
  return { total, perUnit: total / recipe.yieldQuantity };
}

export function getProductionRequirements(
  recipe: Recipe,
  quantity: number,
  ingredients: Ingredient[],
): Map<string, number> | null {
  if (
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    !Number.isFinite(recipe.yieldQuantity) ||
    recipe.yieldQuantity <= 0
  ) {
    return null;
  }

  const requirements = new Map<string, number>();
  for (const line of recipe.ingredients) {
    const ingredient = ingredients.find(item => item.id === line.ingredientId);
    if (
      !ingredient ||
      !Number.isFinite(line.quantity) ||
      line.quantity <= 0 ||
      !areUnitsCompatible(ingredient.stockUnit, line.unit)
    ) {
      return null;
    }

    const amountInStockUnits =
      toBaseQuantity(line.quantity, line.unit) /
      UNIT_BASE_FACTORS[ingredient.stockUnit];
    requirements.set(
      ingredient.id,
      (requirements.get(ingredient.id) ?? 0) +
        (amountInStockUnits * quantity) / recipe.yieldQuantity,
    );
  }
  return requirements;
}

export function isValidRecipeIngredient(
  line: RecipeIngredient,
  ingredients: Ingredient[],
): boolean {
  const ingredient = ingredients.find(item => item.id === line.ingredientId);
  return Boolean(
    ingredient &&
      Number.isFinite(line.quantity) &&
      line.quantity > 0 &&
      areUnitsCompatible(ingredient.purchaseUnit, line.unit),
  );
}

export function isIngredient(value: unknown): value is Ingredient {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    typeof item.purchaseQuantity === 'number' &&
    Number.isFinite(item.purchaseQuantity) &&
    item.purchaseQuantity > 0 &&
    isIngredientUnit(item.purchaseUnit) &&
    typeof item.purchasePrice === 'number' &&
    Number.isFinite(item.purchasePrice) &&
    item.purchasePrice >= 0 &&
    typeof item.stockQuantity === 'number' &&
    Number.isFinite(item.stockQuantity) &&
    item.stockQuantity >= 0 &&
    isIngredientUnit(item.stockUnit) &&
    areUnitsCompatible(item.purchaseUnit, item.stockUnit)
  );
}

export function isRecipe(value: unknown): value is Recipe {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    typeof item.yieldQuantity === 'number' &&
    Number.isFinite(item.yieldQuantity) &&
    item.yieldQuantity > 0 &&
    (item.yieldUnit === 'unidades' || item.yieldUnit === 'porciones') &&
    (item.yieldUnit !== 'unidades' || Number.isInteger(item.yieldQuantity)) &&
    Array.isArray(item.ingredients) &&
    item.ingredients.every(isRecipeLine) &&
    typeof item.additionalCosts === 'number' &&
    Number.isFinite(item.additionalCosts) &&
    item.additionalCosts >= 0 &&
    (item.sellingPrice === null ||
      (typeof item.sellingPrice === 'number' &&
        Number.isFinite(item.sellingPrice) &&
        item.sellingPrice >= 0)) &&
    typeof item.finishedStock === 'number' &&
    Number.isFinite(item.finishedStock) &&
    item.finishedStock >= 0
  );
}

export function isProductionBatch(value: unknown): value is ProductionBatch {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.recipeId === 'string' &&
    typeof item.recipeName === 'string' &&
    typeof item.quantity === 'number' &&
    Number.isFinite(item.quantity) &&
    item.quantity > 0 &&
    (item.yieldUnit !== 'unidades' || Number.isInteger(item.quantity)) &&
    (item.yieldUnit === 'unidades' || item.yieldUnit === 'porciones') &&
    typeof item.totalCost === 'number' &&
    Number.isFinite(item.totalCost) &&
    item.totalCost >= 0 &&
    typeof item.costPerUnit === 'number' &&
    Number.isFinite(item.costPerUnit) &&
    item.costPerUnit >= 0 &&
    (item.totalRevenue === undefined ||
      (typeof item.totalRevenue === 'number' &&
        Number.isFinite(item.totalRevenue) &&
        item.totalRevenue >= 0)) &&
    (item.totalProfit === undefined ||
      (typeof item.totalProfit === 'number' &&
        Number.isFinite(item.totalProfit))) &&
    (item.indirectCost === undefined ||
      (typeof item.indirectCost === 'number' &&
        Number.isFinite(item.indirectCost) &&
        item.indirectCost >= 0)) &&
    (item.ingredientCosts === undefined ||
      (Array.isArray(item.ingredientCosts) &&
        item.ingredientCosts.every(line =>
          Boolean(line) &&
          typeof line.name === 'string' &&
          typeof line.quantity === 'number' &&
          Number.isFinite(line.quantity) &&
          line.quantity > 0 &&
          isIngredientUnit(line.unit) &&
          typeof line.totalCost === 'number' &&
          Number.isFinite(line.totalCost) &&
          line.totalCost >= 0
        ))) &&
    typeof item.createdAt === 'string'
  );
}

function isRecipeLine(value: unknown): value is RecipeIngredient {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.ingredientId === 'string' &&
    typeof line.quantity === 'number' &&
    Number.isFinite(line.quantity) &&
    line.quantity > 0 &&
    isIngredientUnit(line.unit)
  );
}

function isIngredientUnit(value: unknown): value is IngredientUnit {
  return value === 'g' || value === 'kg' || value === 'ml' || value === 'l' || value === 'unidad';
}
