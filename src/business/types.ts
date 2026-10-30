export type IngredientUnit = 'g' | 'kg' | 'ml' | 'l' | 'unidad';
export type RecipeYieldUnit = 'unidades' | 'porciones';

export interface Ingredient {
  id: string;
  name: string;
  purchaseQuantity: number;
  purchaseUnit: IngredientUnit;
  purchasePrice: number;
  stockQuantity: number;
  stockUnit: IngredientUnit;
}

export interface RecipeIngredient {
  ingredientId: string;
  quantity: number;
  unit: IngredientUnit;
}

export interface Recipe {
  id: string;
  name: string;
  yieldQuantity: number;
  yieldUnit: RecipeYieldUnit;
  ingredients: RecipeIngredient[];
  additionalCosts: number;
  sellingPrice: number | null;
  finishedStock: number;
}

export interface ProductionBatch {
  id: string;
  recipeId: string;
  recipeName: string;
  quantity: number;
  yieldUnit: RecipeYieldUnit;
  totalCost: number;
  costPerUnit: number;
  totalRevenue?: number;
  totalProfit?: number;
  indirectCost?: number;
  ingredientCosts?: {
    name: string;
    quantity: number;
    unit: IngredientUnit;
    totalCost: number;
  }[];
  createdAt: string;
}
