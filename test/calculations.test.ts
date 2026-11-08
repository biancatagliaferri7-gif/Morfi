import test from 'node:test';
import assert from 'node:assert/strict';
import { areUnitsCompatible, getProductionRequirements, getRecipeCosts, toBaseQuantity } from '../src/business/calculations';

const ingredient = { id: 'flour', name: 'Harina', purchaseQuantity: 1, purchaseUnit: 'kg' as const, purchasePrice: 1000, stockQuantity: 2, stockUnit: 'kg' as const };
const recipe = { id: 'bread', name: 'Pan', yieldQuantity: 10, yieldUnit: 'unidades' as const, ingredients: [{ ingredientId: 'flour', quantity: 500, unit: 'g' as const }], additionalCosts: 100, sellingPrice: 100, finishedStock: 0 };

test('costs and production use compatible units', () => {
  assert.equal(getRecipeCosts(recipe, [ingredient])?.perUnit, 60);
  assert.equal(toBaseQuantity(1, 'kg'), 1000);
  assert.equal(areUnitsCompatible('kg', 'ml'), false);
  assert.equal(getRecipeCosts({ ...recipe, yieldQuantity: 0 }, [ingredient]), null);
  assert.equal(getProductionRequirements(recipe, 20, [ingredient])?.get('flour'), 1);
});
