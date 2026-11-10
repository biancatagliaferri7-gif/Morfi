import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const business = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const product = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const oldOrder = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const newOrder = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('orders do not require stock and only return inventory actually deducted', async () => {
  const migration = await readFile(new URL('../morfi_orders_without_stock_gate_incremental.sql', import.meta.url), 'utf8');
  const checkout = migration.slice(migration.indexOf('-- checkout'));
  assert.doesNotMatch(checkout, /Insufficient finished stock|stock_quantity\s*=\s*stock_quantity\s*-|finished_stock\s*=\s*finished_stock\s*-|['"]order_sale['"]/);
  assert.match(checkout, /and is_available/);

  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
      create table public.morfi_business_products (
        id uuid primary key, business_id uuid not null, stock_quantity integer not null,
        updated_at timestamptz
      );
      create table public.morfi_recipes (
        id uuid primary key, business_id uuid not null, finished_stock numeric(14,4) not null,
        updated_at timestamptz
      );
      create table public.morfi_inventory_movements (
        business_id uuid, product_id uuid, recipe_id uuid, order_id uuid,
        movement_type text, quantity_delta numeric(14,4), unit text,
        reason text, created_by uuid
      );
    `);
    const helper = migration.slice(
      migration.indexOf('create or replace function public.morfi_restore_order_inventory_if_deducted('),
      migration.indexOf('revoke all on function public.morfi_restore_order_inventory_if_deducted('),
    );
    await db.exec(helper);
    await db.query('insert into public.morfi_business_products (id, business_id, stock_quantity) values ($1,$2,0)', [product, business]);

    await db.query('select public.morfi_restore_order_inventory_if_deducted($1,$2,$3)', [newOrder, business, 'cancelado']);
    let stock = await db.query<{ stock_quantity: number }>('select stock_quantity from public.morfi_business_products where id=$1', [product]);
    assert.equal(stock.rows[0].stock_quantity, 0);

    await db.query(`insert into public.morfi_inventory_movements (business_id, product_id, order_id, movement_type, quantity_delta, unit)
      values ($1,$2,$3,'order_sale',-2,'unidad')`, [business, product, oldOrder]);
    await db.query('select public.morfi_restore_order_inventory_if_deducted($1,$2,$3)', [oldOrder, business, 'rechazado']);
    await db.query('select public.morfi_restore_order_inventory_if_deducted($1,$2,$3)', [oldOrder, business, 'rechazado']);
    stock = await db.query<{ stock_quantity: number }>('select stock_quantity from public.morfi_business_products where id=$1', [product]);
    assert.equal(stock.rows[0].stock_quantity, 2);
    const returns = await db.query<{ count: string }>(`select count(*)::text as count from public.morfi_inventory_movements
      where order_id=$1 and movement_type='order_return'`, [oldOrder]);
    assert.equal(returns.rows[0].count, '1');
  } finally {
    await db.close();
  }
});
