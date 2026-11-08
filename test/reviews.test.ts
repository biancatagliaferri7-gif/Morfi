import assert from 'node:assert/strict';
import test from 'node:test';
import { isReviewSchemaUnavailable } from '../src/business/reviewErrors';

test('detecta una base que todavía no tiene las tablas de opiniones', () => {
  assert.equal(isReviewSchemaUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.morfi_business_reviews' in the schema cache" }), true);
  assert.equal(isReviewSchemaUnavailable({ code: 'PGRST205', message: "Could not find the table 'public.morfi_product_review_summary' in the schema cache" }), true);
  assert.equal(isReviewSchemaUnavailable({ code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' }), false);
});
